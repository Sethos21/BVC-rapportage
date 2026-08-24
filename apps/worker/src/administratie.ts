import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { BRON_TYPES, type BronType, administratieConfigPad, administratieDir } from "./paths.js";

export type BronLocatie = "gedeeld" | "eigen";

export interface AdministratieConfig {
  bedrijfsnr: string;
  weergavenaam: string;
  mapversie: string;
  /** Per brontype exact één locatie — bronresolver.ts combineert deze nooit. */
  bronlocaties: Record<BronType, BronLocatie>;
  laatstGeopendBoekjaar?: number;
  laatstGeopendBoekperiode?: string;
  /**
   * Configureerbare streefwaarde bankstand voor het Kasstroom-
   * managementoverzicht (2026-08-22) — per administratie, geen globale
   * parameter (elke administratie/complex heeft een andere gewenste
   * bankstand). Decimaal bedrag als string (zelfde conventie als andere
   * JSON-config-bestanden in deze repo). Optioneel: ontbreekt dit veld, dan
   * levert de kasstroomberekening `onbekend` op voor deze KPI, nooit een
   * geraden standaardwaarde.
   */
  streefwaardeBankstand?: string | null;
}

/**
 * Standaardindeling uit CLAUDE_AANVULLENDE_INSTRUCTIES_LOKALE_BRONNEN_v0.1.md
 * §2: alles gedeeld behalve de begroting (die per administratie apart wordt
 * opgesteld en dus standaard 'eigen' is).
 */
export const DEFAULT_BRONLOCATIES: Record<BronType, BronLocatie> = {
  boekingen: "gedeeld",
  balans_per_jaar: "gedeeld",
  rentroll: "gedeeld",
  contracten_huidig: "gedeeld",
  units: "gedeeld",
  complex_totalen: "gedeeld",
  servicekosten: "gedeeld",
  ouderdomsanalyse: "gedeeld",
  begroting: "eigen",
};

export function nieuweAdministratieConfig(bedrijfsnr: string, weergavenaam: string): AdministratieConfig {
  return {
    bedrijfsnr,
    weergavenaam,
    mapversie: "1",
    bronlocaties: { ...DEFAULT_BRONLOCATIES },
  };
}

export function leesAdministratieConfig(root: string, administratieId: string): AdministratieConfig {
  const pad = administratieConfigPad(root, administratieId);
  if (!existsSync(pad)) {
    throw new Error(`administratie.json ontbreekt voor "${administratieId}" op ${pad}.`);
  }
  const parsed = JSON.parse(readFileSync(pad, "utf-8")) as AdministratieConfig;
  valideerConfig(parsed);
  return parsed;
}

/** Schrijft administratie.json atomisch (temp-bestand + rename), zoals het bronvervangingsprotocol. */
export function schrijfAdministratieConfig(root: string, administratieId: string, config: AdministratieConfig): void {
  valideerConfig(config);
  const pad = administratieConfigPad(root, administratieId);
  mkdirSync(dirname(pad), { recursive: true });
  const tmpPad = `${pad}.tmp-${randomUUID()}`;
  writeFileSync(tmpPad, JSON.stringify(config, null, 2), "utf-8");
  renameSync(tmpPad, pad);
}

function valideerConfig(config: AdministratieConfig): void {
  if (!config.bedrijfsnr) throw new Error("administratie.json mist verplicht veld bedrijfsnr.");
  for (const bronType of BRON_TYPES) {
    const locatie = config.bronlocaties[bronType];
    if (locatie !== "gedeeld" && locatie !== "eigen") {
      throw new Error(`administratie.json: bronlocaties.${bronType} moet 'gedeeld' of 'eigen' zijn, kreeg "${String(locatie)}".`);
    }
  }
}

export function bestaatAdministratie(root: string, administratieId: string): boolean {
  return existsSync(administratieDir(root, administratieId));
}

export class AdministratieBestaatAlError extends Error {}

/**
 * Initialiseert een nieuwe administratie: schrijft `administratie.json` met
 * de standaard bronlocaties (alles 'gedeeld' behalve begroting — zie
 * DEFAULT_BRONLOCATIES), zodat bestaande gedeelde bronbestanden meteen
 * bruikbaar zijn zonder aparte bronbestanden per administratie. Overschrijft
 * nooit een bestaande administratie (gebruik schrijfAdministratieConfig
 * rechtstreeks om een bestaande config aan te passen).
 */
export function initAdministratie(root: string, administratieId: string, bedrijfsnr: string, weergavenaam: string): AdministratieConfig {
  if (bestaatAdministratie(root, administratieId)) {
    throw new AdministratieBestaatAlError(`Administratie "${administratieId}" bestaat al — init overschrijft nooit een bestaande administratie.json.`);
  }
  const config = nieuweAdministratieConfig(bedrijfsnr, weergavenaam);
  schrijfAdministratieConfig(root, administratieId, config);
  return config;
}
