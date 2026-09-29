import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenWerkelijkRente } from "@bvc/reporting";
import { maakBegrotingsversie, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesRenteEstimatedResultaat, leesRenteEstimatedVerwachting, schrijfRenteEstimatedVerwachting } from "./renteEstimatedVerwachting.js";
import { schrijfRenteCategorieState } from "./renteCategorieState.js";
import { schrijfRenteRegels } from "./renteRegels.js";
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
import { schrijfGeplandeVerkoopBeoordeeld } from "./geplandeVerkoopBeoordeeld.js";
import { schrijfNietVerrekenbareBtwState } from "./nietVerrekenbareBtwState.js";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-rente-estimated-"));
  db = openOrCreateDatabase(join(dir, "begrotingen.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const D = (n: string | number) => new Decimal(n);
const VERSIE: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };
const MODULE3: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: D(500), eenheid: "MAAND", ingangsdatum: null };
const werkelijkKosten = (bedrag: number | string) => berekenWerkelijkRente([{ ogbKostensoort: "4601", saldo: D(bedrag) }], [{ ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening", categorie: "RENTEKOSTEN" }]);

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

describe("Rente Estimated — persistence (migratie 40)", () => {
  it("geen rij = niet ingevuld (null) voor beide categorieën; expliciet €0 blijft onderscheidbaar; null verwijdert; NaN/onbekende versie geweigerd", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    expect(leesRenteEstimatedVerwachting(db, id)).toEqual({ RENTEKOSTEN: null, RENTE_OPBRENGSTEN: null });
    expect(schrijfRenteEstimatedVerwachting(db, id, { RENTEKOSTEN: D(0), RENTE_OPBRENGSTEN: null }).RENTEKOSTEN!.toString()).toBe("0");
    expect(schrijfRenteEstimatedVerwachting(db, id, { RENTEKOSTEN: D("2500.75"), RENTE_OPBRENGSTEN: D("-500") })).toEqual({ RENTEKOSTEN: D("2500.75"), RENTE_OPBRENGSTEN: D("-500") });
    expect(schrijfRenteEstimatedVerwachting(db, id, { RENTEKOSTEN: null, RENTE_OPBRENGSTEN: null })).toEqual({ RENTEKOSTEN: null, RENTE_OPBRENGSTEN: null });
    expect(() => schrijfRenteEstimatedVerwachting(db, id, { RENTEKOSTEN: D(NaN), RENTE_OPBRENGSTEN: null })).toThrow(/NaN/);
    expect(() => schrijfRenteEstimatedVerwachting(db, "bestaat-niet", { RENTEKOSTEN: D(1), RENTE_OPBRENGSTEN: null })).toThrow(/bestaat niet/);
  });

  it("versiegebonden en cascade bij verwijderen van een CONCEPT-versie", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    schrijfRenteEstimatedVerwachting(db, id, { RENTEKOSTEN: D(5), RENTE_OPBRENGSTEN: D(5) });
    verwijderConceptVersie(db, id);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM begroting_rente_estimated_verwachting`).get() as { n: number }).n).toBe(0);
  });

  it("A. Actual + verwachting bekend -> Estimated bekend (4000 + 2500 = 6500)", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    schrijfRenteEstimatedVerwachting(db, id, { RENTEKOSTEN: D(2500), RENTE_OPBRENGSTEN: null });
    const r = leesRenteEstimatedResultaat(db, id, werkelijkKosten(4000));
    expect(r.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.estimatedTotaal!.toString()).toBe("6500");
  });

  it("B. verwachting expliciet €0 -> Estimated = Actual (4000)", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    schrijfRenteEstimatedVerwachting(db, id, { RENTEKOSTEN: D(0), RENTE_OPBRENGSTEN: null });
    const r = leesRenteEstimatedResultaat(db, id, werkelijkKosten(4000));
    expect(r.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.estimatedTotaal!.toString()).toBe("4000");
  });

  it("C. verwachting niet ingevuld -> Estimated onbekend (null), nooit €0", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    const r = leesRenteEstimatedResultaat(db, id, werkelijkKosten(4000));
    expect(r.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.estimatedTotaal).toBeNull();
  });

  it("RENTE_OPBRENGSTEN: ruwe (negatieve) tekenconventie — een grotere verwachte opbrengst is een negatiever getal", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    schrijfRenteEstimatedVerwachting(db, id, { RENTEKOSTEN: null, RENTE_OPBRENGSTEN: D(-500) });
    const werkelijkOpbrengst = berekenWerkelijkRente([{ ogbKostensoort: "4604", saldo: D("-1250.09") }], [{ ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente r/c", categorie: "RENTE_OPBRENGSTEN" }]);
    const r = leesRenteEstimatedResultaat(db, id, werkelijkOpbrengst);
    expect(r.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!.estimatedTotaal!.toString()).toBe("-1750.09"); // ruw; na normalisatie in de P&L-adapter: 1750.09
  });

  it("Estimated mag worden geschreven/gewijzigd op een VASTGESTELDE versie (bewust GEEN CONCEPT-check) zonder de vastgestelde Begroting te raken", () => {
    const id = volledigVaststelbareVersie();
    stelBegrotingVast(db, id, new Date("2026-09-29T00:00:00.000Z"));
    expect(schrijfRenteEstimatedVerwachting(db, id, { RENTEKOSTEN: D(2500), RENTE_OPBRENGSTEN: null }).RENTEKOSTEN!.toString()).toBe("2500");
    expect(schrijfRenteEstimatedVerwachting(db, id, { RENTEKOSTEN: D(9999), RENTE_OPBRENGSTEN: null }).RENTEKOSTEN!.toString()).toBe("9999"); // blijft het hele jaar wijzigbaar
  });

  it("leest de VASTGESTELDE (bevroren) Begroting voor de vergelijkingsbasis, niet een herberekening van de concept-regels", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    schrijfRenteCategorieState(db, id, { RENTEKOSTEN: { beoordeeld: true }, RENTE_OPBRENGSTEN: { beoordeeld: true } });
    schrijfRenteRegels(db, id, [{ id: null, categorie: "RENTEKOSTEN", omschrijving: "Lening", complexnummer: null, ogbReferentie: null, laatstBekendSaldo: null, rentepercentage: null, begrotingsbedrag: D(900) }]);
    const voorVaststellen = leesRenteEstimatedResultaat(db, id, werkelijkKosten(4000));
    expect(voorVaststellen.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.begrotingTotaal.toString()).toBe("900");
  });
});
