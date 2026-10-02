import { VorderingMetAfboekingBronSchema } from "@bvc/data-contracts";
import { inventariseerVorderingenBronKolommen, type VorderingenBronKolommenDiagnoseResultaat } from "@bvc/reporting";
import { resolveBron } from "./sourceResolver.js";
import { ExcelBronAdapter } from "./bronAdapter.js";

/**
 * Leest het RUWE vorderingen_met_afboekingen-bronbestand (vóór Zod-parsing/
 * cache) en inventariseert alle kolomnamen — hergebruikt
 * `inventariseerVorderingenBronKolommen` (`@bvc/reporting`), zelfde
 * hergebruikpatroon als `contracten-bronkolommen`/`boekingen-bronkolommen`.
 *
 * Doel (BRONGATE "Historische Ouderdomsanalyse", 2026-09-18):
 * `VorderingMetAfboekingBronSchema` modelleert bewust maar 14 van de ~189
 * ruwe bronkolommen — vóórdat wordt vastgesteld of een historische
 * ouderdomsanalyse per peildatum reconstrueerbaar is, moet eerst zichtbaar
 * worden of de RUWE bron kolommen bevat die kunnen wijzen op een gedateerde
 * afboekings-/betalingshistorie. Bouwt GEEN classificatie, GEEN
 * schema-uitbreiding, GEEN rekenlogica.
 */
export function genereerVorderingenBronKolommenDiagnose(root: string, administratieId: string): VorderingenBronKolommenDiagnoseResultaat {
  const bron = resolveBron(root, administratieId, "vorderingen_met_afboekingen");
  if (!bron.bestaat) {
    throw new Error(`Vorderingen_met_afboekingen-bronbestand niet gevonden op "${bron.pad}" — draai eerst rebuild-cache of controleer bronlocaties.json.`);
  }
  const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);
  const bekendeKolommen = Object.keys(VorderingMetAfboekingBronSchema.shape);
  return inventariseerVorderingenBronKolommen(ruweRijen, bekendeKolommen);
}
