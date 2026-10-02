import { z } from "zod";
import Decimal from "decimal.js";
import { zCode, zCodeOptional, zDateOptional, zDecimalOptional } from "../lib/coerce.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "Contract Prijsregels" (`contract_prijsregels.xlsx`) — de per-contract
 * prijsregelhistorie/-toekomst, inclusief nog niet ingegane wijzigingen.
 * Kolomnamen geverifieerd tegen het echte bronbestand (070_Rooise_Zoom,
 * 2026-09, 680 rijen totaal, 57 voor bedrijfsnr 070 over 15 contracten):
 * `Bedrijfsnr`, `Bedrijfsnaam`, `Contractnr` (LET OP: hier "Contractnr", niet
 * "Contract" zoals in `contracten_huidig.xlsx` — zelfde identiteitsruimte,
 * andere kolomnaam), `Prijs_regelnr`, `Status`, `Aanmaakwijze`, `Ingangsjaar`,
 * `Ingangsperiode`, `Ingangsdatum_prijsregel`, `Bedrag_vorderingsoort_08`..`_20`.
 *
 * Bewust minimaal gemodelleerd (CLAUDE.md §3): uitsluitend `Bedrag_
 * vorderingsoort_13` (de bewezen VS=13-huurkortingcomponent, zelfde
 * vorderingsoort als `rentroll.xlsx`, zie `@bvc/reporting`'s
 * `begroteHuuropbrengsten.ts`) is opgenomen — de overige VS-kolommen (08-12,
 * 14-20) zijn niet bewezen nodig voor de toekomstige-kortingswijziging-
 * functionaliteit en blijven daarom buiten schema.
 *
 * `Status` is BEWUST WEL opgenomen (traceerbaarheid/diagnose) maar NOOIT
 * gebruikt als resolutiecriterium: bevestigd bronfeit (070, alle 57 rijen)
 * dat `Status` uniform "Nieuw" is voor zowel al-verstreken als toekomstige
 * prijsregels — dit veld discrimineert dus niets en mag daarom nooit de
 * candidate-resolutie sturen (zie `contractPrijsregelsResolver.ts`).
 */
export const ContractPrijsregelBronSchema = z.object({
  Bedrijfsnr: zCode,
  Contractnr: zCode,
  Prijs_regelnr: zCodeOptional,
  Status: zCodeOptional,
  Ingangsdatum_prijsregel: zDateOptional,
  Bedrag_vorderingsoort_13: zDecimalOptional,
});

export type ContractPrijsregelBron = z.infer<typeof ContractPrijsregelBronSchema>;

export interface GestaagdContractPrijsregel {
  bedrijfsnr: string;
  contractnr: string;
  prijsRegelnr: string | null;
  status: string | null;
  ingangsdatumPrijsregel: Date | null;
  bedragVorderingsoort13: Decimal | null;
  raw: ContractPrijsregelBron;
}

function naarGestaagdContractPrijsregel(bron: ContractPrijsregelBron): GestaagdContractPrijsregel {
  return {
    bedrijfsnr: bron.Bedrijfsnr,
    contractnr: bron.Contractnr,
    prijsRegelnr: bron.Prijs_regelnr,
    status: bron.Status,
    ingangsdatumPrijsregel: bron.Ingangsdatum_prijsregel,
    bedragVorderingsoort13: bron.Bedrag_vorderingsoort_13,
    raw: bron,
  };
}

/** Bedrijfsnr + Contractnr + Prijs_regelnr — één rij is één prijsregelversie van een contract. */
export function contractPrijsregelNatuurlijkeSleutel(rij: GestaagdContractPrijsregel): string {
  return [rij.bedrijfsnr, rij.contractnr, rij.prijsRegelnr ?? ""].join("::");
}

export interface ContractPrijsregelenParseResultaat extends ParseResult<GestaagdContractPrijsregel> {
  duplicaatIssues: RowIssue[];
}

export function parseContractPrijsregels(ruweRijen: readonly Record<string, unknown>[]): ContractPrijsregelenParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, ContractPrijsregelBronSchema);
  const gestaagd = rijen.map(naarGestaagdContractPrijsregel);
  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, contractPrijsregelNatuurlijkeSleutel);
  return { rijen: gestaagd, issues, duplicaatIssues };
}
