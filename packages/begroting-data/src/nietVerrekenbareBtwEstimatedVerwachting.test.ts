import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenWerkelijkNietVerrekenbareBtw } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesNietVerrekenbareBtwEstimatedResultaat, leesNietVerrekenbareBtwEstimatedVerwachting, schrijfNietVerrekenbareBtwEstimatedVerwachting } from "./nietVerrekenbareBtwEstimatedVerwachting.js";
import { schrijfNietVerrekenbareBtwState } from "./nietVerrekenbareBtwState.js";
import { stelBegrotingVast } from "./vaststellen.js";
import { schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Snapshot } from "./module1Snapshot.js";
import { schrijfModule3Invoer } from "./module3Invoer.js";
import { schrijfGeplandOnderhoudActiviteiten } from "./geplandOnderhoudActiviteiten.js";
import { schrijfGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";
import { schrijfCorrectiefDagelijksOnderhoudRegels } from "./correctiefDagelijksOnderhoudRegels.js";
import { schrijfCorrectiefDagelijksOnderhoudBeoordeeld } from "./correctiefDagelijksOnderhoudBeoordeeld.js";
import { schrijfVerzekeringBeoordeeld } from "./verzekeringBeoordeeld.js";
import { schrijfGemeentelijkeLastenModule } from "./gemeentelijkeLastenModule.js";
import { schrijfAlgemeneKostenCategorieState } from "./algemeneKostenCategorieState.js";
import { ALGEMENE_KOSTEN_CATEGORIEEN, LEEGSTAND_CATEGORIEEN, RENTE_CATEGORIEEN, type BgManagementInvoer } from "@bvc/reporting";
import { schrijfLeegstandCategorieState } from "./leegstandCategorieState.js";
import { schrijfRenteCategorieState } from "./renteCategorieState.js";
import { schrijfGeplandeVerkoopBeoordeeld } from "./geplandeVerkoopBeoordeeld.js";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-btw-estimated-"));
  db = openOrCreateDatabase(join(dir, "begrotingen.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const D = (n: string | number) => new Decimal(n);
const VERSIE: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };
const MODULE3: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: D(500), eenheid: "MAAND", ingangsdatum: null };
const werkelijk4000 = () => berekenWerkelijkNietVerrekenbareBtw([{ economischeCategorie: "NIET_VERREKENBARE_BTW", saldo: D(4000) }]);

/** Een volledig vaststelbare, minimale begroting — uitsluitend nodig om de VASTGESTELD-lifecycle te bewijzen. */
function volledigVaststelbareVersie(): string {
  const id = maakBegrotingsversie(db, VERSIE).id;
  schrijfModule1Snapshot(db, id, []);
  schrijfModule1Aannames(db, id, { begrotingsjaar: 2027, indexatiePercentage: D(3) });
  schrijfModule3Invoer(db, id, MODULE3);
  schrijfGeplandOnderhoudActiviteiten(db, id, []);
  schrijfGeplandOnderhoudBeoordeeld(db, id, true);
  schrijfCorrectiefDagelijksOnderhoudRegels(db, id, []);
  schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, id, true);
  schrijfVerzekeringBeoordeeld(db, id, true);
  schrijfGemeentelijkeLastenModule(db, id, { werkelijkeGemeentelijkeLasten: null, wozStijgingPercentage: null, lastenPercentageStijging: null, begrotingsPercentageOverride: null, beoordeeld: true });
  schrijfAlgemeneKostenCategorieState(db, id, Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, { beoordeeld: true, vorigJaarBedrag: null, verwachteVerhogingPercentage: null }])) as never);
  schrijfLeegstandCategorieState(db, id, Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c) => [c, { beoordeeld: true, laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null }])) as never);
  schrijfRenteCategorieState(db, id, Object.fromEntries(RENTE_CATEGORIEEN.map((c) => [c, { beoordeeld: true }])) as never);
  schrijfGeplandeVerkoopBeoordeeld(db, id, true);
  schrijfNietVerrekenbareBtwState(db, id, { beoordeeld: true, vorigJaarWerkelijk: null });
  return id;
}

