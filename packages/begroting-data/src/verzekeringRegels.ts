import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor Verzekering-regels — OB-032, UITSLUITEND concept-input.
 * GEEN pure-calculator-integratie (`@bvc/reporting`'s
 * `berekenBegroteVerzekeringen` wordt hier NERGENS aangeroepen), GEEN
 * concept-herberekening, GEEN frozen output — die volgen in
 * herberekenen.js/frozenVerzekeringResultaat.js.
 *
 * Exact hetzelfde complete-list-save-patroon als
 * `correctiefDagelijksOnderhoudRegels.ts` (GO-P1/CD-P1) — zie dat bestand
 * voor de volledige onderbouwing van de transactiegrens en de
 * versie-isolatie; hier uitsluitend de Verzekering-specifieke verschillen.
 *
 * COMPLEX EN VERZEKERAAR ZIJN FUNCTIONEEL VERPLICHT MAAR MOGEN TIJDELIJK
 * NULL ZIJN (OB032-002/009): anders dan Correctief/Dagelijks Onderhoud
 * (waar `complexnummer = null` een structureel geldige NTB-eindstatus is),
 * is `null` hier uitsluitend een TIJDELIJKE conceptstaat — de pure
 * calculator geeft een KRITIEK-control zodra deze velden ontbreken, en
 * `vaststellen.ts` blokkeert zolang die KRITIEK bestaat. Deze
 * persistence-laag legt dat zelf niet af (geen CHECK-constraint op
 * inhoud) — dat zou de lifecycle-regel dupliceren.
 *
 * VIER REKENKRITISCHE VELDEN (`ingangsdatum`/`looptijd_maanden`/`bedrag`/
 * `index_percentage`) zijn ALLEMAAL `NULL`-toegestaan — een functioneel
 * onvolledig concept moet opslaanbaar blijven. `NULL` betekent hier ALTIJD
 * "nog niet ingevuld", nooit stilzwijgend `0`/vandaag/1 maand — zie
 * `begroteVerzekeringen.ts`'s moduledoc voor de veilige-0-behandeling die
 * hierop volgt in de pure calculator.
 *
 * VERSIE-ISOLATIE EN TRANSACTIEGRENS: identiek aan GO-P1/CD-P1 — dezelfde
 * dubbele beschermingslaag (vooraf-ownership-check binnen de transactie +
 * versiegebonden UPDATE met `changes === 1`-guard), dezelfde
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

/** `id: null` = nieuwe regel (SQLite kent een verse rowid toe). `id: number` = een bestaande regel die aantoonbaar bij DEZE begrotingsversie moet horen. */
export interface VerzekeringRegelInvoer {
  id: number | null;
  complexnummer: string | null;
  verzekeraar: string | null;
  ingangsdatum: Date | null;
  looptijdMaanden: number | null;
  bedrag: Decimal | null;
  indexPercentage: Decimal | null;
  handmatigBegrootOverride: Decimal | null;
}

export interface VerzekeringRegel {
  id: number;
  complexnummer: string | null;
  verzekeraar: string | null;
  ingangsdatum: Date | null;
  looptijdMaanden: number | null;
  bedrag: Decimal | null;
  indexPercentage: Decimal | null;
  handmatigBegrootOverride: Decimal | null;
}

interface RegelRow {
  id: number;
  complexnummer: string | null;
  verzekeraar: string | null;
  ingangsdatum: string | null;
  looptijd_maanden: number | null;
  bedrag: string | null;
  index_percentage: string | null;
  handmatig_begroot_override: string | null;
}

function rowToRegel(row: RegelRow): VerzekeringRegel {
  return {
    id: row.id,
    complexnummer: row.complexnummer,
    verzekeraar: row.verzekeraar,
    ingangsdatum: optioneleParsedBusinessDate(row.ingangsdatum),
    looptijdMaanden: row.looptijd_maanden,
    bedrag: row.bedrag !== null ? new Decimal(row.bedrag) : null,
    indexPercentage: row.index_percentage !== null ? new Decimal(row.index_percentage) : null,
    handmatigBegrootOverride: row.handmatig_begroot_override !== null ? new Decimal(row.handmatig_begroot_override) : null,
  };
}

