import { z } from "zod";
import Decimal from "decimal.js";
import type { ServicekostenParameters } from "@bvc/config";
import { zCode, zCodeOptional, zDecimal } from "../lib/coerce.js";
import { parseRowsWithSchema, vindDubbeleNatuurlijkeSleutels, type ParseResult, type RowIssue } from "../lib/parseRows.js";

/**
 * Bron: "IDBC Servicekosten Boekingen vanaf 2024" — zowel de XLSX-
 * archiefversie als de native Google Sheets "werkversie" hebben identieke
 * kolommen (geverifieerd tegen beide echte bronbestanden, 111 kolommen
 * totaal). AP-15/OB-031: gebruik per laadbatch precies één van de twee.
 * Natuurlijke sleutel: Bedrijfsnr + Service_BK_Boekjaar + Service_BK_Boekperiode
 * + Service_BK_Dagboeknummer + Service_BK_Boekstuknummer + Service_BK_Volgnummer.
 */
export const ServicekostenregelBronSchema = z.object({
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
  /**
   * Bewezen via de servicekosten-diagnoseronde (2026-08-26/27, 070_Rooise_Zoom):
   * "Kosten"/"Voorschotten"/"Nvt" — bron-native onderscheid tussen werkelijke
   * servicekosten en vooraf ontvangen voorschotten. Bewust vrije string, geen
   * Zod-enum: een onverwachte waarde bij een andere administratie moet
   * zichtbaar blijven (`ServicekostenStroom`/`bepaalServicekostenStroom` in
   * `@bvc/reporting`'s servicekostenPositie.ts classificeert dit, met een
   * kruiscontrole tegen `uitgeslotenKostensoorten` hieronder), nooit een
   * parse-fout die de rij laat verdwijnen.
   */
  Kostensoort_Soort: zCodeOptional,
  /** Het jaar waarop een serviceafrekening (kostensoort 9600) betrekking heeft — uitsluitend een getoond attribuut, nooit een selectiecriterium (zie servicekostenPositie.ts). */
  Service_BK_Jaar_SV_Afrekening: zCodeOptional,
  /**
   * Huurdernaam — bevestigd door de gebruiker (2026-08-27) als "Naam_1" in
   * deze bron (anders dan "Huurder_Naam_1" in contracten_huidig — twee
   * verschillende bronnen, elk hun eigen kolomnaam). Bewust het enige
   * naam-/contactveld dat uit deze 111-kolommen-bron wordt overgenomen.
   */
  Naam_1: zCodeOptional,
});

export type ServicekostenregelBron = z.infer<typeof ServicekostenregelBronSchema>;

/**
 * 06_DATA_EN_ODBC_v0.3.md — kostensoort 9600 wordt standaard altijd
 * uitgesloten, andere varianten alleen gesignaleerd. Welke kostensoorten en
 * omschrijvingsvarianten dit precies zijn, staat niet hardcoded hier maar
 * in `servicekostenParams` (CLAUDE.md §3: config-gestuurd, geen hardcoded
 * uitzonderingen — zie `@bvc/config`).
 */
export type ServicekostenUitsluitingsstatus =
  | "GEEN"
  | "UITGESLOTEN_AFREKENING_VORIG_JAAR"
  | "CONTROLE_VEREIST_MOGELIJKE_SERVICEAFREKENING";

export function bepaalUitsluitingsstatus(kostensoort: string, omschrijving: string | null, servicekostenParams: ServicekostenParameters): ServicekostenUitsluitingsstatus {
  if (servicekostenParams.uitgeslotenKostensoorten.includes(kostensoort.trim())) {
    return "UITGESLOTEN_AFREKENING_VORIG_JAAR";
  }
  const omschrijvingLower = (omschrijving ?? "").toLowerCase();
  if (servicekostenParams.serviceafrekeningVarianten.some((variant) => omschrijvingLower.includes(variant))) {
    return "CONTROLE_VEREIST_MOGELIJKE_SERVICEAFREKENING";
  }
  return "GEEN";
}

