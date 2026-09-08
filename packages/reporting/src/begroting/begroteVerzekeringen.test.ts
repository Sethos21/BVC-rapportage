import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  bepaalRelevanteVerlengmomenten,
  berekenBegroteVerzekeringen,
  type BgVerzekeringAannames,
  type BgVerzekeringRegelInvoer,
} from "./begroteVerzekeringen.js";

describe("bepaalRelevanteVerlengmomenten — geïsoleerde datumlogica", () => {
  it("1. bestaande polis, ingangsdatum ruim vóór begrotingsjaar, looptijd 12 -> exact één verlengmoment in het begrotingsjaar", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2020, 6, 1)), 12, 2027);
    expect(momenten).toHaveLength(1);
    expect(momenten[0]).toEqual(new Date(Date.UTC(2027, 6, 1)));
  });

  it("2. ingangsdatum zelf wordt nooit als verlengmoment meegeteld", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2027, 6, 1)), 12, 2027);
    // occurrence(0) = ingangsdatum + 12mnd = 2028-07-01, dus geen enkel moment in 2027 zelf.
    expect(momenten).toEqual([]);
  });

  it("3. meerjarige looptijd die het begrotingsjaar volledig overslaat -> geen verlengmoment", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2020, 6, 1)), 24, 2027);
    expect(momenten).toEqual([]);
  });

  it("4. korte looptijd (6 maanden) -> twee verlengmomenten binnen hetzelfde begrotingsjaar", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2026, 0, 1)), 6, 2027);
    expect(momenten).toEqual([new Date(Date.UTC(2027, 0, 1)), new Date(Date.UTC(2027, 6, 1))]);
  });

  it("5. zeer korte looptijd (1 maand) -> twaalf verlengmomenten binnen het begrotingsjaar", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2026, 11, 15)), 1, 2027);
    expect(momenten).toHaveLength(12);
    expect(momenten[0]).toEqual(new Date(Date.UTC(2027, 0, 15)));
    expect(momenten[11]).toEqual(new Date(Date.UTC(2027, 11, 15)));
  });

  it("6. niet-deelbare looptijd (13 maanden) landt via meerdere jaren toch correct in het begrotingsjaar", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2020, 0, 1)), 13, 2027);
    expect(momenten).toHaveLength(1);
    expect(momenten[0]?.getUTCFullYear()).toBe(2027);
  });

  it("7. ingangsdatum ná het begrotingsjaar -> geen verlengmoment (polis bestaat nog niet)", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2029, 0, 1)), 12, 2027);
    expect(momenten).toEqual([]);
  });

  it("8. dag-klemming: 31 januari + 1 maand -> laatste dag van februari, nooit doorlopend naar maart", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2026, 11, 31)), 1, 2027);
    // occurrence(0) = 2026-12-31 + 1mnd -> januari 2027 heeft 31 dagen, dus geen klemming nodig hier;
    // occurrence(1) = 2027-01-31 + 1mnd -> februari 2027 heeft 28 dagen -> geklemd op 28.
    expect(momenten[0]).toEqual(new Date(Date.UTC(2027, 0, 31)));
    expect(momenten[1]).toEqual(new Date(Date.UTC(2027, 1, 28)));
  });

  it("9. ingangsdatum exact op 1 januari van het begrotingsjaar (grensgeval) telt mee zodra een verlenging daar exact op landt", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2026, 0, 1)), 12, 2027);
    expect(momenten).toEqual([new Date(Date.UTC(2027, 0, 1))]);
  });

  it("10. ingangsdatum exact op 31 december van het begrotingsjaar (grensgeval)", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2026, 11, 31)), 12, 2027);
    expect(momenten).toEqual([new Date(Date.UTC(2027, 11, 31))]);
  });
});

