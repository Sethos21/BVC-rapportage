import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { bepaalContractGeldigheid, berekenHuurKerncijfers, type HuurContractRegel, type HuurRentrollRegel } from "./huurKerncijfers.js";

function contract(overrides: Partial<HuurContractRegel> = {}): HuurContractRegel {
  return { contractnummer: "C1", ingangsdatum: new Date("2020-01-01T00:00:00.000Z"), afloopdatum: null, checkLopendContract: "Ja", ...overrides };
}

function regel(overrides: Partial<HuurRentrollRegel> = {}): HuurRentrollRegel {
  return {
    contractnummer: "C1",
    complexnr: "001",
    vorderingsoort: "01",
    prolongatieBedragJaar: new Decimal("10000"),
    gehuurdOppervlak: new Decimal("100"),
    rapportageDatum: new Date("2026-06-30T00:00:00.000Z"),
    ...overrides,
  };
}

const PEILDATUM = new Date("2026-06-30T00:00:00.000Z");

describe("bepaalContractGeldigheid — grensgevallen", () => {
  it("is onbekend zonder ingangsdatum (nooit aangenomen)", () => {
    const resultaat = bepaalContractGeldigheid(contract({ ingangsdatum: null }), PEILDATUM);
    expect(resultaat.type).toBe("onbekend");
  });

  it("is geldig als ingangsdatum exact op de peildatum valt (inclusieve ondergrens)", () => {
    const resultaat = bepaalContractGeldigheid(contract({ ingangsdatum: PEILDATUM }), PEILDATUM);
    expect(resultaat).toEqual({ type: "bekend", waarde: true });
  });

  it("is ongeldig als ingangsdatum ná de peildatum ligt (nog niet ingegaan)", () => {
    const resultaat = bepaalContractGeldigheid(contract({ ingangsdatum: new Date("2026-07-01T00:00:00.000Z") }), PEILDATUM);
    expect(resultaat).toEqual({ type: "bekend", waarde: false });
  });

  it("is geldig als afloopdatum exact op de peildatum valt (inclusieve bovengrens)", () => {
    const resultaat = bepaalContractGeldigheid(contract({ afloopdatum: PEILDATUM }), PEILDATUM);
    expect(resultaat).toEqual({ type: "bekend", waarde: true });
  });

  it("is ongeldig als afloopdatum vóór de peildatum ligt (al afgelopen)", () => {
    const resultaat = bepaalContractGeldigheid(contract({ afloopdatum: new Date("2026-06-29T00:00:00.000Z") }), PEILDATUM);
    expect(resultaat).toEqual({ type: "bekend", waarde: false });
  });

  it("blijft geldig zonder afloopdatum (open einde)", () => {
    const resultaat = bepaalContractGeldigheid(contract({ afloopdatum: null }), PEILDATUM);
    expect(resultaat).toEqual({ type: "bekend", waarde: true });
  });
});

