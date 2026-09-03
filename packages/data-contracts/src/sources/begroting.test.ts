import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseBegrotingExploitatie, parseBegrotingMetadata, parseBegrotingServicekosten } from "./begroting.js";

/**
 * Bouwt een in-memory werkmap met dezelfde structuur als het echte
 * BVC_Begrotingsformat_v0.2.xlsx: een herhaalde titelrij, dan de echte
 * kolomkoppen, dan databodemrijen — geverifieerd tegen het echte bestand.
 */
function bouwBegrotingWerkmap(): Buffer {
  const workbook = XLSX.utils.book_new();

  const instellingen = XLSX.utils.aoa_to_sheet([
    ["Instellingen BVC Begroting v0.2", "", "", ""],
    ["Veld", "Waarde", "", ""],
    ["Administratiecode", "002", "", ""],
    ["Administratienaam", "Fergagne bv", "", ""],
    ["Boekjaar", 2026, "", ""],
    ["Begrotingsversie", "v0.2", "", ""],
    ["Status", "Concept", "", ""],
  ]);
  XLSX.utils.book_append_sheet(workbook, instellingen, "Instellingen");

  const exploitatie = XLSX.utils.aoa_to_sheet([
    ["Exploitatie Eigenaarsexploitatie", "", "", "", "", "", "", "", "", "", ""],
    ["mapping_code", "onderdeel", "rapportregel", "tekenregel", "invoermethode", "q1_invoer", "q2_invoer", "q3_invoer", "q4_invoer", "jaar_invoer", "budget_fy"],
    ["PL_HUUR_BELAST", "P&L - Opbrengsten", "Huuropbrengst belast", "POSITIEF", "KWARTAAL", 139152, 130321, 128610, 128610, null, 526693],
    ["PL_BEHEERKOSTEN", "P&L - Kosten", "Beheerkosten", "NEGATIEF", "JAAR", null, null, null, null, -12409, -12409],
  ]);
  XLSX.utils.book_append_sheet(workbook, exploitatie, "Exploitatie");

  const servicekosten = XLSX.utils.aoa_to_sheet([
    ["Servicekosten Servicekostenbegroting", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["mapping_code", "recordtype", "complex_code", "kostensoort", "tekenregel", "invoermethode", "q1_invoer", "q2_invoer", "q3_invoer", "q4_invoer", "jaar_invoer", "budget_fy", "toelichting"],
    ["SC_GAS", "KOSTENSOORT", "ALLE_COMPLEXEN", "Gas", "NEGATIEF", "JAAR", null, null, null, null, -19890, -19890, null],
  ]);
  XLSX.utils.book_append_sheet(workbook, servicekosten, "Servicekosten");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseBegrotingMetadata", () => {
  it("leest administratiecode en boekjaar uit het Instellingen-tabblad", () => {
    const { metadata, issues } = parseBegrotingMetadata(bouwBegrotingWerkmap());
    expect(issues).toHaveLength(0);
    expect(metadata?.administratiecode).toBe("002");
    expect(metadata?.boekjaar).toBe(2026);
  });

  it("blokkeert (KRITIEK) zonder administratiecode of boekjaar", () => {
    const workbook = XLSX.utils.book_new();
    const instellingen = XLSX.utils.aoa_to_sheet([
      ["Instellingen", ""],
      ["Veld", "Waarde"],
      ["Administratiecode", ""],
      ["Boekjaar", ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, instellingen, "Instellingen");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const { metadata, issues } = parseBegrotingMetadata(buffer);
    expect(metadata).toBeNull();
    expect(issues.every((i) => i.ernst === "KRITIEK")).toBe(true);
  });
});

describe("parseBegrotingExploitatie", () => {
  it("herberekent begrotingswaarde en accepteert een consistent budget_fy", () => {
    const { rijen, issues } = parseBegrotingExploitatie(bouwBegrotingWerkmap());
    expect(rijen).toHaveLength(2);
    expect(issues.filter((i) => i.ernst === "KRITIEK")).toHaveLength(0);
    expect(rijen[0]?.begrotingswaarde?.methode).toBe("KWARTAAL");
    expect(rijen[1]?.begrotingswaarde?.methode).toBe("TIJDSEVENREDIG");
  });

  it("signaleert (WAARSCHUWING) wanneer bron-budget_fy afwijkt van de herberekende waarde", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Exploitatie", "", "", "", "", "", "", "", "", "", ""],
      ["mapping_code", "onderdeel", "rapportregel", "tekenregel", "invoermethode", "q1_invoer", "q2_invoer", "q3_invoer", "q4_invoer", "jaar_invoer", "budget_fy"],
      ["PL_TEST", "P&L - Opbrengsten", "Test", "POSITIEF", "KWARTAAL", 100, 100, 100, 100, null, 999],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Exploitatie");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const { issues } = parseBegrotingExploitatie(buffer);
    expect(issues.some((i) => i.ernst === "WAARSCHUWING" && i.bericht.includes("budget_fy"))).toBe(true);
  });

  it("blokkeert (KRITIEK) bij een tekenfout: NEGATIEF-regel met een positief bedrag", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Exploitatie", "", "", "", "", "", "", "", "", "", ""],
      ["mapping_code", "onderdeel", "rapportregel", "tekenregel", "invoermethode", "q1_invoer", "q2_invoer", "q3_invoer", "q4_invoer", "jaar_invoer", "budget_fy"],
      ["PL_FOUT", "P&L - Kosten", "Test", "NEGATIEF", "JAAR", null, null, null, null, 500, 500],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Exploitatie");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const { issues } = parseBegrotingExploitatie(buffer);
    expect(issues.some((i) => i.ernst === "KRITIEK" && i.bericht.includes("tekenfout"))).toBe(true);
  });

  it("detecteert dubbele mapping_code", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Exploitatie", "", "", "", "", "", "", "", "", "", ""],
      ["mapping_code", "onderdeel", "rapportregel", "tekenregel", "invoermethode", "q1_invoer", "q2_invoer", "q3_invoer", "q4_invoer", "jaar_invoer", "budget_fy"],
      ["PL_DUP", "P&L - Opbrengsten", "A", "POSITIEF", "JAAR", null, null, null, null, 100, 100],
      ["PL_DUP", "P&L - Opbrengsten", "B", "POSITIEF", "JAAR", null, null, null, null, 200, 200],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Exploitatie");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const { duplicaatIssues } = parseBegrotingExploitatie(buffer);
    expect(duplicaatIssues).toHaveLength(1);
  });
});

describe("parseBegrotingServicekosten", () => {
  it("parseert een geldige servicekostenregel", () => {
    const { rijen, issues } = parseBegrotingServicekosten(bouwBegrotingWerkmap());
    expect(rijen).toHaveLength(1);
    expect(issues.filter((i) => i.ernst === "KRITIEK")).toHaveLength(0);
    expect(rijen[0]?.begrotingswaarde?.fy.toString()).toBe("-19890");
  });

  it("blokkeert (KRITIEK) een NIET_TOEGEWEZEN complex_code", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Servicekosten", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["mapping_code", "recordtype", "complex_code", "kostensoort", "tekenregel", "invoermethode", "q1_invoer", "q2_invoer", "q3_invoer", "q4_invoer", "jaar_invoer", "budget_fy", "toelichting"],
      ["SC_ONBEKEND", "KOSTENSOORT", "NIET_TOEGEWEZEN", "Test", "NEGATIEF", "JAAR", null, null, null, null, -100, -100, null],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Servicekosten");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const { issues } = parseBegrotingServicekosten(buffer);
    expect(issues.some((i) => i.ernst === "KRITIEK" && i.bericht.includes("NIET_TOEGEWEZEN"))).toBe(true);
  });
});
