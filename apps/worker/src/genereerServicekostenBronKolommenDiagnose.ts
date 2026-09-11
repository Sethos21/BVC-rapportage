import { ServicekostenregelBronSchema } from "@bvc/data-contracts";
import { inventariseerServicekostenBronKolommen, type ServicekostenBronKolommenDiagnoseResultaat } from "@bvc/reporting";
import { resolveBron } from "./sourceResolver.js";
import { ExcelBronAdapter } from "./bronAdapter.js";

/**
 * Leest het RUWE servicekosten-bronbestand (vóór Zod-parsing/cache) en
 * inventariseert alle kolomnamen — zie `servicekostenBronKolommenDiagnose.ts`
 * voor het doel: vaststellen of de bron een grootboekrekening-achtig veld
 * bevat dat nog niet in `ServicekostenregelBronSchema` staat, vóórdat daar
 * iets structureels mee gebouwd wordt.
 */
export function genereerServicekostenBronKolommenDiagnose(root: string, administratieId: string): ServicekostenBronKolommenDiagnoseResultaat {
  const bron = resolveBron(root, administratieId, "servicekosten");
  if (!bron.bestaat) {
    throw new Error(`Servicekosten-bronbestand niet gevonden op "${bron.pad}" — draai eerst rebuild-cache of controleer bronlocaties.json.`);
  }
  const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);
  const bekendeKolommen = Object.keys(ServicekostenregelBronSchema.shape);
  return inventariseerServicekostenBronKolommen(ruweRijen, bekendeKolommen);
}