describe("berekenHuurKerncijfers — datakwaliteitsregels (synthetisch)", () => {
  it("negeert Vorderingsoort 12 informatief, telt niet mee", () => {
    const resultaat = berekenHuurKerncijfers([regel({ vorderingsoort: "12", contractnummer: "C1" })], [contract()]);
    expect(resultaat.portefeuille.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("0") });
    expect(resultaat.controleVereist.some((i) => i.ernst === "INFORMATIEF" && i.bericht.includes('"12"'))).toBe(true);
  });

  it("signaleert een onverwachte Vorderingsoort en telt niet mee", () => {
    const resultaat = berekenHuurKerncijfers([regel({ vorderingsoort: "99" })], [contract()]);
    expect(resultaat.portefeuille.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("0") });
    expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes('"99"'))).toBe(true);
  });

  it("meldt een ontbrekende contractkoppeling en telt niet mee", () => {
    const resultaat = berekenHuurKerncijfers([regel({ contractnummer: "ONBEKEND" })], [contract()]);
    expect(resultaat.perComplex).toEqual([]);
    expect(resultaat.controleVereist.some((i) => i.bericht.includes("niet gevonden in contracten"))).toBe(true);
  });

  it("meldt een niet-eenduidige contractkoppeling en telt niet mee (kiest niets)", () => {
    const resultaat = berekenHuurKerncijfers([regel()], [contract(), contract({ ingangsdatum: new Date("2021-01-01T00:00:00.000Z") })]);
    expect(resultaat.perComplex).toEqual([]);
    expect(resultaat.controleVereist.some((i) => i.bericht.includes("niet eenduidig"))).toBe(true);
  });

  it("telt een ongeldig contract (niet ingegaan op peildatum) niet mee, wel gemeld", () => {
    const resultaat = berekenHuurKerncijfers([regel()], [contract({ ingangsdatum: new Date("2026-12-01T00:00:00.000Z") })]);
    expect(resultaat.perComplex).toEqual([]);
    expect(resultaat.controleVereist.some((i) => i.bericht.includes("niet geldig op peildatum"))).toBe(true);
  });

  it("behandelt een ontbrekend prolongatie_bedrag_jaar nooit als 0 — regel wordt uitgesloten en gemeld", () => {
    const resultaat = berekenHuurKerncijfers([regel({ prolongatieBedragJaar: null })], [contract()]);
    expect(resultaat.portefeuille.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("0") });
    expect(resultaat.controleVereist.some((i) => i.bericht.includes("geen prolongatie_bedrag_jaar"))).toBe(true);
  });

  it("signaleert een '01'-regel met 0 m² (bedrag telt wel mee, VVO niet)", () => {
    const resultaat = berekenHuurKerncijfers([regel({ gehuurdOppervlak: new Decimal("0") })], [contract()]);
    expect(resultaat.portefeuille.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("10000") });
    expect(resultaat.portefeuille.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("0") });
    expect(resultaat.controleVereist.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("0 of ontbrekend gehuurd_oppervlak"))).toBe(true);
  });

  it("markeert een '13'-regel met een niet-negatieve waarde als KRITIEK, telt niet mee in huurkortingen", () => {
    const resultaat = berekenHuurKerncijfers([regel({ vorderingsoort: "13", prolongatieBedragJaar: new Decimal("500"), gehuurdOppervlak: new Decimal("0") })], [contract()]);
    expect(resultaat.portefeuille.huurkortingen).toEqual({ type: "bekend", waarde: new Decimal("0") });
    expect(resultaat.controleVereist.some((i) => i.ernst === "KRITIEK" && i.bericht.includes("niet-negatieve waarde"))).toBe(true);
  });

  it("signaleert een '13'-regel met oppervlak > 0 (afwijkend, geen VVO-effect)", () => {
    const resultaat = berekenHuurKerncijfers([regel({ vorderingsoort: "13", prolongatieBedragJaar: new Decimal("-500"), gehuurdOppervlak: new Decimal("10") })], [contract()]);
    expect(resultaat.controleVereist.some((i) => i.bericht.includes("gehuurd_oppervlak > 0"))).toBe(true);
    expect(resultaat.portefeuille.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("0") });
  });

  it("kruischeckt check_lopend_contract tegen de berekende geldigheid zonder die te laten winnen", () => {
    const resultaat = berekenHuurKerncijfers([regel()], [contract({ checkLopendContract: "Nee" })]);
    expect(resultaat.portefeuille.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("10000") }); // berekende geldigheid (true) blijft leidend
    expect(resultaat.controleVereist.some((i) => i.bericht.includes("check_lopend_contract"))).toBe(true);
  });

  it("geeft een portefeuillebrede melding en telt niets mee als bronPeildatum niet eenduidig is", () => {
    const resultaat = berekenHuurKerncijfers(
      [regel({ rapportageDatum: new Date("2026-06-30T00:00:00.000Z") }), regel({ contractnummer: "C2", rapportageDatum: new Date("2026-05-31T00:00:00.000Z") })],
      [contract(), contract({ contractnummer: "C2" })],
    );
    expect(resultaat.bronPeildatum).toBeNull();
    expect(resultaat.perComplex).toEqual([]);
    expect(resultaat.controleVereist.some((i) => i.complexnr === null && i.bericht.includes("Geen eenduidige bronPeildatum"))).toBe(true);
  });
});

