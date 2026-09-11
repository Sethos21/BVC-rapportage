import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de module-brede Verzekering-`beoordeeld`-vlag — OB-032.
 * Exact hetzelfde patroon als `correctiefDagelijksOnderhoudBeoordeeld.ts`
 * (GO-P1/CD-P1): een eigen bestand, gescheiden van `verzekeringRegels.ts`
 * — regel-writes raken deze vlag NOOIT, en deze vlag raakt regels NOOIT.
 *
 * "Geen rij" betekent hier exact hetzelfde als "rij met `beoordeeld = 0`" —
 * `leesVerzekeringBeoordeeld` geeft daarom altijd een `boolean` terug,
 * nooit `null`.
 */

/** Leest de `beoordeeld`-vlag. Geen rij (versie nog nooit expliciet beoordeeld, of versie bestaat niet) → `false`. */
export function leesVerzekeringBeoordeeld(db: DatabaseSync, versieId: string): boolean {
  const row = db.prepare(`SELECT beoordeeld FROM begroting_verzekering_module WHERE begroting_versie_id = ?`).get(versieId) as
    | { beoordeeld: number }
    | undefined;
  return row !== undefined && row.beoordeeld === 1;
}

/** Schrijft (of vervangt) de `beoordeeld`-vlag voor één begrotingsversie — expliciete gebruikershandeling, nooit door deze functie zelf afgeleid uit het aantal regels. */
export function schrijfVerzekeringBeoordeeld(db: DatabaseSync, versieId: string, beoordeeld: boolean): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — de beoordeeld-vlag mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  db.prepare(
    `INSERT INTO begroting_verzekering_module (begroting_versie_id, beoordeeld)
     VALUES (?, ?)
     ON CONFLICT (begroting_versie_id) DO UPDATE SET beoordeeld = excluded.beoordeeld`,
  ).run(versieId, beoordeeld ? 1 : 0);
}
