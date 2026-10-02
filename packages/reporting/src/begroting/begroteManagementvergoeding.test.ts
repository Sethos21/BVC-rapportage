import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenBegroteManagementvergoeding,
  type BgManagementIndexeerBestaandInvoer,
  type BgManagementNieuweVergoedingInvoer,
  type BgManagementWijzigBestaandBedragInvoer,
} from "./begroteManagementvergoeding.js";

const BEGROTINGSJAAR = 2027;

function indexeer(overrides: Partial<BgManagementIndexeerBestaandInvoer> = {}): BgManagementIndexeerBestaandInvoer {
  return {
    wijze: "INDEXEER_BESTAAND",
    bestaandBedrag: new Decimal(1000),
    eenheid: "MAAND",
    indexatiePercentage: new Decimal(3),
    indexatiedatum: new Date(Date.UTC(BEGROTINGSJAAR, 6, 1)), // 1 juli
    ...overrides,
  };
}

function wijzig(overrides: Partial<BgManagementWijzigBestaandBedragInvoer> = {}): BgManagementWijzigBestaandBedragInvoer {
  return {
    wijze: "WIJZIG_BESTAAND_BEDRAG",
    bestaandBedrag: new Decimal(1000),
    bestaandEenheid: "MAAND",
    nieuwBedrag: new Decimal(1200),
    nieuweEenheid: "MAAND",
    ingangsdatum: new Date(Date.UTC(BEGROTINGSJAAR, 6, 1)), // 1 juli
    ...overrides,
  };
}

function nieuweVergoeding(overrides: Partial<BgManagementNieuweVergoedingInvoer> = {}): BgManagementNieuweVergoedingInvoer {
  return {
    wijze: "NIEUWE_VERGOEDING",
    bedrag: new Decimal(1200),
    eenheid: "MAAND",
    ingangsdatum: new Date(Date.UTC(BEGROTINGSJAAR, 6, 1)), // 1 juli
    ...overrides,
  };
}

// ── A. INDEXEER_BESTAAND ────────────────────────────────────────────────

