import { z } from "zod";
import Decimal from "decimal.js";
import { zCode, zCodeOptional, zDateOptional, zDecimalOptional } from "../lib/coerce.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "RentRoll" — contractuele jaarhuur en verhuurde oppervlakte.
 * Let op: dit bestand gebruikt "Bedrijfsnummer" (lange vorm), anders dan
 * alle overige bronnen die "Bedrijfsnr" gebruiken — geverifieerd tegen het
 * echte bronbestand, geen tikfout. Meerdere rijen per contract zijn normaal
 * (één per Vorderingsoort, bv. 01 = Huur, 12 = Compensatie OB, 13 = Huurkorting).
 * Jaarhuur (CAL-CTR-001) gebruikt uitsluitend Vorderingsoort = "01".
 * Natuurlijke sleutel: Bedrijfsnummer + Contractnummer + Vorderingsoort + Unitnummer.
 */
export const RentrollregelBronSchema = z.object({
  Bedrijfsnummer: zCode,
  Contractnummer: zCode,
  Vorderingsoort: zCode,
  Unitnummer: zCodeOptional,
  Complexnummer: zCodeOptional,
  Rapportage_datum: zDateOptional,
  Prolongatie_bedrag_jaar: zDecimalOptional,
  Korting_bedrag_jaar: zDecimalOptional,
  Service_voorschot_jaar: zDecimalOptional,
  Gehuurd_oppervlak: zDecimalOptional,
  Contract_expiratiedatum: zDateOptional,
  Contract_opzegdatum: zDateOptional,
});

export type RentrollregelBron = z.infer<typeof RentrollregelBronSchema>;

export interface GestaagdeRentrollregel {
  bedrijfsnummer: string;
  contractnummer: string;
  vorderingsoort: string;
  unitnummer: string | null;
  complexnummer: string | null;
  rapportageDatum: Date | null;
  prolongatieBedragJaar: Decimal | null;
  kortingBedragJaar: Decimal | null;
  serviceVoorschotJaar: Decimal | null;
  gehuurdOppervlak: Decimal | null;
  contractExpiratiedatum: Date | null;
  contractOpzegdatum: Date | null;
  raw: RentrollregelBron;
}

function naarGestaagdeRentrollregel(bron: RentrollregelBron): GestaagdeRentrollregel {
  return {
    bedrijfsnummer: bron.Bedrijfsnummer,
    contractnummer: bron.Contractnummer,
    vorderingsoort: bron.Vorderingsoort,
    unitnummer: bron.Unitnummer,
    complexnummer: bron.Complexnummer,
    rapportageDatum: bron.Rapportage_datum,
    prolongatieBedragJaar: bron.Prolongatie_bedrag_jaar,
    kortingBedragJaar: bron.Korting_bedrag_jaar,
    serviceVoorschotJaar: bron.Service_voorschot_jaar,
    gehuurdOppervlak: bron.Gehuurd_oppervlak,
    contractExpiratiedatum: bron.Contract_expiratiedatum,
    contractOpzegdatum: bron.Contract_opzegdatum,
    raw: bron,
  };
}

export function rentrollregelNatuurlijkeSleutel(rij: GestaagdeRentrollregel): string {
  return [rij.bedrijfsnummer, rij.contractnummer, rij.vorderingsoort, rij.unitnummer ?? ""].join("::");
}

export interface RentrollParseResultaat extends ParseResult<GestaagdeRentrollregel> {
  duplicaatIssues: RowIssue[];
}

export function parseRentroll(ruweRijen: readonly Record<string, unknown>[]): RentrollParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, RentrollregelBronSchema);
  const gestaagd = rijen.map(naarGestaagdeRentrollregel);
  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, rentrollregelNatuurlijkeSleutel);
  return { rijen: gestaagd, issues, duplicaatIssues };
}
