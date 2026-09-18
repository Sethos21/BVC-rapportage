import { describe, expect, it } from "vitest";
import { parseBalans } from "./balans.js";

/** Rijstructuur gebaseerd op de echte kolomkoppen van "IDCB Balans per jaar vanaf 2024.xlsx". */
function ruweBalansrij(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    Bedrijfsnr: "072",
    Jaar: 2024,
    Grootboekrekeningnr: "1010",
    Beginbalans_debet: 28198.59,
    Beginbalans_credit: 0,
    Saldo_debet: 1273715.2,
    Saldo_credit: 1228039.76,
    Eindsaldo_debet: null,
    Eindsaldo_credit: null,
    Eindsaldo: 45675.44,
    Rekening_omschrijving: "Bank NL13 RABO 0170427366",
    Balans_vw: "Balans",
    ...overrides,
  };
}

describe("parseBalans", () => {
  it("parseert een geldige rij", () => {
    const { rijen, issues } = parseBalans([ruweBalansrij()]);
    expect(issues).toHaveLength(0);
    expect(rijen[0]?.eindsaldo.toString()).toBe("45675.44");
  });

  it("detecteert dubbele natuurlijke sleutel Bedrijfsnr + Jaar + Grootboekrekeningnr", () => {
    const { duplicaatIssues } = parseBalans([ruweBalansrij(), ruweBalansrij()]);
    expect(duplicaatIssues).toHaveLength(1);
  });

  it("laat Beginbalans_debet/credit optioneel maar Saldo/Eindsaldo verplicht", () => {
    const { rijen, issues } = parseBalans([ruweBalansrij({ Saldo_debet: null })]);
    expect(rijen).toHaveLength(0);
    expect(issues).toHaveLength(1);
  });
});
