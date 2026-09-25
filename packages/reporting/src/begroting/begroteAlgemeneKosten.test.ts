import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  ALGEMENE_KOSTEN_CATEGORIEEN,
  berekenBegroteAlgemeneKosten,
  type BgAlgemeneKostenCategorie,
  type BgAlgemeneKostenCategorieAannames,
  type BgAlgemeneKostenClassificatieRegel,
  type BgAlgemeneKostenRegelInvoer,
} from "./begroteAlgemeneKosten.js";

const BEGROTINGSJAAR = 2027;

function regel(overrides: Partial<BgAlgemeneKostenRegelInvoer> = {}): BgAlgemeneKostenRegelInvoer {
  return {
    categorie: "ALGEMENE_KOSTEN",
    ogbKostensoortCode: null,
    omschrijving: "Testregel",
    complexnummer: null,
    jaarbedrag: new Decimal(1000),
    ...overrides,
  };
}

function categorieAannames(overrides: Partial<BgAlgemeneKostenCategorieAannames> = {}): BgAlgemeneKostenCategorieAannames {
  return {
    beoordeeld: true,
    vorigJaarBedrag: null,
    verwachteVerhogingPercentage: null,
    ...overrides,
  };
}

/** Alle vijf categorieën op dezelfde aannames — hulpfunctie uitsluitend voor deze tests. */
function alleAannames(
  overrides: Partial<Record<BgAlgemeneKostenCategorie, Partial<BgAlgemeneKostenCategorieAannames>>> = {},
): Record<BgAlgemeneKostenCategorie, BgAlgemeneKostenCategorieAannames> {
  return Object.fromEntries(
    ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie) => [categorie, categorieAannames(overrides[categorie])]),
  ) as Record<BgAlgemeneKostenCategorie, BgAlgemeneKostenCategorieAannames>;
}

const KLASSIFICATIE_070: BgAlgemeneKostenClassificatieRegel[] = [
  { ogbKostensoort: "4990", ogbKostensoortOmschrijving: "Diverse alg kosten", categorie: "ALGEMENE_KOSTEN" },
  { ogbKostensoort: "4992", ogbKostensoortOmschrijving: "makelaarskosten", categorie: "MAKELAARSKOSTEN" },
  { ogbKostensoort: "4995", ogbKostensoortOmschrijving: "Bankkosten", categorie: "BANKKOSTEN" },
];

function kritieken(controleVereist: { ernst: string }[]): number {
  return controleVereist.filter((c) => c.ernst === "KRITIEK").length;
}

