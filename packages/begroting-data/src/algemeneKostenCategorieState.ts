import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { ALGEMENE_KOSTEN_CATEGORIEEN, type BgAlgemeneKostenCategorie } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de PER-CATEGORIE module-brede staat van Algemene kosten
 * (OB-035/036) — `beoordeeld` + de optionele Accountant/Bankkosten-
 * rekenhulp (`vorigJaarBedrag`/`verwachteVerhogingPercentage`). Zie
 * migratie 16 in `migrations.ts` voor de volledige tabelonderbouwing.
 *
 * PRECIES VIJF RIJEN PER BEGROTINGSVERSIE (één per vaste categorie uit
 * `ALGEMENE_KOSTEN_CATEGORIEEN`) — `schrijfAlgemeneKostenCategorieState`
 * schrijft/vervangt daarom altijd ALLE VIJF categorieën in één aanroep
 * (zelfde "complete rij(en) per begrotingsversie"-precedent als
 * `module3Invoer.ts`/`gemeentelijkeLastenModule.ts`), nooit één categorie
 * los.
 *
 * "GEEN RIJ VOOR EEN CATEGORIE" IS GEEN APARTE BETEKENISVOLLE TOESTAND
 * (zelfde principe als `gemeentelijkeLastenModule.ts`): omdat `beoordeeld`
 * en beide rekenhulpvelden al onafhankelijk een neutrale "nog niet
 * ingevuld"-waarde kennen (`false`/`null`), is een ontbrekende rij
 * functioneel exact gelijk aan een rij met `beoordeeld=false` en beide
 * rekenhulpvelden `null`. `leesAlgemeneKostenCategorieState` geeft daarom
 * ALTIJD een compleet `Record` voor alle vijf categorieën terug, nooit
 * `null`/een kortere set.
 */

export interface AlgemeneKostenCategorieStateInvoer {
  beoordeeld: boolean;
  /** Rekenhulp (OB-035/036 §9) — puur informatief, zie `begroteAlgemeneKosten.ts`'s moduledoc. */
  vorigJaarBedrag: Decimal | null;
  verwachteVerhogingPercentage: Decimal | null;
}

interface AlgemeneKostenCategorieStateRow {
  categorie: BgAlgemeneKostenCategorie;
  beoordeeld: number;
  vorig_jaar_bedrag: string | null;
  verwachte_verhoging_percentage: string | null;
}

const LEGE_CATEGORIE_STATE: AlgemeneKostenCategorieStateInvoer = {
  beoordeeld: false,
  vorigJaarBedrag: null,
  verwachteVerhogingPercentage: null,
};

/** Leest de staat van alle vijf categorieën voor één begrotingsversie — ontbrekende categorieën krijgen `beoordeeld=false`/beide rekenhulpvelden `null` (zie moduledoc, geen aparte derde toestand). */
export function leesAlgemeneKostenCategorieState(
  db: DatabaseSync,
  versieId: string,
): Record<BgAlgemeneKostenCategorie, AlgemeneKostenCategorieStateInvoer> {
  const rijen = db
    .prepare(
      `SELECT categorie, beoordeeld, vorig_jaar_bedrag, verwachte_verhoging_percentage
       FROM begroting_algemene_kosten_categorie_state
       WHERE begroting_versie_id = ?`,
    )
    .all(versieId) as unknown as AlgemeneKostenCategorieStateRow[];
  const perCategorie = new Map(
    rijen.map((rij) => [
      rij.categorie,
      {
        beoordeeld: rij.beoordeeld === 1,
        vorigJaarBedrag: rij.vorig_jaar_bedrag !== null ? new Decimal(rij.vorig_jaar_bedrag) : null,
        verwachteVerhogingPercentage: rij.verwachte_verhoging_percentage !== null ? new Decimal(rij.verwachte_verhoging_percentage) : null,
      } satisfies AlgemeneKostenCategorieStateInvoer,
    ]),
  );

  return Object.fromEntries(
    ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie) => [categorie, perCategorie.get(categorie) ?? LEGE_CATEGORIE_STATE]),
  ) as Record<BgAlgemeneKostenCategorie, AlgemeneKostenCategorieStateInvoer>;
}

/**
 * Schrijft (vervangt volledig) de staat van ALLE VIJF categorieën voor één
 * begrotingsversie. Faalt vóór elke databasewijziging als de parent niet
 * bestaat of geen CONCEPT is. Eén `INSERT … ON CONFLICT … DO UPDATE` per
 * categorie die alle kolommen expliciet zet — complete vervanging per
 * categorie, geen gedeeltelijke patchsemantiek.
 */
export function schrijfAlgemeneKostenCategorieState(
  db: DatabaseSync,
  versieId: string,
  staat: Record<BgAlgemeneKostenCategorie, AlgemeneKostenCategorieStateInvoer>,
): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — Algemene-Kosten-categorie-state mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  const upsertStmt = db.prepare(
    `INSERT INTO begroting_algemene_kosten_categorie_state
       (begroting_versie_id, categorie, beoordeeld, vorig_jaar_bedrag, verwachte_verhoging_percentage)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (begroting_versie_id, categorie) DO UPDATE SET
       beoordeeld = excluded.beoordeeld,
       vorig_jaar_bedrag = excluded.vorig_jaar_bedrag,
       verwachte_verhoging_percentage = excluded.verwachte_verhoging_percentage`,
  );

  for (const categorie of ALGEMENE_KOSTEN_CATEGORIEEN) {
    const invoer = staat[categorie];
    upsertStmt.run(
      versieId,
      categorie,
      invoer.beoordeeld ? 1 : 0,
      invoer.vorigJaarBedrag !== null ? invoer.vorigJaarBedrag.toString() : null,
      invoer.verwachteVerhogingPercentage !== null ? invoer.verwachteVerhogingPercentage.toString() : null,
    );
  }
}
