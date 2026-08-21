import Decimal from "decimal.js";
import type { GrootboekMappingRegel } from "@bvc/config";
import { boekingSaldo, liquideMiddelenVoorRegel, rapportregelsom, zoekMappingRegel, type Balansstand, type Boekingsregel } from "@bvc/domain";
import { beginbalansSaldo } from "./balansPeriodeBerekening.js";

/**
 * Kasstroom-periodeberekening (2026-08-22, eerste, bewust EENVOUDIGE
 * versie: alleen mutatie bankstand, geen volledige indirecte
 * kasstroomopbouw uit resultaat+mutaties — zie packages/reporting/README.md
 * voor de scope-afbakening). Zelfde aanpak/patroon als
 * `balansPeriodeBerekening.ts`: beginbalans (jaarstart) + som van alle
 * boekingen t/m de opgegeven boekperiode, uitsluitend voor rekeningen die
 * expliciet als `liquideMiddelen: true` geclassificeerd zijn
 * (`@bvc/config`'s `BalansRegelSchema`) — nooit afgeleid uit de
 * rekeningomschrijving/-naam.
 *
 * Bewust ALLEEN de rekenlaag: geen renderer/HTML, geen eigen
 * periodeselectie- of mappinglogica.
 */

export interface KasstroomPeriodeRekening {
  grootboekrekening: string;
  /** Rechtstreeks uit de bron (Rekening_omschrijving) — geen classificatie, alleen doorgegeven tekst. */
  omschrijving: string | null;
  beginbalans: Decimal;
  /** Som van boekingen (debet - credit) in de opgegeven periode. */
  mutatie: Decimal;
  eindstand: Decimal;
}

export interface KasstroomPeriodeControleVereist {
  grootboekrekening: string;
  /** Best bekende bedrag (mutatie in de periode) — nooit met een geraden liquiditeitsclassificatie gepresenteerd. */
  saldo: Decimal;
  reden: string;
}

export interface KasstroomPeriodeResultaat {
  rekeningen: KasstroomPeriodeRekening[];
  beginstandTotaal: Decimal;
  mutatieTotaal: Decimal;
  eindstandTotaal: Decimal;
  /**
   * Rekeningen met een niet-nul mutatie in de periode die niet als liquide
   * middelen verwerkt konden worden: onbekende rekening, of een BALANS-
   * rekening waarvan `liquideMiddelen` nog niet bevestigd is. Een rekening
   * die bekend en bevestigd GEEN liquide middelen is (bv. huurdebiteuren)
   * komt hier bewust NIET in terecht — dat is terecht buitengesloten, geen
   * ontbrekende classificatie.
   */
  controleVereist: KasstroomPeriodeControleVereist[];
}

export function berekenKasstroomPeriode(
  balansstanden: readonly Balansstand[],
  boekingen: readonly Boekingsregel[],
  mappingRegels: readonly GrootboekMappingRegel[],
): KasstroomPeriodeResultaat {
  const mutatiePerRekening = new Map<string, Decimal>();
  for (const boeking of boekingen) {
    const saldo = boekingSaldo(boeking);
    mutatiePerRekening.set(boeking.grootboeknr, (mutatiePerRekening.get(boeking.grootboeknr) ?? new Decimal(0)).plus(saldo));
  }

  const standPerRekening = new Map(balansstanden.map((stand) => [stand.grootboekrekeningnr, stand]));
  const alleRekeningen = new Set<string>([...standPerRekening.keys(), ...mutatiePerRekening.keys()]);

  const rekeningen: KasstroomPeriodeRekening[] = [];
  const controleVereist: KasstroomPeriodeControleVereist[] = [];

  for (const grootboekrekening of alleRekeningen) {
    const mutatie = mutatiePerRekening.get(grootboekrekening) ?? new Decimal(0);
    const standRow = standPerRekening.get(grootboekrekening);
    const mappingResultaat = zoekMappingRegel(mappingRegels, grootboekrekening);

    if (mappingResultaat.type === "onbekend") {
      if (!mutatie.isZero()) {
        controleVereist.push({ grootboekrekening, saldo: mutatie, reden: mappingResultaat.reden });
      }
      continue;
    }

    if (mappingResultaat.waarde.soort === "RESULTAAT") {
      // Bekend, bewust buiten kasstroom-scope: een RESULTAAT-rekening is per definitie geen liquide middelen.
      continue;
    }

    const liquideResultaat = liquideMiddelenVoorRegel(mappingResultaat.waarde);
    if (liquideResultaat.type === "onbekend") {
      if (!mutatie.isZero()) {
        controleVereist.push({ grootboekrekening, saldo: mutatie, reden: liquideResultaat.reden });
      }
      continue;
    }
    if (!liquideResultaat.waarde) {
      // Bekend en bevestigd GEEN liquide middelen (bv. huurdebiteuren) -- geen post, geen controleVereist.
      continue;
    }

    const beginbalansResultaat = beginbalansSaldo(standRow);
    if (beginbalansResultaat.type === "onbekend") {
      if (!mutatie.isZero() || standRow !== undefined) {
        controleVereist.push({ grootboekrekening, saldo: mutatie, reden: beginbalansResultaat.reden });
      }
      continue;
    }

    const beginbalans = beginbalansResultaat.waarde;
    rekeningen.push({
      grootboekrekening,
      omschrijving: standRow?.rekeningOmschrijving ?? null,
      beginbalans,
      mutatie,
      eindstand: beginbalans.plus(mutatie),
    });
  }

  rekeningen.sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));
  controleVereist.sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));

  return {
    rekeningen,
    beginstandTotaal: rapportregelsom(rekeningen.map((r) => r.beginbalans)),
    mutatieTotaal: rapportregelsom(rekeningen.map((r) => r.mutatie)),
    eindstandTotaal: rapportregelsom(rekeningen.map((r) => r.eindstand)),
    controleVereist,
  };
}