describe("berekenBegroteAlgemeneKosten", () => {
  it("A. alle vijf categorieën afzonderlijk beschikbaar, geen samenvoeging", () => {
    const r = berekenBegroteAlgemeneKosten(
      [
        regel({ categorie: "ACCOUNTANT", jaarbedrag: new Decimal(4000) }),
        regel({ categorie: "ALGEMENE_KOSTEN", ogbKostensoortCode: "4990", jaarbedrag: new Decimal(500) }),
        regel({ categorie: "JURIDISCHE_KOSTEN", jaarbedrag: new Decimal(2500) }),
        regel({ categorie: "MAKELAARSKOSTEN", ogbKostensoortCode: "4992", jaarbedrag: new Decimal(6000) }),
        regel({ categorie: "BANKKOSTEN", ogbKostensoortCode: "4995", jaarbedrag: new Decimal(50) }),
      ],
      alleAannames(),
      KLASSIFICATIE_070,
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(r.accountantskosten.toString()).toBe("4000");
    expect(r.algemeneKosten.toString()).toBe("500");
    expect(r.juridischeKosten.toString()).toBe("2500");
    expect(r.makelaarskosten.toString()).toBe("6000");
    expect(r.bankkosten.toString()).toBe("50");
    expect(r.moduleTotaal.toString()).toBe("13050");
    expect(r.perCategorie).toHaveLength(5);
  });

  it("B. meerdere regels per categorie", () => {
    const r = berekenBegroteAlgemeneKosten(
      [
        regel({ categorie: "JURIDISCHE_KOSTEN", omschrijving: "Huurgeschil", jaarbedrag: new Decimal(5000) }),
        regel({ categorie: "JURIDISCHE_KOSTEN", omschrijving: "Contractadvies", jaarbedrag: new Decimal(2500) }),
      ],
      alleAannames(),
      [],
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const juridisch = r.perCategorie.find((c) => c.categorie === "JURIDISCHE_KOSTEN")!;
    expect(juridisch.regels).toHaveLength(2);
    expect(juridisch.categorieTotaal.toString()).toBe("7500");
  });

  it("C. geldige OGB-koppeling resolved naar omschrijving uit classificatie, niet uit vrije tekst", () => {
    const r = berekenBegroteAlgemeneKosten(
      [regel({ categorie: "MAKELAARSKOSTEN", ogbKostensoortCode: "4992", omschrijving: "iets anders" })],
      alleAannames(),
      KLASSIFICATIE_070,
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const makelaar = r.perCategorie.find((c) => c.categorie === "MAKELAARSKOSTEN")!;
    expect(makelaar.regels[0]?.ogbKostensoortOmschrijving).toBe("makelaarskosten");
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("D. null OGB-code is geldig (Accountant/Juridisch zonder bewezen mapping)", () => {
    const r = berekenBegroteAlgemeneKosten(
      [regel({ categorie: "ACCOUNTANT", ogbKostensoortCode: null }), regel({ categorie: "JURIDISCHE_KOSTEN", ogbKostensoortCode: null })],
      alleAannames(),
      KLASSIFICATIE_070,
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(kritieken(r.controleVereist)).toBe(0);
    expect(r.perCategorie.find((c) => c.categorie === "ACCOUNTANT")!.regels[0]?.ogbKostensoortOmschrijving).toBeNull();
  });

  it("E. onbekende OGB-code: KRITIEK, financiële bijdrage blijft zichtbaar", () => {
    const r = berekenBegroteAlgemeneKosten(
      [regel({ categorie: "MAKELAARSKOSTEN", ogbKostensoortCode: "9999", jaarbedrag: new Decimal(1234) })],
      alleAannames(),
      KLASSIFICATIE_070,
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(kritieken(r.controleVereist)).toBe(1);
    expect(r.makelaarskosten.toString()).toBe("1234");
  });

  it("F. OGB-code gekoppeld aan andere categorie: KRITIEK (mismatch)", () => {
    const r = berekenBegroteAlgemeneKosten(
      [regel({ categorie: "JURIDISCHE_KOSTEN", ogbKostensoortCode: "4992" })], // 4992 hoort bij MAKELAARSKOSTEN
      alleAannames(),
      KLASSIFICATIE_070,
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(kritieken(r.controleVereist)).toBe(1);
    expect(r.controleVereist[0]?.bericht).toContain("gekoppeld aan MAKELAARSKOSTEN");
  });

  it("G. null complexnummer is geldig (administratiebreed), geen control", () => {
    const r = berekenBegroteAlgemeneKosten([regel({ complexnummer: null })], alleAannames(), [], { begrotingsjaar: BEGROTINGSJAAR });
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("H. null jaarbedrag: KRITIEK, veilige bijdrage 0", () => {
    const r = berekenBegroteAlgemeneKosten([regel({ jaarbedrag: null })], alleAannames(), [], { begrotingsjaar: BEGROTINGSJAAR });
    expect(kritieken(r.controleVereist)).toBe(1);
    expect(r.algemeneKosten.toString()).toBe("0");
  });

  it("I. expliciete Decimal(0) is geldig, geen control", () => {
    const r = berekenBegroteAlgemeneKosten([regel({ jaarbedrag: new Decimal(0) })], alleAannames(), [], { begrotingsjaar: BEGROTINGSJAAR });
    expect(kritieken(r.controleVereist)).toBe(0);
    expect(r.algemeneKosten.toString()).toBe("0");
  });

  it("J. negatief jaarbedrag: WAARSCHUWING, telt volledig mee", () => {
    const r = berekenBegroteAlgemeneKosten([regel({ jaarbedrag: new Decimal(-500) })], alleAannames(), [], { begrotingsjaar: BEGROTINGSJAAR });
    expect(kritieken(r.controleVereist)).toBe(0);
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);
    expect(r.algemeneKosten.toString()).toBe("-500");
  });

  it("K. lege omschrijving: KRITIEK, bedrag blijft financieel zichtbaar", () => {
    const r = berekenBegroteAlgemeneKosten([regel({ omschrijving: "   ", jaarbedrag: new Decimal(750) })], alleAannames(), [], {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    expect(kritieken(r.controleVereist)).toBe(1);
    expect(r.algemeneKosten.toString()).toBe("750");
  });

  it("L. review onafhankelijk per categorie: Accountant beoordeeld, Juridisch nog niet", () => {
    const r = berekenBegroteAlgemeneKosten(
      [],
      alleAannames({ ACCOUNTANT: { beoordeeld: true }, JURIDISCHE_KOSTEN: { beoordeeld: false } }),
      [],
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(r.perCategorie.find((c) => c.categorie === "ACCOUNTANT")!.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    expect(r.perCategorie.find((c) => c.categorie === "JURIDISCHE_KOSTEN")!.reviewStatus).toBe("NOT_REVIEWED");
  });

  it("M. beoordeeld=true + 0 regels = REVIEWED_ZERO_RULES, geldige bewuste €0", () => {
    const r = berekenBegroteAlgemeneKosten([], alleAannames(), [], { begrotingsjaar: BEGROTINGSJAAR });
    for (const c of r.perCategorie) {
      expect(c.reviewStatus).toBe("REVIEWED_ZERO_RULES");
      expect(c.categorieTotaal.toString()).toBe("0");
    }
    expect(r.moduleTotaal.toString()).toBe("0");
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("N. beoordeeld=true + >=1 regel = REVIEWED_WITH_RULES", () => {
    const r = berekenBegroteAlgemeneKosten([regel({ categorie: "BANKKOSTEN" })], alleAannames(), [], { begrotingsjaar: BEGROTINGSJAAR });
    expect(r.perCategorie.find((c) => c.categorie === "BANKKOSTEN")!.reviewStatus).toBe("REVIEWED_WITH_RULES");
  });

  it("O. Accountant-rekenhulp: geldig voorstel, wijzigt nooit de begroting", () => {
    const r = berekenBegroteAlgemeneKosten(
      [regel({ categorie: "ACCOUNTANT", jaarbedrag: new Decimal(5000) })],
      alleAannames({ ACCOUNTANT: { vorigJaarBedrag: new Decimal(7550), verwachteVerhogingPercentage: new Decimal(5) } }),
      [],
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const accountant = r.perCategorie.find((c) => c.categorie === "ACCOUNTANT")!;
    expect(accountant.berekendVoorstel?.toString()).toBe("7927.5");
    expect(accountant.categorieTotaal.toString()).toBe("5000"); // ongewijzigd door voorstel
    expect(r.accountantskosten.toString()).toBe("5000");
  });

  it("P. Bankkosten-rekenhulp: 0% verhoging is geldig", () => {
    const r = berekenBegroteAlgemeneKosten(
      [],
      alleAannames({ BANKKOSTEN: { vorigJaarBedrag: new Decimal(600), verwachteVerhogingPercentage: new Decimal(0) } }),
      [],
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const bank = r.perCategorie.find((c) => c.categorie === "BANKKOSTEN")!;
    expect(bank.berekendVoorstel?.toString()).toBe("600");
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("Q. negatieve verhogingspercentage: WAARSCHUWING, voorstel toch berekend", () => {
    const r = berekenBegroteAlgemeneKosten(
      [],
      alleAannames({ BANKKOSTEN: { vorigJaarBedrag: new Decimal(600), verwachteVerhogingPercentage: new Decimal(-10) } }),
      [],
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const bank = r.perCategorie.find((c) => c.categorie === "BANKKOSTEN")!;
    expect(bank.berekendVoorstel?.toString()).toBe("540");
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.categorie === "BANKKOSTEN")).toBe(true);
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("R. negatief vorigJaarBedrag: WAARSCHUWING, wel verwerkt", () => {
    const r = berekenBegroteAlgemeneKosten(
      [],
      alleAannames({ ACCOUNTANT: { vorigJaarBedrag: new Decimal(-100), verwachteVerhogingPercentage: new Decimal(5) } }),
      [],
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const accountant = r.perCategorie.find((c) => c.categorie === "ACCOUNTANT")!;
    expect(accountant.berekendVoorstel?.toString()).toBe("-105");
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.categorie === "ACCOUNTANT")).toBe(true);
  });

  it("S. ontbrekende rekenhulp geeft geen KRITIEK en geen voorstel", () => {
    const r = berekenBegroteAlgemeneKosten([], alleAannames(), [], { begrotingsjaar: BEGROTINGSJAAR });
    for (const c of r.perCategorie) {
      expect(c.berekendVoorstel).toBeNull();
    }
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("T. slechts één van beide rekenhulpvelden ingevuld geeft geen voorstel (geen KRITIEK)", () => {
    const r = berekenBegroteAlgemeneKosten([], alleAannames({ ACCOUNTANT: { vorigJaarBedrag: new Decimal(1000) } }), [], {
      begrotingsjaar: BEGROTINGSJAAR,
    });
    const accountant = r.perCategorie.find((c) => c.categorie === "ACCOUNTANT")!;
    expect(accountant.berekendVoorstel).toBeNull();
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("U. 070 bewezen classificatie: 4990/4992/4995 resolven correct, geen classificatie op omschrijving", () => {
    const r = berekenBegroteAlgemeneKosten(
      [
        regel({ categorie: "ALGEMENE_KOSTEN", ogbKostensoortCode: "4990", omschrijving: "willekeurige tekst" }),
        regel({ categorie: "MAKELAARSKOSTEN", ogbKostensoortCode: "4992", omschrijving: "andere willekeurige tekst" }),
        regel({ categorie: "BANKKOSTEN", ogbKostensoortCode: "4995", omschrijving: "nog een tekst" }),
      ],
      alleAannames(),
      KLASSIFICATIE_070,
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(r.perCategorie.find((c) => c.categorie === "ALGEMENE_KOSTEN")!.regels[0]?.ogbKostensoortOmschrijving).toBe("Diverse alg kosten");
    expect(r.perCategorie.find((c) => c.categorie === "MAKELAARSKOSTEN")!.regels[0]?.ogbKostensoortOmschrijving).toBe("makelaarskosten");
    expect(r.perCategorie.find((c) => c.categorie === "BANKKOSTEN")!.regels[0]?.ogbKostensoortOmschrijving).toBe("Bankkosten");
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("V. beoordeeld=false -> NOT_REVIEWED, ongeacht regels", () => {
    const r = berekenBegroteAlgemeneKosten(
      [regel({ categorie: "ALGEMENE_KOSTEN" })],
      alleAannames({ ALGEMENE_KOSTEN: { beoordeeld: false } }),
      [],
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(r.perCategorie.find((c) => c.categorie === "ALGEMENE_KOSTEN")!.reviewStatus).toBe("NOT_REVIEWED");
  });
});
