import Decimal from "decimal.js";
import type { BalansPeriodePost } from "./balansPeriodeBerekening.js";
import type { OpHuurderRegel, OpResultaat } from "./openstaandePosten.js";

/**
 * Debiteuren/Ouderdomsanalyse-aansluiting (2026-09-23) — DEFINITIEF
 * FUNCTIONEEL BESLUIT, afsluiting van de BRONGATE "Historische
 * Ouderdomsanalyse" (zie packages/reporting/README.md, sectie "Debiteuren
 * / Ouderdomsanalyse — definitief afgerond").
 *
 * Bewezen (echte 070-diagnose, vorderingen_met_afboekingen + saldo_huurders):
 * geen historische openstaand-op-peildatum-reconstructie mogelijk (geen
 * gedeeltelijk-afgeboekte kandidaat, geen kandidaat die op 30-06-2026 al
 * bestond en pas daarna volledig werd afgehandeld) en geen expliciete
 * vervaldatum in de bron — BEIDE blijven bekende, niet-blokkerende
 * BRONGATEN. In plaats van hierop verder bronOnderzoek te doen, wordt de
 * BESTAANDE, bewezen Ouderdomsanalyse (saldo_huurders, via
 * `berekenOpenstaandePosten`) uitsluitend getoond wanneer haar totaal
 * aansluit op de balanspost Debiteuren — de BALANS blijft financieel
 * leidend, de Ouderdomsanalyse is uitsluitend een onderliggende
 * specificatie/controle, nooit een zelfstandige waarheid.
 *
 * Bewust GEEN nieuwe berekening: `balansBedrag` is een simpele optelling
 * van reeds berekende `BalansPeriodePost.saldo`-waarden (tekenconventie
 * al toegepast, uit `berekenBalansPeriode`) voor een EXPLICIET aangeleverde
 * lijst grootboekrekeningen — deze module bepaalt zelf NOOIT welke
 * rekening(en) "Debiteuren" zijn (dat zou een classificatie via een losse
 * lijst in code zijn, CLAUDE.md §6 verbiedt dat); de aanroeper (Worker)
 * levert die lijst uit `AdministratieConfig.debiteurenGrootboekrekeningen`
 * aan, exact hetzelfde patroon als `servicekostenRekeningen`. `buckets` is
 * een pure optelling van de reeds bewezen, nooit zelfberekende
 * saldo_huurders-Informant-buckets per huurder (`OpHuurderRegel.buckets`)
 * — puur informatief bij de specificatie, geen nieuwe ouderdomslogica.
 * Tolerantie hergebruikt exact dezelfde conventie als
 * `berekenBalansPeriode` (€0,01 default).
 */

export interface DebiteurenAansluitingBuckets {
  tm30: Decimal;
  tm60: Decimal;
  tm90: Decimal;
  negentigPlus: Decimal;
  vooruitbetaling: Decimal;
}

export interface DebiteurenAansluitingResultaat {
  balansBedrag: Decimal;
  ouderdomsanalyseBedrag: Decimal;
  verschil: Decimal;
  sluitBinnenTolerantie: boolean;
  buckets: DebiteurenAansluitingBuckets;
}

/** Som van `BalansPeriodePost.saldo` (tekenconventie al toegepast) voor de expliciet aangeleverde rekeningen — geen classificatie, alleen optellen. */
export function somBalansPostenVoorRekeningen(posten: readonly BalansPeriodePost[], grootboekrekeningen: readonly string[]): Decimal {
  const rekeningenSet = new Set(grootboekrekeningen);
  return posten.filter((p) => rekeningenSet.has(p.grootboekrekening)).reduce((som, p) => som.plus(p.saldo), new Decimal(0));
}

/** Som van de reeds bewezen, nooit zelfberekende saldo_huurders-buckets over alle huurders — huurders zonder saldo_huurders-rij (`buckets === null`) tellen mee als 0. */
export function somOuderdomsanalyseBuckets(huurders: readonly OpHuurderRegel[]): DebiteurenAansluitingBuckets {
  let tm30 = new Decimal(0);
  let tm60 = new Decimal(0);
  let tm90 = new Decimal(0);
  let negentigPlus = new Decimal(0);
  let vooruitbetaling = new Decimal(0);
  for (const huurder of huurders) {
    if (huurder.buckets === null) continue;
    tm30 = tm30.plus(huurder.buckets.tm30);
    tm60 = tm60.plus(huurder.buckets.tm60);
    tm90 = tm90.plus(huurder.buckets.tm90);
    negentigPlus = negentigPlus.plus(huurder.buckets.negentigPlus);
    vooruitbetaling = vooruitbetaling.plus(huurder.buckets.vooruitbetaling);
  }
  return { tm30, tm60, tm90, negentigPlus, vooruitbetaling };
}

/**
 * DE aansluitcontrole: balanspost Debiteuren (som van `balansPosten` voor
 * `debiteurenGrootboekrekeningen`) tegenover het beschikbare
 * Ouderdomsanalyse-totaal (`opResultaat.totaalSaldoHuurders`, ongewijzigd
 * uit `berekenOpenstaandePosten`). `sluitBinnenTolerantie` bepaalt of de
 * Ouderdomsanalyse getoond mag worden (zie de Worker-module-registratie).
 */
export function berekenDebiteurenAansluiting(
  balansPosten: readonly BalansPeriodePost[],
  debiteurenGrootboekrekeningen: readonly string[],
  opResultaat: OpResultaat,
  toleranceEuro: Decimal = new Decimal("0.01"),
): DebiteurenAansluitingResultaat {
  const balansBedrag = somBalansPostenVoorRekeningen(balansPosten, debiteurenGrootboekrekeningen);
  const ouderdomsanalyseBedrag = opResultaat.totaalSaldoHuurders;
  const verschil = balansBedrag.minus(ouderdomsanalyseBedrag);
  return {
    balansBedrag,
    ouderdomsanalyseBedrag,
    verschil,
    sluitBinnenTolerantie: verschil.abs().lessThanOrEqualTo(toleranceEuro),
    buckets: somOuderdomsanalyseBuckets(opResultaat.huurders),
  };
}
