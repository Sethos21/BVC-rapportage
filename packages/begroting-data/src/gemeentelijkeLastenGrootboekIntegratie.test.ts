import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALGEMENE_KOSTEN_CATEGORIEEN, LEEGSTAND_CATEGORIEEN, RENTE_CATEGORIEEN, type BgManagementInvoer } from "@bvc/reporting";
import { schrijfAlgemeneKostenCategorieState } from "./algemeneKostenCategorieState.js";
import { leesBegrotingsversie, maakBegrotingsversie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { schrijfCorrectiefDagelijksOnderhoudBeoordeeld } from "./correctiefDagelijksOnderhoudBeoordeeld.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenGemeentelijkeLastenResultaat } from "./frozenGemeentelijkeLastenResultaat.js";
import { schrijfGemeentelijkeLastenModule, schrijfWozSetBevestigd } from "./gemeentelijkeLastenModule.js";
import { leesGemeentelijkeLastenRegels, schrijfGemeentelijkeLastenRegels, type GemeentelijkeLastenRegelInvoer } from "./gemeentelijkeLastenRegels.js";
import { schrijfGeplandeVerkoopBeoordeeld } from "./geplandeVerkoopBeoordeeld.js";
import { schrijfGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";
import { herberekenBegroting } from "./herberekenen.js";
import { schrijfLeegstandCategorieState } from "./leegstandCategorieState.js";
import { schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Snapshot } from "./module1Snapshot.js";
import { schrijfModule3Invoer } from "./module3Invoer.js";
import { voegPnLBronmappingMutatieToe, type PnLBronmappingMutatieInvoer } from "./pnlBronmappingRepository.js";
import { schrijfRenteCategorieState } from "./renteCategorieState.js";
import { stelBegrotingVast } from "./vaststellen.js";
import { schrijfVerzekeringBeoordeeld } from "./verzekeringBeoordeeld.js";

/**
 * Integratiebewijs Vervolgtranche 4 (besluit 2026-09-25): directe begroting per relevante GL loopt door
 * herberekenen → vaststellen → frozen. De relevante GL's komen uitsluitend uit de per-administratie mapping in
 * dezelfde database; testfixtures volgen de bronbewezen sets (070: GL4700+OGB4701 en GL4710; 003: één GL4701).
 */

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-gl-lasten-integratie-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const VERSIE_070: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };
const MODULE3: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(500), eenheid: "MAAND", ingangsdatum: null };

function mapping(overrides: Partial<PnLBronmappingMutatieInvoer> = {}): PnLBronmappingMutatieInvoer {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4700",
    grootboekOmschrijving: "WOZ / OZB",
    ogbKostensoort: "4701",
    ogbKostensoortOmschrijving: "OZB",
    economischeModule: "GEMEENTELIJKE_LASTEN",
    economischeCategorie: "GEMEENTELIJKE_LASTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    type: "NIEUWE_MAPPING_VANAF_PERIODE",
    vorigeMappingId: null,
    gewijzigdOp: new Date("2026-09-14T00:00:00.000Z"),
    gebruiker: "test",
    wijzigingsreden: "testfixture",
    ...overrides,
  };
}

function zetMapping070(): void {
  voegPnLBronmappingMutatieToe(db, mapping());
  voegPnLBronmappingMutatieToe(db, mapping({ grootboekrekening: "4710", grootboekOmschrijving: "Gemeentelijke heffingen", ogbKostensoort: null, ogbKostensoortOmschrijving: null }));
}

function regel(overrides: Partial<GemeentelijkeLastenRegelInvoer> = {}): GemeentelijkeLastenRegelInvoer {
  return { id: null, grootboekrekening: "4710", ogbKostensoort: null, jaarbedrag: new Decimal(1000), ...overrides };
}

