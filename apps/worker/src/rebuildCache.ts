import { statSync } from "node:fs";
import {
  parseBalans,
  parseBoekingen,
  parseComplexTotalen,
  parseContracten,
  parseOuderdomsanalyse,
  parseRentroll,
  parseServicekosten,
  parseUnits,
  type RowIssue,
} from "@bvc/data-contracts";
import { CacheBuilder, type CacheData } from "@bvc/cache";
import { administratieCachePad, type BronType } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { resolveAlleBronnen } from "./sourceResolver.js";
import { laadBeheerparameters } from "./parameters.js";
import { ExcelBronAdapter, type BronAdapter } from "./bronAdapter.js";

export interface RebuildCacheOptions {
  root: string;
  administratieId: string;
  /** Verplicht als de bron ouderdomsanalyse aanwezig is — de bron bevat zelf geen peildatum. */
  ouderdomsanalyseMetadata?: { boekjaar: number; boekperiode: string; peildatum: Date } | undefined;
  /**
   * Voortgangsmeldingen (welk bestand wordt gelezen, hoeveel rijen verwerkt/
   * gefilterd, wanneer de cache wordt weggeschreven) — standaard naar
   * stderr met tijdstempel, zodat `pnpm cli`/`bvc-worker.exe` bij grote
   * bronbestanden zichtbaar voortgang tonen i.p.v. zonder enig teken lang
   * te lijken hangen. Tests kunnen dit overschrijven om stil te blijven.
   */
  onVoortgang?: ((bericht: string) => void) | undefined;
  /**
   * Levert de rauwe rijen per brontype — standaard `ExcelBronAdapter`
   * (leest het gedeelde/eigen xlsx-bestand). Overschrijfbaar zodat een
   * toekomstige DSN/ODBC-bron of een testdouble dezelfde genormaliseerde
   * datasets kan leveren zonder dat deze functie (of de rest van de
   * rekenlaag) iets van Excel/SheetJS/bestandspaden hoeft te weten —
   * zie bronAdapter.ts.
   */
  bronAdapter?: BronAdapter | undefined;
}

export interface RebuildCacheResultaat {
  cachePad: string;
  rowCounts: Record<string, number>;
  ontbrekendeBronnen: BronType[];
  issues: RowIssue[];
}

const dec = (v: { toString(): string } | null | undefined): string | null => (v == null ? null : v.toString());
const iso = (d: Date | null | undefined): string | null => (d == null ? null : d.toISOString());

function standaardLogger(bericht: string): void {
  console.error(`[${new Date().toISOString()}] ${bericht}`);
}

/**
 * Herbouwt de cache van één administratie volledig uit de actueel
 * geresolvede bronbestanden (gedeeld of eigen, per brontype). Gedeelde
 * bronnen worden hier — en pas hier — gefilterd op Bedrijfsnr; alle
 * cache-, controle- en rapportquery's werken daarna uitsluitend op deze
 * al-gefilterde data (CLAUDE_AANVULLENDE_INSTRUCTIES_LOKALE_BRONNEN_v0.1.md §5).
 *
 * Verwerkt bronnen één voor één en schrijft elk brontype meteen via
 * `CacheBuilder` naar SQLite (i.p.v. eerst alle acht brontypen volledig
 * als objecten in het geheugen te verzamelen in één groot `CacheData`-
 * object) — bij een groot gedeeld bestand (bv. een meerjarige "vanaf
 * 2024"-Boekingen-export met veel kolommen) hoeft zo maar één brontype
 * tegelijk in het geheugen te staan; de tussenresultaten van een bron
 * (ruwe rijen, gevalideerde rijen, gefilterde/gemapte cacherijen) kunnen
 * door de garbage collector worden vrijgegeven zodra die bron is
 * weggeschreven, vóórdat het volgende bestand wordt gelezen.
 */
