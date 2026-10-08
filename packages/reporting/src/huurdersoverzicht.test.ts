import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { bepaalContracteindeStatus, bepaalLaatsteIndexatie, berekenHuurdersoverzicht, type HoContractRegel, type HoRentrollRegel, type HoVerhogingRegel } from "./huurdersoverzicht.js";
import type { OpSaldoHuurderRegel, OpVorderingRegel } from "./openstaandePosten.js";

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

function verhogingRegel(overrides: Partial<HoVerhogingRegel> = {}): HoVerhogingRegel {
  return {
    contractnummer: "C1",
    jaar: "2026",
    periode: "01",
    status: "Verwerkt",
    toekomstigeVerhoging: "Nee",
    bedragOudVs01: new Decimal(750),
    bedragNieuwVs01: new Decimal(780),
    ...overrides,
  };
}

describe("bepaalLaatsteIndexatie", () => {
  it("kiest de chronologisch laatste regel vóór/op de peildatum en berekent het percentage zelf uit oud/nieuw VS_01", () => {
    const resultaat = bepaalLaatsteIndexatie(
      "C1",
      [
        verhogingRegel({ jaar: "2024", periode: "07", bedragOudVs01: new Decimal(700), bedragNieuwVs01: new Decimal(722) }),
        verhogingRegel({ jaar: "2026", periode: "07", bedragOudVs01: new Decimal(750), bedragNieuwVs01: new Decimal(780) }),
        verhogingRegel({ jaar: "2025", periode: "07", bedragOudVs01: new Decimal(722), bedragNieuwVs01: new Decimal(750) }),
      ],
      PEILDATUM,
    );
    expect(resultaat.laatsteIndexatie).toEqual({
      jaar: "2026",
      periode: "07",
      oudMaandhuurbedrag: new Decimal(750),
      nieuwMaandhuurbedrag: new Decimal(780),
      effectiefPercentage: new Decimal(780).dividedBy(750).minus(1).times(100),
    });
    expect(resultaat.laatsteIndexatie?.effectiefPercentage.toString()).toBe("4");
  });

  it("negeert regels die niet aan de bewezen bronsemantiek voldoen (Status/Toekomstige_verhoging), ook al liggen ze chronologisch later", () => {
    const resultaat = bepaalLaatsteIndexatie(
      "C1",
      [
        verhogingRegel({ jaar: "2025", periode: "07", status: "Verwerkt", toekomstigeVerhoging: "Nee" }),
        verhogingRegel({ jaar: "2026", periode: "07", status: "Gepland", toekomstigeVerhoging: "Nee" }), // afwijkende Status — telt niet mee.
      ],
      PEILDATUM,
    );
    expect(resultaat.laatsteIndexatie?.jaar).toBe("2025");
    expect(resultaat.controleVereist.some((c) => c.ernst === "INFORMATIEF" && c.bericht.includes("nieuwere verhogingsregel"))).toBe(true);
  });

  it("levert null zonder crash bij Bedrag_oud_VS_01 = 0 of negatief — nooit delen door nul", () => {
    const nul = bepaalLaatsteIndexatie("C1", [verhogingRegel({ bedragOudVs01: new Decimal(0) })], PEILDATUM);
    expect(nul.laatsteIndexatie).toBeNull();
    expect(nul.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);

    const negatief = bepaalLaatsteIndexatie("C1", [verhogingRegel({ bedragOudVs01: new Decimal(-100) })], PEILDATUM);
    expect(negatief.laatsteIndexatie).toBeNull();
  });

  it("levert null zonder melding bij een contract zonder enige verhogingsregel", () => {
    const resultaat = bepaalLaatsteIndexatie("C1", [], PEILDATUM);
    expect(resultaat.laatsteIndexatie).toBeNull();
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("vertrouwt uitsluitend op wat de aanroeper al gegroepeerd heeft aangeleverd (geen eigen contractnummer-filter) — de compound-key-isolatie zelf wordt bewezen op het niveau van berekenHuurdersoverzicht hieronder", () => {
    const resultaat = bepaalLaatsteIndexatie("0000000052", [verhogingRegel({ contractnummer: "0000000037", jaar: "2025", periode: "04" })], PEILDATUM);
    expect(resultaat.laatsteIndexatie).not.toBeNull();
  });
});

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

  describe("laatsteIndexatie geïntegreerd in berekenHuurdersoverzicht", () => {
    it("vult laatsteIndexatie voor een contract met historie, null voor een contract zonder", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000028" }), contract({ contractnummer: "0000000052" })],
        [rentrollRegel({ contractnummer: "0000000028" }), rentrollRegel({ contractnummer: "0000000052" })],
        [verhogingRegel({ contractnummer: "0000000028", jaar: "2026", periode: "07", bedragOudVs01: new Decimal(3028.6), bedragNieuwVs01: new Decimal(3109.9) })],
      );
      const c28 = resultaat.contracten.find((c) => c.contractnummer === "0000000028")!;
      expect(c28.laatsteIndexatie?.jaar).toBe("2026");
      expect(c28.laatsteIndexatie?.effectiefPercentage.toFixed(2)).toBe("2.68");

      const c52 = resultaat.contracten.find((c) => c.contractnummer === "0000000052")!;
      expect(c52.laatsteIndexatie).toBeNull();
    });

    it("bewijst dat historie van contract 0000000037 NOOIT aan contract 0000000052 wordt gekoppeld, ook niet met identieke huurder/complex/unit", () => {
      // Zelfde bewezen 070-geval: alleen contractnummer verschilt, huurdernummer/complex/unit zijn identiek.
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000052", huurdernummer: "H23", complexnummer: "002", unitnummer: "0003" })],
        [rentrollRegel({ contractnummer: "0000000052", complexnummer: "002", unitnummer: "0003" })],
        [verhogingRegel({ contractnummer: "0000000037", jaar: "2025", periode: "04" })], // ander contractnummer, wordt nooit gezien voor 052.
      );
      expect(resultaat.contracten[0]!.laatsteIndexatie).toBeNull();
    });

    it("houdt een geldige laatsteIndexatie geldig ondanks een reconciliatieverschil met de actuele rentroll-bruto-jaarhuur (contract 048-bevinding)", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000048" })],
        [rentrollRegel({ contractnummer: "0000000048", prolongatieBedragJaar: new Decimal(38137.44) })],
        // Bedrag_Nieuw_VS_01 × 12 = 9534.36 × 12 = 114412.32 — exact 3× de rentroll-bruto-jaarhuur, precies het bewezen 048-geval.
        [verhogingRegel({ contractnummer: "0000000048", jaar: "2026", periode: "01", bedragOudVs01: new Decimal(9232.03), bedragNieuwVs01: new Decimal(9534.36) })],
      );
      const c48 = resultaat.contracten[0]!;
      expect(c48.laatsteIndexatie).not.toBeNull();
      expect(c48.laatsteIndexatie?.nieuwMaandhuurbedrag.toString()).toBe("9534.36");
      expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("wijkt af van de actuele bruto jaarhuur"))).toBe(true);
    });
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

  describe("openstaandSaldo geïntegreerd in berekenHuurdersoverzicht", () => {
    function vorderingRegel(overrides: Partial<OpVorderingRegel> = {}): OpVorderingRegel {
      return {
        bedrijfsnr: "070",
        contractnummer: "0000000028",
        vorderingVolgnummer: "00000093",
        huurdernummer: "00000021",
        complexnummer: "002",
        unitnummer: "0001",
        factuurnummer: "2670000108",
        datumVordering: new Date("2026-09-01T00:00:00.000Z"),
        omschrijving: "Periode september 2026",
        totaalbedrag: new Decimal(5940.98),
        bedragAfgeboekt: new Decimal(0),
        openstaand: new Decimal(5940.98),
        ...overrides,
      };
    }

    function saldoHuurderRegel(overrides: Partial<OpSaldoHuurderRegel> = {}): OpSaldoHuurderRegel {
      return {
        huurdernummer: "00000021",
        achterstand: new Decimal(5940.98),
        achterstandTm30Dagen: new Decimal(5940.98),
        achterstandTm60Dagen: new Decimal(0),
        achterstandTm90Dagen: new Decimal(0),
        achterstand90PlusDagen: new Decimal(0),
        vooruitbetaling: new Decimal(0),
        saldo: new Decimal(5940.98),
        ...overrides,
      };
    }

    it("contract zonder openstaande posten krijgt openstaandSaldo=0 en aantalOpenstaandePosten=0", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000028", huurdernummer: "00000021" })],
        [rentrollRegel({ contractnummer: "0000000028" })],
        [],
        [], // geen vorderingen voor dit contract
        [saldoHuurderRegel({ achterstand: new Decimal(0), achterstandTm30Dagen: new Decimal(0), saldo: new Decimal(0) })],
        true,
      );
      const c = resultaat.contracten[0]!;
      expect(c.openstaandSaldo.toString()).toBe("0");
      expect(c.aantalOpenstaandePosten).toBe(0);
    });

    it("contract met één openstaande post", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000028", huurdernummer: "00000021" })],
        [rentrollRegel({ contractnummer: "0000000028" })],
        [],
        [vorderingRegel()],
        [saldoHuurderRegel()],
        true,
      );
      const c = resultaat.contracten[0]!;
      expect(c.openstaandSaldo.toString()).toBe("5940.98");
      expect(c.aantalOpenstaandePosten).toBe(1);
    });

    it("contract met meerdere openstaande posten telt op tot de som", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000028", huurdernummer: "00000021" })],
        [rentrollRegel({ contractnummer: "0000000028" })],
        [],
        [
          vorderingRegel({ vorderingVolgnummer: "1", totaalbedrag: new Decimal(1000), openstaand: new Decimal(1000) }),
          vorderingRegel({ vorderingVolgnummer: "2", totaalbedrag: new Decimal(500), openstaand: new Decimal(500) }),
        ],
        [saldoHuurderRegel({ achterstand: new Decimal(1500), achterstandTm30Dagen: new Decimal(1500), saldo: new Decimal(1500) })],
        true,
      );
      const c = resultaat.contracten[0]!;
      expect(c.openstaandSaldo.toString()).toBe("1500");
      expect(c.aantalOpenstaandePosten).toBe(2);
    });

    it("negatieve credit blijft exact negatief — nooit Math.abs()", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000048", huurdernummer: "00000033" })],
        [rentrollRegel({ contractnummer: "0000000048" })],
        [],
        [vorderingRegel({ contractnummer: "0000000048", huurdernummer: "00000033", omschrijving: "Service-afrekening 0004", totaalbedrag: new Decimal(-146.9), openstaand: new Decimal(-146.9) })],
        [saldoHuurderRegel({ huurdernummer: "00000033", achterstand: new Decimal(-146.9), achterstandTm30Dagen: new Decimal(0), achterstand90PlusDagen: new Decimal(-146.9), saldo: new Decimal(-146.9) })],
        true,
      );
      const c = resultaat.contracten[0]!;
      expect(c.openstaandSaldo.toString()).toBe("-146.9");
      expect(c.openstaandSaldo.isNegative()).toBe(true);
    });

    it("iTapToo: contracten 044/049 krijgen elk hun EIGEN saldo, nooit het huurdertotaal op beide", () => {
      const resultaat = berekenHuurdersoverzicht(
        [
          contract({ contractnummer: "0000000044", huurdernummer: "00000030" }),
          contract({ contractnummer: "0000000049", huurdernummer: "00000030" }),
        ],
        [rentrollRegel({ contractnummer: "0000000044" }), rentrollRegel({ contractnummer: "0000000049" })],
        [],
        [
          vorderingRegel({ contractnummer: "0000000044", huurdernummer: "00000030", vorderingVolgnummer: "00000061", totaalbedrag: new Decimal(3544.33), openstaand: new Decimal(3544.33) }),
          vorderingRegel({ contractnummer: "0000000049", huurdernummer: "00000030", vorderingVolgnummer: "00000030", totaalbedrag: new Decimal(1409.38), openstaand: new Decimal(1409.38) }),
        ],
        [saldoHuurderRegel({ huurdernummer: "00000030", achterstand: new Decimal(4953.71), achterstandTm30Dagen: new Decimal(4953.71), saldo: new Decimal(4953.71) })],
        true,
        PEILDATUM,
      );
      const c044 = resultaat.contracten.find((c) => c.contractnummer === "0000000044")!;
      const c049 = resultaat.contracten.find((c) => c.contractnummer === "0000000049")!;
      expect(c044.openstaandSaldo.toString()).toBe("3544.33");
      expect(c049.openstaandSaldo.toString()).toBe("1409.38");
      // Cruciale regel: NOOIT het huurdertotaal (4953.71) op één van beide contractregels.
      expect(c044.openstaandSaldo.toString()).not.toBe("4953.71");
      expect(c049.openstaandSaldo.toString()).not.toBe("4953.71");
      // Geen dubbeltelling: som van beide contractregels = huurdertotaal, geen enkel verschil (geen WAARSCHUWING).
      expect(c044.openstaandSaldo.plus(c049.openstaandSaldo).toString()).toBe("4953.71");
      expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING")).toBe(false);
    });

    it("Destiny (contract 0000000043, geen unitnummer) krijgt correct openstaandSaldo ondanks ontbrekende unit", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000043", huurdernummer: "00000028", unitnummer: null })],
        [rentrollRegel({ contractnummer: "0000000043", unitnummer: null })],
        [],
        [vorderingRegel({ contractnummer: "0000000043", huurdernummer: "00000028", unitnummer: null, totaalbedrag: new Decimal(15384.74), openstaand: new Decimal(15384.74) })],
        [saldoHuurderRegel({ huurdernummer: "00000028", achterstand: new Decimal(15384.74), achterstandTm30Dagen: new Decimal(15384.74), saldo: new Decimal(15384.74) })],
        true,
      );
      const c = resultaat.contracten[0]!;
      expect(c.unitnummer).toBeNull();
      expect(c.openstaandSaldo.toString()).toBe("15384.74");
    });

    it("debiteurenbeheer=true met een reconciliatieverschil op huurderniveau: WAARSCHUWING", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000028", huurdernummer: "00000021" })],
        [rentrollRegel({ contractnummer: "0000000028" })],
        [],
        [vorderingRegel()],
        [saldoHuurderRegel({ saldo: new Decimal(9999) })], // wijkt af van de detailsom 5940.98
        true,
      );
      expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("00000021"))).toBe(true);
    });

    it("debiteurenbeheer=false: hetzelfde verschil geeft GEEN WAARSCHUWING, wel een INFORMATIEF-context-melding", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000028", huurdernummer: "00000021" })],
        [rentrollRegel({ contractnummer: "0000000028" })],
        [],
        [vorderingRegel()],
        [saldoHuurderRegel({ saldo: new Decimal(9999) })],
        false,
        PEILDATUM,
      );
      expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" || i.ernst === "KRITIEK")).toBe(false);
      expect(resultaat.controleVereist.some((i) => i.ernst === "INFORMATIEF" && i.bericht.includes("niet door ons bijgehouden"))).toBe(true);
      // De cijfers blijven gewoon getoond, alleen de ernst verandert.
      expect(resultaat.contracten[0]!.openstaandSaldo.toString()).toBe("5940.98");
    });

    it('debiteurenbeheer="onbekend": neutrale WAARSCHUWING over niet-geclassificeerde betrouwbaarheid', () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000028", huurdernummer: "00000021" })],
        [rentrollRegel({ contractnummer: "0000000028" })],
        [],
        [vorderingRegel()],
        [saldoHuurderRegel()],
        "onbekend",
      );
      expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("nog niet geclassificeerd"))).toBe(true);
    });

    it("zonder vorderingen/saldoHuurders (bestaande aanroepen zonder deze fase): geen debiteurenmelding, saldo blijft 0", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000028" })],
        [rentrollRegel({ contractnummer: "0000000028" })],
      );
      expect(resultaat.contracten[0]!.openstaandSaldo.toString()).toBe("0");
      expect(resultaat.contracten[0]!.aantalOpenstaandePosten).toBe(0);
      expect(resultaat.controleVereist).toEqual([]);
    });
  });

  describe("Vervallen posten / Openstaande credits", () => {
    const VERVALLEN_PEILDATUM = new Date("2026-09-01T00:00:00.000Z");

    function vorderingRegel(overrides: Partial<OpVorderingRegel> = {}): OpVorderingRegel {
      return {
        bedrijfsnr: "070",
        contractnummer: "0000000028",
        vorderingVolgnummer: "00000093",
        huurdernummer: "00000021",
        complexnummer: "002",
        unitnummer: "0001",
        factuurnummer: "2670000108",
        datumVordering: new Date("2026-08-01T00:00:00.000Z"),
        omschrijving: "Periode augustus 2026",
        totaalbedrag: new Decimal(5940.98),
        bedragAfgeboekt: new Decimal(0),
        openstaand: new Decimal(5940.98),
        ...overrides,
      };
    }

    function saldoHuurderRegel(overrides: Partial<OpSaldoHuurderRegel> = {}): OpSaldoHuurderRegel {
      return {
        huurdernummer: "00000021",
        achterstand: new Decimal(5940.98),
        achterstandTm30Dagen: new Decimal(5940.98),
        achterstandTm60Dagen: new Decimal(0),
        achterstandTm90Dagen: new Decimal(0),
        achterstand90PlusDagen: new Decimal(0),
        vooruitbetaling: new Decimal(0),
        saldo: new Decimal(5940.98),
        ...overrides,
      };
    }

    it("zonder vervallenPeildatum: geen Vervallen posten/credits berekend, wel een WAARSCHUWING", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000028", huurdernummer: "00000021" })],
        [rentrollRegel({ contractnummer: "0000000028" })],
        [],
        [vorderingRegel()],
        [saldoHuurderRegel()],
        true,
      );
      expect(resultaat.vervallenPeildatum).toBeNull();
      expect(resultaat.vervallenPosten).toEqual([]);
      expect(resultaat.openstaandeCredits).toEqual([]);
      expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("Geen peildatum opgegeven voor de vervallen-classificatie"))).toBe(true);
    });

    it("een vervallen post komt in vervallenPosten terecht met huurderNaam/periode/dagenVervallen", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000028", huurdernummer: "00000021", huurderNaam: "ACME BV" })],
        [rentrollRegel({ contractnummer: "0000000028" })],
        [],
        [vorderingRegel()],
        [saldoHuurderRegel()],
        true,
        VERVALLEN_PEILDATUM,
        0,
      );
      expect(resultaat.vervallenPeildatum).toEqual(VERVALLEN_PEILDATUM);
      expect(resultaat.vervallenPosten).toHaveLength(1);
      const p = resultaat.vervallenPosten[0]!;
      expect(p.huurderNaam).toBe("ACME BV");
      expect(p.contractnummer).toBe("0000000028");
      expect(p.periodeWeergave).toBe("Augustus 2026");
      expect(p.dagenVervallen).toBe(31);
      expect(p.openstaand.toString()).toBe("5940.98");
      // Openstaand-kolom (contractniveau) blijft ONGEWIJZIGD naast de nieuwe sectie.
      expect(resultaat.contracten[0]!.openstaandSaldo.toString()).toBe("5940.98");
    });

    it("een negatieve post (Bright-credit) komt in openstaandeCredits, NOOIT in vervallenPosten", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000048", huurdernummer: "00000033", huurderNaam: "Bright Accountants en Adviseurs B.V." })],
        [rentrollRegel({ contractnummer: "0000000048" })],
        [],
        [vorderingRegel({ contractnummer: "0000000048", huurdernummer: "00000033", omschrijving: "Service-afrekening 0004", datumVordering: new Date("2026-04-15T00:00:00.000Z"), totaalbedrag: new Decimal(-146.9), openstaand: new Decimal(-146.9) })],
        [saldoHuurderRegel({ huurdernummer: "00000033", achterstand: new Decimal(-146.9), achterstandTm30Dagen: new Decimal(0), achterstand90PlusDagen: new Decimal(-146.9), saldo: new Decimal(-146.9) })],
        true,
        VERVALLEN_PEILDATUM,
        0,
      );
      expect(resultaat.vervallenPosten).toEqual([]);
      expect(resultaat.openstaandeCredits).toHaveLength(1);
      const c = resultaat.openstaandeCredits[0]!;
      expect(c.huurderNaam).toBe("Bright Accountants en Adviseurs B.V.");
      expect(c.openstaand.toString()).toBe("-146.9");
    });

    it("multi-contracthuurder (iTapToo 044/049): vervallen posten blijven per contract correct toegewezen", () => {
      const resultaat = berekenHuurdersoverzicht(
        [
          contract({ contractnummer: "0000000044", huurdernummer: "00000030", huurderNaam: "iTapToo" }),
          contract({ contractnummer: "0000000049", huurdernummer: "00000030", huurderNaam: "iTapToo" }),
        ],
        [rentrollRegel({ contractnummer: "0000000044" }), rentrollRegel({ contractnummer: "0000000049" })],
        [],
        [
          vorderingRegel({ contractnummer: "0000000044", huurdernummer: "00000030", vorderingVolgnummer: "00000061", totaalbedrag: new Decimal(3544.33), openstaand: new Decimal(3544.33) }),
          vorderingRegel({ contractnummer: "0000000049", huurdernummer: "00000030", vorderingVolgnummer: "00000030", totaalbedrag: new Decimal(1409.38), openstaand: new Decimal(1409.38) }),
        ],
        [saldoHuurderRegel({ huurdernummer: "00000030", achterstand: new Decimal(4953.71), achterstandTm30Dagen: new Decimal(4953.71), saldo: new Decimal(4953.71) })],
        true,
        VERVALLEN_PEILDATUM,
        0,
      );
      expect(resultaat.vervallenPosten).toHaveLength(2);
      expect(resultaat.vervallenPosten.map((p) => p.contractnummer).sort()).toEqual(["0000000044", "0000000049"]);
      const c044 = resultaat.contracten.find((c) => c.contractnummer === "0000000044")!;
      const c049 = resultaat.contracten.find((c) => c.contractnummer === "0000000049")!;
      expect(c044.openstaandSaldo.toString()).toBe("3544.33");
      expect(c049.openstaandSaldo.toString()).toBe("1409.38");
    });

    it("vervallenPosten sorteert meeste dagen vervallen eerst", () => {
      const resultaat = berekenHuurdersoverzicht(
        [contract({ contractnummer: "0000000028", huurdernummer: "00000021" })],
        [rentrollRegel({ contractnummer: "0000000028" })],
        [],
        [
          vorderingRegel({ vorderingVolgnummer: "1", datumVordering: new Date("2026-08-01T00:00:00.000Z"), totaalbedrag: new Decimal(100), openstaand: new Decimal(100) }), // 31 dagen
          vorderingRegel({ vorderingVolgnummer: "2", datumVordering: new Date("2026-07-01T00:00:00.000Z"), totaalbedrag: new Decimal(200), openstaand: new Decimal(200) }), // 62 dagen
        ],
        [saldoHuurderRegel({ achterstand: new Decimal(300), achterstandTm30Dagen: new Decimal(300), saldo: new Decimal(300) })],
        true,
        VERVALLEN_PEILDATUM,
        0,
      );
      expect(resultaat.vervallenPosten.map((p) => p.dagenVervallen)).toEqual([62, 31]);
    });
  });
});
