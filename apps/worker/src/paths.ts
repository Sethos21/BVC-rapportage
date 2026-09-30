import { join } from "node:path";

/**
 * Mappenstructuur per CLAUDE_OVERDRACHT_LOKALE_DATAOPZET_v0.1.md (punt 8)
 * en CLAUDE_AANVULLENDE_INSTRUCTIES_LOKALE_BRONNEN_v0.1.md (punt 8):
 *
 * <root>/
 *   config/
 *   bron_gedeeld/
 *   audit/
 *   administraties/<Bedrijfsnr>_<naam>/
 *     administratie.json
 *     bron/        (alleen brontypen die op 'eigen' staan)
 *     cache/
 *     rapporten/
 *     audit/
 */

export const BRON_TYPES = [
  "boekingen",
  "balans_per_jaar",
  "rentroll",
  "contracten_huidig",
  "units",
  "complex_totalen",
  "servicekosten",
  "ouderdomsanalyse",
  "begroting",
  "contract_verhogingen",
  "vorderingen_met_afboekingen",
] as const;

export type BronType = (typeof BRON_TYPES)[number];

/**
 * Migratie 2026-08-31: het brontype "ouderdomsanalyse" wijst voortaan naar
 * `saldo_huurders.xlsx` — bewezen dezelfde Informant-export (identieke 33
 * kolommen, zie packages/reporting/README.md) als het vervangen
 * `ouderdomsanalyse.xlsx`, alleen actueler. Bewust GEEN nieuwe interne naam
 * (BronType/cachetabel blijven "ouderdomsanalyse") om migratierisico te
 * beperken — alleen de bestandsnaam-mapping verandert.
 */
export const BRON_BESTANDSNAAM: Record<BronType, string> = {
  boekingen: "boekingen.xlsx",
  balans_per_jaar: "balans_per_jaar.xlsx",
  rentroll: "rentroll.xlsx",
  contracten_huidig: "contracten_huidig.xlsx",
  units: "units.xlsx",
  complex_totalen: "complex_totalen.xlsx",
  servicekosten: "servicekosten.xlsx",
  ouderdomsanalyse: "saldo_huurders.xlsx",
  begroting: "begroting.xlsx",
  contract_verhogingen: "contract_verhogingen.xlsx",
  vorderingen_met_afboekingen: "vorderingen_met_afboekingen.xlsx",
};

/**
 * De databronwortel is bewust configureerbaar (geen hardcoded pad) — dit
 * draait op verschillende werkcomputers binnen het bedrijfsnetwerk.
 */
export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const root = env["BVC_DATA_ROOT"];
  if (!root) {
    throw new Error(
      "BVC_DATA_ROOT is niet gezet — wijs naar de lokale/interne hoofdmap (bv. BVC-FinancieelRapport/).",
    );
  }
  return root;
}

export function configDir(root: string): string {
  return join(root, "config");
}

/** CLAUDE.md §3: config-gestuurd — beheerparameters (uitzonderingen/normen) staan hier, niet hardcoded in code. */
export function parametersPad(root: string): string {
  return join(configDir(root), "parameters.json");
}

/** CLAUDE.md §3/§6: grootboekmapping per administratie, centraal onder config/ — nooit hardcoded in rapportagecode. */
export function grootboekmappingenDir(root: string): string {
  return join(configDir(root), "grootboekmappingen");
}

export function grootboekmappingPad(root: string, administratieId: string): string {
  return join(grootboekmappingenDir(root), `${administratieId}.json`);
}

/** Centrale master-grootboekmapping, één bestand voor alle administraties — zie packages/config/README.md. */
export function grootboekmappingMasterPad(root: string): string {
  return join(configDir(root), "grootboekmapping_master.json");
}

export function bronGedeeldDir(root: string): string {
  return join(root, "bron_gedeeld");
}

export function auditGedeeldPad(root: string): string {
  return join(root, "audit", "import_log_gedeeld.jsonl");
}

export function administratiesDir(root: string): string {
  return join(root, "administraties");
}

export function administratieDir(root: string, administratieId: string): string {
  return join(administratiesDir(root), administratieId);
}

export function administratieConfigPad(root: string, administratieId: string): string {
  return join(administratieDir(root, administratieId), "administratie.json");
}

export function administratieBronDir(root: string, administratieId: string): string {
  return join(administratieDir(root, administratieId), "bron");
}

export function administratieCacheDir(root: string, administratieId: string): string {
  return join(administratieDir(root, administratieId), "cache");
}

export function administratieCachePad(root: string, administratieId: string): string {
  return join(administratieCacheDir(root, administratieId), "cache.sqlite");
}

/**
 * FASE DELTA (2026-09-18, "Pure P&L → Worker + Renderer") — de centrale
 * P&L-bronmapping-database (`@bvc/begroting-data`'s `openOrCreateDatabase`/
 * `leesPnLBronmappingRegels`, migratie 24/25) is administratie-gescheiden,
 * net als de boekingencache — geen portefeuillebreed bestand. Dit is de
 * EERSTE plek waar `apps/worker` dit bestand daadwerkelijk opent; ervoor
 * bestond er geen productiepad naartoe (zie `genereerPnLPeriode.ts`).
 */
export function pnlBronmappingDatabasePad(root: string, administratieId: string): string {
  return join(administratieDir(root, administratieId), "begroting", "pnl-bronmapping.sqlite");
}

/**
 * TRANCHE 11/13 — de `@bvc/begroting-data`-database (begrotingsversies + alle module-concept-/
 * frozen-/Estimated-tabellen) leeft in HETZELFDE per-administratie bestand als de P&L-
 * bronmapping-database hierboven (`openOrCreateDatabase` draait dezelfde volledige migratielijst
 * ongeacht welk pad wordt geopend, dus beide schema's bestaan al in één bestand).
 *
 * CORRECTIE (Tranche 13): tot en met Tranche 12 was dit bewust een EIGEN bestand
 * (`begrotingsversies.sqlite`, naast `pnl-bronmapping.sqlite`). Dat bleek een technisch restpunt:
 * `@bvc/begroting-data`'s `leesRelevanteGemeentelijkeLastenGrootboekenVoorAdministratie` (aangeroepen
 * ván bínnen `herberekenBegroting`, dus met de begrotingsversies-`db`-connectie) leest de centrale
 * P&L-bronmapping via DIE ZELFDE `db` — met twee gescheiden bestanden zou de Gemeentelijke-Lasten-
 * "relevante GL"-controle in productie ALTIJD een lege set zien, ook met een correct geregistreerde
 * mapping. Beide bestanden samenvoegen tot één is de kleinste correcte fix (geen wijziging aan
 * `@bvc/begroting-data` zelf nodig) — er was nooit een functionele reden voor twee bestanden, alleen
 * toevallige historische scheiding; beide zijn en blijven per-administratie (geen gedeeld/
 * portefeuillebreed bestand, CLAUDE.md §6 "geen hardcoded 070"). Geen bestaande productiedata
 * getroffen: er bestaat nog geen echte `begrotingsversies.sqlite` bij een klant.
 */
export function begrotingsversiesDatabasePad(root: string, administratieId: string): string {
  return pnlBronmappingDatabasePad(root, administratieId);
}

export function administratieRapportenDir(root: string, administratieId: string): string {
  return join(administratieDir(root, administratieId), "rapporten");
}

export function administratieAuditPad(root: string, administratieId: string): string {
  return join(administratieDir(root, administratieId), "audit", "import_log.jsonl");
}

export function lockPad(root: string): string {
  return join(root, "audit", ".lock");
}
