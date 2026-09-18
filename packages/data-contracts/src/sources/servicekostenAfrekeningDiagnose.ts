import { z } from "zod";
import Decimal from "decimal.js";
import { zCode, zCodeOptional, zDecimal, zDecimalOptional } from "../lib/coerce.js";
import { parseRowsWithSchema, type ParseResult } from "../lib/parseRows.js";

/**
 * TIJDELIJK, ONDERZOEK-ONDERSTEUNEND (2026-08-26) — apart, geïsoleerd
 * schema voor de servicekosten-afrekeningsdiagnose, NIET een uitbreiding
 * van het productieschema `ServicekostenregelBronSchema` (servicekosten.ts).
 * Doel: de gebruiker gaf aan dat de ruwe bron (via `servicekosten-
 * bronkolommen`) een nog niet gemodelleerd veld `Kostensoort_Soort`
 * (Kosten/Voorschotten/Nvt) bevat, plus acht afrekeningsvelden
 * (Jaar_Afrekening, Jaar_SV_Afrekening, Per_SV_Afrekening,
 * Periode_Afrekening, SV_Afrekening_Soort(+Omschrijving), SV_Afrekening_
 * Vlgnr, Vdsrt_Opbrengsten(+Omschr)) en een bron-eigen `Service_Boeking_
 * Saldo`. Dit schema ontsluit die velden UITSLUITEND voor de diagnose in
 * `@bvc/reporting`'s `diagnoseerServicekostenAfrekening` — `rebuildCache`/
 * de productie-cache blijven ongewijzigd (CLAUDE.md-conform: geen
 * structurele schema/cache-wijziging vóórdat de bevindingen bevestigd
 * zijn).
 *
 * `Kostensoort_Soort` en de afrekeningsvelden zijn bewust vrije, optionele
 * strings (geen Zod-enum) — een onverwachte waarde moet zichtbaar worden
 * in de diagnose-uitvoer, nooit een parse-fout die de hele rij laat
 * verdwijnen. De identificerende/verplichte velden (Bedrijfsnr, boekjaar/
 * -periode/dagboek/boekstuk/volgnummer, kostensoort, bedrag debet/credit)
 * blijven even streng als in het productieschema — een rij die DAAR faalt
 * wordt door `parseRowsWithSchema` als KRITIEK issue gerapporteerd, niet
 * stilzwijgend weggelaten (zie `ServicekostenAfrekeningDiagnoseParseResultaat`).
 */
export const ServicekostenAfrekeningDiagnoseBronSchema = z.object({
  Bedrijfsnr: zCode,
  Service_BK_Boekjaar: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int()),
  Service_BK_Boekperiode: zCode,
  Service_BK_Dagboeknummer: zCode,
  Service_BK_Boekstuknummer: zCode,
  Service_BK_Volgnummer: zCode,
  Service_BK_Complexnummer: zCodeOptional,
  Service_BK_Unitnummer: zCodeOptional,
  Service_BK_Contractnummer: zCodeOptional,
  Huurdernummer: zCodeOptional,
  Service_BK_Kostensoort: zCode,
  Kostensoort_omschrijving: zCodeOptional,
  Service_BK_Omschrijving: zCodeOptional,
  Service_BK_Bedrag_debet: zDecimal,
  Service_BK_Bedrag_credit: zDecimal,
  Service_BK_Doorbelasten: zCodeOptional,
  // ── Nieuw voor deze diagnose, nog niet in het productieschema ──────
  Kostensoort_Soort: zCodeOptional,
  Service_BK_Jaar_Afrekening: zCodeOptional,
  Service_BK_Jaar_SV_Afrekening: zCodeOptional,
  Service_BK_Per_SV_Afrekening: zCodeOptional,
  Service_BK_Periode_Afrekening: zCodeOptional,
  Service_BK_SV_Afrekening_Soort: zCodeOptional,
  Service_BK_SV_Afrekening_Soort_Omschrijving: zCodeOptional,
  Service_BK_SV_Afrekening_Vlgnr: zCodeOptional,
  Service_BK_Vdsrt_Opbrengsten: zCodeOptional,
  Service_BK_Vdsrt_Omschr: zCodeOptional,
  Service_Boeking_Saldo: zDecimalOptional,
});

