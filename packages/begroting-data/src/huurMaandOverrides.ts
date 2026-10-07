import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgContractMaandOverride } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor `BgContractMaandOverride[]` (besluit 07-10-2026, "Maandverloop") — laag 3 van
 * de vastgestelde Huur-rekenvolgorde. Zelfde lifecycle-precedent als `module1Overrides.ts`
 * (`begroting_contract_override`): uitsluitend een applicatielaag-CONCEPT-check, GEEN DB-trigger
 * (migratie 44's moduledoc licht toe waarom dit bewust consistent is met dat bestaande
 * override-patroon in plaats van met `begroting_contract_snapshot`'s triggers).
 *
 * `PRIMARY KEY (begroting_versie_id, contractnummer, vanaf_maand)`: schrijven voor een reeds
 * bestaande (contract, maand)-combinatie vervangt die override (UPSERT) — er bestaat geen "tweede,
 * genegeerde override voor dezelfde maand"-scenario zoals bij de indexatiepercentage-override; hier
 * is maar één override per (contract, maand) betekenisvol, dus wordt dat ook zo afgedwongen.
 */

interface MaandOverrideRow {
  contractnummer: string;
  vanaf_maand: number;
  nieuwe_bruto_huur_per_maand: string | null;
  nieuwe_korting_per_maand: string | null;
}

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
 * Schrijft een COMPLETE set Huur-maandoverrides voor één begrotingsversie, atomair (vervangt —
 * geen gedeeltelijke/append-route, zelfde ontwerp als `schrijfModule1Overrides`). Faalt vóór de
 * transactie als de parent niet bestaat of geen CONCEPT is.
 */
export function schrijfHuurMaandOverrides(db: DatabaseSync, versieId: string, overrides: readonly BgContractMaandOverride[]): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — Huur-maandoverrides mogen uitsluitend op een CONCEPT-versie worden geschreven.`);
  }

  withTransaction(db, () => {
    db.prepare(`DELETE FROM begroting_huur_maandoverride WHERE begroting_versie_id = ?`).run(versieId);

    const insert = db.prepare(
      `INSERT INTO begroting_huur_maandoverride (begroting_versie_id, contractnummer, vanaf_maand, nieuwe_bruto_huur_per_maand, nieuwe_korting_per_maand)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const override of overrides) {
      insert.run(
        versieId,
        override.contractnummer,
        override.vanafMaand,
        override.nieuweBrutoHuurPerMaand !== null ? override.nieuweBrutoHuurPerMaand.toString() : null,
        override.nieuweKortingPerMaand !== null ? override.nieuweKortingPerMaand.toString() : null,
      );
    }
  });
}

/** Leest de Huur-maandoverrides voor een begrotingsversie, op (contractnummer, vanaf_maand) — deterministisch, geen businessbetekenis aan de leesvolgorde zelf. */
export function leesHuurMaandOverrides(db: DatabaseSync, versieId: string): readonly BgContractMaandOverride[] {
  const rijen = db
    .prepare(
      `SELECT contractnummer, vanaf_maand, nieuwe_bruto_huur_per_maand, nieuwe_korting_per_maand
       FROM begroting_huur_maandoverride WHERE begroting_versie_id = ? ORDER BY contractnummer, vanaf_maand`,
    )
    .all(versieId) as unknown as MaandOverrideRow[];

  return rijen.map((rij): BgContractMaandOverride => ({
    contractnummer: rij.contractnummer,
    vanafMaand: rij.vanaf_maand,
    nieuweBrutoHuurPerMaand: rij.nieuwe_bruto_huur_per_maand !== null ? new Decimal(rij.nieuwe_bruto_huur_per_maand) : null,
    nieuweKortingPerMaand: rij.nieuwe_korting_per_maand !== null ? new Decimal(rij.nieuwe_korting_per_maand) : null,
  }));
}
