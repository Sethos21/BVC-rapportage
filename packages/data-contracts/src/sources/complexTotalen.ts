import { z } from "zod";
import Decimal from "decimal.js";
import { zCode, zDecimalOptional } from "../lib/coerce.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "IDBC Complex Totalen" — controle-/aggregatiebron voor
 * complextotalen. Let op: dit bestand gebruikt "Complexnr", anders dan
 * Units/Contracten/RentRoll/Servicekosten die "Complexnummer" gebruiken —
 * geverifieerd tegen het echte bronbestand, geen tikfout.
 * Natuurlijke sleutel: Bedrijfsnr + Complexnr.
 */
export const ComplexTotaalBronSchema = z.object({
  Bedrijfsnr: zCode,
  Complexnr: zCode,
  Totaal_Oppervlakte: zDecimalOptional,
  Totaal_Verhuurd: zDecimalOptional,
  Totaal_Leegstand: zDecimalOptional,
});

export type ComplexTotaalBron = z.infer<typeof ComplexTotaalBronSchema>;

export interface GestaagdComplexTotaal {
  bedrijfsnr: string;
  complexnr: string;
  totaalOppervlakte: Decimal | null;
  totaalVerhuurd: Decimal | null;
  totaalLeegstand: Decimal | null;
  raw: ComplexTotaalBron;
}

function naarGestaagdComplexTotaal(bron: ComplexTotaalBron): GestaagdComplexTotaal {
  return {
    bedrijfsnr: bron.Bedrijfsnr,
    complexnr: bron.Complexnr,
    totaalOppervlakte: bron.Totaal_Oppervlakte,
    totaalVerhuurd: bron.Totaal_Verhuurd,
    totaalLeegstand: bron.Totaal_Leegstand,
    raw: bron,
  };
}

export function complexTotaalNatuurlijkeSleutel(rij: GestaagdComplexTotaal): string {
  return [rij.bedrijfsnr, rij.complexnr].join("::");
}

/**
 * "Complex Totalen is controlebron en overschrijft geen betrouwbaardere
 * unitgegevens" — dit signaleert alleen, past niets automatisch aan.
 */
export function controleerComplexTotalenAansluiting(rijen: readonly GestaagdComplexTotaal[]): RowIssue[] {
  const issues: RowIssue[] = [];
  rijen.forEach((rij, index) => {
    if (rij.totaalVerhuurd !== null && rij.totaalOppervlakte !== null && rij.totaalVerhuurd.greaterThan(rij.totaalOppervlakte)) {
      issues.push({
        rowIndex: index,
        bericht: `Complex ${rij.bedrijfsnr}/${rij.complexnr}: Totaal_Verhuurd (${rij.totaalVerhuurd.toString()}) groter dan Totaal_Oppervlakte (${rij.totaalOppervlakte.toString()}).`,
        ernst: "KRITIEK",
      });
    }
  });
  return issues;
}

export interface ComplexTotalenParseResultaat extends ParseResult<GestaagdComplexTotaal> {
  duplicaatIssues: RowIssue[];
}

export function parseComplexTotalen(ruweRijen: readonly Record<string, unknown>[]): ComplexTotalenParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, ComplexTotaalBronSchema);
  const gestaagd = rijen.map(naarGestaagdComplexTotaal);
  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, complexTotaalNatuurlijkeSleutel);
  return { rijen: gestaagd, issues: [...issues, ...controleerComplexTotalenAansluiting(gestaagd)], duplicaatIssues };
}
