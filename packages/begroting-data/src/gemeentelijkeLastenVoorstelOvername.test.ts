import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { schrijfGemeentelijkeLastenModule, schrijfWozSetBevestigd } from "./gemeentelijkeLastenModule.js";
import { leesGemeentelijkeLastenRegels, schrijfGemeentelijkeLastenRegels } from "./gemeentelijkeLastenRegels.js";
import { VoorstelOvernameGeweigerdError, leesGemeentelijkeLastenVoorstelStatus, neemWozVoorstelOver } from "./gemeentelijkeLastenVoorstelOvername.js";
import { herberekenBegroting } from "./herberekenen.js";
import { schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Snapshot } from "./module1Snapshot.js";
import { voegPnLBronmappingMutatieToe, type PnLBronmappingMutatieInvoer } from "./pnlBronmappingRepository.js";
import { schrijfWozObjecten } from "./wozObjecten.js";

/**
 * "Voorstel overnemen" (Vervolgtranche 6 deel A): alleen bij EXACT ÉÉN relevante GL, alleen via een bewuste actie,
 * nooit een verdeling. WOZ 1.000.000 → voorstel 10.395 (zie de andere GL-tests).
 */

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-voorstel-overname-"));
  db = openOrCreateDatabase(join(dir, "begrotingen.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const VERSIE: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "003", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };

function mapping(overrides: Partial<PnLBronmappingMutatieInvoer> = {}): PnLBronmappingMutatieInvoer {
  return {
    bedrijfsnr: "003",
    grootboekrekening: "4701",
    grootboekOmschrijving: "Gemeentelijke lasten",
    ogbKostensoort: null,
    ogbKostensoortOmschrijving: null,
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

/** Administratie 003: één relevante GL (4701). */
function zetEenGlAdministratie(): void {
  voegPnLBronmappingMutatieToe(db, mapping());
}

/** Administratie 070-achtig: twee relevante GL's (4700 via OGB4701, 4710 via GL-default). */
function zetTweeGlAdministratie(bedrijfsnr: string): void {
  voegPnLBronmappingMutatieToe(db, mapping({ bedrijfsnr, grootboekrekening: "4700", ogbKostensoort: "4701", ogbKostensoortOmschrijving: "OZB" }));
  voegPnLBronmappingMutatieToe(db, mapping({ bedrijfsnr, grootboekrekening: "4710" }));
}

function maakVersie(bedrijfsnr = "003", bevestigd = true, metWoz = true): string {
  const versie = maakBegrotingsversie(db, { ...VERSIE, bedrijfsnr });
  schrijfModule1Snapshot(db, versie.id, []);
  schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
  if (metWoz) {
    schrijfWozObjecten(db, versie.id, [{ id: null, complexnummer: "001", objectType: "GEHEEL_COMPLEX", unitnummer: null, aanslagjaar: 2026, waardepeildatum: new Date(Date.UTC(2026, 0, 1)), werkelijkeWoz: new Decimal(1000000), verwachteWozOverride: null }]);
  }
  schrijfGemeentelijkeLastenModule(db, versie.id, { werkelijkeGemeentelijkeLasten: new Decimal(9000), wozStijgingPercentage: new Decimal(10), lastenPercentageStijging: new Decimal(5), begrotingsPercentageOverride: null, beoordeeld: true });
  if (metWoz) schrijfWozSetBevestigd(db, versie.id, bevestigd);
  return versie.id;
}

describe("Voorstel overnemen — exact één relevante GL", () => {
  it("1. status: mogelijk, met de controle WOZ-voorstel | begroot via GL-regels | verschil (geen regels → begroot 0, verschil −voorstel)", () => {
    zetEenGlAdministratie();
    const id = maakVersie();
    const s = leesGemeentelijkeLastenVoorstelStatus(db, id);
    expect(s).toMatchObject({ mogelijk: true, blokkade: null, doelGrootboek: "4701" });
    expect(s.controle!.wozVoorstel!.toString()).toBe("10395");
    expect(s.controle!.begrootViaGlRegels.toString()).toBe("0");
    expect(s.controle!.verschil!.toString()).toBe("-10395");
  });

  it("2. de bewuste actie zet het VOLLEDIGE voorstel als bedrag op de ene GL-regel; daarna is de controle sluitend (verschil 0, geen waarschuwing)", () => {
    zetEenGlAdministratie();
    const id = maakVersie();
    const r = neemWozVoorstelOver(db, id);
    expect(r).toMatchObject({ grootboekrekening: "4701", ogbKostensoort: null, vorigJaarbedrag: null });
    expect(r.jaarbedrag.toString()).toBe("10395");
    const regels = leesGemeentelijkeLastenRegels(db, id);
    expect(regels).toHaveLength(1);
    expect(regels[0]!.jaarbedrag!.toString()).toBe("10395");
    const gl = herberekenBegroting(db, id).gemeentelijkeLasten.grootboekRegels;
    expect(gl.begroteGemeentelijkeLastenPost.toString()).toBe("10395");
    expect(gl.wozVoorstelControle.verschil!.toString()).toBe("0");
    expect(gl.controleVereist.some((c) => c.bericht.includes("verschil"))).toBe(false);
  });

  it("3. een bestaande regel voor die GL wordt bijgewerkt (stabiel id, OGB behouden); het oude bedrag wordt teruggemeld", () => {
    zetEenGlAdministratie();
    const id = maakVersie();
    const [bestaand] = schrijfGemeentelijkeLastenRegels(db, id, [{ id: null, grootboekrekening: "4701", ogbKostensoort: "X1", jaarbedrag: new Decimal(4000) }]);
    const r = neemWozVoorstelOver(db, id);
    expect(r.regelId).toBe(bestaand!.id);
    expect(r.ogbKostensoort).toBe("X1");
    expect(r.vorigJaarbedrag!.toString()).toBe("4000");
    expect(leesGemeentelijkeLastenRegels(db, id).map((x) => [x.id, x.jaarbedrag!.toString()])).toEqual([[bestaand!.id, "10395"]]);
  });

  it("4. overnemen is bewust: herberekenen/lezen van de status schrijft nooit een regel", () => {
    zetEenGlAdministratie();
    const id = maakVersie();
    leesGemeentelijkeLastenVoorstelStatus(db, id);
    herberekenBegroting(db, id);
    expect(leesGemeentelijkeLastenRegels(db, id)).toEqual([]);
  });

  it("5. na overnemen blijft het gewoon een handmatig aanpasbare regel; een afwijking geeft weer de niet-blokkerende waarschuwing", () => {
    zetEenGlAdministratie();
    const id = maakVersie();
    neemWozVoorstelOver(db, id);
    const [regel] = leesGemeentelijkeLastenRegels(db, id);
    schrijfGemeentelijkeLastenRegels(db, id, [{ ...regel!, jaarbedrag: new Decimal(10000) }]);
    const gl = herberekenBegroting(db, id).gemeentelijkeLasten.grootboekRegels;
    expect(gl.wozVoorstelControle.verschil!.toString()).toBe("-395");
    expect(gl.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("verschil"))).toBe(true);
    expect(gl.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(false);
  });
});

describe("Voorstel overnemen — geweigerd (nooit verdelen, nooit gokken)", () => {
  it("6. meerdere relevante GL's: geen automatische verdeling — geweigerd, er wordt niets geschreven", () => {
    zetTweeGlAdministratie("070");
    const id = maakVersie("070");
    const s = leesGemeentelijkeLastenVoorstelStatus(db, id);
    expect(s).toMatchObject({ mogelijk: false, blokkade: "MEERDERE_RELEVANTE_GLS", doelGrootboek: null });
    expect(s.controle!.wozVoorstel!.toString()).toBe("10395"); // voorstel blijft zichtbaar als referentie
    expect(() => neemWozVoorstelOver(db, id)).toThrow(VoorstelOvernameGeweigerdError);
    expect(leesGemeentelijkeLastenRegels(db, id)).toEqual([]);
  });

  it("7. de blokkade draagt een stabiele code (voor een UI) en de fout een leesbare reden", () => {
    zetTweeGlAdministratie("070");
    const id = maakVersie("070");
    try {
      neemWozVoorstelOver(db, id);
      throw new Error("had moeten falen");
    } catch (e) {
      expect(e).toBeInstanceOf(VoorstelOvernameGeweigerdError);
      expect((e as VoorstelOvernameGeweigerdError).blokkade).toBe("MEERDERE_RELEVANTE_GLS");
      expect((e as Error).message).toContain("4700");
    }
  });

  it("8. onbevestigde WOZ-set: geen voorstel, dus geen overname", () => {
    zetEenGlAdministratie();
    const id = maakVersie("003", false);
    expect(leesGemeentelijkeLastenVoorstelStatus(db, id)).toMatchObject({ mogelijk: false, blokkade: "WOZ_SET_NIET_BEVESTIGD" });
    expect(() => neemWozVoorstelOver(db, id)).toThrow(/WOZ_SET_NIET_BEVESTIGD/);
  });

  it("9. geen WOZ-objecten (bewuste-€0-pad): niets over te nemen", () => {
    zetEenGlAdministratie();
    const id = maakVersie("003", true, false);
    expect(leesGemeentelijkeLastenVoorstelStatus(db, id)).toMatchObject({ mogelijk: false, blokkade: "GEEN_WOZ_OBJECTEN" });
  });

  it("10. administratie zonder relevante GL in de mapping: geen overname en geen 070-fallback", () => {
    zetTweeGlAdministratie("070");
    const id = maakVersie("999");
    expect(leesGemeentelijkeLastenVoorstelStatus(db, id)).toMatchObject({ mogelijk: false, blokkade: "GEEN_RELEVANTE_GL" });
  });

  it("11. een voorstel op ontbrekende aannames (kritieke WOZ-controle) wordt niet overgenomen — anders zou een veilige 0 als voorstel gelden", () => {
    zetEenGlAdministratie();
    const id = maakVersie();
    schrijfGemeentelijkeLastenModule(db, id, { werkelijkeGemeentelijkeLasten: null, wozStijgingPercentage: new Decimal(10), lastenPercentageStijging: new Decimal(5), begrotingsPercentageOverride: null, beoordeeld: true });
    expect(leesGemeentelijkeLastenVoorstelStatus(db, id)).toMatchObject({ mogelijk: false, blokkade: "VOORSTEL_ONBETROUWBAAR" });
    expect(() => neemWozVoorstelOver(db, id)).toThrow(/VOORSTEL_ONBETROUWBAAR/);
  });

  it("12. bestaande regels die niet eenduidig te vervangen zijn (andere GL of meerdere regels) worden nooit stil overschreven", () => {
    zetEenGlAdministratie();
    const id = maakVersie();
    schrijfGemeentelijkeLastenRegels(db, id, [{ id: null, grootboekrekening: "4701", ogbKostensoort: "A", jaarbedrag: new Decimal(1) }, { id: null, grootboekrekening: "4701", ogbKostensoort: "B", jaarbedrag: new Decimal(2) }]);
    expect(leesGemeentelijkeLastenVoorstelStatus(db, id)).toMatchObject({ mogelijk: false, blokkade: "BESTAANDE_REGELS_TEGENSTRIJDIG" });
    expect(leesGemeentelijkeLastenRegels(db, id)).toHaveLength(2);
  });

  it("13. een VASTGESTELDE versie is alleen-lezen: geen overname; de status meldt dat zonder te herberekenen", () => {
    zetEenGlAdministratie();
    const id = maakVersie();
    db.exec(`UPDATE begrotingsversies SET status = 'VASTGESTELD', vastgesteld_at = '2026-09-25T00:00:00.000Z' WHERE id = '${id}'`);
    expect(leesGemeentelijkeLastenVoorstelStatus(db, id)).toMatchObject({ mogelijk: false, blokkade: "VERSIE_NIET_CONCEPT", controle: null });
    expect(() => neemWozVoorstelOver(db, id)).toThrow(VoorstelOvernameGeweigerdError);
  });

  it("14. niet-bestaande versie faalt duidelijk", () => {
    expect(() => leesGemeentelijkeLastenVoorstelStatus(db, "bestaat-niet")).toThrow(/bestaat niet/);
  });
});
