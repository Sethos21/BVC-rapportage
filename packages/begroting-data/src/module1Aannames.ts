import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgHuurAannames } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor `BgHuurAannames` — uitsluitend de Module-1-
 * begrotingsaanname (het algemene indexatiepercentage). Functioneel
 * maximaal één set per begrotingsversie (1-op-1, PK = FK =
 * `begroting_versie_id`). `begrotingsjaar` wordt hier NIET opgeslagen — dat
 * staat al write-once op `begrotingsversies` en wordt bij lezen van daar
 * gereconstrueerd (geen tweede authoritative begrotingsjaar).
 */

interface AannamesRow {
  indexatie_percentage: string;
  laatst_afgesloten_boekperiode: string | null;
}

/**
 * Schrijft (of vervangt) de Module-1-aannames voor één begrotingsversie.
 * Faalt vóór elke databasewijziging als de parent niet bestaat, geen
 * CONCEPT is, of `aannames.begrotingsjaar` niet overeenkomt met
 * `begrotingsversies.begrotingsjaar` (de DB bewaart het jaar niet dubbel,
 * dus deze mismatch kan alleen hier, vóór het schrijven, worden herkend).
 * Eén enkele `INSERT … ON CONFLICT … DO UPDATE`-statement — voor een
 * 1-op-1-record is dat al atomair, geen aparte DELETE+INSERT/transactie
 * nodig.
 *
 * `laatstAfgeslotenBoekperiode` (migratie 42, product-readiness fix): het
 * tweede vooraf vastgestelde uitgangspunt van een begrotingsversie, bewust
 * BUITEN `BgHuurAannames` gehouden (dat blijft een pure `@bvc/reporting`-
 * rekentype, geen UI-/periodecontext). `undefined` (het argument weglaten)
 * laat een al opgeslagen waarde ongemoeid — alleen een expliciet meegegeven
 * geldige periode overschrijft hem. Zo kan deze functie voor de bestaande
 * oproepen (uitsluitend `indexatiePercentage` bijwerken) ongewijzigd blijven
 * werken zonder een eerder opgeslagen periode per ongeluk te wissen.
 */
export function schrijfModule1Aannames(db: DatabaseSync, versieId: string, aannames: BgHuurAannames, laatstAfgeslotenBoekperiode?: string | null): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — Module-1-aannames mogen uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }
  if (aannames.begrotingsjaar !== versie.begrotingsjaar) {
    throw new Error(
      `Begrotingsjaar van de aannames (${aannames.begrotingsjaar}) komt niet overeen met het begrotingsjaar van begrotingsversie ${versieId} (${versie.begrotingsjaar}).`,
    );
  }

  db.prepare(
    `INSERT INTO begroting_aannames (begroting_versie_id, indexatie_percentage, laatst_afgesloten_boekperiode)
     VALUES (?, ?, ?)
     ON CONFLICT (begroting_versie_id) DO UPDATE SET
       indexatie_percentage = excluded.indexatie_percentage,
       laatst_afgesloten_boekperiode = COALESCE(excluded.laatst_afgesloten_boekperiode, begroting_aannames.laatst_afgesloten_boekperiode)`,
  ).run(versieId, aannames.indexatiePercentage.toString(), laatstAfgeslotenBoekperiode ?? null);
}

/** Leest de Module-1-aannames voor een begrotingsversie. `null` als de versie niet bestaat óf nog geen aannames heeft (beide legitiem tijdens CONCEPT). */
export function leesModule1Aannames(db: DatabaseSync, versieId: string): BgHuurAannames | null {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    return null;
  }
  const row = db.prepare(`SELECT indexatie_percentage, laatst_afgesloten_boekperiode FROM begroting_aannames WHERE begroting_versie_id = ?`).get(versieId) as unknown as
    | AannamesRow
    | undefined;
  if (row === undefined) {
    return null;
  }
  return {
    begrotingsjaar: versie.begrotingsjaar,
    indexatiePercentage: new Decimal(row.indexatie_percentage),
  };
}

/**
 * Leest uitsluitend de opgeslagen laatst-afgesloten-boekperiode van een begrotingsversie
 * (migratie 42). `null` = nog geen keuze opgeslagen voor deze versie (legacy-versie van vóór deze
 * fix, of nog geen aannames) — de aanroeper moet dan de gebruiker expliciet laten kiezen, nooit
 * een periode verzinnen of uit de huidige datum/`bron_peildatum` afleiden.
 */
export function leesLaatstAfgeslotenBoekperiode(db: DatabaseSync, versieId: string): string | null {
  const row = db.prepare(`SELECT laatst_afgesloten_boekperiode FROM begroting_aannames WHERE begroting_versie_id = ?`).get(versieId) as unknown as
    | { laatst_afgesloten_boekperiode: string | null }
    | undefined;
  return row?.laatst_afgesloten_boekperiode ?? null;
}
