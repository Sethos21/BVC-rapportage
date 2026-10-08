import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  RENTE_CATEGORIEEN,
  berekenBegroteRente,
  berekenEstimatedRente,
  berekenWerkelijkRente,
  type BgRenteCategorie,
  type BgRenteCategorieAannames,
  type BgRenteRegelInvoer,
  type RenteClassificatieRegel,
  type WerkelijkRenteBoekingRegel,
} from "./begroteRente.js";

const BEGROTINGSJAAR = 2027;

function regel(overrides: Partial<BgRenteRegelInvoer> = {}): BgRenteRegelInvoer {
  return {
    categorie: "RENTEKOSTEN",
    omschrijving: "Testfinanciering",
    complexnummer: null,
    ogbReferentie: null,
    laatstBekendSaldo: null,
    rentepercentage: null,
    begrotingsbedrag: new Decimal(1000),
    ...overrides,
  };
}

function categorieAannames(overrides: Partial<BgRenteCategorieAannames> = {}): BgRenteCategorieAannames {
  return { beoordeeld: true, ...overrides };
}

function alleAannames(overrides: Partial<Record<BgRenteCategorie, Partial<BgRenteCategorieAannames>>> = {}): Record<BgRenteCategorie, BgRenteCategorieAannames> {
  return Object.fromEntries(RENTE_CATEGORIEEN.map((categorie) => [categorie, categorieAannames(overrides[categorie])])) as Record<BgRenteCategorie, BgRenteCategorieAannames>;
}

function kritieken(controleVereist: { ernst: string }[]): number {
  return controleVereist.filter((c) => c.ernst === "KRITIEK").length;
}

