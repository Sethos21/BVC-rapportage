import { z } from "zod";
import Decimal from "decimal.js";
import { berekenBegrotingswaarde } from "@bvc/domain";
import { zBegrotingsBedragOptional, zCode, zCodeOptional } from "../lib/coerce.js";
import { readSheetRowsWithHeaderRow } from "../lib/readWorkbook.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "BVC_Begrotingsformat_v0.2.xlsx" — standaard begrotingsformat.
 * Meerdere tabbladen, elk met een herhaalde titelrij vóór de echte
 * kolomkoppen (geverifieerd via tekstuele inhoud van het echte bestand;
 * exacte tabbladnaam-schrijfwijze is niet apart binair geverifieerd, de
 * lezer matcht daarom hoofdletterongevoelig op een deel van de naam).
 *
 * "Grijze kolommen worden automatisch berekend" (Toelichting-tabblad) —
 * budget_q1..q4/budget_fy zijn dus BRON-berekend, geen betrouwbare
 * bronwaarheid. Deze module herberekent ze zelf via
 * @bvc/domain#berekenBegrotingswaarde en signaleert afwijkingen, in
 * plaats van de spreadsheet-formules te vertrouwen (dezelfde aanpak als
 * Boeking_Saldo in boekingen.ts).
 */

// ── Instellingen (metadata) ─────────────────────────────────────────────

const BegrotingMetadataVeldSchema = z.object({
  Veld: zCodeOptional,
  Waarde: zCodeOptional,
});

export interface BegrotingMetadata {
  administratiecode: string;
  administratienaam: string | null;
  boekjaar: number;
  begrotingsversie: string | null;
  status: string | null;
  versiedatum: string | null;
  opsteller: string | null;
  valuta: string | null;
  bronbestand: string | null;
}

/**
 * Zonder administratiecode en boekjaar wordt import geblokkeerd
 * (00_PROJECTSTATUS/06_DATA_EN_ODBC: "Zonder administratie en boekjaar
 * wordt import geblokkeerd").
 */
export function parseBegrotingMetadata(buffer: Buffer | ArrayBuffer): { metadata: BegrotingMetadata | null; issues: RowIssue[] } {
  const ruweRijen = readSheetRowsWithHeaderRow(buffer, "instelling", 1);
  const veldWaarde = new Map<string, string | null>();
  for (const ruw of ruweRijen) {
    const parsed = BegrotingMetadataVeldSchema.safeParse(ruw);
    if (parsed.success && parsed.data.Veld) {
      veldWaarde.set(parsed.data.Veld, parsed.data.Waarde);
    }
  }

  const issues: RowIssue[] = [];
  const administratiecode = veldWaarde.get("Administratiecode") ?? null;
  const boekjaarRaw = veldWaarde.get("Boekjaar") ?? null;
  const boekjaar = boekjaarRaw ? Number(boekjaarRaw) : NaN;

  if (!administratiecode) {
    issues.push({ rowIndex: -1, bericht: "Administratiecode ontbreekt op tabblad Instellingen — import geblokkeerd.", ernst: "KRITIEK" });
  }
  if (!boekjaarRaw || Number.isNaN(boekjaar)) {
    issues.push({ rowIndex: -1, bericht: "Boekjaar ontbreekt of is ongeldig op tabblad Instellingen — import geblokkeerd.", ernst: "KRITIEK" });
  }

  if (issues.some((i) => i.ernst === "KRITIEK")) {
    return { metadata: null, issues };
  }

  return {
    metadata: {
      administratiecode: administratiecode!,
      administratienaam: veldWaarde.get("Administratienaam") ?? null,
      boekjaar,
      begrotingsversie: veldWaarde.get("Begrotingsversie") ?? null,
      status: veldWaarde.get("Status") ?? null,
      versiedatum: veldWaarde.get("Versiedatum") ?? null,
      opsteller: veldWaarde.get("Opsteller") ?? null,
      valuta: veldWaarde.get("Valuta") ?? null,
      bronbestand: veldWaarde.get("Bronbestand") ?? null,
    },
    issues,
  };
}

// ── Exploitatie (P&L eigenaarsexploitatie) ──────────────────────────────

