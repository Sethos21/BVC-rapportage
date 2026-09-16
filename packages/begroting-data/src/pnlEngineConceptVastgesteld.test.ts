import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RENTE_CATEGORIEEN, berekenBegroteRente, berekenPnLBoom, type BgRenteCategorie, type BgRenteCategorieAannames, type BgRenteRegelInvoer, type BgRenteResultaat, type PurePnLOnderEbitdaRegel } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenRenteResultaat, schrijfFrozenRenteResultaat } from "./frozenRenteResultaat.js";
import type { HerberekendRenteResultaat } from "./herberekenen.js";

/**
 * FASE EBITDA-GAT-001B, §12 — minimaal bewijs dat CONCEPT (live herberekend)
 * en VASTGESTELD (bevroren gelezen) Rente-Begroting-resultaten door DEZELFDE
 * adapter + DEZELFDE pure P&L-engine kunnen worden verwerkt, zonder enige
 * aparte codepad-vertakking op lifecyclestatus.
 *
 * Dit bewijs is voor Rente bijzonder eenvoudig omdat `FrozenRenteResultaat`
 * (`frozenRenteResultaat.ts`) een LETTERLIJKE type-alias is van
 * `HerberekendRenteResultaat` (`herberekenen.ts`, regel 343) — CONCEPT en
 * VASTGESTELD hebben voor Rente dus exact dezelfde TypeScript-vorm. Dat is
 * GEEN aanname van dit bestand; het is de reden waarom onderstaande adapter
 * zonder enige vertaling op beide kan worden toegepast.
 *
 * GEEN persistence-/snapshotschema-wijziging: dit bestand voegt niets toe
 * aan `frozenRenteResultaat.ts` of migraties, en roept uitsluitend
 * bestaande, al bewezen functies aan (`schrijfFrozenRenteResultaat`,
 * `leesFrozenRenteResultaat`, `markeerVastgesteld`) — zie
 * `frozenRenteResultaat.test.ts` voor de volledige immutability-/CHECK-
 * regressiedekking, hier bewust niet herhaald.
 */

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-pnl-engine-concept-vastgesteld-"));
  db = openOrCreateDatabase(join(dir, "begrotingen.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NIEUWE_VERSIE_INPUT: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "023", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };

function regelInvoer(overrides: Partial<BgRenteRegelInvoer> = {}): BgRenteRegelInvoer {
  return { categorie: "RENTEKOSTEN", omschrijving: "Lening 747", complexnummer: null, ogbReferentie: null, laatstBekendSaldo: null, rentepercentage: null, begrotingsbedrag: new Decimal(1000), ...overrides };
}

function alleAannames(): Record<BgRenteCategorie, BgRenteCategorieAannames> {
  return Object.fromEntries(RENTE_CATEGORIEEN.map((categorie) => [categorie, { beoordeeld: true }])) as Record<BgRenteCategorie, BgRenteCategorieAannames>;
}

/** Zelfde patroon als `frozenRenteResultaat.test.ts`'s `berekenMetIds` — koppelt persistentie-ids positioneel per categorie aan de pure calculator-uitkomst. */
function berekenMetIds(regels: readonly { invoer: BgRenteRegelInvoer; id: number }[]): HerberekendRenteResultaat {
  const resultaat: BgRenteResultaat = berekenBegroteRente(
    regels.map((r) => r.invoer),
    alleAannames(),
    { begrotingsjaar: 2027 },
  );
  const perCategorie = resultaat.perCategorie.map((categorieResultaat) => {
    const idsVoorCategorie = regels.filter((r) => r.invoer.categorie === categorieResultaat.categorie).map((r) => r.id);
    return { ...categorieResultaat, regels: categorieResultaat.regels.map((regelUitkomst, i) => ({ persistentieId: idsVoorCategorie[i]!, regel: regelUitkomst })) };
  });
  return { ...resultaat, perCategorie };
}

/**
 * DE ENE ADAPTER, VOOR BEIDE LEVENSCYCLUSSTATUSSEN: neemt uitsluitend de
 * `rentekosten`/`renteOpbrengsten`-velden van `BgRenteResultaat` (waarvan
 * zowel `HerberekendRenteResultaat` als `FrozenRenteResultaat` een structureel
 * compatibele uitbreiding zijn) — géén kennis van CONCEPT/VASTGESTELD, géén
 * kennis van waar het resultaat vandaan kwam. Test-lokaal, geen productiecode
 * (zie `pnlEngine.test.ts`'s moduledoc voor dezelfde afweging).
 */
function bgRenteNaarPnLOnderEbitdaRegels(resultaat: Pick<BgRenteResultaat, "rentekosten" | "renteOpbrengsten">): PurePnLOnderEbitdaRegel[] {
  return [
    { regelSleutel: "RENTEKOSTEN", boomPositie: "ONDER_EBITDA", contributieAard: "KOSTEN", waarde: { status: "BEKEND", bedrag: resultaat.rentekosten } },
    // Normalisatie, exact één keer: Begroting-opbrengstregels worden (net als Werkelijk, CAL-FIN-001)
    // met een negatief bedrag ingevoerd — hier eenmalig genegeerd, gestuurd door de vaste contributieAard.
    { regelSleutel: "RENTE_OPBRENGSTEN", boomPositie: "ONDER_EBITDA", contributieAard: "OPBRENGST", waarde: { status: "BEKEND", bedrag: resultaat.renteOpbrengsten.negated() } },
  ];
}

describe("EBITDA-GAT-001B §12 — CONCEPT en VASTGESTELD Rente-Begroting delen dezelfde adapter + pure engine", () => {
  it("een CONCEPT-resultaat (live herberekend) en het daarna bevroren, VASTGESTELD-gelezen resultaat geven byte-identieke onder-EBITDA-bijdragen via exact dezelfde adapter en engine-aanroep", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const conceptResultaat: HerberekendRenteResultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "RENTEKOSTEN", begrotingsbedrag: new Decimal(1148524.51) }), id: 1 },
      { invoer: regelInvoer({ categorie: "RENTE_OPBRENGSTEN", begrotingsbedrag: new Decimal(-1250.09) }), id: 2 },
    ]);

    // CONCEPT: de adapter ontvangt het live-herberekende resultaat rechtstreeks.
    const pnlConcept = berekenPnLBoom("BEGROTING_NIEUW_JAAR", bgRenteNaarPnLOnderEbitdaRegels(conceptResultaat));

    // Bevriezen (bestaande, reeds bewezen infrastructuur — geen wijziging hier).
    schrijfFrozenRenteResultaat(db, versie.id, conceptResultaat);
    markeerVastgesteld(db, versie.id, new Date());
    const vastgesteldResultaat = leesFrozenRenteResultaat(db, versie.id)!; // type: FrozenRenteResultaat === HerberekendRenteResultaat

    // VASTGESTELD: DEZELFDE adapterfunctie, DEZELFDE engine-aanroep — geen aparte tak, geen
    // opnieuw uitlezen van levende brondata (de vastgestelde begroting hangt hier niet van af).
    const pnlVastgesteld = berekenPnLBoom("BEGROTING_NIEUW_JAAR", bgRenteNaarPnLOnderEbitdaRegels(vastgesteldResultaat));

    const rentekostenConcept = pnlConcept.onderEbitda.find((r) => r.regelSleutel === "RENTEKOSTEN")!;
    const rentekostenVastgesteld = pnlVastgesteld.onderEbitda.find((r) => r.regelSleutel === "RENTEKOSTEN")!;
    expect((rentekostenVastgesteld.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe((rentekostenConcept.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString());
    expect((rentekostenConcept.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("1148524.51");

    const renteOpbrengstenConcept = pnlConcept.onderEbitda.find((r) => r.regelSleutel === "RENTE_OPBRENGSTEN")!;
    const renteOpbrengstenVastgesteld = pnlVastgesteld.onderEbitda.find((r) => r.regelSleutel === "RENTE_OPBRENGSTEN")!;
    expect((renteOpbrengstenVastgesteld.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe(
      (renteOpbrengstenConcept.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString(),
    );
    expect((renteOpbrengstenConcept.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("1250.09");

    // Beide zitten uitsluitend onder EBITDA — boven-EBITDA-subtotalen (hier leeg aangeleverd) blijven 0/VOLLEDIG in beide.
    expect(pnlConcept.ebitda.bedrag.toString()).toBe(pnlVastgesteld.ebitda.bedrag.toString());
  });
});
