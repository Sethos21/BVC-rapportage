import { describe, expect, it } from "vitest";
import { parseVorderingenMetAfboekingen, vorderingMetAfboekingNatuurlijkeSleutel } from "./vorderingenMetAfboekingen.js";

/** Rij gebaseerd op de echte kolomkoppen/sample uit vorderingen_met_afboekingen.xlsx (070, contract 0000000028). */
function ruweRij(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    Bedrijfsnr: "070",
    Contractnr: "0000000028",
    Vordering_Volgnr: "00000013",
    Huurdernr: "00000021",
    Complexnummer: "002   ",
    Unitnummer: "0001   ",
    Datum_Vordering: "01-09-2020",
    Omschrijving_Vordering: "Periode september 2020",
    Factuurnummer: "2070000001",
    Vordering_Totaalbedrag: 4449.3,
    Bedrag_afgeboekt: 4449.3,
    Vordering_openstaand: 0,
    Vordering_afgehandeld_periode: "09",
    Vordering_afgehandeld_jaar: "2020",
    ...overrides,
  };
}

describe("parseVorderingenMetAfboekingen", () => {
  it("parseert een geldige, volledig afgeboekte rij", () => {
    const { rijen, issues } = parseVorderingenMetAfboekingen([ruweRij()]);
    expect(issues).toHaveLength(0);
    expect(rijen[0]).toMatchObject({
      bedrijfsnr: "070",
      contractnr: "0000000028",
      vorderingVolgnr: "00000013",
      huurdernr: "00000021",
      complexnummer: "002",
      unitnummer: "0001",
      omschrijvingVordering: "Periode september 2020",
      factuurnummer: "2070000001",
    });
    expect(rijen[0]?.datumVordering).toEqual(new Date(Date.UTC(2020, 8, 1)));
    expect(rijen[0]?.totaalbedrag.toString()).toBe("4449.3");
    expect(rijen[0]?.bedragAfgeboekt.toString()).toBe("4449.3");
    expect(rijen[0]?.openstaand.toString()).toBe("0");
  });

  it("gedeeltelijk openstaande post: openstaand = totaalbedrag - afgeboekt, geen issue", () => {
    const { rijen, issues } = parseVorderingenMetAfboekingen([
      ruweRij({ Vordering_Totaalbedrag: 1000, Bedrag_afgeboekt: 400, Vordering_openstaand: 600 }),
    ]);
    expect(issues).toHaveLength(0);
    expect(rijen[0]?.openstaand.toString()).toBe("600");
  });

  it("volledig openstaande post (niets afgeboekt)", () => {
    const { rijen, issues } = parseVorderingenMetAfboekingen([
      ruweRij({ Vordering_Totaalbedrag: 5940.98, Bedrag_afgeboekt: 0, Vordering_openstaand: 5940.98, Vordering_afgehandeld_periode: null, Vordering_afgehandeld_jaar: null }),
    ]);
    expect(issues).toHaveLength(0);
    expect(rijen[0]?.openstaand.toString()).toBe("5940.98");
    expect(rijen[0]?.afgehandeldPeriode).toBeNull();
  });

  it("negatieve openstaande post (credit) blijft exact negatief bewaard — nooit Math.abs()", () => {
    const { rijen, issues } = parseVorderingenMetAfboekingen([
      ruweRij({ Omschrijving_Vordering: "Service-afrekening 0004", Vordering_Totaalbedrag: -146.9, Bedrag_afgeboekt: 0, Vordering_openstaand: -146.9 }),
    ]);
    expect(issues).toHaveLength(0);
    expect(rijen[0]?.openstaand.toString()).toBe("-146.9");
    expect(rijen[0]?.openstaand.isNegative()).toBe(true);
  });

  it("markeert een afwijkende openstaand-formule (totaalbedrag - afgeboekt != openstaand) als KRITIEK", () => {
    const { issues } = parseVorderingenMetAfboekingen([ruweRij({ Vordering_openstaand: 999 })]);
    expect(issues.some((i) => i.ernst === "KRITIEK")).toBe(true);
  });

  it("Unitnummer mag ontbreken (bevestigd bij contract 0000000043/Destiny), Contractnr blijft verplicht", () => {
    const { rijen, issues } = parseVorderingenMetAfboekingen([ruweRij({ Unitnummer: "" })]);
    expect(issues).toHaveLength(0);
    expect(rijen[0]?.unitnummer).toBeNull();
  });

  it("detecteert dubbele natuurlijke sleutel Bedrijfsnr + Contractnr + Vordering_Volgnr — nooit Vordering_Volgnr alleen", () => {
    const zelfdeSleutel = parseVorderingenMetAfboekingen([ruweRij(), ruweRij()]);
    expect(zelfdeSleutel.duplicaatIssues).toHaveLength(1);

    // Zelfde Vordering_Volgnr, ANDER contract binnen dezelfde administratie — geen botsing
    // (bewezen: Vordering_Volgnr is een per-contract volgnummer, geen globaal uniek nummer).
    const anderContract = parseVorderingenMetAfboekingen([ruweRij(), ruweRij({ Contractnr: "0000000049" })]);
    expect(anderContract.duplicaatIssues).toHaveLength(0);
  });

  it("vorderingMetAfboekingNatuurlijkeSleutel combineert bedrijfsnr+contractnr+vorderingVolgnr", () => {
    const { rijen } = parseVorderingenMetAfboekingen([ruweRij()]);
    expect(vorderingMetAfboekingNatuurlijkeSleutel(rijen[0]!)).toBe("070::0000000028::00000013");
  });
});
