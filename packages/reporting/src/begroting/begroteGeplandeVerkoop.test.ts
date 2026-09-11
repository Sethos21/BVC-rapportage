import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  GEPLANDE_VERKOOP_COMPONENTEN,
  berekenBegroteGeplandeVerkoop,
  berekenWerkelijkGeplandeVerkoop,
  type BgGeplandeVerkoopAannames,
  type BgGeplandeVerkoopRegelInvoer,
  type GeplandeVerkoopClassificatieRegel,
  type GeplandeVerkoopGrootboekClassificatieRegel,
  type WerkelijkGeplandeVerkoopBoekingRegel,
} from "./begroteGeplandeVerkoop.js";

const BEGROTINGSJAAR = 2027;

function aannames(overrides: Partial<BgGeplandeVerkoopAannames> = {}): BgGeplandeVerkoopAannames {
  return { begrotingsjaar: BEGROTINGSJAAR, beoordeeld: true, ...overrides };
}

function regel(overrides: Partial<BgGeplandeVerkoopRegelInvoer> = {}): BgGeplandeVerkoopRegelInvoer {
  return {
    objectreferentie: "Hoofdstraat 103",
    omschrijving: "Verkoop pand Hoofdstraat 103",
    geplandeVerkoopdatum: new Date("2027-06-01"),
    verwachteVerkoopopbrengst: new Decimal(785000),
    verwachteBoekwaarde: new Decimal(600000),
    verwachteVerkoopkosten: new Decimal(15000),
    verwachteEinddatumHuurExploitatie: null,
    toelichting: null,
    ...overrides,
  };
}

function kritiek(controleVereist: { ernst: string; regelIndex: number | null }[], regelIndex: number | null = null) {
  return controleVereist.filter((c) => c.ernst === "KRITIEK" && (regelIndex === null || c.regelIndex === regelIndex));
}

