import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgAlgemeneKostenCategorie } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de Algemene-Kosten-begrotingsregels (OB-035/036) —
 * UITSLUITEND concept-input. GEEN pure-calculator-integratie
 * (`@bvc/reporting`'s `berekenBegroteAlgemeneKosten` wordt hier NERGENS
 * aangeroepen), GEEN concept-herberekening, GEEN frozen output — die volgen
 * in herberekenen.js (frozen output pas in een latere fase).
 *
 * Exact hetzelfde complete-list-save-patroon als `verzekeringRegels.ts`/
 * `wozObjecten.ts` (GO-P1/CD-P1/Verzekeringen/WOZ) — zie die bestanden voor
 * de volledige onderbouwing van de transactiegrens en de versie-isolatie;
 * hier uitsluitend de Algemene-Kosten-specifieke verschillen.
 *
 * EEN REGEL ZONDER OGB-KOPPELING IS GELDIG (`ogbKostensoortCode: NULL`) —
 * noodzakelijk voor ACCOUNTANT/JURIDISCHE_KOSTEN, waarvoor het
 * brononderzoek geen bewezen OGB-kostensoort opleverde (zie
 * `begroteAlgemeneKosten.ts`'s moduledoc). `omschrijving` is bewust NOT
 * NULL (een lege string is het "nog niet ingevuld"-concept voor een
 * tekstveld, zelfde principe als Correctief/Dagelijks Onderhoud — geen
 * apart null-concept nodig). `complexnummer`/`jaarbedrag` blijven NULLABLE,
 * zelfde null-betekenis als in alle eerdere begrotingsposten.
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

/** `id: null` = nieuwe regel (SQLite kent een verse rowid toe). `id: number` = een bestaande regel die aantoonbaar bij DEZE begrotingsversie moet horen. */
export interface AlgemeneKostenRegelInvoer {
  id: number | null;
  categorie: BgAlgemeneKostenCategorie;
  ogbKostensoortCode: string | null;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: Decimal | null;
}

export interface AlgemeneKostenRegel {
  id: number;
  categorie: BgAlgemeneKostenCategorie;
  ogbKostensoortCode: string | null;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: Decimal | null;
}

interface AlgemeneKostenRegelRow {
  id: number;
  categorie: BgAlgemeneKostenCategorie;
  ogb_kostensoort_code: string | null;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: string | null;
}

function rowToAlgemeneKostenRegel(row: AlgemeneKostenRegelRow): AlgemeneKostenRegel {
  return {
    id: row.id,
    categorie: row.categorie,
    ogbKostensoortCode: row.ogb_kostensoort_code,
    omschrijving: row.omschrijving,
    complexnummer: row.complexnummer,
    jaarbedrag: row.jaarbedrag !== null ? new Decimal(row.jaarbedrag) : null,
  };
}

/** Leest alle Algemene-Kosten-regels van een begrotingsversie, `ORDER BY id` — technische, deterministische leesvolgorde, geen businessbetekenis. */
export function leesAlgemeneKostenRegels(db: DatabaseSync, versieId: string): readonly AlgemeneKostenRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, categorie, ogb_kostensoort_code, omschrijving, complexnummer, jaarbedrag
       FROM begroting_algemene_kosten_regel
       WHERE begroting_versie_id = ?
       ORDER BY id`,
    )
    .all(versieId) as unknown as AlgemeneKostenRegelRow[];
  return rijen.map(rowToAlgemeneKostenRegel);
}

/**
 * Schrijft de COMPLETE gewenste Algemene-Kosten-regellijst voor één
 * begrotingsversie (complete-list save — geen los toevoegen/wijzigen/
 * verwijderen-API). Faalt vóór elke mutatie als de parent niet bestaat,
 * geen CONCEPT is, een meegegeven bestaande `id` niet bestaat, bij een
 * ANDERE begrotingsversie hoort, of dubbel voorkomt in dezelfde aanroep
 * (zie moduledoc). Retourneert de resulterende regellijst (met, voor
 * nieuwe regels, het vers toegekende `id`) — een her-lezing ná de
 * schrijfactie, geen losse boekhouding van toegekende ids.
 */
export function schrijfAlgemeneKostenRegels(
  db: DatabaseSync,
  versieId: string,
  regels: readonly AlgemeneKostenRegelInvoer[],
): readonly AlgemeneKostenRegel[] {
  const bestaandeIds = regels.map((r) => r.id).filter((id): id is number => id !== null);
  const duplicaten = [...new Set(bestaandeIds.filter((id, index) => bestaandeIds.indexOf(id) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Begrotingsversie ${versieId}: dezelfde bestaande Algemene-Kosten-regel-id komt meerdere keren voor in één save (${duplicaten.join(", ")}) — operatie geweigerd, geen "laatste wint".`,
    );
  }

  return withTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status !== "CONCEPT") {
      throw new Error(
        `Begrotingsversie ${versieId} heeft status ${versie.status} — Algemene-Kosten-regels mogen uitsluitend op een CONCEPT-versie worden geschreven.`,
      );
    }

    if (bestaandeIds.length > 0) {
      const placeholders = bestaandeIds.map(() => "?").join(", ");
      const gevonden = db
        .prepare(`SELECT id, begroting_versie_id FROM begroting_algemene_kosten_regel WHERE id IN (${placeholders})`)
        .all(...bestaandeIds) as unknown as { id: number; begroting_versie_id: string }[];
      const eigenaarPerId = new Map(gevonden.map((r) => [r.id, r.begroting_versie_id]));

      for (const id of bestaandeIds) {
        const eigenaarVersieId = eigenaarPerId.get(id);
        if (eigenaarVersieId === undefined) {
          throw new Error(
            `Begrotingsversie ${versieId}: Algemene-Kosten-regel-id ${id} bestaat niet — operatie geweigerd, geen enkele mutatie uitgevoerd.`,
          );
        }
        if (eigenaarVersieId !== versieId) {
          throw new Error(
            `Begrotingsversie ${versieId}: Algemene-Kosten-regel-id ${id} behoort bij begrotingsversie ${eigenaarVersieId}, niet bij deze versie — operatie geweigerd, geen enkele mutatie uitgevoerd.`,
          );
        }
      }
    }

    const behoudenIds = new Set(bestaandeIds);
    const huidigeRijen = db.prepare(`SELECT id FROM begroting_algemene_kosten_regel WHERE begroting_versie_id = ?`).all(versieId) as unknown as {
      id: number;
    }[];
    const teVerwijderen = huidigeRijen.map((r) => r.id).filter((id) => !behoudenIds.has(id));
    if (teVerwijderen.length > 0) {
      const placeholders = teVerwijderen.map(() => "?").join(", ");
      db.prepare(`DELETE FROM begroting_algemene_kosten_regel WHERE begroting_versie_id = ? AND id IN (${placeholders})`).run(
        versieId,
        ...teVerwijderen,
      );
    }

    const updateStmt = db.prepare(
      `UPDATE begroting_algemene_kosten_regel
       SET categorie = ?, ogb_kostensoort_code = ?, omschrijving = ?, complexnummer = ?, jaarbedrag = ?
       WHERE id = ? AND begroting_versie_id = ?`,
    );
    const insertStmt = db.prepare(
      `INSERT INTO begroting_algemene_kosten_regel
         (begroting_versie_id, categorie, ogb_kostensoort_code, omschrijving, complexnummer, jaarbedrag)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const regel of regels) {
      const jaarbedrag = regel.jaarbedrag !== null ? regel.jaarbedrag.toString() : null;

      if (regel.id === null) {
        insertStmt.run(versieId, regel.categorie, regel.ogbKostensoortCode, regel.omschrijving, regel.complexnummer, jaarbedrag);
        continue;
      }

      // Versiegebonden update: de WHERE-clausule bewijst de versie-isolatie opnieuw, onafhankelijk van de
      // vooraf-ownership-check hierboven (zie moduledoc — twee beschermingslagen, zelfde patroon als eerdere modules).
      const info = updateStmt.run(regel.categorie, regel.ogbKostensoortCode, regel.omschrijving, regel.complexnummer, jaarbedrag, regel.id, versieId);
      if (Number(info.changes) !== 1) {
        throw new Error(
          `Begrotingsversie ${versieId}: Algemene-Kosten-regel-id ${regel.id} kon niet worden bijgewerkt (0 rijen geraakt bij id+versie-gebonden UPDATE) — operatie geweigerd, transactie wordt teruggedraaid.`,
        );
      }
    }

    return leesAlgemeneKostenRegels(db, versieId);
  });
}
