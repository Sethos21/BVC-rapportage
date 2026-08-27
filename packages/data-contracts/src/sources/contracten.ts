import { z } from "zod";
import { zCode, zCodeOptional, zDateOptional, zIntOptional } from "../lib/coerce.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "IDBC Contracten Huidig" — contractvoorwaarden, verlenging,
 * expiratie en opzegging. Kolomnamen geverifieerd tegen het echte
 * bronbestand (170 kolommen totaal). Natuurlijke sleutel: Bedrijfsnr + Contract.
 */
export const ContractBronSchema = z.object({
  Bedrijfsnr: zCode,
  Contract: zCode,
  Complexnummer: zCodeOptional,
  Unitnummer: zCodeOptional,
  Huurdernummer: zCodeOptional,
  Ingangsdatum: zDateOptional,
  Afloopdatum: zDateOptional,
  Check_Lopend_Contract: zCodeOptional,
  Expiratie_Expiratiedatum: zDateOptional,
  Expiratie_Opzegdatum: zDateOptional,
  Expiratie_Aantal_per_optie: zIntOptional,
  Expiratie_huidige: zCodeOptional,
  /**
   * Bevestigd via bronkolommen-diagnose (2026-08-27, 070_Rooise_Zoom, 197
   * rijen): de huurdernaam, NIET "Naam_1" of "Bedrijfsnaam" (dat laatste
   * bleek de eigenaarsnaam, matcht Eigenaar_Naam_1). Bewust het ENIGE
   * naam-/contactveld dat uit de 170-kolommen-bron wordt overgenomen —
   * overige contactgegevens (IBAN/e-mail/telefoon/adres) blijven buiten
   * schema/rapportage (zelfde terughoudendheid als ouderdomsanalyse.ts).
   */
  Huurder_Naam_1: zCodeOptional,
});

export type ContractBron = z.infer<typeof ContractBronSchema>;

export interface GestaagdContract {
  bedrijfsnr: string;
  contract: string;
  complexnummer: string | null;
  unitnummer: string | null;
  huurdernummer: string | null;
  ingangsdatum: Date | null;
  afloopdatum: Date | null;
  checkLopendContract: string | null;
  expiratieExpiratiedatum: Date | null;
  expiratieOpzegdatum: Date | null;
  expiratieAantalPerOptie: number | null;
  expiratieHuidige: string | null;
  huurderNaam: string | null;
  raw: ContractBron;
}

function naarGestaagdContract(bron: ContractBron): GestaagdContract {
  return {
    bedrijfsnr: bron.Bedrijfsnr,
    contract: bron.Contract,
    complexnummer: bron.Complexnummer,
    unitnummer: bron.Unitnummer,
    huurdernummer: bron.Huurdernummer,
    ingangsdatum: bron.Ingangsdatum,
    afloopdatum: bron.Afloopdatum,
    checkLopendContract: bron.Check_Lopend_Contract,
    expiratieExpiratiedatum: bron.Expiratie_Expiratiedatum,
    expiratieOpzegdatum: bron.Expiratie_Opzegdatum,
    expiratieAantalPerOptie: bron.Expiratie_Aantal_per_optie,
    expiratieHuidige: bron.Expiratie_huidige,
    huurderNaam: bron.Huurder_Naam_1,
    raw: bron,
  };
}

export function contractNatuurlijkeSleutel(rij: GestaagdContract): string {
  return [rij.bedrijfsnr, rij.contract].join("::");
}

export interface ContractenParseResultaat extends ParseResult<GestaagdContract> {
  duplicaatIssues: RowIssue[];
}

export function parseContracten(ruweRijen: readonly Record<string, unknown>[]): ContractenParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, ContractBronSchema);
  const gestaagd = rijen.map(naarGestaagdContract);
  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, contractNatuurlijkeSleutel);
  return { rijen: gestaagd, issues, duplicaatIssues };
}