describe("berekenBegroteVerzekeringen", () => {
  const AANNAMES: BgVerzekeringAannames = { begrotingsjaar: 2027, beoordeeld: true };

  function regel(overrides: Partial<BgVerzekeringRegelInvoer> = {}): BgVerzekeringRegelInvoer {
    return {
      complexnummer: "001",
      verzekeraar: "Assuradeuren Gilde B.V.",
      ingangsdatum: new Date(Date.UTC(2020, 6, 1)),
      looptijdMaanden: 12,
      bedrag: new Decimal(12000),
      indexPercentage: new Decimal(3),
      handmatigBegrootOverride: null,
      ...overrides,
    };
  }

  it("1. nul regels + beoordeeld=false -> NOT_REVIEWED, totalen 0", () => {
    const r = berekenBegroteVerzekeringen([], { ...AANNAMES, beoordeeld: false });
    expect(r.reviewStatus).toBe("NOT_REVIEWED");
    expect(r.totaalBerekendBegroot.toString()).toBe("0");
    expect(r.totaalEffectiefBegroot.toString()).toBe("0");
    expect(r.controleVereist).toHaveLength(0);
  });

  it("2. nul regels + beoordeeld=true -> REVIEWED_ZERO_POLICIES", () => {
    const r = berekenBegroteVerzekeringen([], AANNAMES);
    expect(r.reviewStatus).toBe("REVIEWED_ZERO_POLICIES");
    expect(r.controleVereist).toHaveLength(0);
  });

  it("3. beoordeeld=true + 1 regel -> REVIEWED_WITH_POLICIES", () => {
    const r = berekenBegroteVerzekeringen([regel()], AANNAMES);
    expect(r.reviewStatus).toBe("REVIEWED_WITH_POLICIES");
  });

  describe("regime A — bestaande polis (ingangsdatum vóór begrotingsjaar)", () => {
    it("4. exact rekenvoorbeeld: €12.000, index 3%, verlenging 01-07-2027 -> €12.180", () => {
      const r = berekenBegroteVerzekeringen(
        [regel({ ingangsdatum: new Date(Date.UTC(2020, 6, 1)), looptijdMaanden: 12, bedrag: new Decimal(12000), indexPercentage: new Decimal(3) })],
        AANNAMES,
      );
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("12180");
      expect(r.regels[0]?.eersteRelevanteVerlengmoment).toEqual(new Date(Date.UTC(2027, 6, 1)));
      expect(r.regels[0]?.relevanteVerlengmomenten).toEqual([new Date(Date.UTC(2027, 6, 1))]);
      expect(r.totaalBerekendBegroot.toString()).toBe("12180");
    });

    it("5. meerjarige polis zonder verlenging dit jaar -> bedrag ongewijzigd, geen indexatie", () => {
      const r = berekenBegroteVerzekeringen(
        [regel({ ingangsdatum: new Date(Date.UTC(2026, 6, 1)), looptijdMaanden: 24, bedrag: new Decimal(12000), indexPercentage: new Decimal(3) })],
        AANNAMES,
      );
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("12000");
      expect(r.regels[0]?.relevanteVerlengmomenten).toEqual([]);
    });

    it("6. meerdere verlengmomenten binnen het jaar -> index toegepast vanaf het EERSTE moment, geen cumulatieve tweede toepassing", () => {
      // looptijd 6 maanden, ingangsdatum 01-01-2026 -> verlengmomenten 01-01-2027 en 01-07-2027 binnen 2027.
      // Eerste verlengmoment valt al in januari -> de volledige 12 maanden zijn geïndexeerd, het tweede moment (juli) heeft geen extra effect.
      const r = berekenBegroteVerzekeringen(
        [regel({ ingangsdatum: new Date(Date.UTC(2026, 0, 1)), looptijdMaanden: 6, bedrag: new Decimal(12000), indexPercentage: new Decimal(3) })],
        AANNAMES,
      );
      expect(r.regels[0]?.relevanteVerlengmomenten).toHaveLength(2);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("12360"); // 12000 * 1.03, niet 12000 * 1.03^2
    });
  });

  describe("regime B — nieuwe polis (ingangsdatum tijdens begrotingsjaar) — Correctie 1", () => {
    it("7. exact rekenvoorbeeld: ingangsdatum 01-07-2027, bedrag €12.000, index 3% -> €6.000, geen indexatie op de eerste ingang", () => {
      const r = berekenBegroteVerzekeringen(
        [regel({ ingangsdatum: new Date(Date.UTC(2027, 6, 1)), looptijdMaanden: 12, bedrag: new Decimal(12000), indexPercentage: new Decimal(3) })],
        AANNAMES,
      );
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("6000");
      expect(r.regels[0]?.eersteRelevanteVerlengmoment).toBeNull();
      expect(r.regels[0]?.relevanteVerlengmomenten).toEqual([]);
    });

    it("8. ingangsdatum is zelf geen verlengmoment, ook niet bij korte looptijd die in hetzelfde jaar terugkomt", () => {
      // ingangsdatum 01-02-2027, looptijd 3 maanden -> verlengmomenten binnen 2027: 01-05, 01-08, 01-11 (ingangsdatum zelf niet meegeteld).
      const r = berekenBegroteVerzekeringen(
        [regel({ ingangsdatum: new Date(Date.UTC(2027, 1, 1)), looptijdMaanden: 3, bedrag: new Decimal(1200), indexPercentage: new Decimal(10) })],
        AANNAMES,
      );
      expect(r.regels[0]?.relevanteVerlengmomenten).toEqual([
        new Date(Date.UTC(2027, 4, 1)),
        new Date(Date.UTC(2027, 7, 1)),
        new Date(Date.UTC(2027, 10, 1)),
      ]);
      // jan: 0 (vóór ingang); feb-apr: 3 x 100 (bedrag/12, niet geïndexeerd) = 300; mei-dec: 8 x 110 (geïndexeerd vanaf eerste verlenging mei) = 880.
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("1180");
    });
  });

  describe("regime C — toekomstige polis (ingangsdatum ná begrotingsjaar)", () => {
    it("9. berekendBegroot is €0, GEEN KRITIEK uitsluitend vanwege de toekomstige ingangsdatum", () => {
      const r = berekenBegroteVerzekeringen(
        [regel({ ingangsdatum: new Date(Date.UTC(2029, 0, 1)), looptijdMaanden: 12, bedrag: new Decimal(12000), indexPercentage: new Decimal(3) })],
        AANNAMES,
      );
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("0");
      expect(r.controleVereist).toHaveLength(0);
    });
  });

  describe("validatie — rekenkritische velden", () => {
    it("10. ontbrekend complexnummer: KRITIEK, bedrag blijft financieel meetellen", () => {
      const r = berekenBegroteVerzekeringen([regel({ complexnummer: null })], AANNAMES);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("12180");
      expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("complexnummer"))).toBe(true);
    });

    it("11. ontbrekende verzekeraar: KRITIEK, bedrag blijft financieel meetellen", () => {
      const r = berekenBegroteVerzekeringen([regel({ verzekeraar: null })], AANNAMES);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("12180");
      expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("verzekeraar"))).toBe(true);
    });

    it("12. ontbrekende ingangsdatum: KRITIEK, veilige bijdrage 0", () => {
      const r = berekenBegroteVerzekeringen([regel({ ingangsdatum: null })], AANNAMES);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("0");
      expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("ingangsdatum"))).toBe(true);
    });

    it("13. ongeldige ingangsdatum (Invalid Date): KRITIEK, veilige bijdrage 0", () => {
      const r = berekenBegroteVerzekeringen([regel({ ingangsdatum: new Date(NaN) })], AANNAMES);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("0");
      expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("ingangsdatum"))).toBe(true);
    });

    it("14. ontbrekende looptijdMaanden: KRITIEK, veilige bijdrage 0", () => {
      const r = berekenBegroteVerzekeringen([regel({ looptijdMaanden: null })], AANNAMES);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("0");
      expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("looptijdMaanden"))).toBe(true);
    });

    it("15. looptijdMaanden <= 0: KRITIEK, veilige bijdrage 0", () => {
      const r = berekenBegroteVerzekeringen([regel({ looptijdMaanden: 0 })], AANNAMES);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("0");
      expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("looptijdMaanden"))).toBe(true);
    });

    it("16. niet-geheel looptijdMaanden: KRITIEK, veilige bijdrage 0", () => {
      const r = berekenBegroteVerzekeringen([regel({ looptijdMaanden: 6.5 })], AANNAMES);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("0");
      expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("looptijdMaanden"))).toBe(true);
    });

    it("17. ontbrekend bedrag: KRITIEK, veilige bijdrage 0", () => {
      const r = berekenBegroteVerzekeringen([regel({ bedrag: null })], AANNAMES);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("0");
      expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("bedrag"))).toBe(true);
    });

    it("18. NaN bedrag: KRITIEK, veilige bijdrage 0", () => {
      const r = berekenBegroteVerzekeringen([regel({ bedrag: new Decimal(NaN) })], AANNAMES);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("0");
      expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("bedrag"))).toBe(true);
    });

    it("19. negatief bedrag: WAARSCHUWING, telt volledig (negatief) mee", () => {
      const r = berekenBegroteVerzekeringen(
        [regel({ ingangsdatum: new Date(Date.UTC(2026, 6, 1)), looptijdMaanden: 24, bedrag: new Decimal(-1200), indexPercentage: new Decimal(0) })],
        AANNAMES,
      );
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("-1200");
      expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("bedrag"))).toBe(true);
    });

    it("20. ontbrekend indexPercentage: KRITIEK, veilige bijdrage 0", () => {
      const r = berekenBegroteVerzekeringen([regel({ indexPercentage: null })], AANNAMES);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("0");
      expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("indexPercentage"))).toBe(true);
    });

    it("21. bewust 0% index is geldig, geen control", () => {
      const r = berekenBegroteVerzekeringen(
        [regel({ ingangsdatum: new Date(Date.UTC(2020, 6, 1)), looptijdMaanden: 12, bedrag: new Decimal(12000), indexPercentage: new Decimal(0) })],
        AANNAMES,
      );
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("12000");
      expect(r.controleVereist).toHaveLength(0);
    });

    it("22. negatieve index: WAARSCHUWING, telt volledig mee", () => {
      const r = berekenBegroteVerzekeringen(
        [regel({ ingangsdatum: new Date(Date.UTC(2020, 6, 1)), looptijdMaanden: 12, bedrag: new Decimal(12000), indexPercentage: new Decimal(-5) })],
        AANNAMES,
      );
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("11700"); // 12000*0.95 vanaf juli: 6x1000 + 6x950
      expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("indexPercentage"))).toBe(true);
    });

    it("23. NaN override: KRITIEK, override genegeerd, effectiefBegroot = berekendBegroot", () => {
      const r = berekenBegroteVerzekeringen([regel({ handmatigBegrootOverride: new Decimal(NaN) })], AANNAMES);
      expect(r.regels[0]?.effectiefBegroot.toString()).toBe(r.regels[0]?.berekendBegroot.toString());
      expect(r.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.toLowerCase().includes("override"))).toBe(true);
    });

    it("24. negatieve override: WAARSCHUWING, effectiefBegroot wordt het negatieve bedrag", () => {
      const r = berekenBegroteVerzekeringen([regel({ handmatigBegrootOverride: new Decimal(-500) })], AANNAMES);
      expect(r.regels[0]?.effectiefBegroot.toString()).toBe("-500");
      expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.toLowerCase().includes("override"))).toBe(true);
    });
  });

  describe("override-traceerbaarheid (OB032-008)", () => {
    it("25. expliciete €0-override is geldig en wint van een positieve berekening", () => {
      const r = berekenBegroteVerzekeringen([regel({ handmatigBegrootOverride: new Decimal(0) })], AANNAMES);
      expect(r.regels[0]?.berekendBegroot.toString()).toBe("12180");
      expect(r.regels[0]?.effectiefBegroot.toString()).toBe("0");
    });

    it("26. geen override (null) -> effectiefBegroot volgt berekendBegroot exact", () => {
      const r = berekenBegroteVerzekeringen([regel()], AANNAMES);
      expect(r.regels[0]?.effectiefBegroot.toString()).toBe(r.regels[0]?.berekendBegroot.toString());
    });

    it("27. totaalBerekendBegroot en totaalEffectiefBegroot kunnen uiteenlopen bij een actieve override", () => {
      const r = berekenBegroteVerzekeringen([regel({ handmatigBegrootOverride: new Decimal(9999) })], AANNAMES);
      expect(r.totaalBerekendBegroot.toString()).toBe("12180");
      expect(r.totaalEffectiefBegroot.toString()).toBe("9999");
    });
  });

  it("28. Decimal-exactheid: geen drijvendekomma-afronding bij optelling van meerdere regels", () => {
    const r = berekenBegroteVerzekeringen(
      [
        regel({ bedrag: new Decimal("100.10"), ingangsdatum: new Date(Date.UTC(2026, 6, 1)), looptijdMaanden: 24, indexPercentage: new Decimal(0) }),
        regel({ bedrag: new Decimal("200.20"), ingangsdatum: new Date(Date.UTC(2026, 6, 1)), looptijdMaanden: 24, indexPercentage: new Decimal(0) }),
      ],
      AANNAMES,
    );
    expect(r.totaalBerekendBegroot.toString()).toBe("300.3");
  });
});
