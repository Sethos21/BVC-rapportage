import { readFileSync } from "node:fs";
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
import { buildCache, EMPTY_CACHE_DATA, type CacheData } from "@bvc/cache";
import { administratieCachePad, type BronType } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { resolveAlleBronnen } from "./sourceResolver.js";
import { laadBeheerparameters } from "./parameters.js";

export interface RebuildCacheOptions {
  root: string;
  administratieId: string;
  /** Verplicht als de bron ouderdomsanalyse aanwezig is — de bron bevat zelf geen peildatum. */
  ouderdomsanalyseMetadata?: { boekjaar: number; boekperiode: string; peildatum: Date } | undefined;
}

export interface RebuildCacheResultaat {
  cachePad: string;
  rowCounts: Record<string, number>;
  ontbrekendeBronnen: BronType[];
  issues: RowIssue[];
}

const dec = (v: { toString(): string } | null | undefined): string | null => (v == null ? null : v.toString());
const iso = (d: Date | null | undefined): string | null => (d == null ? null : d.toISOString());

/**
 * Herbouwt de cache van één administratie volledig uit de actueel
 * geresolvede bronbestanden (gedeeld of eigen, per brontype). Gedeelde
 * bronnen worden hier — en pas hier — gefilterd op Bedrijfsnr; alle
 * cache-, controle- en rapportquery's werken daarna uitsluitend op deze
 * al-gefilterde data (CLAUDE_AANVULLENDE_INSTRUCTIES_LOKALE_BRONNEN_v0.1.md §5).
 */
