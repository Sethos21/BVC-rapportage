import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesGemeentelijkeLastenRegels, schrijfGemeentelijkeLastenRegels, type GemeentelijkeLastenRegelInvoer } from "./gemeentelijkeLastenRegels.js";
import { leesRelevanteGemeentelijkeLastenGrootboeken } from "./gemeentelijkeLastenRelevanteGrootboeken.js";
import { voegPnLBronmappingMutatieToe, type PnLBronmappingMutatieInvoer } from "./pnlBronmappingRepository.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-gl-lasten-regels-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const VERSIE_070: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };

function regel(overrides: Partial<GemeentelijkeLastenRegelInvoer> = {}): GemeentelijkeLastenRegelInvoer {
  return { id: null, grootboekrekening: "4710", ogbKostensoort: null, jaarbedrag: new Decimal(1000), ...overrides };
}

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

describe("schrijfGemeentelijkeLastenRegels / leesGemeentelijkeLastenRegels", () => {
  it("1. nul regels lezen", () => {
    const versie = maakBegrotingsversie(db, VERSIE_070);
    expect(leesGemeentelijkeLastenRegels(db, versie.id)).toEqual([]);
  });

  it("2. meerdere regels (per GL, met en zonder OGB) round-trip; Decimal als TEXT zonder precisieverlies", () => {
    const versie = maakBegrotingsversie(db, VERSIE_070);
    schrijfGemeentelijkeLastenRegels(db, versie.id, [
      regel({ grootboekrekening: "4700", ogbKostensoort: "4701", jaarbedrag: new Decimal("1234.5678") }),
      regel({ grootboekrekening: "4710", ogbKostensoort: null, jaarbedrag: new Decimal("2000") }),
    ]);
    const ruw = db.prepare(`SELECT typeof(jaarbedrag) AS t, jaarbedrag FROM begroting_gemeentelijke_lasten_regel WHERE begroting_versie_id = ? ORDER BY id`).all(versie.id) as { t: string; jaarbedrag: string }[];
    expect(ruw.map((r) => r.t)).toEqual(["text", "text"]);
    const gelezen = leesGemeentelijkeLastenRegels(db, versie.id);
    expect(gelezen.map((r) => [r.grootboekrekening, r.ogbKostensoort, r.jaarbedrag?.toString()])).toEqual([
      ["4700", "4701", "1234.5678"],
      ["4710", null, "2000"],
    ]);
  });

  it("3. jaarbedrag null blijft null en bewust €0 blijft Decimal(0) — nooit stil omgezet", () => {
    const versie = maakBegrotingsversie(db, VERSIE_070);
    schrijfGemeentelijkeLastenRegels(db, versie.id, [regel({ grootboekrekening: "4700", jaarbedrag: null }), regel({ grootboekrekening: "4710", jaarbedrag: new Decimal(0) })]);
    const gelezen = leesGemeentelijkeLastenRegels(db, versie.id);
    expect(gelezen[0]!.jaarbedrag).toBeNull();
    expect(gelezen[1]!.jaarbedrag?.toString()).toBe("0");
  });

  it("4. complete-list save met stabiele ids: bijwerken behoudt id, weglaten verwijdert, nieuwe regel krijgt een vers id", () => {
    const versie = maakBegrotingsversie(db, VERSIE_070);
    const eerste = schrijfGemeentelijkeLastenRegels(db, versie.id, [regel({ grootboekrekening: "4700" }), regel({ grootboekrekening: "4710" })]);
    const [a, b] = eerste as [(typeof eerste)[number], (typeof eerste)[number]];

    const tweede = schrijfGemeentelijkeLastenRegels(db, versie.id, [
      { ...b, jaarbedrag: new Decimal(555) }, // b bijwerken, volgorde omgedraaid: koppeling loopt via id, niet via positie
      regel({ grootboekrekening: "4701" }), // nieuw
    ]);
    expect(tweede.map((r) => r.id)).toContain(b.id);
    expect(tweede.map((r) => r.id)).not.toContain(a.id);
    expect(tweede.find((r) => r.id === b.id)?.jaarbedrag?.toString()).toBe("555");
    expect(tweede).toHaveLength(2);
  });

  it("5. dubbele bestaande id in één save wordt geweigerd; onbekende id wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, VERSIE_070);
    const [a] = schrijfGemeentelijkeLastenRegels(db, versie.id, [regel()]) as [ReturnType<typeof leesGemeentelijkeLastenRegels>[number]];
    expect(() => schrijfGemeentelijkeLastenRegels(db, versie.id, [{ ...a }, { ...a }])).toThrow(/meerdere keren/);
    expect(() => schrijfGemeentelijkeLastenRegels(db, versie.id, [{ ...a, id: 99999 }])).toThrow(/bestaat niet/);
    expect(leesGemeentelijkeLastenRegels(db, versie.id)).toHaveLength(1); // niets gemuteerd
  });

  it("6. versie-isolatie: een regel-id van een andere begrotingsversie wordt geweigerd en niets wordt gemuteerd", () => {
    const v1 = maakBegrotingsversie(db, VERSIE_070);
    const v2 = maakBegrotingsversie(db, { ...VERSIE_070, begrotingsjaar: 2028 });
    const [vreemd] = schrijfGemeentelijkeLastenRegels(db, v1.id, [regel({ jaarbedrag: new Decimal(7) })]) as [ReturnType<typeof leesGemeentelijkeLastenRegels>[number]];
    schrijfGemeentelijkeLastenRegels(db, v2.id, [regel({ jaarbedrag: new Decimal(9) })]);
    expect(() => schrijfGemeentelijkeLastenRegels(db, v2.id, [{ ...vreemd, jaarbedrag: new Decimal(1) }])).toThrow(/behoort bij begrotingsversie/);
    expect(leesGemeentelijkeLastenRegels(db, v1.id)[0]!.jaarbedrag?.toString()).toBe("7");
    expect(leesGemeentelijkeLastenRegels(db, v2.id)[0]!.jaarbedrag?.toString()).toBe("9");
  });

  it("7. schrijven faalt op een niet-bestaande versie en op een VASTGESTELD versie (alleen CONCEPT beschrijfbaar)", () => {
    expect(() => schrijfGemeentelijkeLastenRegels(db, "bestaat-niet", [regel()])).toThrow(/bestaat niet/);
    const versie = maakBegrotingsversie(db, VERSIE_070);
    schrijfGemeentelijkeLastenRegels(db, versie.id, [regel()]);
    db.exec(`UPDATE begrotingsversies SET status = 'VASTGESTELD', vastgesteld_at = '2026-09-25T00:00:00.000Z' WHERE id = '${versie.id}'`);
    expect(() => schrijfGemeentelijkeLastenRegels(db, versie.id, [regel({ jaarbedrag: new Decimal(1) })])).toThrow(/VASTGESTELD/);
  });

  it("8. een functioneel onvolledige regel (lege GL, geen bedrag) blijft opslaanbaar: validatie hoort in de calculator, niet in de opslag", () => {
    const versie = maakBegrotingsversie(db, VERSIE_070);
    schrijfGemeentelijkeLastenRegels(db, versie.id, [regel({ grootboekrekening: "", jaarbedrag: null })]);
    expect(leesGemeentelijkeLastenRegels(db, versie.id)).toHaveLength(1);
  });

  it("9. atomair: een mislukte save (dubbele id) laat de bestaande regels ongemoeid", () => {
    const versie = maakBegrotingsversie(db, VERSIE_070);
    const [a] = schrijfGemeentelijkeLastenRegels(db, versie.id, [regel({ jaarbedrag: new Decimal(1) })]) as [ReturnType<typeof leesGemeentelijkeLastenRegels>[number]];
    expect(() => schrijfGemeentelijkeLastenRegels(db, versie.id, [{ ...a, jaarbedrag: new Decimal(2) }, { ...a, jaarbedrag: new Decimal(3) }])).toThrow();
    expect(leesGemeentelijkeLastenRegels(db, versie.id)[0]!.jaarbedrag?.toString()).toBe("1");
  });
});

