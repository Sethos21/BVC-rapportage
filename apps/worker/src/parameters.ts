import { existsSync, readFileSync } from "node:fs";
import { parseBeheerparameters, STANDAARD_PARAMETERS, type Beheerparameters } from "@bvc/config";
import { parametersPad } from "./paths.js";

/**
 * Laadt de beheerparameters uit `<root>/config/parameters.json` (CLAUDE.md
 * §3: config-gestuurd, geen hardcoded uitzonderingen). Ontbreekt het
 * bestand, dan gelden de standaardwaarden (`STANDAARD_PARAMETERS`) — die
 * reproduceren het gedrag van vóór het config-gestuurd maken van deze
 * regels. Staat er wél een bestand maar is het ongeldig, dan faalt dit
 * hard ("Controle vereist", geen stilzwijgende fallback op een kapotte
 * config).
 */
export function laadBeheerparameters(root: string): Beheerparameters {
  const pad = parametersPad(root);
  if (!existsSync(pad)) {
    return STANDAARD_PARAMETERS;
  }
  const ruw: unknown = JSON.parse(readFileSync(pad, "utf-8"));
  return parseBeheerparameters(ruw);
}