export const BegrotingExploitatieregelBronSchema = z.object({
  mapping_code: zCode,
  onderdeel: zCode,
  rapportregel: zCode,
  tekenregel: z.enum(["POSITIEF", "NEGATIEF"]),
  invoermethode: z.enum(["KWARTAAL", "JAAR"]),
  q1_invoer: zBegrotingsBedragOptional,
  q2_invoer: zBegrotingsBedragOptional,
  q3_invoer: zBegrotingsBedragOptional,
  q4_invoer: zBegrotingsBedragOptional,
  jaar_invoer: zBegrotingsBedragOptional,
  budget_fy: zBegrotingsBedragOptional,
});

export type BegrotingExploitatieregelBron = z.infer<typeof BegrotingExploitatieregelBronSchema>;

export interface GestaagdeBegrotingExploitatieregel {
  mappingCode: string;
  onderdeel: string;
  rapportregel: string;
  tekenregel: "POSITIEF" | "NEGATIEF";
  begrotingswaarde: { q1: Decimal; q2: Decimal; q3: Decimal; q4: Decimal; fy: Decimal; methode: "KWARTAAL" | "TIJDSEVENREDIG" } | null;
  raw: BegrotingExploitatieregelBron;
}

export interface BegrotingExploitatieParseResultaat extends ParseResult<GestaagdeBegrotingExploitatieregel> {
  duplicaatIssues: RowIssue[];
}

export function parseBegrotingExploitatie(buffer: Buffer | ArrayBuffer): BegrotingExploitatieParseResultaat {
  const ruweRijen = readSheetRowsWithHeaderRow(buffer, "exploitatie", 1);
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, BegrotingExploitatieregelBronSchema);

  const gestaagd: GestaagdeBegrotingExploitatieregel[] = [];
  const extraIssues: RowIssue[] = [];

  rijen.forEach((r, index) => {
    const begrotingswaarde = berekenBegrotingswaarde(r.q1_invoer, r.q2_invoer, r.q3_invoer, r.q4_invoer, r.jaar_invoer);
    if (begrotingswaarde.type === "onbekend") {
      extraIssues.push({ rowIndex: index, bericht: `${r.mapping_code}: ${begrotingswaarde.reden}.`, ernst: "KRITIEK" });
    } else if (r.budget_fy !== null && !r.budget_fy.equals(begrotingswaarde.waarde.fy)) {
      extraIssues.push({
        rowIndex: index,
        bericht: `${r.mapping_code}: bron-budget_fy (${r.budget_fy.toString()}) wijkt af van herberekende waarde (${begrotingswaarde.waarde.fy.toString()}).`,
        ernst: "WAARSCHUWING",
      });
    }
    extraIssues.push(...controleerTekenconventie(r.mapping_code, r.tekenregel, [r.q1_invoer, r.q2_invoer, r.q3_invoer, r.q4_invoer, r.jaar_invoer], index));

    gestaagd.push({
      mappingCode: r.mapping_code,
      onderdeel: r.onderdeel,
      rapportregel: r.rapportregel,
      tekenregel: r.tekenregel,
      begrotingswaarde: begrotingswaarde.type === "bekend" ? begrotingswaarde.waarde : null,
      raw: r,
    });
  });

  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, (rij) => rij.mappingCode);
  return { rijen: gestaagd, issues: [...issues, ...extraIssues], duplicaatIssues };
}

// ── Servicekosten (servicekostenbegroting) ──────────────────────────────

export const BegrotingServicekostenregelBronSchema = z.object({
  mapping_code: zCode,
  recordtype: z.enum(["KOSTENSOORT", "COMPLEX_TOTAAL", "VOORSCHOT"]),
  complex_code: zCode,
  kostensoort: zCode,
  tekenregel: z.enum(["POSITIEF", "NEGATIEF"]),
  invoermethode: z.enum(["KWARTAAL", "JAAR"]),
  q1_invoer: zBegrotingsBedragOptional,
  q2_invoer: zBegrotingsBedragOptional,
  q3_invoer: zBegrotingsBedragOptional,
  q4_invoer: zBegrotingsBedragOptional,
  jaar_invoer: zBegrotingsBedragOptional,
  budget_fy: zBegrotingsBedragOptional,
  toelichting: zCodeOptional,
});

