import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor Geplande-Verkoop-Estimated-regels — OB-039. ZELFDE
 * regelvorm als `geplandeVerkoopRegels.ts` (zie dat bestand voor de
 * veld-voor-veld-onderbouwing), maar STRUCTUREEL EEN ANDERE TABEL, bewust
 * NOOIT bevroren en NOOIT geblokkeerd door de CONCEPT/VASTGESTELD-lifecycle
 * van de ouder-begrotingsversie.
 *
 * WAAROM EEN EIGEN TABEL ZONDER VASTGESTELD-IMMUTABILITY (architecturale
 * afwijking van ALLE andere versie-gebonden regeltabellen in dit pakket,
 * zie migratie 22's moduledoc): Estimated is per OB-039-businessbesluit
 * (sectie 6) een ONAFHANKELIJK bijgewerkte actuele verwachting — "Actuele
 * Estimated/Werkelijk-waarden blijven rapportagewaarden en mogen buiten het
 * frozen begrotingssnapshot bewegen". Bij elke andere module is Werkelijk/
 * Estimated een LIVE BEREKENING (nooit gepersisteerd), dus die vraag speelt
 * daar niet. Hier is Estimated wél gestructureerde, door de gebruiker
 * ingevoerde data (geen boekingen om uit te berekenen) — die moet dus WEL
 * persistent zijn, maar mag NOOIT de CONCEPT/VASTGESTELD-blokkade van de
 * Begroting-regels overerven, anders zou "de actuele verwachting bijstellen
 * na vaststellen" onmogelijk worden — in strijd met sectie 6/7.
 *
 * Blijft wel gebonden aan het bestaan van de begrotingsversie (FK ON DELETE
 * CASCADE, zie migratie 22) — verwijderen van de CONCEPT-ouderversie
 * cascadeert ook de Estimated-regels weg, net als elke andere versie-
 * gebonden tabel. Alleen de STATUS-check (CONCEPT vereist) ontbreekt hier
 * bewust.
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

export interface GeplandeVerkoopEstimatedRegelInvoer {
  id: number | null;
  objectreferentie: string;
  omschrijving: string;
  geplandeVerkoopdatum: Date | null;
  verwachteVerkoopopbrengst: Decimal | null;
  verwachteBoekwaarde: Decimal | null;
  verwachteVerkoopkosten: Decimal | null;
  verwachteEinddatumHuurExploitatie: Date | null;
  toelichting: string | null;
}

export interface GeplandeVerkoopEstimatedRegel {
  id: number;
  objectreferentie: string;
  omschrijving: string;
  geplandeVerkoopdatum: Date | null;
  verwachteVerkoopopbrengst: Decimal | null;
  verwachteBoekwaarde: Decimal | null;
  verwachteVerkoopkosten: Decimal | null;
  verwachteEinddatumHuurExploitatie: Date | null;
  toelichting: string | null;
}

interface RegelRow {
  id: number;
  objectreferentie: string;
  omschrijving: string;
  geplande_verkoopdatum: string | null;
  verwachte_verkoopopbrengst: string | null;
  verwachte_boekwaarde: string | null;
  verwachte_verkoopkosten: string | null;
  verwachte_einddatum_huur_exploitatie: string | null;
  toelichting: string | null;
}

function rowToRegel(row: RegelRow): GeplandeVerkoopEstimatedRegel {
  return {
    id: row.id,
    objectreferentie: row.objectreferentie,
    omschrijving: row.omschrijving,
    geplandeVerkoopdatum: row.geplande_verkoopdatum !== null ? new Date(row.geplande_verkoopdatum) : null,
    verwachteVerkoopopbrengst: row.verwachte_verkoopopbrengst !== null ? new Decimal(row.verwachte_verkoopopbrengst) : null,
    verwachteBoekwaarde: row.verwachte_boekwaarde !== null ? new Decimal(row.verwachte_boekwaarde) : null,
    verwachteVerkoopkosten: row.verwachte_verkoopkosten !== null ? new Decimal(row.verwachte_verkoopkosten) : null,
    verwachteEinddatumHuurExploitatie: row.verwachte_einddatum_huur_exploitatie !== null ? new Date(row.verwachte_einddatum_huur_exploitatie) : null,
    toelichting: row.toelichting,
  };
}

/** Leest alle Estimated-regels van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde. */
export function leesGeplandeVerkoopEstimatedRegels(db: DatabaseSync, versieId: string): readonly GeplandeVerkoopEstimatedRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, objectreferentie, omschrijving, geplande_verkoopdatum, verwachte_verkoopopbrengst, verwachte_boekwaarde, verwachte_verkoopkosten, verwachte_einddatum_huur_exploitatie, toelichting
       FROM begroting_geplande_verkoop_estimated_regel
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as RegelRow[];
  return rijen.map(rowToRegel);
}