export type ServicekostenAfrekeningDiagnoseBron = z.infer<typeof ServicekostenAfrekeningDiagnoseBronSchema>;

export interface GestaagdeServicekostenAfrekeningDiagnoseRegel {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  dagboeknummer: string;
  boekstuknummer: string;
  volgnummer: string;
  complexnummer: string | null;
  unitnummer: string | null;
  contractnummer: string | null;
  huurdernummer: string | null;
  kostensoort: string;
  kostensoortOmschrijving: string | null;
  omschrijving: string | null;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
  saldo: Decimal;
  doorbelasten: string | null;
  kostensoortSoort: string | null;
  jaarAfrekening: string | null;
  jaarSvAfrekening: string | null;
  perSvAfrekening: string | null;
  periodeAfrekening: string | null;
  svAfrekeningSoort: string | null;
  svAfrekeningSoortOmschrijving: string | null;
  svAfrekeningVlgnr: string | null;
  vdsrtOpbrengsten: string | null;
  vdsrtOmschr: string | null;
  bronBoekingSaldo: Decimal | null;
}

function naarGestaagdeRegel(bron: ServicekostenAfrekeningDiagnoseBron): GestaagdeServicekostenAfrekeningDiagnoseRegel {
  return {
    bedrijfsnr: bron.Bedrijfsnr,
    boekjaar: bron.Service_BK_Boekjaar,
    boekperiode: bron.Service_BK_Boekperiode,
    dagboeknummer: bron.Service_BK_Dagboeknummer,
    boekstuknummer: bron.Service_BK_Boekstuknummer,
    volgnummer: bron.Service_BK_Volgnummer,
    complexnummer: bron.Service_BK_Complexnummer,
    unitnummer: bron.Service_BK_Unitnummer,
    contractnummer: bron.Service_BK_Contractnummer,
    huurdernummer: bron.Huurdernummer,
    kostensoort: bron.Service_BK_Kostensoort,
    kostensoortOmschrijving: bron.Kostensoort_omschrijving,
    omschrijving: bron.Service_BK_Omschrijving,
    bedragDebet: bron.Service_BK_Bedrag_debet,
    bedragCredit: bron.Service_BK_Bedrag_credit,
    saldo: bron.Service_BK_Bedrag_debet.minus(bron.Service_BK_Bedrag_credit),
    doorbelasten: bron.Service_BK_Doorbelasten,
    kostensoortSoort: bron.Kostensoort_Soort,
    jaarAfrekening: bron.Service_BK_Jaar_Afrekening,
    jaarSvAfrekening: bron.Service_BK_Jaar_SV_Afrekening,
    perSvAfrekening: bron.Service_BK_Per_SV_Afrekening,
    periodeAfrekening: bron.Service_BK_Periode_Afrekening,
    svAfrekeningSoort: bron.Service_BK_SV_Afrekening_Soort,
    svAfrekeningSoortOmschrijving: bron.Service_BK_SV_Afrekening_Soort_Omschrijving,
    svAfrekeningVlgnr: bron.Service_BK_SV_Afrekening_Vlgnr,
    vdsrtOpbrengsten: bron.Service_BK_Vdsrt_Opbrengsten,
    vdsrtOmschr: bron.Service_BK_Vdsrt_Omschr,
    bronBoekingSaldo: bron.Service_Boeking_Saldo,
  };
}

export type ServicekostenAfrekeningDiagnoseParseResultaat = ParseResult<GestaagdeServicekostenAfrekeningDiagnoseRegel>;

/** Elke rij die niet aan het schema voldoet komt als KRITIEK issue terug (rowIndex + bericht) — nooit stilzwijgend weggelaten uit `issues`. */
export function parseServicekostenAfrekeningDiagnose(ruweRijen: readonly Record<string, unknown>[]): ServicekostenAfrekeningDiagnoseParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, ServicekostenAfrekeningDiagnoseBronSchema);
  return { rijen: rijen.map(naarGestaagdeRegel), issues };
}
