import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de module-brede Niet-Verrekenbare-BTW-staat (Vervolgtranche 9 Deel B) —
 * `beoordeeld` + `vorigJaarWerkelijk` (de puur informatieve voorstelbron, Master Contract:
 * "voorstel mag gebaseerd zijn op Werkelijk vorig jaar"). Exact hetzelfde patroon als
 * `geplandeVerkoopBeoordeeld.ts`, uitgebreid met het informatieve voorstelveld — een eigen
 * bestand, gescheiden van `nietVerrekenbareBtwRegels.ts`: regel-writes raken deze staat nooit,
 * en deze staat raakt regels nooit.
 *
 * "Geen rij" betekent exact hetzelfde als "rij met beoordeeld=0, vorigJaarWerkelijk=NULL" —
 * `leesNietVerrekenbareBtwState` geeft daarom altijd een compleet object terug, nooit `null`.
 */

export interface NietVerrekenbareBtwState {
  beoordeeld: boolean;
  vorigJaarWerkelijk: Decimal | null;
}

const LEGE_STATE: NietVerrekenbareBtwState = { beoordeeld: false, vorigJaarWerkelijk: null };

/** Leest de staat voor één begrotingsversie. Geen rij (nog nooit expliciet beoordeeld, of versie bestaat niet) → de lege staat. */
export function leesNietVerrekenbareBtwState(db: DatabaseSync, versieId: string): NietVerrekenbareBtwState {
  const row = db.prepare(`SELECT beoordeeld, vorig_jaar_werkelijk FROM begroting_niet_verrekenbare_btw_module WHERE begroting_versie_id = ?`).get(versieId) as
    | { beoordeeld: number; vorig_jaar_werkelijk: string | null }
    | undefined;
  if (row === undefined) return LEGE_STATE;
  return { beoordeeld: row.beoordeeld === 1, vorigJaarWerkelijk: row.vorig_jaar_werkelijk !== null ? new Decimal(row.vorig_jaar_werkelijk) : null };
}

/** Schrijft (of vervangt) de complete staat voor één begrotingsversie. Faalt vóór elke mutatie als de parent niet bestaat of geen CONCEPT is. */
export function schrijfNietVerrekenbareBtwState(db: DatabaseSync, versieId: string, state: NietVerrekenbareBtwState): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — de Niet-Verrekenbare-BTW-staat mag uitsluitend op een CONCEPT-versie worden geschreven.`);
  }
  if (state.vorigJaarWerkelijk !== null && state.vorigJaarWerkelijk.isNaN()) {
    throw new Error(`Begrotingsversie ${versieId}: vorigJaarWerkelijk is een ongeldig (NaN) bedrag — operatie geweigerd.`);
  }

  db.prepare(
    `INSERT INTO begroting_niet_verrekenbare_btw_module (begroting_versie_id, beoordeeld, vorig_jaar_werkelijk)
     VALUES (?, ?, ?)
     ON CONFLICT (begroting_versie_id) DO UPDATE SET beoordeeld = excluded.beoordeeld, vorig_jaar_werkelijk = excluded.vorig_jaar_werkelijk`,
  ).run(versieId, state.beoordeeld ? 1 : 0, state.vorigJaarWerkelijk !== null ? state.vorigJaarWerkelijk.toString() : null);
}
