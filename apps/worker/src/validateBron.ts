import {
  parseBalans,
  parseBegrotingExploitatie,
  parseBegrotingMetadata,
  parseBegrotingServicekosten,
  parseBoekingen,
  parseComplexTotalen,
  parseContracten,
  parseContractVerhogingen,
  parseOuderdomsanalyse,
  parseRentroll,
  parseServicekosten,
  parseUnits,
  parseVorderingenMetAfboekingen,
  readFirstSheetAsRows,
  type RowIssue,
} from "@bvc/data-contracts";
import { STANDAARD_PARAMETERS, type Beheerparameters } from "@bvc/config";
import type { BronType } from "./paths.js";

export interface ValidatieContext {
  boekjaar?: number | undefined;
  boekperiode?: string | undefined;
  peildatum?: Date | undefined;
  /**
   * Verplicht voor bronmodus 'eigen': alle rijen moeten bij deze
   * administratie horen. Een afwijkend Bedrijfsnr is een blokkerende fout
   * (CLAUDE_AANVULLENDE_INSTRUCTIES_LOKALE_BRONNEN_v0.1.md §5).
   */
  verwachtBedrijfsnr?: string | undefined;
  /** Config-gestuurde uitzonderingen/normen (CLAUDE.md §3); standaard STANDAARD_PARAMETERS als niet meegegeven. */
  beheerparameters?: Beheerparameters | undefined;
}

export interface ValidatieResultaat {
  rowCount: number;
  issues: RowIssue[];
  duplicaatIssues: RowIssue[];
}

/** Controleert dat iedere rij bij het verwachte Bedrijfsnr hoort (alleen relevant voor bronmodus 'eigen'). */
function controleerBedrijfsnr<T>(rijen: readonly T[], veldSelector: (rij: T) => string, verwacht: string | undefined): RowIssue[] {
  if (verwacht === undefined) return [];
  const issues: RowIssue[] = [];
  rijen.forEach((rij, index) => {
    const gevonden = veldSelector(rij);
    if (gevonden !== verwacht) {
      issues.push({
        rowIndex: index,
        bericht: `Rij hoort bij Bedrijfsnr "${gevonden}", maar deze bronmap is ingesteld voor administratie "${verwacht}" — blokkerende fout.`,
        ernst: "KRITIEK",
      });
    }
  });
  return issues;
}

/**
 * Valideert een (kandidaat-)bronbestand tegen het broncontract van dat
 * brontype. Geeft alleen issues terug — het vervangingsprotocol (replace.ts)
 * beslist op basis daarvan of de bestaande bron mag worden vervangen.
 */
