import type { DatabaseSync } from "node:sqlite";
import type { BgRenteCategorie } from "@bvc/reporting";

/**
 * Persistence voor de LOKALE rente-classificatie (OGB-kostensoort →
 * categorie, voor de twee afzonderlijke P&L-posten Rentekosten/Rente
 * opbrengsten) — OB-037/038. Zie migratie 20 in `migrations.ts`. Exact
 * hetzelfde architectuurpatroon als `leegstandClassificatie.ts`/
 * `algemeneKostenClassificatie.ts`.
 *
 * ADMINISTRATIE-BREED, GEEN BEGROTINGSVERSIE-KOPPELING: de sleutel is
 * `bedrijfsnr`, niet `begroting_versie_id`. Vrij muteerbaar, ook na
 * vaststellen van willekeurige begrotingsversies — GEEN CONCEPT/VASTGESTELD-
 * immutability op deze tabel. Deze classificatie wordt ALLEEN door de
 * Werkelijk-berekening gebruikt (`berekenWerkelijkRente`); een Begroting-
 * regel heeft geen OGB-koppeling (zie migratie 20), dus is er ook niets om
 * bij vaststellen te bevriezen op dit punt.
 *
 * GEEN PORTFOLIO-BREDE BETEKENIS: bewezen (bronproef 2026-09) dat dezelfde
 * OGB-kostensoort tussen administraties tegengestelde economische
 * betekenissen kan hebben (bv. OGB 4604 = "Rente lening .500" (RENTEKOSTEN)
 * bij 023, maar "Rente r/c" (RENTE_OPBRENGSTEN) bij 013) — deze tabel is
 * daarom altijd per `bedrijfsnr` geïsoleerd, nooit als generieke/gedeelde
 * mapping bedoeld.
 *
 * COMPLETE-LIST SAVE PER BEDRIJFSNR: zelfde patroon als
 * `leegstandClassificatie.ts` — geen surrogaat-`id`, de natuurlijke sleutel
 * `(bedrijfsnr, ogb_kostensoort)` is zelf al de PRIMARY KEY.
 */

export interface RenteClassificatieRegel {
  ogbKostensoort: string;
  ogbKostensoortOmschrijving: string;
  categorie: BgRenteCategorie;
}

interface RenteClassificatieRow {
  ogb_kostensoort: string;
  ogb_kostensoort_omschrijving: string;
  categorie: BgRenteCategorie;
}

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

/** Leest de complete lokale rente-classificatie voor één administratie, `ORDER BY ogb_kostensoort`. Geen rijen = lege classificatie, nooit een fout. */
export function leesRenteClassificatie(db: DatabaseSync, bedrijfsnr: string): readonly RenteClassificatieRegel[] {
  const rijen = db
    .prepare(
      `SELECT ogb_kostensoort, ogb_kostensoort_omschrijving, categorie
       FROM begroting_rente_classificatie
       WHERE bedrijfsnr = ?
       ORDER BY ogb_kostensoort`,
    )
    .all(bedrijfsnr) as unknown as RenteClassificatieRow[];
  return rijen.map((rij) => ({
    ogbKostensoort: rij.ogb_kostensoort,
    ogbKostensoortOmschrijving: rij.ogb_kostensoort_omschrijving,
    categorie: rij.categorie,
  }));
}

/**
 * Schrijft de COMPLETE gewenste lokale rente-classificatie voor één
 * administratie (complete-list save). Faalt vóór elke mutatie als dezelfde
 * OGB-kostensoort dubbel voorkomt in dezelfde aanroep.
 */
export function schrijfRenteClassificatie(db: DatabaseSync, bedrijfsnr: string, regels: readonly RenteClassificatieRegel[]): readonly RenteClassificatieRegel[] {
  const codes = regels.map((r) => r.ogbKostensoort);
  const duplicaten = [...new Set(codes.filter((code, index) => codes.indexOf(code) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(`Administratie ${bedrijfsnr}: dezelfde OGB-kostensoort komt meerdere keren voor in één classificatie-save (${duplicaten.join(", ")}) — operatie geweigerd.`);
  }

  return withTransaction(db, () => {
    db.prepare(`DELETE FROM begroting_rente_classificatie WHERE bedrijfsnr = ?`).run(bedrijfsnr);

    const insertStmt = db.prepare(
      `INSERT INTO begroting_rente_classificatie (bedrijfsnr, ogb_kostensoort, ogb_kostensoort_omschrijving, categorie)
       VALUES (?, ?, ?, ?)`,
    );
    for (const regel of regels) {
      insertStmt.run(bedrijfsnr, regel.ogbKostensoort, regel.ogbKostensoortOmschrijving, regel.categorie);
    }

    return leesRenteClassificatie(db, bedrijfsnr);
  });
}
