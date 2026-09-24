import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenBegroteCanonErfpacht, type BgCanonErfpachtRegelInvoer } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { leesCanonErfpachtBeoordeeld, schrijfCanonErfpachtBeoordeeld } from "./canonErfpachtBeoordeeld.js";
import { leesCanonErfpachtRegels, schrijfCanonErfpachtRegels, type CanonErfpachtRegelInvoer } from "./canonErfpachtRegels.js";
import { openOrCreateDatabase } from "./database.js";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-canon-"));
  db = openOrCreateDatabase(join(dir, "begrotingen.sqlite"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const VERSIE_INPUT: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };

function invoer(overrides: Partial<CanonErfpachtRegelInvoer> = {}): CanonErfpachtRegelInvoer {
  return { id: null, complexnummer: "003", grootboekrekening: "4400", ogbKostensoort: null, jaarcanon: new Decimal(10000), indexPercentage: new Decimal(3), ...overrides };
}

describe("Canon-erfpacht-regels persistence", () => {
  it("1. nul regels lezen; regel schrijven en teruglezen (incl. stabiele id, OGB null)", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    expect(leesCanonErfpachtRegels(db, versie.id)).toEqual([]);
    const [regel] = schrijfCanonErfpachtRegels(db, versie.id, [invoer()]);
    expect(regel!.id).toEqual(expect.any(Number));
    expect(regel!.ogbKostensoort).toBeNull();
    expect(regel!.jaarcanon!.toString()).toBe("10000");
    expect(regel!.indexPercentage!.toString()).toBe("3");
  });

  it("2. expliciet €0 en negatieve waarden round-trippen exact", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    const regels = schrijfCanonErfpachtRegels(db, versie.id, [
      invoer({ complexnummer: "003", jaarcanon: new Decimal(0), indexPercentage: null }),
      invoer({ complexnummer: "004", jaarcanon: new Decimal("-250.75"), indexPercentage: new Decimal("-1.5") }),
    ]);
    expect(regels[0]!.jaarcanon!.isZero()).toBe(true);
    expect(regels[1]!.jaarcanon!.toString()).toBe("-250.75");
    expect(regels[1]!.indexPercentage!.toString()).toBe("-1.5");
  });

  it("3. null (niet ingevuld) blijft null en wordt nooit Decimal(0)", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    const [regel] = schrijfCanonErfpachtRegels(db, versie.id, [invoer({ jaarcanon: null, indexPercentage: null })]);
    expect(regel!.jaarcanon).toBeNull();
    expect(regel!.indexPercentage).toBeNull();
  });

  it("4. gevulde OGB round-trip; grootboek blijft leidend en ongewijzigd", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    const [regel] = schrijfCanonErfpachtRegels(db, versie.id, [invoer({ ogbKostensoort: "OGB-9", grootboekrekening: "4410" })]);
    expect(regel!.ogbKostensoort).toBe("OGB-9");
    expect(regel!.grootboekrekening).toBe("4410");
  });

  it("5. stable-ID: bewerken via id behoudt de id; weglaten verwijdert; volgorde van aanleveren verandert de koppeling niet", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    const [a, b] = schrijfCanonErfpachtRegels(db, versie.id, [invoer({ complexnummer: "A" }), invoer({ complexnummer: "B" })]);
    const na = schrijfCanonErfpachtRegels(db, versie.id, [{ ...b!, jaarcanon: new Decimal(1) }, { ...a!, jaarcanon: new Decimal(2) }]);
    const perId = new Map(na.map((r) => [r.id, [r.complexnummer, r.jaarcanon!.toString()]]));
    expect(perId.get(a!.id)).toEqual(["A", "2"]);
    expect(perId.get(b!.id)).toEqual(["B", "1"]);
    const alleenB = schrijfCanonErfpachtRegels(db, versie.id, [{ ...b! }]);
    expect(alleenB.map((r) => r.id)).toEqual([b!.id]);
  });

  it("6. onbekende id, id van andere versie en dubbele id worden geweigerd zonder mutatie", () => {
    const versieA = maakBegrotingsversie(db, VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, { ...VERSIE_INPUT, begrotingsjaar: 2028 });
    const [regelA] = schrijfCanonErfpachtRegels(db, versieA.id, [invoer()]);
    expect(() => schrijfCanonErfpachtRegels(db, versieA.id, [{ ...regelA!, id: 999999 }])).toThrow(/bestaat niet/);
    expect(() => schrijfCanonErfpachtRegels(db, versieB.id, [{ ...regelA! }])).toThrow(/behoort bij begrotingsversie/);
    expect(() => schrijfCanonErfpachtRegels(db, versieA.id, [{ ...regelA! }, { ...regelA! }])).toThrow(/meerdere keren/);
    expect(leesCanonErfpachtRegels(db, versieA.id)).toHaveLength(1);
    expect(leesCanonErfpachtRegels(db, versieB.id)).toEqual([]);
  });

  it("7. admin-bound/versie-gebonden: regels van de ene versie verschijnen niet in een andere", () => {
    const versieA = maakBegrotingsversie(db, VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, { ...VERSIE_INPUT, bedrijfsnr: "080" });
    schrijfCanonErfpachtRegels(db, versieA.id, [invoer()]);
    expect(leesCanonErfpachtRegels(db, versieB.id)).toEqual([]);
  });

  it("8. na vaststellen alleen-lezen: regels én beoordeeld-vlag zijn niet meer te wijzigen", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    schrijfCanonErfpachtRegels(db, versie.id, [invoer()]);
    schrijfCanonErfpachtBeoordeeld(db, versie.id, true);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfCanonErfpachtRegels(db, versie.id, [])).toThrow(/CONCEPT/);
    expect(() => schrijfCanonErfpachtBeoordeeld(db, versie.id, false)).toThrow(/CONCEPT/);
    expect(leesCanonErfpachtRegels(db, versie.id)).toHaveLength(1);
    expect(leesCanonErfpachtBeoordeeld(db, versie.id)).toBe(true);
  });

  it("9. beoordeeld: geen rij = false; onafhankelijk van regels; expliciet schrijfbaar", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    expect(leesCanonErfpachtBeoordeeld(db, versie.id)).toBe(false);
    schrijfCanonErfpachtRegels(db, versie.id, [invoer()]);
    expect(leesCanonErfpachtBeoordeeld(db, versie.id)).toBe(false);
    schrijfCanonErfpachtBeoordeeld(db, versie.id, true);
    expect(leesCanonErfpachtBeoordeeld(db, versie.id)).toBe(true);
    expect(() => schrijfCanonErfpachtBeoordeeld(db, "bestaat-niet", true)).toThrow(/bestaat niet/);
  });

  it("10. persistence → pure calculator: persistente regels leveren exact het verwachte begrote bedrag (roundtrip end-to-end)", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    schrijfCanonErfpachtRegels(db, versie.id, [invoer({ complexnummer: "003" }), invoer({ complexnummer: "004", jaarcanon: new Decimal(0), indexPercentage: null })]);
    const naarPure = leesCanonErfpachtRegels(db, versie.id).map(
      (r): BgCanonErfpachtRegelInvoer => ({ complexnummer: r.complexnummer, grootboekrekening: r.grootboekrekening, ogbKostensoort: r.ogbKostensoort, jaarcanon: r.jaarcanon, indexPercentage: r.indexPercentage }),
    );
    const resultaat = berekenBegroteCanonErfpacht(naarPure, { begrotingsjaar: 2027, beoordeeld: true });
    expect(resultaat.totaalJaar.toString()).toBe("10300");
    expect(resultaat.controleVereist).toEqual([]);
  });
});