export function valideerBron(bronType: BronType, buffer: Buffer, context: ValidatieContext = {}): ValidatieResultaat {
  // Begroting is een meerdere-tabbladen-werkmap, dus geen readFirstSheetAsRows.
  if (bronType === "begroting") {
    return valideerBegroting(buffer, context);
  }

  const ruweRijen = readFirstSheetAsRows(buffer);

  switch (bronType) {
    case "boekingen": {
      const { rijen, issues, duplicaatIssues } = parseBoekingen(ruweRijen);
      return { rowCount: rijen.length, issues: [...issues, ...controleerBedrijfsnr(rijen, (r) => r.bedrijfsnr, context.verwachtBedrijfsnr)], duplicaatIssues };
    }
    case "balans_per_jaar": {
      const { rijen, issues, duplicaatIssues } = parseBalans(ruweRijen);
      return { rowCount: rijen.length, issues: [...issues, ...controleerBedrijfsnr(rijen, (r) => r.bedrijfsnr, context.verwachtBedrijfsnr)], duplicaatIssues };
    }
    case "rentroll": {
      const { rijen, issues, duplicaatIssues } = parseRentroll(ruweRijen);
      return { rowCount: rijen.length, issues: [...issues, ...controleerBedrijfsnr(rijen, (r) => r.bedrijfsnummer, context.verwachtBedrijfsnr)], duplicaatIssues };
    }
    case "contracten_huidig": {
      const { rijen, issues, duplicaatIssues } = parseContracten(ruweRijen);
      return { rowCount: rijen.length, issues: [...issues, ...controleerBedrijfsnr(rijen, (r) => r.bedrijfsnr, context.verwachtBedrijfsnr)], duplicaatIssues };
    }
    case "units": {
      const { rijen, issues, duplicaatIssues } = parseUnits(ruweRijen);
      return { rowCount: rijen.length, issues: [...issues, ...controleerBedrijfsnr(rijen, (r) => r.bedrijfsnr, context.verwachtBedrijfsnr)], duplicaatIssues };
    }
    case "complex_totalen": {
      const { rijen, issues, duplicaatIssues } = parseComplexTotalen(ruweRijen);
      return { rowCount: rijen.length, issues: [...issues, ...controleerBedrijfsnr(rijen, (r) => r.bedrijfsnr, context.verwachtBedrijfsnr)], duplicaatIssues };
    }
    case "servicekosten": {
      const beheerparameters = context.beheerparameters ?? STANDAARD_PARAMETERS;
      const { rijen, issues, duplicaatIssues } = parseServicekosten(ruweRijen, beheerparameters.servicekosten);
      return { rowCount: rijen.length, issues: [...issues, ...controleerBedrijfsnr(rijen, (r) => r.bedrijfsnr, context.verwachtBedrijfsnr)], duplicaatIssues };
    }
    case "ouderdomsanalyse": {
      if (context.boekjaar === undefined || context.boekperiode === undefined || context.peildatum === undefined) {
        return {
          rowCount: ruweRijen.length,
          issues: [{ rowIndex: -1, bericht: "Ouderdomsanalyse-import vereist boekjaar, boekperiode en peildatum als importmetadata.", ernst: "KRITIEK" }],
          duplicaatIssues: [],
        };
      }
      const { rijen, issues, duplicaatIssues } = parseOuderdomsanalyse(ruweRijen, {
        boekjaar: context.boekjaar,
        boekperiode: context.boekperiode,
        peildatum: context.peildatum,
      });
      return { rowCount: rijen.length, issues: [...issues, ...controleerBedrijfsnr(rijen, (r) => r.bedrijfsnr, context.verwachtBedrijfsnr)], duplicaatIssues };
    }
    case "contract_verhogingen": {
      const { rijen, issues, duplicaatIssues } = parseContractVerhogingen(ruweRijen);
      return { rowCount: rijen.length, issues: [...issues, ...controleerBedrijfsnr(rijen, (r) => r.bedrijfsnr, context.verwachtBedrijfsnr)], duplicaatIssues };
    }
    case "vorderingen_met_afboekingen": {
      const { rijen, issues, duplicaatIssues } = parseVorderingenMetAfboekingen(ruweRijen);
      return { rowCount: rijen.length, issues: [...issues, ...controleerBedrijfsnr(rijen, (r) => r.bedrijfsnr, context.verwachtBedrijfsnr)], duplicaatIssues };
    }
  }
}

/**
 * BVC_Begrotingsformat_v0.2.xlsx: metadata (Instellingen) + Exploitatie +
 * Servicekosten samen valideren. Zonder geldige administratiecode/boekjaar
 * wordt de hele import geblokkeerd. Bij bronmodus 'eigen' moet de
 * administratiecode overeenkomen met de bronmap-administratie.
 */
function valideerBegroting(buffer: Buffer, context: ValidatieContext): ValidatieResultaat {
  const { metadata, issues: metadataIssues } = parseBegrotingMetadata(buffer);
  if (!metadata) {
    return { rowCount: 0, issues: metadataIssues, duplicaatIssues: [] };
  }

  const administratieIssues: RowIssue[] =
    context.verwachtBedrijfsnr !== undefined && metadata.administratiecode !== context.verwachtBedrijfsnr
      ? [{
          rowIndex: -1,
          bericht: `Begroting hoort bij administratiecode "${metadata.administratiecode}", maar deze bronmap is ingesteld voor administratie "${context.verwachtBedrijfsnr}" — blokkerende fout.`,
          ernst: "KRITIEK",
        }]
      : [];

  const exploitatie = parseBegrotingExploitatie(buffer);
  const servicekosten = parseBegrotingServicekosten(buffer);

  return {
    rowCount: exploitatie.rijen.length + servicekosten.rijen.length,
    issues: [...metadataIssues, ...administratieIssues, ...exploitatie.issues, ...servicekosten.issues],
    duplicaatIssues: [...exploitatie.duplicaatIssues, ...servicekosten.duplicaatIssues],
  };
}
