import Decimal from "decimal.js";
import type { GrootboekMappingRegel } from "@bvc/config";
import { boekingSaldo, rapportregelsom, zoekMappingRegel, type Balansstand, type Boekingsregel, type OnbekendOf } from "@bvc/domain";

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
 * boekperiode-kolom die niet in de cache bestaat.
 *
 * Activa/Passiva wordt NIET geraden op basis van rekeningomschrijving
 * (CLAUDE.md §6/§3) — dat zou een nieuwe grootboekmapping-classificatie
 * zijn, expliciet buiten scope van deze bouwstap. In plaats daarvan is de
 * indeling zuiver structureel, op basis van de netto debet/credit-aard van
 * het saldo (CLAUDE.md's eigen regel: "debet/credit blijven gescheiden" is
 * precies de technische definitie van activa- vs. passivazijde in
 * boekhouding — een netto-debetsaldo is Activa, een netto-creditsaldo is
 * Passiva).
 */

export type BalansRapportageCategorie = "Activa" | "Passiva";

export interface BalansPeriodePost {
  grootboekrekening: string;
  /** Rechtstreeks uit de bron (Rekening_omschrijving) — geen classificatie, alleen doorgegeven tekst. */
  omschrijving: string | null;
  /** Structureel bepaald op basis van het netto debet/credit-saldo, zie moduledoc hierboven. */
  rapportagecategorie: BalansRapportageCategorie;
  /** Netto saldo op de peildatum (beginbalans + mutaties t/m de opgegeven periode), debet - credit. */
  saldo: Decimal;
}

export interface BalansPeriodeCategorieTotaal {
  rapportagecategorie: BalansRapportageCategorie;
  bedrag: Decimal;
}

export interface BalansPeriodeControleVereist {
  grootboekrekening: string;
  /** Rauwe mutatie in de periode (debet - credit), ONGEWIJZIGD — het volledige saldo kon niet betrouwbaar bepaald worden, zie reden. */
  saldo: Decimal;
  reden: string;
}

export interface BalansAansluitingscontrole {
  /** Som van alle Activa-posten (netto-debetsaldo's, elk >= 0). */
  activaTotaal: Decimal;
  /** Som van alle Passiva-posten, SIGNED (netto-creditsaldo's, elk <= 0) — bewust geen abs(), zie moduledoc. */
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
    const rapportagecategorie: BalansRapportageCategorie = saldo.isNegative() ? "Passiva" : "Activa";
    posten.push({
      grootboekrekening,
      omschrijving: standRow?.rekeningOmschrijving ?? null,
      rapportagecategorie,
      saldo,
    });
  }

  posten.sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));
  controleVereist.sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));

  const activaTotaal = rapportregelsom(posten.filter((p) => p.rapportagecategorie === "Activa").map((p) => p.saldo));
  const passivaTotaal = rapportregelsom(posten.filter((p) => p.rapportagecategorie === "Passiva").map((p) => p.saldo));
  const categorieTotalen: BalansPeriodeCategorieTotaal[] = [
    { rapportagecategorie: "Activa", bedrag: activaTotaal },
    { rapportagecategorie: "Passiva", bedrag: passivaTotaal },
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
