import { z } from "zod";
import Decimal from "decimal.js";
import { zCode, zCodeOptional, zDate, zDecimal } from "../lib/coerce.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "Vorderingen met afboekingen" — vervangt `vorderingen.xlsx`
 * (2026-08-28 onderzoek: onvolledig, voor 070 zelfs 0 openstaande posten)
 * als structurele detailbron voor openstaande posten. Bewezen tegen de
 * echte 070-cijfers (2026-08-31, packages/reporting/README.md): detail-
 * openstaand € 65.811,57 sluit exact op `saldo_huurders` (14/14 huurders
 * MATCH), en de contractattributie (o.a. huurder iTapToo → contracten
 * 0000000044/0000000049 apart) is bevestigd correct.
 *
 * Natuurlijke sleutel: Bedrijfsnr + Contractnr + Vordering_Volgnr —
 * bewezen 100% uniek (0 dubbele sleutels over alle onderzochte
 * administraties). `Vordering_Volgnr` is NIET uniek binnen een
 * administratie op zichzelf (hergebruikt per contract), en NOOIT
 * Contractnr alleen — zelfde discipline als `contract_verhogingen`
 * (gedeeld bronbestand over alle administraties).
 *
 * Bewust minimaal gemodelleerd (CLAUDE.md §3) uit 189 ruwe kolommen: de
 * VS_01..VS_20-bedragen/btw/afgeboekt-per-component en de uitgebreide
 * contact-/kadaster-/incassovelden zijn NIET opgenomen — voor
 * openstaande-postenlogica is alleen het totaalniveau (Vordering_
 * Totaalbedrag/Bedrag_afgeboekt/Vordering_openstaand, bewezen
 * `Totaalbedrag - afgeboekt = openstaand` in 100% van de rijen) nodig.
 * `Vordering_afgehandeld_periode`/`_jaar` zijn de enige "afhandeld"-velden
 * die zijn opgenomen: bewezen 100%-consistent signaal (bij 070: 0/10 open
 * posten hebben deze gevuld, 668/668 al-betaalde posten wél) — een
 * bruikbaar "is deze vordering afgehandeld"-signaal. `Vordering_
 * afgehandeld_datum` is bewust NIET opgenomen (slechts 79% gevuld bij
 * betaalde posten, minder sluitend bewezen).
 */
export const VorderingMetAfboekingBronSchema = z.object({
  Bedrijfsnr: zCode,
  Contractnr: zCode,
  Vordering_Volgnr: zCode,
  Huurdernr: zCode,
  Complexnummer: zCodeOptional,
  Unitnummer: zCodeOptional,
  Datum_Vordering: zDate,
  Omschrijving_Vordering: zCodeOptional,
  Factuurnummer: zCodeOptional,
  Vordering_Totaalbedrag: zDecimal,
  Bedrag_afgeboekt: zDecimal,
  Vordering_openstaand: zDecimal,
  Vordering_afgehandeld_periode: zCodeOptional,
  Vordering_afgehandeld_jaar: zCodeOptional,
});

export type VorderingMetAfboekingBron = z.infer<typeof VorderingMetAfboekingBronSchema>;

export interface GestaagdeVorderingMetAfboeking {
  bedrijfsnr: string;
  contractnr: string;
  vorderingVolgnr: string;
  huurdernr: string;
  complexnummer: string | null;
  unitnummer: string | null;
  datumVordering: Date;
  omschrijvingVordering: string | null;
  factuurnummer: string | null;
  totaalbedrag: Decimal;
  bedragAfgeboekt: Decimal;
  openstaand: Decimal;
  afgehandeldPeriode: string | null;
  afgehandeldJaar: string | null;
  raw: VorderingMetAfboekingBron;
}

function naarGestaagdeVorderingMetAfboeking(bron: VorderingMetAfboekingBron): GestaagdeVorderingMetAfboeking {
  return {
    bedrijfsnr: bron.Bedrijfsnr,
    contractnr: bron.Contractnr,
    vorderingVolgnr: bron.Vordering_Volgnr,
    huurdernr: bron.Huurdernr,
    complexnummer: bron.Complexnummer,
    unitnummer: bron.Unitnummer,
    datumVordering: bron.Datum_Vordering,
    omschrijvingVordering: bron.Omschrijving_Vordering,
    factuurnummer: bron.Factuurnummer,
    totaalbedrag: bron.Vordering_Totaalbedrag,
    bedragAfgeboekt: bron.Bedrag_afgeboekt,
    openstaand: bron.Vordering_openstaand,
    afgehandeldPeriode: bron.Vordering_afgehandeld_periode,
    afgehandeldJaar: bron.Vordering_afgehandeld_jaar,
    raw: bron,
  };
}

/** Bedrijfsnr + Contractnr + Vordering_Volgnr — nooit Vordering_Volgnr alleen (zie moduledoc). */
export function vorderingMetAfboekingNatuurlijkeSleutel(rij: GestaagdeVorderingMetAfboeking): string {
  return [rij.bedrijfsnr, rij.contractnr, rij.vorderingVolgnr].join("::");
}

/** Bewezen over alle onderzochte administraties: Totaalbedrag - afgeboekt = openstaand, exact (Decimal). */
export function controleerOpenstaandFormule(rijen: readonly GestaagdeVorderingMetAfboeking[]): RowIssue[] {
  const issues: RowIssue[] = [];
  rijen.forEach((rij, index) => {
    const verwacht = rij.totaalbedrag.minus(rij.bedragAfgeboekt);
    if (!verwacht.equals(rij.openstaand)) {
      issues.push({
        rowIndex: index,
        bericht: `Vordering_openstaand (${rij.openstaand.toString()}) komt niet overeen met Vordering_Totaalbedrag - Bedrag_afgeboekt (${verwacht.toString()}).`,
        ernst: "KRITIEK",
      });
    }
  });
  return issues;
}

export interface VorderingenMetAfboekingenParseResultaat extends ParseResult<GestaagdeVorderingMetAfboeking> {
  duplicaatIssues: RowIssue[];
}

export function parseVorderingenMetAfboekingen(ruweRijen: readonly Record<string, unknown>[]): VorderingenMetAfboekingenParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, VorderingMetAfboekingBronSchema);
  const gestaagd = rijen.map(naarGestaagdeVorderingMetAfboeking);
  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, vorderingMetAfboekingNatuurlijkeSleutel);
  return { rijen: gestaagd, issues: [...issues, ...controleerOpenstaandFormule(gestaagd)], duplicaatIssues };
}
