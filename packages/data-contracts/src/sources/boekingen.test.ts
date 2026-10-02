import { describe, expect, it } from "vitest";
import { parseBoekingen } from "./boekingen.js";

/**
 * Rijstructuur gebaseerd op de echte kolomkoppen van
 * "IDBC Boekingen vanaf 2024.xlsx" (geverifieerd via broninspectie),
 * met kleine synthetische testwaarden — niet de echte 41MB-export.
 */
function ruweBoekingsrij(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    Bedrijfsnr: "002",
    Boekstuk_Sleutel: "202420024001",
    Boeking_Dagboeknr: "20",
    Boeking_Boekjaar: 2024,
    Boeking_Boekperiode: "01",
    Boeking_Boekstuknr: "024001",
    Boeking_Volgnr: "000002",
    Boeking_Boekdatum: "01-01-2024",
    Boeking_Grootboeknr: "1010",
    Boeking_Kostenplaatsnr: null,
    Boeking_Bedrag_Debet: 1665.54,
    Boeking_Bedrag_Credit: 0,
    Boeking_Omschrijving: "FERGAGNE Ptr van den Elsenln 23 te VEGHEL Huur",
    Boeking_Complexnr: null,
    Boeking_Unitnr: null,
    Boeking_Contractnr: null,
    Boeking_Huurdernr: null,
    Boeking_Grootboek_A: "1010",
    Boeking_Grootboek_B: "1010",
    Boeking_Saldo: 1665.54,
    ...overrides,
  };
}

describe("parseBoekingen", () => {
  it("parseert een geldige rij en herberekent Boeking_Saldo centraal", () => {
    const { rijen, issues, duplicaatIssues } = parseBoekingen([ruweBoekingsrij()]);
    expect(issues).toHaveLength(0);
    expect(duplicaatIssues).toHaveLength(0);
    expect(rijen[0]?.boekingSaldo.toString()).toBe("1665.54");
  });

  it("accepteert zowel '.' als ',' als decimaalteken (bevestigde inconsistentie tussen bronvarianten)", () => {
    const { rijen, issues } = parseBoekingen([
      ruweBoekingsrij({ Boeking_Bedrag_Debet: "67,5", Boeking_Bedrag_Credit: "0", Boeking_Saldo: "67,5" }),
    ]);
    expect(issues).toHaveLength(0);
    expect(rijen[0]?.boekingBedragDebet.toString()).toBe("67.5");
  });

  it("markeert een ontbrekend verplicht bedragveld als issue, blokkeert de rij i.p.v. 0 aan te nemen", () => {
    const { rijen, issues } = parseBoekingen([ruweBoekingsrij({ Boeking_Bedrag_Debet: null })]);
    expect(rijen).toHaveLength(0);
    expect(issues).toHaveLength(1);
  });

  it("signaleert (WAARSCHUWING) wanneer de bron een afwijkend Boeking_Saldo meelevert", () => {
    const { issues } = parseBoekingen([ruweBoekingsrij({ Boeking_Saldo: 999 })]);
    expect(issues.some((issue) => issue.ernst === "WAARSCHUWING")).toBe(true);
  });

  it("crasht niet op een #REF!-foutwaarde in Boeking_Saldo (bevestigd aanwezig in de echte export) — negeert het audit-veld i.p.v. de hele import te laten klappen", () => {
    expect(() => parseBoekingen([ruweBoekingsrij({ Boeking_Saldo: "#REF!" })])).not.toThrow();
    const { rijen, issues } = parseBoekingen([ruweBoekingsrij({ Boeking_Saldo: "#REF!" })]);
    expect(rijen).toHaveLength(1);
    expect(rijen[0]?.boekingSaldo.toString()).toBe("1665.54");
    expect(issues).toHaveLength(0);
  });

  it("detecteert dubbele natuurlijke sleutels (PAR-DQ-001)", () => {
    const { duplicaatIssues } = parseBoekingen([ruweBoekingsrij(), ruweBoekingsrij()]);
    expect(duplicaatIssues).toHaveLength(1);
  });

  it("behoudt voorloopnullen in broncodes (Bedrijfsnr blijft tekst)", () => {
    const { rijen } = parseBoekingen([ruweBoekingsrij({ Bedrijfsnr: "002" })]);
    expect(rijen[0]?.bedrijfsnr).toBe("002");
  });
});