describe("berekenBegroteGeplandeVerkoop", () => {
  it("A. nul regels + beoordeeld=false -> NOT_REVIEWED, geen control", () => {
    const r = berekenBegroteGeplandeVerkoop([], aannames({ beoordeeld: false }));
    expect(r.reviewStatus).toBe("NOT_REVIEWED");
    expect(r.regels).toHaveLength(0);
    expect(r.controleVereist).toHaveLength(0);
  });

  it("B. nul regels + beoordeeld=true -> REVIEWED_ZERO_RULES", () => {
    const r = berekenBegroteGeplandeVerkoop([], aannames({ beoordeeld: true }));
    expect(r.reviewStatus).toBe("REVIEWED_ZERO_RULES");
  });

  it("C. één volledige regel -> REVIEWED_WITH_RULES, verwacht verkoopresultaat correct berekend", () => {
    const r = berekenBegroteGeplandeVerkoop([regel()], aannames());
    expect(r.reviewStatus).toBe("REVIEWED_WITH_RULES");
    expect(r.regels[0]?.verwachtVerkoopresultaat?.toString()).toBe("170000");
    expect(r.controleVereist).toHaveLength(0);
  });

  it("D. GEEN totaal/moduleTotaal-veld aanwezig op het resultaat", () => {
    const r = berekenBegroteGeplandeVerkoop([regel(), regel()], aannames());
    expect((r as unknown as { totaal?: unknown }).totaal).toBeUndefined();
    expect((r as unknown as { moduleTotaal?: unknown }).moduleTotaal).toBeUndefined();
    expect((r as unknown as { verwachtVerkoopresultaatTotaal?: unknown }).verwachtVerkoopresultaatTotaal).toBeUndefined();
  });

  it("E. lege objectreferentie -> KRITIEK, regel blijft aanwezig", () => {
    const r = berekenBegroteGeplandeVerkoop([regel({ objectreferentie: "  " })], aannames());
    expect(kritiek(r.controleVereist, 0)).toHaveLength(1);
    expect(r.regels).toHaveLength(1);
  });

  it("F. lege omschrijving -> KRITIEK", () => {
    const r = berekenBegroteGeplandeVerkoop([regel({ omschrijving: "" })], aannames());
    expect(kritiek(r.controleVereist, 0)).toHaveLength(1);
  });

  it("G. ontbrekende geplande verkoopdatum (null) -> KRITIEK", () => {
    const r = berekenBegroteGeplandeVerkoop([regel({ geplandeVerkoopdatum: null })], aannames());
    expect(kritiek(r.controleVereist, 0)).toHaveLength(1);
    expect(r.controleVereist[0]?.bericht).toMatch(/verkoopdatum ontbreekt/);
  });

  it("H. ontbrekende verwachte verkoopopbrengst -> GEEN KRITIEK (planning mag onvolledig zijn), verwachtVerkoopresultaat blijft null, GEEN 0-fallback", () => {
    const r = berekenBegroteGeplandeVerkoop([regel({ verwachteVerkoopopbrengst: null })], aannames());
    expect(kritiek(r.controleVereist, 0)).toHaveLength(0);
    expect(r.regels[0]?.verwachtVerkoopresultaat).toBeNull();
  });

  it("I. ontbrekende verwachte boekwaarde -> GEEN KRITIEK, verwachtVerkoopresultaat blijft null", () => {
    const r = berekenBegroteGeplandeVerkoop([regel({ verwachteBoekwaarde: null })], aannames());
    expect(kritiek(r.controleVereist, 0)).toHaveLength(0);
    expect(r.regels[0]?.verwachtVerkoopresultaat).toBeNull();
  });

  it("J. ontbrekende verwachte verkoopkosten -> GEEN KRITIEK, verwachtVerkoopresultaat blijft null", () => {
    const r = berekenBegroteGeplandeVerkoop([regel({ verwachteVerkoopkosten: null })], aannames());
    expect(kritiek(r.controleVereist, 0)).toHaveLength(0);
    expect(r.regels[0]?.verwachtVerkoopresultaat).toBeNull();
  });

  it("K. NaN-bedrag (defensief, corrupte invoer) -> WEL KRITIEK, verwachtVerkoopresultaat blijft null", () => {
    const r = berekenBegroteGeplandeVerkoop([regel({ verwachteVerkoopopbrengst: new Decimal(NaN) })], aannames());
    expect(kritiek(r.controleVereist, 0)).toHaveLength(1);
    expect(r.regels[0]?.verwachtVerkoopresultaat).toBeNull();
  });

  it("L. negatief bedrag -> uitsluitend WAARSCHUWING, telt gewoon mee in de berekening", () => {
    const r = berekenBegroteGeplandeVerkoop([regel({ verwachteVerkoopkosten: new Decimal(-1000) })], aannames());
    expect(kritiek(r.controleVereist, 0)).toHaveLength(0);
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);
    expect(r.regels[0]?.verwachtVerkoopresultaat?.toString()).toBe("186000");
  });

  it("M. verwachteEinddatumHuurExploitatie is puur planningssignaal — geen validatie, geen invloed op resultaat", () => {
    const r = berekenBegroteGeplandeVerkoop([regel({ verwachteEinddatumHuurExploitatie: new Date("2027-05-01") })], aannames());
    expect(kritiek(r.controleVereist, 0)).toHaveLength(0);
    expect(r.regels[0]?.invoer.verwachteEinddatumHuurExploitatie).toEqual(new Date("2027-05-01"));
    expect(r.regels[0]?.verwachtVerkoopresultaat?.toString()).toBe("170000");
  });

  it("N. beoordeeld is pure doorgifte, nooit afgeleid uit regels/controls", () => {
    const r = berekenBegroteGeplandeVerkoop([regel({ objectreferentie: "" })], aannames({ beoordeeld: true }));
    expect(r.beoordeeld).toBe(true);
    expect(r.reviewStatus).toBe("REVIEWED_WITH_RULES");
  });

  it("O. meerdere regels: elke regel heeft zijn eigen, onafhankelijke resultaat", () => {
    const r = berekenBegroteGeplandeVerkoop(
      [regel({ objectreferentie: "A" }), regel({ objectreferentie: "B", verwachteVerkoopopbrengst: null })],
      aannames(),
    );
    expect(r.regels[0]?.verwachtVerkoopresultaat?.toString()).toBe("170000");
    expect(r.regels[1]?.verwachtVerkoopresultaat).toBeNull();
  });
});