describe("leesRelevanteGemeentelijkeLastenGrootboeken — gegevensgedreven per administratie uit de centrale mapping", () => {
  it("070: GL4700 (OGB4701) en GL4710 komen uit de mappingdata, met omschrijving; een andere module (verzekeringen) telt niet mee", () => {
    voegPnLBronmappingMutatieToe(db, mapping());
    voegPnLBronmappingMutatieToe(db, mapping({ grootboekrekening: "4710", grootboekOmschrijving: "Gemeentelijke heffingen", ogbKostensoort: null, ogbKostensoortOmschrijving: null }));
    voegPnLBronmappingMutatieToe(db, mapping({ grootboekrekening: "4130", grootboekOmschrijving: "Verzekering", ogbKostensoort: "4131", ogbKostensoortOmschrijving: "Brand", economischeModule: "VERZEKERINGEN", economischeCategorie: "BRAND_OPSTALVERZEKERING" }));
    const versie = maakBegrotingsversie(db, VERSIE_070);
    expect(leesRelevanteGemeentelijkeLastenGrootboeken(db, versie.id)).toEqual([
      { grootboekrekening: "4700", glDefault: false, ogbKostensoorten: ["4701"], grootboekOmschrijving: "WOZ / OZB" },
      { grootboekrekening: "4710", glDefault: true, ogbKostensoorten: [], grootboekOmschrijving: "Gemeentelijke heffingen" },
    ]);
  });

  it("de set is per administratie: een andere administratie met één GL4701 krijgt uitsluitend die GL — de 070-mapping lekt niet", () => {
    voegPnLBronmappingMutatieToe(db, mapping());
    voegPnLBronmappingMutatieToe(db, mapping({ bedrijfsnr: "003", grootboekrekening: "4701", grootboekOmschrijving: "Gemeentelijke lasten", ogbKostensoort: null, ogbKostensoortOmschrijving: null }));
    const versie003 = maakBegrotingsversie(db, { ...VERSIE_070, bedrijfsnr: "003" });
    expect(leesRelevanteGemeentelijkeLastenGrootboeken(db, versie003.id).map((g) => g.grootboekrekening)).toEqual(["4701"]);
  });

  it("administratie zonder mapping: lege lijst (geen fallback naar 070); niet-bestaande versie faalt; werkt ook op een VASTGESTELD versie", () => {
    const versie = maakBegrotingsversie(db, { ...VERSIE_070, bedrijfsnr: "999" });
    expect(leesRelevanteGemeentelijkeLastenGrootboeken(db, versie.id)).toEqual([]);
    expect(() => leesRelevanteGemeentelijkeLastenGrootboeken(db, "bestaat-niet")).toThrow(/bestaat niet/);
    voegPnLBronmappingMutatieToe(db, mapping({ bedrijfsnr: "999", grootboekrekening: "4701", ogbKostensoort: null, ogbKostensoortOmschrijving: null }));
    db.exec(`UPDATE begrotingsversies SET status = 'VASTGESTELD', vastgesteld_at = '2026-09-25T00:00:00.000Z' WHERE id = '${versie.id}'`);
    expect(leesRelevanteGemeentelijkeLastenGrootboeken(db, versie.id).map((g) => g.grootboekrekening)).toEqual(["4701"]);
  });
});

