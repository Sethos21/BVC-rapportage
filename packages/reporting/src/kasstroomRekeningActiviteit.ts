import Decimal from "decimal.js";
import type { GrootboekMappingRegel } from "@bvc/config";
import { boekingSaldo, liquideMiddelenVoorRegel, type Boekingsregel } from "@bvc/domain";

/**
 * Alleen-lezen diagnostiek (2026-08-25) — geen rapport, geen KPI, verandert
 * niets aan enige mapping/berekening. Toont ALLE boekingen op één
 * opgegeven grootboekrekening binnen de periode, chronologisch, met per
 * boekstuk of het kasstroom-relevant is (bevat het een liquide-middelen-
 * regel).
 *
 * Bouwstap voor het BTW-onderzoek (070_Rooise_Zoom, 2026-08-25): `1506`
 * (Afdrachten BTW) bleek zelf geen directe banktegenrekening te zijn — de
 * boeking loopt via `1600` (Crediteuren). Anders dan bij een
 * eigenaaronttrekking (waar de tegenrekening-boeking en de bankmutatie in
 * HETZELFDE boekstuk staan) is een crediteurenrekening een gepoolde
 * rekening: de factuurregistratie (credit 1600, tegen 1506) en de
 * uiteindelijke betaling (debit 1600, tegen de bank) staan vrijwel zeker
 * in VERSCHILLENDE boekstukken, mogelijk zelfs gebundeld met andere
 * leveranciers/facturen in één betaalbatch. Dit overzicht legt de ruwe
 * activiteit op zo'n rekening bloot (boekstukSleutel, dagboeknr, datum,
 * bedrag, omschrijving, kasstroom-relevantie) zodat een eventuele keten
 * factuur→betaling met de ECHTE data beoordeeld kan worden — dit bestand
 * beslist zelf niets en matcht niets automatisch (geen aanname op basis
 * van toevallig gelijke bedragen, zie packages/config/README.md's
 * 1505/1506-toelichting).
 *
 * Uitbreiding (2026-08-26): `Boeking_Grootboek_A`/`Boeking_Grootboek_B` zijn
 * twee bronkolommen (`packages/data-contracts/src/sources/boekingen.ts`) die
 * mogelijk een betrouwbaardere koppelsleutel bevatten dan bedrag-matching om
 * de keten 1506 → 1600 → bank te volgen — nog GEEN aanname over hun
 * betekenis, puur zichtbaar maken voor onderzoek met echte data. Ze staan al
 * langer in `packages/cache`'s schema (`grootboek_a`/`grootboek_b` op
 * `boekingen`), maar het gedeelde `Boekingsregel`-domeintype (`@bvc/domain`,
 * bewust minimaal — alleen velden die berekeningen nodig hebben) geeft ze
 * niet door. Om die reden breidt DIT diagnose-instrument lokaal uit i.p.v.
 * het domeintype te wijzigen: `BoekingsregelMetGrootboekAB` is een
 * intersection-type, alleen gebruikt door deze functie en de aanroepende
 * Worker-generator — geen enkele KPI/domeincode raakt hierdoor geraakt.
 */

export type BoekingsregelMetGrootboekAB = Boekingsregel & {
  grootboekA: string | null;
  grootboekB: string | null;
};

export interface RekeningActiviteitRegel {
  boekstukSleutel: string;
  dagboeknr: string;
  boekdatum: Date;
  bedrag: Decimal;
  omschrijving: string;
  isKasstroomRelevant: boolean;
  grootboekA: string | null;
  grootboekB: string | null;
}

export function diagnoseerRekeningActiviteit(
  boekingen: readonly BoekingsregelMetGrootboekAB[],
  mappingRegels: readonly GrootboekMappingRegel[],
  doelRekening: string,
): RekeningActiviteitRegel[] {
  const liquideRekeningen = new Set<string>();
  for (const regel of mappingRegels) {
    if (regel.soort !== "BALANS") continue;
    const liquideResultaat = liquideMiddelenVoorRegel(regel);
    if (liquideResultaat.type === "bekend" && liquideResultaat.waarde) liquideRekeningen.add(regel.grootboekrekening);
  }

  const kasstroomRelevantBoekstuk = new Map<string, boolean>();
  for (const boeking of boekingen) {
    const key = `${boeking.bedrijfsnr}::${boeking.boekstukSleutel}`;
    if (liquideRekeningen.has(boeking.grootboeknr)) kasstroomRelevantBoekstuk.set(key, true);
    else if (!kasstroomRelevantBoekstuk.has(key)) kasstroomRelevantBoekstuk.set(key, false);
  }

  const regels: RekeningActiviteitRegel[] = boekingen
    .filter((boeking) => boeking.grootboeknr === doelRekening)
    .map((boeking) => ({
      boekstukSleutel: boeking.boekstukSleutel,
      dagboeknr: boeking.dagboeknr,
      boekdatum: boeking.boekdatum,
      bedrag: boekingSaldo(boeking),
      omschrijving: boeking.omschrijving,
      isKasstroomRelevant: kasstroomRelevantBoekstuk.get(`${boeking.bedrijfsnr}::${boeking.boekstukSleutel}`) ?? false,
      grootboekA: boeking.grootboekA,
      grootboekB: boeking.grootboekB,
    }));

  return regels.sort((a, b) => a.boekdatum.getTime() - b.boekdatum.getTime());
}
