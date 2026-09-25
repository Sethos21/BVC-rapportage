import { ContractBronSchema } from "@bvc/data-contracts";
import { inventariseerServicekostenBronKolommen, type ServicekostenBronKolommenDiagnoseResultaat } from "@bvc/reporting";
import { resolveBron } from "./sourceResolver.js";
import { ExcelBronAdapter } from "./bronAdapter.js";

/**
 * Leest het RUWE contracten_huidig-bronbestand (vóór Zod-parsing/cache) en
 * inventariseert alle kolomnamen — hergebruikt `inventariseerServicekostenBronKolommen`
 * (`@bvc/reporting`), een generieke functie ondanks de naam (werkt op elke
 * ruwe rijenset + bekende-kolommenlijst, zie `servicekostenBronKolommenDiagnose.ts`).
 * Doel: vaststellen of de bron een huurdernaam-achtig veld bevat (bv.
 * "Naam_1") vóórdat dat structureel aan `ContractBronSchema`/de cache wordt
 * toegevoegd — `contracten_huidig` modelleert nu 12 van de 170 bronkolommen.
 */
export function genereerContractenBronKolommenDiagnose(root: string, administratieId: string): ServicekostenBronKolommenDiagnoseResultaat {
  const bron = resolveBron(root, administratieId, "contracten_huidig");
  if (!bron.bestaat) {
    throw new Error(`Contracten_huidig-bronbestand niet gevonden op "${bron.pad}" — draai eerst rebuild-cache of controleer bronlocaties.json.`);
  }
  const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);
  const bekendeKolommen = Object.keys(ContractBronSchema.shape);
  return inventariseerServicekostenBronKolommen(ruweRijen, bekendeKolommen);
}
