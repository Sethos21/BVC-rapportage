import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  bepaalRelevanteVerlengmomenten,
  berekenBegroteVerzekeringen,
  berekenEstimatedVerzekeringen,
  berekenEstimatedVerzekeringenPerPolis,
  berekenResterendePremieVoorstel,
  berekenResterendePremieVoorstelPerPolis,
  berekenVerzekeringMaandverloop,
  berekenWerkelijkVerzekeringen,
  type BgVerzekeringAannames,
  type BgVerzekeringRegelInvoer,
  type WerkelijkVerzekeringBoekingRegel,
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

  it("11 (code-review-correctie A). ingangsdatum 31-01-2027, looptijd 1 maand -> elke maandultimo, geen driftende klemming", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2027, 0, 31)), 1, 2027);
    expect(momenten).toEqual([
      new Date(Date.UTC(2027, 1, 28)), // februari (geen schrikkeljaar) — geklemd op 28
      new Date(Date.UTC(2027, 2, 31)), // maart — HERSTELD naar 31, niet 28 (bewijst geen kettingdrift)
      new Date(Date.UTC(2027, 3, 30)),
      new Date(Date.UTC(2027, 4, 31)),
      new Date(Date.UTC(2027, 5, 30)),
      new Date(Date.UTC(2027, 6, 31)),
      new Date(Date.UTC(2027, 7, 31)),
      new Date(Date.UTC(2027, 8, 30)),
      new Date(Date.UTC(2027, 9, 31)),
      new Date(Date.UTC(2027, 10, 30)),
      new Date(Date.UTC(2027, 11, 31)),
    ]);
  });

  it("12 (code-review-correctie B). ingangsdatum 31-01 van een schrikkeljaar -> februari geklemd op 29, maart herstelt naar 31", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2028, 0, 31)), 1, 2028); // 2028 is een schrikkeljaar
    expect(momenten[0]).toEqual(new Date(Date.UTC(2028, 1, 29))); // februari 2028 heeft 29 dagen
    expect(momenten[1]).toEqual(new Date(Date.UTC(2028, 2, 31))); // maart herstelt naar 31, niet 29
  });

  it("13 (code-review-correctie C). een normale datum (15e van de maand) verandert niet door deze correctie", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2026, 11, 15)), 1, 2027);
    expect(momenten[0]).toEqual(new Date(Date.UTC(2027, 0, 15)));
    expect(momenten[1]).toEqual(new Date(Date.UTC(2027, 1, 15)));
    expect(momenten[11]).toEqual(new Date(Date.UTC(2027, 11, 15)));
  });

  it("14 (code-review-correctie D). bestaand voorbeeld 01-07-2020 + 12 maanden -> 01-07-2027 blijft exact gelijk", () => {
    const momenten = bepaalRelevanteVerlengmomenten(new Date(Date.UTC(2020, 6, 1)), 12, 2027);
    expect(momenten).toEqual([new Date(Date.UTC(2027, 6, 1))]);
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
      grootboekrekening: "4130",
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

describe("berekenWerkelijkVerzekeringen — FASE M7 (nieuw patroon: reeds geclassificeerde invoer, geen GL/OGB-kennis)", () => {
  function boeking(overrides: Partial<WerkelijkVerzekeringBoekingRegel> = {}): WerkelijkVerzekeringBoekingRegel {
    return { economischeCategorie: "BRAND_OPSTALVERZEKERING", complexnummer: "003", saldo: new Decimal(0), ...overrides };
  }

  it("29. geclassificeerde boekingen tellen op tot de categorieTotaal en het moduleTotaal", () => {
    const r = berekenWerkelijkVerzekeringen([boeking({ saldo: new Decimal(500) }), boeking({ saldo: new Decimal("299.99") })]);
    const cat = r.perCategorie.find((c) => c.categorie === "BRAND_OPSTALVERZEKERING")!;
    expect(cat.categorieTotaal.toString()).toBe("799.99");
    expect(r.moduleTotaal.toString()).toBe("799.99");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(0);
  });

  it("30. economischeCategorie: null (NIET_GEMAPT) wordt nooit geraden — apart gehouden, telt niet mee in een categorie", () => {
    const r = berekenWerkelijkVerzekeringen([boeking({ economischeCategorie: null, saldo: new Decimal(250) })]);
    expect(r.moduleTotaal.toString()).toBe("0");
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("250");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(1);
  });

  it("31. complexaggregatie: per complex correct opgeteld, complexnummer null apart gegroepeerd", () => {
    const r = berekenWerkelijkVerzekeringen([
      boeking({ complexnummer: "001", saldo: new Decimal(100) }),
      boeking({ complexnummer: "003", saldo: new Decimal(200) }),
      boeking({ complexnummer: "003", saldo: new Decimal(50) }),
      boeking({ complexnummer: null, saldo: new Decimal(30) }),
    ]);
    const cat = r.perCategorie.find((c) => c.categorie === "BRAND_OPSTALVERZEKERING")!;
    expect(cat.perComplex).toEqual([
      { complexnummer: null, saldo: expect.any(Decimal), aantalBoekingen: 1 },
      { complexnummer: "001", saldo: expect.any(Decimal), aantalBoekingen: 1 },
      { complexnummer: "003", saldo: expect.any(Decimal), aantalBoekingen: 2 },
    ]);
    expect(cat.perComplex.find((c) => c.complexnummer === "003")!.saldo.toString()).toBe("250");
  });

  it("32. geen dubbele telling: som(perCategorie) + nietGeclassificeerd = alle aangeleverde boekingen", () => {
    const boekingen = [boeking({ saldo: new Decimal(500) }), boeking({ economischeCategorie: null, saldo: new Decimal(100) })];
    const r = berekenWerkelijkVerzekeringen(boekingen);
    const somAlleBoekingen = boekingen.reduce((t, b) => t.plus(b.saldo), new Decimal(0));
    const somCategorieen = r.perCategorie.reduce((t, c) => t.plus(c.categorieTotaal), new Decimal(0));
    expect(somCategorieen.plus(r.nietGeclassificeerdTotaal).toString()).toBe(somAlleBoekingen.toString());
  });

  it("33. geen boekingen: alles 0, geen fouten", () => {
    const r = berekenWerkelijkVerzekeringen([]);
    expect(r.moduleTotaal.toString()).toBe("0");
    expect(r.perCategorie).toHaveLength(1);
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(0);
  });
});

describe("berekenBegroteVerzekeringen — grootboekrekening/OGB (Master Contract §6.7)", () => {
  const AANNAMES: BgVerzekeringAannames = { begrotingsjaar: 2027, beoordeeld: true };
  function regel(overrides: Partial<BgVerzekeringRegelInvoer> = {}): BgVerzekeringRegelInvoer {
    return {
      complexnummer: "001",
      verzekeraar: "Assuradeuren Gilde B.V.",
      grootboekrekening: "4130",
      ingangsdatum: new Date(Date.UTC(2020, 6, 1)),
      looptijdMaanden: 12,
      bedrag: new Decimal(12000),
      indexPercentage: new Decimal(3),
      handmatigBegrootOverride: null,
      ...overrides,
    };
  }

  it("ontbrekende grootboekrekening: KRITIEK, bedrag blijft financieel meetellen (zoals complex/verzekeraar)", () => {
    const metGl = berekenBegroteVerzekeringen([regel()], AANNAMES);
    const zonderGl = berekenBegroteVerzekeringen([regel({ grootboekrekening: "  " })], AANNAMES);
    expect(zonderGl.controleVereist.filter((c) => c.ernst === "KRITIEK" && c.bericht.includes("grootboekrekening"))).toHaveLength(1);
    expect(zonderGl.totaalEffectiefBegroot.toString()).toBe(metGl.totaalEffectiefBegroot.toString());
    expect(metGl.controleVereist.filter((c) => c.bericht.includes("grootboekrekening"))).toHaveLength(0);
  });

  it("OGB is optioneel en beïnvloedt noch validatie noch bedrag", () => {
    const zonder = berekenBegroteVerzekeringen([regel()], AANNAMES);
    const met = berekenBegroteVerzekeringen([regel({ ogbKostensoort: "4131" })], AANNAMES);
    expect(met.totaalEffectiefBegroot.toString()).toBe(zonder.totaalEffectiefBegroot.toString());
    expect(met.controleVereist).toEqual(zonder.controleVereist);
  });
});

describe("Verzekeringen — maandverloop, kwartalen en resterende-premievoorstel (Master Contract §6.7)", () => {
  const JAAR = 2027;
  function polis(overrides: Partial<BgVerzekeringRegelInvoer> = {}): BgVerzekeringRegelInvoer {
    return {
      complexnummer: "001",
      verzekeraar: "Gilde",
      grootboekrekening: "4130",
      ingangsdatum: new Date(Date.UTC(2020, 6, 1)),
      looptijdMaanden: 12,
      bedrag: new Decimal(12000),
      indexPercentage: new Decimal(3),
      handmatigBegrootOverride: null,
      ...overrides,
    };
  }

  it("maandverloop jan-dec: basis vóór, geïndexeerd vanaf de eerste verlengingsmaand (gemarkeerd); kwartalen kloppen met het jaarbedrag", () => {
    const verloop = berekenVerzekeringMaandverloop(polis(), JAAR)!;
    expect(verloop.maanden.map((m) => m.bedrag.toString())).toEqual(["1000", "1000", "1000", "1000", "1000", "1000", "1030", "1030", "1030", "1030", "1030", "1030"]);
    expect(verloop.maanden.filter((m) => m.isEersteIndexatiemaand).map((m) => m.maand)).toEqual([7]);
    expect(verloop.kwartalen.map((q) => q.toString())).toEqual(["3000", "3000", "3090", "3090"]);
    const jaar = berekenBegroteVerzekeringen([polis()], { begrotingsjaar: JAAR, beoordeeld: true }).regels[0]!.berekendBegroot;
    expect(verloop.kwartalen.reduce((a, q) => a.plus(q), new Decimal(0)).toString()).toBe(jaar.toString());
  });

  it("polis die later in het jaar start: maanden vóór de start zijn €0 (NIET_BESTAAND); polis na het jaar: alle maanden €0", () => {
    const laat = berekenVerzekeringMaandverloop(polis({ ingangsdatum: new Date(Date.UTC(2027, 3, 1)) }), JAAR)!;
    expect(laat.maanden.slice(0, 3).every((m) => m.status === "NIET_BESTAAND" && m.bedrag.isZero())).toBe(true);
    expect(laat.maanden[3]!.bedrag.toString()).toBe("1000");
    const later = berekenVerzekeringMaandverloop(polis({ ingangsdatum: new Date(Date.UTC(2028, 0, 1)) }), JAAR)!;
    expect(later.kwartalen.every((q) => q.isZero())).toBe(true);
  });

  it("onrekenbare polis zonder override geeft null (onbekend), nooit een stille €0-reeks", () => {
    expect(berekenVerzekeringMaandverloop(polis({ bedrag: null }), JAAR)).toBeNull();
  });

  it("resterende premie (voorstel) = som van voorstel-maanden over de resterende maanden; Estimated = Werkelijk + voorstel, Begroting ongewijzigd", () => {
    const regels = [polis(), polis({ complexnummer: "002", bedrag: new Decimal(6000), indexPercentage: new Decimal(0) })];
    const voorstel = berekenResterendePremieVoorstel(regels, JAAR, [7, 8, 9, 10, 11, 12]);
    expect(voorstel.voorstel!.toString()).toBe("9180"); // 6×1030 + 6×500
    const begroting = berekenBegroteVerzekeringen(regels, { begrotingsjaar: JAAR, beoordeeld: true });
    const werkelijk = berekenWerkelijkVerzekeringen([{ economischeCategorie: "BRAND_OPSTALVERZEKERING", complexnummer: "001", saldo: new Decimal(9000) }]);
    const estimated = berekenEstimatedVerzekeringen(begroting, werkelijk, true, { BRAND_OPSTALVERZEKERING: voorstel.voorstel });
    expect(estimated.moduleEstimatedTotaal!.toString()).toBe("18180");
    expect(estimated.moduleBegrotingTotaal.toString()).toBe(begroting.totaalEffectiefBegroot.toString());
  });

  it("resterende premie: één onrekenbare polis maakt het voorstel null (onbekend ≠ €0); ongeldige maandinvoer wordt geweigerd", () => {
    const r = berekenResterendePremieVoorstel([polis(), polis({ looptijdMaanden: null })], JAAR, [12]);
    expect(r.voorstel).toBeNull();
    expect(r.onrekenbareRegelIndices).toEqual([1]);
    expect(() => berekenResterendePremieVoorstel([], JAAR, [13])).toThrow(RangeError);
    expect(() => berekenResterendePremieVoorstel([], JAAR, [3, 3])).toThrow(RangeError);
    expect(berekenResterendePremieVoorstel([], JAAR, [1, 2]).voorstel!.toString()).toBe("0");
  });
});

describe("Verzekeringen — jaaroverride werkt door in maandverloop/Q1–Q4 (besluit 2026-09-25)", () => {
  const JAAR = 2027;
  function polis(overrides: Partial<BgVerzekeringRegelInvoer> = {}): BgVerzekeringRegelInvoer {
    return {
      complexnummer: "001",
      verzekeraar: "Gilde",
      grootboekrekening: "4130",
      ingangsdatum: new Date(Date.UTC(2020, 6, 1)),
      looptijdMaanden: 12,
      bedrag: new Decimal(12000),
      indexPercentage: new Decimal(3),
      handmatigBegrootOverride: null,
      ...overrides,
    };
  }
  const somMaanden = (v: { maanden: { bedrag: Decimal }[] }) => v.maanden.reduce((a, m) => a.plus(m.bedrag), new Decimal(0));
  const somKwartalen = (v: { kwartalen: Decimal[] }) => v.kwartalen.reduce((a, q) => a.plus(q), new Decimal(0));

  it("override vervangt het berekende jaarbedrag en wordt gelijk verdeeld over de 12 actieve maanden; Q1–Q4 sluiten", () => {
    const v = berekenVerzekeringMaandverloop(polis({ handmatigBegrootOverride: new Decimal(1200) }), JAAR)!;
    expect(v.bron).toBe("OVERRIDE");
    expect(v.effectiefJaarbedrag.toString()).toBe("1200");
    expect(v.maanden.every((m) => m.bedrag.toString() === "100")).toBe(true);
    expect(v.kwartalen.map((q) => q.toString())).toEqual(["300", "300", "300", "300"]);
  });

  it("override op een polis die in april start: alleen de 9 actieve maanden krijgen een bedrag, maanden vóór de start blijven €0", () => {
    const v = berekenVerzekeringMaandverloop(polis({ ingangsdatum: new Date(Date.UTC(2027, 3, 1)), handmatigBegrootOverride: new Decimal(900) }), JAAR)!;
    expect(v.maanden.slice(0, 3).every((m) => m.bedrag.isZero() && m.status === "NIET_BESTAAND")).toBe(true);
    expect(v.maanden.slice(3).every((m) => m.bedrag.toString() === "100")).toBe(true);
    expect(somMaanden(v).toString()).toBe("900");
  });

  it("SLUITEND ook bij niet-terminerende breuken: som(maanden) en som(kwartalen) zijn EXACT het effectieve jaarbedrag (override én berekend)", () => {
    const gevallen = [
      polis({ ingangsdatum: new Date(Date.UTC(2027, 5, 1)), handmatigBegrootOverride: new Decimal(100) }), // 7 actieve maanden
      polis({ handmatigBegrootOverride: new Decimal("1234.56") }),
      polis({ bedrag: new Decimal("100.10"), ingangsdatum: new Date(Date.UTC(2027, 4, 1)) }), // berekend
      polis({ bedrag: new Decimal("9999.99"), indexPercentage: new Decimal("2.7") }), // berekend, verlenging in het jaar
    ];
    for (const g of gevallen) {
      const v = berekenVerzekeringMaandverloop(g, JAAR)!;
      expect(somMaanden(v).toString()).toBe(v.effectiefJaarbedrag.toString());
      expect(somKwartalen(v).toString()).toBe(v.effectiefJaarbedrag.toString());
    }
  });

  it("het effectieve jaarbedrag van het verloop is identiek aan effectiefBegroot van de calculator", () => {
    for (const p of [polis(), polis({ handmatigBegrootOverride: new Decimal(777) }), polis({ handmatigBegrootOverride: new Decimal(0) })]) {
      const uitkomst = berekenBegroteVerzekeringen([p], { begrotingsjaar: JAAR, beoordeeld: true }).regels[0]!;
      expect(berekenVerzekeringMaandverloop(p, JAAR)!.effectiefJaarbedrag.toString()).toBe(uitkomst.effectiefBegroot.toString());
    }
  });

  it("override €0 is geldig (alle maanden €0); negatieve override wordt verdeeld en sluit ook", () => {
    const nul = berekenVerzekeringMaandverloop(polis({ handmatigBegrootOverride: new Decimal(0) }), JAAR)!;
    expect(somMaanden(nul).isZero()).toBe(true);
    const negatief = berekenVerzekeringMaandverloop(polis({ handmatigBegrootOverride: new Decimal(-1200) }), JAAR)!;
    expect(somKwartalen(negatief).toString()).toBe("-1200");
  });

  it("override werkt ook wanneer de rekenvelden onvolledig zijn, mits de ingangsdatum bekend is (actieve maanden volgen daar alleen uit)", () => {
    const v = berekenVerzekeringMaandverloop(polis({ bedrag: null, looptijdMaanden: null, handmatigBegrootOverride: new Decimal(1200) }), JAAR)!;
    expect(somMaanden(v).toString()).toBe("1200");
    expect(berekenVerzekeringMaandverloop(polis({ bedrag: null, ingangsdatum: null, handmatigBegrootOverride: new Decimal(1200) }), JAAR)).toBeNull();
  });

  it("niet-nul override op een polis zonder actieve maand dit jaar: onbekend (null), geen verzonnen verdeling; €0 blijft geldig", () => {
    const later = polis({ ingangsdatum: new Date(Date.UTC(2028, 0, 1)) });
    expect(berekenVerzekeringMaandverloop({ ...later, handmatigBegrootOverride: new Decimal(500) }, JAAR)).toBeNull();
    expect(berekenVerzekeringMaandverloop({ ...later, handmatigBegrootOverride: new Decimal(0) }, JAAR)!.effectiefJaarbedrag.isZero()).toBe(true);
  });

  it("een ongeldige (NaN) override wordt genegeerd: het berekende voorstel blijft leidend", () => {
    const v = berekenVerzekeringMaandverloop(polis({ handmatigBegrootOverride: new Decimal(NaN) }), JAAR)!;
    expect(v.bron).toBe("BEREKEND");
    expect(v.effectiefJaarbedrag.toString()).toBe("12180");
  });

  it("resterende premie volgt de override: override 1200 → resterende maanden 7–12 = 600", () => {
    const r = berekenResterendePremieVoorstelPerPolis(polis({ handmatigBegrootOverride: new Decimal(1200) }), JAAR, [7, 8, 9, 10, 11, 12]);
    expect(r!.toString()).toBe("600");
  });
});

describe("Verzekeringen — Estimated per polis (besluit 2026-09-25)", () => {
  const JAAR = 2027;
  const MAANDEN_H2 = [7, 8, 9, 10, 11, 12];
  function polis(overrides: Partial<BgVerzekeringRegelInvoer> = {}): BgVerzekeringRegelInvoer {
    return {
      complexnummer: "001",
      verzekeraar: "Gilde",
      grootboekrekening: "4130",
      ingangsdatum: new Date(Date.UTC(2020, 6, 1)),
      looptijdMaanden: 12,
      bedrag: new Decimal(12000),
      indexPercentage: new Decimal(3),
      handmatigBegrootOverride: null,
      ...overrides,
    };
  }
  const werkelijk = (bedrag: number) => berekenWerkelijkVerzekeringen([{ economischeCategorie: "BRAND_OPSTALVERZEKERING", complexnummer: "001", saldo: new Decimal(bedrag) }]);
  const begroting = (polissen: BgVerzekeringRegelInvoer[]) => berekenBegroteVerzekeringen(polissen, { begrotingsjaar: JAAR, beoordeeld: true });

  it("zonder handmatige aanpassing: effectief = automatisch voorstel; Estimated = Werkelijk (module, éénmaal) + som resterend", () => {
    const r = berekenEstimatedVerzekeringenPerPolis(begroting([polis(), polis({ complexnummer: "002", bedrag: new Decimal(6000), indexPercentage: new Decimal(0) })]), werkelijk(9000), true, [null, null], MAANDEN_H2);
    expect(r.polissen.map((p) => p.effectieveResterendeVerwachting!.toString())).toEqual(["6180", "3000"]);
    expect(r.polissen.every((p) => p.handmatigeResterendeVerwachting === null)).toBe(true);
    expect(r.resterendeVerwachtingTotaal!.toString()).toBe("9180");
    expect(r.estimated.moduleEstimatedTotaal!.toString()).toBe("18180"); // 9000 + 9180, Werkelijk niet per polis herhaald
  });

  it("handmatige aanpassing per polis vervangt alleen DIE polis; automatisch voorstel blijft zichtbaar naast de handmatige waarde", () => {
    const r = berekenEstimatedVerzekeringenPerPolis(begroting([polis(), polis({ complexnummer: "002", bedrag: new Decimal(6000), indexPercentage: new Decimal(0) })]), werkelijk(9000), true, [null, new Decimal(1000)], MAANDEN_H2);
    expect(r.polissen[1]).toMatchObject({ handmatigeResterendeVerwachting: new Decimal(1000) });
    expect(r.polissen[1]!.automatischResterendVoorstel!.toString()).toBe("3000");
    expect(r.polissen[1]!.effectieveResterendeVerwachting!.toString()).toBe("1000");
    expect(r.polissen[0]!.effectieveResterendeVerwachting!.toString()).toBe("6180");
    expect(r.estimated.moduleEstimatedTotaal!.toString()).toBe("16180");
  });

  it("expliciet €0 is een geldige handmatige verwachting en verschilt van geen aanpassing (null)", () => {
    const b = begroting([polis()]);
    const metNul = berekenEstimatedVerzekeringenPerPolis(b, werkelijk(9000), true, [new Decimal(0)], MAANDEN_H2);
    const zonder = berekenEstimatedVerzekeringenPerPolis(b, werkelijk(9000), true, [null], MAANDEN_H2);
    expect(metNul.polissen[0]!.effectieveResterendeVerwachting!.toString()).toBe("0");
    expect(zonder.polissen[0]!.effectieveResterendeVerwachting!.toString()).toBe("6180");
  });

  it("onbekend automatisch voorstel (onrekenbare polis) zonder handmatige waarde: onbekend, Estimated null; mét handmatige waarde bekend", () => {
    const b = begroting([polis({ bedrag: null })]);
    const onbekend = berekenEstimatedVerzekeringenPerPolis(b, werkelijk(9000), true, [null], MAANDEN_H2);
    expect(onbekend.polissen[0]!.effectieveResterendeVerwachting).toBeNull();
    expect(onbekend.resterendeVerwachtingTotaal).toBeNull();
    expect(onbekend.estimated.moduleEstimatedTotaal).toBeNull();
    const bekend = berekenEstimatedVerzekeringenPerPolis(b, werkelijk(9000), true, [new Decimal(500)], MAANDEN_H2);
    expect(bekend.estimated.moduleEstimatedTotaal!.toString()).toBe("9500");
  });

  it("de Begroting (effectief en berekend) blijft ongewijzigd door Estimated; een override op de Begroting werkt door in het voorstel", () => {
    const b = begroting([polis({ handmatigBegrootOverride: new Decimal(1200) })]);
    const voor = b.totaalEffectiefBegroot.toString();
    const r = berekenEstimatedVerzekeringenPerPolis(b, werkelijk(500), true, [null], MAANDEN_H2);
    expect(r.polissen[0]!.automatischResterendVoorstel!.toString()).toBe("600");
    expect(r.estimated.moduleBegrotingTotaal.toString()).toBe(voor);
    expect(b.totaalEffectiefBegroot.toString()).toBe(voor);
  });

  it("NaN handmatig: KRITIEK en genegeerd; negatief: WAARSCHUWING en telt mee; lengte-mismatch wordt geweigerd", () => {
    const b = begroting([polis(), polis({ complexnummer: "002" })]);
    const r = berekenEstimatedVerzekeringenPerPolis(b, werkelijk(0), true, [new Decimal(NaN), new Decimal(-100)], MAANDEN_H2);
    expect(r.controleVereist.map((c) => [c.regelIndex, c.ernst])).toEqual([[0, "KRITIEK"], [1, "WAARSCHUWING"]]);
    expect(r.polissen[0]!.handmatigeResterendeVerwachting).toBeNull();
    expect(r.polissen[1]!.effectieveResterendeVerwachting!.toString()).toBe("-100");
    expect(() => berekenEstimatedVerzekeringenPerPolis(b, werkelijk(0), true, [null], MAANDEN_H2)).toThrow(RangeError);
  });

  it("Werkelijk-dekking niet bevestigd: Estimated onbekend, ondanks bekende resterende verwachting", () => {
    const r = berekenEstimatedVerzekeringenPerPolis(begroting([polis()]), werkelijk(9000), false, [null], MAANDEN_H2);
    expect(r.resterendeVerwachtingTotaal).not.toBeNull();
    expect(r.estimated.moduleEstimatedTotaal).toBeNull();
  });
});
