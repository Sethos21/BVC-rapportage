import { statSync } from "node:fs";
import { ExcelBronAdapter } from "./bronAdapter.js";
import type { BronResolutie } from "./sourceResolver.js";

/**
 * PERFORMANCE-DELTA (performance-diagnose, 2026-10-02): `boekingen.xlsx` opnieuw lezen+parsen
 * (`ExcelBronAdapter.leesRuweRijen`) bleek >99% van de responstijd van het begrotingshoofdscherm
 * en de controleren/vaststellen-pagina te zijn (45-65 sec per request, gemeten op de echte
 * 070-productiedata) — geen SQLite-, M:\-I/O- of rekenlaagkosten, puur lokale CPU-tijd in het
 * SheetJS-parsen zelf. Deze module cachet UITSLUITEND dat kostbare, brongetrouwe parseresultaat
 * (de ruwe rijen zoals ze uit het bestand komen) — nooit een uiteindelijke P&L-/financiële
 * uitkomst. De bron blijft leidend: de cache verandert geen enkele waarde, verbetert uitsluitend
 * hoe vaak hetzelfde bestand opnieuw wordt gelezen.
 *
 * CACHE-SLEUTEL: administratieId + brontype + bestandspad. Bewust INCLUSIEF administratieId, ook
 * al wijst een 'gedeeld'-bronbestand voor meerdere administraties naar hetzelfde fysieke pad: de
 * expliciete eis is dat data van administratie A nooit door administratie B wordt hergebruikt, dus
 * krijgt elke administratie een eigen cache-entry — ook als dat voor een gedeeld bestand een kleine
 * extra parse betekent. Dat is een bewuste, veilige keuze (strikte administratiescheiding gaat voor
 * op het laatste restje hergebruik), geen oversight.
 *
 * INVALIDATIE: uitsluitend bestands-mtime, GEEN TTL. Zelfde bestandspad + zelfde mtime ->
 * hergebruik; een andere mtime (bron is overschreven/vervangen) -> de oude entry wordt genegeerd,
 * het bestand wordt opnieuw gelezen/geparsed en de cache wordt met het nieuwe resultaat bijgewerkt.
 * Een fout tijdens lezen/parsen gooit door VÓÓR `cache.set` wordt bereikt — er ontstaat dus nooit
 * een corrupte of halve cache-entry.
 *
 * MUTATIEBEVEILIGING: het gecachete resultaat wordt door opeenvolgende, onafhankelijke requests
 * hergebruikt (zelfde array-referentie). Bestaande downstream-verwerking (`.filter()`/`.map()`)
 * maakt al nieuwe arrays/objecten en muteert nooit in-place, maar deze cache bevriest zowel de
 * array als elke rij (`Object.freeze`) als harde garantie: een eventuele toekomstige of onbedoelde
 * in-place wijziging gooit een `TypeError` i.p.v. stilzwijgend de volgende request te vervuilen.
 *
 * SERVERRESTART: in-memory, module-scope `Map` — verdwijnt vanzelf bij het herstarten van het
 * proces. Geen nieuwe persistente cachelaag, geen bestand, geen `@bvc/cache`/SQLite-wijziging.
 *
 * GELIJKTIJDIGE REQUESTS: bewust GEEN in-flight-deduplicatie (bv. een Map met lopende Promises)
 * toegevoegd. De volledige keten hierachter (`readFileSync` + SheetJS `XLSX.read`/`sheet_to_json`)
 * is en blijft synchroon — er zit geen `await` tussen het starten en voltooien van een parse. Een
 * synchrone functie blokkeert de single-threaded Node.js event loop volledig totdat hij
 * terugkeert: een tweede, bijna gelijktijdig binnenkomende request kan zijn eigen handler-code
 * daarom hoe dan ook pas laten draaien NADAT de eerste, nog ongecachete parse al is afgerond (en
 * dus de cache al is gevuld). Twee onafhankelijk lopende 45-seconden-parses van hetzelfde
 * ongecachete bestand zijn in deze architectuur dus structureel onmogelijk — een extra
 * in-flight-mechanisme zou hier geen enkel reëel scenario oplossen, alleen ongebruikte
 * complexiteit toevoegen.
 */

interface BoekingenCacheEntry {
  mtimeMs: number;
  rijen: readonly Readonly<Record<string, unknown>>[];
}

const cache = new Map<string, BoekingenCacheEntry>();

function cacheSleutel(administratieId: string, bron: BronResolutie): string {
  return `${administratieId}::${bron.bronType}::${bron.pad}`;
}

/**
 * Leest de ruwe rijen van een bronbestand (zelfde contract als `ExcelBronAdapter.leesRuweRijen`),
 * met hergebruik van een eerder geparst resultaat zolang bestandspad + mtime ongewijzigd zijn.
 */
export function leesRuweRijenMetCache(administratieId: string, bron: BronResolutie): readonly Readonly<Record<string, unknown>>[] {
  const sleutel = cacheSleutel(administratieId, bron);
  const mtimeMs = statSync(bron.pad).mtimeMs;
  const bestaand = cache.get(sleutel);
  if (bestaand !== undefined && bestaand.mtimeMs === mtimeMs) {
    return bestaand.rijen;
  }

  const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);
  const bevroren = Object.freeze(ruweRijen.map((rij) => Object.freeze({ ...rij })));
  cache.set(sleutel, { mtimeMs, rijen: bevroren });
  return bevroren;
}

/** Uitsluitend voor tests: leegt de volledige cache, zodat scenario's elkaar niet beïnvloeden. */
export function wisBoekingenParseCacheVoorTests(): void {
  cache.clear();
}
