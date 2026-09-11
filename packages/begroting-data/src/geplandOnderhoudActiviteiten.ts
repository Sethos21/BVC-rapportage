import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor Gepland-Onderhoud-activiteiten — fase GO-P1, UITSLUITEND
 * concept-input. GEEN pure-calculator-integratie (`@bvc/reporting`'s
 * `berekenBegroteGeplandOnderhoud` wordt hier NERGENS aangeroepen), GEEN
 * concept-herberekening, GEEN frozen output — die volgen in latere, apart te
 * reviewen migraties/fases (GO-P2/GO-P3).
 *
 * BEWUST GEEN `@bvc/reporting`-types (`BgGeplandOnderhoudAanleidingType`/
 * `BgGeplandOnderhoudStatus`) hergebruikt voor `aanleidingType`/`status` —
 * anders dan elders in dit package (bv. `module3Invoer.ts` hergebruikt wél
 * `BgManagementInvoer`). Reden: die pure-module-types zijn gesloten
 * TypeScript-unions die alleen geldige waarden toestaan, terwijl deze tabel
 * (migratie 8) bewust GEEN CHECK-constraint op deze kolommen heeft — een
 * functioneel onvolledig CONCEPT (nog geen status/aanleiding gekozen) moet
 * hier opslaanbaar blijven. `string`/`string | null` is dus het eerlijke,
 * correcte type op deze laag; de koppeling met de pure module se enums komt
 * pas in GO-P2.
 *
 * VERSIE-ISOLATIE (businesscorrectie, expliciet vastgesteld): een bestaande
 * activiteit-`id` mag NOOIT gebruikt worden om een rij van een ANDERE
 * begrotingsversie te wijzigen. Een onbekende id, een id van een andere
 * versie, of een dubbele id binnen dezelfde aanroep leidt tot een fail-fast
 * fout zonder dat er ook maar één rij blijvend is aangeraakt (geen
 * gedeeltelijke mutatie, geen "verplaatsen naar deze versie", geen "als
 * nieuwe activiteit behandelen").
 *
 * TRANSACTIEGRENS (hardening-correctie, expliciet vastgesteld — voorkomt een
 * TOCTOU-gat): ELKE controle die de database leest (bestaat de versie, is
 * hij CONCEPT, bestaat een opgegeven id, hoort die id bij deze versie) valt
 * BINNEN dezelfde `BEGIN`…`COMMIT`/`ROLLBACK`-transactie als de daadwerkelijke
 * DELETE/UPDATE/INSERT-mutaties — nooit een aparte "eerst lezen, dan pas
 * beginnen"-stap ervoor. Uitsluitend de duplicate-id-check (die alleen naar
 * de meegegeven inputlijst zelf kijkt, geen databasetoegang) gebeurt vóór
 * `BEGIN` — die kan per definitie niet door een TOCTOU-gat worden geraakt.
 * Bovenop de expliciete vooraf-ownership-check bewijst ELKE UPDATE zichzelf
 * bovendien opnieuw versiegebonden (`WHERE id = ? AND begroting_versie_id =
 * ?`, met een harde `changes === 1`-controle) — twee onafhankelijke
 * beschermingslagen voor dezelfde invariant, zelfde principe als elders in
 * dit package (bv. migratie 7's dubbele CHECK-constraint-beslissing).
 */

/** Kleine, herbruikbare transactie-helper — zelfde patroon als `module1Overrides.ts`/`module1Snapshot.ts` (bewust hier gedupliceerd, zie migratie-4-rapport). */
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

/** `id: null` = nieuwe activiteit (SQLite kent een verse rowid toe). `id: number` = een bestaande activiteit die aantoonbaar bij DEZE begrotingsversie moet horen. */
export interface GeplandOnderhoudActiviteitInvoer {
  id: number | null;
  complexnummer: string;
  omschrijving: string;
  aanleidingType: string | null;
  aanleidingToelichting: string;
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
  status: string;
  leverancier: string | null;
  offertebedrag: Decimal | null;
  notitie: string | null;
}

export interface GeplandOnderhoudActiviteit {
  id: number;
  complexnummer: string;
  omschrijving: string;
  aanleidingType: string | null;
  aanleidingToelichting: string;
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
  status: string;
  leverancier: string | null;
  offertebedrag: Decimal | null;
  notitie: string | null;
}

interface ActiviteitRow {
  id: number;
  complexnummer: string;
  omschrijving: string;
  aanleiding_type: string | null;
  aanleiding_toelichting: string;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  status: string;
  leverancier: string | null;
  offertebedrag: string | null;
  notitie: string | null;
}

function rowToActiviteit(row: ActiviteitRow): GeplandOnderhoudActiviteit {
  return {
    id: row.id,
    complexnummer: row.complexnummer,
    omschrijving: row.omschrijving,
    aanleidingType: row.aanleiding_type,
    aanleidingToelichting: row.aanleiding_toelichting,
    q1: new Decimal(row.q1),
    q2: new Decimal(row.q2),
    q3: new Decimal(row.q3),
    q4: new Decimal(row.q4),
    status: row.status,
    leverancier: row.leverancier,
    offertebedrag: row.offertebedrag !== null ? new Decimal(row.offertebedrag) : null,
    notitie: row.notitie,
  };
}

/** Leest alle activiteiten van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde, geen businessbetekenis. */
export function leesGeplandOnderhoudActiviteiten(db: DatabaseSync, versieId: string): readonly GeplandOnderhoudActiviteit[] {
  const rijen = db
    .prepare(
      `SELECT id, complexnummer, omschrijving, aanleiding_type, aanleiding_toelichting, q1, q2, q3, q4, status, leverancier, offertebedrag, notitie
       FROM begroting_gepland_onderhoud_activiteit
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as ActiviteitRow[];
  return rijen.map(rowToActiviteit);
}

/**
 * Schrijft de COMPLETE gewenste activiteitenlijst voor één begrotingsversie
 * (complete-list save — geen los toevoegen/wijzigen/verwijderen-API). Faalt
 * vóór elke mutatie als de parent niet bestaat, geen CONCEPT is, een
 * meegegeven bestaande `id` niet bestaat, bij een ANDERE begrotingsversie
 * hoort, of dubbel voorkomt in dezelfde aanroep (zie moduledoc). Retourneert
 * de resulterende activiteitenlijst (met, voor nieuwe activiteiten, het vers
 * toegekende `id`) — een her-lezing ná de schrijfactie, geen losse
 * boekhouding van toegekende ids.
 */
export function schrijfGeplandOnderhoudActiviteiten(
  db: DatabaseSync,
  versieId: string,
  activiteiten: readonly GeplandOnderhoudActiviteitInvoer[],
): readonly GeplandOnderhoudActiviteit[] {
  // Zuivere inputvalidatie — raakt de database niet, mag daarom vóór BEGIN (zie moduledoc).
  const bestaandeIds = activiteiten.map((a) => a.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Begrotingsversie ${versieId}: dezelfde bestaande activiteit-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd, geen "laatste wint".`,
    );
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status !== "CONCEPT") {
      throw new Error(
        `Begrotingsversie ${versieId} heeft status ${versie.status} — Gepland-Onderhoud-activiteiten mogen uitsluitend op een CONCEPT-versie worden geschreven.`,
      );
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_gepland_onderhoud_activiteit WHERE id IN (${placeholders})`)
        .all(...bestaandeIds) as unknown as { id: number; begroting_versie_id: string }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: activiteit-id ${id} bestaat niet — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(
            `Begrotingsversie ${versieId}: activiteit-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd, geen enkele mutatie uitgevoerd.`,
          );
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db
      .prepare(`SELECT id FROM begroting_gepland_onderhoud_activiteit WHERE begroting_versie_id = ?`)
      .all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_gepland_onderhoud_activiteit WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(
        versieId,
        ...teVerwijderen,
      );
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_gepland_onderhoud_activiteit
       SET complexnummer = ?, omschrijving = ?, aanleiding_type = ?, aanleiding_toelichting = ?,
           q1 = ?, q2 = ?, q3 = ?, q4 = ?, status = ?, leverancier = ?, offertebedrag = ?, notitie = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_gepland_onderhoud_activiteit
         (begroting_versie_id, complexnummer, omschrijving, aanleiding_type, aanleiding_toelichting, q1, q2, q3, q4, status, leverancier, offertebedrag, notitie)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const activiteit of activiteiten) {
      const offertebedrag = activiteit.offertebedrag !== null ? activiteit.offertebedrag.toString() : null;

      if (activiteit.id === null) {
        insertStmt.run(
          versieId,
          activiteit.complexnummer,
          activiteit.omschrijving,
          activiteit.aanleidingType,
          activiteit.aanleidingToelichting,
          activiteit.q1.toString(),
          activiteit.q2.toString(),
          activiteit.q3.toString(),
          activiteit.q4.toString(),
          activiteit.status,
          activiteit.leverancier,
          offertebedrag,
          activiteit.notitie,
        );
        continue;
      }

      // Versiegebonden update: de WHERE-clausule bewijst de versie-isolatie opnieuw, onafhankelijk van de
      // vooraf-ownership-check hierboven (zie moduledoc "TRANSACTIEGRENS" — twee beschermingslagen).
      const info = updateStmt.run(
        activiteit.complexnummer,
        activiteit.omschrijving,
        activiteit.aanleidingType,
        activiteit.aanleidingToelichting,
        activiteit.q1.toString(),
        activiteit.q2.toString(),
        activiteit.q3.toString(),
        activiteit.q4.toString(),
        activiteit.status,
        activiteit.leverancier,
        offertebedrag,
        activiteit.notitie,
        activiteit.id,
        versieId,
      );
      if (Number(info.changes) !== 1) {
        throw new Error(
          `Begrotingsversie ${versieId}: activiteit-id ${activiteit.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`,
        );
      }
    }

    return leesGeplandOnderhoudActiviteiten(db, versieId);
  });
}