describe("berekenWerkelijkGeplandeVerkoop", () => {
  /** Bewezen bronproef (2026-09, administratie 023, GL08830/00166/00167, boekjaar 2026 periode 04) — uitsluitend als testfixture. */
  const OGB_KLASSIFICATIE_023: GeplandeVerkoopClassificatieRegel[] = [
    { ogbKostensoort: "3010", ogbKostensoortOmschrijving: "afwaardering ASW", component: "BOEKWAARDE_AFBOEKING" },
  ];
  /** GEEN grootboekclassificatie geconfigureerd — de default in de meeste tests hieronder. */
  const GEEN_GL_KLASSIFICATIE: GeplandeVerkoopGrootboekClassificatieRegel[] = [];
  /** 023-bewezen: GL 08830 "Opbrengst verkoop pand" -> VERKOOPOPBRENGST (administratie-specifiek geconfigureerd, want geen van de bewezen GL08830-regels droeg ooit een OGB-kostensoort). */
  const GL_KLASSIFICATIE_023: GeplandeVerkoopGrootboekClassificatieRegel[] = [
    { grootboekrekening: "08830", grootboekOmschrijving: "Opbrengst verkoop pand", component: "VERKOOPOPBRENGST" },
  ];

  function boeking(overrides: Partial<WerkelijkGeplandeVerkoopBoekingRegel> = {}): WerkelijkGeplandeVerkoopBoekingRegel {
    return { grootboekrekening: "08830", ogbKostensoort: null, saldo: new Decimal(0), ...overrides };
  }

  it("P. classificeert boekingen per component, strikt gescheiden (via OGB)", () => {
    const r = berekenWerkelijkGeplandeVerkoop([boeking({ grootboekrekening: "00166", ogbKostensoort: "3010", saldo: new Decimal(-535000) })], OGB_KLASSIFICATIE_023, GEEN_GL_KLASSIFICATIE);
    expect(r.perComponent.find((c) => c.component === "BOEKWAARDE_AFBOEKING")!.componentTotaal.toString()).toBe("-535000");
    expect(r.perComponent.find((c) => c.component === "VERKOOPOPBRENGST")!.componentTotaal.toString()).toBe("0");
  });

  it("Q. GEEN gecombineerd verkoopresultaat-veld — VERKOOPOPBRENGST en BOEKWAARDE_AFBOEKING blijven altijd apart", () => {
    const r = berekenWerkelijkGeplandeVerkoop([], OGB_KLASSIFICATIE_023, GEEN_GL_KLASSIFICATIE);
    expect((r as unknown as { verkoopresultaat?: unknown }).verkoopresultaat).toBeUndefined();
    expect((r as unknown as { totaal?: unknown }).totaal).toBeUndefined();
    expect(r.perComponent).toHaveLength(GEPLANDE_VERKOOP_COMPONENTEN.length);
  });

  it("R. boeking zonder OGB-kostensoort EN zonder GL-classificatie wordt nooit geraden, apart gehouden", () => {
    const r = berekenWerkelijkGeplandeVerkoop([boeking({ grootboekrekening: "08830", saldo: new Decimal(-785000) })], OGB_KLASSIFICATIE_023, GEEN_GL_KLASSIFICATIE);
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("-785000");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(1);
    expect(r.perComponent.every((c) => c.componentTotaal.toString() === "0")).toBe(true);
  });

  it("S. onbekende OGB-kostensoort zonder GL-fallback wordt nooit geraden", () => {
    const r = berekenWerkelijkGeplandeVerkoop([boeking({ grootboekrekening: "9999", ogbKostensoort: "9999", saldo: new Decimal(100) })], OGB_KLASSIFICATIE_023, GEEN_GL_KLASSIFICATIE);
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("100");
    expect(r.controleVereist[0]?.bericht).toMatch(/komt niet voor/);
  });

  it("U (kernbewijs — GL-classificatie zonder OGB). GL08830 zonder OGB wordt herkend als VERKOOPOPBRENGST wanneer dat administratie-specifiek zo is geconfigureerd", () => {
    const r = berekenWerkelijkGeplandeVerkoop(
      [boeking({ grootboekrekening: "08830", ogbKostensoort: null, saldo: new Decimal(-785000) })],
      OGB_KLASSIFICATIE_023,
      GL_KLASSIFICATIE_023,
    );
    expect(r.perComponent.find((c) => c.component === "VERKOOPOPBRENGST")!.componentTotaal.toString()).toBe("-785000");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(0);
    // Onderbouwing: uitsluitend in de GL-drilldown, NIET in de OGB-drilldown (want er was geen OGB).
    expect(r.perComponent.find((c) => c.component === "VERKOOPOPBRENGST")!.perGrootboekrekening).toHaveLength(1);
    expect(r.perComponent.find((c) => c.component === "VERKOOPOPBRENGST")!.perOgbKostensoort).toHaveLength(0);
  });

  it("V. OGB-classificatie krijgt voorrang boven GL-classificatie wanneer een boeking wél een bekende OGB-code draagt", () => {
    const r = berekenWerkelijkGeplandeVerkoop(
      [boeking({ grootboekrekening: "08830", ogbKostensoort: "3010", saldo: new Decimal(-1000) })],
      OGB_KLASSIFICATIE_023,
      GL_KLASSIFICATIE_023,
    );
    // OGB 3010 -> BOEKWAARDE_AFBOEKING wint van GL 08830 -> VERKOOPOPBRENGST.
    expect(r.perComponent.find((c) => c.component === "BOEKWAARDE_AFBOEKING")!.componentTotaal.toString()).toBe("-1000");
    expect(r.perComponent.find((c) => c.component === "VERKOOPOPBRENGST")!.componentTotaal.toString()).toBe("0");
  });

  it("W (023-bronproef, kernbewijs — geen automatische koppeling opbrengst/boekwaarde). Twee onafhankelijke boekstukken op dezelfde periode/GL blijven strikt gescheiden componenttotalen, ook met beide classificatiebronnen actief", () => {
    // Bronproef 2026-09: boekstuk 202650000047 (Hoofdstraat, credit 785000 op GL08830, GEEN OGB) en
    // boekstuk 202690000004 (Driebergen: GL00166 -535000/OGB 3010, GL00167 -100000/geen OGB/geen
    // GL-classificatie, GL08830 +635000/geen OGB). Met GL08830 -> VERKOOPOPBRENGST geconfigureerd,
    // classificeren NU beide GL08830-regels (Hoofdstraat opbrengst ÉN de Driebergen-reclassificatie) als
    // VERKOOPOPBRENGST — dat is correct GL-gedreven gedrag, GEEN gok. GL00167 blijft terecht
    // ongeclassificeerd (geen OGB, geen GL-regel voor 00167 geconfigureerd in deze test) — bewijst dat
    // GL00166/00167 NIET automatisch aan dezelfde verkoop/hetzelfde resultaat gekoppeld worden: elke
    // boeking staat op zichzelf.
    const boekingen: WerkelijkGeplandeVerkoopBoekingRegel[] = [
      boeking({ grootboekrekening: "08830", ogbKostensoort: null, saldo: new Decimal(-785000) }), // Hoofdstraat-opbrengst
      boeking({ grootboekrekening: "00166", ogbKostensoort: "3010", saldo: new Decimal(-535000) }), // Driebergen-boekwaarde ASW
      boeking({ grootboekrekening: "00167", ogbKostensoort: null, saldo: new Decimal(-100000) }), // Driebergen-boekwaarde HW, geen classificatiebron
      boeking({ grootboekrekening: "08830", ogbKostensoort: null, saldo: new Decimal(635000) }), // Driebergen-reclassificatie op 08830
    ];

    const r = berekenWerkelijkGeplandeVerkoop(boekingen, OGB_KLASSIFICATIE_023, GL_KLASSIFICATIE_023);

    // VERKOOPOPBRENGST = -785000 + 635000 = -150000 (beide GL08830-regels, GEEN koppeling met boekwaarde).
    expect(r.perComponent.find((c) => c.component === "VERKOOPOPBRENGST")!.componentTotaal.toString()).toBe("-150000");
    expect(r.perComponent.find((c) => c.component === "BOEKWAARDE_AFBOEKING")!.componentTotaal.toString()).toBe("-535000");
    // GL00167 blijft ongeclassificeerd — GEEN automatische aanname dat het "bij Driebergen hoort" via boekstukSleutel.
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("-100000");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(1);
    // GEEN gecombineerd resultaat — de twee componenten worden nergens tegen elkaar afgezet.
    expect((r as unknown as { verkoopresultaat?: unknown }).verkoopresultaat).toBeUndefined();
  });
});
