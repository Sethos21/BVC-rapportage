import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBegroteNietVerrekenbareBtw, berekenEstimatedNietVerrekenbareBtw, type BgNietVerrekenbareBtwRegelInvoer } from "./begroteNietVerrekenbareBtw.js";
import { berekenWerkelijkNietVerrekenbareBtw, type WerkelijkNietVerrekenbareBtwBoekingRegel } from "./werkelijkNietVerrekenbareBtw.js";

/** Begroting Niet verrekenbare BTW (Vervolgtranche 9 Deel B, Master Contract) — geen categorieën, module-brede beoordeeld-vlag. */

const D = (n: string | number) => new Decimal(n);
const regel = (o: Partial<BgNietVerrekenbareBtwRegelInvoer> = {}): BgNietVerrekenbareBtwRegelInvoer => ({ omschrijving: "BTW-correctie", complexnummer: null, jaarbedrag: D(1000), ...o });

describe("berekenBegroteNietVerrekenbareBtw", () => {
  it("9. één regel telt op tot moduleTotaal", () => {
    const r = berekenBegroteNietVerrekenbareBtw([regel({ jaarbedrag: D(4500) })], { begrotingsjaar: 2027, beoordeeld: true, vorigJaarWerkelijk: null });
    expect(r.moduleTotaal.toString()).toBe("4500");
    expect(r.reviewStatus).toBe("REVIEWED_WITH_RULES");
  });

  it("9. bewust €0 (beoordeeld, 0 regels) is BEKEND €0", () => {
    const r = berekenBegroteNietVerrekenbareBtw([], { begrotingsjaar: 2027, beoordeeld: true, vorigJaarWerkelijk: null });
    expect(r.moduleTotaal.toString()).toBe("0");
    expect(r.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    expect(r.controleVereist).toEqual([]);
  });

  it("niet beoordeeld -> NOT_REVIEWED (later vertaald naar ONBEKEND door de P&L-adapter)", () => {
    const r = berekenBegroteNietVerrekenbareBtw([], { begrotingsjaar: 2027, beoordeeld: false, vorigJaarWerkelijk: null });
    expect(r.reviewStatus).toBe("NOT_REVIEWED");
  });

  it("7. voorstel o.b.v. Werkelijk vorig jaar is puur informatief — wijzigt moduleTotaal niet, geen automatische pro-rata", () => {
    const r = berekenBegroteNietVerrekenbareBtw([regel({ jaarbedrag: D(500) })], { begrotingsjaar: 2027, beoordeeld: true, vorigJaarWerkelijk: D(9999) });
    expect(r.moduleTotaal.toString()).toBe("500"); // niet 9999, niet een percentage daarvan
    expect(r.vorigJaarWerkelijk!.toString()).toBe("9999");
  });

  it("10. ontbrekende historische bron (vorigJaarWerkelijk=null) blokkeert Begroting niet en is geen €0", () => {
    const r = berekenBegroteNietVerrekenbareBtw([regel({ jaarbedrag: D(200) })], { begrotingsjaar: 2027, beoordeeld: true, vorigJaarWerkelijk: null });
    expect(r.vorigJaarWerkelijk).toBeNull();
    expect(r.moduleTotaal.toString()).toBe("200");
    expect(r.controleVereist).toEqual([]);
  });

  it("8. handmatige begroting: ontbrekend jaarbedrag is KRITIEK maar telt veilig als 0", () => {
    const r = berekenBegroteNietVerrekenbareBtw([regel({ jaarbedrag: null }), regel({ jaarbedrag: D(300) })], { begrotingsjaar: 2027, beoordeeld: true, vorigJaarWerkelijk: null });
    expect(r.moduleTotaal.toString()).toBe("300");
    expect(r.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(true);
  });

  it("negatief jaarbedrag is toegestaan (bv. teruggave) — WAARSCHUWING, telt volledig mee", () => {
    const r = berekenBegroteNietVerrekenbareBtw([regel({ jaarbedrag: D(-150) })], { begrotingsjaar: 2027, beoordeeld: true, vorigJaarWerkelijk: null });
    expect(r.moduleTotaal.toString()).toBe("-150");
    expect(r.controleVereist).toEqual([{ regelIndex: 0, ernst: "WAARSCHUWING", bericht: expect.stringContaining("negatief") }]);
  });

  it("17. vastgestelde Begroting immutable is een persistence-aangelegenheid — deze pure functie muteert nooit haar eigen invoer", () => {
    const invoer = [regel({ jaarbedrag: D(100) })];
    const voor = JSON.stringify(invoer[0]!.jaarbedrag);
    berekenBegroteNietVerrekenbareBtw(invoer, { begrotingsjaar: 2027, beoordeeld: true, vorigJaarWerkelijk: null });
    expect(JSON.stringify(invoer[0]!.jaarbedrag)).toBe(voor);
  });
});

describe("berekenEstimatedNietVerrekenbareBtw (technische afsluiting Tranche 9, Master Contract §7)", () => {
  const werkelijk = (bedrag: number | string) => berekenWerkelijkNietVerrekenbareBtw([{ economischeCategorie: "NIET_VERREKENBARE_BTW", saldo: D(bedrag) }]);

  it("A. Actual + resterende verwachting bekend -> Estimated = som", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), true, D(2500));
    expect(e.estimatedTotaal!.toString()).toBe("6500");
    expect(e.werkelijkVoldoendeBekend).toBe(true);
  });

  it("B. resterende verwachting expliciet 0 -> Estimated = Actual (geen fallback, een echte som met 0)", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), true, D(0));
    expect(e.estimatedTotaal!.toString()).toBe("4000");
  });

  it("C. resterende verwachting null -> estimatedTotaal null (onbekend), nooit stilzwijgend 0 opgeteld", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), true, null);
    expect(e.estimatedTotaal).toBeNull();
    expect(e.verwachtingResterendJaar).toBeNull();
  });

  it("D. Werkelijk-dekking niet bevestigd -> estimatedTotaal null, ongeacht een bekende verwachting (geen verzonnen totaal)", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), false, D(2500));
    expect(e.estimatedTotaal).toBeNull();
    expect(e.werkelijkVoldoendeBekend).toBe(false);
  });

  it("E. Werkelijk-dekking niet bevestigd + verwachting null -> nog steeds null", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), false, null);
    expect(e.estimatedTotaal).toBeNull();
  });

  it("niet-geclassificeerde Werkelijk-boekingen maken werkelijkVoldoendeBekend false, ook met bevestigde dekking en een bekende verwachting", () => {
    const w = berekenWerkelijkNietVerrekenbareBtw([
      { economischeCategorie: "NIET_VERREKENBARE_BTW", saldo: D(4000) },
      { economischeCategorie: null, saldo: D(1) },
    ] satisfies WerkelijkNietVerrekenbareBtwBoekingRegel[]);
    const e = berekenEstimatedNietVerrekenbareBtw(w, true, D(2500));
    expect(e.werkelijkVoldoendeBekend).toBe(false);
    expect(e.estimatedTotaal).toBeNull();
  });

  it("een NaN-verwachting wordt behandeld als ongeldig -> estimatedTotaal null (nooit een NaN-som)", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), true, new Decimal(NaN));
    expect(e.estimatedTotaal).toBeNull();
  });

  it("negatieve resterende verwachting is toegestaan en telt volledig mee", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), true, D(-1000));
    expect(e.estimatedTotaal!.toString()).toBe("3000");
  });

  it("geen automatische extrapolatie/Begroting-min-Werkelijk/vorig-jaar/percentage: verwachtingResterendJaar is exact de aangeleverde waarde", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(1234.56), true, D(999.44));
    expect(e.verwachtingResterendJaar!.toString()).toBe("999.44");
    expect(e.estimatedTotaal!.toString()).toBe("2234");
  });
});
