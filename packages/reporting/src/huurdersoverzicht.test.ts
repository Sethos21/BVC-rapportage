import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { bepaalContracteindeStatus, berekenHuurdersoverzicht, type HoContractRegel, type HoRentrollRegel } from "./huurdersoverzicht.js";

const PEILDATUM = new Date("2026-07-31T00:00:00.000Z");

function contract(overrides: Partial<HoContractRegel> = {}): HoContractRegel {
  return {
    bedrijfsnr: "070",
    contractnummer: "C1",
    huurdernummer: "H1",
    huurderNaam: "Test Huurder BV",
    complexnummer: "001",
    complexomschrijving: "Villa I",
    unitnummer: "0001",
    ingangsdatum: new Date("2020-01-01T00:00:00.000Z"),
    afloopdatum: null,
    checkLopendContract: "Ja",
    expiratieExpiratiedatum: new Date("2029-12-31T00:00:00.000Z"),
    expiratieOpzegdatum: new Date("2028-12-31T00:00:00.000Z"),
    waarborgsom: new Decimal(0),
    verhogingDatum: new Date("2027-07-01T00:00:00.000Z"),
    verhogingJaarVlgd: "2027",
    verhogingPeriodeVlgd: "07",
    verhogingPercentage: new Decimal(0),
    verhogingMethode: "Prijsindex",
    omschrijvingIndextabel: "CPI 2025 = 100",
    ...overrides,
  };
}

function rentrollRegel(overrides: Partial<HoRentrollRegel> = {}): HoRentrollRegel {
  return {
    contractnummer: "C1",
    vorderingsoort: "01",
    complexnummer: "001",
    unitnummer: "0001",
    prolongatieBedragJaar: new Decimal(37318.8),
    gehuurdOppervlak: new Decimal(320),
    serviceVoorschotJaar: new Decimal(21600),
    rapportageDatum: PEILDATUM,
    contractExpiratiedatum: new Date("2029-12-31T00:00:00.000Z"),
    contractOpzegdatum: new Date("2028-12-31T00:00:00.000Z"),
    ...overrides,
  };
}

describe("bepaalContracteindeStatus", () => {
  it("classificeert de vier looptijd-drempels en onbekend", () => {
    expect(bepaalContracteindeStatus(null, PEILDATUM).status).toBe("ONBEKEND");
    expect(bepaalContracteindeStatus(new Date("2026-08-01T00:00:00.000Z"), PEILDATUM).status).toBe("VERLOOPT_BINNENKORT");
    expect(bepaalContracteindeStatus(new Date("2028-06-01T00:00:00.000Z"), PEILDATUM).status).toBe("AANDACHT");
    expect(bepaalContracteindeStatus(new Date("2030-01-01T00:00:00.000Z"), PEILDATUM).status).toBe("GEEN_URGENTIE");
    expect(bepaalContracteindeStatus(new Date("2026-01-01T00:00:00.000Z"), PEILDATUM).status).toBe("EXPIRATIEDATUM_GEPASSEERD");
  });

  it("levert restlooptijdDagen als bekend getal, negatief bij een gepasseerde datum", () => {
    const resultaat = bepaalContracteindeStatus(new Date("2026-01-01T00:00:00.000Z"), PEILDATUM);
    expect(resultaat.restlooptijdDagen).toEqual({ type: "bekend", waarde: -211 });
  });
});

