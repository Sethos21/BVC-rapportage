import Decimal from "decimal.js";
import type { Balanszijde, GrootboekMappingRegel, Tekenconventie } from "@bvc/config";
import {
  balanszijdeVoorRegel,
  boekingSaldo,
  herkomstVoorRekening,
  presentatiefactorVoorRegel,
  rapportregelsom,
  resolveerGrootboekMapping,
  zoekMappingRegel,
  type Balansstand,
  type Boekingsregel,
  type MappingHerkomst,
  type OnbekendOf,
} from "@bvc/domain";

/**
 * Balans-periodeberekening op een expliciet al-geselecteerde periode
 * boekingen (zie `@bvc/cache`'s `selecteerBoekingen` — periodeselectie
 * gebeurt daar, niet hier) plus de beginbalans per rekening (jaarstand bij
 * boekjaarbegin), de goedgekeurde grootboekmapping (master + administratie-
 * override, apart aangeleverd — zie "Herkomst" hieronder), en het netto
 * P&L-resultaat van het huidige boekjaar (van buitenaf aangeleverd — zie
 * `resultaatHuidigBoekjaar` hieronder). Bewust ALLEEN de rekenlaag: geen
 * renderer/HTML, geen eigen periodeselectie- of mappinglogica.
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
 * DRIE onafhankelijke concepten (ontwerpcorrectie 2026-08-20, na een echte
 * productie-run — zie packages/reporting/README.md):
 * 1. `balanszijde` (ACTIVA/PASSIVA) — een VASTE eigenschap van de
 *    grootboekrekening zelf (`@bvc/config`'s `BalansRegel.balanszijde`),
 *    NOOIT afgeleid uit het actuele teken van het berekende saldo. Bepaalt
 *    uitsluitend in welke tabel een rekening verschijnt.
 * 2. Het werkelijk berekende saldo (beginbalans + mutaties), debet - credit
 *    — de rauwe boekhoudkundige waarheid, ongewijzigd (`ruwSaldo`
 *    hieronder).
 * 3. `tekenconventie` (ZOALS_BRON/OMGEKEERD, ook op `BalansRegel` — apart
 *    veld van `balanszijde`) — bepaalt hoe (2) binnen (1) GETOOND wordt
 *    (`saldo`/rapportageBedrag hieronder). Bewust GEEN generieke
 *    tekenomkering per balanszijde (bv. "alle Passiva negatief"): sommige
 *    PASSIVA-rekeningen horen positief te tonen (bv. Crediteuren, een
 *    schuld), andere negatief (bv. Onttrekkingen, die het eigen vermogen
 *    verminderen) — dat verschil zit per rekening in `tekenconventie`,
 *    nooit in een formule op `balanszijde`.
 * Beide (1) en (3) zijn onafhankelijk nullable: `null` = nog niet
 * bevestigd, nooit geraden — de rekening komt dan in `controleVereist`.
 *
 * Herkomst (voorbereiding op de toekomstige interactieve balansrapportage,
 * nog niet gebouwd): elke `BalansPeriodePost`/`BalansPeriodeControleVereist`
 * draagt `herkomst` (`@bvc/domain`'s `MappingHerkomst`) — komt de
 * classificatie uit de centrale master, de administratie-eigen override, of
 * is de rekening nergens gemapt. Vandaar dat deze functie `master` en
 * `override` APART aanneemt (niet al samengevoegd via
 * `resolveerGrootboekMapping`, hoewel die intern wel gebruikt wordt voor de
 * daadwerkelijke classificatie) — zonder die scheiding kan de herkomst niet
 * worden bepaald. Een toekomstige per-rapport correctielaag
 * (`RAPPORT_OVERRIDE`, nog niet gebouwd) kan hier later bovenop: die zou
 * vóór de classificatie-lookup een eigen, apart opgeslagen wijziging
 * toepassen, ZONDER de brondata (`boekingen`/`balansstanden`) of de
 * master/override-bestanden zelf aan te raken — een rapport-only correctie
 * mag nooit automatisch de master aanpassen.
 */

export type BalansRapportageCategorie = Balanszijde;

