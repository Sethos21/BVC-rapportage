import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenBegroteHuuropbrengsten,
  type BgContractFeiten,
  type BgContractOverride,
  type BgHuurAannames,
  type BgRentrollComponent,
} from "./begroteHuuropbrengsten.js";

function vs01(bedragJaar: number, btwYn: string | null = "Y"): BgRentrollComponent {
  return { vorderingsoort: "01", bedragJaar: new Decimal(bedragJaar), btwYn };
}
function vs13(bedragJaar: number, btwYn: string | null = "Y"): BgRentrollComponent {
  return { vorderingsoort: "13", bedragJaar: new Decimal(bedragJaar), btwYn };
}

function contract(overrides: Partial<BgContractFeiten> = {}): BgContractFeiten {
  return {
    bedrijfsnr: "070",
    contractnummer: "C1",
    huurdernummer: "H1",
    huurderNaam: "Test Huurder BV",
    complexnummer: "001",
    rentrollComponenten: [vs01(120000)],
    ingangsdatum: new Date("2020-01-01T00:00:00.000Z"),
    einddatum: null,
    indexatiedatum: null,
    indexatieHerhalingMaanden: 12,
    ...overrides,
  };
}

function aannames(overrides: Partial<BgHuurAannames> = {}): BgHuurAannames {
  return { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3), ...overrides };
}

