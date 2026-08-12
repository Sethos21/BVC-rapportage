import { z } from "zod";
import Decimal from "decimal.js";
import { zCode, zDecimal } from "../lib/coerce.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "IDBC Ouderdomsanalyse" — leidende bron voor debiteurenouderdom
 * (00_PROJECTSTATUS.md-aanvulling 2026-08-12). Kolomnamen geverifieerd
 * tegen het echte bronbestand (33 kolommen totaal; hier de sleutel-/
 * rekenvelden, contactgegevens blijven uitsluitend in `raw` — persoons-
 * velden gaan niet naar rapportage-/AI-context tenzij functioneel nodig).
 *
 * De export bevat GEEN peildatumveld: boekjaar en boekperiode zijn daarom
 * verplichte importmetadata (niet kolommen in het bestand zelf) en de
 * peildatum is de laatste kalenderdag van die boekperiode.
 * Natuurlijke sleutel: Bedrijfsnr + Huurdernr (+ boekjaar/boekperiode als
 * importmetadata, want de bron zelf bevat geen periodekolom).
 */
export const OuderdomsanalyseBronSchema = z.object({
  Bedrijfsnr: zCode,
  Huurdernr: zCode,
  Achterstand: zDecimal,
  Achterstand_tm_30_dagen: zDecimal,
  Achterstand_tm_60_dagen: zDecimal,
  Achterstand_tm_90_dagen: zDecimal,
  Achterstand_90plus_dagen: zDecimal,
  Vooruitbetaling: zDecimal,
  Saldo: zDecimal,
});

export type OuderdomsanalyseBron = z.infer<typeof OuderdomsanalyseBronSchema>;

export interface GestaagdeOuderdomsanalyseregel {
  bedrijfsnr: string;
  huurdernr: string;
  achterstand: Decimal;
  achterstandTm30Dagen: Decimal;
  achterstandTm60Dagen: Decimal;
  achterstandTm90Dagen: Decimal;
  achterstand90PlusDagen: Decimal;
  vooruitbetaling: Decimal;
  saldo: Decimal;
  boekjaar: number;
  boekperiode: string;
  /** Laatste kalenderdag van boekperiode — de bron bevat zelf geen peildatum. */
  peildatum: Date;
  raw: OuderdomsanalyseBron;
}

export interface OuderdomsanalyseImportmetadata {
  boekjaar: number;
  boekperiode: string;
  peildatum: Date;
}

function naarGestaagdeRegel(bron: OuderdomsanalyseBron, metadata: OuderdomsanalyseImportmetadata): GestaagdeOuderdomsanalyseregel {
  return {
    bedrijfsnr: bron.Bedrijfsnr,
    huurdernr: bron.Huurdernr,
    achterstand: bron.Achterstand,
    achterstandTm30Dagen: bron.Achterstand_tm_30_dagen,
    achterstandTm60Dagen: bron.Achterstand_tm_60_dagen,
    achterstandTm90Dagen: bron.Achterstand_tm_90_dagen,
    achterstand90PlusDagen: bron.Achterstand_90plus_dagen,
    vooruitbetaling: bron.Vooruitbetaling,
    saldo: bron.Saldo,
    boekjaar: metadata.boekjaar,
    boekperiode: metadata.boekperiode,
    peildatum: metadata.peildatum,
    raw: bron,
  };
}

export function ouderdomsanalyseNatuurlijkeSleutel(rij: GestaagdeOuderdomsanalyseregel): string {
  return [rij.bedrijfsnr, rij.huurdernr, rij.boekjaar, rij.boekperiode].join("::");
}

/** Saldo = Achterstand - Vooruitbetaling (geldregel uit de aanvulling op 00_PROJECTSTATUS.md). */
export function controleerSaldoFormule(rijen: readonly GestaagdeOuderdomsanalyseregel[]): RowIssue[] {
  const issues: RowIssue[] = [];
  rijen.forEach((rij, index) => {
    const verwacht = rij.achterstand.minus(rij.vooruitbetaling);
    if (!verwacht.equals(rij.saldo)) {
      issues.push({
        rowIndex: index,
        bericht: `Saldo (${rij.saldo.toString()}) komt niet overeen met Achterstand - Vooruitbetaling (${verwacht.toString()}).`,
        ernst: "KRITIEK",
      });
    }
    if (rij.vooruitbetaling.isNegative()) {
      issues.push({
        rowIndex: index,
        bericht: `Negatieve Vooruitbetaling (${rij.vooruitbetaling.toString()}) — controlesignaal.`,
        ernst: "WAARSCHUWING",
      });
    }
  });
  return issues;
}

export interface OuderdomsanalyseParseResultaat extends ParseResult<GestaagdeOuderdomsanalyseregel> {
  duplicaatIssues: RowIssue[];
}

export function parseOuderdomsanalyse(
  ruweRijen: readonly Record<string, unknown>[],
  metadata: OuderdomsanalyseImportmetadata,
): OuderdomsanalyseParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, OuderdomsanalyseBronSchema);
  const gestaagd = rijen.map((rij) => naarGestaagdeRegel(rij, metadata));
  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, ouderdomsanalyseNatuurlijkeSleutel);
  return { rijen: gestaagd, issues: [...issues, ...controleerSaldoFormule(gestaagd)], duplicaatIssues };
}
