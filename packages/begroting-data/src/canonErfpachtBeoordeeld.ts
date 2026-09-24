import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de module-brede Canon-erfpacht-`beoordeeld`-vlag (OB-034).
 * Exact hetzelfde patroon als `verzekeringBeoordeeld.ts`: een eigen bestand,
 * gescheiden van `canonErfpachtRegels.ts` — regel-writes raken deze vlag
 * NOOIT en andersom. "Geen rij" = `beoordeeld = false`; altijd een `boolean`.
 */

export function leesCanonErfpachtBeoordeeld(db: DatabaseSync, versieId: string): boolean {
  const row = db.prepare(`SELECT beoordeeld FROM begroting_canon_erfpacht_module WHERE begroting_versie_id = ?`).get(versieId) as
    | { beoordeeld: number }
    | undefined;
  return row !== undefined && row.beoordeeld === 1;
}

/** Expliciete gebruikershandeling — nooit afgeleid uit het aantal regels. Alleen op een CONCEPT-versie. */
export function schrijfCanonErfpachtBeoordeeld(db: DatabaseSync, versieId: string, beoordeeld: boolean): void {
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
    `INSERT INTO begroting_canon_erfpacht_module (begroting_versie_id, beoordeeld)
     VALUES (?, ?)
     ON CONFLICT (begroting_versie_id) DO UPDATE SET beoordeeld = excluded.beoordeeld`,
  ).run(versieId, beoordeeld ? 1 : 0);
}
