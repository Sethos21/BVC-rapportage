import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * DELTA BUILD 2 (2026-09-24, FO/UX-conformering): persistentie voor
 * Estimated Gepland Onderhoud — UITSLUITEND opslag van de handmatig
 * vastgelegde Estimated-invoer (resterende kwartaalverwachting per bestaande
 * activiteit + Estimated-only activiteiten). GEEN pure-calculator-integratie
 * (`@bvc/reporting`'s `berekenEstimatedGeplandOnderhoud` wordt hier NERGENS
 * aangeroepen) — dat zou volledige orchestratie zijn, expliciet buiten scope
 * van deze delta. GEEN frozen output: Estimated wordt, exact zoals
 * Geplande-Verkoop-Estimated (`geplandeVerkoopEstimatedRegels.ts`, migratie
 * 22), NOOIT bevroren — zie migratie 27's moduledoc voor de volledige
 * onderbouwing.
 *
 * BEWUST GEEN CONCEPT-STATUSCHECK (anders dan `geplandOnderhoudActiviteiten.ts`):
 * Estimated is een onafhankelijk bijgewerkte actuele verwachting die na
 * vaststellen van de Begroting moet kunnen blijven bewegen — zelfde
 * architectuurkeuze als Geplande-Verkoop-Estimated. Alleen het bestaan van de
 * begrotingsversie wordt gecontroleerd.
 *
 * RESTERENDE VERWACHTING: 1-OP-1 MET EEN BESTAANDE ACTIVITEIT, GEEN
 * SURROGAATSLEUTEL — `activiteit_id` is zowel PRIMARY KEY als FK (ON DELETE
 * CASCADE) in `begroting_gepland_onderhoud_estimated_verwachting` (migratie
 * 27): een activiteit heeft ten hoogste ÉÉN resterende-verwachtingsrij, dus
 * een aparte, eigen `id` zou een overbodige, nooit-gebruikte
 * businessidentiteit introduceren (zie stopcriteria van de opdracht).
 * `schrijfGeplandOnderhoudEstimatedVerwachtingen` is daarom een UPSERT-
 * complete-list-save gekeyed op `activiteitId`, GEEN `id: null`/`id: number`-
 * onderscheid zoals elders in dit package.
 *
 * ESTIMATED-ONLY ACTIVITEITEN: exact hetzelfde `id: null`/`id: number`-
 * complete-list-save-patroon als `geplandOnderhoudActiviteiten.ts` (GO-P1) —
 * zie dat bestand voor de volledige onderbouwing van de transactiegrens en de
 * versie-isolatie; hier uitsluitend de verschillen (kleiner veldmodel, geen
 * CONCEPT-check).
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

// ===== Resterende verwachting (1-op-1 met een bestaande activiteit) =====

export interface GeplandOnderhoudEstimatedVerwachtingInvoer {
  activiteitId: number;
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
}

export interface GeplandOnderhoudEstimatedVerwachting {
  activiteitId: number;
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
}

interface VerwachtingRow {
  activiteit_id: number;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
}

function rowToVerwachting(row: VerwachtingRow): GeplandOnderhoudEstimatedVerwachting {
  return {
    activiteitId: row.activiteit_id,
    q1: new Decimal(row.q1),
    q2: new Decimal(row.q2),
    q3: new Decimal(row.q3),
    q4: new Decimal(row.q4),
  };
}

/** Leest alle resterende-verwachtingsrijen van een begrotingsversie, `ORDER BY activiteit_id` — technische, deterministische leesvolgorde. */
export function leesGeplandOnderhoudEstimatedVerwachtingen(db: DatabaseSync, versieId: string): readonly GeplandOnderhoudEstimatedVerwachting[] {
  const rijen = db
    .prepare(
      `SELECT activiteit_id, q1, q2, q3, q4
       FROM begroting_gepland_onderhoud_estimated_verwachting
       WHERE begroting_versie_id = ?
       ORDER BY activiteit_id`,
    )
    .all(versieId) as unknown as VerwachtingRow[];
  return rijen.map(rowToVerwachting);
}

