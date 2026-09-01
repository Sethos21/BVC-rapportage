import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { BRON_TYPES, type BronType, administratieConfigPad, administratieDir, administratiesDir } from "./paths.js";

export type BronLocatie = "gedeeld" | "eigen";

/**
 * Wordt bank-/debiteurenaflettering voor deze administratie door ons
 * bijgehouden in Informant? `true` = ja, openstaande-postensaldi mogen als
 * betrouwbare actuele betaalpositie gelden. `false` = nee (bevestigd
 * businessfeit, 2026-08-31: bij o.a. 010/014 wordt de bank niet
 * bijgewerkt, waardoor oude/al betaalde vorderingen jarenlang als
 * "openstaand" blijven geregistreerd) — saldi mogen getoond worden, maar
 * nooit zonder context als werkelijke achterstand. `"onbekend"` = nog niet
 * geclassificeerd — NOOIT automatisch als `true` behandelen (dat zou
 * precies de fout zijn die dit veld moet voorkomen). Zie
 * packages/reporting/README.md voor de volledige onderbouwing.
 */
export type DebiteurenbeheerStatus = boolean | "onbekend";

export interface DebiteurenbeheerConfig {
  bankAfletteringDoorOns: DebiteurenbeheerStatus;
}

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
  /** Zie DebiteurenbeheerStatus. Ontbreekt dit veld (legacy-config), dan leest leesAdministratieConfig het in-memory aan als "onbekend" — nooit true. */
  debiteurenbeheer?: DebiteurenbeheerConfig | undefined;
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
  contract_verhogingen: "gedeeld",
  vorderingen_met_afboekingen: "gedeeld",
};

export function nieuweAdministratieConfig(bedrijfsnr: string, weergavenaam: string): AdministratieConfig {
  return {
    bedrijfsnr,
    weergavenaam,
    mapversie: "1",
    bronlocaties: { ...DEFAULT_BRONLOCATIES },
    // Nooit true bij aanmaak — bankaflettering-status is per administratie een
    // bevestigd operationeel feit, nooit een aanname (zie DebiteurenbeheerStatus).
    debiteurenbeheer: { bankAfletteringDoorOns: "onbekend" },
  };
}

export function leesAdministratieConfig(root: string, administratieId: string): AdministratieConfig {
  const pad = administratieConfigPad(root, administratieId);
  if (!existsSync(pad)) {
    throw new Error(`administratie.json ontbreekt voor "${administratieId}" op ${pad}.`);
  }
  const parsed = JSON.parse(readFileSync(pad, "utf-8")) as AdministratieConfig;
  // Migratie in-memory (2026-08-28): een bestaand administratie.json van vóór een nieuw
  // brontype (bv. contract_verhogingen) mist die sleutel nog — vul die dan aan met de
  // standaardlocatie i.p.v. te falen. Schrijft niets terug; de volgende expliciete
  // schrijfactie (replace/init-administratie) persisteert de aanvulling vanzelf.
  for (const bronType of BRON_TYPES) {
    if (parsed.bronlocaties[bronType] === undefined) {
      parsed.bronlocaties[bronType] = DEFAULT_BRONLOCATIES[bronType];
    }
  }
  // Migratie in-memory (2026-08-31): een bestaand administratie.json van vóór het
  // debiteurenbeheer-veld mist dit nog — vul dan "onbekend" aan, NOOIT "true"
  // (zie DebiteurenbeheerStatus: een ontbrekende classificatie mag nooit stilzwijgend
  // als "bank wordt door ons bijgehouden" gelden). Schrijft niets terug.
  if (parsed.debiteurenbeheer === undefined) {
    parsed.debiteurenbeheer = { bankAfletteringDoorOns: "onbekend" };
  }
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
  const status = config.debiteurenbeheer?.bankAfletteringDoorOns;
  if (status !== undefined && status !== true && status !== false && status !== "onbekend") {
    throw new Error(`administratie.json: debiteurenbeheer.bankAfletteringDoorOns moet true, false of "onbekend" zijn, kreeg "${String(status)}".`);
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
