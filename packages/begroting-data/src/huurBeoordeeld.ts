import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de module-brede Huur-`beoordeeld`-vlag (besluit 07-10-2026: "Alleen de
 * functionele Huurmodule heeft een beoordeling/status" — vóór dit besluit bestond geen
 * beoordeeld-concept voor Huur/Beheer). Exact hetzelfde patroon als `verzekeringBeoordeeld.ts`:
 * een eigen bestand, gescheiden van alle Huur-regelpersistence (snapshot/overrides/
 * maandoverrides/fictieve contracten) — regel-writes raken deze vlag NOOIT, en deze vlag raakt
 * regels NOOIT. "Onderdeel beoordelen" (de mockup-knop) is hiermee een afzonderlijke handeling
 * van "Voorstel overnemen" — die twee blijven ook hier strikt gescheiden acties.
 *
 * "Geen rij" betekent exact hetzelfde als "rij met `beoordeeld = 0`" — `leesHuurBeoordeeld` geeft
 * daarom altijd een `boolean` terug, nooit `null`.
 */

/** Leest de `beoordeeld`-vlag. Geen rij (versie nog nooit expliciet beoordeeld, of versie bestaat niet) → `false`. */
export function leesHuurBeoordeeld(db: DatabaseSync, versieId: string): boolean {
  const row = db.prepare(`SELECT beoordeeld FROM begroting_huur_module WHERE begroting_versie_id = ?`).get(versieId) as { beoordeeld: number } | undefined;
  return row !== undefined && row.beoordeeld === 1;
}

/**
 * Schrijft (of vervangt) de `beoordeeld`-vlag voor één begrotingsversie — expliciete
 * gebruikershandeling, nooit door deze functie zelf afgeleid uit de contract-/override-data.
 * Aanroepers die een relevante Huur-wijziging opslaan (override, maandoverride, fictief contract)
 * roepen deze functie zelf aan met `false` om de eerdere beoordeling te laten vervallen — dat
 * gebeurt hier NIET automatisch, om deze functie een zuivere, voorspelbare schrijfoperatie te
 * houden (zelfde ontwerp als elders in de begrotingsmodule).
 */
export function schrijfHuurBeoordeeld(db: DatabaseSync, versieId: string, beoordeeld: boolean): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — de beoordeeld-vlag mag uitsluitend op een CONCEPT-versie worden geschreven.`);
  }

  db.prepare(
    `INSERT INTO begroting_huur_module (begroting_versie_id, beoordeeld)
     VALUES (?, ?)
     ON CONFLICT (begroting_versie_id) DO UPDATE SET beoordeeld = excluded.beoordeeld`,
  ).run(versieId, beoordeeld ? 1 : 0);
}
