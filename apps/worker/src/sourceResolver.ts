import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BRON_BESTANDSNAAM,
  administratieBronDir,
  bronGedeeldDir,
  type BronType,
} from "./paths.js";
import { leesAdministratieConfig, type BronLocatie } from "./administratie.js";

export interface BronResolutie {
  bronType: BronType;
  locatie: BronLocatie;
  pad: string;
  bestaat: boolean;
}

/**
 * Bepaalt voor één administratie en brontype EXACT één brondlocatie, op
 * basis van administratie.json. Voegt nooit gedeeld en eigen samen en wijkt
 * nooit automatisch uit naar de andere locatie als het bestand ontbreekt
 * (CLAUDE_AANVULLENDE_INSTRUCTIES_LOKALE_BRONNEN_v0.1.md §3).
 */
export function resolveBron(root: string, administratieId: string, bronType: BronType): BronResolutie {
  const config = leesAdministratieConfig(root, administratieId);
  const locatie = config.bronlocaties[bronType];
  const bestandsnaam = BRON_BESTANDSNAAM[bronType];
  const pad =
    locatie === "gedeeld"
      ? join(bronGedeeldDir(root), bestandsnaam)
      : join(administratieBronDir(root, administratieId), bestandsnaam);

  return { bronType, locatie, pad, bestaat: existsSync(pad) };
}

export function resolveAlleBronnen(root: string, administratieId: string): BronResolutie[] {
  const config = leesAdministratieConfig(root, administratieId);
  return (Object.keys(config.bronlocaties) as BronType[]).map((bronType) => resolveBron(root, administratieId, bronType));
}
