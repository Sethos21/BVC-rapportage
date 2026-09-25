import type { DatabaseSync } from "node:sqlite";
import type { BgGeplandeVerkoopComponent } from "@bvc/reporting";

/**
 * Persistence voor de LOKALE geplande-verkoop-GL-classificatie
 * (grootboekrekening → component) — OB-039, 2026-09-11-correctie. Zie
 * migratie 22 in `migrations.ts`. Exact hetzelfde architectuurpatroon als
 * `geplandeVerkoopClassificatie.ts` (de OGB-classificatie), uitsluitend de
 * sleutel is `grootboekrekening` i.p.v. `ogb_kostensoort`.
 *
 * WAAROM DEZE TABEL NODIG IS (naast de al bestaande OGB-classificatie): het
 * 023-bronproef bewees dat GL 08830 "Opbrengst verkoop pand" op BEIDE
 * geconstateerde regels GEEN OGB-kostensoort droeg — zonder een GL-
 * classificatiebron zou VERKOOPOPBRENGST voor die administratie dus NOOIT
 * werkelijk-classificeerbaar zijn. Zie `berekenWerkelijkGeplandeVerkoop`
 * (`@bvc/reporting`) voor de resolutievolgorde (eerst OGB, dan GL) —
 * GEEN koppeling tussen de twee classificatiebronnen, en GEEN koppeling
 * tussen VERKOOPOPBRENGST- en BOEKWAARDE_AFBOEKING-classificatie.
 *
 * ADMINISTRATIE-BREED, GEEN BEGROTINGSVERSIE-KOPPELING: sleutel is
 * `bedrijfsnr`, niet `begroting_versie_id`. Vrij muteerbaar, ook na
 * vaststellen van willekeurige begrotingsversies — GEEN CONCEPT/VASTGESTELD-
 * immutability op deze tabel. Uitsluitend gebruikt door de Werkelijk-
 * berekening; een Begroting-regel heeft geen GL-koppeling, dus niets om bij
 * vaststellen te bevriezen op dit punt.
 *
 * GEEN PORTFOLIO-BREDE BETEKENIS: altijd per `bedrijfsnr` geïsoleerd, nooit
 * als generieke/gedeelde mapping bedoeld.
 *
 * COMPLETE-LIST SAVE PER BEDRIJFSNR: geen surrogaat-`id`, de natuurlijke
 * sleutel `(bedrijfsnr, grootboekrekening)` is zelf al de PRIMARY KEY.
 */

export interface GeplandeVerkoopGrootboekClassificatieRegel {
  grootboekrekening: string;
  grootboekOmschrijving: string;
  component: BgGeplandeVerkoopComponent;
}

interface GeplandeVerkoopGrootboekClassificatieRow {
  grootboekrekening: string;
  grootboek_omschrijving: string;
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

/** Leest de complete lokale GL-classificatie voor één administratie, `ORDER BY grootboekrekening`. Geen rijen = lege classificatie, nooit een fout. */
export function leesGeplandeVerkoopGrootboekClassificatie(db: DatabaseSync, bedrijfsnr: string): readonly GeplandeVerkoopGrootboekClassificatieRegel[] {
  const rijen = db
    .prepare(
      `SELECT grootboekrekening, grootboek_omschrijving, component
       FROM begroting_geplande_verkoop_grootboek_classificatie
       WHERE bedrijfsnr = ?
       ORDER BY grootboekrekening`,
    )
    .all(bedrijfsnr) as unknown as GeplandeVerkoopGrootboekClassificatieRow[];
  return rijen.map((rij) => ({
    grootboekrekening: rij.grootboekrekening,
    grootboekOmschrijving: rij.grootboek_omschrijving,
    component: rij.component,
  }));
}

/**
 * Schrijft de COMPLETE gewenste lokale GL-classificatie voor één
 * administratie (complete-list save). Faalt vóór elke mutatie als dezelfde
 * grootboekrekening dubbel voorkomt in dezelfde aanroep.
 */
export function schrijfGeplandeVerkoopGrootboekClassificatie(
  db: DatabaseSync,
  bedrijfsnr: string,
  regels: readonly GeplandeVerkoopGrootboekClassificatieRegel[],
): readonly GeplandeVerkoopGrootboekClassificatieRegel[] {
  const rekeningen = regels.map((r) => r.grootboekrekening);
  const duplicaten = [...new Set(rekeningen.filter((rekening, index) => rekeningen.indexOf(rekening) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(`Administratie ${bedrijfsnr}: dezelfde grootboekrekening komt meerdere keren voor in één classificatie-save (${duplicaten.join(", ")}) — operatie geweigerd.`);
  }

  return withTransaction(db, () => {
    db.prepare(`DELETE FROM begroting_geplande_verkoop_grootboek_classificatie WHERE bedrijfsnr = ?`).run(bedrijfsnr);

    const insertStmt = db.prepare(
      `INSERT INTO begroting_geplande_verkoop_grootboek_classificatie (bedrijfsnr, grootboekrekening, grootboek_omschrijving, component)
       VALUES (?, ?, ?, ?)`,
    );
    for (const regel of regels) {
      insertStmt.run(bedrijfsnr, regel.grootboekrekening, regel.grootboekOmschrijving, regel.component);
    }

    return leesGeplandeVerkoopGrootboekClassificatie(db, bedrijfsnr);
  });
}