export type BegrotingServicekostenregelBron = z.infer<typeof BegrotingServicekostenregelBronSchema>;

export interface GestaagdeBegrotingServicekostenregel {
  mappingCode: string;
  recordtype: "KOSTENSOORT" | "COMPLEX_TOTAAL" | "VOORSCHOT";
  complexCode: string;
  kostensoort: string;
  tekenregel: "POSITIEF" | "NEGATIEF";
  begrotingswaarde: { q1: Decimal; q2: Decimal; q3: Decimal; q4: Decimal; fy: Decimal; methode: "KWARTAAL" | "TIJDSEVENREDIG" } | null;
  raw: BegrotingServicekostenregelBron;
}

export interface BegrotingServicekostenParseResultaat extends ParseResult<GestaagdeBegrotingServicekostenregel> {
  duplicaatIssues: RowIssue[];
}

export function parseBegrotingServicekosten(buffer: Buffer | ArrayBuffer): BegrotingServicekostenParseResultaat {
  const ruweRijen = readSheetRowsWithHeaderRow(buffer, "servicekosten", 1);
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, BegrotingServicekostenregelBronSchema);

  const gestaagd: GestaagdeBegrotingServicekostenregel[] = [];
  const extraIssues: RowIssue[] = [];

  rijen.forEach((r, index) => {
    const begrotingswaarde = berekenBegrotingswaarde(r.q1_invoer, r.q2_invoer, r.q3_invoer, r.q4_invoer, r.jaar_invoer);
    if (begrotingswaarde.type === "onbekend") {
      extraIssues.push({ rowIndex: index, bericht: `${r.mapping_code}: ${begrotingswaarde.reden}.`, ernst: "KRITIEK" });
    } else if (r.budget_fy !== null && !r.budget_fy.equals(begrotingswaarde.waarde.fy)) {
      extraIssues.push({
        rowIndex: index,
        bericht: `${r.mapping_code}: bron-budget_fy (${r.budget_fy.toString()}) wijkt af van herberekende waarde (${begrotingswaarde.waarde.fy.toString()}).`,
        ernst: "WAARSCHUWING",
      });
    }
    extraIssues.push(...controleerTekenconventie(r.mapping_code, r.tekenregel, [r.q1_invoer, r.q2_invoer, r.q3_invoer, r.q4_invoer, r.jaar_invoer], index));

    if (r.complex_code === "NIET_TOEGEWEZEN") {
      extraIssues.push({
        rowIndex: index,
        bericht: `${r.mapping_code}: complex_code is NIET_TOEGEWEZEN — blokkeert publicatie (Toelichting-tabblad, punt 8).`,
        ernst: "KRITIEK",
      });
    }

    gestaagd.push({
      mappingCode: r.mapping_code,
      recordtype: r.recordtype,
      complexCode: r.complex_code,
      kostensoort: r.kostensoort,
      tekenregel: r.tekenregel,
      begrotingswaarde: begrotingswaarde.type === "bekend" ? begrotingswaarde.waarde : null,
      raw: r,
    });
  });

  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, (rij) => rij.mappingCode);
  return { rijen: gestaagd, issues: [...issues, ...extraIssues], duplicaatIssues };
}

// ── Gedeelde controle ────────────────────────────────────────────────────

/**
 * "Tekenconventie wijkt af van sectieregel" is publicatieblokkerend: bij
 * POSITIEF moeten ingevulde bedragen >= 0 zijn, bij NEGATIEF <= 0.
 */
function controleerTekenconventie(
  mappingCode: string,
  tekenregel: "POSITIEF" | "NEGATIEF",
  waarden: readonly (Decimal | null)[],
  rowIndex: number,
): RowIssue[] {
  const afwijkend = waarden.some((w) => w !== null && (tekenregel === "POSITIEF" ? w.isNegative() : w.isPositive()));
  if (!afwijkend) return [];
  return [
    {
      rowIndex,
      bericht: `${mappingCode}: ingevuld bedrag heeft een teken dat afwijkt van tekenregel ${tekenregel} — blokkerende tekenfout.`,
      ernst: "KRITIEK",
    },
  ];
}
