import { existsSync, readFileSync } from "node:fs";
import { parseGrootboekMapping, parseGrootboekMappingMaster, type GrootboekMappingConfig } from "@bvc/config";
import { resolveerGrootboekMapping } from "@bvc/domain";
import { grootboekmappingMasterPad, grootboekmappingPad } from "./paths.js";

/**
 * Laadt de effectieve grootboekmapping van één administratie: de centrale
 * master (`<root>/config/grootboekmapping_master.json`) samengevoegd met de
 * administratie-eigen override (`<root>/config/grootboekmappingen/
 * <administratieId>.json`, zie `resolveerGrootboekMapping` — @bvc/domain).
 *
 * Beide bestanden zijn afzonderlijk OPTIONEEL: een administratie zonder
 * eigen afwijkingen hoeft geen override-bestand te hebben (leunt dan
 * volledig op de master), en een master die nog niet is aangelegd, wordt
 * als leeg behandeld (de administratie leunt dan volledig op haar eigen
 * override). Zijn ze ALLEBEI afwezig, dan is er voor deze administratie
 * niets geconfigureerd — dat is wél een fout (CLAUDE.md §6: nooit
 * stilzwijgend met een lege mapping doorgaan als er ook geen enkel
 * bronbestand bestaat). Staat een van beide bestanden er wél, maar is het
 * ongeldig, dan faalt dit hard — geen stilzwijgende correctie.
 */
export function leesGrootboekMapping(root: string, administratieId: string): GrootboekMappingConfig {
  const masterPad = grootboekmappingMasterPad(root);
  const overridePad = grootboekmappingPad(root, administratieId);
  const masterBestaat = existsSync(masterPad);
  const overrideBestaat = existsSync(overridePad);

  if (!masterBestaat && !overrideBestaat) {
    throw new Error(
      `Grootboekmapping ontbreekt voor administratie "${administratieId}": geen master (${masterPad}) en geen administratie-override (${overridePad}) gevonden — nog geen mapping geconfigureerd.`,
    );
  }

  const master = masterBestaat ? parseGrootboekMappingMaster(JSON.parse(readFileSync(masterPad, "utf-8"))) : { versie: "0.1", regels: [] };
  const override = overrideBestaat
    ? parseGrootboekMapping(JSON.parse(readFileSync(overridePad, "utf-8")))
    : { versie: master.versie, administratieId, regels: [] };

  return {
    versie: override.versie,
    administratieId,
    regels: resolveerGrootboekMapping(master.regels, override.regels),
  };
}