/** Alle overige modules bewust beoordeeld met niets; Gemeentelijke lasten zonder WOZ-objecten (bewust €0 voor het WOZ-voorstel), regels naar keuze. */
function zetBasisNeer(versieId: string, glRegels: readonly GemeentelijkeLastenRegelInvoer[], beoordeeld = true): void {
  schrijfModule1Snapshot(db, versieId, []);
  schrijfModule1Aannames(db, versieId, { begrotingsjaar: leesBegrotingsversie(db, versieId)!.begrotingsjaar, indexatiePercentage: new Decimal(3) });
  schrijfModule3Invoer(db, versieId, MODULE3);
  schrijfGeplandOnderhoudBeoordeeld(db, versieId, true);
  schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versieId, true);
  schrijfVerzekeringBeoordeeld(db, versieId, true);
  schrijfGemeentelijkeLastenModule(db, versieId, {
    werkelijkeGemeentelijkeLasten: null,
    wozStijgingPercentage: null,
    lastenPercentageStijging: null,
    begrotingsPercentageOverride: null,
    beoordeeld,
  });
  schrijfGemeentelijkeLastenRegels(db, versieId, glRegels);
  schrijfAlgemeneKostenCategorieState(
    db,
    versieId,
    Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, { beoordeeld: true, vorigJaarBedrag: null, verwachteVerhogingPercentage: null }])) as never,
  );
  schrijfLeegstandCategorieState(
    db,
    versieId,
    Object.fromEntries(
      LEEGSTAND_CATEGORIEEN.map((c) => [c, { beoordeeld: true, laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null }]),
    ) as never,
  );
  schrijfRenteCategorieState(db, versieId, Object.fromEntries(RENTE_CATEGORIEEN.map((c) => [c, { beoordeeld: true }])) as never);
  schrijfGeplandeVerkoopBeoordeeld(db, versieId, true);
}

const kritiek = (c: readonly { ernst: string }[]) => c.filter((x) => x.ernst === "KRITIEK");

describe("herberekenBegroting — directe begroting per relevante GL", () => {
  it("1. 070: twee relevante GL's worden afzonderlijk begroot en tellen op tot één post; het WOZ-voorstel blijft een apart getal", () => {
    zetMapping070();
    const versie = maakBegrotingsversie(db, VERSIE_070);
    zetBasisNeer(versie.id, [regel({ grootboekrekening: "4700", ogbKostensoort: "4701", jaarbedrag: new Decimal("8000.50") }), regel({ grootboekrekening: "4710", jaarbedrag: new Decimal("2000.25") })]);

    const resultaat = herberekenBegroting(db, versie.id).gemeentelijkeLasten;
    expect(resultaat.grootboekRegels.begroteGemeentelijkeLastenPost.toString()).toBe("10000.75");
    expect(resultaat.grootboekRegels.perGrootboek.map((g) => g.grootboekrekening)).toEqual(["4700", "4710"]);
    expect(kritiek(resultaat.grootboekRegels.controleVereist)).toEqual([]);
    expect(resultaat.begroteGemeentelijkeLasten!.toString()).toBe("0"); // WOZ-voorstel (geen WOZ-objecten) — onafhankelijk van de regels
  });

  it("2. stabiele ids: elke uitkomst draagt het persistentie-id van haar regel, ongeacht volgorde of inhoud", () => {
    zetMapping070();
    const versie = maakBegrotingsversie(db, VERSIE_070);
    zetBasisNeer(versie.id, [regel({ grootboekrekening: "4710", jaarbedrag: new Decimal(1) }), regel({ grootboekrekening: "4700", ogbKostensoort: "4701", jaarbedrag: new Decimal(2) })]);
    const opgeslagen = leesGemeentelijkeLastenRegels(db, versie.id);
    const uitkomst = herberekenBegroting(db, versie.id).gemeentelijkeLasten.grootboekRegels.regels;
    expect(uitkomst.map((u) => u.persistentieId)).toEqual(opgeslagen.map((r) => r.id));
    expect(uitkomst.map((u) => u.regel.bijdrage.toString())).toEqual(["1", "2"]);
  });

  it("3. administratie 003 (één GL4701 in de mapping): de 070-GL's zijn daar géén relevante GL — data-gedreven, niet gehardcoded", () => {
    zetMapping070();
    voegPnLBronmappingMutatieToe(db, mapping({ bedrijfsnr: "003", grootboekrekening: "4701", grootboekOmschrijving: "Gemeentelijke lasten", ogbKostensoort: null, ogbKostensoortOmschrijving: null }));
    const versie003 = maakBegrotingsversie(db, { ...VERSIE_070, bedrijfsnr: "003" });
    zetBasisNeer(versie003.id, [regel({ grootboekrekening: "4701", jaarbedrag: new Decimal(500) })]);
    const goed = herberekenBegroting(db, versie003.id).gemeentelijkeLasten.grootboekRegels;
    expect(goed.begroteGemeentelijkeLastenPost.toString()).toBe("500");
    expect(kritiek(goed.controleVereist)).toEqual([]);

    schrijfGemeentelijkeLastenRegels(db, versie003.id, [regel({ grootboekrekening: "4710", jaarbedrag: new Decimal(500) })]);
    expect(kritiek(herberekenBegroting(db, versie003.id).gemeentelijkeLasten.grootboekRegels.controleVereist)).toHaveLength(1);
  });

  it("4. administratie zonder mapping: elke regel is KRITIEK (Controle vereist) — nooit een 070-fallback of gok; geen regels blijft geldig", () => {
    zetMapping070();
    const versie = maakBegrotingsversie(db, { ...VERSIE_070, bedrijfsnr: "999" });
    zetBasisNeer(versie.id, [regel({ grootboekrekening: "4710" })]);
    expect(kritiek(herberekenBegroting(db, versie.id).gemeentelijkeLasten.grootboekRegels.controleVereist)).toHaveLength(1);
    schrijfGemeentelijkeLastenRegels(db, versie.id, []);
    expect(kritiek(herberekenBegroting(db, versie.id).gemeentelijkeLasten.grootboekRegels.controleVereist)).toEqual([]);
  });

  it("5. relevantie is per begrotingsjaar (mapping-geldigheid): een GL waarvan de mapping vóór het begrotingsjaar eindigt is dan niet relevant — het bedrag blijft, de regel wordt KRITIEK", () => {
    // GL4710 is gemapt tot 2029-01 (exclusief): relevant in 2028, niet meer in 2030.
    voegPnLBronmappingMutatieToe(db, mapping({ grootboekrekening: "4710", ogbKostensoort: null, ogbKostensoortOmschrijving: null, geldigTotBoekjaar: 2029, geldigTotPeriode: "01" }));
    const v2028 = maakBegrotingsversie(db, { ...VERSIE_070, begrotingsjaar: 2028 });
    const v2030 = maakBegrotingsversie(db, { ...VERSIE_070, begrotingsjaar: 2030 });
    zetBasisNeer(v2028.id, [regel({ grootboekrekening: "4710", jaarbedrag: new Decimal(1234) })]);
    zetBasisNeer(v2030.id, [regel({ grootboekrekening: "4710", jaarbedrag: new Decimal(1234) })]);

    const relevant = herberekenBegroting(db, v2028.id).gemeentelijkeLasten.grootboekRegels;
    expect(kritiek(relevant.controleVereist)).toEqual([]);
    const verlopen = herberekenBegroting(db, v2030.id).gemeentelijkeLasten.grootboekRegels;
    expect(verlopen.begroteGemeentelijkeLastenPost.toString()).toBe("1234");
    expect(kritiek(verlopen.controleVereist)).toHaveLength(1);
  });
});