/**
 * Schrijft de COMPLETE gewenste resterende-verwachtingenlijst voor één
 * begrotingsversie (UPSERT-complete-list-save, gekeyed op `activiteitId` —
 * zie moduledoc). Faalt vóór elke mutatie als de parent niet bestaat, een
 * meegegeven `activiteitId` niet bestaat, bij een ANDERE begrotingsversie
 * hoort, of dubbel voorkomt in dezelfde aanroep. BEWUST GEEN CONCEPT-check.
 */
export function schrijfGeplandOnderhoudEstimatedVerwachtingen(
  db: DatabaseSync,
  versieId: string,
  verwachtingen: readonly GeplandOnderhoudEstimatedVerwachtingInvoer[],
): readonly GeplandOnderhoudEstimatedVerwachting[] {
  const activiteitIds = verwachtingen.map((v) => v.activiteitId);
  const duplicaten = [...new Set(activiteitIds.filter((id, index) => activiteitIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Begrotingsversie ${versieId}: dezelfde activiteit-id komt meerdere keren voor in één Estimated-verwachting-save (${duplicaten.join(", ")}) — operatie geweigerd.`,
    );
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }

    if (activiteitIds.length > 0) {
      const placeholders = activiteitIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_gepland_onderhoud_activiteit WHERE id IN (${placeholders})`)
        .all(...activiteitIds) as unknown as { id: number; begroting_versie_id: string }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of activiteitIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: activiteit-id ${id} bestaat niet — Estimated-verwachting-operatie geweigerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(
            `Begrotingsversie ${versieId}: activiteit-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — Estimated-verwachting-operatie geweigerd.`,
          );
        }
      }
    }

    const behoudenIds = new Set(activiteitIds);
    const huidigeRijen = db
      .prepare(`SELECT activiteit_id FROM begroting_gepland_onderhoud_estimated_verwachting WHERE begroting_versie_id = ?`)
      .all(versieId) as unknown as { activiteit_id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.activiteit_id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_gepland_onderhoud_estimated_verwachting WHERE begroting_versie_id = ? AND activiteit_id IN (${placeholders})`).run(
        versieId,
        ...teVerwijderen,
      );
    }

    const upsertStmt = db.prepare(
      `INSERT INTO begroting_gepland_onderhoud_estimated_verwachting (activiteit_id, begroting_versie_id, q1, q2, q3, q4)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(activiteit_id) DO UPDATE SET q1 = excluded.q1, q2 = excluded.q2, q3 = excluded.q3, q4 = excluded.q4`,
    );
    for (const verwachting of verwachtingen) {
      upsertStmt.run(verwachting.activiteitId, versieId, verwachting.q1.toString(), verwachting.q2.toString(), verwachting.q3.toString(), verwachting.q4.toString());
    }

    return leesGeplandOnderhoudEstimatedVerwachtingen(db, versieId);
  });
}

// ===== Estimated-only activiteiten =====

/** `id: null` = nieuwe Estimated-only activiteit. `id: number` = een bestaande Estimated-only activiteit die aantoonbaar bij DEZE begrotingsversie moet horen. */
export interface GeplandOnderhoudEstimatedOnlyActiviteitInvoer {
  id: number | null;
  complexnummer: string;
  omschrijving: string;
  grootboekrekening: string;
  ogbKostensoort: string | null;
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
}

export interface GeplandOnderhoudEstimatedOnlyActiviteit {
  id: number;
  complexnummer: string;
  omschrijving: string;
  grootboekrekening: string;
  ogbKostensoort: string | null;
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
}

interface EstimatedOnlyActiviteitRow {
  id: number;
  complexnummer: string;
  omschrijving: string;
  grootboekrekening: string;
  ogb_kostensoort: string | null;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
}

function rowToEstimatedOnlyActiviteit(row: EstimatedOnlyActiviteitRow): GeplandOnderhoudEstimatedOnlyActiviteit {
  return {
    id: row.id,
    complexnummer: row.complexnummer,
    omschrijving: row.omschrijving,
    grootboekrekening: row.grootboekrekening,
    ogbKostensoort: row.ogb_kostensoort,
    q1: new Decimal(row.q1),
    q2: new Decimal(row.q2),
    q3: new Decimal(row.q3),
    q4: new Decimal(row.q4),
  };
}

/** Leest alle Estimated-only activiteiten van een begrotingsversie, `ORDER BY id`. */
export function leesGeplandOnderhoudEstimatedOnlyActiviteiten(db: DatabaseSync, versieId: string): readonly GeplandOnderhoudEstimatedOnlyActiviteit[] {
  const rijen = db
    .prepare(
      `SELECT id, complexnummer, omschrijving, grootboekrekening, ogb_kostensoort, q1, q2, q3, q4
       FROM begroting_gepland_onderhoud_estimated_only_activiteit
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as EstimatedOnlyActiviteitRow[];
  return rijen.map(rowToEstimatedOnlyActiviteit);
}

