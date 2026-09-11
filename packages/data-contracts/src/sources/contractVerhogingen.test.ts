import { describe, expect, it } from "vitest";
import { contractVerhogingNatuurlijkeSleutel, parseContractVerhogingen } from "./contractVerhogingen.js";

/** Rij gebaseerd op de echte kolomkoppen/sample uit contract-verhogingen-diagnose (070, contract 0000000028). */
function ruweRij(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    Bedrijfsnr: "070",
    Contract: "0000000028",
    Jaar: "2026",
    Periode: "07",
    Status: "Verwerkt",
    Toekomstige_verhoging: "Nee",
    Bedrag_oud_VS_01: "3028.6",
    Bedrag_Nieuw_VS_01: "3109.9",
    ...overrides,
  };
}

describe("parseContractVerhogingen", () => {
  it("parseert een geldige rij", () => {
    const { rijen, issues } = parseContractVerhogingen([ruweRij()]);
    expect(issues).toHaveLength(0);
    expect(rijen[0]).toMatchObject({
      bedrijfsnr: "070",
      contract: "0000000028",
      jaar: "2026",
      periode: "07",
      status: "Verwerkt",
      toekomstigeVerhoging: "Nee",
    });
    expect(rijen[0]?.bedragOudVs01?.toString()).toBe("3028.6");
    expect(rijen[0]?.bedragNieuwVs01?.toString()).toBe("3109.9");
  });

  it("bevat GEEN Waarde-veld — het effectieve percentage wordt elders altijd uit VS_01 berekend", () => {
    const { rijen } = parseContractVerhogingen([ruweRij()]);
    expect(rijen[0]).not.toHaveProperty("waarde");
  });

  it("detecteert dubbele natuurlijke sleutel Bedrijfsnr + Contract + Jaar + Periode — nooit Contract alleen", () => {
    const zelfdeSleutel = parseContractVerhogingen([ruweRij(), ruweRij()]);
    expect(zelfdeSleutel.duplicaatIssues).toHaveLength(1);

    // Zelfde Contract, ANDER bedrijfsnr — geen botsing, bewijst dat de sleutel niet op Contract alleen steunt.
    const andereAdministratie = parseContractVerhogingen([ruweRij(), ruweRij({ Bedrijfsnr: "002" })]);
    expect(andereAdministratie.duplicaatIssues).toHaveLength(0);
  });

  it("contractVerhogingNatuurlijkeSleutel combineert bedrijfsnr+contract+jaar+periode", () => {
    const { rijen } = parseContractVerhogingen([ruweRij()]);
    expect(contractVerhogingNatuurlijkeSleutel(rijen[0]!)).toBe("070::0000000028::2026::07");
  });
});
