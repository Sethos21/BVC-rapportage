import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgContractOverride, BgOverrideScope } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor `BgContractOverride[]` — Module-1-contractoverrides.
 * BEWUST geen unieke constraint op `(begroting_versie_id, contractnummer)`:
 * meerdere overrides voor hetzelfde contract binnen dezelfde versie zijn op
 * databaseniveau toegestaan, zodat de bestaande pure Module-1-validatie
 * (dubbele overrides detecteren + melden, alleen de eerste toepassen)
 * daadwerkelijk iets te valideren blijft houden — persistence mag die
 * business-/validatielogica niet vóór zijn.
 */

/** Kleine, herbruikbare transactie-helper — zelfde patroon als `module1Snapshot.ts` (bewust hier gedupliceerd, zie migratie-4-rapport). */
function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const resultaat = fn();
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

interface OverrideRow {
  contractnummer: string;
  indexatie_percentage: string;
  scope: string;
  reden: string | null;
}

/**
 * Schrijft een COMPLETE set Module-1-overrides voor één begrotingsversie,
 * atomair (vervangt — geen gedeeltelijke/append-route). Faalt vóór de
 * transactie als de parent niet bestaat of geen CONCEPT is. Doet GEEN
 * duplicate-validatie op `contractnummer` — dat blijft bewust exclusief de
 * taak van de pure Module-1-laag bij herberekening.
 */
export function schrijfModule1Overrides(db: DatabaseSync, versieId: string, overrides: readonly BgContractOverride[]): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — Module-1-overrides mogen uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  withTransaction(db, () => {
    db.prepare(`DELETE FROM begroting_contract_override WHERE begroting_versie_id = ?`).run(versieId);

    const insert = db.prepare(
      `INSERT INTO begroting_contract_override (begroting_versie_id, contractnummer, indexatie_percentage, scope, reden)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const override of overrides) {
      insert.run(versieId, override.contractnummer, override.indexatiePercentage.toString(), override.scope, override.reden ?? null);
    }
  });
}

/**
 * Leest de Module-1-overrides voor een begrotingsversie, op technische
 * insertievolgorde (`id`) — geen businessbetekenis, uitsluitend een
 * deterministische leesvolgorde.
 *
 * `reden` wordt exact volgens de HEAD-semantiek van `BgContractOverride`
 * gereconstrueerd: het veld is `reden?: string` (optioneel, GEEN `string |
 * null`) — bij een NULL-waarde in de database wordt de sleutel `reden`
 * volledig WEGGELATEN uit het teruggegeven object (niet op `undefined`
 * gezet), want onder `exactOptionalPropertyTypes` is dat een echt, door de
 * typechecker afgedwongen verschil met "aanwezig maar undefined".
 */
export function leesModule1Overrides(db: DatabaseSync, versieId: string): readonly BgContractOverride[] {
  const rijen = db
    .prepare(`SELECT contractnummer, indexatie_percentage, scope, reden FROM begroting_contract_override WHERE begroting_versie_id = ? ORDER BY id`)
    .all(versieId) as unknown as OverrideRow[];

  return rijen.map((rij): BgContractOverride => ({
    contractnummer: rij.contractnummer,
    indexatiePercentage: new Decimal(rij.indexatie_percentage),
    scope: rij.scope as BgOverrideScope,
    ...(rij.reden !== null ? { reden: rij.reden } : {}),
  }));
}