export interface BalansPeriodePost {
  grootboekrekening: string;
  /** Rechtstreeks uit de bron (Rekening_omschrijving) — geen classificatie, alleen doorgegeven tekst. */
  omschrijving: string | null;
  /**
   * De vaste balanszijde uit de grootboekmapping (nooit het saldoteken) —
   * zie moduledoc hierboven. Identiek aan `rapportagecategorie`.
   */
  rapportagecategorie: BalansRapportageCategorie;
  /** Werkelijk berekend saldo (beginbalans + mutaties t/m de opgegeven periode), debet - credit — VÓÓR tekenconventie, de rauwe boekhoudkundige waarheid. */
  ruwSaldo: Decimal;
  /** De rekening-eigen presentatieconventie die op `ruwSaldo` is toegepast om `saldo` te krijgen. Nooit `null` hier — een onbevestigde tekenconventie blokkeert deze post (zie `controleVereist`). */
  tekenconventie: Tekenconventie;
  /**
   * Het GETOONDE bedrag (= rapportageBedrag): `ruwSaldo` MET `tekenconventie`
   * toegepast (CAL-FIN-002-achtig, zie `presentatiefactorVoorRegel`). Kan
   * negatief zijn op een normaal positieve balanszijde (bv. een
   * vooruitbetalende debiteur op Activa) — bewust niet verborgen. Dit
   * teken, samen met `rapportagecategorie`, is precies de structuur die
   * een latere balanstoelichting nodig heeft om bijzondere gevallen te
   * signaleren — die toelichtingslogica wordt hier bewust nog niet
   * gebouwd.
   */
  saldo: Decimal;
  /** Herkomst van de balanszijde/tekenconventie-classificatie — zie moduledoc "Herkomst". */
  herkomst: MappingHerkomst;
}

export interface BalansPeriodeCategorieTotaal {
  rapportagecategorie: BalansRapportageCategorie;
  bedrag: Decimal;
}

export interface BalansPeriodeControleVereist {
  grootboekrekening: string;
  /**
   * Het best bekende bedrag voor deze rekening: het volledige (rauwe)
   * saldo (beginbalans + mutatie) als een beginbalans bepaalbaar was —
   * ook voor een volledig onbekende/ongemapte rekening, zodat een grote
   * stilstaande beginbalans (0 mutatie deze periode) nooit stilzwijgend
   * buiten beeld blijft — anders de rauwe mutatie in de periode
   * (debet - credit) als zelfs het saldo niet bepaald kon worden. Nooit
   * met een geraden tekenconventie gepresenteerd.
   */
  saldo: Decimal;
  reden: string;
  /** Herkomst van de (onvolledige of ontbrekende) classificatie — zie moduledoc "Herkomst". */
  herkomst: MappingHerkomst;
}