export interface GestaagdeServicekostenregel {
  bedrijfsnr: string;
  serviceBkBoekjaar: number;
  serviceBkBoekperiode: string;
  serviceBkDagboeknummer: string;
  serviceBkBoekstuknummer: string;
  serviceBkVolgnummer: string;
  serviceBkComplexnummer: string | null;
  serviceBkUnitnummer: string | null;
  serviceBkContractnummer: string | null;
  huurdernummer: string | null;
  serviceBkKostensoort: string;
  kostensoortOmschrijving: string | null;
  serviceBkOmschrijving: string | null;
  serviceBkBedragDebet: Decimal;
  serviceBkBedragCredit: Decimal;
  serviceBoekingSaldo: Decimal;
  serviceBkDoorbelasten: string | null;
  uitsluitingsstatus: ServicekostenUitsluitingsstatus;
  kostensoortSoort: string | null;
  jaarSvAfrekening: string | null;
  huurderNaam: string | null;
  raw: ServicekostenregelBron;
}

function naarGestaagdeServicekostenregel(bron: ServicekostenregelBron, servicekostenParams: ServicekostenParameters): GestaagdeServicekostenregel {
  return {
    bedrijfsnr: bron.Bedrijfsnr,
    serviceBkBoekjaar: bron.Service_BK_Boekjaar,
    serviceBkBoekperiode: bron.Service_BK_Boekperiode,
    serviceBkDagboeknummer: bron.Service_BK_Dagboeknummer,
    serviceBkBoekstuknummer: bron.Service_BK_Boekstuknummer,
    serviceBkVolgnummer: bron.Service_BK_Volgnummer,
    serviceBkComplexnummer: bron.Service_BK_Complexnummer,
    serviceBkUnitnummer: bron.Service_BK_Unitnummer,
    serviceBkContractnummer: bron.Service_BK_Contractnummer,
    huurdernummer: bron.Huurdernummer,
    serviceBkKostensoort: bron.Service_BK_Kostensoort,
    kostensoortOmschrijving: bron.Kostensoort_omschrijving,
    serviceBkOmschrijving: bron.Service_BK_Omschrijving,
    serviceBkBedragDebet: bron.Service_BK_Bedrag_debet,
    serviceBkBedragCredit: bron.Service_BK_Bedrag_credit,
    serviceBoekingSaldo: bron.Service_BK_Bedrag_debet.minus(bron.Service_BK_Bedrag_credit),
    serviceBkDoorbelasten: bron.Service_BK_Doorbelasten,
    uitsluitingsstatus: bepaalUitsluitingsstatus(bron.Service_BK_Kostensoort, bron.Service_BK_Omschrijving, servicekostenParams),
    kostensoortSoort: bron.Kostensoort_Soort,
    jaarSvAfrekening: bron.Service_BK_Jaar_SV_Afrekening,
    huurderNaam: bron.Naam_1,
    raw: bron,
  };
}

export function servicekostenregelNatuurlijkeSleutel(rij: GestaagdeServicekostenregel): string {
  return [rij.bedrijfsnr, rij.serviceBkBoekjaar, rij.serviceBkBoekperiode, rij.serviceBkDagboeknummer, rij.serviceBkBoekstuknummer, rij.serviceBkVolgnummer].join("::");
}

export interface ServicekostenParseResultaat extends ParseResult<GestaagdeServicekostenregel> {
  duplicaatIssues: RowIssue[];
}

export function parseServicekosten(ruweRijen: readonly Record<string, unknown>[], servicekostenParams: ServicekostenParameters): ServicekostenParseResultaat {
  const { rijen, issues } = parseRowsWithSchema(ruweRijen, ServicekostenregelBronSchema);
  const gestaagd = rijen.map((rij) => naarGestaagdeServicekostenregel(rij, servicekostenParams));
  const duplicaatIssues = vindDubbeleNatuurlijkeSleutels(gestaagd, servicekostenregelNatuurlijkeSleutel);
  const signaalIssues: RowIssue[] = gestaagd
    .map((rij, index) => ({ rij, index }))
    .filter(({ rij }) => rij.uitsluitingsstatus === "CONTROLE_VEREIST_MOGELIJKE_SERVICEAFREKENING")
    .map(({ rij, index }) => ({
      rowIndex: index,
      bericht: `Kostensoort ${rij.serviceBkKostensoort} (${rij.kostensoortOmschrijving ?? "?"}): omschrijving bevat mogelijk een serviceafrekeningsterm — controle vereist, niet automatisch uitgesloten.`,
      ernst: "WAARSCHUWING" as const,
    }));
  return { rijen: gestaagd, issues: [...issues, ...signaalIssues], duplicaatIssues };
}
