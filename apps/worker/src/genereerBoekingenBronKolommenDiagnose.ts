import { BoekingsregelBronSchema } from "@bvc/data-contracts";
import { inventariseerServicekostenBronKolommen, type ServicekostenBronKolommenDiagnoseResultaat } from "@bvc/reporting";
import { resolveBron } from "./sourceResolver.js";
import { ExcelBronAdapter } from "./bronAdapter.js";

/**
 * Leest het RUWE boekingen-bronbestand (vóór Zod-parsing/cache) en
 * inventariseert alle kolomnamen — hergebruikt `inventariseerServicekostenBronKolommen`
 * (`@bvc/reporting`), exact hetzelfde patroon als `genereerContractenBronKolommenDiagnose`/
 * `genereerServicekostenBronKolommenDiagnose`. Doel: vaststellen of de bron
 * (168 kolommen totaal, zie `boekingen.ts`'s moduledoc — `BoekingsregelBronSchema`
 * modelleert er nu 20) een exploitatiekostensoort-/kostenplaats-/complex-achtig
 * veld bevat dat nog niet gemodelleerd is, vóórdat daar structureel iets mee
 * gebouwd wordt. Puur inventarisatie — geen classificatie, geen schema-/
 * cache-wijziging.
 */
export function genereerBoekingenBronKolommenDiagnose(root: string, administratieId: string): ServicekostenBronKolommenDiagnoseResultaat {
  const bron = resolveBron(root, administratieId, "boekingen");
  if (!bron.bestaat) {
    throw new Error(`Boekingen-bronbestand niet gevonden op "${bron.pad}" — draai eerst rebuild-cache of controleer bronlocaties.json.`);
  }
  const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);
  const bekendeKolommen = Object.keys(BoekingsregelBronSchema.shape);
  return inventariseerServicekostenBronKolommen(ruweRijen, bekendeKolommen);
}