export interface BalansAansluitingscontrole {
  /** Som van alle Activa-posten (getoonde bedragen, SIGNED) — bewust geen abs(). */
  activaTotaal: Decimal;
  /** Som van alle Passiva-posten (getoonde bedragen, SIGNED) — bewust geen abs(). */
  passivaTotaal: Decimal;
  /**
   * Netto resultaat van het huidige boekjaar t/m de opgegeven periode, van
   * buitenaf aangeleverd (@bvc/reporting's `berekenPlPeriode` +
   * `berekenNettoResultaat`) — hiervoor bestaat geen eigen
   * grootboekrekening, het is een afgeleid P&L-bedrag (twee outputs van
   * dezelfde rekenlaag, CLAUDE.md §2). `onbekend` als de P&L-kant het zelf
   * nog niet kan bepalen (bv. een categorie zonder bevestigd optel-/
   * aftrekteken) — nooit als 0 aangenomen.
   */
  resultaatHuidigBoekjaar: OnbekendOf<Decimal>;
  /**
   * De standaard balansvergelijking: activaTotaal - passivaTotaal -
   * resultaatHuidigBoekjaar, hoort ~0 te zijn (Activa = Passiva + Resultaat
   * huidig boekjaar). `onbekend` als `resultaatHuidigBoekjaar` dat is —
   * dan is de aansluiting simpelweg niet te bepalen, nooit een gok.
   */
  verschil: OnbekendOf<Decimal>;
  /** `false` als `verschil` zelf onbekend is — een onbekende aansluiting is nooit stilzwijgend "sluitend". */
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
  master: readonly GrootboekMappingRegel[],
  override: readonly GrootboekMappingRegel[],
  resultaatHuidigBoekjaar: OnbekendOf<Decimal>,
  toleranceEuro: Decimal = new Decimal("0.01"),
): BalansPeriodeResultaat {
  const mappingRegels = resolveerGrootboekMapping(master, override);

  const mutatiePerRekening = new Map<string, Decimal>();
  for (const boeking of boekingen) {
    const saldo = boekingSaldo(boeking);
    mutatiePerRekening.set(boeking.grootboeknr, (mutatiePerRekening.get(boeking.grootboeknr) ?? new Decimal(0)).plus(saldo));
  }

  const standPerRekening = new Map(balansstanden.map((stand) => [stand.grootboekrekeningnr, stand]));
  const alleRekeningen = new Set<string>([...standPerRekening.keys(), ...mutatiePerRekening.keys()]);

  const posten: BalansPeriodePost[] = [];
  const controleVereist: BalansPeriodeControleVereist[] = [];

  for (const grootboekrekening of alleRekeningen) {
    const mutatie = mutatiePerRekening.get(grootboekrekening) ?? new Decimal(0);
    const standRow = standPerRekening.get(grootboekrekening);
    const mappingResultaat = zoekMappingRegel(mappingRegels, grootboekrekening);
    const herkomst = herkomstVoorRekening(master, override, grootboekrekening);

    if (mappingResultaat.type === "onbekend") {
      // Best bekende bedrag: beginbalans (indien bepaalbaar) + mutatie — nooit alleen de mutatie, anders
      // blijft een rekening met een grote, stilstaande beginbalans (0 mutatie deze periode) stilzwijgend
      // buiten beeld, terwijl die wél meetelt in de balans (CLAUDE.md §6).
      const beginbalansResultaatOnbekend = beginbalansSaldo(standRow);
      const bestBekendSaldo = beginbalansResultaatOnbekend.type === "bekend" ? beginbalansResultaatOnbekend.waarde.plus(mutatie) : mutatie;
      if (!bestBekendSaldo.isZero() || standRow !== undefined) {
        controleVereist.push({ grootboekrekening, saldo: bestBekendSaldo, reden: mappingResultaat.reden, herkomst });
      }
      continue;
    }

    if (mappingResultaat.waarde.soort === "RESULTAAT") {
      // Bekend, bewust buiten de balans (hoort in de P&L — @bvc/reporting's berekenPlPeriode).
      continue;
    }

    const beginbalansResultaat = beginbalansSaldo(standRow);
    if (beginbalansResultaat.type === "onbekend") {
      if (!mutatie.isZero() || standRow !== undefined) {
        controleVereist.push({ grootboekrekening, saldo: mutatie, reden: beginbalansResultaat.reden, herkomst });
      }
      continue;
    }

    const ruwSaldo = beginbalansResultaat.waarde.plus(mutatie);

    const balanszijdeResultaat = balanszijdeVoorRegel(mappingResultaat.waarde);
    if (balanszijdeResultaat.type === "onbekend") {
      if (!ruwSaldo.isZero()) {
        controleVereist.push({ grootboekrekening, saldo: ruwSaldo, reden: balanszijdeResultaat.reden, herkomst });
      }
      continue;
    }

    const factorResultaat = presentatiefactorVoorRegel(mappingResultaat.waarde);
    if (factorResultaat.type === "onbekend") {
      if (!ruwSaldo.isZero()) {
        controleVereist.push({ grootboekrekening, saldo: ruwSaldo, reden: factorResultaat.reden, herkomst });
      }
      continue;
    }

    posten.push({
      grootboekrekening,
      omschrijving: standRow?.rekeningOmschrijving ?? null,
      rapportagecategorie: balanszijdeResultaat.waarde,
      ruwSaldo,
      tekenconventie: mappingResultaat.waarde.tekenconventie as Tekenconventie,
      saldo: ruwSaldo.times(factorResultaat.waarde),
      herkomst,
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

  const verschil: OnbekendOf<Decimal> =
    resultaatHuidigBoekjaar.type === "onbekend"
      ? { type: "onbekend", reden: `Resultaat huidig boekjaar onbekend: ${resultaatHuidigBoekjaar.reden}` }
      : { type: "bekend", waarde: activaTotaal.minus(passivaTotaal).minus(resultaatHuidigBoekjaar.waarde) };

  const aansluiting: BalansAansluitingscontrole = {
    activaTotaal,
    passivaTotaal,
    resultaatHuidigBoekjaar,
    verschil,
    sluitBinnenTolerantie: verschil.type === "bekend" && verschil.waarde.abs().lessThanOrEqualTo(toleranceEuro),
  };

  return { posten, categorieTotalen, controleVereist, aansluiting };
}
