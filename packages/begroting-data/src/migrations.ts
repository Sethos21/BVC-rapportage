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
  /**
   * Migratie 4 — Module-1-begrotingsaannames (`BgHuurAannames`), Module-1-
   * contractoverrides (`BgContractOverride`) en Module-2-complexconfiguratie
   * (`BgBeheerComplexConfig`) — exact zoals `begroteHuuropbrengsten.ts`/
   * `begroteBeheersvergoeding.ts` die op HEAD kennen. Uitsluitend INPUT voor
   * de reeds bestaande pure berekeningen — geen berekende output, geen
   * bronfeiten (die staan al in migratie 3).
   *
   * `begroting_aannames` is bewust 1-op-1 met de versie (PK = FK =
   * `begroting_versie_id`, geen apart `id`) — er hoort functioneel maximaal
   * één aannameset per versie te bestaan. `begrotingsjaar` staat NIET in deze
   * tabel: dat is al write-once op `begrotingsversies` en wordt bij lezen
   * van daar gereconstrueerd (geen tweede authoritative begrotingsjaar).
   *
   * `begroting_contract_override` en `begroting_complex_config` hebben BEIDE
   * bewust GEEN unieke constraint op resp. `(begroting_versie_id,
   * contractnummer)` / `(begroting_versie_id, complexnummer)` — meerdere
   * rijen voor hetzelfde contract/complex binnen één versie zijn toegestaan
   * op databaseniveau, want de bestaande pure Module-1/2-validatielogica
   * (dubbele/conflicterende invoer detecteren en melden) moet dat zelf
   * blijven zien; een DB-uniciteitsdwang zou die logica verbergen/dupliceren
   * met een striktere regel. Technische `id INTEGER PRIMARY KEY` als lokale
   * sleutel, uitsluitend voor deterministische leesvolgorde — geen
   * businessbetekenis.
   *
   * Geen FK van `begroting_contract_override.contractnummer` naar het
   * snapshot, en geen FK van `begroting_complex_config.complexnummer` naar
   * enige complexlijst — bewust: de pure Module-1/2-laag valideert zelf of
   * een override/config bij een bestaand contract/complex hoort, CONCEPT-
   * invoer mag tijdelijk incompleet zijn, en er wordt geen nieuwe
   * authoritative complexlijst geïntroduceerd.
   *
   * `scope` op `begroting_contract_override` krijgt een CHECK met exact de
   * huidige `BgOverrideScope`-waarden ('VERSIE'/'STRUCTUREEL'). Op
   * `begroting_complex_config` komt bewust GEEN vergelijkbare CHECK — de
   * actuele `BgBeheerComplexConfig`-interface heeft geen gesloten
   * enumwaarde om af te dwingen (alle vier velden zijn `Decimal | null` /
   * `Date | null`).
   *
   * Immutability: alle drie tabellen krijgen dezelfde drie triggers
   * (INSERT/UPDATE/DELETE geweigerd zodra de bijbehorende
   * `begrotingsversies`-rij `status = 'VASTGESTELD'` heeft) als migratie 3 —
   * zelfde bewust simpele, herhaalde WHEN-subquery-triggers per tabel/actie.
   */
  {
    version: 4,
    description: "Module-1-aannames/overrides + Module-2-complexconfiguratie",
    ddl: [
      `CREATE TABLE begroting_aannames (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        indexatie_percentage TEXT NOT NULL
      )`,
      `CREATE TABLE begroting_contract_override (
        id INTEGER PRIMARY KEY,
        begroting_versie_id TEXT NOT NULL REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        contractnummer TEXT NOT NULL,
        indexatie_percentage TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('VERSIE', 'STRUCTUREEL')),
        reden TEXT NULL
      )`,
      `CREATE TABLE begroting_complex_config (
        id INTEGER PRIMARY KEY,
        begroting_versie_id TEXT NOT NULL REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        complexnummer TEXT NOT NULL,
        vast_bedrag_jaar TEXT NULL,
        vast_indexatie_percentage TEXT NULL,
        vast_indexatiedatum TEXT NULL,
        variabel_percentage TEXT NULL
      )`,
      `CREATE TRIGGER trg_begroting_aannames_vastgesteld_no_insert
       BEFORE INSERT ON begroting_aannames
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_aannames: begrotingsversie is VASTGESTELD, aannames zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_aannames_vastgesteld_no_update
       BEFORE UPDATE ON begroting_aannames
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_aannames: begrotingsversie is VASTGESTELD, aannames zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_aannames_vastgesteld_no_delete
       BEFORE DELETE ON begroting_aannames
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_aannames: begrotingsversie is VASTGESTELD, aannames zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_contract_override_vastgesteld_no_insert
       BEFORE INSERT ON begroting_contract_override
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_override: begrotingsversie is VASTGESTELD, overrides zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_contract_override_vastgesteld_no_update
       BEFORE UPDATE ON begroting_contract_override
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_override: begrotingsversie is VASTGESTELD, overrides zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_contract_override_vastgesteld_no_delete
       BEFORE DELETE ON begroting_contract_override
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_contract_override: begrotingsversie is VASTGESTELD, overrides zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_complex_config_vastgesteld_no_insert
       BEFORE INSERT ON begroting_complex_config
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_complex_config: begrotingsversie is VASTGESTELD, configuratie is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_complex_config_vastgesteld_no_update
       BEFORE UPDATE ON begroting_complex_config
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_complex_config: begrotingsversie is VASTGESTELD, configuratie is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_complex_config_vastgesteld_no_delete
       BEFORE DELETE ON begroting_complex_config
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_complex_config: begrotingsversie is VASTGESTELD, configuratie is immutable');
       END`,
    ],
  },
  /**
   * Migratie 5 — bevroren Module-1/Module-2-OUTPUT (`BgHuurResultaat`/
   * `BgBeheerResultaat`, exact zoals `begroteHuuropbrengsten.ts`/
   * `begroteBeheersvergoeding.ts` die op HEAD kennen). Uitsluitend
   * serialisatie/deserialisatie van reeds berekende, pure resultaten — geen
   * nieuwe formules, geen totalen/controles opnieuw afgeleid.
   *
   * Bewust NIET opgeslagen (gereconstrueerd uit reeds-bestaande, op dat
   * moment al-immutable brontabellen): `begrotingsjaar` (module1 én module2)
   * — al write-once op `begrotingsversies`; `bronPeildatum` (module1) — al
   * write-once op `begrotingsversies`; `indexatiePercentageAlgemeen`
   * (module1) — is exact de reeds opgeslagen `begroting_aannames.
   * indexatie_percentage`, die zelf ook al immutable wordt zodra de versie
   * VASTGESTELD is (migratie 4), dus kan nooit na het bevriezen afwijken.
   * WEL opgeslagen, ondanks een oppervlakkige gelijkenis met bestaande
   * inputtabellen: `indexatiePercentageGebruikt`/`indexatiePercentageBron`/
   * `overrideToegepast` (contract) en `vastToegepast`/`variabelToegepast`/
   * `variabelPercentageGebruikt` (complex) — dit zijn afgeleide
   * UITKOMSTEN van de pure validatie/dedupliceerlogica (bv. bij meerdere
   * conflicterende overrides/configs), niet 1-op-1 herleidbaar uit de
   * ruwe inputtabellen zonder die pure logica te herhalen.
   *
   * Arrayvolgorde: frozen output bewaart de FEITELIJKE, op het moment van
   * schrijven waargenomen arrayvolgorde — nooit een achteraf op de huidige
   * sorteersemantiek van de pure functies gebaseerde herordening, ook niet
   * als die op dit moment toevallig samenvalt (bv. contractnummer-/
   * complexnummer-sortering). Frozen output mag na een latere wijziging in
   * hoe de pure functies intern ordenen nooit stilzwijgend een andere
   * volgorde teruggeven dan destijds vastgesteld.
   * - contracten (`begroting_frozen_module1_contract`) en complexen
   *   (`begroting_frozen_module2_complex`) krijgen daarom een technisch
   *   `volgnr` (exact de arraypositie op schrijfmoment), met
   *   `UNIQUE (begroting_versie_id, volgnr)` — gelezen via `ORDER BY
   *   volgnr`, nooit via `ORDER BY contractnummer`/`complexnummer`.
   *   `volgnr` heeft uitsluitend technische betekenis, geen business-
   *   betekenis; de bestaande PK op (begroting_versie_id, contractnummer/
   *   complexnummer) blijft ongewijzigd.
   * - maandregels: `maand` (1-12) blijft ONGEWIJZIGD de sorteersleutel —
   *   dat is de werkelijke, semantische kalendervolgorde (1-12), geen
   *   sorteerkeuze van de pure functie die kan wijzigen.
   * - controls: GEEN natuurlijk sorteerbaar veld (contractnummer/
   *   complexnummer kan null zijn of herhalen, bericht kan herhalen) —
   *   blijven ONGEWIJZIGD hun bestaande expliciete `volgnr`.
   *
   * Elk van de acht tabellen draagt `begroting_versie_id` rechtstreeks
   * (ook de "diepere" child-tabellen, niet uitsluitend via de FK-keten) —
   * zelfde denormalisatie als 1D.3's rentroll-/kortingswijziging-
   * child-tabellen, uitsluitend om de VASTGESTELD-immutability-trigger op
   * elke tabel met dezelfde simpele WHEN-subquery te kunnen schrijven,
   * zonder meerstaps-joins.
   *
   * Cascade-ketens: begrotingsversies --CASCADE--> *_resultaat (header)
   * --CASCADE--> *_contract/*_complex --CASCADE--> *_maandregel;
   * *_control hangt rechtstreeks aan *_resultaat. Zo verwijdert
   * `verwijderConceptVersie` (of een rechtstreekse delete van de header
   * tijdens CONCEPT) altijd de volledige boom.
   *
   * Immutability: alle acht tabellen krijgen dezelfde drie triggers
   * (INSERT/UPDATE/DELETE geweigerd zodra de bijbehorende
   * `begrotingsversies`-rij `status = 'VASTGESTELD'` heeft) — exact
   * hetzelfde patroon als migratie 3/4. Dit maakt 1D.6b's toekomstige
   * transactie ("frozen output schrijven, dán status VASTGESTELD zetten")
   * technisch mogelijk: de write moet vóór de statusovergang gebeuren
   * (terwijl de versie nog CONCEPT is), daarna is alles in één klap
   * immutable.
   */
  {
    version: 5,
    description: "Bevroren Module-1/Module-2-output (frozen resultaat)",
    ddl: [
      `CREATE TABLE begroting_frozen_module1_resultaat (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        indexatie_percentage_algemeen TEXT NOT NULL,
        portefeuille_bruto_huur_zonder_indexatie TEXT NOT NULL,
        portefeuille_indexatie_effect TEXT NOT NULL,
        portefeuille_bruto_huur_met_indexatie TEXT NOT NULL,
        portefeuille_huurkorting TEXT NOT NULL,
        portefeuille_netto_huur TEXT NOT NULL,
        portefeuille_netto_huur_belast TEXT NOT NULL,
        portefeuille_netto_huur_onbelast TEXT NOT NULL,
        portefeuille_netto_huur_onbekende_btw TEXT NOT NULL
      )`,
      `CREATE TABLE begroting_frozen_module1_contract (
        begroting_versie_id TEXT NOT NULL,
        contractnummer TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        huurdernummer TEXT NULL,
        huurder_naam TEXT NULL,
        complexnummer TEXT NULL,
        belast_onbelast TEXT NOT NULL CHECK (belast_onbelast IN ('BELAST', 'ONBELAST', 'ONBEKEND')),
        indexatie_percentage_gebruikt TEXT NOT NULL,
        indexatie_percentage_bron TEXT NOT NULL CHECK (indexatie_percentage_bron IN ('ALGEMEEN', 'OVERRIDE')),
        override_scope TEXT NULL CHECK (override_scope IS NULL OR override_scope IN ('VERSIE', 'STRUCTUREEL')),
        override_reden TEXT NULL CHECK (override_scope IS NOT NULL OR override_reden IS NULL),
        effectieve_indexatiedatum TEXT NULL,
        jaartotaal_bruto_huur_zonder_indexatie TEXT NOT NULL,
        jaartotaal_indexatie_effect TEXT NOT NULL,
        jaartotaal_bruto_huur_met_indexatie TEXT NOT NULL,
        jaartotaal_huurkorting TEXT NOT NULL,
        jaartotaal_netto_huur TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, contractnummer),
        UNIQUE (begroting_versie_id, volgnr),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_module1_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_module1_maandregel (
        begroting_versie_id TEXT NOT NULL,
        contractnummer TEXT NOT NULL,
        maand INTEGER NOT NULL CHECK (maand BETWEEN 1 AND 12),
        bruto_huur_zonder_indexatie TEXT NOT NULL,
        indexatie_effect TEXT NOT NULL,
        bruto_huur_met_indexatie TEXT NOT NULL,
        huurkorting TEXT NOT NULL,
        netto_huur TEXT NOT NULL,
        kortingswijziging_toegepast TEXT NULL,
        PRIMARY KEY (begroting_versie_id, contractnummer, maand),
        FOREIGN KEY (begroting_versie_id, contractnummer)
          REFERENCES begroting_frozen_module1_contract(begroting_versie_id, contractnummer) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_module1_control (
        begroting_versie_id TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        contractnummer TEXT NULL,
        ernst TEXT NOT NULL CHECK (ernst IN ('KRITIEK', 'WAARSCHUWING', 'INFORMATIEF')),
        bericht TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, volgnr),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_module1_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_module2_resultaat (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        portefeuille_netto_huur_grondslag TEXT NOT NULL,
        portefeuille_vast_voor_indexatie TEXT NOT NULL,
        portefeuille_vast_indexatie_effect TEXT NOT NULL,
        portefeuille_vast_na_indexatie TEXT NOT NULL,
        portefeuille_variabele_vergoeding TEXT NOT NULL,
        portefeuille_totale_vergoeding TEXT NOT NULL
      )`,
      `CREATE TABLE begroting_frozen_module2_complex (
        begroting_versie_id TEXT NOT NULL,
        complexnummer TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        vast_toegepast INTEGER NOT NULL CHECK (vast_toegepast IN (0, 1)),
        variabel_toegepast INTEGER NOT NULL CHECK (variabel_toegepast IN (0, 1)),
        variabel_percentage_gebruikt TEXT NULL,
        jaartotaal_netto_huur_grondslag TEXT NOT NULL,
        jaartotaal_vast_voor_indexatie TEXT NOT NULL,
        jaartotaal_vast_indexatie_effect TEXT NOT NULL,
        jaartotaal_vast_na_indexatie TEXT NOT NULL,
        jaartotaal_variabele_vergoeding TEXT NOT NULL,
        jaartotaal_totale_vergoeding TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, complexnummer),
        UNIQUE (begroting_versie_id, volgnr),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_module2_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_module2_maandregel (
        begroting_versie_id TEXT NOT NULL,
        complexnummer TEXT NOT NULL,
        maand INTEGER NOT NULL CHECK (maand BETWEEN 1 AND 12),
        vast_voor_indexatie TEXT NOT NULL,
        vast_indexatie_effect TEXT NOT NULL,
        vast_na_indexatie TEXT NOT NULL,
        variabele_vergoeding TEXT NOT NULL,
        totale_vergoeding TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, complexnummer, maand),
        FOREIGN KEY (begroting_versie_id, complexnummer)
          REFERENCES begroting_frozen_module2_complex(begroting_versie_id, complexnummer) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_module2_control (
        begroting_versie_id TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        complexnummer TEXT NULL,
        ernst TEXT NOT NULL CHECK (ernst IN ('KRITIEK', 'WAARSCHUWING', 'INFORMATIEF')),
        bericht TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, volgnr),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_module2_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TRIGGER trg_begroting_frozen_module1_resultaat_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_module1_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module1_resultaat_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_module1_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module1_resultaat_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_module1_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module1_contract_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_module1_contract
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_contract: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module1_contract_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_module1_contract
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_contract: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module1_contract_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_module1_contract
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_contract: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module1_maandregel_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_module1_maandregel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_maandregel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module1_maandregel_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_module1_maandregel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_maandregel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module1_maandregel_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_module1_maandregel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_maandregel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module1_control_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_module1_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module1_control_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_module1_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module1_control_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_module1_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module1_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_resultaat_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_module2_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_resultaat_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_module2_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_resultaat_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_module2_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_complex_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_module2_complex
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_complex: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_complex_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_module2_complex
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_complex: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_complex_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_module2_complex
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_complex: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_maandregel_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_module2_maandregel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_maandregel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_maandregel_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_module2_maandregel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_maandregel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_maandregel_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_module2_maandregel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_maandregel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_control_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_module2_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_control_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_module2_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module2_control_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_module2_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module2_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
    ],
  },
  /**
   * Migratie 6 — Module-3-inputtabel (`BgManagementInvoer`, Managementvergoeding,
   * fase 2C.2). UITSLUITEND de rekeninput van de drie exclusieve wijzen die
   * `packages/reporting/src/begroting/begroteManagementvergoeding.ts` op HEAD
   * kent (`INDEXEER_BESTAAND`/`WIJZIG_BESTAAND_BEDRAG`/`NIEUWE_VERGOEDING`) —
   * nog GEEN frozen Module-3-output (die volgt in een latere, apart te
   * reviewen migratie, fase 2C.4), geen wijziging aan `herberekenen`/
   * `vaststellen`.
   *
   * 1-op-1 met de versie (PK = FK = `begroting_versie_id`, geen apart `id`) —
   * zelfde precedent als `begroting_aannames` (migratie 4): functioneel
   * hoort er maximaal één Module-3-inputrij per versie te bestaan.
   * `begrotingsjaar` staat hier NIET (al write-once op `begrotingsversies`).
   *
   * BUSINESSBESLISSING (2026-09-03, fase 2C.1/2C.2-review): "geen rij" is een
   * eigen, betekenisvolle derde toestand ("nog niet beoordeeld") — expliciet
   * ANDERS dan "wél een rij, met een bedrag van €0" (een bewuste
   * begrotingswaarde). Deze tabel dwingt dat onderscheid af door simpelweg
   * GEEN rij te vereisen tijdens CONCEPT (0..1, geen NOT NULL-kolommen die een
   * default zouden forceren) — nooit een placeholder-rij met `0`-waarden.
   *
   * Kolomnamen volgen de CONCEPTEN, niet de letterlijke TypeScript-veldnamen
   * per invoerwijze: `bestaand_bedrag`/`bestaand_eenheid` dekken zowel
   * `INDEXEER_BESTAAND.bestaandBedrag`+`eenheid` als
   * `WIJZIG_BESTAAND_BEDRAG.bestaandBedrag`+`bestaandEenheid` (beide zijn
   * letterlijk "het bestaande bedrag"); `nieuw_bedrag`/`nieuwe_eenheid` dekken
   * zowel `WIJZIG_BESTAAND_BEDRAG.nieuwBedrag`+`nieuweEenheid` als
   * `NIEUWE_VERGOEDING.bedrag`+`eenheid`. Dit is exact hetzelfde patroon als
   * het reeds goedgekeurde `begroting_complex_config` (migratie 4): één rij,
   * meerdere onafhankelijk-nullable, wijze-/modus-afhankelijke kolommen.
   *
   * CHECK-constraint (`chk_begroting_management_invoer_wijze_kolommen`) dwingt
   * per `wijze` exact af welke kolommen wel/niet mogen zijn ingevuld — de
   * database mag nooit een semantisch onmogelijke combinatie bevatten, ook
   * niet via een rechtstreekse SQL-insert buiten de TypeScript-laag om:
   * - INDEXEER_BESTAAND: bestaand_bedrag/bestaand_eenheid/indexatie_percentage/
   *   indexatiedatum verplicht; nieuw_bedrag/nieuwe_eenheid/ingangsdatum MOET NULL.
   * - WIJZIG_BESTAAND_BEDRAG: bestaand_bedrag/bestaand_eenheid/nieuw_bedrag/
   *   nieuwe_eenheid/ingangsdatum verplicht; indexatie_percentage/indexatiedatum MOET NULL.
   * - NIEUWE_VERGOEDING: nieuw_bedrag/nieuwe_eenheid verplicht; ingangsdatum
   *   optioneel (NULL = vanaf begin begrotingsjaar); bestaand_bedrag/
   *   bestaand_eenheid/indexatie_percentage/indexatiedatum MOET NULL.
   *
   * Immutability: dezelfde drie triggers (INSERT/UPDATE/DELETE geweigerd
   * zodra de bijbehorende `begrotingsversies`-rij `status = 'VASTGESTELD'`
   * heeft) als elke eerdere migratie — bewust hetzelfde simpele,
   * herhaalde WHEN-subquery-patroon, geen generiek triggerframework.
   */
  {
    version: 6,
    description: "Module-3-inputtabel (Managementvergoeding-rekeninvoer)",
    ddl: [
      `CREATE TABLE begroting_management_invoer (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        wijze TEXT NOT NULL CHECK (wijze IN ('INDEXEER_BESTAAND', 'WIJZIG_BESTAAND_BEDRAG', 'NIEUWE_VERGOEDING')),
        bestaand_bedrag TEXT NULL,
        bestaand_eenheid TEXT NULL CHECK (bestaand_eenheid IS NULL OR bestaand_eenheid IN ('MAAND', 'JAAR')),
        nieuw_bedrag TEXT NULL,
        nieuwe_eenheid TEXT NULL CHECK (nieuwe_eenheid IS NULL OR nieuwe_eenheid IN ('MAAND', 'JAAR')),
        indexatie_percentage TEXT NULL,
        indexatiedatum TEXT NULL,
        ingangsdatum TEXT NULL,
        CONSTRAINT chk_begroting_management_invoer_wijze_kolommen CHECK (
          (
            wijze = 'INDEXEER_BESTAAND'
            AND bestaand_bedrag IS NOT NULL AND bestaand_eenheid IS NOT NULL
            AND indexatie_percentage IS NOT NULL AND indexatiedatum IS NOT NULL
            AND nieuw_bedrag IS NULL AND nieuwe_eenheid IS NULL AND ingangsdatum IS NULL
          )
          OR (
            wijze = 'WIJZIG_BESTAAND_BEDRAG'
            AND bestaand_bedrag IS NOT NULL AND bestaand_eenheid IS NOT NULL
            AND nieuw_bedrag IS NOT NULL AND nieuwe_eenheid IS NOT NULL AND ingangsdatum IS NOT NULL
            AND indexatie_percentage IS NULL AND indexatiedatum IS NULL
          )
          OR (
            wijze = 'NIEUWE_VERGOEDING'
            AND nieuw_bedrag IS NOT NULL AND nieuwe_eenheid IS NOT NULL
            AND bestaand_bedrag IS NULL AND bestaand_eenheid IS NULL
            AND indexatie_percentage IS NULL AND indexatiedatum IS NULL
          )
        )
      )`,
      `CREATE TRIGGER trg_begroting_management_invoer_vastgesteld_no_insert
       BEFORE INSERT ON begroting_management_invoer
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_management_invoer: begrotingsversie is VASTGESTELD, Module-3-invoer is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_management_invoer_vastgesteld_no_update
       BEFORE UPDATE ON begroting_management_invoer
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_management_invoer: begrotingsversie is VASTGESTELD, Module-3-invoer is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_management_invoer_vastgesteld_no_delete
       BEFORE DELETE ON begroting_management_invoer
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_management_invoer: begrotingsversie is VASTGESTELD, Module-3-invoer is immutable');
       END`,
    ],
  },
  /**
   * Migratie 7 — bevroren Module-3-OUTPUT (`BgManagementResultaat`, fase
   * 2C.4, exact zoals `packages/reporting/src/begroting/
   * begroteManagementvergoeding.ts` op HEAD die kent). Uitsluitend
   * serialisatie/deserialisatie van een reeds berekend, puur resultaat —
   * geen formules, geen totalen opnieuw afgeleid. Migratie 6 (input) en
   * migratie 7 (output) zijn bewust strikt gescheiden verantwoordelijkheden:
   * de tabellen hier verwijzen NIET naar `begroting_management_invoer` en
   * zijn zelfstandig, volledig terugleesbaar — precies zoals migratie 5 t.o.v.
   * migratie 4 voor Module 1/2.
   *
   * GEEN contract-/complex-tussenlaag: Module 3 heeft, in tegenstelling tot
   * Module 1/2, geen sub-entiteiten — `begroting_frozen_module3_resultaat` is
   * de enige headertabel (1-op-1 met de versie, PK = FK =
   * `begroting_versie_id`), met de 12 maandregels rechtstreeks eraan
   * gekoppeld op de natuurlijke sleutel `(begroting_versie_id, maand)` — GEEN
   * `volgnr` nodig (in tegenstelling tot migratie 5's contract-/complexrijen,
   * die geen natuurlijke unieke sleutel hebben): `maand` (1-12) is zelf al
   * uniek en semantisch betekenisvol, en blijft daarmee ongewijzigd de
   * sorteersleutel bij lezen (`ORDER BY maand`), zelfde principe als migratie
   * 5's eigen maandregeltabellen.
   *
   * `begroting_frozen_module3_control` heeft, net als
   * `begroting_frozen_module1/2_control`, geen natuurlijke unieke sleutel
   * (`BgManagementControleItem` is uitsluitend `{ ernst, bericht }` — geen
   * contractnummer/complexnummer-achtig veld, Module 3 heeft geen
   * sub-entiteit om aan te koppelen) en krijgt daarom hetzelfde bestaande
   * `volgnr`-patroon (exact de arraypositie op schrijfmoment) als bewezen
   * precedent.
   *
   * Kolomindeling op de header, EXPLICIET in twee groepen — nooit door elkaar
   * gehaald, want dit zijn twee verschillende velden van `BgManagementResultaat`:
   * - `invoer_*`: een letterlijke kopie van de toegepaste `invoer:
   *   BgManagementInvoer` (wijze-afhankelijk, nooit een formule om terug te
   *   herleiden uit de resultaatvelden — ook al zijn sommige waarden
   *   mathematisch gerelateerd, frozen output leidt nooit iets opnieuw af).
   * - `resultaat_*`: de TOP-LEVEL afgeleide velden van `BgManagementResultaat`
   *   zelf (`bestaandBedrag`/`nieuwBedrag` als `{maand, jaar}` of `null` —
   *   `null` specifiek wanneer de pure laag het ingevoerde bedrag als
   *   ongeldig heeft afgewezen, zie `geldigBedragEenhedenOfNull` op HEAD;
   *   dat kan dus afwijken van de altijd-aanwezige `invoer_bestaand_bedrag`/
   *   `invoer_nieuw_bedrag`, die de ruwe invoer blijft tonen ongeacht
   *   geldigheid).
   * - `effectieve_indexatiedatum`/`effectieve_ingangsdatum`: eveneens
   *   top-level resultaatvelden, expliciet ANDERS dan `invoer_indexatiedatum`/
   *   `invoer_ingangsdatum` (de ruwe invoerdatum kan afwijken van de
   *   effectieve datum, bv. wanneer de datum buiten het begrotingsjaar valt
   *   en het effect daardoor niet is toegepast — zie de pure module).
   * - `jaartotaal_*`: `BgManagementJaartotalen` (basisBedrag/effect/bedrag),
   *   altijd aanwezig (nooit `null` — een berekening levert altijd een
   *   jaartotaal, ook als dat €0 is).
   *
   * `begrotingsjaar` wordt hier NIET opgeslagen — al write-once op
   * `begrotingsversies` (zelfde precedent als migratie 5).
   *
   * Cascade-keten: begrotingsversies --CASCADE--> *_resultaat (header)
   * --CASCADE--> *_maandregel/*_control (beide rechtstreeks aan de header,
   * geen tussenlaag). Immutability: dezelfde drie triggers per tabel
   * (INSERT/UPDATE/DELETE geweigerd zodra `begrotingsversies.status =
   * 'VASTGESTELD'`) als elke eerdere migratie.
   *
   * `wijze` krijgt een CHECK met de drie bekende enumwaarden (zelfde
   * bescherming als migratie 6). BUSINESSBESLISSING (2026-09-03, review):
   * `begroting_frozen_module3_resultaat` krijgt daarnaast — net als migratie
   * 6's invoertabel — een volledige, wijze-afhankelijke CHECK-constraint op
   * de `invoer_*`-kolommen (`chk_begroting_frozen_module3_resultaat_wijze_
   * kolommen`): het argument "uitsluitend bereikbaar via de getypeerde
   * TypeScript-API" is onvoldoende reden om een databaseconstraint weg te
   * laten — deze architectuur gebruikt bewust twee beschermingslagen
   * (applicatie/API én databaseconstraints/triggers), ook voor bevroren
   * historische gegevens. Deze CHECK bewijst uitsluitend de STRUCTURELE
   * invariant van de invoer-echo per wijze (welke `invoer_*`-kolommen
   * verplicht/NULL moeten zijn) — bewust GEEN validatie van de rekenkundige
   * correctheid van het resultaat zelf (geen "jaartotaal = som maandregels",
   * geen "effect = nieuw − bestaand", geen indexatieberekening): dat blijft
   * de verantwoordelijkheid van de pure rekenlaag en de frozen
   * roundtrip-tests, een CHECK-constraint is er niet voor bedoeld en zou de
   * migratie onnodig complex maken. De `resultaat_*`/`effectieve_*`-kolommen
   * (top-level, wijze-onafhankelijke velden van `BgManagementResultaat`,
   * inclusief hun eigen "ongeldige invoer → null"-semantiek, zie
   * `frozenModule3Resultaat.ts`) blijven bewust buiten deze CHECK — hun
   * geldige combinaties volgen niet uit `wijze` alleen.
   */
  {
    version: 7,
    description: "Bevroren Module-3-output (frozen Managementvergoeding-resultaat)",
    ddl: [
      `CREATE TABLE begroting_frozen_module3_resultaat (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        wijze TEXT NOT NULL CHECK (wijze IN ('INDEXEER_BESTAAND', 'WIJZIG_BESTAAND_BEDRAG', 'NIEUWE_VERGOEDING')),
        invoer_bestaand_bedrag TEXT NULL,
        invoer_bestaand_eenheid TEXT NULL,
        invoer_nieuw_bedrag TEXT NULL,
        invoer_nieuwe_eenheid TEXT NULL,
        invoer_indexatie_percentage TEXT NULL,
        invoer_indexatiedatum TEXT NULL,
        invoer_ingangsdatum TEXT NULL,
        resultaat_bestaand_bedrag_maand TEXT NULL,
        resultaat_bestaand_bedrag_jaar TEXT NULL,
        resultaat_nieuw_bedrag_maand TEXT NULL,
        resultaat_nieuw_bedrag_jaar TEXT NULL,
        effectieve_indexatiedatum TEXT NULL,
        effectieve_ingangsdatum TEXT NULL,
        jaartotaal_basis_bedrag TEXT NOT NULL,
        jaartotaal_effect TEXT NOT NULL,
        jaartotaal_bedrag TEXT NOT NULL,
        CONSTRAINT chk_begroting_frozen_module3_resultaat_wijze_kolommen CHECK (
          (
            wijze = 'INDEXEER_BESTAAND'
            AND invoer_bestaand_bedrag IS NOT NULL AND invoer_bestaand_eenheid IS NOT NULL
            AND invoer_indexatie_percentage IS NOT NULL AND invoer_indexatiedatum IS NOT NULL
            AND invoer_nieuw_bedrag IS NULL AND invoer_nieuwe_eenheid IS NULL AND invoer_ingangsdatum IS NULL
          )
          OR (
            wijze = 'WIJZIG_BESTAAND_BEDRAG'
            AND invoer_bestaand_bedrag IS NOT NULL AND invoer_bestaand_eenheid IS NOT NULL
            AND invoer_nieuw_bedrag IS NOT NULL AND invoer_nieuwe_eenheid IS NOT NULL AND invoer_ingangsdatum IS NOT NULL
            AND invoer_indexatie_percentage IS NULL AND invoer_indexatiedatum IS NULL
          )
          OR (
            wijze = 'NIEUWE_VERGOEDING'
            AND invoer_nieuw_bedrag IS NOT NULL AND invoer_nieuwe_eenheid IS NOT NULL
            AND invoer_bestaand_bedrag IS NULL AND invoer_bestaand_eenheid IS NULL
            AND invoer_indexatie_percentage IS NULL AND invoer_indexatiedatum IS NULL
          )
        )
      )`,
      `CREATE TABLE begroting_frozen_module3_maandregel (
        begroting_versie_id TEXT NOT NULL,
        maand INTEGER NOT NULL CHECK (maand BETWEEN 1 AND 12),
        basis_bedrag TEXT NOT NULL,
        effect TEXT NOT NULL,
        bedrag TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, maand),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_module3_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_module3_control (
        begroting_versie_id TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        ernst TEXT NOT NULL CHECK (ernst IN ('KRITIEK', 'WAARSCHUWING', 'INFORMATIEF')),
        bericht TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, volgnr),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_module3_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TRIGGER trg_begroting_frozen_module3_resultaat_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_module3_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module3_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module3_resultaat_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_module3_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module3_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module3_resultaat_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_module3_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module3_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module3_maandregel_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_module3_maandregel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module3_maandregel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module3_maandregel_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_module3_maandregel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module3_maandregel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module3_maandregel_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_module3_maandregel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module3_maandregel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module3_control_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_module3_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module3_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module3_control_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_module3_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module3_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_module3_control_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_module3_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_module3_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
    ],
  },
  /**
   * Migratie 8 — Gepland Onderhoud, CONCEPT-PERSISTENCE ALLEEN (fase GO-P1,
   * businessbesluiten GO-001 t/m GO-006, pure rekenlaag `@bvc/reporting`'s
   * `begroteGeplandOnderhoud.ts` op HEAD). UITSLUITEND opslag van de door de
   * gebruiker ingevoerde activiteiten + de module-brede `beoordeeld`-vlag —
   * GEEN pure-calculator-integratie, GEEN concept-herberekening, GEEN frozen
   * output, GEEN wijziging aan `herberekenen.ts`/`vaststellen.ts` (die volgen
   * in latere, apart te reviewen migraties, GO-P2/GO-P3).
   *
   * `begroting_gepland_onderhoud_activiteit`: `id INTEGER PRIMARY KEY`
   * (SQLite-rowid) als technische, businessloze sleutel — zelfde precedent
   * als `begroting_contract_override`/`begroting_complex_config` (migratie
   * 4): een geplande onderhoudsactiviteit heeft, anders dan een contract,
   * geen natuurlijke unieke businesssleutel (`complexnummer` is bewust NIET
   * uniek — meerdere activiteiten per complex zijn toegestaan). Index op
   * `begroting_versie_id` voor de veelgebruikte per-versie-lookup.
   *
   * BEWUST GEEN CHECK op `status`/`aanleiding_type`-waarden (in tegenstelling
   * tot elke eerdere migratie se enum-kolommen, bv. migratie 6/7's `wijze`):
   * de pure module (`begroteGeplandOnderhoud.ts`) behandelt een ontbrekende/
   * ongeldige `status`/`aanleidingType` bewust NIET als een rekenfout — het
   * financiële concepttotaal blijft intact, alleen een KRITIEK-control
   * ontstaat (die pas ná GO-P2/GO-P3 vaststellen blokkeert). Een DB-CHECK die
   * alleen de vijf/zes geldige waarden toestaat zou het onmogelijk maken om
   * een functioneel onvolledig CONCEPT (bv. nog geen status gekozen) ooit op
   * te slaan — precies het scenario dat deze architectuur bewust toestaat.
   * `aanleiding_type` is bovendien expliciet NULLABLE (in tegenstelling tot
   * `status`, dat als lege string kan worden opgeslagen maar nooit NULL) —
   * dat asymmetrische onderscheid is een bewuste keuze van deze migratie,
   * geen inconsistentie: beide vormen van "nog niet ingevuld" (NULL resp.
   * lege string) worden door de pure module identiek als ongeldig herkend.
   *
   * `begroting_gepland_onderhoud_module`: 1-op-1 met de versie (PK = FK =
   * `begroting_versie_id`), zelfde vorm als `begroting_aannames`/
   * `begroting_management_invoer`. BEWUST ANDERS dan Module 3's
   * "geen rij = null/onbekend": hier betekent "geen rij" exact hetzelfde als
   * "rij met `beoordeeld = 0`" — er is geen derde toestand te onderscheiden
   * (NOT_REVIEWED ⇔ `beoordeeld = false`, punt, geen aparte "nog nooit
   * aangeraakt"-status nodig zoals Module 3's "nog geen enkele wijze
   * gekozen"). `leesGeplandOnderhoudBeoordeeld` geeft daarom altijd een
   * boolean terug, nooit `null`.
   *
   * Geen kolom voor `jaartotaal`: dat is een AFGELEIDE waarde van de pure
   * module (Q1+Q2+Q3+Q4), nooit authoritative invoer — wordt hier dus niet
   * opgeslagen (consistent met hoe elders in dit package nooit een
   * herleidbare waarde dubbel wordt bewaard).
   *
   * Immutability: dezelfde drie triggers per tabel (INSERT/UPDATE/DELETE
   * geweigerd zodra `begrotingsversies.status = 'VASTGESTELD'`) als elke
   * eerdere migratie — zes triggers totaal voor deze twee tabellen, geen
   * generiek triggerframework.
   */
  {
    version: 8,
    description: "Gepland Onderhoud: concept-input (activiteiten + module-brede beoordeeld-vlag)",
    ddl: [
      `CREATE TABLE begroting_gepland_onderhoud_activiteit (
        id INTEGER PRIMARY KEY,
        begroting_versie_id TEXT NOT NULL REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        complexnummer TEXT NOT NULL,
        omschrijving TEXT NOT NULL,
        aanleiding_type TEXT NULL,
        aanleiding_toelichting TEXT NOT NULL,
        q1 TEXT NOT NULL,
        q2 TEXT NOT NULL,
        q3 TEXT NOT NULL,
        q4 TEXT NOT NULL,
        status TEXT NOT NULL,
        leverancier TEXT NULL,
        offertebedrag TEXT NULL,
        notitie TEXT NULL
      )`,
      `CREATE INDEX idx_begroting_gepland_onderhoud_activiteit_versie ON begroting_gepland_onderhoud_activiteit(begroting_versie_id)`,
      `CREATE TABLE begroting_gepland_onderhoud_module (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        beoordeeld INTEGER NOT NULL CHECK (beoordeeld IN (0, 1))
      )`,
      `CREATE TRIGGER trg_begroting_gepland_onderhoud_activiteit_vastgesteld_no_insert
       BEFORE INSERT ON begroting_gepland_onderhoud_activiteit
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_gepland_onderhoud_activiteit: begrotingsversie is VASTGESTELD, activiteiten zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_gepland_onderhoud_activiteit_vastgesteld_no_update
       BEFORE UPDATE ON begroting_gepland_onderhoud_activiteit
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_gepland_onderhoud_activiteit: begrotingsversie is VASTGESTELD, activiteiten zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_gepland_onderhoud_activiteit_vastgesteld_no_delete
       BEFORE DELETE ON begroting_gepland_onderhoud_activiteit
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_gepland_onderhoud_activiteit: begrotingsversie is VASTGESTELD, activiteiten zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_gepland_onderhoud_module_vastgesteld_no_insert
       BEFORE INSERT ON begroting_gepland_onderhoud_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_gepland_onderhoud_module: begrotingsversie is VASTGESTELD, beoordeeld-vlag is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_gepland_onderhoud_module_vastgesteld_no_update
       BEFORE UPDATE ON begroting_gepland_onderhoud_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_gepland_onderhoud_module: begrotingsversie is VASTGESTELD, beoordeeld-vlag is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_gepland_onderhoud_module_vastgesteld_no_delete
       BEFORE DELETE ON begroting_gepland_onderhoud_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_gepland_onderhoud_module: begrotingsversie is VASTGESTELD, beoordeeld-vlag is immutable');
       END`,
    ],
  },
  /**
   * Migratie 9 — bevroren Gepland-Onderhoud-OUTPUT (fase GO-P3, exact zoals
   * `packages/reporting/src/begroting/begroteGeplandOnderhoud.ts` op HEAD
   * kent). Uitsluitend serialisatie/deserialisatie van een reeds berekend,
   * puur resultaat — geen formules, geen totalen opnieuw afgeleid. Migratie 8
   * (input) en migratie 9 (output) zijn bewust strikt gescheiden
   * verantwoordelijkheden, zelfde precedent als migratie 6/7 voor Module 3:
   * de tabellen hier verwijzen NIET naar `begroting_gepland_onderhoud_
   * activiteit`/`begroting_gepland_onderhoud_module` en zijn zelfstandig,
   * volledig terugleesbaar.
   *
   * VIER TABELLEN (in tegenstelling tot Module 3's ene headertabel): Gepland
   * Onderhoud heeft, anders dan Module 3, WEL sub-entiteiten — activiteiten
   * en complexen — dus volgt hier het Module-1/2-patroon (migratie 5) van een
   * headertabel + child-tabellen, niet Module 3's 1-op-1-patroon.
   *
   * `begroting_frozen_gepland_onderhoud_activiteit`: PK = `(begroting_versie_id,
   * activiteit_id)` — GEEN apart `volgnr` nodig (in tegenstelling tot Module
   * 1's contract-/Module 2's complexrijen): `activiteit_id` is zelf al een
   * stabiele, unieke, monotoon oplopende technische sleutel (GO-P1's SQLite-
   * rowid) die de feitelijke schrijf-/leesvolgorde al ondubbelzinnig
   * vastlegt — een tweede volgordeveld zou hier geen informatie toevoegen.
   *
   * `begroting_frozen_gepland_onderhoud_complex`: WEL een `volgnr`
   * (`UNIQUE (begroting_versie_id, volgnr)`), ondanks dat `complexnummer` een
   * natuurlijke, sorteerbare sleutel is — exact hetzelfde precedent als
   * Module 1's `begroting_frozen_module1_contract`/Module 2's `begroting_
   * frozen_module2_complex` (migratie 5): frozen output bewaart de
   * FEITELIJKE array-volgorde op schrijfmoment, nooit een achteraf op de
   * huidige sorteersemantiek van de pure functie gebaseerde herordening —
   * ook al sorteert `berekenBegroteGeplandOnderhoud` vandaag toevallig al
   * alfabetisch op complexnummer, dat mag in een latere codewijziging nooit
   * stilzwijgend een andere frozen leesvolgorde opleveren.
   *
   * `begroting_frozen_gepland_onderhoud_control`: zelfde `volgnr`-patroon als
   * elke eerdere control-tabel (geen natuurlijke sleutel). `activiteit_id`
   * is NULLABLE (een module-brede control heeft geen activiteit) en bevat,
   * waar van toepassing, het STABIELE persistentie-`id` — NOOIT de tijdelijke
   * pure-calculator-`activiteitIndex` (die correlatie is uitsluitend geldig
   * binnen één functie-aanroep, zie `begroteGeplandOnderhoud.ts`'s
   * moduledoc). De vertaling `activiteitIndex → persistentieId` gebeurt in
   * `frozenGeplandOnderhoudResultaat.ts`'s schrijffunctie, met een defensieve
   * bounds-check (fail-fast, geen stille NULL) — zie dat bestand.
   *
   * ÉÉN q1-q4/jaartotaal-set per activiteit, GEEN aparte `invoer_*`-kolommen
   * (in tegenstelling tot Module 3's `invoer_*`/`resultaat_*`-splitsing,
   * migratie 7): Module 3's splitsing bestaat omdat Module 3's eigen
   * controls vaststellen NOOIT blokkeren (Module 1/2/3-precedent, ongewijzigd
   * — zie `vaststellen.ts`), waardoor een frozen Module-3-rij een ongeldige
   * ingevoerde waarde (naar 0 herleid) kón bevatten naast de oorspronkelijke
   * ruwe invoer. Voor Gepland Onderhoud geldt vanaf GO-P3 juist het
   * omgekeerde: een KRITIEK-control (waaronder een ongeldig/NaN-kwartaal)
   * BLOKKEERT vaststellen (zie `vaststellen.ts`), dus bij elke succesvolle
   * bevriezing zijn de ingevoerde en de berekende kwartaalbedragen per
   * activiteit altijd al aan elkaar gelijk — een aparte `invoer_*`-set zou
   * hier uitsluitend exacte duplicatie zijn, geen aanvullende informatie.
   *
   * FROZEN-STATE INVARIANTEN OP DE HEADER, GEEN VERVANGING VAN DE LIFECYCLE-
   * VALIDATIE (businessbeslissing, correctie 2026-09-04): deze headertabel
   * bestaat per definitie uitsluitend voor een SUCCESVOL VASTGESTELD Gepland-
   * Onderhoud-resultaat — er is geen ander pad waarlangs een rij hier ooit
   * ontstaat. De header krijgt daarom `CHECK (beoordeeld = 1)` en
   * `CHECK (review_status IN ('REVIEWED_ZERO_ACTIVITIES',
   * 'REVIEWED_WITH_ACTIVITIES'))` (nooit `NOT_REVIEWED`) — zelfde precedent
   * als migratie 7's `chk_begroting_frozen_module3_resultaat_wijze_kolommen`-
   * correctie ("uitsluitend bereikbaar via de getypeerde TypeScript-API" is
   * onvoldoende reden om een databaseconstraint weg te laten). Dit zijn GEEN
   * nieuwe businessregels, uitsluitend een structurele bevestiging van een
   * toestand die de applicatielaag (`vaststellen.ts`) al garandeert vóórdat
   * deze functie ooit wordt aangeroepen — de authoritative lifecycle-regel
   * ("beoordeeld moet true zijn, geen KRITIEK") staat en blijft UITSLUITEND
   * in `vaststellen.ts`.
   *
   * DE ACTIVITEITENTABEL krijgt CHECKs op `aanleiding_type`/`status` (beide
   * NOT NULL, geldige enumwaarden) — een ontbrekende/ongeldige waarde zou al
   * een KRITIEK-control en dus een vaststel-blokkade hebben veroorzaakt, dus
   * is op dit punt al bewezen geldig. `complexnummer`/`omschrijving`/
   * `aanleiding_toelichting` blijven bewust ZONDER expliciete "niet-leeg"-
   * CHECK — geen bestaande tabel in dit schema controleert lege strings, dus
   * dat zou een nieuw, ongebruikt controlepatroon introduceren.
   *
   * DE CONTROL-TABEL krijgt BEWUST UITSLUITEND een volledige structurele
   * domein-CHECK op `ernst` (`IN ('KRITIEK', 'WAARSCHUWING', 'INFORMATIEF')`,
   * exact de bestaande `BgControleErnst`-waarden) — GEEN `CHECK (ernst <>
   * 'KRITIEK')` (vroegere, teruggedraaide versie van deze migratie, review-
   * correctie 2026-09-04). Reden: die tweede CHECK zou de lifecycle-regel
   * "KRITIEK blokkeert vaststellen" op databaseniveau DUPLICEREN in plaats
   * van uitsluitend het controle-domein te structureren — `stelBegrotingVast`
   * blijft de ENIGE, authoritative plek die bepaalt of vaststellen mag
   * doorgaan; deze tabel structureert alleen welke `ernst`-waarden geldig
   * zijn, ongeacht welke daarvan de lifecycle-laag toestaat te bevriezen. Bij
   * een correcte vaststelling komt een KRITIEK-control hier feitelijk nooit
   * in terecht — dat is een GEVOLG van `vaststellen.ts`'s validatie, geen
   * eigen regel van deze tabel.
   *
   * Cascade-keten: begrotingsversies --CASCADE--> *_resultaat (header)
   * --CASCADE--> *_activiteit/*_complex/*_control (alle drie rechtstreeks aan
   * de header, geen tussenlaag — Gepland Onderhoud kent geen "activiteit
   * binnen complex"-hiërarchie zoals Module 1's maandregel-binnen-contract).
   *
   * Immutability: dezelfde drie triggers per tabel (INSERT/UPDATE/DELETE
   * geweigerd zodra `begrotingsversies.status = 'VASTGESTELD'`) als elke
   * eerdere migratie — twaalf triggers totaal voor deze vier tabellen, geen
   * generiek triggerframework.
   */
  {
    version: 9,
    description: "Bevroren Gepland-Onderhoud-output (frozen resultaat)",
    ddl: [
      `CREATE TABLE begroting_frozen_gepland_onderhoud_resultaat (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        totaal_q1 TEXT NOT NULL,
        totaal_q2 TEXT NOT NULL,
        totaal_q3 TEXT NOT NULL,
        totaal_q4 TEXT NOT NULL,
        totaal_jaar TEXT NOT NULL,
        totaal_zonder_geldig_complex TEXT NOT NULL,
        beoordeeld INTEGER NOT NULL CHECK (beoordeeld = 1),
        review_status TEXT NOT NULL CHECK (review_status IN ('REVIEWED_ZERO_ACTIVITIES', 'REVIEWED_WITH_ACTIVITIES'))
      )`,
      `CREATE TABLE begroting_frozen_gepland_onderhoud_activiteit (
        begroting_versie_id TEXT NOT NULL,
        activiteit_id INTEGER NOT NULL,
        complexnummer TEXT NOT NULL,
        omschrijving TEXT NOT NULL,
        aanleiding_type TEXT NOT NULL CHECK (aanleiding_type IN ('MJOP', 'INSPECTIE', 'OFFERTE', 'ERVARING_BEHEERDER', 'OVERIG')),
        aanleiding_toelichting TEXT NOT NULL,
        q1 TEXT NOT NULL,
        q2 TEXT NOT NULL,
        q3 TEXT NOT NULL,
        q4 TEXT NOT NULL,
        jaartotaal TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('GEPLAND', 'IN_UITVOERING', 'UITGESTELD', 'VERVALLEN', 'AFGEROND', 'ONVOORZIEN')),
        leverancier TEXT NULL,
        offertebedrag TEXT NULL,
        notitie TEXT NULL,
        PRIMARY KEY (begroting_versie_id, activiteit_id),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_gepland_onderhoud_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_gepland_onderhoud_complex (
        begroting_versie_id TEXT NOT NULL,
        complexnummer TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        aantal_activiteiten INTEGER NOT NULL,
        q1 TEXT NOT NULL,
        q2 TEXT NOT NULL,
        q3 TEXT NOT NULL,
        q4 TEXT NOT NULL,
        jaartotaal TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, complexnummer),
        UNIQUE (begroting_versie_id, volgnr),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_gepland_onderhoud_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_gepland_onderhoud_control (
        begroting_versie_id TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        activiteit_id INTEGER NULL,
        ernst TEXT NOT NULL CHECK (ernst IN ('KRITIEK', 'WAARSCHUWING', 'INFORMATIEF')),
        bericht TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, volgnr),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_gepland_onderhoud_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_resultaat_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_gepland_onderhoud_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_resultaat_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_gepland_onderhoud_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_resultaat_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_gepland_onderhoud_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_activiteit_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_gepland_onderhoud_activiteit
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_activiteit: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_activiteit_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_gepland_onderhoud_activiteit
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_activiteit: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_activiteit_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_gepland_onderhoud_activiteit
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_activiteit: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_complex_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_gepland_onderhoud_complex
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_complex: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_complex_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_gepland_onderhoud_complex
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_complex: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_complex_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_gepland_onderhoud_complex
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_complex: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_control_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_gepland_onderhoud_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_control_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_gepland_onderhoud_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gepland_onderhoud_control_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_gepland_onderhoud_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gepland_onderhoud_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
    ],
  },
  /**
   * Migratie 10 — Correctief/Dagelijks Onderhoud: concept-input (regels +
   * module-brede beoordeeld-vlag), fase CD-P1 (OB-028). Exact hetzelfde
   * structurele patroon als migratie 8 (Gepland Onderhoud concept-input):
   * één child-tabel (regels) + één headertabel (beoordeeld-vlag), zes
   * immutability-triggers (INSERT/UPDATE/DELETE geweigerd zodra
   * `begrotingsversies.status = 'VASTGESTELD'`).
   *
   * KLEINER REGELMODEL DAN GEPLAND ONDERHOUD (bewust, zie
   * `begroteCorrectiefDagelijksOnderhoud.ts`'s moduledoc): geen Q1-Q4 (één
   * `jaarbedrag`), geen `status`/`aanleiding_*`/`leverancier`/
   * `offertebedrag`/`notitie` — die velden horen niet bij dit
   * businessconcept en worden dan ook niet meegenomen.
   *
   * `jaarbedrag TEXT NULL` (in tegenstelling tot migratie 8's `q1..q4 TEXT
   * NOT NULL`): kernontwerpbeslissing OB028-004 — `null` is hier een
   * eersteklas, veelvoorkomende concept-toestand ("nog niet ingevuld"),
   * expliciet onderscheiden van bewust `'0'` (welbewust €0) en van een
   * NaN-Decimal (defensief/corrupt). Geen `DEFAULT '0'` — een ontbrekend
   * jaarbedrag mag nooit stilzwijgend als €0 worden opgeslagen.
   *
   * `complexnummer TEXT NULL` (zelfde nullability als migratie 8's
   * `complexnummer TEXT NOT NULL` in vorm, tegenovergesteld in betekenis):
   * bij Gepland Onderhoud is een ontbrekend complexnummer een KRITIEK-
   * gevalideerde invoerfout; bij Correctief/Dagelijks is `NULL` = NTB
   * (nader te bepalen), een STRUCTUREEL GELDIGE toestand (OB028-003) — er
   * is dan ook geen CHECK op dit veld.
   *
   * Geen enum-CHECK nodig op deze tabellen: in tegenstelling tot migratie
   * 8 (dat `status`/`aanleiding_type` bevat, hier niet aanwezig) kent dit
   * regelmodel geen enumvelden.
   */
  {
    version: 10,
    description: "Correctief/Dagelijks Onderhoud: concept-input (regels + module-brede beoordeeld-vlag)",
    ddl: [
      `CREATE TABLE begroting_correctief_dagelijks_onderhoud_regel (
        id INTEGER PRIMARY KEY,
        begroting_versie_id TEXT NOT NULL REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        omschrijving TEXT NOT NULL,
        complexnummer TEXT NULL,
        jaarbedrag TEXT NULL
      )`,
      `CREATE INDEX idx_begroting_correctief_dagelijks_onderhoud_regel_versie ON begroting_correctief_dagelijks_onderhoud_regel(begroting_versie_id)`,
      `CREATE TABLE begroting_correctief_dagelijks_onderhoud_module (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        beoordeeld INTEGER NOT NULL CHECK (beoordeeld IN (0, 1))
      )`,
      `CREATE TRIGGER trg_begroting_correctief_dagelijks_onderhoud_regel_vastgesteld_no_insert
       BEFORE INSERT ON begroting_correctief_dagelijks_onderhoud_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_correctief_dagelijks_onderhoud_regel: begrotingsversie is VASTGESTELD, regels zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_correctief_dagelijks_onderhoud_regel_vastgesteld_no_update
       BEFORE UPDATE ON begroting_correctief_dagelijks_onderhoud_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_correctief_dagelijks_onderhoud_regel: begrotingsversie is VASTGESTELD, regels zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_correctief_dagelijks_onderhoud_regel_vastgesteld_no_delete
       BEFORE DELETE ON begroting_correctief_dagelijks_onderhoud_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_correctief_dagelijks_onderhoud_regel: begrotingsversie is VASTGESTELD, regels zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_correctief_dagelijks_onderhoud_module_vastgesteld_no_insert
       BEFORE INSERT ON begroting_correctief_dagelijks_onderhoud_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_correctief_dagelijks_onderhoud_module: begrotingsversie is VASTGESTELD, beoordeeld-vlag is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_correctief_dagelijks_onderhoud_module_vastgesteld_no_update
       BEFORE UPDATE ON begroting_correctief_dagelijks_onderhoud_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_correctief_dagelijks_onderhoud_module: begrotingsversie is VASTGESTELD, beoordeeld-vlag is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_correctief_dagelijks_onderhoud_module_vastgesteld_no_delete
       BEFORE DELETE ON begroting_correctief_dagelijks_onderhoud_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_correctief_dagelijks_onderhoud_module: begrotingsversie is VASTGESTELD, beoordeeld-vlag is immutable');
       END`,
    ],
  },
  /**
   * Migratie 11 — bevroren Correctief/Dagelijks-Onderhoud-OUTPUT (fase
   * CD-P3, OB-028), exact zoals `packages/reporting/src/begroting/
   * begroteCorrectiefDagelijksOnderhoud.ts`/`HerberekendCorrectiefDagelijksResultaat`
   * op HEAD kennen. Uitsluitend serialisatie/deserialisatie van een reeds
   * berekend, puur resultaat — geen formules, geen totalen opnieuw
   * afgeleid. Migratie 10 (input) en migratie 11 (output) zijn bewust
   * strikt gescheiden verantwoordelijkheden, zelfde precedent als migratie
   * 8/9 voor Gepland Onderhoud: de tabellen hier verwijzen NIET naar
   * `begroting_correctief_dagelijks_onderhoud_regel`/`_module` en zijn
   * zelfstandig, volledig terugleesbaar.
   *
   * DRIE TABELLEN, GEEN COMPLEX-TABEL (in tegenstelling tot migratie 9's
   * vier tabellen voor Gepland Onderhoud): Correctief/Dagelijks Onderhoud
   * kent bewust geen `perComplex`/`totaalZonderGeldigComplex` (zie
   * `begroteCorrectiefDagelijksOnderhoud.ts`'s moduledoc — complex is hier
   * optioneel/NTB, geen groepeerbare dimensie) — er is dus geen
   * derde child-tabel nodig naast header + regels + controls.
   *
   * `begroting_frozen_correctief_dagelijks_onderhoud_regel`: PK =
   * `(begroting_versie_id, regel_id)` — GEEN apart `volgnr` nodig, exact
   * dezelfde onderbouwing als migratie 9's `begroting_frozen_gepland_
   * onderhoud_activiteit`: `regel_id` is zelf al een stabiele, unieke,
   * monotoon oplopende technische sleutel (CD-P1's SQLite-rowid) die de
   * feitelijke schrijf-/leesvolgorde al ondubbelzinnig vastlegt.
   *
   * `begroting_frozen_correctief_dagelijks_onderhoud_control`: zelfde
   * `volgnr`-patroon als elke eerdere control-tabel (geen natuurlijke
   * sleutel). `regel_id` is NULLABLE (een module-brede control heeft geen
   * regel) en bevat, waar van toepassing, het STABIELE persistentie-`id`
   * — NOOIT de tijdelijke pure-calculator-`regelIndex` (die correlatie is
   * uitsluitend geldig binnen één functie-aanroep, zie
   * `begroteCorrectiefDagelijksOnderhoud.ts`'s moduledoc). De vertaling
   * `regelIndex → persistentieId` gebeurt in
   * `frozenCorrectiefDagelijksOnderhoudResultaat.ts`'s schrijffunctie, met
   * een defensieve bounds-check (fail-fast, geen stille NULL) — zie dat
   * bestand.
   *
   * `jaarbedrag TEXT NOT NULL` op de frozen regeltabel (in tegenstelling
   * tot migratie 10's `jaarbedrag TEXT NULL`): een succesvol bevroren
   * regel is per definitie al door `stelBegrotingVast`'s
   * Correctief/Dagelijks-lifecycle-check heen (geen KRITIEK, dus geen
   * `null`/NaN-jaarbedrag meer mogelijk) — zie migratie 9's identieke
   * redenering voor Gepland Onderhoud se q1-q4-kolommen. GEEN aparte
   * `invoer_jaarbedrag`-kolom naast de berekende waarde: bij een
   * succesvolle bevriezing zijn ingevoerd en berekend bedrag altijd al aan
   * elkaar gelijk (zelfde precedent als migratie 9's moduledoc).
   *
   * FROZEN-STATE INVARIANTEN OP DE HEADER, GEEN VERVANGING VAN DE
   * LIFECYCLE-VALIDATIE (zelfde precedent als migratie 9): deze
   * headertabel bestaat per definitie uitsluitend voor een SUCCESVOL
   * VASTGESTELD Correctief/Dagelijks-resultaat. De header krijgt daarom
   * `CHECK (beoordeeld = 1)` en `CHECK (review_status IN
   * ('REVIEWED_ZERO_RULES', 'REVIEWED_WITH_RULES'))` (nooit
   * `NOT_REVIEWED`) — een structurele bevestiging van een toestand die de
   * applicatielaag (`vaststellen.ts`) al garandeert, geen nieuwe
   * businessregel.
   *
   * DE CONTROL-TABEL krijgt BEWUST UITSLUITEND een volledige structurele
   * domein-CHECK op `ernst` (`IN ('KRITIEK', 'WAARSCHUWING',
   * 'INFORMATIEF')`) — GEEN `CHECK (ernst <> 'KRITIEK')`, exact dezelfde
   * (al eerder teruggedraaide) overweging als migratie 9: die tweede CHECK
   * zou de lifecycle-regel "KRITIEK blokkeert vaststellen" op
   * databaseniveau DUPLICEREN in plaats van uitsluitend het
   * controle-domein te structureren — `stelBegrotingVast` blijft de ENIGE,
   * authoritative plek die bepaalt of vaststellen mag doorgaan.
   *
   * Cascade-keten: begrotingsversies --CASCADE--> *_resultaat (header)
   * --CASCADE--> *_regel/*_control (beide rechtstreeks aan de header, geen
   * tussenlaag).
   *
   * Immutability: dezelfde drie triggers per tabel (INSERT/UPDATE/DELETE
   * geweigerd zodra `begrotingsversies.status = 'VASTGESTELD'`) als elke
   * eerdere migratie — negen triggers totaal voor deze drie tabellen, geen
   * generiek triggerframework.
   */
  {
    version: 11,
    description: "Bevroren Correctief/Dagelijks-Onderhoud-output (frozen resultaat)",
    ddl: [
      `CREATE TABLE begroting_frozen_correctief_dagelijks_onderhoud_resultaat (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        totaal_jaar TEXT NOT NULL,
        beoordeeld INTEGER NOT NULL CHECK (beoordeeld = 1),
        review_status TEXT NOT NULL CHECK (review_status IN ('REVIEWED_ZERO_RULES', 'REVIEWED_WITH_RULES'))
      )`,
      `CREATE TABLE begroting_frozen_correctief_dagelijks_onderhoud_regel (
        begroting_versie_id TEXT NOT NULL,
        regel_id INTEGER NOT NULL,
        omschrijving TEXT NOT NULL,
        complexnummer TEXT NULL,
        jaarbedrag TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, regel_id),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_correctief_dagelijks_onderhoud_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_correctief_dagelijks_onderhoud_control (
        begroting_versie_id TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        regel_id INTEGER NULL,
        ernst TEXT NOT NULL CHECK (ernst IN ('KRITIEK', 'WAARSCHUWING', 'INFORMATIEF')),
        bericht TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, volgnr),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_correctief_dagelijks_onderhoud_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TRIGGER trg_begroting_frozen_correctief_dagelijks_onderhoud_resultaat_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_correctief_dagelijks_onderhoud_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_correctief_dagelijks_onderhoud_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_correctief_dagelijks_onderhoud_resultaat_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_correctief_dagelijks_onderhoud_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_correctief_dagelijks_onderhoud_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_correctief_dagelijks_onderhoud_resultaat_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_correctief_dagelijks_onderhoud_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_correctief_dagelijks_onderhoud_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_correctief_dagelijks_onderhoud_regel_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_correctief_dagelijks_onderhoud_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_correctief_dagelijks_onderhoud_regel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_correctief_dagelijks_onderhoud_regel_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_correctief_dagelijks_onderhoud_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_correctief_dagelijks_onderhoud_regel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_correctief_dagelijks_onderhoud_regel_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_correctief_dagelijks_onderhoud_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_correctief_dagelijks_onderhoud_regel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_correctief_dagelijks_onderhoud_control_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_correctief_dagelijks_onderhoud_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_correctief_dagelijks_onderhoud_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_correctief_dagelijks_onderhoud_control_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_correctief_dagelijks_onderhoud_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_correctief_dagelijks_onderhoud_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_correctief_dagelijks_onderhoud_control_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_correctief_dagelijks_onderhoud_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_correctief_dagelijks_onderhoud_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
    ],
  },
  /**
   * Migratie 12 — Verzekeringen: concept-input (regels + module-brede
   * beoordeeld-vlag), OB-032. Zelfde structurele patroon als migratie 10
   * (Correctief/Dagelijks Onderhoud concept-input): één child-tabel
   * (regels) + één headertabel (beoordeeld-vlag), zes immutability-
   * triggers.
   *
   * ACHT VELDEN, ALLEMAAL NULLABLE BEHALVE `id`/`begroting_versie_id`
   * (OB032-002/009/011): `complexnummer`/`verzekeraar` zijn functioneel
   * VERPLICHT (de pure calculator geeft een KRITIEK-control als ze
   * ontbreken), maar mogen hier tijdelijk NULL zijn — een functioneel
   * onvolledig concept moet opslaanbaar blijven, de lifecycle-blokkade
   * hoort uitsluitend in `vaststellen.ts`, niet als CHECK-constraint hier
   * (zelfde precedent als migratie 8/10's afwezige NOT-NULL-constraints op
   * vergelijkbare velden). `ingangsdatum`/`looptijd_maanden`/`bedrag`/
   * `index_percentage` zijn de vier rekenkritische velden — ook deze
   * bewust NULL-toegestaan, met dezelfde motivatie.
   *
   * Geen enum-CHECK nodig: dit regelmodel kent geen enumvelden (in
   * tegenstelling tot migratie 8's `status`/`aanleiding_type`).
   */
  {
    version: 12,
    description: "Verzekeringen: concept-input (regels + module-brede beoordeeld-vlag)",
    ddl: [
      `CREATE TABLE begroting_verzekering_regel (
        id INTEGER PRIMARY KEY,
        begroting_versie_id TEXT NOT NULL REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        complexnummer TEXT NULL,
        verzekeraar TEXT NULL,
        ingangsdatum TEXT NULL,
        looptijd_maanden INTEGER NULL,
        bedrag TEXT NULL,
        index_percentage TEXT NULL,
        handmatig_begroot_override TEXT NULL
      )`,
      `CREATE INDEX idx_begroting_verzekering_regel_versie ON begroting_verzekering_regel(begroting_versie_id)`,
      `CREATE TABLE begroting_verzekering_module (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        beoordeeld INTEGER NOT NULL CHECK (beoordeeld IN (0, 1))
      )`,
      `CREATE TRIGGER trg_begroting_verzekering_regel_vastgesteld_no_insert
       BEFORE INSERT ON begroting_verzekering_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_verzekering_regel: begrotingsversie is VASTGESTELD, regels zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_verzekering_regel_vastgesteld_no_update
       BEFORE UPDATE ON begroting_verzekering_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_verzekering_regel: begrotingsversie is VASTGESTELD, regels zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_verzekering_regel_vastgesteld_no_delete
       BEFORE DELETE ON begroting_verzekering_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_verzekering_regel: begrotingsversie is VASTGESTELD, regels zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_verzekering_module_vastgesteld_no_insert
       BEFORE INSERT ON begroting_verzekering_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_verzekering_module: begrotingsversie is VASTGESTELD, beoordeeld-vlag is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_verzekering_module_vastgesteld_no_update
       BEFORE UPDATE ON begroting_verzekering_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_verzekering_module: begrotingsversie is VASTGESTELD, beoordeeld-vlag is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_verzekering_module_vastgesteld_no_delete
       BEFORE DELETE ON begroting_verzekering_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_verzekering_module: begrotingsversie is VASTGESTELD, beoordeeld-vlag is immutable');
       END`,
    ],
  },
  /**
   * Migratie 13 — bevroren Verzekeringen-OUTPUT (OB-032), exact zoals
   * `packages/reporting/src/begroting/begroteVerzekeringen.ts`/
   * `HerberekendVerzekeringResultaat` op HEAD kennen. Uitsluitend
   * serialisatie/deserialisatie van een reeds berekend, puur resultaat.
   *
   * DRIE TABELLEN (bewust niet vier): header + regel + control. GEEN
   * aparte child-tabel voor de volledige `relevanteVerlengmomenten`-lijst
   * — alleen het EERSTE relevante verlengmoment is financieel bepalend
   * (OB032-004/005); de volledige lijst is pure-calculator-output die in
   * deze versie niet persistent reproduceerbaar hoeft te zijn (OB032-
   * correctie: "geen aparte child-tabel met alle verlengmomenten bouwen").
   * Op de frozen regel volstaan daarom `eerste_relevante_verlengmoment`
   * (NULL als er geen verlengmoment in dat begrotingsjaar viel) en
   * `aantal_relevante_verlengmomenten` (informatief).
   *
   * `begroting_frozen_verzekering_regel`: PK = `(begroting_versie_id,
   * regel_id)` — GEEN apart `volgnr` nodig, exact dezelfde onderbouwing als
   * migratie 9/11: `regel_id` is zelf al een stabiele, unieke, monotoon
   * oplopende technische sleutel (CONCEPT-SQLite-rowid).
   *
   * ALLE INVOERVELDEN OP DE FROZEN REGEL ZIJN NOT NULL (in tegenstelling
   * tot migratie 12's volledig nullable concept-kolommen): een succesvol
   * bevroren regel is per definitie al door de KRITIEK-blokkade in
   * `vaststellen.ts` heen — `complexnummer`/`verzekeraar`/`ingangsdatum`/
   * `looptijd_maanden`/`bedrag`/`index_percentage` kunnen op dat moment
   * niet meer ontbreken. `handmatig_begroot_override` blijft NULLABLE
   * (een override is en blijft optioneel, ook bij een geldige, vastgestelde
   * regel).
   *
   * `begroting_frozen_verzekering_control`: zelfde `volgnr`-patroon als
   * elke eerdere control-tabel, `regel_id` NULLABLE, domein-CHECK op
   * `ernst` zonder `ernst <> 'KRITIEK'`-duplicatie (zelfde, herhaaldelijk
   * bevestigde overweging als migratie 9/11).
   *
   * FROZEN-STATE INVARIANTEN OP DE HEADER: `CHECK (beoordeeld = 1)` en
   * `CHECK (review_status IN ('REVIEWED_ZERO_POLICIES',
   * 'REVIEWED_WITH_POLICIES'))` (nooit `NOT_REVIEWED`) — structurele
   * bevestiging van een toestand die `vaststellen.ts` al garandeert, geen
   * nieuwe businessregel.
   *
   * Cascade-keten: begrotingsversies --CASCADE--> *_resultaat (header)
   * --CASCADE--> *_regel/*_control.
   *
   * Immutability: dezelfde drie triggers per tabel — negen triggers totaal
   * voor deze drie tabellen.
   */
  {
    version: 13,
    description: "Bevroren Verzekeringen-output (frozen resultaat)",
    ddl: [
      `CREATE TABLE begroting_frozen_verzekering_resultaat (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        totaal_berekend_begroot TEXT NOT NULL,
        totaal_effectief_begroot TEXT NOT NULL,
        beoordeeld INTEGER NOT NULL CHECK (beoordeeld = 1),
        review_status TEXT NOT NULL CHECK (review_status IN ('REVIEWED_ZERO_POLICIES', 'REVIEWED_WITH_POLICIES'))
      )`,
      `CREATE TABLE begroting_frozen_verzekering_regel (
        begroting_versie_id TEXT NOT NULL,
        regel_id INTEGER NOT NULL,
        complexnummer TEXT NOT NULL,
        verzekeraar TEXT NOT NULL,
        ingangsdatum TEXT NOT NULL,
        looptijd_maanden INTEGER NOT NULL,
        bedrag TEXT NOT NULL,
        index_percentage TEXT NOT NULL,
        handmatig_begroot_override TEXT NULL,
        berekend_begroot TEXT NOT NULL,
        effectief_begroot TEXT NOT NULL,
        eerste_relevante_verlengmoment TEXT NULL,
        aantal_relevante_verlengmomenten INTEGER NOT NULL,
        PRIMARY KEY (begroting_versie_id, regel_id),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_verzekering_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_verzekering_control (
        begroting_versie_id TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        regel_id INTEGER NULL,
        ernst TEXT NOT NULL CHECK (ernst IN ('KRITIEK', 'WAARSCHUWING', 'INFORMATIEF')),
        bericht TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, volgnr),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_verzekering_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TRIGGER trg_begroting_frozen_verzekering_resultaat_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_verzekering_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_verzekering_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_verzekering_resultaat_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_verzekering_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_verzekering_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_verzekering_resultaat_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_verzekering_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_verzekering_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_verzekering_regel_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_verzekering_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_verzekering_regel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_verzekering_regel_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_verzekering_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_verzekering_regel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_verzekering_regel_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_verzekering_regel
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_verzekering_regel: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_verzekering_control_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_verzekering_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_verzekering_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_verzekering_control_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_verzekering_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_verzekering_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_verzekering_control_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_verzekering_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_verzekering_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
    ],
  },
  /**
   * Migratie 14 — Gemeentelijke lasten / WOZ: concept-input (module-brede
   * aannames + WOZ-objectregels), OB-033, fase P1.
   *
   * ÉÉN MODULETABEL VOOR AANNAMES + BEOORDEELD SAMEN (bewust anders dan het
   * GO/CD/Verzekeringen-patroon van twee gescheiden bestanden/tabellen):
   * OB-033 se module-brede aannames (`werkelijke_gemeentelijke_lasten`/
   * `woz_stijging_percentage`/`lasten_percentage_stijging`/
   * `begrotings_percentage_override`) en de `beoordeeld`-vlag horen
   * functioneel bij elkaar als één samenhangende module-invoerstaat — zelfde
   * "één complete rij per begrotingsversie"-precedent als Module 3's
   * `begroting_management_invoer` (migratie 6), niet het aparte-
   * beoordeeld-bestand-patroon van Gepland Onderhoud/Correctief-Dagelijks
   * Onderhoud/Verzekeringen (die geen module-brede Decimal-aannames kennen,
   * uitsluitend een vlag).
   *
   * ALLE AANNAMEVELDEN NULLABLE (OB033-019): een functioneel onvolledig
   * concept moet opslaanbaar blijven — `NULL` betekent hier ALTIJD "nog
   * niet ingevuld", nooit stilzwijgend `0`. Zie
   * `begroteGemeentelijkeLasten.ts`'s moduledoc voor de veilige-0-
   * behandeling die hierop volgt in de pure calculator.
   *
   * WOZ-OBJECTREGELS (`begroting_woz_object`): zelfde complete-list-save-
   * stable-ID-patroon als `begroting_verzekering_regel`/`begroting_
   * correctief_dagelijks_onderhoud_regel`. `complexnummer`/`woz_object_
   * adres`/`aanslagjaar`/`waardepeildatum`/`werkelijke_woz` zijn ALLEMAAL
   * NULL-toegestaan (OB033-004/005/019) — een WOZ-object is GEEN unit/
   * contract/boekingsregel (OB033-003) en heeft geen enkele koppeling naar
   * een andere tabel dan de begrotingsversie zelf.
   *
   * Geen enum-CHECK nodig: dit model kent geen enumvelden.
   */
  {
    version: 14,
    description: "Gemeentelijke lasten / WOZ: concept-input (module-brede aannames + WOZ-objectregels)",
    ddl: [
      `CREATE TABLE begroting_gemeentelijke_lasten_module (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        werkelijke_gemeentelijke_lasten TEXT NULL,
        woz_stijging_percentage TEXT NULL,
        lasten_percentage_stijging TEXT NULL,
        begrotings_percentage_override TEXT NULL,
        beoordeeld INTEGER NOT NULL CHECK (beoordeeld IN (0, 1))
      )`,
      `CREATE TABLE begroting_woz_object (
        id INTEGER PRIMARY KEY,
        begroting_versie_id TEXT NOT NULL REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        complexnummer TEXT NULL,
        woz_object_adres TEXT NULL,
        aanslagjaar INTEGER NULL,
        waardepeildatum TEXT NULL,
        werkelijke_woz TEXT NULL,
        verwachte_woz_override TEXT NULL
      )`,
      `CREATE INDEX idx_begroting_woz_object_versie ON begroting_woz_object(begroting_versie_id)`,
      `CREATE TRIGGER trg_begroting_gemeentelijke_lasten_module_vastgesteld_no_insert
       BEFORE INSERT ON begroting_gemeentelijke_lasten_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_gemeentelijke_lasten_module: begrotingsversie is VASTGESTELD, module-invoer is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_gemeentelijke_lasten_module_vastgesteld_no_update
       BEFORE UPDATE ON begroting_gemeentelijke_lasten_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_gemeentelijke_lasten_module: begrotingsversie is VASTGESTELD, module-invoer is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_gemeentelijke_lasten_module_vastgesteld_no_delete
       BEFORE DELETE ON begroting_gemeentelijke_lasten_module
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_gemeentelijke_lasten_module: begrotingsversie is VASTGESTELD, module-invoer is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_woz_object_vastgesteld_no_insert
       BEFORE INSERT ON begroting_woz_object
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_woz_object: begrotingsversie is VASTGESTELD, WOZ-objectregels zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_woz_object_vastgesteld_no_update
       BEFORE UPDATE ON begroting_woz_object
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_woz_object: begrotingsversie is VASTGESTELD, WOZ-objectregels zijn immutable');
       END`,
      `CREATE TRIGGER trg_begroting_woz_object_vastgesteld_no_delete
       BEFORE DELETE ON begroting_woz_object
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_woz_object: begrotingsversie is VASTGESTELD, WOZ-objectregels zijn immutable');
       END`,
    ],
  },
  /**
   * Migratie 15 — bevroren Gemeentelijke-Lasten/WOZ-OUTPUT (OB-033, fase P3),
   * exact zoals `packages/reporting/src/begroting/begroteGemeentelijkeLasten.ts`/
   * `HerberekendGemeentelijkeLastenResultaat` op HEAD kennen. Uitsluitend
   * serialisatie/deserialisatie van een reeds berekend, puur resultaat.
   *
   * VIER TABELLEN (zelfde motivatie als migratie 9's Gepland-Onderhoud-
   * pattern, niet migratie 13's drie-tabellen-pattern): header + WOZ-object
   * + complex + control. Een aparte complex-tabel is hier, ANDERS dan bij
   * Verzekeringen, wél nodig — `perComplex` is een door de pure calculator
   * al aangeleverde, aparte aggregatie (zie `begroteGemeentelijkeLasten.ts`)
   * die zonder eigen tabel bij frozen read zou moeten worden herberekend uit
   * de frozen WOZ-objecten; dat is exact wat sectie 6/8 van deze fase
   * verbiedt ("HERBEREKEN deze waarden bij frozen read NIET").
   *
   * HEADER BEVAT OOK `werkelijke_gemeentelijke_lasten` (input, NIET
   * onderdeel van `BgGemeentelijkeLastenResultaat` zelf — dat type echoot
   * deze aanname bewust niet terug, zie de pure module se eigen
   * moduledoc/testsuite, ONGEWIJZIGD in deze fase). Voor volledige
   * auditability (sectie 4 van deze fase) accepteert
   * `schrijfFrozenGemeentelijkeLastenResultaatZonderTransactie` deze waarde
   * daarom als EXTRA parameter naast het berekende resultaat — een zuivere
   * persistence-laag-toevoeging, geen wijziging van de pure calculator of
   * haar returntype.
   *
   * ALLE VIER MODULE-AANNAMEVELDEN OP DE HEADER BLIJVEN NULLABLE (bewust
   * ANDERS dan Verzekeringen se frozen regel, waar KRITIEK-blokkade alle
   * invoervelden altijd non-null maakt): sinds de OB033-016-correctie
   * (761682d) is `beoordeeld=true` met 0 WOZ-objecten en ALLE vier
   * module-aannames `null` een geldige, KRITIEK-vrije, dus vaststelbare
   * toestand (`REVIEWED_ZERO_OBJECTS`) — zie
   * `begroteGemeentelijkeLasten.ts`'s moduledoc. Een frozen header met deze
   * vier velden NOT NULL zou die geldige toestand niet kunnen bevriezen.
   * `review_status` sluit `NOT_REVIEWED` daarentegen wel expliciet uit
   * (CHECK), zelfde structurele bevestiging als migratie 9/13.
   *
   * `begroting_frozen_woz_object`: PK = `(begroting_versie_id,
   * woz_object_id)` — `woz_object_id` is zelf al een stabiele, unieke,
   * monotoon oplopende technische sleutel (CONCEPT-SQLite-rowid), exact
   * dezelfde onderbouwing als migratie 9/11/13. ALLE ZES INVOERVELDEN
   * (`complexnummer`/`woz_object_adres`/`aanslagjaar`/`waardepeildatum`/
   * `werkelijke_woz`) ZIJN NOT NULL: de KRITIEK-blokkade in `vaststellen.ts`
   * (identiek aan Verzekeringen/Gepland Onderhoud/Correctief-Dagelijks
   * Onderhoud — "beoordeeld moet true zijn, GEEN KRITIEK") sluit een
   * succesvol bevroren WOZ-object met een ontbrekend verplicht veld uit.
   * `verwachte_woz_override` blijft NULLABLE (een override is en blijft
   * optioneel, ook bij een geldig, vastgesteld object).
   *
   * `begroting_frozen_gemeentelijke_lasten_complex`: exact hetzelfde
   * PK/UNIQUE-patroon als migratie 9's `begroting_frozen_gepland_
   * onderhoud_complex` — `PRIMARY KEY (begroting_versie_id,
   * complexnummer)` (de pure calculator aggregeert al per uniek
   * complexnummer, zie de `Map` in `berekenBegroteGemeentelijkeLasten`) met
   * een aparte `UNIQUE (begroting_versie_id, volgnr)` om de oorspronkelijke
   * volgorde deterministisch te kunnen terugleessorteren.
   *
   * `begroting_frozen_gemeentelijke_lasten_control`: zelfde `volgnr`-patroon
   * als elke eerdere control-tabel, `woz_object_id` NULLABLE (module-brede
   * controls, zoals de zero-object-WAARSCHUWING of de totale-WOZ-is-nul-
   * KRITIEK, hebben geen object-koppeling), domein-CHECK op `ernst` zonder
   * `ernst <> 'KRITIEK'`-duplicatie (zelfde, herhaaldelijk bevestigde
   * overweging als migratie 9/11/13 — de KRITIEK-blokkade in
   * `vaststellen.ts` garandeert al dat een succesvol bevroren resultaat
   * geen KRITIEK-controls bevat, dus een CHECK die dat afdwingt zou een
   * businessregel dupliceren, geen nieuwe beschermen).
   *
   * Cascade-keten: begrotingsversies --CASCADE--> *_resultaat (header)
   * --CASCADE--> *_woz_object/*_complex/*_control.
   *
   * Immutability: dezelfde drie triggers per tabel — twaalf triggers totaal
   * voor deze vier tabellen.
   */
  {
    version: 15,
    description: "Bevroren Gemeentelijke-Lasten/WOZ-output (frozen resultaat)",
    ddl: [
      `CREATE TABLE begroting_frozen_gemeentelijke_lasten_resultaat (
        begroting_versie_id TEXT PRIMARY KEY REFERENCES begrotingsversies(id) ON DELETE CASCADE,
        werkelijke_gemeentelijke_lasten TEXT NULL,
        woz_stijging_percentage TEXT NULL,
        lasten_percentage_stijging TEXT NULL,
        begrotings_percentage_override TEXT NULL,
        beoordeeld INTEGER NOT NULL CHECK (beoordeeld = 1),
        review_status TEXT NOT NULL CHECK (review_status IN ('REVIEWED_ZERO_OBJECTS', 'REVIEWED_WITH_OBJECTS')),
        totale_werkelijke_woz TEXT NOT NULL,
        historisch_lasten_percentage TEXT NOT NULL,
        automatisch_begrotings_percentage TEXT NOT NULL,
        effectief_begrotings_percentage TEXT NOT NULL,
        totale_automatisch_verwachte_woz TEXT NOT NULL,
        totale_effectief_verwachte_woz TEXT NOT NULL,
        begrote_gemeentelijke_lasten TEXT NOT NULL
      )`,
      `CREATE TABLE begroting_frozen_woz_object (
        begroting_versie_id TEXT NOT NULL,
        woz_object_id INTEGER NOT NULL,
        complexnummer TEXT NOT NULL,
        woz_object_adres TEXT NOT NULL,
        aanslagjaar INTEGER NOT NULL,
        waardepeildatum TEXT NOT NULL,
        werkelijke_woz TEXT NOT NULL,
        verwachte_woz_override TEXT NULL,
        automatisch_verwachte_woz TEXT NOT NULL,
        effectief_verwachte_woz TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, woz_object_id),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_gemeentelijke_lasten_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_gemeentelijke_lasten_complex (
        begroting_versie_id TEXT NOT NULL,
        complexnummer TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        effectief_verwachte_woz TEXT NOT NULL,
        begrote_gemeentelijke_lasten TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, complexnummer),
        UNIQUE (begroting_versie_id, volgnr),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_gemeentelijke_lasten_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE begroting_frozen_gemeentelijke_lasten_control (
        begroting_versie_id TEXT NOT NULL,
        volgnr INTEGER NOT NULL,
        woz_object_id INTEGER NULL,
        ernst TEXT NOT NULL CHECK (ernst IN ('KRITIEK', 'WAARSCHUWING', 'INFORMATIEF')),
        bericht TEXT NOT NULL,
        PRIMARY KEY (begroting_versie_id, volgnr),
        FOREIGN KEY (begroting_versie_id) REFERENCES begroting_frozen_gemeentelijke_lasten_resultaat(begroting_versie_id) ON DELETE CASCADE
      )`,
      `CREATE TRIGGER trg_begroting_frozen_gemeentelijke_lasten_resultaat_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_gemeentelijke_lasten_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gemeentelijke_lasten_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gemeentelijke_lasten_resultaat_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_gemeentelijke_lasten_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gemeentelijke_lasten_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gemeentelijke_lasten_resultaat_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_gemeentelijke_lasten_resultaat
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gemeentelijke_lasten_resultaat: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_woz_object_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_woz_object
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_woz_object: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_woz_object_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_woz_object
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_woz_object: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_woz_object_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_woz_object
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_woz_object: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gemeentelijke_lasten_complex_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_gemeentelijke_lasten_complex
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gemeentelijke_lasten_complex: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gemeentelijke_lasten_complex_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_gemeentelijke_lasten_complex
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gemeentelijke_lasten_complex: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gemeentelijke_lasten_complex_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_gemeentelijke_lasten_complex
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gemeentelijke_lasten_complex: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gemeentelijke_lasten_control_vastgesteld_no_insert
       BEFORE INSERT ON begroting_frozen_gemeentelijke_lasten_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = NEW.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gemeentelijke_lasten_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gemeentelijke_lasten_control_vastgesteld_no_update
       BEFORE UPDATE ON begroting_frozen_gemeentelijke_lasten_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gemeentelijke_lasten_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
       END`,
      `CREATE TRIGGER trg_begroting_frozen_gemeentelijke_lasten_control_vastgesteld_no_delete
       BEFORE DELETE ON begroting_frozen_gemeentelijke_lasten_control
       FOR EACH ROW
       WHEN (SELECT status FROM begrotingsversies WHERE id = OLD.begroting_versie_id) = 'VASTGESTELD'
       BEGIN
         SELECT RAISE(ABORT, 'begroting_frozen_gemeentelijke_lasten_control: begrotingsversie is VASTGESTELD, frozen output is immutable');
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
