import type { DatabaseSync } from "node:sqlite";

/**
 * UX_10 "Verborgen onderdelen" (CONTRACTCONFLICT-besluit 2026-10-06) — uitsluitend
 * Managementvergoeding, per ADMINISTRATIE (`bedrijfsnr`), niet per begrotingsversie: "Wanneer
 * Managementvergoeding niet wordt gebruikt, kan de gebruiker het onderdeel per administratie
 * verbergen. Het blijft herstelbaar onder Verborgen onderdelen" (09_Begrotingsmodule_UX_Vastgesteld
 * §6/§10). Expliciet GEEN generiek verbergmechanisme: `VERBERGBARE_MODULES`/de CHECK-constraint in
 * migratie 43 staan uitsluitend `"MANAGEMENT"` toe. Canon/Erfpacht en Geplande verkoop blijven HOLD;
 * een ander onderdeel verbergbaar maken vereist een nieuw, afzonderlijk vastgesteld besluit (nieuwe
 * migratie/uitbreiding van deze enum, nooit een stilzwijgende generalisatie van deze functies).
 *
 * AANWEZIGHEID van een rij = verborgen — geen apart boolean-veld. Deze module schrijft/leest
 * UITSLUITEND deze eigen, kleine tabel: nooit `begroting_module3_invoer` of enige andere financiële
 * tabel. Het economische effect van "verborgen + geen bestaande invoer" (een geldige, controlevrije
 * €0-Managementresultaat in plaats van de blokkerende "geen invoer"-fout) wordt elders toegepast, op
 * de ENE plek waar Module-3-invoer wordt gelezen voor berekening/vaststellen — zie
 * `herberekenen.ts`'s `leesHerberekenInvoerZonderTransactie` — nooit hier.
 */
export const VERBERGBARE_MODULES = ["MANAGEMENT"] as const;
export type VerbergbareModule = (typeof VERBERGBARE_MODULES)[number];

/** `true` zodra er een rij bestaat voor deze combinatie — de enige bron van waarheid voor "is dit onderdeel verborgen". */
export function isModuleVerborgen(db: DatabaseSync, bedrijfsnr: string, moduleKey: VerbergbareModule): boolean {
  const row = db.prepare(`SELECT 1 FROM begroting_verborgen_onderdelen WHERE bedrijfsnr = ? AND module_key = ?`).get(bedrijfsnr, moduleKey);
  return row !== undefined;
}

/** Alle momenteel verborgen modules voor deze administratie (voor een "Verborgen onderdelen"-overzicht). */
export function leesVerborgenModules(db: DatabaseSync, bedrijfsnr: string): VerbergbareModule[] {
  const rows = db.prepare(`SELECT module_key FROM begroting_verborgen_onderdelen WHERE bedrijfsnr = ? ORDER BY module_key`).all(bedrijfsnr) as { module_key: VerbergbareModule }[];
  return rows.map((r) => r.module_key);
}

/**
 * Markeert een onderdeel als verborgen/niet van toepassing. Idempotent (een tweede keer verbergen
 * werkt de datum bij, gooit geen fout). Schrijft NOOIT iets in een andere tabel — de aanroeper
 * (`apps/worker`'s route) is verantwoordelijk voor de "geen bestaande invoer"-voorwaarde (CLAUDE.md
 * §6-achtige discipline: deze functie verzint of valideert geen financiële toestand, ze registreert
 * uitsluitend de expliciete gebruikerskeuze).
 */
export function verbergModule(db: DatabaseSync, bedrijfsnr: string, moduleKey: VerbergbareModule, verborgenOp: Date = new Date()): void {
  db.prepare(
    `INSERT INTO begroting_verborgen_onderdelen (bedrijfsnr, module_key, verborgen_op) VALUES (?, ?, ?)
     ON CONFLICT (bedrijfsnr, module_key) DO UPDATE SET verborgen_op = excluded.verborgen_op`,
  ).run(bedrijfsnr, moduleKey, verborgenOp.toISOString());
}

/** "Weergeven": verwijdert uitsluitend de verborgen-markering. Bestaande invoer/beoordeling van begrotingsversies van deze administratie wordt hier nooit aangeraakt. */
export function toonModule(db: DatabaseSync, bedrijfsnr: string, moduleKey: VerbergbareModule): void {
  db.prepare(`DELETE FROM begroting_verborgen_onderdelen WHERE bedrijfsnr = ? AND module_key = ?`).run(bedrijfsnr, moduleKey);
}
