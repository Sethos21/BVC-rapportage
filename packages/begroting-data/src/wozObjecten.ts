import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor WOZ-objectregels — OB-033, UITSLUITEND concept-input.
 * GEEN pure-calculator-integratie (`@bvc/reporting`'s
 * `berekenBegroteGemeentelijkeLasten` wordt hier NERGENS aangeroepen), GEEN
 * concept-herberekening, GEEN frozen output — die volgen in
 * herberekenen.js (frozen output pas in een latere fase).
 *
 * Exact hetzelfde complete-list-save-patroon als `verzekeringRegels.ts`
 * (GO-P1/CD-P1/Verzekeringen) — zie dat bestand voor de volledige
 * onderbouwing van de transactiegrens en de versie-isolatie; hier
 * uitsluitend de WOZ-specifieke verschillen.
 *
 * EEN WOZ-OBJECT IS GEEN UNIT/CONTRACT/BOEKINGSREGEL (OB033-003/004): alle
 * zes inhoudelijke velden zijn bewust NULL-toegestaan in CONCEPT — een
 * functioneel onvolledig WOZ-object moet opslaanbaar blijven. `wozObjectAdres`
 * is een vrij tekstveld (GEEN formeel WOZ-objectnummer, dat bestaat niet in
 * de bron — zie het OB-033-brononderzoek). `aanslagjaar`/`waardepeildatum`
 * zijn zuivere traceerbaarheidsvelden die geen enkele formule raken
 * (OB033-005) — ze worden hier alleen opgeslagen/teruggelezen, nooit
 * gebruikt om iets af te leiden.
 *
 * VERSIE-ISOLATIE EN TRANSACTIEGRENS: identiek aan de eerdere modules —
 * dezelfde dubbele beschermingslaag (vooraf-ownership-check binnen de
 * transactie + versiegebonden UPDATE met `changes === 1`-guard), dezelfde
 * duplicate-id-check vóór `BEGIN`.
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

function formatBusinessDate(date: Date): string {
  const jaar = date.getUTCFullYear().toString().padStart(4, "0");
  const maand = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dag = date.getUTCDate().toString().padStart(2, "0");
  return `${jaar}-${maand}-${dag}`;
}

function parseBusinessDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`Ongeldige businessdatum uit persistence: "${value}" (verwacht YYYY-MM-DD).`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function optioneleBusinessDate(date: Date | null): string | null {
  return date !== null ? formatBusinessDate(date) : null;
}

function optioneleParsedBusinessDate(value: string | null): Date | null {
  return value !== null ? parseBusinessDate(value) : null;
}

/** `id: null` = nieuw WOZ-object (SQLite kent een verse rowid toe). `id: number` = een bestaand WOZ-object dat aantoonbaar bij DEZE begrotingsversie moet horen. */
export interface WozObjectInvoer {
  id: number | null;
  complexnummer: string | null;
  wozObjectAdres: string | null;
  aanslagjaar: number | null;
  waardepeildatum: Date | null;
  werkelijkeWoz: Decimal | null;
  verwachteWozOverride: Decimal | null;
}

export interface WozObject {
  id: number;
  complexnummer: string | null;
  wozObjectAdres: string | null;
  aanslagjaar: number | null;
  waardepeildatum: Date | null;
  werkelijkeWoz: Decimal | null;
  verwachteWozOverride: Decimal | null;
}

interface WozObjectRow {
  id: number;
  complexnummer: string | null;
  woz_object_adres: string | null;
  aanslagjaar: number | null;
  waardepeildatum: string | null;
  werkelijke_woz: string | null;
  verwachte_woz_override: string | null;
}

function rowToWozObject(row: WozObjectRow): WozObject {
  return {
    id: row.id,
    complexnummer: row.complexnummer,
    wozObjectAdres: row.woz_object_adres,
    aanslagjaar: row.aanslagjaar,
    waardepeildatum: optioneleParsedBusinessDate(row.waardepeildatum),
    werkelijkeWoz: row.werkelijke_woz !== null ? new Decimal(row.werkelijke_woz) : null,
    verwachteWozOverride: row.verwachte_woz_override !== null ? new Decimal(row.verwachte_woz_override) : null,
  };
}

