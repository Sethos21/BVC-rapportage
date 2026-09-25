import type { DatabaseSync } from "node:sqlite";
import { RENTE_CATEGORIEEN, type BgRenteCategorie } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de PER-CATEGORIE module-brede staat van Rente (OB-037/038)
 * — UITSLUITEND `beoordeeld`. Zie migratie 20 in `migrations.ts`.
 *
 * GEEN REKENHULPVELDEN HIER (bewust anders dan `algemeneKostenCategorieState.ts`/
 * `leegstandCategorieState.ts`): de rekenhulp voor Rente is PER REGEL, niet
 * categoriebreed (zie `begroteRente.ts`'s moduledoc) — `laatstBekendSaldo`/
 * `rentepercentage` leven op de regel zelf (`renteRegels.ts`), niet hier.
 *
 * PRECIES TWEE RIJEN PER BEGROTINGSVERSIE (één per vaste categorie uit
 * `RENTE_CATEGORIEEN`) — schrijft/vervangt daarom altijd BEIDE categorieën
 * in één aanroep.
 *
 * "GEEN RIJ VOOR EEN CATEGORIE" IS GEEN APARTE BETEKENISVOLLE TOESTAND: een
 * ontbrekende rij is functioneel gelijk aan `beoordeeld=false`.
 * `leesRenteCategorieState` geeft daarom ALTIJD een compleet `Record` voor
 * beide categorieën terug.
 */

export interface RenteCategorieStateInvoer {
  beoordeeld: boolean;
}

interface RenteCategorieStateRow {
  categorie: BgRenteCategorie;
  beoordeeld: number;
}

const LEGE_CATEGORIE_STATE: RenteCategorieStateInvoer = { beoordeeld: false };

/** Leest de staat van beide categorieën voor één begrotingsversie — ontbrekende categorieën krijgen `beoordeeld=false` (zie moduledoc). */
export function leesRenteCategorieState(db: DatabaseSync, versieId: string): Record<BgRenteCategorie, RenteCategorieStateInvoer> {
  const rijen = db.prepare(`SELECT categorie, beoordeeld FROM begroting_rente_categorie_state WHERE begroting_versie_id = ?`).all(versieId) as unknown as RenteCategorieStateRow[];
  const perCategorie = new Map(rijen.map((rij) => [rij.categorie, { beoordeeld: rij.beoordeeld === 1 } satisfies RenteCategorieStateInvoer]));

  return Object.fromEntries(RENTE_CATEGORIEEN.map((categorie) => [categorie, perCategorie.get(categorie) ?? LEGE_CATEGORIE_STATE])) as Record<BgRenteCategorie, RenteCategorieStateInvoer>;
}

/**
 * Schrijft (vervangt volledig) de staat van BEIDE categorieën voor één
 * begrotingsversie. Faalt vóór elke databasewijziging als de parent niet
 * bestaat of geen CONCEPT is.
 */
export function schrijfRenteCategorieState(db: DatabaseSync, versieId: string, staat: Record<BgRenteCategorie, RenteCategorieStateInvoer>): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — Rente-categorie-state mag uitsluitend op een CONCEPT-versie worden geschreven.`);
  }

  const upsertStmt = db.prepare(
    `INSERT INTO begroting_rente_categorie_state (begroting_versie_id, categorie, beoordeeld)
     VALUES (?, ?, ?)
     ON CONFLICT (begroting_versie_id, categorie) DO UPDATE SET beoordeeld = excluded.beoordeeld`,
  );

  for (const categorie of RENTE_CATEGORIEEN) {
    upsertStmt.run(versieId, categorie, staat[categorie].beoordeeld ? 1 : 0);
  }
}
