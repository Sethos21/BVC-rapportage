import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { ALGEMENE_KOSTEN_CATEGORIEEN, type BgAlgemeneKostenCategorie } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de handmatige RESTERENDE VERWACHTING per post van Algemene kosten (Accountant, Algemene,
 * Juridische, Makelaars-/taxatie- en Bankkosten) — FO OB-030/035/036, Vervolgtranche 5:
 * `Estimated = Werkelijk t/m afgesloten periode + resterende verwachting`, waarbij de verwachting per post
 * handmatig wordt bepaald ("nog te verwachten kosten"; expliciet €0 = geen kosten meer verwacht).
 *
 * Exact het Estimated-patroon van `verzekeringEstimatedPolissen.ts`/`geplandOnderhoudEstimated.ts` (migratie 34):
 *  - BEWUST GEEN CONCEPT-statuscheck en NOOIT bevroren — Estimated blijft het hele jaar wijzigbaar en muteert de
 *    vastgestelde Begroting nooit (er zijn geen VASTGESTELD-triggers op deze tabel);
 *  - "Geen rij" = nog niet ingevuld (`null`, onbekend — nooit stil €0); een rij bevat altijd een bedrag, dus een
 *    expliciete `Decimal(0)` blijft technisch van "niet ingevuld" te onderscheiden.
 *
 * Niveau = per post (categorie), zoals de bestaande pure `berekenEstimatedAlgemeneKosten` dat vastlegt: Werkelijk
 * komt uit Boekingen op categorieniveau en wordt niet over de begrotingsregels verdeeld.
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

export type AlgemeneKostenEstimatedVerwachting = Record<BgAlgemeneKostenCategorie, Decimal | null>;

function leegVerwachting(): AlgemeneKostenEstimatedVerwachting {
  return Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, null])) as AlgemeneKostenEstimatedVerwachting;
}

interface Row {
  categorie: string;
  resterend_bedrag: string;
}

/** Leest de handmatige resterende verwachting per post; ontbrekende rij = `null` (niet ingevuld). Werkt op elke versiestatus. */
export function leesAlgemeneKostenEstimatedVerwachting(db: DatabaseSync, versieId: string): AlgemeneKostenEstimatedVerwachting {
  const rijen = db
    .prepare(`SELECT categorie, resterend_bedrag FROM begroting_algemene_kosten_estimated_verwachting WHERE begroting_versie_id = ?`)
    .all(versieId) as unknown as Row[];
  const resultaat = leegVerwachting();
  for (const rij of rijen) {
    resultaat[rij.categorie as BgAlgemeneKostenCategorie] = new Decimal(rij.resterend_bedrag);
  }
  return resultaat;
}

/**
 * Schrijft de COMPLETE gewenste verwachting voor alle vijf posten (complete-state save): `Decimal` = handmatige
 * verwachting (ook `0`), `null` = niet ingevuld (een eventueel bestaande rij wordt verwijderd). BEWUST GEEN
 * CONCEPT-check. Faalt vóór elke mutatie op een niet-bestaande versie of een NaN-bedrag.
 */
export function schrijfAlgemeneKostenEstimatedVerwachting(
  db: DatabaseSync,
  versieId: string,
  verwachting: AlgemeneKostenEstimatedVerwachting,
): AlgemeneKostenEstimatedVerwachting {
  for (const categorie of ALGEMENE_KOSTEN_CATEGORIEEN) {
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
      `INSERT INTO begroting_algemene_kosten_estimated_verwachting (begroting_versie_id, categorie, resterend_bedrag)
       VALUES (?, ?, ?)
       ON CONFLICT(begroting_versie_id, categorie) DO UPDATE SET resterend_bedrag = excluded.resterend_bedrag`,
    );
    const verwijder = db.prepare(`DELETE FROM begroting_algemene_kosten_estimated_verwachting WHERE begroting_versie_id = ? AND categorie = ?`);
    for (const categorie of ALGEMENE_KOSTEN_CATEGORIEEN) {
      const bedrag = verwachting[categorie];
      if (bedrag === null) verwijder.run(versieId, categorie);
      else upsert.run(versieId, categorie, bedrag.toString());
    }
    return leesAlgemeneKostenEstimatedVerwachting(db, versieId);
  });
}
