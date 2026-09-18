import type { DatabaseSync } from "node:sqlite";
import type { BgGeplandeVerkoopComponent } from "@bvc/reporting";

/**
 * Persistence voor de LOKALE geplande-verkoop-classificatie (OGB-kostensoort
 * → component: VERKOOPOPBRENGST of BOEKWAARDE_AFBOEKING) — OB-039. Zie
 * migratie 22 in `migrations.ts`. Exact hetzelfde architectuurpatroon als
 * `renteClassificatie.ts`/`leegstandClassificatie.ts`.
 *
 * ADMINISTRATIE-BREED, GEEN BEGROTINGSVERSIE-KOPPELING: sleutel is
 * `bedrijfsnr`, niet `begroting_versie_id`. Vrij muteerbaar, ook na
 * vaststellen van willekeurige begrotingsversies — GEEN CONCEPT/VASTGESTELD-
 * immutability op deze tabel. Uitsluitend gebruikt door de Werkelijk-
 * berekening (`berekenWerkelijkGeplandeVerkoop`); een Begroting-regel heeft
 * geen OGB-koppeling, dus niets om bij vaststellen te bevriezen op dit punt.
 *
 * GEEN PORTFOLIO-BREDE BETEKENIS: het OB-039-bronproef (023, GL08830/00166/
 * 00167, boekjaar 2026 periode 04) bewees dat GL/periode alleen onvoldoende
 * is om een verkoop te classificeren — deze tabel is daarom altijd per
 * `bedrijfsnr` geïsoleerd, nooit als generieke/gedeelde mapping bedoeld.
 *
 * COMPLETE-LIST SAVE PER BEDRIJFSNR: geen surrogaat-`id`, de natuurlijke
 * sleutel `(bedrijfsnr, ogb_kostensoort)` is zelf al de PRIMARY KEY.
 */

export interface GeplandeVerkoopClassificatieRegel {
  ogbKostensoort: string;
  ogbKostensoortOmschrijving: string;
  component: BgGeplandeVerkoopComponent;
}

interface GeplandeVerkoopClassificatieRow {
  ogb_kostensoort: string;
  ogb_kostensoort_omschrijving: string;
  component: BgGeplandeVerkoopComponent;
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

/** Leest de complete lokale geplande-verkoop-classificatie voor één administratie, `ORDER BY ogb_kostensoort`. Geen rijen = lege classificatie, nooit een fout. */
export function leesGeplandeVerkoopClassificatie(db: DatabaseSync, bedrijfsnr: string): readonly GeplandeVerkoopClassificatieRegel[] {
  const rijen = db
    .prepare(
      `SELECT ogb_kostensoort, ogb_kostensoort_omschrijving, component
       FROM begroting_geplande_verkoop_classificatie
       WHERE bedrijfsnr = ?
       ORDER BY ogb_kostensoort`,
    )
    .all(bedrijfsnr) as unknown as GeplandeVerkoopClassificatieRow[];
  return rijen.map((rij) => ({
    ogbKostensoort: rij.ogb_kostensoort,
    ogbKostensoortOmschrijving: rij.ogb_kostensoort_omschrijving,
    component: rij.component,
  }));
}

/**
 * Schrijft de COMPLETE gewenste lokale geplande-verkoop-classificatie voor
 * één administratie (complete-list save). Faalt vóór elke mutatie als
 * dezelfde OGB-kostensoort dubbel voorkomt in dezelfde aanroep.
 */
export function schrijfGeplandeVerkoopClassificatie(
  db: DatabaseSync,
  bedrijfsnr: string,
  regels: readonly GeplandeVerkoopClassificatieRegel[],
): readonly GeplandeVerkoopClassificatieRegel[] {
  const codes = regels.map((r) => r.ogbKostensoort);
  const duplicaten = [...new Set(codes.filter((code, index) => codes.indexOf(code) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(`Administratie ${bedrijfsnr}: dezelfde OGB-kostensoort komt meerdere keren voor in één classificatie-save (${duplicaten.join(", ")}) — operatie geweigerd.`);
  }

  return withTransaction(db, () => {
    db.prepare(`DELETE FROM begroting_geplande_verkoop_classificatie WHERE bedrijfsnr = ?`).run(bedrijfsnr);

    const insertStmt = db.prepare(
      `INSERT INTO begroting_geplande_verkoop_classificatie (bedrijfsnr, ogb_kostensoort, ogb_kostensoort_omschrijving, component)
       VALUES (?, ?, ?, ?)`,
    );
    for (const regel of regels) {
      insertStmt.run(bedrijfsnr, regel.ogbKostensoort, regel.ogbKostensoortOmschrijving, regel.component);
    }

    return leesGeplandeVerkoopClassificatie(db, bedrijfsnr);
  });
}
