import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgBeheerComplexConfig } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor `BgBeheerComplexConfig[]` — Module-2-complexconfiguratie.
 * BEWUST geen unieke constraint op `(begroting_versie_id, complexnummer)`:
 * meerdere configs voor hetzelfde complex binnen dezelfde versie zijn op
 * databaseniveau toegestaan, zodat de bestaande pure Module-2-validatie
 * (meervoudige config per complex = KRITIEK, niet berekend) daadwerkelijk
 * iets te valideren blijft houden.
 */

/** Kleine, herbruikbare transactie-helper — zelfde patroon als `module1Snapshot.ts`/`module1Overrides.ts` (bewust hier gedupliceerd, zie migratie-4-rapport). */
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

/**
 * Businessdatum ↔ kale `YYYY-MM-DD` (UTC-kalenderdag). Dit is de DERDE plek
 * met exact deze conversie (na `begrotingsversies.ts` en
 * `module1Snapshot.ts`) — bewust nog steeds hier gedupliceerd i.p.v.
 * geëxtraheerd naar een gedeelde util, om die twee al-goedgekeurde
 * bestanden niet aan te hoeven raken voor deze fase (zie migratie-4-rapport,
 * dezelfde afweging als in 1D.3).
 */
function formatBusinessDate(date: Date): string {
  const jaar = date.getUTCFullYear().toString().padStart(4, "0");
  const maand = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dag = date.getUTCDate().toString().padStart(2, "0");
  return `${jaar}-${maand}-${dag}`;
}

function parseBusinessDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`Ongeldige businessdatum uit persistence: "${value}" (verwacht YYYY-MM-DD).`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

interface ComplexConfigRow {
  complexnummer: string;
  vast_bedrag_jaar: string | null;
  vast_indexatie_percentage: string | null;
  vast_indexatiedatum: string | null;
  variabel_percentage: string | null;
}

/**
 * Schrijft een COMPLETE set Module-2-complexconfiguraties voor één
 * begrotingsversie, atomair (vervangt). Faalt vóór de transactie als de
 * parent niet bestaat of geen CONCEPT is. Doet GEEN duplicate-validatie op
 * `complexnummer` — dat blijft bewust exclusief de taak van de pure
 * Module-2-laag bij herberekening.
 */
export function schrijfModule2Config(db: DatabaseSync, versieId: string, configs: readonly BgBeheerComplexConfig[]): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — Module-2-complexconfiguratie mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  withTransaction(db, () => {
    db.prepare(`DELETE FROM begroting_complex_config WHERE begroting_versie_id = ?`).run(versieId);

    const insert = db.prepare(
      `INSERT INTO begroting_complex_config
         (begroting_versie_id, complexnummer, vast_bedrag_jaar, vast_indexatie_percentage, vast_indexatiedatum, variabel_percentage)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const config of configs) {
      insert.run(
        versieId,
        config.complexnummer,
        config.vastBedragJaar !== null ? config.vastBedragJaar.toString() : null,
        config.vastIndexatiePercentage !== null ? config.vastIndexatiePercentage.toString() : null,
        config.vastIndexatiedatum !== null ? formatBusinessDate(config.vastIndexatiedatum) : null,
        config.variabelPercentage !== null ? config.variabelPercentage.toString() : null,
      );
    }
  });
}

/** Leest de Module-2-complexconfiguraties voor een begrotingsversie, op technische insertievolgorde (`id`) — geen businessbetekenis. */
export function leesModule2Config(db: DatabaseSync, versieId: string): readonly BgBeheerComplexConfig[] {
  const rijen = db
    .prepare(
      `SELECT complexnummer, vast_bedrag_jaar, vast_indexatie_percentage, vast_indexatiedatum, variabel_percentage
       FROM begroting_complex_config
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as ComplexConfigRow[];

  return rijen.map((rij): BgBeheerComplexConfig => ({
    complexnummer: rij.complexnummer,
    vastBedragJaar: rij.vast_bedrag_jaar !== null ? new Decimal(rij.vast_bedrag_jaar) : null,
    vastIndexatiePercentage: rij.vast_indexatie_percentage !== null ? new Decimal(rij.vast_indexatie_percentage) : null,
    vastIndexatiedatum: rij.vast_indexatiedatum !== null ? parseBusinessDate(rij.vast_indexatiedatum) : null,
    variabelPercentage: rij.variabel_percentage !== null ? new Decimal(rij.variabel_percentage) : null,
  }));
}
