import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBegroteCanonErfpacht, type BgCanonErfpachtRegelInvoer } from "./begroteCanonErfpacht.js";

const AANNAMES = { begrotingsjaar: 2027, beoordeeld: true };

function regel(overrides: Partial<BgCanonErfpachtRegelInvoer> = {}): BgCanonErfpachtRegelInvoer {
  return { complexnummer: "003", grootboekrekening: "4400", jaarcanon: new Decimal(10000), indexPercentage: new Decimal(3), ...overrides };
}

const kritiek = (r: ReturnType<typeof berekenBegroteCanonErfpacht>) => r.controleVereist.filter((c) => c.ernst === "KRITIEK");

describe("berekenBegroteCanonErfpacht", () => {
  it("1. begroot = jaarcanon × (1 + indexering) voor het volledige jaar", () => {
    const r = berekenBegroteCanonErfpacht([regel()], AANNAMES);
    expect(r.regels[0]!.begrootBedrag.toString()).toBe("10300");
    expect(r.totaalJaar.toString()).toBe("10300");
    expect(r.controleVereist).toEqual([]);
  });

  it("2. meerdere complexen tellen op; elk complex heeft één regel", () => {
    const r = berekenBegroteCanonErfpacht([regel({ complexnummer: "003" }), regel({ complexnummer: "004", jaarcanon: new Decimal(2000), indexPercentage: new Decimal(0) })], AANNAMES);
    expect(r.totaalJaar.toString()).toBe("12300");
  });

  it("3. expliciete jaarcanon €0 = bewust geen erfpacht: geldig, indexering niet vereist (null en aanwezig geven hetzelfde)", () => {
    for (const indexPercentage of [null, new Decimal(5)]) {
      const r = berekenBegroteCanonErfpacht([regel({ jaarcanon: new Decimal(0), indexPercentage })], AANNAMES);
      expect(r.regels[0]!.begrootBedrag.toString()).toBe("0");
      expect(r.controleVereist).toEqual([]);
    }
  });

  it("4. null jaarcanon = niet ingevuld (≠ €0): KRITIEK, veilige €0-bijdrage, blokkeert beoordeling", () => {
    const r = berekenBegroteCanonErfpacht([regel({ jaarcanon: null })], AANNAMES);
    expect(r.totaalJaar.toString()).toBe("0");
    expect(kritiek(r)).toHaveLength(1);
    expect(kritiek(r)[0]!.bericht).toContain("jaarcanon ontbreekt");
  });

  it("5. jaarcanon ≠ 0 zonder indexering: KRITIEK met veilige €0-bijdrage, nooit een geraden 0%", () => {
    const r = berekenBegroteCanonErfpacht([regel({ indexPercentage: null })], AANNAMES);
    expect(r.regels[0]!.begrootBedrag.toString()).toBe("0");
    expect(kritiek(r)[0]!.bericht).toContain("indexatiepercentage ontbreekt");
  });

  it("5b. expliciete indexering 0% is geldig (≠ niet ingevuld)", () => {
    const r = berekenBegroteCanonErfpacht([regel({ indexPercentage: new Decimal(0) })], AANNAMES);
    expect(r.regels[0]!.begrootBedrag.toString()).toBe("10000");
    expect(r.controleVereist).toEqual([]);
  });

  it("6. negatieve jaarcanon en negatieve indexering zijn geldig: telt mee, alleen WAARSCHUWING", () => {
    const r = berekenBegroteCanonErfpacht([regel({ jaarcanon: new Decimal(-1000), indexPercentage: new Decimal(-10) })], AANNAMES);
    expect(r.regels[0]!.begrootBedrag.toString()).toBe("-900");
    expect(kritiek(r)).toHaveLength(0);
    expect(r.controleVereist.filter((c) => c.ernst === "WAARSCHUWING")).toHaveLength(2);
  });

  it("7. ontbrekend verplicht veld (complex, grootboek) is KRITIEK; het bedrag blijft meetellen", () => {
    const r = berekenBegroteCanonErfpacht([regel({ complexnummer: " ", grootboekrekening: "" })], AANNAMES);
    expect(kritiek(r)).toHaveLength(2);
    expect(r.totaalJaar.toString()).toBe("10300");
  });

  it("8. OGB is optioneel en beïnvloedt validatie noch bedrag", () => {
    const zonder = berekenBegroteCanonErfpacht([regel()], AANNAMES);
    const met = berekenBegroteCanonErfpacht([regel({ ogbKostensoort: "OGB-1" })], AANNAMES);
    expect(met.totaalJaar.toString()).toBe(zonder.totaalJaar.toString());
    expect(met.controleVereist).toEqual([]);
  });

  it("9. tweede regel voor hetzelfde complex is KRITIEK (één regel per complex), bedragen blijven meetellen", () => {
    const r = berekenBegroteCanonErfpacht([regel(), regel({ jaarcanon: new Decimal(1000), indexPercentage: new Decimal(0) })], AANNAMES);
    expect(kritiek(r)).toHaveLength(1);
    expect(kritiek(r)[0]!.regelIndex).toBe(1);
    expect(r.totaalJaar.toString()).toBe("11300");
  });

  it("10. reviewStatus is pure doorgifte; geen regels + beoordeeld = bewust €0", () => {
    expect(berekenBegroteCanonErfpacht([], { begrotingsjaar: 2027, beoordeeld: false }).reviewStatus).toBe("NOT_REVIEWED");
    const bewust = berekenBegroteCanonErfpacht([], AANNAMES);
    expect(bewust.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    expect(bewust.totaalJaar.toString()).toBe("0");
    expect(berekenBegroteCanonErfpacht([regel()], AANNAMES).reviewStatus).toBe("REVIEWED_WITH_RULES");
    expect(berekenBegroteCanonErfpacht([regel({ complexnummer: "" })], AANNAMES).beoordeeld).toBe(true); // KRITIEK verandert `beoordeeld` niet
  });

  it("11. geen tussentijdse afronding in de rekenlaag (Decimal-exact)", () => {
    const r = berekenBegroteCanonErfpacht([regel({ jaarcanon: new Decimal("1234.56"), indexPercentage: new Decimal("2.5") })], AANNAMES);
    expect(r.regels[0]!.begrootBedrag.toString()).toBe("1265.424");
  });
});
