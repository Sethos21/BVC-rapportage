import { describe, expect, it } from "vitest";
import { contractPrijsregelNatuurlijkeSleutel, parseContractPrijsregels } from "./contractPrijsregels.js";

/** Rij gebaseerd op de echte kolomkoppen/sample uit contract_prijsregels.xlsx (070, contract 0000000049). */
function ruweRij(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    Bedrijfsnr: "070",
    Contractnr: "0000000049",
    Prijs_regelnr: "3",
    Status: "Nieuw",
    Ingangsdatum_prijsregel: "01-07-2027",
    Bedrag_vorderingsoort_13: "0",
    ...overrides,
  };
}

describe("parseContractPrijsregels", () => {
  it("parseert een geldige rij", () => {
    const { rijen, issues } = parseContractPrijsregels([ruweRij()]);
    expect(issues).toHaveLength(0);
    expect(rijen[0]).toMatchObject({
      bedrijfsnr: "070",
      contractnr: "0000000049",
      prijsRegelnr: "3",
      status: "Nieuw",
    });
    expect(rijen[0]?.ingangsdatumPrijsregel?.toISOString().slice(0, 10)).toBe("2027-07-01");
    expect(rijen[0]?.bedragVorderingsoort13?.toString()).toBe("0");
  });

  it("een negatief bedrag (huidige korting) parseert correct, GEEN Math.abs", () => {
    const { rijen } = parseContractPrijsregels([ruweRij({ Bedrag_vorderingsoort_13: "-500" })]);
    expect(rijen[0]?.bedragVorderingsoort13?.toString()).toBe("-500");
  });

  it("detecteert dubbele natuurlijke sleutel Bedrijfsnr + Contractnr + Prijs_regelnr", () => {
    const zelfdeSleutel = parseContractPrijsregels([ruweRij(), ruweRij()]);
    expect(zelfdeSleutel.duplicaatIssues).toHaveLength(1);

    const andereRegel = parseContractPrijsregels([ruweRij(), ruweRij({ Prijs_regelnr: "4" })]);
    expect(andereRegel.duplicaatIssues).toHaveLength(0);
  });

  it("contractPrijsregelNatuurlijkeSleutel combineert bedrijfsnr+contractnr+prijsregelnr", () => {
    const { rijen } = parseContractPrijsregels([ruweRij()]);
    expect(contractPrijsregelNatuurlijkeSleutel(rijen[0]!)).toBe("070::0000000049::3");
  });

  it("Status wordt overgenomen voor traceerbaarheid maar is bewust niet uniek/verplicht", () => {
    const { rijen, issues } = parseContractPrijsregels([ruweRij({ Status: null })]);
    expect(issues).toHaveLength(0);
    expect(rijen[0]?.status).toBeNull();
  });
});