export function rebuildCache(options: RebuildCacheOptions): RebuildCacheResultaat {
  const { root, administratieId } = options;
  const config = leesAdministratieConfig(root, administratieId);
  const bedrijfsnr = config.bedrijfsnr;
  const bronnen = resolveAlleBronnen(root, administratieId);
  const beheerparameters = laadBeheerparameters(root);

  const data: CacheData = structuredClone(EMPTY_CACHE_DATA);
  const ontbrekendeBronnen: BronType[] = [];
  const issues: RowIssue[] = [];

  for (const bron of bronnen) {
    if (!bron.bestaat) {
      ontbrekendeBronnen.push(bron.bronType);
      continue;
    }
    const ruweRijen = readFirstSheetAsRows(readFileSync(bron.pad));

    switch (bron.bronType) {
      case "boekingen": {
        const { rijen, issues: parseIssues } = parseBoekingen(ruweRijen);
        issues.push(...parseIssues);
        data.boekingen = rijen
          .filter((r) => r.bedrijfsnr === bedrijfsnr)
          .map((r) => ({
            bedrijfsnr: r.bedrijfsnr, boekjaar: r.boekingBoekjaar, boekperiode: r.boekingBoekperiode,
            dagboeknr: r.boekingDagboeknr, boekstuknr: r.boekingBoekstuknr, volgnr: r.boekingVolgnr,
            boekstuk_sleutel: r.boekstukSleutel, boekdatum: iso(r.boekingBoekdatum)!, grootboeknr: r.boekingGrootboeknr,
            kostenplaatsnr: r.boekingKostenplaatsnr, complexnr: r.boekingComplexnr, unitnr: r.boekingUnitnr,
            contractnr: r.boekingContractnr, huurdernr: r.boekingHuurdernr, bedrag_debet: dec(r.boekingBedragDebet)!,
            bedrag_credit: dec(r.boekingBedragCredit)!, saldo: dec(r.boekingSaldo)!, omschrijving: r.boekingOmschrijving,
            grootboek_a: r.boekingGrootboekA, grootboek_b: r.boekingGrootboekB,
          }));
        break;
      }
      case "balans_per_jaar": {
        const { rijen, issues: parseIssues } = parseBalans(ruweRijen);
        issues.push(...parseIssues);
        data.balansstanden = rijen
          .filter((r) => r.bedrijfsnr === bedrijfsnr)
          .map((r) => ({
            bedrijfsnr: r.bedrijfsnr, jaar: r.jaar, grootboekrekeningnr: r.grootboekrekeningnr,
            beginbalans_debet: dec(r.beginbalansDebet), beginbalans_credit: dec(r.beginbalansCredit),
            saldo_debet: dec(r.saldoDebet)!, saldo_credit: dec(r.saldoCredit)!, eindsaldo: dec(r.eindsaldo)!,
            rekening_omschrijving: r.rekeningOmschrijving, balans_vw: r.balansVw,
          }));
        break;
      }
      case "rentroll": {
        const { rijen, issues: parseIssues } = parseRentroll(ruweRijen);
        issues.push(...parseIssues);
        data.rentroll = rijen
          .filter((r) => r.bedrijfsnummer === bedrijfsnr)
          .map((r) => ({
            bedrijfsnummer: r.bedrijfsnummer, contractnummer: r.contractnummer, vorderingsoort: r.vorderingsoort,
            unitnummer: r.unitnummer ?? "", complexnummer: r.complexnummer,
            rapportage_datum: iso(r.rapportageDatum), prolongatie_bedrag_jaar: dec(r.prolongatieBedragJaar),
            korting_bedrag_jaar: dec(r.kortingBedragJaar), service_voorschot_jaar: dec(r.serviceVoorschotJaar),
            gehuurd_oppervlak: dec(r.gehuurdOppervlak), contract_expiratiedatum: iso(r.contractExpiratiedatum),
            contract_opzegdatum: iso(r.contractOpzegdatum),
          }));
        break;
      }
      case "contracten_huidig": {
        const { rijen, issues: parseIssues } = parseContracten(ruweRijen);
        issues.push(...parseIssues);
        data.contracten = rijen
          .filter((r) => r.bedrijfsnr === bedrijfsnr)
          .map((r) => ({
            bedrijfsnr: r.bedrijfsnr, contract: r.contract, complexnummer: r.complexnummer, unitnummer: r.unitnummer,
            huurdernummer: r.huurdernummer, ingangsdatum: iso(r.ingangsdatum), afloopdatum: iso(r.afloopdatum),
            check_lopend_contract: r.checkLopendContract, expiratie_expiratiedatum: iso(r.expiratieExpiratiedatum),
            expiratie_opzegdatum: iso(r.expiratieOpzegdatum), expiratie_aantal_per_optie: r.expiratieAantalPerOptie,
            expiratie_huidige: r.expiratieHuidige,
          }));
        break;
      }
      case "units": {
        const { rijen, issues: parseIssues } = parseUnits(ruweRijen);
        issues.push(...parseIssues);
        data.units = rijen
          .filter((r) => r.bedrijfsnr === bedrijfsnr)
          .map((r) => ({
            bedrijfsnr: r.bedrijfsnr, complexnummer: r.complexnummer, unitnummer: r.unitnummer,
            unit_non_actief: r.unitNonActief, unitomschrijving: r.unitomschrijving, unitsoort: r.unitsoort,
            unit_vvo: dec(r.unitVvo), unit_bvo: dec(r.unitBvo), unit_adres: r.unitAdres,
            unit_postcode: r.unitPostcode, unit_plaats: r.unitPlaats,
          }));
        break;
      }
      case "complex_totalen": {
        const { rijen, issues: parseIssues } = parseComplexTotalen(ruweRijen);
        issues.push(...parseIssues);
        data.complex_totalen = rijen
          .filter((r) => r.bedrijfsnr === bedrijfsnr)
          .map((r) => ({
            bedrijfsnr: r.bedrijfsnr, complexnr: r.complexnr, totaal_oppervlakte: dec(r.totaalOppervlakte),
            totaal_verhuurd: dec(r.totaalVerhuurd), totaal_leegstand: dec(r.totaalLeegstand),
          }));
        break;
      }
      case "servicekosten": {
        const { rijen, issues: parseIssues } = parseServicekosten(ruweRijen, beheerparameters.servicekosten);
        issues.push(...parseIssues);
        data.servicekosten = rijen
          .filter((r) => r.bedrijfsnr === bedrijfsnr)
          .map((r) => ({
            bedrijfsnr: r.bedrijfsnr, boekjaar: r.serviceBkBoekjaar, boekperiode: r.serviceBkBoekperiode,
            dagboeknummer: r.serviceBkDagboeknummer, boekstuknummer: r.serviceBkBoekstuknummer,
            volgnummer: r.serviceBkVolgnummer, complexnummer: r.serviceBkComplexnummer, unitnummer: r.serviceBkUnitnummer,
            contractnummer: r.serviceBkContractnummer, huurdernummer: r.huurdernummer, kostensoort: r.serviceBkKostensoort,
            kostensoort_omschrijving: r.kostensoortOmschrijving, omschrijving: r.serviceBkOmschrijving,
            bedrag_debet: dec(r.serviceBkBedragDebet)!, bedrag_credit: dec(r.serviceBkBedragCredit)!,
            saldo: dec(r.serviceBoekingSaldo)!, doorbelasten: r.serviceBkDoorbelasten, uitsluitingsstatus: r.uitsluitingsstatus,
          }));
        break;
      }
      case "ouderdomsanalyse": {
        if (!options.ouderdomsanalyseMetadata) {
          issues.push({ rowIndex: -1, bericht: "Ouderdomsanalyse aanwezig maar boekjaar/boekperiode/peildatum niet meegegeven — cache overslaan voor deze bron.", ernst: "WAARSCHUWING" });
          break;
        }
        const { rijen, issues: parseIssues } = parseOuderdomsanalyse(ruweRijen, options.ouderdomsanalyseMetadata);
        issues.push(...parseIssues);
        data.ouderdomsanalyse = rijen
          .filter((r) => r.bedrijfsnr === bedrijfsnr)
          .map((r) => ({
            bedrijfsnr: r.bedrijfsnr, huurdernr: r.huurdernr, achterstand: dec(r.achterstand)!,
            achterstand_tm_30_dagen: dec(r.achterstandTm30Dagen)!, achterstand_tm_60_dagen: dec(r.achterstandTm60Dagen)!,
            achterstand_tm_90_dagen: dec(r.achterstandTm90Dagen)!, achterstand_90plus_dagen: dec(r.achterstand90PlusDagen)!,
            vooruitbetaling: dec(r.vooruitbetaling)!, saldo: dec(r.saldo)!, boekjaar: r.boekjaar,
            boekperiode: r.boekperiode, peildatum: iso(r.peildatum)!,
          }));
        break;
      }
      case "begroting":
        // Nog geen broncontract/cache-tabel voor begroting — zie validateBron.ts.
        break;
    }
  }

  const result = buildCache(administratieCachePad(root, administratieId), data);
  return { cachePad: result.path, rowCounts: result.rowCounts, ontbrekendeBronnen, issues };
}
