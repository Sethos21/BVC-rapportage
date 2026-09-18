import Decimal from "decimal.js";
import { z } from "zod";

/**
 * De IDBC-exports zijn niet consistent in decimaal-notatie: dezelfde
 * servicekostenexport bestaat in een XLSX-archiefversie met "." als
 * decimaalteken en een native Google Sheets "werkversie" met ",".
 * (Bevestigd bij broninspectie — zie root-README.) Beide moeten naar
 * dezelfde Decimal leiden zonder een teken of betekenis te wijzigen.
 */
export function coerceDecimal(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Decimal) return value;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return null;
    return new Decimal(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "-") return null;
    // Enkel een "," of "." als decimaalscheider, geen duizendtalscheiding
    // waargenomen in de bronbestanden (boekingen/balans/servicekosten/
    // rentroll/ouderdomsanalyse) — vervang "," door "." indien aanwezig.
    // Let op: de begroting-bronnen gebruiken een ANDERE (accounting-)
    // notatie — zie coerceBegrotingsBedrag hieronder, niet deze functie.
    const normalised = trimmed.includes(",") && !trimmed.includes(".") ? trimmed.replace(",", ".") : trimmed;
    try {
      return new Decimal(normalised);
    } catch {
      // Onparseerbare tekst (bv. een Excel-foutwaarde als #REF!/#VALUE!/#N/A,
      // bevestigd aanwezig in echte Boeking_Saldo-cellen) — nooit een
      // ongevangen crash. Het schema meldt dit via de verplicht/optioneel-
      // check als ontbrekend/ongeldig bedrag ("Controle vereist"), in
      // plaats van dat we de waarde gokken of de hele import laten klappen.
      return null;
    }
  }
  throw new Error(`Onverwacht type voor decimaalwaarde: ${typeof value}`);
}

/**
 * Begroting-bronnen (BVC_Begrotingsformat_v0.2.xlsx) gebruiken accounting-
 * notatie, geverifieerd tegen het echte bronbestand: "," als
 * duizendtalscheider zonder decimalen (bv. "139,152" = 139152) en
 * haakjes voor negatieve bedragen (bv. "(7,086)" = -7086), i.p.v. de
 * kale "," of "." als decimaalscheider die de overige bronnen gebruiken
 * (coerceDecimal hierboven). Een losse "-" betekent leeg/nul, zoals bij
 * coerceDecimal.
 */
export function coerceBegrotingsBedrag(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Decimal) return value;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return null;
    return new Decimal(value);
  }
  if (typeof value === "string") {
    let trimmed = value.trim();
    if (trimmed === "" || trimmed === "-") return null;
    let negatief = false;
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
      negatief = true;
      trimmed = trimmed.slice(1, -1).trim();
    }
    const zonderDuizendtallen = trimmed.replace(/,/g, "");
    try {
      const parsed = new Decimal(zonderDuizendtallen);
      return negatief ? parsed.negated() : parsed;
    } catch {
      // Onparseerbare tekst (bv. een Excel-foutwaarde als #VALUE!,
      // bevestigd aanwezig in echte begroting-bronbestanden) — zelfde
      // "nooit gokken, nooit crashen"-aanpak als coerceDecimal.
      return null;
    }
  }
  throw new Error(`Onverwacht type voor begrotingsbedrag: ${typeof value}`);
}

/** Bronbedragen zijn nooit optioneel afwezig zonder betekenis — dit faalt hard i.p.v. 0 aan te nemen. */
export function coerceRequiredDecimal(value: unknown, veld: string): Decimal {
  const decimal = coerceDecimal(value);
  if (decimal === null) {
    throw new Error(`Verplicht bedragveld "${veld}" ontbreekt of is leeg — mag nooit stilzwijgend 0 worden.`);
  }
  return decimal;
}

/** Datums in de bron staan als DD-MM-YYYY tekst, of (afhankelijk van export) al als Date via cellDates. */
export function coerceDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
    if (ddmmyyyy) {
      const [, day, month, year] = ddmmyyyy;
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number") {
    // Excel-serial datum (dagen sinds 1899-12-30), voor het geval cellDates niet werkt.
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + value * 86_400_000);
  }
  return null;
}

/**
 * Broncodes blijven tekst; alleen niet-betekenisvolle eindspaties worden
 * verwijderd. Voorloopnullen NOOIT verwijderen (06_DATA_EN_ODBC_v0.3.md).
 */
export function coerceCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const asString = typeof value === "number" ? String(value) : String(value);
  const trimmed = asString.replace(/\s+$/u, "");
  return trimmed === "" ? null : trimmed;
}

export function coerceRequiredCode(value: unknown, veld: string): string {
  const code = coerceCode(value);
  if (code === null) {
    throw new Error(`Verplicht sleutelveld "${veld}" ontbreekt of is leeg.`);
  }
  return code;
}

// ── Zod-bouwstenen voor broncontracten ──────────────────────────────────
// "Validatie: Zod-contracten aan de importgrens" (13_TECHNISCHE_IMPLEMENTATIEKEUZES_v0.1.md).
// Elk broncontract in ./sources gebruikt deze bouwstenen zodat coercion
// (decimaal-notatie, datumformaat, voorloopnullen) op precies één plek zit.

export const zCode = z.preprocess(coerceCode, z.string({ error: "verplicht broncodeveld ontbreekt" }));
export const zCodeOptional = z.preprocess(coerceCode, z.string().nullable());

export const zDecimal = z.preprocess(
  coerceDecimal,
  z.instanceof(Decimal, { error: "verplicht bedragveld ontbreekt of is ongeldig" }),
);
export const zDecimalOptional = z.preprocess(coerceDecimal, z.instanceof(Decimal).nullable());

/** Voor begroting-bronnen — zie coerceBegrotingsBedrag (accounting-notatie, niet coerceDecimal). */
export const zBegrotingsBedragOptional = z.preprocess(coerceBegrotingsBedrag, z.instanceof(Decimal).nullable());

export const zDate = z.preprocess(coerceDate, z.date({ error: "verplicht datumveld ontbreekt of is ongeldig" }));
export const zDateOptional = z.preprocess(coerceDate, z.date().nullable());

export const zIntOptional = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}, z.number().int().nullable());
