import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import {
  LEEGSTAND_CATEGORIEEN,
  bepaalLeegstandResterendeVerwachting,
  berekenEstimatedLeegstand,
  type BgLeegstandCategorie,
  type BgLeegstandResultaat,
  type BgOnderhoudKwartaal,
  type EstimatedLeegstandResultaat,
  type LeegstandEstimatedControleItem,
  type LeegstandEstimatedKwartaalInvoer,
  type WerkelijkLeegstandResultaat,
} from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import { leesFrozenLeegstandResultaat } from "./frozenLeegstandResultaat.js";
import { berekenLeegstandUitInvoer, type HerberekendLeegstandResultaat } from "./herberekenen.js";
import { leesLeegstandCategorieState } from "./leegstandCategorieState.js";
import { leesLeegstandRegels } from "./leegstandRegels.js";

/**
 * Estimated Leegstandskosten (Vervolgtranche 8; FO OB-030/031): persistente handmatige resterende verwachting per
 * kostensoort PER KWARTAAL + koppeling met Begroting (concept herberekend / vastgesteld bevroren) en aangeleverd Werkelijk,
 * via de bestaande pure `berekenEstimatedLeegstand`. Exact het Estimated-patroon van `algemeneKostenEstimated*.ts`:
 *  - migratie 37, geen VASTGESTELD-triggers, geen CONCEPT-check, nooit bevroren; geen rij = niet ingevuld (null, nooit €0),
 *    expliciet €0 = bewust;
 *  - Estimated leest de Begroting en muteert haar nooit; Werkelijk telt exact éénmaal (niet over kwartalen verdeeld);
 *  - een bedrag voor een afgesloten kwartaal wordt genegeerd (Werkelijk dekt het) en gemeld.
 * Er is geen koppeling met de servicekostenbegroting, voorschotten of contractdata.
 */

export type LeegstandEstimatedVerwachting = Record<BgLeegstandCategorie, LeegstandEstimatedKwartaalInvoer>;

const KOLOMMEN = ["q1", "q2", "q3", "q4"] as const;

function leegVerwachting(): LeegstandEstimatedVerwachting {
  return Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c) => [c, { q1: null, q2: null, q3: null, q4: null }])) as LeegstandEstimatedVerwachting;
}

/** Leest de handmatige verwachting; ontbrekende rij = `null`. Werkt op elke versiestatus. */
export function leesLeegstandEstimatedVerwachting(db: DatabaseSync, versieId: string): LeegstandEstimatedVerwachting {
  const rijen = db.prepare(`SELECT categorie, kwartaal, bedrag FROM begroting_leegstand_estimated_verwachting WHERE begroting_versie_id = ?`).all(versieId) as unknown as {
    categorie: BgLeegstandCategorie;
    kwartaal: number;
    bedrag: string;
  }[];
  const resultaat = leegVerwachting();
  for (const rij of rijen) {
    resultaat[rij.categorie][KOLOMMEN[rij.kwartaal - 1]!] = new Decimal(rij.bedrag);
  }
  return resultaat;
}

/**
 * Schrijft de COMPLETE gewenste verwachting (3 kostensoorten × 4 kwartalen): `Decimal` = handmatig (ook `0`), `null` = niet
 * ingevuld (een bestaande rij wordt verwijderd). BEWUST GEEN CONCEPT-check. Faalt vóór elke mutatie op een niet-bestaande
 * versie of een NaN-bedrag.
 */
export function schrijfLeegstandEstimatedVerwachting(db: DatabaseSync, versieId: string, verwachting: LeegstandEstimatedVerwachting): LeegstandEstimatedVerwachting {
  for (const categorie of LEEGSTAND_CATEGORIEEN) {
    for (const kolom of KOLOMMEN) {
      const bedrag = verwachting[categorie][kolom];
      if (bedrag !== null && bedrag.isNaN()) {
        throw new Error(`Begrotingsversie ${versieId}: ${categorie} ${kolom.toUpperCase()} heeft een ongeldige (NaN) verwachting — operatie geweigerd.`);
      }
    }
  }
  db.exec("BEGIN");
  try {
    if (leesBegrotingsversie(db, versieId) === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    const upsert = db.prepare(
      `INSERT INTO begroting_leegstand_estimated_verwachting (begroting_versie_id, categorie, kwartaal, bedrag) VALUES (?, ?, ?, ?)
       ON CONFLICT(begroting_versie_id, categorie, kwartaal) DO UPDATE SET bedrag = excluded.bedrag`,
    );
    const verwijder = db.prepare(`DELETE FROM begroting_leegstand_estimated_verwachting WHERE begroting_versie_id = ? AND categorie = ? AND kwartaal = ?`);
    for (const categorie of LEEGSTAND_CATEGORIEEN) {
      KOLOMMEN.forEach((kolom, index) => {
        const bedrag = verwachting[categorie][kolom];
        if (bedrag === null) verwijder.run(versieId, categorie, index + 1);
        else upsert.run(versieId, categorie, index + 1, bedrag.toString());
      });
    }
    const resultaat = leesLeegstandEstimatedVerwachting(db, versieId);
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export interface LeegstandEstimatedResultaat {
  estimated: EstimatedLeegstandResultaat;
  resterendeKwartalen: BgOnderhoudKwartaal[];
  controleVereist: LeegstandEstimatedControleItem[];
}

/** Herberekend/bevroren resultaat (met regel-ids) terug naar de pure vorm — alleen de regel-uitkomsten worden uitgepakt. */
function naarPureBegroting(b: HerberekendLeegstandResultaat): BgLeegstandResultaat {
  return { ...b, perCategorie: b.perCategorie.map((c) => ({ ...c, regels: c.regels.map((r) => r.regel) })) };
}

/** Leest Begroting (volgens lifecycle) + actuele verwachting in één leestransactie en combineert; schrijft nooit. */
export function leesLeegstandEstimatedResultaat(
  db: DatabaseSync,
  versieId: string,
  werkelijk: WerkelijkLeegstandResultaat,
  resterendeKwartalen: readonly BgOnderhoudKwartaal[],
): LeegstandEstimatedResultaat {
  db.exec("BEGIN");
  let begroting: BgLeegstandResultaat;
  let verwachting: LeegstandEstimatedVerwachting;
  try {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status === "VASTGESTELD") {
      const frozen = leesFrozenLeegstandResultaat(db, versieId);
      if (frozen === null) {
        throw new Error(`Begrotingsversie ${versieId} is VASTGESTELD, maar de bevroren Leegstand-output ontbreekt (interne inconsistentie).`);
      }
      begroting = naarPureBegroting(frozen);
    } else {
      begroting = naarPureBegroting(berekenLeegstandUitInvoer(versieId, versie.begrotingsjaar, leesLeegstandRegels(db, versieId), leesLeegstandCategorieState(db, versieId)));
    }
    verwachting = leesLeegstandEstimatedVerwachting(db, versieId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const resterend = bepaalLeegstandResterendeVerwachting(verwachting, resterendeKwartalen);
  return {
    estimated: berekenEstimatedLeegstand(begroting, werkelijk, resterend.verwachtingPerCategorie),
    resterendeKwartalen: resterend.resterendeKwartalen,
    controleVereist: resterend.controleVereist,
  };
}