/** Leest alle Verzekering-regels van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde, geen businessbetekenis. */
export function leesVerzekeringRegels(db: DatabaseSync, versieId: string): readonly VerzekeringRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, complexnummer, verzekeraar, ingangsdatum, looptijd_maanden, bedrag, index_percentage, handmatig_begroot_override
       FROM begroting_verzekering_regel
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as RegelRow[];
  return rijen.map(rowToRegel);
}

/**
 * Schrijft de COMPLETE gewenste regellijst voor één begrotingsversie
 * (complete-list save — geen los toevoegen/wijzigen/verwijderen-API). Faalt
 * vóór elke mutatie als de parent niet bestaat, geen CONCEPT is, een
 * meegegeven bestaande `id` niet bestaat, bij een ANDERE begrotingsversie
 * hoort, of dubbel voorkomt in dezelfde aanroep (zie moduledoc). Retourneert
 * de resulterende regellijst (met, voor nieuwe regels, het vers toegekende
 * `id`) — een her-lezing ná de schrijfactie, geen losse boekhouding van
 * toegekende ids.
 */
export function schrijfVerzekeringRegels(
  db: DatabaseSync,
  versieId: string,
  regels: readonly VerzekeringRegelInvoer[],
): readonly VerzekeringRegel[] {
  // Zuivere inputvalidatie — raakt de database niet, mag daarom vóór BEGIN (zie moduledoc).
  const bestaandeIds = regels.map((r) => r.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Begrotingsversie ${versieId}: dezelfde bestaande regel-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd, geen "laatste wint".`,
    );
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status !== "CONCEPT") {
      throw new Error(
        `Begrotingsversie ${versieId} heeft status ${versie.status} — Verzekering-regels mogen uitsluitend op een CONCEPT-versie worden geschreven.`,
      );
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_verzekering_regel WHERE id IN (${placeholders})`)
        .all(...bestaandeIds) as unknown as { id: number; begroting_versie_id: string }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(`Begrotingsversie ${versieId}: regel-id ${id} bestaat niet — operatie geweigerd, geen enkele mutatie uitgevoerd.`);
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(
            `Begrotingsversie ${versieId}: regel-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd, geen enkele mutatie uitgevoerd.`,
          );
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db.prepare(`SELECT id FROM begroting_verzekering_regel WHERE begroting_versie_id = ?`).all(versieId) as unknown as {
      id: number;
    }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_verzekering_regel WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(versieId, ...teVerwijderen);
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_verzekering_regel
       SET complexnummer = ?, verzekeraar = ?, ingangsdatum = ?, looptijd_maanden = ?, bedrag = ?, index_percentage = ?, handmatig_begroot_override = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_verzekering_regel
         (begroting_versie_id, complexnummer, verzekeraar, ingangsdatum, looptijd_maanden, bedrag, index_percentage, handmatig_begroot_override)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const regel of regels) {
      const ingangsdatum = optioneleBusinessDate(regel.ingangsdatum);
      const bedrag = regel.bedrag !== null ? regel.bedrag.toString() : null;
      const indexPercentage = regel.indexPercentage !== null ? regel.indexPercentage.toString() : null;
      const handmatigBegrootOverride = regel.handmatigBegrootOverride !== null ? regel.handmatigBegrootOverride.toString() : null;

      if (regel.id === null) {
        insertStmt.run(versieId, regel.complexnummer, regel.verzekeraar, ingangsdatum, regel.looptijdMaanden, bedrag, indexPercentage, handmatigBegrootOverride);
        continue;
      }

      // Versiegebonden update: de WHERE-clausule bewijst de versie-isolatie opnieuw, onafhankelijk van de
      // vooraf-ownership-check hierboven (zie moduledoc — twee beschermingslagen, zelfde patroon als GO-P1/CD-P1).
      const info = updateStmt.run(
        regel.complexnummer,
        regel.verzekeraar,
        ingangsdatum,
        regel.looptijdMaanden,
        bedrag,
        indexPercentage,
        handmatigBegrootOverride,
        regel.id,
        versieId,
      );
      if (Number(info.changes) !== 1) {
        throw new Error(
          `Begrotingsversie ${versieId}: regel-id ${regel.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`,
        );
      }
    }

    return leesVerzekeringRegels(db, versieId);
  });
}
