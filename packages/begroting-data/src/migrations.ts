import type { DatabaseSync } from "node:sqlite";

/**
 * Migratierunner voor `begrotingen.sqlite` — expliciet ANDERS dan
 * `packages/cache`'s aanpak (die herbouwt bij elke run vanuit niets, kent
 * geen migraties). Deze database bevat straks niet-herbouwbare historie
 * (vastgestelde begrotingsversies) en moet dus schema-wijzigingen over de
 * tijd heen kunnen toepassen op een BESTAAND bestand, zonder data te
 * verliezen. Bewust een kleine, handgeschreven runner — geen generiek
 * migration-framework, geen ORM (zie Fase 1D-ontwerp).
 *
 * Elke migratie is idempotent op databaseniveau: `runMigrations` past een
 * migratie alleen toe als haar `version` hoger is dan de laatst
 * geregistreerde `schema_version` in `begroting_schema_meta`. Een migratie
 * draait volledig in haar eigen transactie — bij een fout wordt die ene
 * migratie volledig teruggedraaid (`ROLLBACK`) en stopt de runner meteen
 * (geen poging om latere migraties alsnog toe te passen op een mogelijk
 * inconsistente staat).
 */
export interface Migration {
  readonly version: number;
  readonly description: string;
  readonly ddl: readonly string[];
}

/**
 * Migratie 1 — technische bootstrap: uitsluitend `begroting_schema_meta`
 * zelf. Bewust GEEN business-tabellen (`begrotingsversies` etc.) in deze
 * fase (1D.1) — die volgen in latere, apart te reviewen migraties.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: "bootstrap: begroting_schema_meta",
    ddl: [
      `CREATE TABLE begroting_schema_meta (
        schema_version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`,
    ],
  },
];

function schemaMetaTableExists(db: DatabaseSync): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'begroting_schema_meta'`).get();
  return row !== undefined;
}

function getCurrentSchemaVersion(db: DatabaseSync): number {
  if (!schemaMetaTableExists(db)) return 0;
  const row = db.prepare(`SELECT MAX(schema_version) AS version FROM begroting_schema_meta`).get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}

/**
 * Past alle nog-niet-toegepaste migraties toe, oplopend op `version`. Elke
 * migratie draait in haar eigen transactie (DDL + de bijbehorende
 * `begroting_schema_meta`-rij samen) — een fout in migratie N laat migratie
 * N volledig ongedaan en stopt de runner vóórdat migratie N+1 wordt
 * geprobeerd. `migrations` is injecteerbaar (default: `MIGRATIONS`)
 * uitsluitend om een geforceerde migratiefout schoon te kunnen testen zonder
 * de echte migratielijst te hoeven aanpassen.
 */
export function runMigrations(db: DatabaseSync, migrations: readonly Migration[] = MIGRATIONS): void {
  const currentVersion = getCurrentSchemaVersion(db);
  const pending = migrations.filter((m) => m.version > currentVersion).sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    db.exec("BEGIN");
    try {
      for (const statement of migration.ddl) {
        db.exec(statement);
      }
      db.prepare(`INSERT INTO begroting_schema_meta (schema_version, applied_at) VALUES (?, ?)`).run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(
        `Migratie ${migration.version} ("${migration.description}") is mislukt en volledig teruggedraaid: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }
}
