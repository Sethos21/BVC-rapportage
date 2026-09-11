import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenBegroteBeheersvergoeding,
  type BgBeheerComplexConfig,
} from "./begroteBeheersvergoeding.js";
import {
  berekenBegroteHuuropbrengsten,
  type BgContractFeiten,
  type BgContractUitkomst,
  type BgHuurAannames,
  type BgHuurMaandRegel,
  type BgHuurResultaat,
  type BgPortefeuilleTotalen,
  type BgRentrollComponent,
} from "./begroteHuuropbrengsten.js";

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((t, w) => t.plus(w), new Decimal(0));
}

// ===== Hulpfuncties voor een handmatig samengestelde, fake Module-1-uitkomst (pure Module-2-unittests) =====

function twaalfMaandRegels(nettoHuur: number | readonly number[]): BgHuurMaandRegel[] {
  return Array.from({ length: 12 }, (_, i) => {
    const bedrag = new Decimal(typeof nettoHuur === "number" ? nettoHuur : nettoHuur[i]!);
    return {
      maand: i + 1,
      brutoHuurZonderIndexatie: bedrag,
      indexatieEffect: new Decimal(0),
      brutoHuurMetIndexatie: bedrag,
      huurkorting: new Decimal(0),
      nettoHuur: bedrag,
      kortingswijzigingToegepast: null,
    };
  });
}

function fakeContract(overrides: Partial<BgContractUitkomst> & { nettoHuurPerMaand?: number | readonly number[] } = {}): BgContractUitkomst {
  const { nettoHuurPerMaand, ...rest } = overrides;
  const regels = rest.regels ?? twaalfMaandRegels(nettoHuurPerMaand ?? 1000);
  return {
    contractnummer: "C1",
    huurdernummer: null,
    huurderNaam: null,
    complexnummer: "001",
    belastOnbelast: "BELAST",
    indexatiePercentageGebruikt: new Decimal(0),
    indexatiePercentageBron: "ALGEMEEN",
    overrideToegepast: null,
    effectieveIndexatiedatum: null,
    regels,
    jaartotaal: {
      brutoHuurZonderIndexatie: som(regels.map((r) => r.brutoHuurZonderIndexatie)),
      indexatieEffect: som(regels.map((r) => r.indexatieEffect)),
      brutoHuurMetIndexatie: som(regels.map((r) => r.brutoHuurMetIndexatie)),
      huurkorting: som(regels.map((r) => r.huurkorting)),
      nettoHuur: som(regels.map((r) => r.nettoHuur)),
    },
    ...rest,
  };
}

function fakeModule1(contracten: BgContractUitkomst[], overrides: Partial<BgHuurResultaat> = {}): BgHuurResultaat {
  const portefeuilleTotalen: BgPortefeuilleTotalen = {
    brutoHuurZonderIndexatie: som(contracten.map((c) => c.jaartotaal.brutoHuurZonderIndexatie)),
    indexatieEffect: som(contracten.map((c) => c.jaartotaal.indexatieEffect)),
    brutoHuurMetIndexatie: som(contracten.map((c) => c.jaartotaal.brutoHuurMetIndexatie)),
    huurkorting: som(contracten.map((c) => c.jaartotaal.huurkorting)),
    nettoHuur: som(contracten.map((c) => c.jaartotaal.nettoHuur)),
    nettoHuurBelast: som(contracten.filter((c) => c.belastOnbelast === "BELAST").map((c) => c.jaartotaal.nettoHuur)),
    nettoHuurOnbelast: som(contracten.filter((c) => c.belastOnbelast === "ONBELAST").map((c) => c.jaartotaal.nettoHuur)),
    nettoHuurOnbekendeBtw: som(contracten.filter((c) => c.belastOnbelast === "ONBEKEND").map((c) => c.jaartotaal.nettoHuur)),
  };
  return {
    begrotingsjaar: 2027,
    bronPeildatum: new Date("2026-09-01T00:00:00.000Z"),
    indexatiePercentageAlgemeen: new Decimal(0),
    contracten,
    portefeuilleTotalen,
    controleVereist: [],
    ...overrides,
  };
}

function config(overrides: Partial<BgBeheerComplexConfig> & { complexnummer: string }): BgBeheerComplexConfig {
  return {
    vastBedragJaar: null,
    vastIndexatiePercentage: null,
    vastIndexatiedatum: null,
    variabelPercentage: null,
    ...overrides,
  };
}

// ===== Hulpfuncties voor ECHTE Module-1-integratietests (dezelfde stijl als begroteHuuropbrengsten.test.ts) =====

