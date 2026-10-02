import { ONDERHOUD_WERKELIJK_CATEGORIEEN, type OnderhoudWerkelijkCategorie, type WerkelijkOnderhoudResultaat } from "./werkelijkOnderhoud.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE DELTA (2026-09-17) — DE Pure P&L-adapter voor Werkelijk Onderhoud:
 * vertaalt een reeds via de centrale mapping geclassificeerd
 * `WerkelijkOnderhoudResultaat` (`werkelijkOnderhoud.ts`/`onderhoudCentraleMapping.ts`)
 * naar de canonieke, boven-EBITDA `PurePnLBronRegel`'s die de Pure P&L
 * Engine (`pnlEngine.ts`, commit d25783e) verwacht — zelfde patroon als de
 * overige Werkelijk-adapters (Huur/Beheer/Management/Algemene Kosten/
 * Servicekosten Eigenaar) en EXACT dezelfde regelSleutel/groep/
 * contributieAard-conventie als de reeds bestaande
 * `onderhoudEstimatedPnLAdapter.ts` (GAT-008B), zodat Werkelijk en Estimated
 * altijd in dezelfde P&L-regels naast elkaar staan.
 *
 * ADMINISTRATIE-AFHANKELIJKE VERBIJZONDERING, GL LEIDEND, GEEN UNIVERSELE
 * GEPLAND/CORRECTIEF-INDELING (GAT-006/EBITDA-CANON-besluit, herbevestigd):
 * drie regels, één per bestaande Werkelijk-categorie
 * (`ONDERHOUD_WERKELIJK_CATEGORIEEN` — Gebouwen/Terrein/Installaties, de
 * asset-/objecttype-dimensie die de centrale GL-mapping al bepaalt) — GEEN
 * nieuwe, universele P&L-hoofdindeling "Gepland" versus
 * "Correctief/Dagelijks" (die dimensie bestaat in Werkelijk niet, zie
 * moduledoc `werkelijkOnderhoud.ts`).
 *
 * GEEN ADMINISTRATIE-SPECIFIEKE KENNIS: uitsluitend de drie vaste economische
 * categorieën — GEEN GL/OGB/administratiecode, GEEN complexnummer.
 *
 * PLAATSING BOVEN EBITDA, GROEP EXPLOITATIE_LASTEN.
 *
 * TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE: `WerkelijkOnderhoudResultaat.
 * perCategorie[].categorieTotaal` is het RUWE, ongewijzigde CAL-FIN-001-saldo
 * (zie `werkelijkOnderhoud.ts`) — de vaste `contributieAard` is `"KOSTEN"`
 * voor alle drie categorieën, en de bewezen bronproef (M7, GAT-013) laat
 * zien dat het ruwe saldo al POSITIEF binnenkomt (een normale
 * kostendebitering). De ÉNE normalisatiestap hier is daarom de IDENTITEIT
 * (geen tekenomkering nodig), net zo min als de engine zelf ooit een teken
 * omdraait.
 *
 * COMPLETENESS (zelfde patroon als de overige Werkelijk-adapters, GAT-001B
 * §5-invariant): `nietGeclassificeerdTotaal != 0` betekent NOOIT dat een
 * bekende categorie fout is — het wordt weergegeven als een VIERDE,
 * expliciet ONBEKEND regel (`ONDERHOUD_NIET_GECLASSIFICEERD`), NOOIT als €0
 * behandeld, NOOIT stil verdeeld over Gebouwen/Terrein/Installaties.
 *
 * `brondekkingBevestigd` (GAT-001B §5, herhaald): `nietGeclassificeerdTotaal
 * === 0` is NOODZAKELIJK maar NIET VOLDOENDE bewijs van volledige dekking.
 * Zonder expliciete bevestiging blijven alle drie categorieën ONBEKEND.
 */

const ONDERHOUD_NIET_GECLASSIFICEERD_SLEUTEL = "ONDERHOUD_NIET_GECLASSIFICEERD";

export function onderhoudWerkelijkNaarPnLBovenEbitdaRegels(resultaat: WerkelijkOnderhoudResultaat, brondekkingBevestigd: boolean): PurePnLBovenEbitdaRegel[] {
  function categorieBijdrage(categorie: OnderhoudWerkelijkCategorie): PnLBronBijdrage {
    if (!brondekkingBevestigd) {
      return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Bron-/mappingdekking voor Onderhoud-Werkelijk (${categorie}) is niet expliciet bevestigd door de aanroepende laag.` };
    }
    const categorieResultaat = resultaat.perCategorie.find((c) => c.categorie === categorie)!;
    return { status: "BEKEND", bedrag: categorieResultaat.categorieTotaal };
  }

  const regels: PurePnLBovenEbitdaRegel[] = ONDERHOUD_WERKELIJK_CATEGORIEEN.map((categorie) => ({
    regelSleutel: categorie,
    boomPositie: "BOVEN_EBITDA",
    groep: "EXPLOITATIE_LASTEN",
    contributieAard: "KOSTEN",
    waarde: categorieBijdrage(categorie),
  }));

  if (brondekkingBevestigd && !resultaat.nietGeclassificeerdTotaal.isZero()) {
    regels.push({
      regelSleutel: ONDERHOUD_NIET_GECLASSIFICEERD_SLEUTEL,
      boomPositie: "BOVEN_EBITDA",
      groep: "EXPLOITATIE_LASTEN",
      contributieAard: "KOSTEN",
      waarde: {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Onderhoud-Werkelijk heeft ${resultaat.nietGeclassificeerdAantalBoekingen} niet-geclassificeerde boeking(en), totaal ${resultaat.nietGeclassificeerdTotaal.toString()} — niet toe te rekenen aan een van de drie bekende categorieën.`,
      },
    });
  }

  return regels;
}
