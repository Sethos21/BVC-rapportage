import type { PnLPresentatieMappingRegel } from "@bvc/reporting";

/**
 * Bewezen P&L-PRESENTATIEMAPPINGEN (Vervolgtranche 9, sluit ARCHITECTUURPUNT §8.10,
 * Tranche 8): administratiegebonden DATA, GEEN businesslogica — het generieke
 * routeringsmechanisme zelf staat in `@bvc/reporting`'s `pnlPresentatiemapping.ts`/
 * `pnlPeriodeOrchestratie.ts` en kent geen enkele concrete administratie, GL of OGB.
 *
 * 070/Rooise Zoom: GL4350/OGB4319 ("Servicekosten leegstand") is bewezen
 * SERVICEKOSTEN_EIGENAAR/SERVICEKOSTEN_LEEGSTAND (`servicekostenEigenaarCentraleMapping.ts`).
 * ARCHITECTUURBESLUIT (2026-09-29, Vervolgtranche 9): dit bedrag wordt desondanks onder de
 * canonieke P&L-post Leegstandskosten (onderdeel Servicekosten) GEPRESENTEERD — het bron-
 * hoofddomein zelf (SERVICEKOSTEN_EIGENAAR, M4b) verandert niet. GEEN GL zonder OGB4319 en
 * GEEN andere administratie erft deze regel automatisch — elke nieuwe cross-domain
 * presentatiemapping vereist een eigen, afzonderlijk bewijs.
 */
export const PNL_PRESENTATIEMAPPINGEN: readonly PnLPresentatieMappingRegel[] = [
  { bedrijfsnr: "070", bronHoofddomein: "SERVICEKOSTEN_EIGENAAR", bronCategorie: "SERVICEKOSTEN_LEEGSTAND", doelHoofddomein: "LEEGSTAND", doelCategorie: "SERVICEKOSTEN_LEEGSTAND" },
];
