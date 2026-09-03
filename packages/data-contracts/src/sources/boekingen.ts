import { z } from "zod";
import Decimal from "decimal.js";
import { zCode, zCodeOptional, zDate, zDecimal, zDecimalOptional } from "../lib/coerce.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "IDBC Boekingen vanaf 2024.xlsx" — leidend voor gerealiseerde
 * mutaties en drilldown. Kolomnamen hieronder zijn geverifieerd tegen het
 * echte bronbestand (168 kolommen totaal; hier alleen de sleutel-/
 * rekenvelden die het datamodel nodig heeft — de rest komt in `raw` mee).
 * Natuurlijke sleutel: Bedrijfsnr + Boeking_Boekjaar + Boeking_Dagboeknr +
 * Boeking_Boekstuknr + Boeking_Volgnr.
 */
export const BoekingsregelBronSchema = z.object({
  Bedrijfsnr: zCode,
  Boekstuk_Sleutel: zCode,
  Boeking_Dagboeknr: zCode,
  Boeking_Boekjaar: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int()),
  Boeking_Boekperiode: zCode,
  Boeking_Boekstuknr: zCode,
  Boeking_Volgnr: zCode,
  Boeking_Boekdatum: zDate,
  Boeking_Grootboeknr: zCode,
  Boeking_Kostenplaatsnr: zCodeOptional,
  Boeking_Bedrag_Debet: zDecimal,
  Boeking_Bedrag_Credit: zDecimal,
  Boeking_Omschrijving: zCodeOptional,
  Boeking_Complexnr: zCodeOptional,
  Boeking_Unitnr: zCodeOptional,
  Boeking_Contractnr: zCodeOptional,
  Boeking_Huurdernr: zCodeOptional,
  Boeking_Grootboek_A: zCodeOptional,
  Boeking_Grootboek_B: zCodeOptional,
  /** Bronwaarde, alleen voor auditvergelijking — nooit leidend (CAL-FIN-001 herberekent). */
  Boeking_Saldo: zDecimalOptional,
});

export type BoekingsregelBron = z.infer<typeof BoekingsregelBronSchema>;

export interface GestagedBoekingsregel {
  bedrijfsnr: string;
  boekingBoekjaar: number;
  boekingBoekperiode: string;
  boekingDagboeknr: string;
  boekingBoekstuknr: string;
  boekingVolgnr: string;
  boekstukSleutel: string;
  boekingBoekdatum: Date;
  boekingGrootboeknr: string;
  boekingKostenplaatsnr: string | null;
  boekingComplexnr: string | null;
  boekingUnitnr: string | null;
  boekingContractnr: string | null;
  boekingHuurdernr: string | null;
  boekingBedragDebet: Decimal;
  boekingBedragCredit: Decimal;
  /** Altijd centraal herberekend (CAL-FIN-001), nooit de bronkolom Boeking_Saldo overnemen. */
  boekingSaldo: Decimal;
  boekingOmschrijving: string | null;
  boekingGrootboekA: string | null;
  boekingGrootboekB: string | null;
  raw: BoekingsregelBron;
}

export function naarGestaagdeBoekingsregel(bron: BoekingsregelBron): GestagedBoekingsregel {
  const saldo = bron.Boeking_Bedrag_Debet.minus(bron.Boeking_Bedrag_Credit);
  return {
    bedrijfsnr: bron.Bedrijfsnr,
    boekingBoekjaar: bron.Boeking_Boekjaar,
    boekingBoekperiode: bron.Boeking_Boekperiode,
    boekingDagboeknr: bron.Boeking_Dagboeknr,
    boekingBoekstuknr: bron.Boeking_Boekstuknr,
    boekingVolgnr: bron.Boeking_Volgnr,
    boekstukSleutel: bron.Boekstuk_Sleutel,
    boekingBoekdatum: bron.Boeking_Boekdatum,
    boekingGrootboeknr: bron.Boeking_Grootboeknr,
    boekingKostenplaatsnr: bron.Boeking_Kostenplaatsnr,
    boekingComplexnr: bron.Boeking_Complexnr,
    boekingUnitnr: bron.Boeking_Unitnr,
    boekingContractnr: bron.Boeking_Contractnr,
    boekingHuurdernr: bron.Boeking_Huurdernr,
    boekingBedragDebet: bron.Boeking_Bedrag_Debet,
    boekingBedragCredit: bron.Boeking_Bedrag_Credit,
    boekingSaldo: saldo,
    boekingOmschrijving: bron.Boeking_Omschrijving,
    boekingGrootboekA: bron.Boeking_Grootboek_A,
    boekingGrootboekB: bron.Boeking_Grootboek_B,
    raw: bron,
  };
}

export function boekingsregelNatuurlijkeSleutel(rij: GestagedBoekingsregel): string {
  return [rij.bedrijfsnr, rij.boekingBoekjaar, rij.boekingDagboeknr, rij.boekingBoekstuknr, rij.boekingVolgnr].join("::");
}

export interface BoekingenParseResultaat extends ParseResult<GestagedBoekingsregel> {
  duplicaatIssues: RowIssue[];
}

/**
 * PAR-DQ-003-achtige extra controle: signaleert wanneer de bron zelf een
 * Boeking_Saldo meelevert dat afwijkt van de centraal herberekende waarde
 * (debet - credit). Dit blokkeert niet, maar is een WAARSCHUWING —
 * afwijkende bronsaldi mogen niet stilzwijgend genegeerd worden.
 */
export function controleerBronsaldoAfwijking(rijen: readonly GestagedBoekingsregel[]): RowIssue[] {
  const issues: RowIssue[] = [];
  rijen.forEach((rij, index) => {
    const bronSaldo = rij.raw.Boeking_Saldo;
    if (bronSaldo !== null && !bronSaldo.equals(rij.boekingSaldo)) {
      issues.push({
        rowIndex: index,
        bericht: `Bronkolom Boeking_Saldo (${bronSaldo.toString()}) wijkt af van herberekend debet-credit (${rij.boekingSaldo.toString()}).`,
        ernst: "WAARSCHUWING",
      });
    }
  });
  return issues;
}

export function parseBoekingen(ruweRijen: readonly Record<string, unknown>[]): BoekingenParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, BoekingsregelBronSchema);
  const gestaagd = rijen.map(naarGestaagdeBoekingsregel);
  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, boekingsregelNatuurlijkeSleutel);
  return { rijen: gestaagd, issues: [...issues, ...controleerBronsaldoAfwijking(gestaagd)], duplicaatIssues };
}
