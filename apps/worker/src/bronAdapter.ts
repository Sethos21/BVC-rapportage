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
 *
 * Concreet toekomstig doelsysteem (bevestigd, nog niet geïmplementeerd):
 * Informant/PxPlus, ontsloten via de PxPlus SQL ODBC-driver (bedrijfs-
 * omgeving heeft momenteel v7.00.02.00, 32-bit; Informant File DSN's en
 * Excel zijn daar ook 32-bit). `ExcelBronAdapter` hieronder komt overeen
 * met wat elders "ExcelSource" genoemd wordt; een toekomstige
 * `InformantOdbcSource`/`InformantOdbcBronAdapter` implementeert dezelfde
 * `BronAdapter`-interface — de rekenlaag (domain/cache/reporting) mag
 * nooit weten dat die bestaat, laat staan iets van ODBC/PxPlus/bitness.
 * Nog open (bewust niet vooruitgelopen): of de 64-bit PxPlus-driver
 * rechtstreeks vanuit deze (x64) Worker bruikbaar is, of dat een aparte
 * 32-bit ODBC-bridge/hulpproces nodig is (Informant/PxPlus Views-
 * compatibiliteit onderzocht apart). Die keuze kan gevolgen hebben voor
 * deze interface — een bridge-over-een-hulpproces is vermoedelijk
 * inherent asynchroon, terwijl `leesRuweRijen` nu synchroon is; dat wordt
 * pas aangepast zodra de ODBC-aanpak zelf gebouwd wordt, niet vooraf
 * gegokt. De huidige x64-executable-build (`scripts/build-exe.mjs`)
 * blijft ongewijzigd; er wordt voorlopig geen 32-bit build gemaakt en
 * geen ODBC-code toegevoegd.
 */
export interface BronAdapter {
  leesRuweRijen(bronResolutie: BronResolutie): Record<string, unknown>[];
}

/** Huidige (enige) implementatie: leest het eerste tabblad van het gedeelde/eigen xlsx-bestand ("ExcelSource"). */
export class ExcelBronAdapter implements BronAdapter {
  leesRuweRijen(bronResolutie: BronResolutie): Record<string, unknown>[] {
    return readFirstSheetAsRows(readFileSync(bronResolutie.pad));
  }
}
