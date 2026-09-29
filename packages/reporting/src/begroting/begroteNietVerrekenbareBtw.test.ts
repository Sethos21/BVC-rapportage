import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBegroteNietVerrekenbareBtw, type BgNietVerrekenbareBtwRegelInvoer } from "./begroteNietVerrekenbareBtw.js";

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
