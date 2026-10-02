import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { RENTE_CATEGORIEEN, berekenEstimatedRente, type BgRenteCategorie, type BgRenteResultaat, type EstimatedRenteResultaat, type WerkelijkRenteResultaat } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import { leesFrozenRenteResultaat } from "./frozenRenteResultaat.js";
import { berekenRenteUitInvoer, type HerberekendRenteResultaat } from "./herberekenen.js";
import { leesRenteCategorieState } from "./renteCategorieState.js";
import { leesRenteRegels } from "./renteRegels.js";

/**
 * Persistence voor de handmatige RESTERENDE VERWACHTING per post van Rente (Rentekosten/Rente opbrengsten) —
 * Tranche 10: `Estimated = Werkelijk t/m afgesloten periode + resterende verwachting`. Exact het Estimated-patroon
 * van `algemeneKostenEstimatedVerwachting.ts` (migratie 34/40): BEWUST GEEN CONCEPT-statuscheck en NOOIT bevroren —
 * Estimated blijft het hele jaar wijzigbaar en muteert de vastgestelde Begroting nooit. "Geen rij" = nog niet
 * ingevuld (`null`, onbekend — nooit stil €0); een rij bevat altijd een bedrag.
 *
 * TEKENCONVENTIE (zie `rentePnLAdapters.ts`'s moduledoc, herhaald): deze module legt GEEN eigen betekenis op aan het
 * teken — `resterend_bedrag` wordt ongewijzigd doorgegeven aan `berekenEstimatedRente`, die het optelt bij de RUWE
 * (CAL-FIN-001) `werkelijkTotaal`. Voor RENTE_OPBRENGSTEN betekent dat: een grotere verwachte opbrengst is een
 * NEGATIEVER getal (dezelfde conventie als het reeds bewezen ruwe Werkelijk-saldo van die categorie).
 */

function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const resultaat = fn();
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type RenteEstimatedVerwachting = Record<BgRenteCategorie, Decimal | null>;

function legeVerwachting(): RenteEstimatedVerwachting {
  return Object.fromEntries(RENTE_CATEGORIEEN.map((c) => [c, null])) as RenteEstimatedVerwachting;
}

interface Row {
  categorie: string;
  resterend_bedrag: string;
}

/** Leest de handmatige resterende verwachting per post; ontbrekende rij = `null` (niet ingevuld). Werkt op elke versiestatus. */
export function leesRenteEstimatedVerwachting(db: DatabaseSync, versieId: string): RenteEstimatedVerwachting {
  const rijen = db.prepare(`SELECT categorie, resterend_bedrag FROM begroting_rente_estimated_verwachting WHERE begroting_versie_id = ?`).all(versieId) as unknown as Row[];
  const resultaat = legeVerwachting();
  for (const rij of rijen) {
    resultaat[rij.categorie as BgRenteCategorie] = new Decimal(rij.resterend_bedrag);
  }
  return resultaat;
}

/**
 * Schrijft de COMPLETE gewenste verwachting voor beide posten (complete-state save): `Decimal` = handmatige
 * verwachting (ook `0`), `null` = niet ingevuld (een eventueel bestaande rij wordt verwijderd). BEWUST GEEN
 * CONCEPT-check. Faalt vóór elke mutatie op een niet-bestaande versie of een NaN-bedrag.
 */
export function schrijfRenteEstimatedVerwachting(db: DatabaseSync, versieId: string, verwachting: RenteEstimatedVerwachting): RenteEstimatedVerwachting {
  for (const categorie of RENTE_CATEGORIEEN) {
    const bedrag = verwachting[categorie];
    if (bedrag !== null && bedrag.isNaN()) {
      throw new Error(`Begrotingsversie ${versieId}: ${categorie} heeft een ongeldige (NaN) resterende verwachting — operatie geweigerd.`);
    }
  }

  return withTransaction(db, () => {
    if (leesBegrotingsversie(db, versieId) === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    const upsert = db.prepare(
      `INSERT INTO begroting_rente_estimated_verwachting (begroting_versie_id, categorie, resterend_bedrag)
       VALUES (?, ?, ?)
       ON CONFLICT(begroting_versie_id, categorie) DO UPDATE SET resterend_bedrag = excluded.resterend_bedrag`,
    );
    const verwijder = db.prepare(`DELETE FROM begroting_rente_estimated_verwachting WHERE begroting_versie_id = ? AND categorie = ?`);
    for (const categorie of RENTE_CATEGORIEEN) {
      const bedrag = verwachting[categorie];
      if (bedrag === null) verwijder.run(versieId, categorie);
      else upsert.run(versieId, categorie, bedrag.toString());
    }
    return leesRenteEstimatedVerwachting(db, versieId);
  });
}

/** Herberekend/bevroren resultaat (met regel-ids) terug naar de pure vorm — alleen de regel-uitkomsten worden uitgepakt. */
function naarPureBegroting(b: HerberekendRenteResultaat): BgRenteResultaat {
  return { ...b, perCategorie: b.perCategorie.map((c) => ({ ...c, regels: c.regels.map((r) => r.regel) })) };
}

/** Leest Begroting (volgens lifecycle) + actuele handmatige verwachting in één leestransactie en combineert via de bestaande pure `berekenEstimatedRente`; schrijft nooit. */
export function leesRenteEstimatedResultaat(db: DatabaseSync, versieId: string, werkelijk: WerkelijkRenteResultaat): EstimatedRenteResultaat {
  db.exec("BEGIN");
  let begroting: BgRenteResultaat;
  let verwachting: RenteEstimatedVerwachting;
  try {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status === "VASTGESTELD") {
      const frozen = leesFrozenRenteResultaat(db, versieId);
      if (frozen === null) {
        throw new Error(`Begrotingsversie ${versieId} is VASTGESTELD, maar de bevroren Rente-output ontbreekt (interne inconsistentie).`);
      }
      begroting = naarPureBegroting(frozen);
    } else {
      begroting = naarPureBegroting(berekenRenteUitInvoer(versieId, versie.begrotingsjaar, leesRenteRegels(db, versieId), leesRenteCategorieState(db, versieId)));
    }
    verwachting = leesRenteEstimatedVerwachting(db, versieId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return berekenEstimatedRente(begroting, werkelijk, verwachting);
}
