import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { LEEGSTAND_CATEGORIEEN, type BgLeegstandBasisbedragHerkomst, type BgLeegstandCategorie } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de PER-CATEGORIE module-brede staat van Leegstandskosten
 * (OB-031) — `beoordeeld` + de Servicekosten-leegstand-rekenhulp
 * (`laatstBekendServicekostenvoorschotJaar` + de herkomst daarvan +
 * `verwachteLeegstandsperiodeMaanden`). Zie migratie 18 in `migrations.ts`.
 * Exact hetzelfde patroon als `algemeneKostenCategorieState.ts` (OB-035/036).
 *
 * PRECIES DRIE RIJEN PER BEGROTINGSVERSIE (één per vaste categorie uit
 * `LEEGSTAND_CATEGORIEEN`) — schrijft/vervangt daarom altijd ALLE DRIE
 * categorieën in één aanroep.
 *
 * "GEEN RIJ VOOR EEN CATEGORIE" IS GEEN APARTE BETEKENISVOLLE TOESTAND:
 * een ontbrekende rij is functioneel gelijk aan `beoordeeld=false` + alle
 * rekenhulpvelden `null`. `leesLeegstandCategorieState` geeft daarom ALTIJD
 * een compleet `Record` voor alle drie categorieën terug.
 *
 * BRON VERSUS HANDMATIG (correctie 2026-09-10): deze laag slaat uitsluitend
 * op wat de aanroeper aanlevert — ze query't zelf NOOIT RentRoll/
 * Huurdersoverzicht om een "betrouwbaar" bedrag te vinden. `"BRON"` betekent
 * dat de aanroeper (een latere Worker-integratie) al heeft vastgesteld dat
 * het aangeleverde `laatstBekendServicekostenvoorschotJaar` een betrouwbaar
 * gekoppeld bedrag is; `"HANDMATIG"` betekent dat de gebruiker het zelf heeft
 * ingevoerd. Deze tabel bewaart die herkomst puur ter traceerbaarheid — ze
 * valideert of herberekent hem niet.
 */

export interface LeegstandCategorieStateInvoer {
  beoordeeld: boolean;
  /** Rekenhulp (OB-031) — puur informatief, zie `begroteLeegstand.ts`'s moduledoc. */
  laatstBekendServicekostenvoorschotJaar: Decimal | null;
  /** `"BRON"` | `"HANDMATIG"` | `null` (uitsluitend `null` wanneer het bedrag zelf ook `null` is) — zie moduledoc. */
  laatstBekendServicekostenvoorschotJaarHerkomst: BgLeegstandBasisbedragHerkomst | null;
  verwachteLeegstandsperiodeMaanden: Decimal | null;
}

interface LeegstandCategorieStateRow {
  categorie: BgLeegstandCategorie;
  beoordeeld: number;
  laatst_bekend_servicekostenvoorschot_jaar: string | null;
  laatst_bekend_servicekostenvoorschot_jaar_herkomst: BgLeegstandBasisbedragHerkomst | null;
  verwachte_leegstandsperiode_maanden: string | null;
}

const LEGE_CATEGORIE_STATE: LeegstandCategorieStateInvoer = {
  beoordeeld: false,
  laatstBekendServicekostenvoorschotJaar: null,
  laatstBekendServicekostenvoorschotJaarHerkomst: null,
  verwachteLeegstandsperiodeMaanden: null,
};

/** Leest de staat van alle drie categorieën voor één begrotingsversie — ontbrekende categorieën krijgen `beoordeeld=false`/alle rekenhulpvelden `null` (zie moduledoc). */
export function leesLeegstandCategorieState(db: DatabaseSync, versieId: string): Record<BgLeegstandCategorie, LeegstandCategorieStateInvoer> {
  const rijen = db
    .prepare(
      `SELECT categorie, beoordeeld, laatst_bekend_servicekostenvoorschot_jaar, laatst_bekend_servicekostenvoorschot_jaar_herkomst, verwachte_leegstandsperiode_maanden
       FROM begroting_leegstand_categorie_state
       WHERE begroting_versie_id = ?`,
    )
    .all(versieId) as unknown as LeegstandCategorieStateRow[];
  const perCategorie = new Map(
    rijen.map((rij) => [
      rij.categorie,
      {
        beoordeeld: rij.beoordeeld === 1,
        laatstBekendServicekostenvoorschotJaar: rij.laatst_bekend_servicekostenvoorschot_jaar !== null ? new Decimal(rij.laatst_bekend_servicekostenvoorschot_jaar) : null,
        laatstBekendServicekostenvoorschotJaarHerkomst: rij.laatst_bekend_servicekostenvoorschot_jaar_herkomst,
        verwachteLeegstandsperiodeMaanden: rij.verwachte_leegstandsperiode_maanden !== null ? new Decimal(rij.verwachte_leegstandsperiode_maanden) : null,
      } satisfies LeegstandCategorieStateInvoer,
    ]),
  );

  return Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((categorie) => [categorie, perCategorie.get(categorie) ?? LEGE_CATEGORIE_STATE])) as Record<
    BgLeegstandCategorie,
    LeegstandCategorieStateInvoer
  >;
}

/**
 * Schrijft (vervangt volledig) de staat van ALLE DRIE categorieën voor één
 * begrotingsversie. Faalt vóór elke databasewijziging als de parent niet
 * bestaat of geen CONCEPT is.
 */
export function schrijfLeegstandCategorieState(db: DatabaseSync, versieId: string, staat: Record<BgLeegstandCategorie, LeegstandCategorieStateInvoer>): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — Leegstand-categorie-state mag uitsluitend op een CONCEPT-versie worden geschreven.`);
  }

  const upsertStmt = db.prepare(
    `INSERT INTO begroting_leegstand_categorie_state
       (begroting_versie_id, categorie, beoordeeld, laatst_bekend_servicekostenvoorschot_jaar, laatst_bekend_servicekostenvoorschot_jaar_herkomst, verwachte_leegstandsperiode_maanden)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (begroting_versie_id, categorie) DO UPDATE SET
       beoordeeld = excluded.beoordeeld,
       laatst_bekend_servicekostenvoorschot_jaar = excluded.laatst_bekend_servicekostenvoorschot_jaar,
       laatst_bekend_servicekostenvoorschot_jaar_herkomst = excluded.laatst_bekend_servicekostenvoorschot_jaar_herkomst,
       verwachte_leegstandsperiode_maanden = excluded.verwachte_leegstandsperiode_maanden`,
  );

  for (const categorie of LEEGSTAND_CATEGORIEEN) {
    const invoer = staat[categorie];
    upsertStmt.run(
      versieId,
      categorie,
      invoer.beoordeeld ? 1 : 0,
      invoer.laatstBekendServicekostenvoorschotJaar !== null ? invoer.laatstBekendServicekostenvoorschotJaar.toString() : null,
      invoer.laatstBekendServicekostenvoorschotJaarHerkomst,
      invoer.verwachteLeegstandsperiodeMaanden !== null ? invoer.verwachteLeegstandsperiodeMaanden.toString() : null,
    );
  }
}
