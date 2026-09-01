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
] as const;

export type BronType = (typeof BRON_TYPES)[number];

export const BRON_BESTANDSNAAM: Record<BronType, string> = {
  boekingen: "boekingen.xlsx",
  balans_per_jaar: "balans_per_jaar.xlsx",
  rentroll: "rentroll.xlsx",
  contracten_huidig: "contracten_huidig.xlsx",
  units: "units.xlsx",
  complex_totalen: "complex_totalen.xlsx",
  servicekosten: "servicekosten.xlsx",
  ouderdomsanalyse: "ouderdomsanalyse.xlsx",
  begroting: "begroting.xlsx",
  contract_verhogingen: "contract_verhogingen.xlsx",
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

export function administratieRapportenDir(root: string, administratieId: string): string {
  return join(administratieDir(root, administratieId), "rapporten");
}

export function administratieAuditPad(root: string, administratieId: string): string {
  return join(administratieDir(root, administratieId), "audit", "import_log.jsonl");
}

export function lockPad(root: string): string {
  return join(root, "audit", ".lock");
}
