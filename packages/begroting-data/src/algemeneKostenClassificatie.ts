import type { DatabaseSync } from "node:sqlite";
import type { BgAlgemeneKostenCategorie } from "@bvc/reporting";

/**
 * Persistence voor de LOKALE algemene-kostenclassificatie (OGB-kostensoort
 * → categorie, uitsluitend voor het algemene-kostenblok GL 4900–4999) —
 * OB-035/036. Zie migratie 16 in `migrations.ts` voor de volledige
 * onderbouwing van de tabelvorm.
 *
 * ADMINISTRATIE-BREED, GEEN BEGROTINGSVERSIE-KOPPELING: de sleutel is
 * `bedrijfsnr`, niet `begroting_versie_id` — dit is een langzaam
 * veranderende classificatieconfiguratie (vergelijkbaar met, maar technisch
 * losstaand van, `@bvc/config`'s grootboekmapping), geen jaar-gebonden
 * begrotingsinvoer. Vrij muteerbaar, ook na vaststellen van willekeurige
 * begrotingsversies van deze of andere administraties — GEEN CONCEPT/
 * VASTGESTELD-immutability op deze tabel. De onafhankelijkheid van een
 * reeds vastgestelde begroting wordt geborgd door de classificatie bij
 * vaststellen volledig te bevriezen (`frozenAlgemeneKostenResultaat.ts`),
 * niet door deze tabel te vergrendelen.
 *
 * GEEN TWEEDE OGB→CATEGORIE-WAARHEID: deze tabel is de ENIGE plek waar die
 * koppeling wordt opgeslagen. De pure calculator
 * (`berekenBegroteAlgemeneKosten`) ontvangt de resolved regels hiervan als
 * expliciete parameter en bevat zelf geen enkele hardcoded OGB-code.
 *
 * COMPLETE-LIST SAVE PER BEDRIJFSNR: `schrijfAlgemeneKostenClassificatie`
 * vervangt de VOLLEDIGE classificatie van één administratie in één
 * transactie — geen los toevoegen/wijzigen/verwijderen-API. Geen
 * surrogaat-`id`: niets anders verwijst ooit naar een classificatieregel
 * via een technische sleutel, de natuurlijke sleutel `(bedrijfsnr,
 * ogb_kostensoort)` is zelf al de PRIMARY KEY (zie migratie 16) en dwingt
 * af dat één OGB-kostensoort binnen dezelfde administratie nooit aan twee
 * categorieën tegelijk hangt.
 */

export interface AlgemeneKostenClassificatieRegel {
  ogbKostensoort: string;
  ogbKostensoortOmschrijving: string;
  categorie: BgAlgemeneKostenCategorie;
}

interface AlgemeneKostenClassificatieRow {
  ogb_kostensoort: string;
  ogb_kostensoort_omschrijving: string;
  categorie: BgAlgemeneKostenCategorie;
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

/** Leest de complete lokale algemene-kostenclassificatie voor één administratie, `ORDER BY ogb_kostensoort` — technische, deterministische leesvolgorde. Geen rijen = lege classificatie, nooit een fout. */
export function leesAlgemeneKostenClassificatie(db: DatabaseSync, bedrijfsnr: string): readonly AlgemeneKostenClassificatieRegel[] {
  const rijen = db
    .prepare(
      `SELECT ogb_kostensoort, ogb_kostensoort_omschrijving, categorie
       FROM begroting_algemene_kosten_classificatie
       WHERE bedrijfsnr = ?
       ORDER BY ogb_kostensoort`,
    )
    .all(bedrijfsnr) as unknown as AlgemeneKostenClassificatieRow[];
  return rijen.map((rij) => ({
    ogbKostensoort: rij.ogb_kostensoort,
    ogbKostensoortOmschrijving: rij.ogb_kostensoort_omschrijving,
    categorie: rij.categorie,
  }));
}

/**
 * Schrijft de COMPLETE gewenste lokale algemene-kostenclassificatie voor
 * één administratie (complete-list save). Faalt vóór elke mutatie als
 * dezelfde OGB-kostensoort dubbel voorkomt in dezelfde aanroep (geen
 * "laatste wint") — de `PRIMARY KEY (bedrijfsnr, ogb_kostensoort)` zou dit
 * ook afdwingen, maar deze vooraf-check geeft een duidelijkere foutmelding
 * vóór enige databasewijziging.
 */
export function schrijfAlgemeneKostenClassificatie(
  db: DatabaseSync,
  bedrijfsnr: string,
  regels: readonly AlgemeneKostenClassificatieRegel[],
): readonly AlgemeneKostenClassificatieRegel[] {
  const codes = regels.map((r) => r.ogbKostensoort);
  const duplicaten = [...new Set(codes.filter((code, index) => codes.indexOf(code) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(
      `Administratie ${bedrijfsnr}: dezelfde OGB-kostensoort komt meerdere keren voor in één classificatie-save (${duplicaten.join(", ")}) — operatie geweigerd.`,
    );
  }

  return withTransaction(db, () => {
    db.prepare(`DELETE FROM begroting_algemene_kosten_classificatie WHERE bedrijfsnr = ?`).run(bedrijfsnr);

    const insertStmt = db.prepare(
      `INSERT INTO begroting_algemene_kosten_classificatie (bedrijfsnr, ogb_kostensoort, ogb_kostensoort_omschrijving, categorie)
       VALUES (?, ?, ?, ?)`,
    );
    for (const regel of regels) {
      insertStmt.run(bedrijfsnr, regel.ogbKostensoort, regel.ogbKostensoortOmschrijving, regel.categorie);
    }

    return leesAlgemeneKostenClassificatie(db, bedrijfsnr);
  });
}