describe("stelBegrotingVast — directe begroting per relevante GL", () => {
  it("6. een geldige set regels wordt vastgesteld en bevroren: regels, subtotalen en de post komen exact terug uit de frozen tabellen", () => {
    zetMapping070();
    const versie = maakBegrotingsversie(db, VERSIE_070);
    zetBasisNeer(versie.id, [regel({ grootboekrekening: "4700", ogbKostensoort: "4701", jaarbedrag: new Decimal("8000.50") }), regel({ grootboekrekening: "4710", jaarbedrag: new Decimal("2000.25") })]);
    const opgeslagen = leesGemeentelijkeLastenRegels(db, versie.id);

    const vast = stelBegrotingVast(db, versie.id, new Date(Date.UTC(2026, 8, 25)));
    expect(vast.gemeentelijkeLasten.grootboekRegels!.begroteGemeentelijkeLastenPost.toString()).toBe("10000.75");
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("VASTGESTELD");

    const frozen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(frozen.grootboekRegels!.begroteGemeentelijkeLastenPost.toString()).toBe("10000.75");
    expect(frozen.grootboekRegels!.regels.map((r) => r.persistentieId)).toEqual(opgeslagen.map((r) => r.id));
    expect(frozen.grootboekRegels!.perGrootboek.map((g) => [g.grootboekrekening, g.subtotaal.toString()])).toEqual([
      ["4700", "8000.5"],
      ["4710", "2000.25"],
    ]);
  });

  it("7. een regel met een niet-relevante GL blokkeert vaststellen (KRITIEK); de versie blijft CONCEPT zonder frozen output", () => {
    zetMapping070();
    const versie = maakBegrotingsversie(db, VERSIE_070);
    zetBasisNeer(versie.id, [regel({ grootboekrekening: "9999" })]);
    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/Gemeentelijke lasten per grootboekrekening bevat één of meer KRITIEKE controls/);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
    expect(leesFrozenGemeentelijkeLastenResultaat(db, versie.id)).toBeNull();
  });

  it("8. een regel zonder bedrag (leeg ≠ €0) blokkeert vaststellen; bewust €0 laat het toe", () => {
    zetMapping070();
    const versie = maakBegrotingsversie(db, VERSIE_070);
    zetBasisNeer(versie.id, [regel({ grootboekrekening: "4710", jaarbedrag: null })]);
    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/KRITIEKE controls/);
    schrijfGemeentelijkeLastenRegels(db, versie.id, leesGemeentelijkeLastenRegels(db, versie.id).map((r) => ({ ...r, jaarbedrag: new Decimal(0) })));
    const vast = stelBegrotingVast(db, versie.id, new Date(Date.UTC(2026, 8, 25)));
    expect(vast.gemeentelijkeLasten.grootboekRegels!.begroteGemeentelijkeLastenPost.toString()).toBe("0");
  });

  it("9. een dubbele regel voor dezelfde GL(+OGB) blokkeert vaststellen", () => {
    zetMapping070();
    const versie = maakBegrotingsversie(db, VERSIE_070);
    zetBasisNeer(versie.id, [regel(), regel()]);
    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/KRITIEKE controls/);
  });

  it("10. onbeoordeeld blijft blokkeren, ook met geldige regels (bestaande lifecycle ongewijzigd)", () => {
    zetMapping070();
    const versie = maakBegrotingsversie(db, VERSIE_070);
    zetBasisNeer(versie.id, [regel()], false);
    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/niet beoordeeld/);
  });

  it("11. na vaststellen zijn de concept-regels immutable (trigger), en een latere mappingwijziging raakt de bevroren post niet", () => {
    zetMapping070();
    const versie = maakBegrotingsversie(db, VERSIE_070);
    zetBasisNeer(versie.id, [regel({ grootboekrekening: "4710", jaarbedrag: new Decimal(777) })]);
    stelBegrotingVast(db, versie.id, new Date(Date.UTC(2026, 8, 25)));

    expect(() => schrijfGemeentelijkeLastenRegels(db, versie.id, [])).toThrow(/VASTGESTELD/);
    expect(() => db.prepare(`UPDATE begroting_gemeentelijke_lasten_regel SET jaarbedrag = '1' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/VASTGESTELD/);
    // De mapping voor GL4710 wordt later gesloten: de bevroren post en regels blijven ongewijzigd.
    db.prepare(`UPDATE pnl_bronmapping SET geldig_tot_boekjaar = 2026, geldig_tot_periode = '01' WHERE grootboekrekening = '4710'`).run();
    const frozen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(frozen.grootboekRegels!.begroteGemeentelijkeLastenPost.toString()).toBe("777");
    expect(frozen.grootboekRegels!.regels).toHaveLength(1);
  });

  it("12. rollback: een fout tijdens het bevriezen van de GL-regels laat de versie CONCEPT en zonder enige frozen GL-output", () => {
    zetMapping070();
    const versie = maakBegrotingsversie(db, VERSIE_070);
    zetBasisNeer(versie.id, [regel({ grootboekrekening: "4710", jaarbedrag: new Decimal(5) })]);
    db.exec(`CREATE TRIGGER test_blokkeer_frozen_gl_regel BEFORE INSERT ON begroting_frozen_gemeentelijke_lasten_regel FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'geforceerde fout frozen gl-regel'); END;`);
    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/geforceerde fout frozen gl-regel/);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
    expect(leesFrozenGemeentelijkeLastenResultaat(db, versie.id)).toBeNull();
    expect((db.prepare(`SELECT COUNT(*) AS n FROM begroting_frozen_gemeentelijke_lasten_regel`).get() as { n: number }).n).toBe(0);
  });

  it("13. WOZ-lifecycle blijft ongewijzigd: een onbevestigde WOZ-set blokkeert nog steeds, ook als de GL-regels geldig zijn", () => {
    zetMapping070();
    const versie = maakBegrotingsversie(db, VERSIE_070);
    zetBasisNeer(versie.id, [regel({ grootboekrekening: "4710" })]);
    db.prepare(
      `INSERT INTO begroting_woz_object (begroting_versie_id, complexnummer, object_type, unitnummer, aanslagjaar, waardepeildatum, werkelijke_woz, verwachte_woz_override)
       VALUES (?, '001', 'GEHEEL_COMPLEX', NULL, 2026, '2026-01-01', '1000000', NULL)`,
    ).run(versie.id);
    schrijfWozSetBevestigd(db, versie.id, false);
    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/KRITIEKE controls/);
  });
});