/**
 * Schrijft de COMPLETE gewenste Estimated-regellijst voor één
 * begrotingsversie (complete-list save). ANDERS DAN
 * `schrijfGeplandeVerkoopRegels`: GEEN CONCEPT-statuscheck — mag ALTIJD
 * worden geschreven zolang de begrotingsversie bestaat, ook ná vaststellen
 * (zie moduledoc). Faalt vóór elke mutatie als de parent niet bestaat, een
 * meegegeven bestaande `id` niet bestaat, bij een ANDERE begrotingsversie
 * hoort, of dubbel voorkomt in dezelfde aanroep.
 */
export function schrijfGeplandeVerkoopEstimatedRegels(
  db: DatabaseSync,
  versieId: string,
  regels: readonly GeplandeVerkoopEstimatedRegelInvoer[],
): readonly GeplandeVerkoopEstimatedRegel[] {
  const bestaandeIds = regels.map((r) => r.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(`Begrotingsversie ${versieId}: dezelfde bestaande Estimated-regel-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd, geen "laatste wint".`);
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    // BEWUST GEEN status===CONCEPT-check (zie moduledoc): Estimated blijft altijd bewerkbaar.

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db.prepare(`SELECT id, begroting_versie_id FROM begroting_geplande_verkoop_estimated_regel WHERE id IN (${placeholders})`).all(...bestaandeIds) as unknown as {
        id: number;
        begroting_versie_id: string;
      }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: Estimated-regel-id ${id} bestaat niet — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(`Begrotingsversie ${versieId}: Estimated-regel-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db.prepare(`SELECT id FROM begroting_geplande_verkoop_estimated_regel WHERE begroting_versie_id = ?`).all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_geplande_verkoop_estimated_regel WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(versieId, ...teVerwijderen);
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_geplande_verkoop_estimated_regel
       SET objectreferentie = ?, omschrijving = ?, geplande_verkoopdatum = ?, verwachte_verkoopopbrengst = ?, verwachte_boekwaarde = ?, verwachte_verkoopkosten = ?, verwachte_einddatum_huur_exploitatie = ?, toelichting = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_geplande_verkoop_estimated_regel
         (begroting_versie_id, objectreferentie, omschrijving, geplande_verkoopdatum, verwachte_verkoopopbrengst, verwachte_boekwaarde, verwachte_verkoopkosten, verwachte_einddatum_huur_exploitatie, toelichting)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const regel of regels) {
      const geplandeVerkoopdatum = regel.geplandeVerkoopdatum !== null ? regel.geplandeVerkoopdatum.toISOString() : null;
      const verwachteVerkoopopbrengst = regel.verwachteVerkoopopbrengst !== null ? regel.verwachteVerkoopopbrengst.toString() : null;
      const verwachteBoekwaarde = regel.verwachteBoekwaarde !== null ? regel.verwachteBoekwaarde.toString() : null;
      const verwachteVerkoopkosten = regel.verwachteVerkoopkosten !== null ? regel.verwachteVerkoopkosten.toString() : null;
      const verwachteEinddatumHuurExploitatie = regel.verwachteEinddatumHuurExploitatie !== null ? regel.verwachteEinddatumHuurExploitatie.toISOString() : null;

      if (regel.id === null) {
        insertStmt.run(
          versieId,
          regel.objectreferentie,
          regel.omschrijving,
          geplandeVerkoopdatum,
          verwachteVerkoopopbrengst,
          verwachteBoekwaarde,
          verwachteVerkoopkosten,
          verwachteEinddatumHuurExploitatie,
          regel.toelichting,
        );
        continue;
      }

      const info = updateStmt.run(
        regel.objectreferentie,
        regel.omschrijving,
        geplandeVerkoopdatum,
        verwachteVerkoopopbrengst,
        verwachteBoekwaarde,
        verwachteVerkoopkosten,
        verwachteEinddatumHuurExploitatie,
        regel.toelichting,
        regel.id,
        versieId,
      );
      if (Number(info.changes) !== 1) {
        throw new Error(
          `Begrotingsversie ${versieId}: Estimated-regel-id ${regel.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`,
        );
      }
    }

    return leesGeplandeVerkoopEstimatedRegels(db, versieId);
  });
}
