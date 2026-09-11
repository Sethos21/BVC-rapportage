import { z } from "zod";
import Decimal from "decimal.js";
import { zCode, zCodeOptional, zDecimalOptional } from "../lib/coerce.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "IDBC Units" — volledige unitstam. Kolomnamen geverifieerd tegen
 * het echte bronbestand (149 kolommen totaal, overwegend leeg voor
 * commercieel vastgoed — de sociale-huur/UC51-velden komen 1-op-1 mee in `raw`).
 * Natuurlijke sleutel: Bedrijfsnr + Complexnummer + Unitnummer.
 */
export const UnitBronSchema = z.object({
  Bedrijfsnr: zCode,
  Complexnummer: zCode,
  Unitnummer: zCode,
  Unit_Non_actief: zCodeOptional,
  Unitomschrijving: zCodeOptional,
  Unitsoort: zCodeOptional,
  Unit_VVO: zDecimalOptional,
  Unit_BVO: zDecimalOptional,
  Unit_Adres: zCodeOptional,
  Unit_Postcode: zCodeOptional,
  Unit_Plaats: zCodeOptional,
});

export type UnitBron = z.infer<typeof UnitBronSchema>;

export interface GestaagdeUnit {
  bedrijfsnr: string;
  complexnummer: string;
  unitnummer: string;
  unitNonActief: string | null;
  unitomschrijving: string | null;
  unitsoort: string | null;
  unitVvo: Decimal | null;
  unitBvo: Decimal | null;
  unitAdres: string | null;
  unitPostcode: string | null;
  unitPlaats: string | null;
  raw: UnitBron;
}

function naarGestaagdeUnit(bron: UnitBron): GestaagdeUnit {
  return {
    bedrijfsnr: bron.Bedrijfsnr,
    complexnummer: bron.Complexnummer,
    unitnummer: bron.Unitnummer,
    unitNonActief: bron.Unit_Non_actief,
    unitomschrijving: bron.Unitomschrijving,
    unitsoort: bron.Unitsoort,
    unitVvo: bron.Unit_VVO,
    unitBvo: bron.Unit_BVO,
    unitAdres: bron.Unit_Adres,
    unitPostcode: bron.Unit_Postcode,
    unitPlaats: bron.Unit_Plaats,
    raw: bron,
  };
}

export function unitNatuurlijkeSleutel(rij: GestaagdeUnit): string {
  return [rij.bedrijfsnr, rij.complexnummer, rij.unitnummer].join("::");
}

export interface UnitsParseResultaat extends ParseResult<GestaagdeUnit> {
  duplicaatIssues: RowIssue[];
}

export function parseUnits(ruweRijen: readonly Record<string, unknown>[]): UnitsParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, UnitBronSchema);
  const gestaagd = rijen.map(naarGestaagdeUnit);
  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, unitNatuurlijkeSleutel);
  return { rijen: gestaagd, issues, duplicaatIssues };
}
