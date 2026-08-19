import type Decimal from "decimal.js";
import type { BalansPeriodeResultaat } from "./balansPeriodeBerekening.js";

/**
 * Invoer voor de P&L-exploitatierapportage per vastgoedobject
 * (FinancieelRapport-scope: CLAUDE.md-sjabloon, testcase object 070
 * "Rooise Zoom"). Bedragen zijn al op centrale, geldige bronnen gebaseerd
 * — deze module rekent zelf niets uit de ruwe bron, alleen met reeds
 * gevalideerde jaarcijfers.
 */

export interface PLPost {
  naam: string;
  bedrag: Decimal;
}

export interface PLJaarcijfers {
  jaar: number;
  huurinkomstenPerEenheid: PLPost[];
  kostenPerCategorie: PLPost[];
  /** Vrije toelichting per jaar, optioneel. */
  toelichting?: string;
}

export interface PLRapportInvoer {
  objectnaam: string;
  objectnummer: string;
  jaren: PLJaarcijfers[];
}

/**
 * Invoer voor sectie "01 — Kerncijfers" (KPI-dashboard), zie
 * `legacy/index.html`'s `renderOverzicht` (bevestigde spec, packages/reporting/README.md).
 * Alle bedragen en m²-waarden zijn al gevalideerde/opgetelde cijfers —
 * mutaties/percentages worden in `kerncijfers.ts` berekend, niet hier.
 */

/** KPI met een huidige waarde en de waarde van de vergelijkingsperiode (bv. vorig jaar). */
export interface KpiWaarde {
  waarde: Decimal;
  vorig: Decimal;
}

export interface UitbetalingsratioKpi {
  /** Fractie 0–1 (niet al ×100). */
  waarde: Decimal;
  /** Norm-fractie 0–1, bv. 0.85 voor "norm < 85%". */
  norm: Decimal;
}

export interface BankstandKpi {
  waarde: Decimal;
  streefwaarde: Decimal;
}

export interface KerncijfersKpis {
  huurinkomen: KpiWaarde;
  ebitda: KpiWaarde;
  uitbetalingsratio: UitbetalingsratioKpi;
  bankstand: BankstandKpi;
  debiteuren: KpiWaarde;
  /** Positief = tekort (kosten > voorschotten), negatief/nul = overschot. */
  servicekostenSaldo: Decimal;
}

export interface HuurKwartaalPunt {
  jaar: number;
  /** Weergavelabel voor de balk, bv. "Q2 2026". */
  label: string;
  waarde: Decimal;
}

export interface HuurComplexRegel {
  naam: string;
  waarde: Decimal;
  vorig: Decimal;
}

export interface BezettingComplexRegel {
  complex: string;
  verhuurdM2: Decimal;
  totaalM2: Decimal;
}

export interface KerncijfersInvoer {
  portefeuilleNaam: string;
  periodeLabel: string;
  kpis: KerncijfersKpis;
  huurPerKwartaal: HuurKwartaalPunt[];
  huurPerComplex: HuurComplexRegel[];
  bezettingPerComplex?: BezettingComplexRegel[] | undefined;
}

/**
 * Invoer voor het Controlerapport — een rauw, ongemapt brondata-overzicht
 * (trial-balance-stijl) rechtstreeks uit de cache, bedoeld om regel-voor-
 * regel te vergelijken met een bestaande rapportage. Bewust GEEN
 * grootboekmapping toegepast (die bestaat nog niet — zie root-README) en
 * bewust GEEN servicekosten-uitsluitingsregels (kostensoort 9600 e.d.):
 * dit rapport dient reconciliatie van de ingelezen brondata, niet een
 * inhoudelijke KPI-analyse. Alle acht brontypen zijn optioneel — een
 * ontbrekende/nog niet geladen bron blokkeert het rapport nooit, toont
 * alleen een duidelijke melding in die sectie.
 */
export interface ControlerapportBoekingsregel {
  grootboeknr: string;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
}

export interface ControlerapportBalansregel {
  grootboekrekeningnr: string;
  omschrijving: string | null;
  eindsaldo: Decimal;
}

export interface ControlerapportServicekostenregel {
  kostensoort: string;
  omschrijving: string | null;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
}

export interface ControlerapportContractregel {
  contract: string;
  complexnummer: string | null;
  unitnummer: string | null;
  huurdernummer: string | null;
}

export interface ControlerapportUnitregel {
  complexnummer: string;
  unitnummer: string;
  omschrijving: string | null;
  vvo: Decimal | null;
}

export interface ControlerapportRentrollregel {
  contractnummer: string;
  complexnummer: string | null;
  prolongatieBedragJaar: Decimal | null;
  gehuurdOppervlak: Decimal | null;
}

export interface ControlerapportComplexTotaalregel {
  complexnr: string;
  totaalOppervlakte: Decimal | null;
  totaalVerhuurd: Decimal | null;
  totaalLeegstand: Decimal | null;
}

export interface ControlerapportInvoer {
  administratieNaam: string;
  bedrijfsnr: string;
  gegenereerdOp: Date;
  boekingen: ControlerapportBoekingsregel[];
  balansstanden: ControlerapportBalansregel[];
  servicekosten: ControlerapportServicekostenregel[];
  contracten: ControlerapportContractregel[];
  units: ControlerapportUnitregel[];
  rentroll: ControlerapportRentrollregel[];
  complexTotalen: ControlerapportComplexTotaalregel[];
  /** false = tabel is leeg omdat de bron nog niet geladen is (bv. ouderdomsanalyse zonder boekjaar/boekperiode/peildatum). */
  ouderdomsanalyseGeladen: boolean;
  /** false = begroting staat nog niet gekoppeld aan de cache (nog geen cache-tabel) — nooit blokkerend. */
  begrotingGeladen: boolean;
}

/**
 * Invoer voor de balans-periodesectie: de al-berekende
 * `BalansPeriodeResultaat` (@bvc/reporting's `berekenBalansPeriode`) plus
 * de weergavecontext (administratie, peildatum). Rendert alleen — rekent
 * niets uit (zie balansPeriodeBerekening.ts / renderBalansPeriode.ts).
 */
export interface BalansPeriodeInvoer {
  administratieNaam: string;
  bedrijfsnr: string;
  boekjaar: number;
  boekperiodeTotEnMet: string;
  gegenereerdOp: Date;
  resultaat: BalansPeriodeResultaat;
}
