import { describe, expect, it } from "vitest";
import { parseOuderdomsanalyse } from "./ouderdomsanalyse.js";

/** Rij gebaseerd op de echte kolomkoppen/sample van "IDBC Ouderdomsanalyse" (huurder VGL, bedrijf 002). */
function ruweRij(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    Bedrijfsnr: "002",
    Huurdernr: "00000009",
    Achterstand: "1820,51",
    Achterstand_tm_30_dagen: "2007,5",
    Achterstand_tm_60_dagen: "44,06",
    Achterstand_tm_90_dagen: "44,06",
    Achterstand_90plus_dagen: "-275,11",
    Vooruitbetaling: "0",
    Saldo: "1820,51",
    ...overrides,
  };
}

const METADATA = { boekjaar: 2026, boekperiode: "07", peildatum: new Date("2026-07-31") };

describe("parseOuderdomsanalyse", () => {
  it("parseert een geldige rij en voegt boekjaar/boekperiode/peildatum als importmetadata toe", () => {
    const { rijen, issues } = parseOuderdomsanalyse([ruweRij()], METADATA);
    expect(issues).toHaveLength(0);
    expect(rijen[0]?.boekjaar).toBe(2026);
    expect(rijen[0]?.peildatum).toEqual(new Date("2026-07-31"));
  });

  it("markeert een afwijkende Saldo-formule (Saldo != Achterstand - Vooruitbetaling) als KRITIEK", () => {
    const { issues } = parseOuderdomsanalyse([ruweRij({ Saldo: "999" })], METADATA);
    expect(issues.some((i) => i.ernst === "KRITIEK")).toBe(true);
  });

  it("signaleert negatieve Vooruitbetaling als WAARSCHUWING, blokkeert niet", () => {
    const { rijen, issues } = parseOuderdomsanalyse(
      [ruweRij({ Vooruitbetaling: "-42,87", Achterstand: "0", Achterstand_tm_30_dagen: "0", Achterstand_tm_60_dagen: "0", Achterstand_tm_90_dagen: "0", Achterstand_90plus_dagen: "-42,87", Saldo: "42,87" })],
      METADATA,
    );
    expect(rijen).toHaveLength(1);
    expect(issues.some((i) => i.ernst === "WAARSCHUWING")).toBe(true);
  });

  it("detecteert dubbele natuurlijke sleutel Bedrijfsnr + Huurdernr + boekjaar + boekperiode", () => {
    const { duplicaatIssues } = parseOuderdomsanalyse([ruweRij(), ruweRij()], METADATA);
    expect(duplicaatIssues).toHaveLength(1);
  });
});
