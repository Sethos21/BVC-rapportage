import type { DatabaseSync } from "node:sqlite";
import type { BgLeegstandCategorie } from "@bvc/reporting";

/**
 * Persistence voor de LOKALE leegstand-classificatie (OGB-kostensoort →
 * categorie, voor de Leegstandskosten-hoofdregel) — OB-031. Zie migratie 18
 * in `migrations.ts` voor de volledige onderbouwing van de tabelvorm. Exact
 * hetzelfde architectuurpatroon als `algemeneKostenClassificatie.ts`
 * (OB-035/036).
 *
 * ADMINISTRATIE-BREED, GEEN BEGROTINGSVERSIE-KOPPELING: de sleutel is
 * `bedrijfsnr`, niet `begroting_versie_id`. Vrij muteerbaar, ook na
 * vaststellen van willekeurige begrotingsversies — GEEN CONCEPT/VASTGESTELD-
 * immutability op deze tabel. Deze classificatie wordt ALLEEN door de
 * Werkelijk-berekening gebruikt (`berekenWerkelijkLeegstand`); een
 * Begroting-regel heeft geen OGB-koppeling (zie migratie 18), dus is er ook
 * niets om bij vaststellen te bevriezen op dit punt.
 *
 * GEEN TWEEDE OGB→CATEGORIE-WAARHEID: deze tabel is de ENIGE plek waar die
 * koppeling wordt opgeslagen — bewezen voor 070: OGB 4319 = "Servicekosten
 * leegstand" (GL 4350, bronproef 2026-09).
 *
 * COMPLETE-LIST SAVE PER BEDRIJFSNR: zelfde patroon als
 * `algemeneKostenClassificatie.ts` — geen surrogaat-`id`, de natuurlijke
 * sleutel `(bedrijfsnr, ogb_kostensoort)` is zelf al de PRIMARY KEY.
 */

export interface LeegstandClassificatieRegel {
  ogbKostensoort: string;
  ogbKostensoortOmschrijving: string;
  categorie: BgLeegstandCategorie;
}

interface LeegstandClassificatieRow {
  ogb_kostensoort: string;
  ogb_kostensoort_omschrijving: string;
  categorie: BgLeegstandCategorie;
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

/** Leest de complete lokale leegstand-classificatie voor één administratie, `ORDER BY ogb_kostensoort`. Geen rijen = lege classificatie, nooit een fout. */
export function leesLeegstandClassificatie(db: DatabaseSync, bedrijfsnr: string): readonly LeegstandClassificatieRegel[] {
  const rijen = db
    .prepare(
      `SELECT ogb_kostensoort, ogb_kostensoort_omschrijving, categorie
       FROM begroting_leegstand_classificatie
       WHERE bedrijfsnr = ?
       ORDER BY ogb_kostensoort`,
    )
    .all(bedrijfsnr) as unknown as LeegstandClassificatieRow[];
  return rijen.map((rij) => ({
    ogbKostensoort: rij.ogb_kostensoort,
    ogbKostensoortOmschrijving: rij.ogb_kostensoort_omschrijving,
    categorie: rij.categorie,
  }));
}

/**
 * Schrijft de COMPLETE gewenste lokale leegstand-classificatie voor één
 * administratie (complete-list save). Faalt vóór elke mutatie als dezelfde
 * OGB-kostensoort dubbel voorkomt in dezelfde aanroep.
 */
export function schrijfLeegstandClassificatie(
  db: DatabaseSync,
  bedrijfsnr: string,
  regels: readonly LeegstandClassificatieRegel[],
): readonly LeegstandClassificatieRegel[] {
  const codes = regels.map((r) => r.ogbKostensoort);
  const duplicaten = [...new Set(codes.filter((code, index) => codes.indexOf(code) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Administratie ${bedrijfsnr}: dezelfde OGB-kostensoort komt meerdere keren voor in één classificatie-save (${duplicaten.join(", ")}) — operatie geweigerd.`,
    );
  }

  return withTransaction(db, () => {
    db.prepare(`DELETE FROM begroting_leegstand_classificatie WHERE bedrijfsnr = ?`).run(bedrijfsnr);

    const insertStmt = db.prepare(
      `INSERT INTO begroting_leegstand_classificatie (bedrijfsnr, ogb_kostensoort, ogb_kostensoort_omschrijving, categorie)
       VALUES (?, ?, ?, ?)`,
    );
    for (const regel of regels) {
      insertStmt.run(bedrijfsnr, regel.ogbKostensoort, regel.ogbKostensoortOmschrijving, regel.categorie);
    }

    return leesLeegstandClassificatie(db, bedrijfsnr);
  });
}