/** Bewezen bronproef (2026-09, 023_Malcon_Beheer_BV, GL 4600, boekjaar 2025) — uitsluitend als testfixture, NOOIT generieke hardcode. */
const KLASSIFICATIE_023: RenteClassificatieRegel[] = [
  { ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", categorie: "RENTEKOSTEN" },
  { ogbKostensoort: "4602", ogbKostensoortOmschrijving: "Rente en Provisie ING R/C", categorie: "RENTEKOSTEN" },
  { ogbKostensoort: "4603", ogbKostensoortOmschrijving: "Rente lening .586", categorie: "RENTEKOSTEN" },
  { ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente lening .500", categorie: "RENTEKOSTEN" },
  { ogbKostensoort: "4606", ogbKostensoortOmschrijving: "rente lening 747", categorie: "RENTEKOSTEN" },
  { ogbKostensoort: "4620", ogbKostensoortOmschrijving: "Overige rentes", categorie: "RENTEKOSTEN" },
];

/**
 * Bewezen bronproef (2026-09, administratie 013, GL 4620, boekjaar 2024) —
 * uitsluitend als testfixture. LET OP: OGB 4604 betekent hier "Rente r/c"
 * (RENTE_OPBRENGSTEN) — bij 023 betekent dezelfde code "Rente lening .500"
 * (RENTEKOSTEN). Bewuste, bewezen tegenstelling — nooit generaliseren.
 */
const KLASSIFICATIE_013: RenteClassificatieRegel[] = [
  { ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente r/c", categorie: "RENTE_OPBRENGSTEN" },
  { ogbKostensoort: "4621", ogbKostensoortOmschrijving: "Rente opbrengst telerek", categorie: "RENTE_OPBRENGSTEN" },
];

describe("berekenBegroteRente", () => {
  it("A. twee categorieën afzonderlijk beschikbaar, geen gezamenlijk moduletotaal", () => {
    const r = berekenBegroteRente(
      [regel({ categorie: "RENTEKOSTEN", begrotingsbedrag: new Decimal(50000) }), regel({ categorie: "RENTE_OPBRENGSTEN", begrotingsbedrag: new Decimal(-1200) })],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(r.rentekosten.toString()).toBe("50000");
    expect(r.renteOpbrengsten.toString()).toBe("-1200");
    expect(r.perCategorie).toHaveLength(2);
    expect(r.perCategorie.map((c) => c.categorie)).toEqual(["RENTEKOSTEN", "RENTE_OPBRENGSTEN"]);
    expect((r as unknown as { moduleTotaal?: unknown }).moduleTotaal).toBeUndefined();
  });

  it("B. meerdere regels binnen dezelfde categorie (meerdere financieringen)", () => {
    const r = berekenBegroteRente(
      [
        regel({ categorie: "RENTEKOSTEN", omschrijving: "Lening 747", begrotingsbedrag: new Decimal(120000) }),
        regel({ categorie: "RENTEKOSTEN", omschrijving: "Lening .962", begrotingsbedrag: new Decimal(45000) }),
      ],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    expect(r.rentekosten.toString()).toBe("165000");
  });

  it("C. lege omschrijving: KRITIEK, bedrag blijft financieel meetellen", () => {
    const r = berekenBegroteRente([regel({ omschrijving: "  " })], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(kritieken(r.controleVereist)).toBe(1);
    expect(r.rentekosten.toString()).toBe("1000");
  });

  it("D. begrotingsbedrag null/NaN: KRITIEK + veilige 0", () => {
    const rNull = berekenBegroteRente([regel({ begrotingsbedrag: null })], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(kritieken(rNull.controleVereist)).toBe(1);
    expect(rNull.rentekosten.toString()).toBe("0");

    const rNaN = berekenBegroteRente([regel({ begrotingsbedrag: new Decimal(NaN) })], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(kritieken(rNaN.controleVereist)).toBe(1);
    expect(rNaN.rentekosten.toString()).toBe("0");
  });

  it("E. negatief begrotingsbedrag: WAARSCHUWING, telt volledig mee", () => {
    const r = berekenBegroteRente([regel({ begrotingsbedrag: new Decimal(-500) })], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(kritieken(r.controleVereist)).toBe(0);
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);
    expect(r.rentekosten.toString()).toBe("-500");
  });

  it("F. complex/ogbReferentie zijn puur doorgegeven, geen validatie/join", () => {
    const r = berekenBegroteRente([regel({ complexnummer: "001", ogbReferentie: "OGB 4606 — lening 747" })], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    const invoer = r.perCategorie[0]!.regels[0]!.invoer;
    expect(invoer.complexnummer).toBe("001");
    expect(invoer.ogbReferentie).toBe("OGB 4606 — lening 747");
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("G. reviewStatus: NOT_REVIEWED / REVIEWED_ZERO_RULES / REVIEWED_WITH_RULES, onafhankelijk per categorie", () => {
    const r = berekenBegroteRente([regel({ categorie: "RENTEKOSTEN" })], alleAannames({ RENTE_OPBRENGSTEN: { beoordeeld: false } }), { begrotingsjaar: BEGROTINGSJAAR });
    expect(r.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.reviewStatus).toBe("REVIEWED_WITH_RULES");
    expect(r.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!.reviewStatus).toBe("NOT_REVIEWED");
  });

  it("H. beoordeeld=true + 0 regels -> REVIEWED_ZERO_RULES, geldig", () => {
    const r = berekenBegroteRente([], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    for (const c of r.perCategorie) expect(c.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    expect(r.controleVereist).toHaveLength(0);
  });

  it("I. rekenhulp per regel: beide invoerwaarden geldig -> berekendVoorstel, wijzigt begrotingsbedrag niet", () => {
    const r = berekenBegroteRente(
      [regel({ laatstBekendSaldo: new Decimal(7700000), rentepercentage: new Decimal(6), begrotingsbedrag: new Decimal(357441) })],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const regelUitkomst = r.perCategorie[0]!.regels[0]!;
    expect(regelUitkomst.berekendVoorstel!.toString()).toBe("462000");
    expect(regelUitkomst.bedrag.toString()).toBe("357441");
    expect(r.rentekosten.toString()).toBe("357441");
  });

  it("J. rekenhulp: één van beide ontbreekt (geen betrouwbare saldo-bron) -> berekendVoorstel null, geen KRITIEK, handmatig blijft toegestaan", () => {
    const r = berekenBegroteRente([regel({ laatstBekendSaldo: null, rentepercentage: new Decimal(4), begrotingsbedrag: new Decimal(2000) })], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    const regelUitkomst = r.perCategorie[0]!.regels[0]!;
    expect(regelUitkomst.berekendVoorstel).toBeNull();
    expect(regelUitkomst.bedrag.toString()).toBe("2000");
    expect(kritieken(r.controleVereist)).toBe(0);
  });

  it("K. rekenhulp per regel is onafhankelijk tussen meerdere regels in dezelfde categorie", () => {
    const r = berekenBegroteRente(
      [
        regel({ omschrijving: "Lening A", laatstBekendSaldo: new Decimal(100000), rentepercentage: new Decimal(5), begrotingsbedrag: new Decimal(5000) }),
        regel({ omschrijving: "Lening B", laatstBekendSaldo: new Decimal(200000), rentepercentage: new Decimal(3), begrotingsbedrag: new Decimal(6000) }),
      ],
      alleAannames(),
      { begrotingsjaar: BEGROTINGSJAAR },
    );
    const [a, b] = r.perCategorie[0]!.regels;
    expect(a!.berekendVoorstel!.toString()).toBe("5000");
    expect(b!.berekendVoorstel!.toString()).toBe("6000");
  });

  it("L. rekenhulp: NaN saldo/percentage -> KRITIEK, berekendVoorstel null", () => {
    const r = berekenBegroteRente([regel({ laatstBekendSaldo: new Decimal(NaN), rentepercentage: new Decimal(4) })], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(r.perCategorie[0]!.regels[0]!.berekendVoorstel).toBeNull();
    expect(kritieken(r.controleVereist)).toBe(1);
  });

  it("M. rekenhulp: negatieve saldo/percentage -> WAARSCHUWING, blijft rekenkundig verwerkt", () => {
    const r = berekenBegroteRente([regel({ laatstBekendSaldo: new Decimal(-1000), rentepercentage: new Decimal(5) })], alleAannames(), { begrotingsjaar: BEGROTINGSJAAR });
    expect(r.perCategorie[0]!.regels[0]!.berekendVoorstel!.toString()).toBe("-50");
    expect(kritieken(r.controleVereist)).toBe(0);
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);
  });
});

describe("berekenWerkelijkRente", () => {
  function boeking(overrides: Partial<WerkelijkRenteBoekingRegel> = {}): WerkelijkRenteBoekingRegel {
    return { ogbKostensoort: "4601", saldo: new Decimal(1000), ...overrides };
  }

  it("N (bronproef 023/2025). Rentekosten via administratie-specifieke OGB-classificatie, categorietotaal + uitsplitsing per OGB", () => {
    const boekingen: WerkelijkRenteBoekingRegel[] = [
      boeking({ ogbKostensoort: "4601", saldo: new Decimal("522837.15") }),
      boeking({ ogbKostensoort: "4602", saldo: new Decimal("49045.59") }),
      boeking({ ogbKostensoort: "4603", saldo: new Decimal("104989.35") }),
      boeking({ ogbKostensoort: "4604", saldo: new Decimal("66211.49") }),
      boeking({ ogbKostensoort: "4606", saldo: new Decimal("357440.93") }),
      boeking({ ogbKostensoort: "4620", saldo: new Decimal("48000") }),
    ];
    const r = berekenWerkelijkRente(boekingen, KLASSIFICATIE_023);
    const rentekosten = r.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!;
    expect(rentekosten.categorieTotaal.toString()).toBe("1148524.51");
    expect(rentekosten.perOgbKostensoort).toHaveLength(6);
    expect(rentekosten.perOgbKostensoort.find((o) => o.ogbKostensoort === "4606")!.saldo.toString()).toBe("357440.93");
    expect(r.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!.categorieTotaal.toString()).toBe("0");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(0);
  });

  it("O (bronproef 013/2024). Rente opbrengsten via administratie-specifieke OGB-classificatie", () => {
    const boekingen: WerkelijkRenteBoekingRegel[] = [
      boeking({ ogbKostensoort: "4604", saldo: new Decimal("-1215.67") }),
      boeking({ ogbKostensoort: "4621", saldo: new Decimal("-34.42") }),
    ];
    const r = berekenWerkelijkRente(boekingen, KLASSIFICATIE_013);
    const renteOpbrengsten = r.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!;
    expect(renteOpbrengsten.categorieTotaal.toString()).toBe("-1250.09");
    expect(r.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.categorieTotaal.toString()).toBe("0");
  });

  it("P (kernbewijs). dezelfde OGB-code 4604 betekent bij 023 RENTEKOSTEN en bij 013 RENTE_OPBRENGSTEN — nooit portfolio-breed generaliseren", () => {
    const boeking023 = berekenWerkelijkRente([boeking({ ogbKostensoort: "4604", saldo: new Decimal(66211.49) })], KLASSIFICATIE_023);
    const boeking013 = berekenWerkelijkRente([boeking({ ogbKostensoort: "4604", saldo: new Decimal(-1215.67) })], KLASSIFICATIE_013);

    expect(boeking023.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.categorieTotaal.toString()).toBe("66211.49");
    expect(boeking023.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!.categorieTotaal.toString()).toBe("0");

    expect(boeking013.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!.categorieTotaal.toString()).toBe("-1215.67");
    expect(boeking013.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.categorieTotaal.toString()).toBe("0");
  });

  it("Q. onbekende OGB-kostensoort: nooit geraden, apart gehouden, WAARSCHUWING", () => {
    const r = berekenWerkelijkRente([boeking({ ogbKostensoort: "9999", saldo: new Decimal(500) })], KLASSIFICATIE_023);
    expect(r.perCategorie.every((c) => c.categorieTotaal.toString() === "0")).toBe(true);
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("500");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(1);
    expect(r.controleVereist[0]!.ernst).toBe("WAARSCHUWING");
  });

  it("R. ontbrekende OGB-kostensoort (null): nooit geraden, apart gehouden", () => {
    const r = berekenWerkelijkRente([boeking({ ogbKostensoort: null, saldo: new Decimal(250) })], KLASSIFICATIE_023);
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("250");
    expect(r.controleVereist[0]!.ogbKostensoort).toBeNull();
  });

  it("S. geen boekingen: alle categorieën 0, geen controls", () => {
    const r = berekenWerkelijkRente([], KLASSIFICATIE_023);
    expect(r.perCategorie.every((c) => c.categorieTotaal.toString() === "0")).toBe(true);
    expect(r.controleVereist).toHaveLength(0);
  });
});

describe("berekenEstimatedRente", () => {
  const BEGROTING = berekenBegroteRente(
    [regel({ categorie: "RENTEKOSTEN", begrotingsbedrag: new Decimal(1148524.51) }), regel({ categorie: "RENTE_OPBRENGSTEN", begrotingsbedrag: new Decimal(-1250.09) })],
    alleAannames(),
    { begrotingsjaar: BEGROTINGSJAAR },
  );
  const WERKELIJK = berekenWerkelijkRente([{ ogbKostensoort: "4601", saldo: new Decimal(522837.15) }], KLASSIFICATIE_023);

  function geenVerwachting(): Record<BgRenteCategorie, Decimal | null> {
    return Object.fromEntries(RENTE_CATEGORIEEN.map((c) => [c, null])) as Record<BgRenteCategorie, Decimal | null>;
  }

  it("T. Begroting blijft ongewijzigd zichtbaar naast Estimated", () => {
    const r = berekenEstimatedRente(BEGROTING, WERKELIJK, geenVerwachting());
    expect(r.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.begrotingTotaal.toString()).toBe("1148524.51");
  });

  it("U. geen verwachting ingevuld: estimatedTotaal en afwijking null, geen verzonnen/geëxtrapoleerd bedrag", () => {
    const r = berekenEstimatedRente(BEGROTING, WERKELIJK, geenVerwachting());
    for (const cat of r.perCategorie) {
      expect(cat.estimatedTotaal).toBeNull();
      expect(cat.afwijking).toBeNull();
    }
  });

  it("V. verwachting ingevuld: estimatedTotaal = werkelijk + verwachting, per categorie onafhankelijk", () => {
    const verwachting = geenVerwachting();
    verwachting.RENTEKOSTEN = new Decimal(625687.36);
    const r = berekenEstimatedRente(BEGROTING, WERKELIJK, verwachting);
    const rentekosten = r.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!;
    expect(rentekosten.estimatedTotaal!.toString()).toBe("1148524.51");
    expect(rentekosten.afwijking!.toString()).toBe("0");
    expect(r.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!.estimatedTotaal).toBeNull();
  });

  it("W. werkelijk geboekte correctie beïnvloedt Estimated maar wijzigt Begroting nooit (geen dubbeltelling)", () => {
    const werkelijkNaCorrectie = berekenWerkelijkRente([{ ogbKostensoort: "4601", saldo: new Decimal(600000) }], KLASSIFICATIE_023);
    const r = berekenEstimatedRente(BEGROTING, werkelijkNaCorrectie, geenVerwachting());
    expect(r.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.werkelijkTotaal.toString()).toBe("600000");
    expect(r.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.begrotingTotaal.toString()).toBe("1148524.51");
  });
});
