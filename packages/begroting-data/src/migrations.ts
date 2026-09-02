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
  /**
   * Migratie 2 — de begrotingsversie-entity zelf, inclusief haar volledige
   * levenscyclus/immutability-invariant. Bewust NOG GEEN child-tabellen
   * (contract-snapshot, aannames, overrides, Module-2-config, frozen
   * output) — die volgen in latere, apart te reviewen migraties (1D.3+).
   *
   * Write-once (technisch afgedwongen, zie trg_begrotingsversies_write_once
   * hieronder): id, bedrijfsnr, begrotingsjaar, bron_peildatum, created_at,
   * based_on_version_id, origin_type — mogen na INSERT nooit meer wijzigen,
   * ongeacht status. `vastgesteld_at` staat BEWUST niet in deze trigger: hij
   * gaat één keer van NULL naar een tijdstip tijdens de CONCEPT→VASTGESTELD-
   * overgang zelf (die overgang wijzigt geen write-once-veld, dus de trigger
   * hoeft daar niet voor uit te zonderen) — en is daarna vanzelf al bevroren
   * doordat de VASTGESTELD-immutability-trigger op dat moment elke verdere
   * UPDATE blokkeert.
   *
   * Lineage-integriteit als CHECK-constraint (structurele data-invariant,
   * geen rekenbusinesslogica): origin_type NIEUW vereist based_on_version_id
   * IS NULL; GEBASEERD_OP_VERSIE vereist based_on_version_id IS NOT NULL.
   * Losse CHECK tegen zelfreferentie (based_on_version_id = id). Geen
   * bredere cycle-detectie in deze fase (expliciet uitgesteld).
   *
   * Status/tijdstip-koppeling, EVENEENS als eenvoudige structurele CHECK
   * (geen aparte trigger nodig): CONCEPT vereist vastgesteld_at IS NULL;
   * VASTGESTELD vereist vastgesteld_at IS NOT NULL. Dit voorkomt een
   * inconsistente tussenstate die de bestaande triggers alléén niet konden
   * afvangen — die blokkeren pas UPDATE/DELETE NÁ het bereiken van
   * VASTGESTELD, niet een enkele INSERT/UPDATE die de twee velden los van
   * elkaar (of via rechtstreekse SQL) op een niet-samenhangende combinatie
   * zet. `markeerVastgesteld` zet beide velden altijd al in dezelfde UPDATE
   * (zie begrotingsversies.ts) — deze CHECK is de databasegarantie die dat
   * ook afdwingt voor elk ander schrijfpad.
   *
   * Twee immutability-triggers, met bewust gescheiden verantwoordelijkheid:
   * - trg_begrotingsversies_write_once: blokkeert de zeven write-once-velden,
   *   ALTIJD (ongeacht status) — behalve de eerste INSERT zelf (triggers
   *   vuren nooit op INSERT).
   * - trg_begrotingsversies_vastgesteld_immutable_update /
   *   trg_begrotingsversies_vastgesteld_no_delete: vuren uitsluitend als
   *   `OLD.status = 'VASTGESTELD'` — dus NOOIT op de ENE toegestane
   *   CONCEPT→VASTGESTELD-overgang zelf (daar is OLD.status nog 'CONCEPT'),
   *   maar WEL op elke latere UPDATE/DELETE, inclusief een poging tot
   *   VASTGESTELD→CONCEPT (die verandert OLD.status vanuit 'VASTGESTELD',
   *   dus wordt hierdoor al geblokkeerd zonder een aparte richtingscontrole).
   */
  {
    version: 2,
    description: "begrotingsversies: entity + lifecycle/immutability-invarianten",
    ddl: [
      `CREATE TABLE begrotingsversies (
        id TEXT PRIMARY KEY,
        bedrijfsnr TEXT NOT NULL,
        begrotingsjaar INTEGER NOT NULL,
        bron_peildatum TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('CONCEPT', 'VASTGESTELD')),
        naam TEXT NULL,
        notitie TEXT NULL,
        created_at TEXT NOT NULL,
        vastgesteld_at TEXT NULL,
        based_on_version_id TEXT NULL REFERENCES begrotingsversies(id),
        origin_type TEXT NOT NULL CHECK (origin_type IN ('NIEUW', 'GEBASEERD_OP_VERSIE')),
        CHECK (
          (origin_type = 'NIEUW' AND based_on_version_id IS NULL)
          OR (origin_type = 'GEBASEERD_OP_VERSIE' AND based_on_version_id IS NOT NULL)
        ),
        CHECK (based_on_version_id IS NULL OR based_on_version_id <> id),
        CHECK (
          (status = 'CONCEPT' AND vastgesteld_at IS NULL)
          OR (status = 'VASTGESTELD' AND vastgesteld_at IS NOT NULL)
        )
      )`,
      `CREATE TRIGGER trg_begrotingsversies_write_once
       BEFORE UPDATE ON begrotingsversies
       FOR EACH ROW
       WHEN
         NEW.id <> OLD.id
         OR NEW.bedrijfsnr <> OLD.bedrijfsnr
         OR NEW.begrotingsjaar <> OLD.begrotingsjaar
         OR NEW.bron_peildatum <> OLD.bron_peildatum
         OR NEW.created_at <> OLD.created_at
         OR NEW.origin_type <> OLD.origin_type
         OR NEW.based_on_version_id IS NOT OLD.based_on_version_id
       BEGIN
         SELECT RAISE(ABORT, 'begrotingsversies: write-once veld (id/bedrijfsnr/begrotingsjaar/bron_peildatum/created_at/based_on_version_id/origin_type) mag na aanmaak niet meer wijzigen');
       END`,
      `CREATE TRIGGER trg_begrotingsversies_vastgesteld_immutable_update
       BEFORE UPDATE ON begrotingsversies
       FOR EACH ROW
       WHEN OLD.status = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begrotingsversies: een VASTGESTELDE versie is volledig immutable — geen enkele UPDATE toegestaan');
       END`,
      `CREATE TRIGGER trg_begrotingsversies_vastgesteld_no_delete
       BEFORE DELETE ON begrotingsversies
       FOR EACH ROW
       WHEN OLD.status = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begrotingsversies: een VASTGESTELDE versie mag nooit worden verwijderd');
       END`,
    ],
  },
  /**
   * Migratie 3 — de bevroren Module-1-inputsnapshot: `BgContractFeiten`
   * (exact zoals `packages/reporting/src/begroting/begroteHuuropbrengsten.ts`
   * die op HEAD kent), plus haar twee array-velden als child-tabellen.
   * Uitsluitend reeds-genormaliseerde bronfeiten — GEEN aannames, GEEN
   * overrides, GEEN Module-2-config, GEEN berekeningsoutput (die volgen in
   * latere, apart te reviewen migraties, 1D.4+).
   *
   * `begroting_contract_snapshot` is uniek per (begroting_versie_id,
   * contractnummer) — een dubbel contractnummer binnen dezelfde versie is
   * een extractie-/persistencefout, geen legitieme businesssituatie (zelfde
   * redenering als het fase-1D-ontwerp: contractuniciteit binnen één
   * administratie is al BRONFEIT).
   *
   * Cascade-keten: begrotingsversies --ON DELETE CASCADE--> snapshot
   * --ON DELETE CASCADE--> beide child-tabellen. Zo laat het verwijderen van
   * een CONCEPT-versie (zie `verwijderConceptVersie`) nooit orphan-snapshot-
   * data achter. Een VASTGESTELDE versie kan sowieso nooit verwijderd worden
   * (bestaande trigger op `begrotingsversies` zelf) — de cascade wordt dus
   * per definitie nooit vanuit een VASTGESTELDE rij getriggerd.
   *
   * Immutability: alle drie tabellen krijgen elk drie triggers (INSERT/
   * UPDATE/DELETE) die weigeren zodra de bijbehorende `begrotingsversies`-rij
   * `status = 'VASTGESTELD'` heeft — bewust simpele, herhaalde WHEN-subquery-
   * triggers per tabel/actie, geen generiek triggerframework.
   *
   * Structurele consistentie-invariant (geen nieuwe businessregel, een
   * technische koppeling tussen twee al bestaande velden): `begroting_
   * contract_snapshot.bedrijfsnr` moet exact gelijk zijn aan het `bedrijfsnr`
   * van de bijbehorende `begrotingsversies`-rij — één begrotingsversie hoort
   * bij precies één administratie, en Module 1 zelf staat nooit meerdere
   * bedrijfsnr's in één aanroep toe. De FK bewaakt "parent bestaat"; deze
   * twee extra triggers (INSERT/UPDATE) bewaken uitsluitend "bedrijfsnr hoort
   * bij die parent" — een gewone CHECK kan de parenttabel niet raadplegen.
   */
  {
    version: 3,
    description: "Module-1-inputsnapshot: begroting_contract_snapshot + rentroll-componenten + kortingswijzigingen",
    ddl: [
      `CREATE TABLE begroting_contract_snapshot (
        begroting_versie_id TEXT NOT NULL REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        contractnummer TEXT NOT NULL,
        bedrijfsnr TEXT NOT NULL,
        huurdernummer TEXT NULL,
        huurder_naam TEXT NULL,
        complexnummer TEXT NULL,
        ingangsdatum TEXT NULL,
        einddatum TEXT NULL,
        indexatiedatum TEXT NULL,
        indexatie_herhaling_maanden INTEGER NULL,
        PRIMARY KEY (begroting_versie_id, contractnummer)
      )`,
      `CREATE TABLE begroting_contract_rentroll_component (
        begroting_versie_id TEXT NOT NULL,
        contractnummer TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        vorderingsoort TEXT NOT NULL,
        bedrag_jaar TEXT NOT NULL,
        btw_yn TEXT NULL,
        PRIMARY KEY (begroting_versie_id, contractnummer, volgnr),
        FOREIGN KEY (begroting_versie_id, contractnummer)
          REFERENCES begroting_contract_snapshot(begroting_versie_id, contractnummer) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_contract_kortingswijziging (
        begroting_versie_id TEXT NOT NULL,
        contractnummer TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        ingangsdatum TEXT NOT NULL,
        nieuwe_korting_per_maand TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, contractnummer, volgnr),
        FOREIGN KEY (begroting_versie_id, contractnummer)
          REFERENCES begroting_contract_snapshot(begroting_versie_id, contractnummer) ON DELETE CASCADE
      )`,
      `CREATE TRIGGER trg_begroting_contract_snapshot_bedrijfsnr_insert
       BEFORE INSERT ON begroting_contract_snapshot
       FOR EACH ROW
       WHEN NEW.bedrijfsnr <> (SELECT bedrijfsnr FROM begrotingsversies WHERE id = NEW.begroting_versie_id)
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_snapshot: bedrijfsnr moet exact overeenkomen met het bedrijfsnr van de begrotingsversie');
       END`,
      `CREATE TRIGGER trg_begroting_contract_snapshot_bedrijfsnr_update
       BEFORE UPDATE ON begroting_contract_snapshot
       FOR EACH ROW
       WHEN NEW.bedrijfsnr <> (SELECT bedrijfsnr FROM begrotingsversies WHERE id = NEW.begroting_versie_id)
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_snapshot: bedrijfsnr moet exact overeenkomen met het bedrijfsnr van de begrotingsversie');
       END`,
      `CREATE TRIGGER trg_begroting_contract_snapshot_vastgesteld_no_insert
       BEFORE INSERT ON begroting_contract_snapshot
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_snapshot: begrotingsversie is VASTGESTELD, snapshot is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_contract_snapshot_vastgesteld_no_update
       BEFORE UPDATE ON begroting_contract_snapshot
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_snapshot: begrotingsversie is VASTGESTELD, snapshot is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_contract_snapshot_vastgesteld_no_delete
       BEFORE DELETE ON begroting_contract_snapshot
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_snapshot: begrotingsversie is VASTGESTELD, snapshot is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_contract_rentroll_component_vastgesteld_no_insert
       BEFORE INSERT ON begroting_contract_rentroll_component
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_rentroll_component: begrotingsversie is VASTGESTELD, snapshot is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_contract_rentroll_component_vastgesteld_no_update
       BEFORE UPDATE ON begroting_contract_rentroll_component
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_rentroll_component: begrotingsversie is VASTGESTELD, snapshot is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_contract_rentroll_component_vastgesteld_no_delete
       BEFORE DELETE ON begroting_contract_rentroll_component
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_rentroll_component: begrotingsversie is VASTGESTELD, snapshot is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_contract_kortingswijziging_vastgesteld_no_insert
       BEFORE INSERT ON begroting_contract_kortingswijziging
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_kortingswijziging: begrotingsversie is VASTGESTELD, snapshot is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_contract_kortingswijziging_vastgesteld_no_update
       BEFORE UPDATE ON begroting_contract_kortingswijziging
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_kortingswijziging: begrotingsversie is VASTGESTELD, snapshot is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_contract_kortingswijziging_vastgesteld_no_delete
       BEFORE DELETE ON begroting_contract_kortingswijziging
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_kortingswijziging: begrotingsversie is VASTGESTELD, snapshot is immutable');
       END`,
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