describe("Niet verrekenbare BTW Estimated — persistence (migratie 39)", () => {
  it("geen rij = niet ingevuld (null); expliciet €0 is geldig en blijft onderscheiden; null verwijdert; NaN/onbekende versie geweigerd", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    expect(leesNietVerrekenbareBtwEstimatedVerwachting(db, id)).toBeNull();
    expect(schrijfNietVerrekenbareBtwEstimatedVerwachting(db, id, D(0))!.toString()).toBe("0");
    expect(schrijfNietVerrekenbareBtwEstimatedVerwachting(db, id, D("2500.75"))!.toString()).toBe("2500.75");
    expect(schrijfNietVerrekenbareBtwEstimatedVerwachting(db, id, null)).toBeNull();
    expect(() => schrijfNietVerrekenbareBtwEstimatedVerwachting(db, id, D(NaN))).toThrow(/NaN/);
    expect(() => schrijfNietVerrekenbareBtwEstimatedVerwachting(db, "bestaat-niet", D(1))).toThrow(/bestaat niet/);
  });

  it("versiegebonden en cascade bij verwijderen van een CONCEPT-versie", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    schrijfNietVerrekenbareBtwEstimatedVerwachting(db, id, D(5));
    verwijderConceptVersie(db, id);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM begroting_niet_verrekenbare_btw_estimated_verwachting`).get() as { n: number }).n).toBe(0);
  });

  it("A. Werkelijk + verwachting bekend -> Estimated bekend (4000 + 2500 = 6500)", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    schrijfNietVerrekenbareBtwEstimatedVerwachting(db, id, D(2500));
    const r = leesNietVerrekenbareBtwEstimatedResultaat(db, id, werkelijk4000(), true);
    expect(r.estimatedTotaal!.toString()).toBe("6500");
  });

  it("B. verwachting expliciet €0 -> Estimated = Werkelijk (4000)", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    schrijfNietVerrekenbareBtwEstimatedVerwachting(db, id, D(0));
    const r = leesNietVerrekenbareBtwEstimatedResultaat(db, id, werkelijk4000(), true);
    expect(r.estimatedTotaal!.toString()).toBe("4000");
  });

  it("C. verwachting niet ingevuld -> Estimated onbekend (null), nooit €0", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    const r = leesNietVerrekenbareBtwEstimatedResultaat(db, id, werkelijk4000(), true);
    expect(r.estimatedTotaal).toBeNull();
    expect(r.verwachtingResterendJaar).toBeNull();
  });

  it("D. Werkelijk-dekking niet bevestigd + verwachting bekend -> geen verzonnen totaal (null)", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    schrijfNietVerrekenbareBtwEstimatedVerwachting(db, id, D(2500));
    const r = leesNietVerrekenbareBtwEstimatedResultaat(db, id, werkelijk4000(), false);
    expect(r.estimatedTotaal).toBeNull();
  });

  it("E. Werkelijk-dekking niet bevestigd + verwachting niet ingevuld -> nog steeds null", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    const r = leesNietVerrekenbareBtwEstimatedResultaat(db, id, werkelijk4000(), false);
    expect(r.estimatedTotaal).toBeNull();
  });

  it("Estimated mag worden geschreven/gewijzigd op een VASTGESTELDE versie (bewust GEEN CONCEPT-check) zonder de vastgestelde Begroting te raken", () => {
    const id = volledigVaststelbareVersie();
    stelBegrotingVast(db, id, new Date("2026-09-29T00:00:00.000Z"));
    expect(schrijfNietVerrekenbareBtwEstimatedVerwachting(db, id, D(2500))!.toString()).toBe("2500");
    expect(schrijfNietVerrekenbareBtwEstimatedVerwachting(db, id, D(9999))!.toString()).toBe("9999"); // blijft het hele jaar wijzigbaar
  });
});
