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
 */
export function schrijfModule1Aannames(db: DatabaseSync, versieId: string, aannames: BgHuurAannames): void {
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
    `INSERT INTO begroting_aannames (begroting_versie_id, indexatie_percentage)
     VALUES (?, ?)
     ON CONFLICT (begroting_versie_id) DO UPDATE SET indexatie_percentage = excluded.indexatie_percentage`,
  ).run(versieId, aannames.indexatiePercentage.toString());
}

/** Leest de Module-1-aannames voor een begrotingsversie. `null` als de versie niet bestaat óf nog geen aannames heeft (beide legitiem tijdens CONCEPT). */
export function leesModule1Aannames(db: DatabaseSync, versieId: string): BgHuurAannames | null {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    return null;
  }
  const row = db.prepare(`SELECT indexatie_percentage FROM begroting_aannames WHERE begroting_versie_id = ?`).get(versieId) as unknown as
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
