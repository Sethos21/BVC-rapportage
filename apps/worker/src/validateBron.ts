import {
  parseBalans,
  parseBoekingen,
  parseComplexTotalen,
  parseContracten,
  parseOuderdomsanalyse,
  parseRentroll,
  parseServicekosten,
  parseUnits,
  readFirstSheetAsRows,
  type RowIssue,
} from "@bvc/data-contracts";
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
 *
 * `begroting` heeft nog geen volledig Zod-broncontract (BVC_Begrotingsformat_v0.2
 * met secties/mappingcodes) — dat is een bekende, expliciete beperking, geen
 * verzonnen validatie. Alleen leesbaarheid wordt gecontroleerd.
 */
export function valideerBron(bronType: BronType, buffer: Buffer, context: ValidatieContext = {}): ValidatieResultaat {
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
      const { rijen, issues, duplicaatIssues } = parseServicekosten(ruweRijen);
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
    case "begroting": {
      return {
        rowCount: ruweRijen.length,
        issues:
          ruweRijen.length === 0
            ? [{ rowIndex: -1, bericht: "Begrotingsbestand bevat geen rijen.", ernst: "KRITIEK" }]
            : [{ rowIndex: -1, bericht: "Geen volledig BVC_Begrotingsformat_v0.2-broncontract geïmplementeerd — alleen leesbaarheid gecontroleerd.", ernst: "WAARSCHUWING" }],
        duplicaatIssues: [],
      };
    }
  }
}
