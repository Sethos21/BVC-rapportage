import { existsSync, readFileSync } from "node:fs";
import { parseGrootboekMapping, type GrootboekMappingConfig } from "@bvc/config";
import { grootboekmappingPad } from "./paths.js";

/**
 * Laadt de grootboekmapping van één administratie uit
 * `<root>/config/grootboekmappingen/<administratieId>.json`. In tegenstelling
 * tot `laadBeheerparameters` is er hier bewust GEEN standaardwaarde/fallback:
 * een ontbrekend mappingbestand betekent "deze administratie heeft nog geen
 * geconfigureerde grootboekmapping", nooit stilzwijgend de mapping van een
 * andere administratie (of een lege mapping) gebruiken (CLAUDE.md §6).
 * Staat er wél een bestand maar is het ongeldig, dan faalt dit hard.
 */
export function leesGrootboekMapping(root: string, administratieId: string): GrootboekMappingConfig {
  const pad = grootboekmappingPad(root, administratieId);
  if (!existsSync(pad)) {
    throw new Error(`Grootboekmapping ontbreekt voor administratie "${administratieId}" (${pad}) — nog geen mapping geconfigureerd.`);
  }
  const ruw: unknown = JSON.parse(readFileSync(pad, "utf-8"));
  return parseGrootboekMapping(ruw);
}
