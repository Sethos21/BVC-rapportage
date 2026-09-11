import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de module-brede Gemeentelijke-Lasten/WOZ-aannames +
 * `beoordeeld`-vlag (OB-033) — ÉÉN gecombineerde tabel/bestand, bewust
 * ANDERS dan het GO/CD/Verzekeringen-patroon van twee gescheiden
 * bestanden (regels + los `beoordeeld`-bestand). Reden: OB-033 se
 * module-brede aannames (`werkelijkeGemeentelijkeLasten`/
 * `wozStijgingPercentage`/`lastenPercentageStijging`/
 * `begrotingsPercentageOverride`) en `beoordeeld` horen functioneel bij
 * elkaar als één samenhangende module-invoerstaat — zelfde "één complete
 * rij per begrotingsversie, volledige vervanging bij elke write"-precedent
 * als `module3Invoer.ts` (`begroting_management_invoer`, migratie 6), niet
 * het aparte-vlag-bestand-patroon van de eerdere onderhoud-/
 * verzekeringsmodules (die geen module-brede Decimal-aannames kennen).
 *
 * ALLE VIER AANNAMEVELDEN NULLABLE (OB033-019): `NULL` betekent hier ALTIJD
 * "nog niet ingevuld", nooit stilzwijgend `0` — zie
 * `begroteGemeentelijkeLasten.ts`'s moduledoc voor de veilige-0-behandeling
 * die hierop volgt in de pure calculator.
 *
 * "GEEN RIJ" IS HIER GEEN APARTE BETEKENISVOLLE TOESTAND (bewust ANDERS dan
 * Module 3's `leesModule3Invoer`, die `null` teruggeeft): omdat elk
 * aannameveld al onafhankelijk `NULL`-toegestaan is, is een ontbrekende rij
 * functioneel exact gelijk aan een rij waarin alle aannamevelden `NULL`
 * zijn en `beoordeeld = false` — er is geen derde, apart te onderscheiden
 * toestand. `leesGemeentelijkeLastenModule` geeft daarom ALTIJD een
 * `GemeentelijkeLastenModuleInvoer`-object terug, nooit `null`.
 */

export interface GemeentelijkeLastenModuleInvoer {
  werkelijkeGemeentelijkeLasten: Decimal | null;
  wozStijgingPercentage: Decimal | null;
  lastenPercentageStijging: Decimal | null;
  begrotingsPercentageOverride: Decimal | null;
  beoordeeld: boolean;
}

interface GemeentelijkeLastenModuleRow {
  werkelijke_gemeentelijke_lasten: string | null;
  woz_stijging_percentage: string | null;
  lasten_percentage_stijging: string | null;
  begrotings_percentage_override: string | null;
  beoordeeld: number;
}

const LEGE_MODULE_INVOER: GemeentelijkeLastenModuleInvoer = {
  werkelijkeGemeentelijkeLasten: null,
  wozStijgingPercentage: null,
  lastenPercentageStijging: null,
  begrotingsPercentageOverride: null,
  beoordeeld: false,
};

/** Leest de module-brede aannames + `beoordeeld`-vlag. Geen rij (nog nooit geschreven, of versie bestaat niet) → alle aannamevelden `null`, `beoordeeld = false` (zie moduledoc — geen aparte derde toestand). */
export function leesGemeentelijkeLastenModule(db: DatabaseSync, versieId: string): GemeentelijkeLastenModuleInvoer {
  const row = db
    .prepare(
      `SELECT werkelijke_gemeentelijke_lasten, woz_stijging_percentage, lasten_percentage_stijging, begrotings_percentage_override, beoordeeld
       FROM begroting_gemeentelijke_lasten_module
       WHERE begroting_versie_id = ?`,
    )
    .get(versieId) as unknown as GemeentelijkeLastenModuleRow | undefined;
  if (row === undefined) {
    return LEGE_MODULE_INVOER;
  }
  return {
    werkelijkeGemeentelijkeLasten: row.werkelijke_gemeentelijke_lasten !== null ? new Decimal(row.werkelijke_gemeentelijke_lasten) : null,
    wozStijgingPercentage: row.woz_stijging_percentage !== null ? new Decimal(row.woz_stijging_percentage) : null,
    lastenPercentageStijging: row.lasten_percentage_stijging !== null ? new Decimal(row.lasten_percentage_stijging) : null,
    begrotingsPercentageOverride: row.begrotings_percentage_override !== null ? new Decimal(row.begrotings_percentage_override) : null,
    beoordeeld: row.beoordeeld === 1,
  };
}

/**
 * Schrijft (of vervangt volledig) de module-brede aannames + `beoordeeld`-
 * vlag voor één begrotingsversie. Faalt vóór elke databasewijziging als de
 * parent niet bestaat of geen CONCEPT is. Eén enkele `INSERT … ON CONFLICT
 * … DO UPDATE`-statement die ALLE kolommen expliciet zet — voor een
 * 1-op-1-record is dat al atomair en een complete vervanging, geen
 * gedeeltelijke patchsemantiek (zelfde patroon als `module3Invoer.ts`).
 */
export function schrijfGemeentelijkeLastenModule(db: DatabaseSync, versieId: string, invoer: GemeentelijkeLastenModuleInvoer): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — Gemeentelijke-Lasten-module-invoer mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  db.prepare(
    `INSERT INTO begroting_gemeentelijke_lasten_module
       (begroting_versie_id, werkelijke_gemeentelijke_lasten, woz_stijging_percentage, lasten_percentage_stijging, begrotings_percentage_override, beoordeeld)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (begroting_versie_id) DO UPDATE SET
       werkelijke_gemeentelijke_lasten = excluded.werkelijke_gemeentelijke_lasten,
       woz_stijging_percentage = excluded.woz_stijging_percentage,
       lasten_percentage_stijging = excluded.lasten_percentage_stijging,
       begrotings_percentage_override = excluded.begrotings_percentage_override,
       beoordeeld = excluded.beoordeeld`,
  ).run(
    versieId,
    invoer.werkelijkeGemeentelijkeLasten !== null ? invoer.werkelijkeGemeentelijkeLasten.toString() : null,
    invoer.wozStijgingPercentage !== null ? invoer.wozStijgingPercentage.toString() : null,
    invoer.lastenPercentageStijging !== null ? invoer.lastenPercentageStijging.toString() : null,
    invoer.begrotingsPercentageOverride !== null ? invoer.begrotingsPercentageOverride.toString() : null,
    invoer.beoordeeld ? 1 : 0,
  );
}