describe("berekenHuurKerncijfers — regressie 070_Rooise_Zoom (rentroll-diagnose 2026-08-26)", () => {
  const RAPPORTAGE_DATUM = new Date("2026-07-31T00:00:00.000Z");

  function contr(nr: string, ingangsdatum: string): HuurContractRegel {
    return { contractnummer: nr, ingangsdatum: new Date(ingangsdatum), afloopdatum: null, checkLopendContract: "Ja" };
  }
  function huur(nr: string, complexnr: string, bedrag: string, m2: string): HuurRentrollRegel {
    return { contractnummer: nr, complexnr, vorderingsoort: "01", prolongatieBedragJaar: new Decimal(bedrag), gehuurdOppervlak: new Decimal(m2), rapportageDatum: RAPPORTAGE_DATUM };
  }
  function korting(nr: string, complexnr: string, bedrag: string): HuurRentrollRegel {
    return { contractnummer: nr, complexnr, vorderingsoort: "13", prolongatieBedragJaar: new Decimal(bedrag), gehuurdOppervlak: new Decimal("0"), rapportageDatum: RAPPORTAGE_DATUM };
  }

  const rentroll: HuurRentrollRegel[] = [
    huur("0000000028", "002", "37318.80", "320"),
    huur("0000000029", "002", "14686.56", "139"),
    huur("0000000031", "003", "29383.80", "255"),
    huur("0000000038", "001", "37617.12", "320"),
    huur("0000000043", "001", "92875.92", "750"),
    huur("0000000044", "003", "23150.40", "202"),
    huur("0000000045", "004", "136150.08", "1633.5"),
    huur("0000000046", "004", "170092.32", "1700"),
    huur("0000000048", "001", "38137.44", "320"),
    huur("0000000049", "003", "12777.36", "120"),
    korting("0000000049", "003", "-6000"),
    huur("0000000051", "003", "34078.56", "335"),
    korting("0000000051", "003", "-7920"),
    huur("0000000052", "002", "61632.52", "495"),
  ];
  const contracten: HuurContractRegel[] = [
    contr("0000000028", "2020-01-01"), contr("0000000029", "2016-06-01"), contr("0000000031", "2016-01-01"),
    contr("0000000038", "2015-05-01"), contr("0000000043", "2021-08-28"), contr("0000000044", "2022-07-01"),
    contr("0000000045", "2011-01-01"), contr("0000000046", "2011-01-01"), contr("0000000048", "2023-04-01"),
    contr("0000000049", "2024-09-15"), contr("0000000051", "2025-05-01"), contr("0000000052", "2026-04-01"),
  ];

  it("berekent de portefeuille exact zoals het bevestigde regressiepunt", () => {
    const resultaat = berekenHuurKerncijfers(rentroll, contracten);

    expect(resultaat.momentopname).toBe(true);
    expect(resultaat.bronPeildatum).toEqual(RAPPORTAGE_DATUM);
    expect(resultaat.portefeuille.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("687900.88") });
    expect(resultaat.portefeuille.huurkortingen).toEqual({ type: "bekend", waarde: new Decimal("13920") });
    expect(resultaat.portefeuille.nettoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("673980.88") });
    expect(resultaat.portefeuille.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("6589.5") });

    const verwachtBruto = new Decimal("687900.88").dividedBy("6589.5");
    const verwachtNetto = new Decimal("673980.88").dividedBy("6589.5");
    expect(resultaat.portefeuille.brutoHuurPerM2).toEqual({ type: "bekend", waarde: verwachtBruto });
    expect(resultaat.portefeuille.nettoHuurPerM2).toEqual({ type: "bekend", waarde: verwachtNetto });
    expect(verwachtBruto.toDecimalPlaces(2).toString()).toBe("104.39");
    expect(verwachtNetto.toDecimalPlaces(2).toString()).toBe("102.28");
  });

  it("berekent elk complex correct, VVO gelijk aan het vastgoed-kerncijfers-regressiepunt", () => {
    const resultaat = berekenHuurKerncijfers(rentroll, contracten);
    const perComplex = Object.fromEntries(resultaat.perComplex.map((c) => [c.complexnr, c]));

    expect(perComplex["001"]?.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("168630.48") });
    expect(perComplex["001"]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("1390") });
    expect(perComplex["001"]?.huurkortingen).toEqual({ type: "bekend", waarde: new Decimal("0") });

    expect(perComplex["002"]?.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("113637.88") });
    expect(perComplex["002"]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("954") });

    expect(perComplex["003"]?.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("99390.12") });
    expect(perComplex["003"]?.huurkortingen).toEqual({ type: "bekend", waarde: new Decimal("13920") });
    expect(perComplex["003"]?.nettoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("85470.12") });
    expect(perComplex["003"]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("912") });

    expect(perComplex["004"]?.brutoJaarhuur).toEqual({ type: "bekend", waarde: new Decimal("306242.40") });
    expect(perComplex["004"]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("3333.5") });
  });

  it("geeft geen KRITIEK/WAARSCHUWING (alleen eventueel INFORMATIEF) — schone 070-structuur", () => {
    const resultaat = berekenHuurKerncijfers(rentroll, contracten);
    const problemen = resultaat.controleVereist.filter((i) => i.ernst !== "INFORMATIEF");
    expect(problemen).toEqual([]);
  });
});