describe("berekenBegroteHuuropbrengsten", () => {
  it("contract volledig jaar zonder indexatie: elke maand gelijk, geen effect", () => {
    const resultaat = berekenBegroteHuuropbrengsten([contract()], [], aannames());
    const c = resultaat.contracten[0]!;
    expect(c.regels).toHaveLength(12);
    for (const regel of c.regels) {
      expect(regel.brutoHuurZonderIndexatie.toString()).toBe("10000");
      expect(regel.indexatieEffect.toString()).toBe("0");
      expect(regel.brutoHuurMetIndexatie.toString()).toBe("10000");
      expect(regel.nettoHuur.toString()).toBe("10000");
    }
    expect(c.effectieveIndexatiedatum).toBeNull();
    expect(c.jaartotaal.nettoHuur.toString()).toBe("120000");
  });

  it("indexatie per 1 januari: alle 12 maanden krijgen het indexatie-effect", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ indexatiedatum: new Date("2027-01-01T00:00:00.000Z") })],
      [],
      aannames(),
    );
    const c = resultaat.contracten[0]!;
    for (const regel of c.regels) {
      expect(regel.indexatieEffect.toString()).toBe("300");
      expect(regel.brutoHuurMetIndexatie.toString()).toBe("10300");
    }
    expect(c.jaartotaal.indexatieEffect.toString()).toBe("3600");
    expect(c.jaartotaal.brutoHuurMetIndexatie.toString()).toBe("123600");
  });

  it("indexatie midden in het jaar: vóór de indexatiemaand geen effect, daarna wel", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ indexatiedatum: new Date("2027-05-01T00:00:00.000Z") })],
      [],
      aannames(),
    );
    const c = resultaat.contracten[0]!;
    for (const regel of c.regels) {
      if (regel.maand < 5) {
        expect(regel.indexatieEffect.toString()).toBe("0");
      } else {
        expect(regel.indexatieEffect.toString()).toBe("300");
      }
    }
  });

  it("OB-004-voorbeeld: indexatiedatum 1 augustus — juli oude huur, augustus/september nieuwe huur", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ indexatiedatum: new Date("2027-08-01T00:00:00.000Z") })],
      [],
      aannames(),
    );
    const c = resultaat.contracten[0]!;
    const juli = c.regels.find((r) => r.maand === 7)!;
    const augustus = c.regels.find((r) => r.maand === 8)!;
    const september = c.regels.find((r) => r.maand === 9)!;
    expect(juli.brutoHuurMetIndexatie.toString()).toBe("10000");
    expect(augustus.brutoHuurMetIndexatie.toString()).toBe("10300");
    expect(september.brutoHuurMetIndexatie.toString()).toBe("10300");
  });

  it("businessregel: indexatie werkt op maandniveau, geen dagpro-rata binnen de indexatiemaand zelf", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ indexatiedatum: new Date("2027-08-15T00:00:00.000Z") })], // dag 15, niet dag 1
      [],
      aannames(),
    );
    const c = resultaat.contracten[0]!;
    const juli = c.regels.find((r) => r.maand === 7)!;
    const augustus = c.regels.find((r) => r.maand === 8)!;
    // Augustus krijgt de VOLLEDIGE maand het nieuwe niveau, ondanks dat de indexatiedatum pas op de 15e valt.
    expect(juli.brutoHuurMetIndexatie.toString()).toBe("10000");
    expect(augustus.brutoHuurMetIndexatie.toString()).toBe("10300");
    expect(augustus.indexatieEffect.toString()).toBe("300"); // volledig maandeffect, geen dagfractie van het effect zelf
  });

  it("contractstart midden in het jaar: dagfractie-tijdsevenredig vanaf de ingangsmaand", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ ingangsdatum: new Date("2027-04-15T00:00:00.000Z") })],
      [],
      aannames(),
    );
    const c = resultaat.contracten[0]!;
    for (let maand = 1; maand <= 3; maand += 1) {
      expect(c.regels.find((r) => r.maand === maand)!.brutoHuurZonderIndexatie.toString()).toBe("0");
    }
    // April heeft 30 dagen; contract actief vanaf de 15e t/m de 30e = 16 dagen.
    const april = c.regels.find((r) => r.maand === 4)!;
    expect(april.brutoHuurZonderIndexatie.toString()).toBe(new Decimal(10000).times(16).dividedBy(30).toString());
    for (let maand = 5; maand <= 12; maand += 1) {
      expect(c.regels.find((r) => r.maand === maand)!.brutoHuurZonderIndexatie.toString()).toBe("10000");
    }
  });

  it("contracteinde midden in het jaar: dagfractie-tijdsevenredig t/m de einddatum (inclusief)", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ einddatum: new Date("2027-09-10T00:00:00.000Z") })],
      [],
      aannames(),
    );
    const c = resultaat.contracten[0]!;
    for (let maand = 1; maand <= 8; maand += 1) {
      expect(c.regels.find((r) => r.maand === maand)!.brutoHuurZonderIndexatie.toString()).toBe("10000");
    }
    // September heeft 30 dagen; contract actief t/m de 10e (inclusief) = 10 dagen.
    const september = c.regels.find((r) => r.maand === 9)!;
    expect(september.brutoHuurZonderIndexatie.toString()).toBe(new Decimal(10000).times(10).dividedBy(30).toString());
    for (let maand = 10; maand <= 12; maand += 1) {
      expect(c.regels.find((r) => r.maand === maand)!.brutoHuurZonderIndexatie.toString()).toBe("0");
    }
  });

  it("VS=13-huurkorting wordt tijdsevenredig verdeeld en afgetrokken, nooit zelf geïndexeerd", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ rentrollComponenten: [vs01(120000), vs13(-6000)], indexatiedatum: new Date("2027-01-01T00:00:00.000Z") })],
      [],
      aannames(),
    );
    const c = resultaat.contracten[0]!;
    for (const regel of c.regels) {
      expect(regel.huurkorting.toString()).toBe("500"); // 6000/12, positief gepresenteerd
      expect(regel.brutoHuurMetIndexatie.toString()).toBe("10300"); // korting raakt de indexatiebasis niet
      expect(regel.nettoHuur.toString()).toBe("9800"); // 10300 - 500
    }
    expect(c.jaartotaal.huurkorting.toString()).toBe("6000");
  });

  it("meerdere VS=01-componenten worden correct gesommeerd tot de bruto jaarhuur", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ rentrollComponenten: [vs01(80000), vs01(40000)] })],
      [],
      aannames(),
    );
    const c = resultaat.contracten[0]!;
    expect(c.regels[0]!.brutoHuurZonderIndexatie.toString()).toBe("10000"); // (80000+40000)/12
    expect(c.jaartotaal.brutoHuurZonderIndexatie.toString()).toBe("120000");
    expect(resultaat.controleVereist.some((i) => i.bericht.includes("geen (geldige)"))).toBe(false);
  });

  it("belast/onbelast: BTW_Y_N=Y -> BELAST, BTW_Y_N=N -> ONBELAST", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [
        contract({ contractnummer: "C-BELAST", rentrollComponenten: [vs01(120000, "Y")] }),
        contract({ contractnummer: "C-ONBELAST", rentrollComponenten: [vs01(120000, "N")] }),
      ],
      [],
      aannames(),
    );
    const belast = resultaat.contracten.find((c) => c.contractnummer === "C-BELAST")!;
    const onbelast = resultaat.contracten.find((c) => c.contractnummer === "C-ONBELAST")!;
    expect(belast.belastOnbelast).toBe("BELAST");
    expect(onbelast.belastOnbelast).toBe("ONBELAST");
    expect(resultaat.portefeuilleTotalen.nettoHuurBelast.toString()).toBe("120000");
    expect(resultaat.portefeuilleTotalen.nettoHuurOnbelast.toString()).toBe("120000");
  });

  it("onbekende/inconsistente BTW-classificatie: ONBEKEND + WAARSCHUWING, huur wordt wel berekend", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ rentrollComponenten: [vs01(120000, "Y"), vs13(-6000, "N")] })],
      [],
      aannames(),
    );
    const c = resultaat.contracten[0]!;
    expect(c.belastOnbelast).toBe("ONBEKEND");
    expect(c.jaartotaal.brutoHuurZonderIndexatie.toString()).toBe("120000"); // berekening gaat gewoon door
    expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("niet eenduidig"))).toBe(true);
    expect(resultaat.portefeuilleTotalen.nettoHuurOnbekendeBtw.toString()).toBe(c.jaartotaal.nettoHuur.toString());
  });

  it("contractoverride: systeemwaarde blijft zichtbaar, override wordt toegepast en is herleidbaar", () => {
    const override: BgContractOverride = { contractnummer: "C1", indexatiePercentage: new Decimal(5), scope: "STRUCTUREEL", reden: "Onderhandeld" };
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ indexatiedatum: new Date("2027-01-01T00:00:00.000Z") })],
      [override],
      aannames({ indexatiePercentage: new Decimal(3) }),
    );
    const c = resultaat.contracten[0]!;
    expect(resultaat.indexatiePercentageAlgemeen.toString()).toBe("3"); // systeemwaarde blijft beschikbaar
    expect(c.indexatiePercentageGebruikt.toString()).toBe("5");
    expect(c.indexatiePercentageBron).toBe("OVERRIDE");
    expect(c.overrideToegepast).toEqual({ scope: "STRUCTUREEL", reden: "Onderhandeld" });
    expect(c.regels[0]!.indexatieEffect.toString()).toBe("500"); // 10000 * 5%
  });

  it("projectie van de indexatiedatum via Verhoging_opnieuw_na naar het begrotingsjaar", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ indexatiedatum: new Date("2025-07-01T00:00:00.000Z"), indexatieHerhalingMaanden: 12 })],
      [],
      aannames({ begrotingsjaar: 2027 }),
    );
    const c = resultaat.contracten[0]!;
    expect(c.effectieveIndexatiedatum).toEqual(new Date("2027-07-01T00:00:00.000Z"));
    const juni = c.regels.find((r) => r.maand === 6)!;
    const juli = c.regels.find((r) => r.maand === 7)!;
    expect(juni.indexatieEffect.toString()).toBe("0");
    expect(juli.indexatieEffect.toString()).toBe("300");
  });

  it("onvoldoende betrouwbare indexatiebron: geen gok, controle-item, geen indexatie toegepast", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ indexatiedatum: new Date("2025-07-01T00:00:00.000Z"), indexatieHerhalingMaanden: null })],
      [],
      aannames({ begrotingsjaar: 2027 }),
    );
    const c = resultaat.contracten[0]!;
    expect(c.effectieveIndexatiedatum).toBeNull();
    expect(c.jaartotaal.indexatieEffect.toString()).toBe("0");
    expect(
      resultaat.controleVereist.some(
        (i) => i.ernst === "WAARSCHUWING" && i.contractnummer === "C1" && i.bericht.includes("geen betrouwbaar herhalingsinterval"),
      ),
    ).toBe(true);
  });

  it("tekenconventie: een positieve VS=13 of negatieve VS=01 wordt als KRITIEK gemeld en buiten de som gehouden", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ rentrollComponenten: [vs01(-1000), vs13(500)] })],
      [],
      aannames(),
    );
    const c = resultaat.contracten[0]!;
    expect(c.jaartotaal.brutoHuurZonderIndexatie.toString()).toBe("0");
    expect(c.jaartotaal.huurkorting.toString()).toBe("0");
    expect(resultaat.controleVereist.filter((i) => i.ernst === "KRITIEK")).toHaveLength(2);
  });

  it("portefeuilletotalen zijn uitsluitend afgeleid uit de contractuitkomsten (geen aparte optelling)", () => {
    const resultaat = berekenBegroteHuuropbrengsten(
      [contract({ contractnummer: "C1" }), contract({ contractnummer: "C2", rentrollComponenten: [vs01(60000)] })],
      [],
      aannames(),
    );
    const handmatigeSom = resultaat.contracten.reduce((s, c) => s.plus(c.jaartotaal.nettoHuur), new Decimal(0));
    expect(resultaat.portefeuilleTotalen.nettoHuur.toString()).toBe(handmatigeSom.toString());
    expect(resultaat.portefeuilleTotalen.nettoHuur.toString()).toBe("180000");
  });
});