/** Leest alle WOZ-objecten van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde, geen businessbetekenis. */
export function leesWozObjecten(db: DatabaseSync, versieId: string): readonly WozObject[] {
  const rijen = db
    .prepare(
      `SELECT id, complexnummer, woz_object_adres, aanslagjaar, waardepeildatum, werkelijke_woz, verwachte_woz_override
       FROM begroting_woz_object
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as WozObjectRow[];
  return rijen.map(rowToWozObject);
}

/**
 * Schrijft de COMPLETE gewenste WOZ-objectlijst voor één begrotingsversie
 * (complete-list save — geen los toevoegen/wijzigen/verwijderen-API). Faalt
 * vóór elke mutatie als de parent niet bestaat, geen CONCEPT is, een
 * meegegeven bestaande `id` niet bestaat, bij een ANDERE begrotingsversie
 * hoort, of dubbel voorkomt in dezelfde aanroep (zie moduledoc). Retourneert
 * de resulterende objectlijst (met, voor nieuwe objecten, het vers
 * toegekende `id`) — een her-lezing ná de schrijfactie, geen losse
 * boekhouding van toegekende ids.
 */
export function schrijfWozObjecten(db: DatabaseSync, versieId: string, wozObjecten: readonly WozObjectInvoer[]): readonly WozObject[] {
  // Zuivere inputvalidatie — raakt de database niet, mag daarom vóór BEGIN (zie moduledoc).
  const bestaandeIds = wozObjecten.map((o) => o.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Begrotingsversie ${versieId}: dezelfde bestaande WOZ-object-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd, geen "laatste wint".`,
    );
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status !== "CONCEPT") {
      throw new Error(
        `Begrotingsversie ${versieId} heeft status ${versie.status} — WOZ-objecten mogen uitsluitend op een CONCEPT-versie worden geschreven.`,
      );
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_woz_object WHERE id IN (${placeholders})`)
        .all(...bestaandeIds) as unknown as { id: number; begroting_versie_id: string }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: WOZ-object-id ${id} bestaat niet — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(
            `Begrotingsversie ${versieId}: WOZ-object-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd, geen enkele mutatie uitgevoerd.`,
          );
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db.prepare(`SELECT id FROM begroting_woz_object WHERE begroting_versie_id = ?`).all(versieId) as unknown as { id: number }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_woz_object WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(versieId, ...teVerwijderen);
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_woz_object
       SET complexnummer = ?, woz_object_adres = ?, aanslagjaar = ?, waardepeildatum = ?, werkelijke_woz = ?, verwachte_woz_override = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_woz_object
         (begroting_versie_id, complexnummer, woz_object_adres, aanslagjaar, waardepeildatum, werkelijke_woz, verwachte_woz_override)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const wozObject of wozObjecten) {
      const waardepeildatum = optioneleBusinessDate(wozObject.waardepeildatum);
      const werkelijkeWoz = wozObject.werkelijkeWoz !== null ? wozObject.werkelijkeWoz.toString() : null;
      const verwachteWozOverride = wozObject.verwachteWozOverride !== null ? wozObject.verwachteWozOverride.toString() : null;

      if (wozObject.id === null) {
        insertStmt.run(versieId, wozObject.complexnummer, wozObject.wozObjectAdres, wozObject.aanslagjaar, waardepeildatum, werkelijkeWoz, verwachteWozOverride);
        continue;
      }

      // Versiegebonden update: de WHERE-clausule bewijst de versie-isolatie opnieuw, onafhankelijk van de
      // vooraf-ownership-check hierboven (zie moduledoc — twee beschermingslagen, zelfde patroon als GO-P1/CD-P1/Verzekeringen).
      const info = updateStmt.run(
        wozObject.complexnummer,
        wozObject.wozObjectAdres,
        wozObject.aanslagjaar,
        waardepeildatum,
        werkelijkeWoz,
        verwachteWozOverride,
        wozObject.id,
        versieId,
      );
      if (Number(info.changes) !== 1) {
        throw new Error(
          `Begrotingsversie ${versieId}: WOZ-object-id ${wozObject.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`,
        );
      }
    }

    return leesWozObjecten(db, versieId);
  });
}