describe("berekenHuurdersoverzicht", () => {
  it("bouwt één regel per contract met bruto/netto huur, m² en €/m²", () => {
    const resultaat = berekenHuurdersoverzicht([contract()], [rentrollRegel()]);

    expect(resultaat.contracten).toHaveLength(1);
    const c1 = resultaat.contracten[0]!;
    expect(c1.huur.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal(37318.8) });
    expect(c1.huur.huurkorting).toEqual({ type: "bekend", waarde: new Decimal(0) });
    expect(c1.huur.nettoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal(37318.8) });
    expect(c1.huur.gehuurdOppervlak).toEqual({ type: "bekend", waarde: new Decimal(320) });
    expect((c1.huur.brutoHuurPerM2 as { waarde: Decimal }).waarde.toNumber()).toBeCloseTo(116.62, 2);
    expect(c1.servicekostenvoorschotJaar?.toString()).toBe("21600");
    expect(c1.objectomschrijving).toBe("Villa I");
    expect(c1.status).toBe("GEEN_URGENTIE");
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("splitst bruto/netto bij een 13-kortingsregel, korting blijft apart zichtbaar", () => {
    const resultaat = berekenHuurdersoverzicht(
      [contract()],
      [rentrollRegel(), rentrollRegel({ vorderingsoort: "13", prolongatieBedragJaar: new Decimal(-6000), gehuurdOppervlak: new Decimal(0) })],
    );
    const c1 = resultaat.contracten[0]!;
    expect(c1.huur.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal(37318.8) });
    expect(c1.huur.huurkorting).toEqual({ type: "bekend", waarde: new Decimal(6000) });
    expect(c1.huur.nettoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal(31318.8) });
  });

  it("toont GEEN unitnummer als contracten dit niet koppelt (070-contract 0000000043) — nooit afgeleid", () => {
    const resultaat = berekenHuurdersoverzicht(
      [contract({ contractnummer: "0000000043", unitnummer: null, complexnummer: "001" })],
      [rentrollRegel({ contractnummer: "0000000043", unitnummer: null, prolongatieBedragJaar: new Decimal(92875.92), gehuurdOppervlak: new Decimal(750), serviceVoorschotJaar: new Decimal(59700) })],
    );
    const c = resultaat.contracten[0]!;
    expect(c.unitnummer).toBeNull();
    expect(c.huur.gehuurdOppervlak).toEqual({ type: "bekend", waarde: new Decimal(750) });
    expect(resultaat.controleVereist.some((i) => i.contractnummer === "0000000043" && i.bericht.includes("geen unitnummer"))).toBe(true);
  });

  it("meldt een complexnummer-mismatch tussen contracten en rentroll als WAARSCHUWING", () => {
    const resultaat = berekenHuurdersoverzicht([contract({ complexnummer: "001" })], [rentrollRegel({ complexnummer: "002" })]);
    expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("complexnummer"))).toBe(true);
  });

  it("meldt een afwijkende expiratiedatum tussen contracten en rentroll, contracten blijft leidend", () => {
    const resultaat = berekenHuurdersoverzicht(
      [contract({ expiratieExpiratiedatum: new Date("2029-12-31T00:00:00.000Z") })],
      [rentrollRegel({ contractExpiratiedatum: new Date("2030-01-15T00:00:00.000Z") })],
    );
    const c1 = resultaat.contracten[0]!;
    expect(c1.contracteinde.expiratieExpiratiedatum).toEqual(new Date("2029-12-31T00:00:00.000Z"));
    expect(c1.contracteinde.expiratieExpiratiedatumRentroll).toEqual(new Date("2030-01-15T00:00:00.000Z"));
    expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("wijkt af van rentroll"))).toBe(true);
  });

  it("onderscheidt waarborgsom 0 (geldig) van ontbrekend (null, INFORMATIEF gemeld)", () => {
    const metNul = berekenHuurdersoverzicht([contract({ waarborgsom: new Decimal(0) })], [rentrollRegel()]);
    expect(metNul.contracten[0]!.waarborgsom).toEqual(new Decimal(0));
    expect(metNul.controleVereist.some((i) => i.bericht.includes("waarborgsom niet geregistreerd"))).toBe(false);

    const zonder = berekenHuurdersoverzicht([contract({ waarborgsom: null })], [rentrollRegel()]);
    expect(zonder.contracten[0]!.waarborgsom).toBeNull();
    expect(zonder.controleVereist.some((i) => i.bericht.includes("waarborgsom niet geregistreerd"))).toBe(true);
  });

  it("markeert EXPIRATIEDATUM_GEPASSEERD als WAARSCHUWING, niet als beëindigd contract", () => {
    const resultaat = berekenHuurdersoverzicht([contract({ expiratieExpiratiedatum: new Date("2026-01-01T00:00:00.000Z") })], [rentrollRegel({ contractExpiratiedatum: new Date("2026-01-01T00:00:00.000Z") })]);
    expect(resultaat.contracten[0]!.status).toBe("EXPIRATIEDATUM_GEPASSEERD");
    expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("betekent NIET automatisch"))).toBe(true);
  });

  describe("070_Rooise_Zoom regressie — echte contract-huurder-diagnose-data (2026-08-27)", () => {
    // Exacte cijfers uit de door de gebruiker gedraaide contract-huurder-diagnose (12 contracten,
    // boekjaar 2026, bronPeildatum 2026-07-31) — som moet terugaansluiten op het al-bevestigde
    // huur-kerncijfers-regressiepunt: bruto € 687.900,88, huurkortingen € 13.920,00, netto
    // € 673.980,88, verhuurde VVO 6.589,5 m² (zie packages/reporting/README.md).
    const echte070Contracten: { contractnummer: string; complexnummer: string; unitnummer: string | null; bruto: string; m2: string; korting?: string }[] = [
      { contractnummer: "0000000028", complexnummer: "002", unitnummer: "0001", bruto: "37318.8", m2: "320" },
      { contractnummer: "0000000029", complexnummer: "002", unitnummer: "0002", bruto: "14686.56", m2: "139" },
      { contractnummer: "0000000031", complexnummer: "003", unitnummer: "0001", bruto: "29383.8", m2: "255" },
      { contractnummer: "0000000038", complexnummer: "001", unitnummer: "0003", bruto: "37617.12", m2: "320" },
      { contractnummer: "0000000043", complexnummer: "001", unitnummer: null, bruto: "92875.92", m2: "750" },
      { contractnummer: "0000000044", complexnummer: "003", unitnummer: "0003", bruto: "23150.4", m2: "202" },
      { contractnummer: "0000000045", complexnummer: "004", unitnummer: "0001", bruto: "136150.08", m2: "1633.5" },
      { contractnummer: "0000000046", complexnummer: "004", unitnummer: "0002", bruto: "170092.32", m2: "1700" },
      { contractnummer: "0000000048", complexnummer: "001", unitnummer: "0002", bruto: "38137.44", m2: "320" },
      { contractnummer: "0000000049", complexnummer: "003", unitnummer: "0004", bruto: "12777.36", m2: "120", korting: "-6000" },
      { contractnummer: "0000000051", complexnummer: "003", unitnummer: "0002", bruto: "34078.56", m2: "335", korting: "-7920" },
      { contractnummer: "0000000052", complexnummer: "002", unitnummer: "0003", bruto: "61632.52", m2: "495" },
    ];

    it("reconcilieert exact naar het bevestigde huur-kerncijfers-regressiepunt (070)", () => {
      const contracten = echte070Contracten.map((c) => contract({ contractnummer: c.contractnummer, complexnummer: c.complexnummer, unitnummer: c.unitnummer }));
      const rentroll = echte070Contracten.flatMap((c) => {
        const regels = [
          rentrollRegel({ contractnummer: c.contractnummer, complexnummer: c.complexnummer, unitnummer: c.unitnummer, prolongatieBedragJaar: new Decimal(c.bruto), gehuurdOppervlak: new Decimal(c.m2) }),
        ];
        if (c.korting) regels.push(rentrollRegel({ contractnummer: c.contractnummer, complexnummer: c.complexnummer, unitnummer: c.unitnummer, vorderingsoort: "13", prolongatieBedragJaar: new Decimal(c.korting), gehuurdOppervlak: new Decimal(0) }));
        return regels;
      });

      const resultaat = berekenHuurdersoverzicht(contracten, rentroll);

      expect(resultaat.contracten).toHaveLength(12);
      expect((resultaat.portefeuilleTotalen.brutoJaarhuur as { waarde: Decimal }).waarde.toString()).toBe("687900.88");
      expect((resultaat.portefeuilleTotalen.huurkorting as { waarde: Decimal }).waarde.toString()).toBe("13920");
      expect((resultaat.portefeuilleTotalen.nettoJaarhuur as { waarde: Decimal }).waarde.toString()).toBe("673980.88");
      expect((resultaat.portefeuilleTotalen.gehuurdOppervlak as { waarde: Decimal }).waarde.toString()).toBe("6589.5");

      // Contract 0000000043: geen unitnummer, nooit afgeleid.
      const c43 = resultaat.contracten.find((c) => c.contractnummer === "0000000043")!;
      expect(c43.unitnummer).toBeNull();
    });
  });
});
