import type { OnbekendOf } from "@bvc/domain";
import type { BalansstandRow, BoekingRow, ServicekostenRow } from "./rows.js";

/**
 * Expliciete periodeselectie op de cache-rijen (CLAUDE.md, "periodefilters
 * expliciet maken"): de rapportagelaag mag nooit impliciet de eerste/
 * laatste/willekeurige rij gebruiken wanneer één grootboekrekening meerdere
 * balansstanden/periodewaarden heeft. Elke selectiefunctie hieronder
 * retourneert precies de rijen die aan de opgegeven, expliciete criteria
 * voldoen — nooit een impliciete keuze uit meerdere kandidaten.
 */

export interface BoekingenSelectieCriteria {
  bedrijfsnr: string;
  boekjaar: number;
  /**
   * Inclusieve boekperiode-range (bv. "01".."06" voor periode 1 t/m 6).
   * Beide grenzen optioneel; zonder opgave gelden alle boekperioden binnen
   * het boekjaar — dat is een expliciete keuze van de aanroeper ("heel het
   * boekjaar"), geen impliciete fallback.
   */
  boekperiodeVan?: string | undefined;
  boekperiodeTotEnMet?: string | undefined;
  grootboekrekening?: string | undefined;
}

/**
 * Selecteert boekingen op administratie (bedrijfsnr) + boekjaar + optionele
 * boekperiode-range + optionele grootboekrekening. Geschikt voor P&L-achtige
 * selecties zoals "boekjaar 2026 periode 1 t/m 6" of "boekjaar 2025 periode
 * 1 t/m 6" (CLAUDE.md-opdracht, voorbeeld 1/2). Boekperiodes zijn
 * 2-cijferige strings ("01".."12"); lexicografische vergelijking is hier
 * geldig omdat alle broncontracten deze vaste breedte al garanderen.
 */
export function selecteerBoekingen(rows: readonly BoekingRow[], criteria: BoekingenSelectieCriteria): BoekingRow[] {
  return rows.filter((row) => {
    if (row.bedrijfsnr !== criteria.bedrijfsnr) return false;
    if (row.boekjaar !== criteria.boekjaar) return false;
    if (criteria.boekperiodeVan !== undefined && row.boekperiode < criteria.boekperiodeVan) return false;
    if (criteria.boekperiodeTotEnMet !== undefined && row.boekperiode > criteria.boekperiodeTotEnMet) return false;
    if (criteria.grootboekrekening !== undefined && row.grootboeknr !== criteria.grootboekrekening) return false;
    return true;
  });
}

export interface ServicekostenSelectieCriteria {
  bedrijfsnr: string;
  boekjaar: number;
  /** Zelfde betekenis/inclusiviteit als bij `BoekingenSelectieCriteria` — beide grenzen optioneel. */
  boekperiodeVan?: string | undefined;
  boekperiodeTotEnMet?: string | undefined;
}

/**
 * Selecteert servicekostenregels op administratie (bedrijfsnr) + boekjaar +
 * optionele boekperiode-range — zelfde patroon en boekperiode-vergelijking
 * (lexicografisch, 2-cijferige strings) als `selecteerBoekingen`. De
 * servicekosten-cachetabel draagt dezelfde `boekjaar`/`boekperiode`-velden,
 * dus deze selectie kent geen aparte beperking (in tegenstelling tot
 * `selecteerBalansOpBoekperiode`).
 */
export function selecteerServicekosten(rows: readonly ServicekostenRow[], criteria: ServicekostenSelectieCriteria): ServicekostenRow[] {
  return rows.filter((row) => {
    if (row.bedrijfsnr !== criteria.bedrijfsnr) return false;
    if (row.boekjaar !== criteria.boekjaar) return false;
    if (criteria.boekperiodeVan !== undefined && row.boekperiode < criteria.boekperiodeVan) return false;
    if (criteria.boekperiodeTotEnMet !== undefined && row.boekperiode > criteria.boekperiodeTotEnMet) return false;
    return true;
  });
}

export interface BalansstandenSelectieCriteria {
  bedrijfsnr: string;
  jaar: number;
  grootboekrekening?: string;
}

/**
 * Selecteert balansstanden op administratie (bedrijfsnr) + boekjaar +
 * optionele grootboekrekening.
 *
 * BELANGRIJKE BEPERKING: de cache (`balansstanden`-tabel, PRIMARY KEY
 * bedrijfsnr+jaar+grootboekrekeningnr) bevat per grootboekrekening één
 * `eindsaldo` per jaar, zonder peildatum-kolom. Deze functie geeft dat
 * `eindsaldo` terug zoals de bron het levert — voor een afgesloten
 * historisch boekjaar is dat vermoedelijk het jaareindsaldo, maar voor een
 * nog lopend boekjaar (zoals het huidige) is niet vanuit de rij zelf af te
 * leiden op welke boekperiode/datum dat saldo daadwerkelijk betrekking
 * heeft. Gebruik deze functie dus nooit om een claim te doen over "saldo op
 * peildatum X" — daarvoor is een bevestigde peildatum/boekperiode-kolom in
 * de bron/cache nodig (nog niet aanwezig, zie `selecteerBalansOpBoekperiode`).
 */
export function selecteerBalansstanden(rows: readonly BalansstandRow[], criteria: BalansstandenSelectieCriteria): BalansstandRow[] {
  return rows.filter((row) => {
    if (row.bedrijfsnr !== criteria.bedrijfsnr) return false;
    if (row.jaar !== criteria.jaar) return false;
    if (criteria.grootboekrekening !== undefined && row.grootboekrekeningnr !== criteria.grootboekrekening) return false;
    return true;
  });
}

export interface BalansOpBoekperiodeCriteria {
  bedrijfsnr: string;
  jaar: number;
  boekperiode: string;
  grootboekrekening?: string;
}

/**
 * Balans op een specifieke boekperiode binnen een jaar (bv. "balans einde
 * periode 6 van 2026" — CLAUDE.md-opdracht, voorbeeld 3). BEKEND, NOG NIET
 * OPGELOST GAT: de bron bevat wel 15 periodeparen debet/credit
 * (zie `packages/data-contracts/src/sources/balans.ts`), maar die zijn nog
 * niet individueel in het cache-schema gemodelleerd (`balansstanden` heeft
 * alleen een jaar-kolom, geen boekperiode-kolom) — dat vereist een
 * Worker-cache-schemawijziging, expliciet buiten scope van deze bouwstap
 * ("Worker-importarchitectuur wijzigen" stond niet op de opdracht).
 *
 * Geeft daarom altijd `onbekend` terug — nooit stilzwijgend het
 * jaareindsaldo (`selecteerBalansstanden`) als vervanging gebruiken, dat zou
 * een aanname over de peildatum zijn (CLAUDE.md §6, "Controle vereist").
 * De functie bestaat wél al zodat toekomstige rapportcode één vaste,
 * expliciete ingang heeft voor deze selectie, met een duidelijke reden
 * waarom hij nu nog niets kan opleveren.
 */
export function selecteerBalansOpBoekperiode(
  _rows: readonly BalansstandRow[],
  _criteria: BalansOpBoekperiodeCriteria,
): OnbekendOf<BalansstandRow[]> {
  return {
    type: "onbekend",
    reden:
      "Balans op een specifieke boekperiode binnen het jaar wordt nog niet ondersteund: de cache bevat alleen het jaareindsaldo per grootboekrekening, geen saldo per boekperiode. Vereist een Worker-cache-schemawijziging (buiten scope van deze bouwstap) — Controle vereist, geen aanname op basis van het jaareindsaldo.",
  };
}
