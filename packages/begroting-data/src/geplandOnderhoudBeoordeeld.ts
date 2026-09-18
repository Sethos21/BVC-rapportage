import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de module-brede Gepland-Onderhoud-`beoordeeld`-vlag —
 * fase GO-P1. Bewust een EIGEN bestand, gescheiden van
 * `geplandOnderhoudActiviteiten.ts`: activiteiten-writes raken deze vlag
 * NOOIT, en deze vlag raakt activiteiten NOOIT — twee volledig onafhankelijke
 * schrijfpaden (zelfde architecturele scheiding als `module1Aannames.ts`
 * versus `module1Overrides.ts`).
 *
 * BEWUST ANDERS dan Module 3's `leesModule3Invoer` (die `null` teruggeeft als
 * er nog geen rij bestaat): hier betekent "geen rij" exact hetzelfde als
 * "rij met `beoordeeld = 0`" — er is geen derde toestand te onderscheiden.
 * `leesGeplandOnderhoudBeoordeeld` geeft daarom altijd een `boolean` terug,
 * nooit `null`.
 */

/** Leest de `beoordeeld`-vlag. Geen rij (versie nog nooit expliciet beoordeeld, of versie bestaat niet) → `false`. */
export function leesGeplandOnderhoudBeoordeeld(db: DatabaseSync, versieId: string): boolean {
  const row = db.prepare(`SELECT beoordeeld FROM begroting_gepland_onderhoud_module WHERE begroting_versie_id = ?`).get(versieId) as
    | { beoordeeld: number }
    | undefined;
  return row !== undefined && row.beoordeeld === 1;
}

/** Schrijft (of vervangt) de `beoordeeld`-vlag voor één begrotingsversie — expliciete gebruikershandeling, nooit door deze functie zelf afgeleid uit het aantal activiteiten. */
export function schrijfGeplandOnderhoudBeoordeeld(db: DatabaseSync, versieId: string, beoordeeld: boolean): void {
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
    `INSERT INTO begroting_gepland_onderhoud_module (begroting_versie_id, beoordeeld)
     VALUES (?, ?)
     ON CONFLICT (begroting_versie_id) DO UPDATE SET beoordeeld = excluded.beoordeeld`,
  ).run(versieId, beoordeeld ? 1 : 0);
}
