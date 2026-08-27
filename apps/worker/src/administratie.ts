import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { BRON_TYPES, type BronType, administratieConfigPad, administratieDir, administratiesDir } from "./paths.js";

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
   * Administratie-specifieke grootboekrekeningen voor de servicekosten-
   * reconciliatie (`servicekostenPositie.ts`'s sectie C) — UITSLUITEND
   * bewezen voor `070_Rooise_Zoom` (kostenrekening "1712", voorschotten-
   * rekening "1711"), GEEN universele default voor andere administraties.
   * Optioneel: ontbreekt dit veld, dan geeft de Worker een lege
   * doelrekeningen-lijst door — de reconciliatie wordt dan overgeslagen met
   * één duidelijke `controleVereist`-melding, nooit stilzwijgend 1711/1712
   * aangenomen (zie `genereerManagementRapport.ts`/`genereerServicekostenPositie.ts`).
   */
  servicekostenRekeningen?: { kostenrekening: string; voorschottenrekening: string } | undefined;
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

export interface AdministratieListItem {
  administratieId: string;
  bedrijfsnr: string;
  weergavenaam: string;
}

/**
 * Leest alle administraties dynamisch uit `<root>/administraties/` — puur
 * listing (submappen + hun `administratie.json`), geen berekening. Gebruikt
 * door `serve` (invoerscherm) om de administratie-dropdown te vullen; nooit
 * een hardcoded lijst. Een submap zonder geldige `administratie.json` wordt
 * overgeslagen (niet fataal) zodat één onvolledige/corrupte administratie de
 * rest van de lijst niet blokkeert.
 */
export function lijstAdministraties(root: string): AdministratieListItem[] {
  const dir = administratiesDir(root);
  if (!existsSync(dir)) return [];

  const resultaat: AdministratieListItem[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const config = leesAdministratieConfig(root, entry.name);
      resultaat.push({ administratieId: entry.name, bedrijfsnr: config.bedrijfsnr, weergavenaam: config.weergavenaam });
    } catch {
      continue;
    }
  }
  return resultaat.sort((a, b) => a.weergavenaam.localeCompare(b.weergavenaam));
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