export function rebuildCache(options: RebuildCacheOptions): RebuildCacheResultaat {
  const { root, administratieId } = options;
  const log = options.onVoortgang ?? standaardLogger;
  const bronAdapter = options.bronAdapter ?? new ExcelBronAdapter();
  const config = leesAdministratieConfig(root, administratieId);
  const bedrijfsnr = config.bedrijfsnr;
  const bronnen = resolveAlleBronnen(root, administratieId);
  const beheerparameters = laadBeheerparameters(root);
  const cachePad = administratieCachePad(root, administratieId);

  const ontbrekendeBronnen: BronType[] = [];
  const issues: RowIssue[] = [];

  log(`Cache herbouwen voor "${administratieId}" (Bedrijfsnr ${bedrijfsnr}) → ${cachePad}`);
  const builder = new CacheBuilder(cachePad);

  try {
    for (const bron of bronnen) {
      if (!bron.bestaat) {
        ontbrekendeBronnen.push(bron.bronType);
        log(`${bron.bronType}: bron ontbreekt (${bron.pad}), overgeslagen.`);
        continue;
      }

      if (bron.bronType === "begroting") {
        // Nog geen broncontract/cache-tabel voor begroting (zie validateBron.ts) —
        // niet nodeloos inlezen/parsen van een meerdere-tabbladen-bestand
        // waarvan de rijen hier toch niet worden gebruikt.
        log(`${bron.bronType}: nog geen cache-koppeling, overgeslagen.`);
        continue;
      }

      const grootteKB = Math.round(statSync(bron.pad).size / 1024);
      log(`${bron.bronType}: lezen ${bron.pad} (${grootteKB} KB)…`);
      const leesStart = Date.now();
      const ruweRijen = bronAdapter.leesRuweRijen(bron);
      log(`${bron.bronType}: ${ruweRijen.length} rijen ingelezen in ${Date.now() - leesStart} ms, valideren/filteren…`);

      const verwerkStart = Date.now();
      switch (bron.bronType) {
        case "boekingen": {
          const { rijen, issues: parseIssues } = parseBoekingen(ruweRijen);
          issues.push(...parseIssues);
          const cacheRijen: CacheData["boekingen"] = rijen
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
          log(`${bron.bronType}: ${cacheRijen.length} rijen voor deze administratie (van ${rijen.length} gevalideerd), wegschrijven naar cache…`);
          builder.insertBoekingen(cacheRijen);
          break;
        }
        case "balans_per_jaar": {
          const { rijen, issues: parseIssues } = parseBalans(ruweRijen);
          issues.push(...parseIssues);
          const cacheRijen: CacheData["balansstanden"] = rijen
            .filter((r) => r.bedrijfsnr === bedrijfsnr)
            .map((r) => ({
              bedrijfsnr: r.bedrijfsnr, jaar: r.jaar, grootboekrekeningnr: r.grootboekrekeningnr,
              beginbalans_debet: dec(r.beginbalansDebet), beginbalans_credit: dec(r.beginbalansCredit),
              saldo_debet: dec(r.saldoDebet)!, saldo_credit: dec(r.saldoCredit)!, eindsaldo: dec(r.eindsaldo)!,
              rekening_omschrijving: r.rekeningOmschrijving, balans_vw: r.balansVw,
            }));
          log(`${bron.bronType}: ${cacheRijen.length} rijen voor deze administratie (van ${rijen.length} gevalideerd), wegschrijven naar cache…`);
          builder.insertBalansstanden(cacheRijen);
          break;
        }
        case "rentroll": {
          const { rijen, issues: parseIssues } = parseRentroll(ruweRijen);
          issues.push(...parseIssues);
          const cacheRijen: CacheData["rentroll"] = rijen
            .filter((r) => r.bedrijfsnummer === bedrijfsnr)
            .map((r) => ({
              bedrijfsnummer: r.bedrijfsnummer, contractnummer: r.contractnummer, vorderingsoort: r.vorderingsoort,
              unitnummer: r.unitnummer ?? "", complexnummer: r.complexnummer,
              rapportage_datum: iso(r.rapportageDatum), prolongatie_bedrag_jaar: dec(r.prolongatieBedragJaar),
              korting_bedrag_jaar: dec(r.kortingBedragJaar), service_voorschot_jaar: dec(r.serviceVoorschotJaar),
              gehuurd_oppervlak: dec(r.gehuurdOppervlak), contract_expiratiedatum: iso(r.contractExpiratiedatum),
              contract_opzegdatum: iso(r.contractOpzegdatum),
            }));
          log(`${bron.bronType}: ${cacheRijen.length} rijen voor deze administratie (van ${rijen.length} gevalideerd), wegschrijven naar cache…`);
          builder.insertRentroll(cacheRijen);
          break;
        }
        case "contracten_huidig": {
          const { rijen, issues: parseIssues } = parseContracten(ruweRijen);
          issues.push(...parseIssues);
          const cacheRijen: CacheData["contracten"] = rijen
            .filter((r) => r.bedrijfsnr === bedrijfsnr)
            .map((r) => ({
              bedrijfsnr: r.bedrijfsnr, contract: r.contract, complexnummer: r.complexnummer, unitnummer: r.unitnummer,
              huurdernummer: r.huurdernummer, ingangsdatum: iso(r.ingangsdatum), afloopdatum: iso(r.afloopdatum),
              check_lopend_contract: r.checkLopendContract, expiratie_expiratiedatum: iso(r.expiratieExpiratiedatum),
              expiratie_opzegdatum: iso(r.expiratieOpzegdatum), expiratie_aantal_per_optie: r.expiratieAantalPerOptie,
              expiratie_huidige: r.expiratieHuidige,
            }));
          log(`${bron.bronType}: ${cacheRijen.length} rijen voor deze administratie (van ${rijen.length} gevalideerd), wegschrijven naar cache…`);
          builder.insertContracten(cacheRijen);
          break;
        }
        case "units": {
          const { rijen, issues: parseIssues } = parseUnits(ruweRijen);
          issues.push(...parseIssues);
          const cacheRijen: CacheData["units"] = rijen
            .filter((r) => r.bedrijfsnr === bedrijfsnr)
            .map((r) => ({
              bedrijfsnr: r.bedrijfsnr, complexnummer: r.complexnummer, unitnummer: r.unitnummer,
              unit_non_actief: r.unitNonActief, unitomschrijving: r.unitomschrijving, unitsoort: r.unitsoort,
              unit_vvo: dec(r.unitVvo), unit_bvo: dec(r.unitBvo), unit_adres: r.unitAdres,
              unit_postcode: r.unitPostcode, unit_plaats: r.unitPlaats,
            }));
          log(`${bron.bronType}: ${cacheRijen.length} rijen voor deze administratie (van ${rijen.length} gevalideerd), wegschrijven naar cache…`);
          builder.insertUnits(cacheRijen);
          break;
        }
        case "complex_totalen": {
          const { rijen, issues: parseIssues } = parseComplexTotalen(ruweRijen);
          issues.push(...parseIssues);
          const cacheRijen: CacheData["complex_totalen"] = rijen
            .filter((r) => r.bedrijfsnr === bedrijfsnr)
            .map((r) => ({
              bedrijfsnr: r.bedrijfsnr, complexnr: r.complexnr, totaal_oppervlakte: dec(r.totaalOppervlakte),
              totaal_verhuurd: dec(r.totaalVerhuurd), totaal_leegstand: dec(r.totaalLeegstand),
            }));
          log(`${bron.bronType}: ${cacheRijen.length} rijen voor deze administratie (van ${rijen.length} gevalideerd), wegschrijven naar cache…`);
          builder.insertComplexTotalen(cacheRijen);
          break;
        }
        case "servicekosten": {
          const { rijen, issues: parseIssues } = parseServicekosten(ruweRijen, beheerparameters.servicekosten);
          issues.push(...parseIssues);
          const cacheRijen: CacheData["servicekosten"] = rijen
            .filter((r) => r.bedrijfsnr === bedrijfsnr)
            .map((r) => ({
              bedrijfsnr: r.bedrijfsnr, boekjaar: r.serviceBkBoekjaar, boekperiode: r.serviceBkBoekperiode,
              dagboeknummer: r.serviceBkDagboeknummer, boekstuknummer: r.serviceBkBoekstuknummer,
              volgnummer: r.serviceBkVolgnummer, complexnummer: r.serviceBkComplexnummer, unitnummer: r.serviceBkUnitnummer,
              contractnummer: r.serviceBkContractnummer, huurdernummer: r.huurdernummer, kostensoort: r.serviceBkKostensoort,
              kostensoort_omschrijving: r.kostensoortOmschrijving, omschrijving: r.serviceBkOmschrijving,
              bedrag_debet: dec(r.serviceBkBedragDebet)!, bedrag_credit: dec(r.serviceBkBedragCredit)!,
              saldo: dec(r.serviceBoekingSaldo)!, doorbelasten: r.serviceBkDoorbelasten, uitsluitingsstatus: r.uitsluitingsstatus,
              kostensoort_soort: r.kostensoortSoort, jaar_sv_afrekening: r.jaarSvAfrekening,
            }));
          log(`${bron.bronType}: ${cacheRijen.length} rijen voor deze administratie (van ${rijen.length} gevalideerd), wegschrijven naar cache…`);
          builder.insertServicekosten(cacheRijen);
          break;
        }
        case "ouderdomsanalyse": {
          if (!options.ouderdomsanalyseMetadata) {
            issues.push({ rowIndex: -1, bericht: "Ouderdomsanalyse aanwezig maar boekjaar/boekperiode/peildatum niet meegegeven — cache overslaan voor deze bron.", ernst: "WAARSCHUWING" });
            log(`${bron.bronType}: overgeslagen (geen boekjaar/boekperiode/peildatum meegegeven).`);
            break;
          }
          const { rijen, issues: parseIssues } = parseOuderdomsanalyse(ruweRijen, options.ouderdomsanalyseMetadata);
          issues.push(...parseIssues);
          const cacheRijen: CacheData["ouderdomsanalyse"] = rijen
            .filter((r) => r.bedrijfsnr === bedrijfsnr)
            .map((r) => ({
              bedrijfsnr: r.bedrijfsnr, huurdernr: r.huurdernr, achterstand: dec(r.achterstand)!,
              achterstand_tm_30_dagen: dec(r.achterstandTm30Dagen)!, achterstand_tm_60_dagen: dec(r.achterstandTm60Dagen)!,
              achterstand_tm_90_dagen: dec(r.achterstandTm90Dagen)!, achterstand_90plus_dagen: dec(r.achterstand90PlusDagen)!,
              vooruitbetaling: dec(r.vooruitbetaling)!, saldo: dec(r.saldo)!, boekjaar: r.boekjaar,
              boekperiode: r.boekperiode, peildatum: iso(r.peildatum)!,
            }));
          log(`${bron.bronType}: ${cacheRijen.length} rijen voor deze administratie (van ${rijen.length} gevalideerd), wegschrijven naar cache…`);
          builder.insertOuderdomsanalyse(cacheRijen);
          break;
        }
      }
      log(`${bron.bronType}: verwerkt in ${Date.now() - verwerkStart} ms.`);
    }

    log("Cache wegschrijven (cache_meta, atomisch vervangen)…");
    const result = builder.finish();
    log(`Cache herbouwd: ${result.path}`);
    return { cachePad: result.path, rowCounts: result.rowCounts, ontbrekendeBronnen, issues };
  } catch (error) {
    builder.abort();
    throw error;
  }
}
