import { z } from "zod";
import Decimal from "decimal.js";
import { zCode, zCodeOptional, zDecimalOptional } from "../lib/coerce.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "Contract Verhogingen" — historische huurindexaties per contract.
 * Bewezen via `contract-huurder-diagnose`/`contract-verhogingen-diagnose`
 * (2026-08-27/28, packages/reporting/README.md): `Contract` is uitsluitend
 * uniek BINNEN een administratie in dit gedeelde bestand (net als
 * `contracten_huidig`) — de natuurlijke sleutel is daarom altijd
 * Bedrijfsnr + Contract + Jaar + Periode, NOOIT Contract alleen.
 *
 * Bewust minimaal gemodelleerd (CLAUDE.md §3, "houd het productmodel
 * minimaal"): van de ~140 ruwe kolommen (VS_01..VS_20 × oud/berekend/
 * nieuw/suppletie, Waarde, Indexering_oud/nieuw, Aanmaakwijze, Incidenteel,
 * IAH_verhoging_toegepast, Prijsindex_opslag_*, CBS_afronding_toegepast,
 * Tabeljaar, Prijsindextabel, ...) is uitsluitend opgenomen wat bewezen
 * nodig is voor "laatste indexatie" in Huurdersoverzicht:
 * - `Bedrag_oud_VS_01`/`Bedrag_Nieuw_VS_01` — VS_01 is de bewezen
 *   reguliere-huurcomponent (maandbedragen; alle overige VS-codes wijzigen
 *   nooit bij een indexatie, bevestigd over alle 33 070-regels).
 * - `Status`/`Toekomstige_verhoging` — bewezen bronsemantiek voor 070:
 *   "Verwerkt"/"Nee" markeert een daadwerkelijk verwerkte, niet-toekomstige
 *   indexatie (zie `bepaalLaatsteIndexatie` in `@bvc/reporting`'s
 *   huurdersoverzicht.ts voor de defensieve toepassing).
 * `Waarde` is BEWUST NIET opgenomen: bij contracten 043/049 bleek dit veld
 * 0 terwijl VS_01 aantoonbaar wijzigde — het effectieve percentage wordt
 * daarom altijd zelf berekend uit Bedrag_oud_VS_01/Bedrag_Nieuw_VS_01,
 * nooit uit `Waarde` gelezen.
 */
export const ContractVerhogingBronSchema = z.object({
  Bedrijfsnr: zCode,
  Contract: zCode,
  Jaar: zCode,
  Periode: zCode,
  Status: zCodeOptional,
  Toekomstige_verhoging: zCodeOptional,
  Bedrag_oud_VS_01: zDecimalOptional,
  Bedrag_Nieuw_VS_01: zDecimalOptional,
});

export type ContractVerhogingBron = z.infer<typeof ContractVerhogingBronSchema>;

export interface GestaagdeContractVerhoging {
  bedrijfsnr: string;
  contract: string;
  jaar: string;
  periode: string;
  status: string | null;
  toekomstigeVerhoging: string | null;
  bedragOudVs01: Decimal | null;
  bedragNieuwVs01: Decimal | null;
  raw: ContractVerhogingBron;
}

function naarGestaagdeContractVerhoging(bron: ContractVerhogingBron): GestaagdeContractVerhoging {
  return {
    bedrijfsnr: bron.Bedrijfsnr,
    contract: bron.Contract,
    jaar: bron.Jaar,
    periode: bron.Periode,
    status: bron.Status,
    toekomstigeVerhoging: bron.Toekomstige_verhoging,
    bedragOudVs01: bron.Bedrag_oud_VS_01,
    bedragNieuwVs01: bron.Bedrag_Nieuw_VS_01,
    raw: bron,
  };
}

/** Bedrijfsnr + Contract + Jaar + Periode — nooit Contract alleen (zie moduledoc). */
export function contractVerhogingNatuurlijkeSleutel(rij: GestaagdeContractVerhoging): string {
  return [rij.bedrijfsnr, rij.contract, rij.jaar, rij.periode].join("::");
}

export interface ContractVerhogingenParseResultaat extends ParseResult<GestaagdeContractVerhoging> {
  duplicaatIssues: RowIssue[];
}

export function parseContractVerhogingen(ruweRijen: readonly Record<string, unknown>[]): ContractVerhogingenParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, ContractVerhogingBronSchema);
  const gestaagd = rijen.map(naarGestaagdeContractVerhoging);
  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, contractVerhogingNatuurlijkeSleutel);
  return { rijen: gestaagd, issues, duplicaatIssues };
}
