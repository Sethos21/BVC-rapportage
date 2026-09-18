import { HUUR_WERKELIJK_CATEGORIEEN, type HuurWerkelijkCategorie, type WerkelijkHuurResultaat } from "./werkelijkHuur.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE GAT-002B (2026-09-16) — DE Pure P&L-adapter voor Werkelijk Huur:
 * vertaalt een reeds via de centrale mapping geclassificeerd
 * `WerkelijkHuurResultaat` (`werkelijkHuur.ts`/`huurCentraleMapping.ts`) naar
 * de drie canonieke, boven-EBITDA `PurePnLBronRegel`'s die de Pure P&L Engine
 * (`pnlEngine.ts`, commit d25783e) verwacht.
 *
 * GEEN ADMINISTRATIE-SPECIFIEKE KENNIS (GAT-002B-opdracht §8): deze module
 * bevat GEEN grootboekrekening, GEEN OGB-code, GEEN administratiecode/
 * `bedrijfsnr`-vergelijking — uitsluitend de drie vaste economische
 * Huur-categorieën (`HUUR_WERKELIJK_CATEGORIEEN`). Elke administratie met een
 * eigen GL/OGB→HUUR-mapping (zie `huurCentraleMapping.ts`) levert hier een
 * `WerkelijkHuurResultaat` af met exact dezelfde vorm, dus deze adapter werkt
 * ongewijzigd voor 070, een synthetische testadministratie, of enige
 * toekomstige administratie.
 *
 * TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE (GAT-002B-opdracht §7, zelfde
 * grens als `pnlEngine.ts`'s moduledoc): `WerkelijkHuurResultaat.perCategorie[].
 * categorieTotaal` is het RUWE, ongewijzigde CAL-FIN-001-saldo (zie
 * `werkelijkHuur.ts`) — voor alle drie Huur-categorieën staat de vaste
 * `contributieAard` op `"OPBRENGST"`, dus deze adapter negeert het ruwe
 * bedrag hier PRECIES ÉÉN KEER, gestuurd door die vaste aard, NOOIT afgeleid
 * uit het teken van het bedrag zelf:
 *  - HUUROPBRENGST_BELAST/HUUROPBRENGST_ONBELAST: ruw negatief (credit-normale
 *    opbrengstrekening) → genegeerd → positief, verhoogt Totaal opbrengsten.
 *  - VERLEENDE_HUURKORTING: ruw positief (een debitering van diezelfde
 *    credit-normale rekeningsoort — een correctie/aftrekpost) → genegeerd →
 *    negatief, VERLAAGT Totaal opbrengsten. Dit is dezelfde uitkomst als de
 *    bewezen Module-1-conventie "netto = bruto − korting"
 *    (`begroteHuuropbrengsten.ts`), hier bereikt via één uniforme
 *    tekenregel in plaats van een aparte aftrekformule.
 * De Pure P&L Engine zelf voert GEEN enkele tekenomkering meer uit (zie
 * `pnlEngine.ts`) — normalisatie gebeurt dus, zoals vereist, exact één keer,
 * op precies deze plek.
 *
 * COMPLETENESS (GAT-002B-opdracht §6, GAT-001B §5-invariant): `nietGeclassificeerdTotaal
 * != 0` betekent NOOIT dat een van de drie bekende categorieën fout is — een
 * niet-geclassificeerde boeking is per definitie in GEEN enkele
 * categorieTotaal meegeteld (zie `werkelijkHuur.ts`). Het betekent wél dat
 * het Huur-Werkelijk-beeld als geheel NIET aantoonbaar volledig is (er kan
 * elders nog niet-gemapte huuromzet bestaan). Dat wordt hier weergegeven als
 * een VIERDE, expliciet ONBEKEND regel (`HUUR_NIET_GECLASSIFICEERD`) — NOOIT
 * als €0 behandeld, NOOIT genegeerd — zodat de Pure P&L Engine's
 * `combineerVolledigheid` de OPBRENGSTEN-groep automatisch als ONVOLLEDIG
 * markeert, terwijl de drie bekende categoriebedragen zelf gewoon
 * beschikbaar blijven (Unknown != zero, "bekende deelsom" blijft bruikbaar).
 *
 * `brondekkingBevestigd` (GAT-001B §5, hier herhaald): `nietGeclassificeerdTotaal
 * === 0` is NOODZAKELIJK maar NIET VOLDOENDE bewijs van volledige dekking —
 * een administratie zonder enige Huur-mapping/boekingen heeft ook een
 * `nietGeclassificeerdTotaal` van 0 (er is dan simpelweg niets om te missen),
 * zonder dat er ook maar iets bewezen is. De aanroepende orchestratielaag
 * (buiten scope van GAT-002B — geen Worker-wiring hier) moet dekking daarom
 * EXPLICIET bevestigen; zonder die bevestiging zijn ALLE drie categorieën
 * ONBEKEND, ongeacht hun berekende waarde.
 */

const HUUR_NIET_GECLASSIFICEERD_SLEUTEL = "HUUR_NIET_GECLASSIFICEERD";

export function huurWerkelijkNaarPnLBovenEbitdaRegels(resultaat: WerkelijkHuurResultaat, brondekkingBevestigd: boolean): PurePnLBovenEbitdaRegel[] {
  function categorieBijdrage(categorie: HuurWerkelijkCategorie): PnLBronBijdrage {
    if (!brondekkingBevestigd) {
      return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Bron-/mappingdekking voor Huur-Werkelijk (${categorie}) is niet expliciet bevestigd door de aanroepende laag.` };
    }
    const categorieResultaat = resultaat.perCategorie.find((c) => c.categorie === categorie)!;
    return { status: "BEKEND", bedrag: categorieResultaat.categorieTotaal.negated() };
  }

  const regels: PurePnLBovenEbitdaRegel[] = HUUR_WERKELIJK_CATEGORIEEN.map((categorie) => ({
    regelSleutel: categorie,
    boomPositie: "BOVEN_EBITDA",
    groep: "OPBRENGSTEN",
    contributieAard: "OPBRENGST",
    waarde: categorieBijdrage(categorie),
  }));

  if (brondekkingBevestigd && !resultaat.nietGeclassificeerdTotaal.isZero()) {
    regels.push({
      regelSleutel: HUUR_NIET_GECLASSIFICEERD_SLEUTEL,
      boomPositie: "BOVEN_EBITDA",
      groep: "OPBRENGSTEN",
      contributieAard: "OPBRENGST",
      waarde: {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Huur-Werkelijk heeft ${resultaat.nietGeclassificeerdAantalBoekingen} niet-geclassificeerde boeking(en), totaal ${resultaat.nietGeclassificeerdTotaal.toString()} — niet toe te rekenen aan een van de drie bekende Huur-categorieën.`,
      },
    });
  }

  return regels;
}