function vs01(bedragJaar: number, btwYn: string | null = "Y"): BgRentrollComponent {
  return { vorderingsoort: "01", bedragJaar: new Decimal(bedragJaar), btwYn };
}

function echtContract(overrides: Partial<BgContractFeiten> = {}): BgContractFeiten {
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
    toekomstigeKortingswijzigingen: [],
    ...overrides,
  };
}

function echteAannames(overrides: Partial<BgHuurAannames> = {}): BgHuurAannames {
  return { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3), ...overrides };
}

const BRON_PEILDATUM = new Date("2026-09-01T00:00:00.000Z");

describe("berekenBegroteBeheersvergoeding", () => {
  it("1. alleen vast, geen indexatie: variabel blijft overal 0", () => {
    const module1 = fakeModule1([fakeContract({ complexnummer: "001", nettoHuurPerMaand: 5000 })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [config({ complexnummer: "001", vastBedragJaar: new Decimal(1200) })]);
    const c = resultaat.complexen[0]!;
    expect(c.vastToegepast).toBe(true);
    expect(c.variabelToegepast).toBe(false);
    for (const regel of c.regels) {
      expect(regel.vastVoorIndexatie.toString()).toBe("100");
      expect(regel.vastIndexatieEffect.toString()).toBe("0");
      expect(regel.vastNaIndexatie.toString()).toBe("100");
      expect(regel.variabeleVergoeding.toString()).toBe("0");
      expect(regel.totaleVergoeding.toString()).toBe("100");
    }
    expect(c.jaartotaal.totaleVergoeding.toString()).toBe("1200");
  });

  it("2. alleen variabel: vast blijft overal 0", () => {
    const module1 = fakeModule1([fakeContract({ complexnummer: "001", nettoHuurPerMaand: 5000 })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [config({ complexnummer: "001", variabelPercentage: new Decimal(5) })]);
    const c = resultaat.complexen[0]!;
    expect(c.vastToegepast).toBe(false);
    expect(c.variabelToegepast).toBe(true);
    for (const regel of c.regels) {
      expect(regel.vastNaIndexatie.toString()).toBe("0");
      expect(regel.variabeleVergoeding.toString()).toBe("250"); // 5% van 5000
    }
    expect(c.jaartotaal.totaleVergoeding.toString()).toBe("3000"); // 250 * 12
  });

  it("3. vast + variabel: beide componenten tellen op tot het totaal", () => {
    const module1 = fakeModule1([fakeContract({ complexnummer: "001", nettoHuurPerMaand: 5000 })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [
      config({ complexnummer: "001", vastBedragJaar: new Decimal(1200), variabelPercentage: new Decimal(5) }),
    ]);
    const c = resultaat.complexen[0]!;
    expect(c.vastToegepast).toBe(true);
    expect(c.variabelToegepast).toBe(true);
    const regel = c.regels[0]!;
    expect(regel.vastNaIndexatie.toString()).toBe("100");
    expect(regel.variabeleVergoeding.toString()).toBe("250");
    expect(regel.totaleVergoeding.toString()).toBe("350");
  });

  it("4. vast-indexatie per 1 januari: alle 12 maanden krijgen het effect", () => {
    const module1 = fakeModule1([fakeContract({ complexnummer: "001", nettoHuurPerMaand: 0 })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [
      config({
        complexnummer: "001",
        vastBedragJaar: new Decimal(1200),
        vastIndexatiePercentage: new Decimal(10),
        vastIndexatiedatum: new Date("2027-01-01T00:00:00.000Z"),
      }),
    ]);
    const c = resultaat.complexen[0]!;
    for (const regel of c.regels) {
      expect(regel.vastIndexatieEffect.toString()).toBe("10"); // 10% van 100
      expect(regel.vastNaIndexatie.toString()).toBe("110");
    }
  });

  it("5. vast-indexatie per 1 augustus: juli oud, augustus nieuw", () => {
    const module1 = fakeModule1([fakeContract({ complexnummer: "001", nettoHuurPerMaand: 0 })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [
      config({
        complexnummer: "001",
        vastBedragJaar: new Decimal(1200),
        vastIndexatiePercentage: new Decimal(10),
        vastIndexatiedatum: new Date("2027-08-15T00:00:00.000Z"), // dag 15, moet toch de VOLLEDIGE maand augustus gelden
      }),
    ]);
    const c = resultaat.complexen[0]!;
    const juli = c.regels.find((r) => r.maand === 7)!;
    const augustus = c.regels.find((r) => r.maand === 8)!;
    expect(juli.vastNaIndexatie.toString()).toBe("100");
    expect(augustus.vastNaIndexatie.toString()).toBe("110");
    expect(augustus.vastIndexatieEffect.toString()).toBe("10");
  });

  it("6. verschillende variabele percentages voor twee complexen blijven onafhankelijk", () => {
    const module1 = fakeModule1([
      fakeContract({ contractnummer: "C1", complexnummer: "001", nettoHuurPerMaand: 5000 }),
      fakeContract({ contractnummer: "C2", complexnummer: "002", nettoHuurPerMaand: 5000 }),
    ]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [
      config({ complexnummer: "001", variabelPercentage: new Decimal(2) }),
      config({ complexnummer: "002", variabelPercentage: new Decimal(6) }),
    ]);
    const c1 = resultaat.complexen.find((c) => c.complexnummer === "001")!;
    const c2 = resultaat.complexen.find((c) => c.complexnummer === "002")!;
    expect(c1.regels[0]!.variabeleVergoeding.toString()).toBe("100"); // 2% van 5000
    expect(c2.regels[0]!.variabeleVergoeding.toString()).toBe("300"); // 6% van 5000
  });

  it("7. variabel rekent over NETTO huur (ná huurkorting), niet over bruto", () => {
    const brutoRegels: BgHuurMaandRegel[] = Array.from({ length: 12 }, (_, i) => ({
      maand: i + 1,
      brutoHuurZonderIndexatie: new Decimal(10000),
      indexatieEffect: new Decimal(0),
      brutoHuurMetIndexatie: new Decimal(10000),
      huurkorting: new Decimal(4000), // grote korting: netto wijkt duidelijk af van bruto
      nettoHuur: new Decimal(6000),
      kortingswijzigingToegepast: null,
    }));
    const module1 = fakeModule1([fakeContract({ complexnummer: "001", regels: brutoRegels })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [config({ complexnummer: "001", variabelPercentage: new Decimal(10) })]);
    const c = resultaat.complexen[0]!;
    expect(c.regels[0]!.variabeleVergoeding.toString()).toBe("600"); // 10% van 6000 (netto), NIET 1000 (10% van 10000 bruto)
  });

  it("8. variabele maandbedragen volgen de Module-1-maandbedragen, niet jaartotaal/12", () => {
    const module1 = fakeModule1([
      fakeContract({ complexnummer: "001", nettoHuurPerMaand: [1000, 1000, 1000, 1000, 1000, 1000, 2000, 2000, 2000, 2000, 2000, 2000] }),
    ]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [config({ complexnummer: "001", variabelPercentage: new Decimal(10) })]);
    const c = resultaat.complexen[0]!;
    expect(c.regels[0]!.variabeleVergoeding.toString()).toBe("100"); // 10% van 1000
    expect(c.regels[6]!.variabeleVergoeding.toString()).toBe("200"); // 10% van 2000 (juli, na de knik)
    // Som van de 12 maandbedragen = 10% van het jaartotaal — geen aparte jaarformule nodig.
    const jaarNetto = c.jaartotaal.nettoHuurGrondslag;
    expect(c.jaartotaal.variabeleVergoeding.toString()).toBe(jaarNetto.times(10).dividedBy(100).toString());
  });

  it("9. contractstart midden in het jaar (echte Module 1) werkt automatisch door in de variabele vergoeding", () => {
    const module1 = berekenBegroteHuuropbrengsten(
      [echtContract({ ingangsdatum: new Date("2027-04-15T00:00:00.000Z") })],
      [],
      echteAannames(),
      BRON_PEILDATUM,
    );
    const resultaat = berekenBegroteBeheersvergoeding(module1, [config({ complexnummer: "001", variabelPercentage: new Decimal(10) })]);
    const c = resultaat.complexen[0]!;
    const januari = c.regels.find((r) => r.maand === 1)!;
    const april = c.regels.find((r) => r.maand === 4)!;
    const mei = c.regels.find((r) => r.maand === 5)!;
    const module1Contract = module1.contracten[0]!;
    expect(januari.variabeleVergoeding.toString()).toBe("0"); // nog geen huur vóór ingangsdatum
    expect(april.variabeleVergoeding.toString()).toBe(module1Contract.regels[3]!.nettoHuur.times(10).dividedBy(100).toString());
    expect(mei.variabeleVergoeding.toString()).toBe(module1Contract.regels[4]!.nettoHuur.times(10).dividedBy(100).toString());
    expect(mei.variabeleVergoeding.greaterThan(0)).toBe(true);
  });

  it("9b. contracteinde midden in het jaar (echte Module 1) werkt automatisch door in de variabele vergoeding", () => {
    const module1 = berekenBegroteHuuropbrengsten(
      [echtContract({ einddatum: new Date("2027-09-10T00:00:00.000Z") })],
      [],
      echteAannames(),
      BRON_PEILDATUM,
    );
    const resultaat = berekenBegroteBeheersvergoeding(module1, [config({ complexnummer: "001", variabelPercentage: new Decimal(10) })]);
    const c = resultaat.complexen[0]!;
    const december = c.regels.find((r) => r.maand === 12)!;
    expect(december.variabeleVergoeding.toString()).toBe("0"); // contract al beëindigd
  });

  it("10. Module-1-huurindexatie (echte Module 1) werkt automatisch door in de variabele vergoeding", () => {
    const module1 = berekenBegroteHuuropbrengsten(
      [echtContract({ indexatiedatum: new Date("2027-08-01T00:00:00.000Z") })],
      [],
      echteAannames({ indexatiePercentage: new Decimal(3) }),
      BRON_PEILDATUM,
    );
    const resultaat = berekenBegroteBeheersvergoeding(module1, [config({ complexnummer: "001", variabelPercentage: new Decimal(10) })]);
    const c = resultaat.complexen[0]!;
    const juli = c.regels.find((r) => r.maand === 7)!;
    const augustus = c.regels.find((r) => r.maand === 8)!;
    expect(augustus.variabeleVergoeding.greaterThan(juli.variabeleVergoeding)).toBe(true); // huurindexatie werkt door
    const module1Contract = module1.contracten[0]!;
    expect(augustus.variabeleVergoeding.toString()).toBe(module1Contract.regels[7]!.nettoHuur.times(10).dividedBy(100).toString());
  });

  it("11. ontbrekende beheerconfiguratie voor een complex mét begrote huur geeft een controle-item", () => {
    const module1 = fakeModule1([fakeContract({ complexnummer: "001", nettoHuurPerMaand: 5000 })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, []);
    expect(resultaat.complexen).toHaveLength(1);
    expect(resultaat.complexen[0]!.vastToegepast).toBe(false);
    expect(resultaat.complexen[0]!.variabelToegepast).toBe(false);
    expect(
      resultaat.controleVereist.some((i) => i.complexnummer === "001" && i.ernst === "WAARSCHUWING" && i.bericht.includes("geen beheerconfiguratie")),
    ).toBe(true);
  });

  it("12. beheerconfiguratie voor een complex zonder begrote huur: vast blijft berekend, variabel is 0", () => {
    const module1 = fakeModule1([]); // geen enkel contract, dus geen huur voor complex 999
    const resultaat = berekenBegroteBeheersvergoeding(module1, [
      config({ complexnummer: "999", vastBedragJaar: new Decimal(1200), variabelPercentage: new Decimal(5) }),
    ]);
    const c = resultaat.complexen.find((c) => c.complexnummer === "999")!;
    expect(c.vastToegepast).toBe(true);
    expect(c.jaartotaal.vastNaIndexatie.toString()).toBe("1200");
    expect(c.jaartotaal.variabeleVergoeding.toString()).toBe("0");
    expect(
      resultaat.controleVereist.some((i) => i.complexnummer === "999" && i.ernst === "INFORMATIEF" && i.bericht.includes("geen begrote huurgrondslag")),
    ).toBe(true);
  });

  it("13. netto huur met complexnummer=null wordt niet aan een complex toegewezen en geeft een controle-item", () => {
    const module1 = fakeModule1([fakeContract({ contractnummer: "C-ZONDER-COMPLEX", complexnummer: null, nettoHuurPerMaand: 1000 })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, []);
    expect(resultaat.complexen).toHaveLength(0); // geen complex om aan toe te wijzen
    expect(
      resultaat.controleVereist.some(
        (i) => i.complexnummer === null && i.ernst === "WAARSCHUWING" && i.bericht.includes("C-ZONDER-COMPLEX") && i.bericht.includes("geen complexnummer"),
      ),
    ).toBe(true);
  });

  it("14. dubbele beheerconfiguratie voor hetzelfde complex: KRITIEK, geen stille keuze, geen berekening", () => {
    const module1 = fakeModule1([fakeContract({ complexnummer: "001", nettoHuurPerMaand: 5000 })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [
      config({ complexnummer: "001", vastBedragJaar: new Decimal(1200) }),
      config({ complexnummer: "001", vastBedragJaar: new Decimal(2400) }),
    ]);
    expect(resultaat.complexen.find((c) => c.complexnummer === "001" && c.vastToegepast)).toBeUndefined();
    expect(
      resultaat.controleVereist.some((i) => i.complexnummer === "001" && i.ernst === "KRITIEK" && i.bericht.includes("niet stilzwijgend één gekozen")),
    ).toBe(true);
    // Geen dubbele "config ontbreekt"-melding erbovenop.
    expect(resultaat.controleVereist.filter((i) => i.complexnummer === "001").length).toBe(1);
  });

  it("15. negatief vast bedrag is ongeldig: vast deel niet toegepast, KRITIEK", () => {
    const module1 = fakeModule1([fakeContract({ complexnummer: "001", nettoHuurPerMaand: 5000 })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [config({ complexnummer: "001", vastBedragJaar: new Decimal(-100) })]);
    const c = resultaat.complexen[0]!;
    expect(c.vastToegepast).toBe(false);
    expect(resultaat.controleVereist.some((i) => i.ernst === "KRITIEK" && i.bericht.includes("vastBedragJaar is negatief"))).toBe(true);
  });

  it("15b. negatief variabel percentage is ongeldig: variabel deel niet toegepast, KRITIEK", () => {
    const module1 = fakeModule1([fakeContract({ complexnummer: "001", nettoHuurPerMaand: 5000 })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [config({ complexnummer: "001", variabelPercentage: new Decimal(-2) })]);
    const c = resultaat.complexen[0]!;
    expect(c.variabelToegepast).toBe(false);
    expect(resultaat.controleVereist.some((i) => i.ernst === "KRITIEK" && i.bericht.includes("variabelPercentage is negatief"))).toBe(true);
  });

  it("16. twee complexen, 070-achtig: 2% versus 1,5%, beide met eigen huurgrondslag", () => {
    const module1 = fakeModule1([
      fakeContract({ contractnummer: "ROOISE-ZOOM", complexnummer: "001", nettoHuurPerMaand: 50000 }),
      fakeContract({ contractnummer: "PWA", complexnummer: "004", nettoHuurPerMaand: 25000 }),
    ]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [
      config({ complexnummer: "001", variabelPercentage: new Decimal(2) }),
      config({ complexnummer: "004", variabelPercentage: new Decimal(1.5) }),
    ]);
    const c001 = resultaat.complexen.find((c) => c.complexnummer === "001")!;
    const c004 = resultaat.complexen.find((c) => c.complexnummer === "004")!;
    expect(c001.regels[0]!.variabeleVergoeding.toString()).toBe("1000"); // 2% van 50000
    expect(c004.regels[0]!.variabeleVergoeding.toString()).toBe("375"); // 1,5% van 25000
  });

  it("17. portefeuilletotaal is uitsluitend de som van de complexuitkomsten", () => {
    const module1 = fakeModule1([
      fakeContract({ contractnummer: "C1", complexnummer: "001", nettoHuurPerMaand: 5000 }),
      fakeContract({ contractnummer: "C2", complexnummer: "002", nettoHuurPerMaand: 3000 }),
    ]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [
      config({ complexnummer: "001", vastBedragJaar: new Decimal(1200), variabelPercentage: new Decimal(2) }),
      config({ complexnummer: "002", vastBedragJaar: new Decimal(600), variabelPercentage: new Decimal(4) }),
    ]);
    const handmatigeSom = resultaat.complexen.reduce((s, c) => s.plus(c.jaartotaal.totaleVergoeding), new Decimal(0));
    expect(resultaat.portefeuilleTotalen.totaleVergoeding.toString()).toBe(handmatigeSom.toString());
  });

  it("18. negatief vast-indexatiepercentage is een toegestane verlaging en wordt correct doorgerekend", () => {
    const module1 = fakeModule1([fakeContract({ complexnummer: "001", nettoHuurPerMaand: 0 })]);
    const resultaat = berekenBegroteBeheersvergoeding(module1, [
      config({
        complexnummer: "001",
        vastBedragJaar: new Decimal(1200),
        vastIndexatiePercentage: new Decimal(-10),
        vastIndexatiedatum: new Date("2027-07-01T00:00:00.000Z"),
      }),
    ]);
    const c = resultaat.complexen[0]!;
    const juni = c.regels.find((r) => r.maand === 6)!;
    const juli = c.regels.find((r) => r.maand === 7)!;
    expect(juni.vastNaIndexatie.toString()).toBe("100");
    expect(juli.vastIndexatieEffect.toString()).toBe("-10"); // -10% van 100
    expect(juli.vastNaIndexatie.toString()).toBe("90");
    expect(resultaat.controleVereist.filter((i) => i.ernst === "KRITIEK")).toHaveLength(0); // geen fout, dit is toegestaan
  });
});
