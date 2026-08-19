import Decimal from "decimal.js";
import type { Balanszijde, GrootboekMappingRegel } from "@bvc/config";
import { balanszijdeVoorRegel, boekingSaldo, rapportregelsom, zoekMappingRegel, type Balansstand, type Boekingsregel, type OnbekendOf } from "@bvc/domain";

/**
 * Balans-periodeberekening op een expliciet al-geselecteerde periode
 * boekingen (zie `@bvc/cache`'s `selecteerBoekingen` — periodeselectie
 * gebeurt daar, niet hier) plus de beginbalans per rekening (jaarstand bij
 * boekjaarbegin), en de goedgekeurde grootboekmapping. Bewust ALLEEN de
 * rekenlaag: geen renderer/HTML, geen eigen periodeselectie- of
 * mappinglogica.
 *
 * Aanpak (levert een reproduceerbare balans op elke expliciete
 * boekjaar+boekperiode-peildatum, zonder Worker-cache-schemawijziging):
 * saldo per rekening op de peildatum = beginbalans (jaarstart) + som van
 * alle boekingen in de periode 1 t/m de opgegeven boekperiode. Dit is
 * zuivere optelling op al-gevalideerde bronvelden, geen aanname over een
 * boekperiode-kolom die niet in de cache bestaat. De optelling gebruikt
 * uitsluitend `@bvc/domain`'s `boekingSaldo` (debet - credit, centraal
 * herberekend) — nooit de bron-kolom `Boeking_Saldo` (die blijft
 * audit-only, zie `parseBoekingen`'s `controleerBronsaldoAfwijking` in
 * `@bvc/data-contracts`), exact dezelfde conventie als de al bewezen
 * P&L-periodeberekening.
 *
 * Activa/Passiva ("balanszijde") is een VASTE eigenschap van de
 * grootboekrekening zelf, herkomstig uit de goedgekeurde grootboekmapping
 * (`@bvc/config`'s `BalansRegel.balanszijde`) — NOOIT afgeleid uit het
 * actuele teken van het berekende saldo. Een rekening met een tijdelijk
 * afwijkend saldoteken (bv. een vooruitbetalende debiteur, of een
 * voorziening die tijdelijk overschreden is) blijft op zijn toegewezen
 * kant staan, met een zichtbaar negatief bedrag — zie `saldo` hieronder.
 * Ontbreekt de balanszijde nog (`null`, nog niet bevestigd), dan komt de
 * rekening in `controleVereist` terecht, nooit gegokt op het saldoteken.
 */

export type BalansRapportageCategorie = Balanszijde;

export interface BalansPeriodePost {
  grootboekrekening: string;
  /** Rechtstreeks uit de bron (Rekening_omschrijving) — geen classificatie, alleen doorgegeven tekst. */
  omschrijving: string | null;
  /**
   * De vaste balanszijde uit de grootboekmapping (nooit het saldoteken) —
   * zie moduledoc hierboven.
   */
  rapportagecategorie: BalansRapportageCategorie;
  /**
   * Netto saldo op de peildatum (beginbalans + mutaties t/m de opgegeven
   * periode), debet - credit, MET het werkelijke teken — kan negatief zijn
   * op een normaal positieve balanszijde (bv. Activa). Bewust ongewijzigd
   * doorgegeven: geen abs()/tekenomkering, ook niet voor presentatie (zie
   * renderBalansPeriode.ts). Dit teken, samen met `rapportagecategorie`,
   * is precies de structuur die een latere balanstoelichting nodig heeft
   * om bijzondere gevallen (negatief saldo op Activa/Passiva) te
   * signaleren — die toelichtingslogica wordt hier bewust nog niet gebouwd.
   */
  saldo: Decimal;
}

export interface BalansPeriodeCategorieTotaal {
  rapportagecategorie: BalansRapportageCategorie;
  bedrag: Decimal;
}

export interface BalansPeriodeControleVereist {
  grootboekrekening: string;
  /**
   * Het best bekende bedrag voor deze rekening: het volledige saldo
   * (beginbalans + mutatie) als dat berekenbaar was maar de balanszijde
   * ontbreekt, anders de rauwe mutatie in de periode (debet - credit) als
   * zelfs het saldo niet volledig bepaald kon worden — zie `reden`.
   */
  saldo: Decimal;
  reden: string;
}

export interface BalansAansluitingscontrole {
  /** Som van alle Activa-posten, SIGNED — een individuele post kan negatief zijn (zie moduledoc), bewust geen abs(). */
  activaTotaal: Decimal;
  /** Som van alle Passiva-posten, SIGNED — bewust geen abs(), zie moduledoc. */
  passivaTotaal: Decimal;
  /** Rauwe netto mutatie (debet - credit) van alle RESULTAAT-boekingen in de periode — geen tekenconventie/presentatiefactor toegepast, puur dubbel-boekhoudkundig feit. */
  resultaatTotaal: Decimal;
  /**
   * activaTotaal + passivaTotaal + resultaatTotaal — hoort ~0 te zijn bij
   * een complete, correct gemapte balans WAARVAN de beginbalans van alle
   * BALANS-rekeningen samen zelf al op 0 sluit (dubbel boekhouden: activa =
   * passiva + eigen vermogen bij jaarbegin). Onder die voorwaarde is een
   * afwijking exact gelijk aan (min) de som van de `controleVereist`-
   * mutaties: een niet-gemapte of anderszins niet meegenomen rekening. Sluit
   * de beginbalans zelf niet (bv. onvolledige testdata of een echte
   * datafout uit een eerder boekjaar), dan schuift die begin-afwijking mee
   * door in `verschil` — dat is juist gewenst: geen stilzwijgende correctie.
   */
  verschil: Decimal;
  sluitBinnenTolerantie: boolean;
}