describe("berekenBegroteManagementvergoeding — INDEXEER_BESTAAND", () => {
  it("bestaand bedrag blijft gelden vóór de indexatiedatum, geïndexeerd bedrag vanaf de indexatiemaand", () => {
    const resultaat = berekenBegroteManagementvergoeding(indexeer(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.effectieveIndexatiedatum).not.toBeNull();
    for (let i = 0; i < 6; i += 1) {
      expect(resultaat.regels[i]!.bedrag.toString()).toBe("1000"); // jan-jun
      expect(resultaat.regels[i]!.effect.toString()).toBe("0");
    }
    for (let i = 6; i < 12; i += 1) {
      expect(resultaat.regels[i]!.bedrag.toString()).toBe("1030"); // jul-dec, +3%
      expect(resultaat.regels[i]!.effect.toString()).toBe("30");
    }
    expect(resultaat.jaartotaal.bedrag.toString()).toBe("12180"); // 6×1000 + 6×1030
  });

  it("indexatiedatum vóór begrotingsjaar — geen projectie, geen indexatie toegepast", () => {
    const resultaat = berekenBegroteManagementvergoeding(indexeer({ indexatiedatum: new Date(Date.UTC(BEGROTINGSJAAR - 1, 6, 1)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    expect(resultaat.effectieveIndexatiedatum).toBeNull();
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("buiten begrotingsjaar"))).toBe(true);
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("1000");
  });

  it("indexatiedatum ná begrotingsjaar — geen indexatie toegepast", () => {
    const resultaat = berekenBegroteManagementvergoeding(indexeer({ indexatiedatum: new Date(Date.UTC(BEGROTINGSJAAR + 1, 6, 1)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    expect(resultaat.effectieveIndexatiedatum).toBeNull();
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("1000");
  });

  it("expliciet bestaand bedrag €0 blijft valide (werkelijk nul, geen KRITIEK)", () => {
    const resultaat = berekenBegroteManagementvergoeding(indexeer({ bestaandBedrag: new Decimal(0) }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(false);
    expect(resultaat.bestaandBedrag?.maand.toString()).toBe("0");
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("0");
  });

  it("negatief bestaand bedrag wordt afgewezen (KRITIEK), alle maandbedragen 0, en NIET als geldig bedrag geëchood (onbekend/ongeldig ≠ 0)", () => {
    const resultaat = berekenBegroteManagementvergoeding(indexeer({ bestaandBedrag: new Decimal(-100) }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(true);
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("0");
    expect(resultaat.bestaandBedrag).toBeNull(); // afgewezen bedrag wordt NIET alsnog getoond als een geldige waarde
  });

  it("indexatiedatum exact 1 januari van begrotingsjaar — geïndexeerd bedrag geldt vanaf januari (volledig jaar)", () => {
    const resultaat = berekenBegroteManagementvergoeding(indexeer({ indexatiedatum: new Date(Date.UTC(BEGROTINGSJAAR, 0, 1)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    expect(resultaat.effectieveIndexatiedatum).not.toBeNull();
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("1030");
    expect(resultaat.jaartotaal.bedrag.toString()).toBe("12360");
  });

  it("indexatiedatum exact 31 december van begrotingsjaar — de dag wordt genegeerd, geïndexeerd bedrag geldt alleen voor december", () => {
    const resultaat = berekenBegroteManagementvergoeding(indexeer({ indexatiedatum: new Date(Date.UTC(BEGROTINGSJAAR, 11, 31)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    expect(resultaat.effectieveIndexatiedatum).not.toBeNull();
    for (let i = 0; i < 11; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("1000"); // jan-nov
    expect(resultaat.regels[11]!.bedrag.toString()).toBe("1030"); // december
  });

  it("negatief indexatiepercentage is toegestaan (bestaand precedent Module 2: tarief mag dalen)", () => {
    const resultaat = berekenBegroteManagementvergoeding(indexeer({ indexatiePercentage: new Decimal(-10) }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(false);
    expect(resultaat.regels[6]!.bedrag.toString()).toBe("900"); // 1000 - 10%
  });

  it("ongeldig indexatiepercentage (NaN) — KRITIEK, geen indexatie toegepast", () => {
    const resultaat = berekenBegroteManagementvergoeding(indexeer({ indexatiePercentage: new Decimal(NaN) }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("indexatiePercentage"))).toBe(true);
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("1000");
  });

  it("ongeldige indexatiedatum (Invalid Date) — KRITIEK, geen indexatie toegepast", () => {
    const resultaat = berekenBegroteManagementvergoeding(indexeer({ indexatiedatum: new Date(Number.NaN) }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("indexatiedatum"))).toBe(true);
  });
});

// ── B. WIJZIG_BESTAAND_BEDRAG ───────────────────────────────────────────

describe("berekenBegroteManagementvergoeding — WIJZIG_BESTAAND_BEDRAG", () => {
  it("bestaand €1.000/mnd, nieuw €1.200/mnd vanaf 1 juli — jan-jun exact €1.000, jul-dec exact €1.200, jaartotaal €13.200", () => {
    const resultaat = berekenBegroteManagementvergoeding(wijzig(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.effectieveIngangsdatum).not.toBeNull();
    for (let i = 0; i < 6; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("1000");
    for (let i = 6; i < 12; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("1200");
    expect(resultaat.jaartotaal.bedrag.toString()).toBe("13200");
  });

  it("ingangsdatum vóór begrotingsjaar — al gewijzigd, nieuw bedrag geldt de volle 12 maanden", () => {
    const resultaat = berekenBegroteManagementvergoeding(wijzig({ ingangsdatum: new Date(Date.UTC(BEGROTINGSJAAR - 1, 5, 1)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("1200");
    expect(resultaat.jaartotaal.bedrag.toString()).toBe("14400");
  });

  it("ingangsdatum ná begrotingsjaar — nog niet gewijzigd, bestaand bedrag blijft de volle 12 maanden gelden", () => {
    const resultaat = berekenBegroteManagementvergoeding(wijzig({ ingangsdatum: new Date(Date.UTC(BEGROTINGSJAAR + 1, 0, 1)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("1000");
    expect(resultaat.jaartotaal.bedrag.toString()).toBe("12000");
    expect(resultaat.controleVereist.some((c) => c.ernst === "INFORMATIEF")).toBe(true);
  });

  it("bestaand bedrag €0 (werkelijk bevestigd nul, geen 'onbekend') — nieuw bedrag telt vanaf ingangsmaand", () => {
    const resultaat = berekenBegroteManagementvergoeding(wijzig({ bestaandBedrag: new Decimal(0) }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(false);
    for (let i = 0; i < 6; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("0");
    for (let i = 6; i < 12; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("1200");
  });

  it("nieuw bedrag €0 — vergoeding wordt vanaf ingangsmaand afgebouwd naar nul", () => {
    const resultaat = berekenBegroteManagementvergoeding(wijzig({ nieuwBedrag: new Decimal(0) }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(false);
    for (let i = 0; i < 6; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("1000");
    for (let i = 6; i < 12; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("0");
  });

  it("negatief bestaand bedrag wordt afgewezen (KRITIEK), alle maandbedragen 0, niet als geldig bedrag geëchood", () => {
    const resultaat = berekenBegroteManagementvergoeding(wijzig({ bestaandBedrag: new Decimal(-1) }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(true);
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("0");
    expect(resultaat.bestaandBedrag).toBeNull();
  });

  it("negatief nieuw bedrag wordt afgewezen (KRITIEK), alle maandbedragen 0, niet als geldig bedrag geëchood", () => {
    const resultaat = berekenBegroteManagementvergoeding(wijzig({ nieuwBedrag: new Decimal(-1) }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(true);
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("0");
    expect(resultaat.nieuwBedrag).toBeNull();
  });

  it("ingangsdatum exact 1 januari — nieuw bedrag geldt vanaf januari (volledig jaar)", () => {
    const resultaat = berekenBegroteManagementvergoeding(wijzig({ ingangsdatum: new Date(Date.UTC(BEGROTINGSJAAR, 0, 1)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("1200");
    expect(resultaat.jaartotaal.bedrag.toString()).toBe("14400");
  });

  it("ingangsdatum exact 31 december — de dag wordt genegeerd, nieuw bedrag alleen in december", () => {
    const resultaat = berekenBegroteManagementvergoeding(wijzig({ ingangsdatum: new Date(Date.UTC(BEGROTINGSJAAR, 11, 31)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    for (let i = 0; i < 11; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("1000"); // jan-nov
    expect(resultaat.regels[11]!.bedrag.toString()).toBe("1200"); // december
  });

  it("pure functie is stateless — identieke invoer levert identiek resultaat, geen afhankelijkheid van eerdere aanroepen", () => {
    const eerste = berekenBegroteManagementvergoeding(wijzig(), { begrotingsjaar: BEGROTINGSJAAR });
    berekenBegroteManagementvergoeding(indexeer({ bestaandBedrag: new Decimal(99999) }), { begrotingsjaar: BEGROTINGSJAAR }); // andere aanroep ertussen
    const tweede = berekenBegroteManagementvergoeding(wijzig(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(eerste.jaartotaal.bedrag.toString()).toBe(tweede.jaartotaal.bedrag.toString());
  });
});

// ── C. NIEUWE_VERGOEDING ────────────────────────────────────────────────

describe("berekenBegroteManagementvergoeding — NIEUWE_VERGOEDING", () => {
  it("€1.200/mnd vanaf 1 juli — jan-jun exact €0, jul-dec exact €1.200, jaartotaal €7.200", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.effectieveIngangsdatum).not.toBeNull();
    for (let i = 0; i < 6; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("0");
    for (let i = 6; i < 12; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("1200");
    expect(resultaat.jaartotaal.bedrag.toString()).toBe("7200");
  });

  it("start bij begin begrotingsjaar (ingangsdatum null) — alle 12 maanden gelijk", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding({ ingangsdatum: null }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.effectieveIngangsdatum).toBeNull();
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("1200");
    expect(resultaat.jaartotaal.bedrag.toString()).toBe("14400");
  });

  it("start vóór begrotingsjaar — al bestaand, geldt de volle 12 maanden", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding({ ingangsdatum: new Date(Date.UTC(BEGROTINGSJAAR - 1, 5, 1)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("1200");
  });

  it("start ná begrotingsjaar — nog niet ingegaan, alle maandbedragen 0", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding({ ingangsdatum: new Date(Date.UTC(BEGROTINGSJAAR + 1, 0, 1)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("0");
    expect(resultaat.controleVereist.some((c) => c.ernst === "INFORMATIEF")).toBe(true);
  });

  it("nieuw bedrag €0 — geldig (werkelijk nul vanaf ingang, geen KRITIEK)", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding({ bedrag: new Decimal(0) }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(false);
    expect(resultaat.jaartotaal.bedrag.toString()).toBe("0");
  });

  it("negatief bedrag wordt afgewezen (KRITIEK), niet als geldig bedrag geëchood", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding({ bedrag: new Decimal(-1) }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(true);
    expect(resultaat.nieuwBedrag).toBeNull();
  });

  it("ingangsdatum exact 1 januari — vergoeding geldt vanaf januari (volledig jaar)", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding({ ingangsdatum: new Date(Date.UTC(BEGROTINGSJAAR, 0, 1)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    for (const regel of resultaat.regels) expect(regel.bedrag.toString()).toBe("1200");
    expect(resultaat.jaartotaal.bedrag.toString()).toBe("14400");
  });

  it("ingangsdatum exact 31 december — de dag wordt genegeerd, alleen december heeft de vergoeding", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding({ ingangsdatum: new Date(Date.UTC(BEGROTINGSJAAR, 11, 31)) }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    for (let i = 0; i < 11; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("0"); // jan-nov
    expect(resultaat.regels[11]!.bedrag.toString()).toBe("1200"); // december
  });

  it("deze wijze kent geen bestaand-bedrag-veld — 'geen bronbedrag bekend' is hier geen apart concept, gewoon een geldige berekening", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat.bestaandBedrag).toBeNull();
  });
});

// ── D. SEMANTISCHE SCHEIDING (regressietest tegen de ontdekte fout) ────

describe("berekenBegroteManagementvergoeding — semantische scheiding WIJZIG_BESTAAND_BEDRAG vs. NIEUWE_VERGOEDING", () => {
  it("WIJZIG_BESTAAND_BEDRAG (€1.000→€1.200 per 1 juli) geeft NIET hetzelfde resultaat als NIEUWE_VERGOEDING (€1.200 per 1 juli)", () => {
    const gewijzigd = berekenBegroteManagementvergoeding(wijzig(), { begrotingsjaar: BEGROTINGSJAAR });
    const nieuw = berekenBegroteManagementvergoeding(nieuweVergoeding(), { begrotingsjaar: BEGROTINGSJAAR });

    // Vanaf juli zijn beide resultaten toevallig gelijk (€1.200) — het verschil zit vóór juli.
    for (let i = 6; i < 12; i += 1) {
      expect(gewijzigd.regels[i]!.bedrag.toString()).toBe(nieuw.regels[i]!.bedrag.toString());
    }
    // Jan-jun: WIJZIG toont het bestaande bedrag (€1.000), NIEUWE_VERGOEDING toont €0 (bestond nog niet).
    for (let i = 0; i < 6; i += 1) {
      expect(gewijzigd.regels[i]!.bedrag.toString()).toBe("1000");
      expect(nieuw.regels[i]!.bedrag.toString()).toBe("0");
      expect(gewijzigd.regels[i]!.bedrag.toString()).not.toBe(nieuw.regels[i]!.bedrag.toString());
    }
    expect(gewijzigd.jaartotaal.bedrag.toString()).not.toBe(nieuw.jaartotaal.bedrag.toString());
    expect(gewijzigd.jaartotaal.bedrag.toString()).toBe("13200");
    expect(nieuw.jaartotaal.bedrag.toString()).toBe("7200");
    // Het verschil is exact de 6 maanden × €1.000 bestaand bedrag die WIJZIG_BESTAAND_BEDRAG behoudt en NIEUWE_VERGOEDING niet kent.
    expect(gewijzigd.jaartotaal.bedrag.minus(nieuw.jaartotaal.bedrag).toString()).toBe("6000");
  });
});

// ── Maand/jaar-conversie, deterministisch ───────────────────────────────

describe("berekenBegroteManagementvergoeding — maand/jaar-conversie, deterministisch", () => {
  it("maandbedrag → afgeleid jaarbedrag is exact 12×, geen afrondingsverschil", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding({ bedrag: new Decimal("833.33"), eenheid: "MAAND", ingangsdatum: null }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    expect(resultaat.nieuwBedrag?.jaar.toString()).toBe("9999.96");
    expect(resultaat.nieuwBedrag?.maand.times(12).equals(resultaat.nieuwBedrag.jaar)).toBe(true);
  });

  it("jaarbedrag → afgeleid maandbedrag ×12 reproduceert exact het jaarbedrag (volledige Decimal-precisie)", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding({ bedrag: new Decimal(1000), eenheid: "JAAR", ingangsdatum: null }), {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    expect(resultaat.nieuwBedrag?.maand.times(12).equals(new Decimal(1000))).toBe(true);
  });

  it("WIJZIG_BESTAAND_BEDRAG met verschillende eenheden voor bestaand (JAAR) en nieuw (MAAND)", () => {
    const resultaat = berekenBegroteManagementvergoeding(
      wijzig({ bestaandBedrag: new Decimal(12000), bestaandEenheid: "JAAR", nieuwBedrag: new Decimal(1200), nieuweEenheid: "MAAND" }),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    for (let i = 0; i < 6; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("1000"); // 12000/12
    for (let i = 6; i < 12; i += 1) expect(resultaat.regels[i]!.bedrag.toString()).toBe("1200");
  });

  it("jaartotaal.bedrag reconcilieert exact met de som van de 12 maandregels (indexatiescenario)", () => {
    const resultaat = berekenBegroteManagementvergoeding(indexeer(), { begrotingsjaar: BEGROTINGSJAAR });
    const somMaanden = resultaat.regels.reduce((t, r) => t.plus(r.bedrag), new Decimal(0));
    expect(resultaat.jaartotaal.bedrag.equals(somMaanden)).toBe(true);
  });
});

// ── Geen semantische koppeling met Beheervergoeding ─────────────────────

describe("berekenBegroteManagementvergoeding — geen semantische koppeling met Beheervergoeding", () => {
  it("resultaat bevat geen enkel veld/type uit begroteBeheersvergoeding (complexnummer, vastToegepast, etc.)", () => {
    const resultaat = berekenBegroteManagementvergoeding(nieuweVergoeding(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(resultaat).not.toHaveProperty("complexen");
    expect(resultaat).not.toHaveProperty("complexnummer");
    expect(resultaat.regels[0]).not.toHaveProperty("vastToegepast");
  });
});
