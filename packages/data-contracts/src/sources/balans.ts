import { z } from "zod";
import Decimal from "decimal.js";
import { zCode, zCodeOptional, zDecimal, zDecimalOptional } from "../lib/coerce.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "IDCB Balans per jaar vanaf 2024.xlsx" — leidend voor balansstanden
 * en jaarmutaties. Kolomnamen geverifieerd tegen het echte bronbestand
 * (103 kolommen totaal, incl. 15 periodeparen debet/credit die hier niet
 * individueel gemodelleerd zijn — die blijven beschikbaar in `raw`).
 * Natuurlijke sleutel: Bedrijfsnr + Jaar + Grootboekrekeningnr.
 */
export const BalansstandBronSchema = z.object({
  Bedrijfsnr: zCode,
  Jaar: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int()),
  Grootboekrekeningnr: zCode,
  Beginbalans_debet: zDecimalOptional,
  Beginbalans_credit: zDecimalOptional,
  Saldo_debet: zDecimal,
  Saldo_credit: zDecimal,
  Eindsaldo_debet: zDecimalOptional,
  Eindsaldo_credit: zDecimalOptional,
  Eindsaldo: zDecimal,
  Rekening_omschrijving: zCodeOptional,
  Balans_vw: zCodeOptional,
});

export type BalansstandBron = z.infer<typeof BalansstandBronSchema>;

export interface GestaagdeBalansstand {
  bedrijfsnr: string;
  jaar: number;
  grootboekrekeningnr: string;
  beginbalansDebet: Decimal | null;
  beginbalansCredit: Decimal | null;
  saldoDebet: Decimal;
  saldoCredit: Decimal;
  eindsaldoDebet: Decimal | null;
  eindsaldoCredit: Decimal | null;
  eindsaldo: Decimal;
  rekeningOmschrijving: string | null;
  balansVw: string | null;
  raw: BalansstandBron;
}

export function naarGestaagdeBalansstand(bron: BalansstandBron): GestaagdeBalansstand {
  return {
    bedrijfsnr: bron.Bedrijfsnr,
    jaar: bron.Jaar,
    grootboekrekeningnr: bron.Grootboekrekeningnr,
    beginbalansDebet: bron.Beginbalans_debet,
    beginbalansCredit: bron.Beginbalans_credit,
    saldoDebet: bron.Saldo_debet,
    saldoCredit: bron.Saldo_credit,
    eindsaldoDebet: bron.Eindsaldo_debet,
    eindsaldoCredit: bron.Eindsaldo_credit,
    eindsaldo: bron.Eindsaldo,
    rekeningOmschrijving: bron.Rekening_omschrijving,
    balansVw: bron.Balans_vw,
    raw: bron,
  };
}

export function balansstandNatuurlijkeSleutel(rij: GestaagdeBalansstand): string {
  return [rij.bedrijfsnr, rij.jaar, rij.grootboekrekeningnr].join("::");
}

export interface BalansParseResultaat extends ParseResult<GestaagdeBalansstand> {
  duplicaatIssues: RowIssue[];
}

export function parseBalans(ruweRijen: readonly Record<string, unknown>[]): BalansParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, BalansstandBronSchema);
  const gestaagd = rijen.map(naarGestaagdeBalansstand);
  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, balansstandNatuurlijkeSleutel);
  return { rijen: gestaagd, issues, duplicaatIssues };
}