/**
 * Schrijft de COMPLETE gewenste Estimated-only-activiteitenlijst voor één
 * begrotingsversie (complete-list-save — zelfde patroon als
 * `geplandOnderhoudActiviteiten.ts`, maar BEWUST GEEN CONCEPT-check, zie
 * moduledoc).
 */
export function schrijfGeplandOnderhoudEstimatedOnlyActiviteiten(
  db: DatabaseSync,
  versieId: string,
  activiteiten: readonly GeplandOnderhoudEstimatedOnlyActiviteitInvoer[],
): readonly GeplandOnderhoudEstimatedOnlyActiviteit[] {
  const bestaandeIds = activiteiten.map((a) => a.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Begrotingsversie ${versieId}: dezelfde bestaande Estimated-only-activiteit-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd.`,
    );
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_gepland_onderhoud_estimated_only_activiteit WHERE id IN (${placeholders})`)
        .all(...bestaandeIds) as unknown as { id: number; begroting_versie_id: string }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: Estimated-only-activiteit-id ${id} bestaat niet — operatie geweigerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(
            `Begrotingsversie ${versieId}: Estimated-only-activiteit-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd.`,
          );
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db
      .prepare(`SELECT id FROM begroting_gepland_onderhoud_estimated_only_activiteit WHERE begroting_versie_id = ?`)
      .all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_gepland_onderhoud_estimated_only_activiteit WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(
        versieId,
        ...teVerwijderen,
      );
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_gepland_onderhoud_estimated_only_activiteit
       SET complexnummer = ?, omschrijving = ?, grootboekrekening = ?, ogb_kostensoort = ?, q1 = ?, q2 = ?, q3 = ?, q4 = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_gepland_onderhoud_estimated_only_activiteit
         (begroting_versie_id, complexnummer, omschrijving, grootboekrekening, ogb_kostensoort, q1, q2, q3, q4)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const activiteit of activiteiten) {
      if (activiteit.id === null) {
        insertStmt.run(
          versieId,
          activiteit.complexnummer,
          activiteit.omschrijving,
          activiteit.grootboekrekening,
          activiteit.ogbKostensoort,
          activiteit.q1.toString(),
          activiteit.q2.toString(),
          activiteit.q3.toString(),
          activiteit.q4.toString(),
        );
        continue;
      }

      const info = updateStmt.run(
        activiteit.complexnummer,
        activiteit.omschrijving,
        activiteit.grootboekrekening,
        activiteit.ogbKostensoort,
        activiteit.q1.toString(),
        activiteit.q2.toString(),
        activiteit.q3.toString(),
        activiteit.q4.toString(),
        activiteit.id,
        versieId,
      );
      if (Number(info.changes) !== 1) {
        throw new Error(
          `Begrotingsversie ${versieId}: Estimated-only-activiteit-id ${activiteit.id} kon niet worden bijgewerkt (0 rijen geraakt) — operatie geweigerd, transactie wordt teruggedraaid.`,
        );
      }
    }

    return leesGeplandOnderhoudEstimatedOnlyActiviteiten(db, versieId);
  });
}