export interface BalansPeriodeResultaat {
  posten: BalansPeriodePost[];
  categorieTotalen: BalansPeriodeCategorieTotaal[];
  controleVereist: BalansPeriodeControleVereist[];
  aansluiting: BalansAansluitingscontrole;
}

/**
 * Bepaalt de beginbalans (debet - credit) van één rekening. Beide velden
 * ontbreken (`null`) => `onbekend`, nooit stilzwijgend 0 (CLAUDE.md §6).
 * Ontbreekt slechts één kant, dan is de andere kant wél expliciet
 * aangeleverd door de bron en telt de ontbrekende kant als 0 (normale
 * boekhoudkundige weergave van een eenzijdig saldo, geen datagat).
 */
function beginbalansSaldo(stand: Balansstand | undefined): OnbekendOf<Decimal> {
  if (!stand) {
    return {
      type: "onbekend",
      reden: "Geen balansstand (beginbalans) gevonden voor deze rekening in dit boekjaar.",
    };
  }
  const debet = stand.beginbalansDebet;
  const credit = stand.beginbalansCredit;
  if ((debet === null || debet === undefined) && (credit === null || credit === undefined)) {
    return {
      type: "onbekend",
      reden: `Beginbalans (debet/credit) ontbreekt in de bron voor rekening ${stand.grootboekrekeningnr}.`,
    };
  }
  return { type: "bekend", waarde: (debet ?? new Decimal(0)).minus(credit ?? new Decimal(0)) };
}

export function berekenBalansPeriode(
  balansstanden: readonly Balansstand[],
  boekingen: readonly Boekingsregel[],
  mappingRegels: readonly GrootboekMappingRegel[],
  toleranceEuro: Decimal = new Decimal("0.01"),
): BalansPeriodeResultaat {
  const mutatiePerRekening = new Map<string, Decimal>();
  for (const boeking of boekingen) {
    const saldo = boekingSaldo(boeking);
    mutatiePerRekening.set(boeking.grootboeknr, (mutatiePerRekening.get(boeking.grootboeknr) ?? new Decimal(0)).plus(saldo));
  }

  const standPerRekening = new Map(balansstanden.map((stand) => [stand.grootboekrekeningnr, stand]));
  const alleRekeningen = new Set<string>([...standPerRekening.keys(), ...mutatiePerRekening.keys()]);

  const posten: BalansPeriodePost[] = [];
  const controleVereist: BalansPeriodeControleVereist[] = [];
  let resultaatTotaal = new Decimal(0);

  for (const grootboekrekening of alleRekeningen) {
    const mutatie = mutatiePerRekening.get(grootboekrekening) ?? new Decimal(0);
    const mappingResultaat = zoekMappingRegel(mappingRegels, grootboekrekening);

    if (mappingResultaat.type === "onbekend") {
      if (!mutatie.isZero()) {
        controleVereist.push({ grootboekrekening, saldo: mutatie, reden: mappingResultaat.reden });
      }
      continue;
    }

    if (mappingResultaat.waarde.soort === "RESULTAAT") {
      // Bekend, bewust buiten de balans (hoort in de P&L — @bvc/reporting's berekenPlPeriode); meegeteld in de aansluitingscontrole.
      resultaatTotaal = resultaatTotaal.plus(mutatie);
      continue;
    }

    const standRow = standPerRekening.get(grootboekrekening);
    const beginbalansResultaat = beginbalansSaldo(standRow);
    if (beginbalansResultaat.type === "onbekend") {
      if (!mutatie.isZero() || standRow !== undefined) {
        controleVereist.push({ grootboekrekening, saldo: mutatie, reden: beginbalansResultaat.reden });
      }
      continue;
    }

    const saldo = beginbalansResultaat.waarde.plus(mutatie);
    const balanszijdeResultaat = balanszijdeVoorRegel(mappingResultaat.waarde);
    if (balanszijdeResultaat.type === "onbekend") {
      if (!saldo.isZero()) {
        controleVereist.push({ grootboekrekening, saldo, reden: balanszijdeResultaat.reden });
      }
      continue;
    }

    posten.push({
      grootboekrekening,
      omschrijving: standRow?.rekeningOmschrijving ?? null,
      rapportagecategorie: balanszijdeResultaat.waarde,
      saldo,
    });
  }

  posten.sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));
  controleVereist.sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));

  const activaTotaal = rapportregelsom(posten.filter((p) => p.rapportagecategorie === "ACTIVA").map((p) => p.saldo));
  const passivaTotaal = rapportregelsom(posten.filter((p) => p.rapportagecategorie === "PASSIVA").map((p) => p.saldo));
  const categorieTotalen: BalansPeriodeCategorieTotaal[] = [
    { rapportagecategorie: "ACTIVA", bedrag: activaTotaal },
    { rapportagecategorie: "PASSIVA", bedrag: passivaTotaal },
  ];

  const verschil = activaTotaal.plus(passivaTotaal).plus(resultaatTotaal);
  const aansluiting: BalansAansluitingscontrole = {
    activaTotaal,
    passivaTotaal,
    resultaatTotaal,
    verschil,
    sluitBinnenTolerantie: verschil.abs().lessThanOrEqualTo(toleranceEuro),
  };

  return { posten, categorieTotalen, controleVereist, aansluiting };
}
