import { readFileSync } from "node:fs";
import { readFirstSheetAsRows } from "@bvc/data-contracts";
import type { BronResolutie } from "./sourceResolver.js";

/**
 * Levert de rauwe rijen (kolomnaam → waarde) voor één brontype, ongeacht
 * de onderliggende opslag. `rebuildCache` roept dit aan i.p.v. zelf
 * bestanden te lezen — zo blijft de rekenlaag (parse/valideer/filter/
 * cache) onafhankelijk van "hoe" de rijen zijn opgehaald (CLAUDE.md §4:
 * Excel nu, later makkelijk naar DSN/SQL).
 *
 * Scope bewust beperkt tot de zeven bronnen die in één plat tabblad
 * staan (boekingen/balans/rentroll/contracten/units/complex_totalen/
 * servicekosten/ouderdomsanalyse) — begroting is een intrinsiek
 * meerdere-tabbladen-structuur (Instellingen/Exploitatie/Servicekosten)
 * en heeft een eigen lezer (begroting.ts), geen kandidaat voor deze
 * interface. Ook `valideerBron`/het vervangingsprotocol (replace.ts)
 * vallen hier bewust buiten: dat is "valideer en vervang een kandidaat-
 * bestand atomisch", een intrinsiek bestandsgericht concept dat voor een
 * live DSN-bron niet zou bestaan (daar is niets om te "vervangen", je
 * bevraagt gewoon opnieuw) — alleen het "haal de huidige rijen op voor
 * een cache-herbouw"-deel is wat een toekomstige DSN-adapter zou
 * vervangen.
 */
export interface BronAdapter {
  leesRuweRijen(bronResolutie: BronResolutie): Record<string, unknown>[];
}

/** Huidige (enige) implementatie: leest het eerste tabblad van het gedeelde/eigen xlsx-bestand. */
export class ExcelBronAdapter implements BronAdapter {
  leesRuweRijen(bronResolutie: BronResolutie): Record<string, unknown>[] {
    return readFirstSheetAsRows(readFileSync(bronResolutie.pad));
  }
}
