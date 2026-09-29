import type { BgNietVerrekenbareBtwResultaat } from "./begroteNietVerrekenbareBtw.js";
import { NIET_VERREKENBARE_BTW_WERKELIJK_CATEGORIEEN, type NietVerrekenbareBtwWerkelijkCategorie, type WerkelijkNietVerrekenbareBtwResultaat } from "./werkelijkNietVerrekenbareBtw.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * Niet verrekenbare BTW → P&L (Vervolgtranche 9 Deel B, Master Contract): één
 * zelfstandige P&L-regel, BOVEN EBITDA. GROEP: `EXPLOITATIE_LASTEN` — zelfde
 * plaatsing als elke andere zelfstandige, niet-Algemene-Kosten-exploitatiekost
 * (Gemeentelijke Lasten/Onderhoud/Verzekeringen/Leegstand/Servicekosten
 * Eigenaar); ook al een bestaand testfixture-voorbeeld in `pnlEngine.test.ts`
 * ("een TECHNISCH_NIET_ONDERSTEUNDE regel" gebruikte precies deze
 * regelSleutel/groep-combinatie). GEEN fiscale berekening hier — uitsluitend
 * vertalen van een reeds berekend resultaat.
 */

export const NIET_VERREKENBARE_BTW_PNL_SLEUTEL = "NIET_VERREKENBARE_BTW";
const NIET_VERREKENBARE_BTW_NIET_GECLASSIFICEERD_SLEUTEL = "NIET_VERREKENBARE_BTW_NIET_GECLASSIFICEERD";

const kostenRegel = (regelSleutel: string, waarde: PnLBronBijdrage): PurePnLBovenEbitdaRegel => ({
  regelSleutel,
  boomPositie: "BOVEN_EBITDA",
  groep: "EXPLOITATIE_LASTEN",
  contributieAard: "KOSTEN",
  waarde,
});

// ── Begroting ───────────────────────────────────────────────────────────────

/** Begroting: BEKEND als bewust beoordeeld (ook met 0 regels = bewuste €0) en geen KRITIEKE controle; anders ONBEKEND. */
export function nietVerrekenbareBtwBegrotingNaarPnLBovenEbitdaRegels(begroting: BgNietVerrekenbareBtwResultaat): PurePnLBovenEbitdaRegel[] {
  const kritiek = begroting.controleVereist.some((c) => c.ernst === "KRITIEK");
  const waarde: PnLBronBijdrage =
    begroting.beoordeeld && !kritiek
      ? { status: "BEKEND", bedrag: begroting.moduleTotaal }
      : { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: "Begroting Niet verrekenbare BTW niet bewust beoordeeld of bevat kritieke controles." };
  return [kostenRegel(NIET_VERREKENBARE_BTW_PNL_SLEUTEL, waarde)];
}

// ── Werkelijk ───────────────────────────────────────────────────────────────

/**
 * Werkelijk Niet verrekenbare BTW: BEKEND uitsluitend bij bevestigde dekking. Niet-geclassificeerde boekingen komen als
 * aparte ONBEKEND-regel (nooit stil genegeerd, nooit meegeteld in de hoofdregel).
 */
export function nietVerrekenbareBtwWerkelijkNaarPnLBovenEbitdaRegels(resultaat: WerkelijkNietVerrekenbareBtwResultaat, brondekkingBevestigd: boolean): PurePnLBovenEbitdaRegel[] {
  function categorieBijdrage(categorie: NietVerrekenbareBtwWerkelijkCategorie): PnLBronBijdrage {
    if (!brondekkingBevestigd) {
      return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Bron-/mappingdekking voor Niet-Verrekenbare-BTW-Werkelijk (${categorie}) is niet expliciet bevestigd door de aanroepende laag.` };
    }
    const categorieResultaat = resultaat.perCategorie.find((c) => c.categorie === categorie)!;
    return { status: "BEKEND", bedrag: categorieResultaat.categorieTotaal };
  }

  const regels: PurePnLBovenEbitdaRegel[] = NIET_VERREKENBARE_BTW_WERKELIJK_CATEGORIEEN.map((categorie) => kostenRegel(categorie, categorieBijdrage(categorie)));

  if (brondekkingBevestigd && !resultaat.nietGeclassificeerdTotaal.isZero()) {
    regels.push(
      kostenRegel(NIET_VERREKENBARE_BTW_NIET_GECLASSIFICEERD_SLEUTEL, {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Niet-Verrekenbare-BTW-Werkelijk heeft ${resultaat.nietGeclassificeerdAantalBoekingen} niet-geclassificeerde boeking(en), totaal ${resultaat.nietGeclassificeerdTotaal.toString()} — niet toe te rekenen aan de bekende categorie.`,
      }),
    );
  }

  return regels;
}

// ── Estimated — GEEN Estimated-calculator (STOP: BUSINESSBESLISSING) ────────

/**
 * Vervolgtranche 9 Deel B: de resterende-verwachtingsmethode voor Estimated
 * Niet verrekenbare BTW is BEWUST NIET contractueel eenduidig vastgesteld
 * (Master Contract laat dit expliciet open — geen FO/addendum/eerder
 * geaccepteerd besluit bepaalt "Werkelijk t/m afgesloten periode + [welke
 * resterende verwachting?]"). Er is daarom GEEN pure Estimated-calculator
 * gebouwd — deze functie is uitsluitend de expliciete, generieke
 * P&L-presentatie van die STOP: één regel, altijd ONBEKEND/
 * TECHNISCH_NIET_ONDERSTEUND, zodat de Estimated-P&L eerlijk ONVOLLEDIG
 * blijft in plaats van de regel stilzwijgend weg te laten (wat volledigheid
 * zou vervalsen). Bouwt GEEN eigen methode (nooit Begroting-Werkelijk,
 * lineaire extrapolatie, vorig jaar, handmatige verwachting, huur-pro-rata,
 * percentage van kosten/omzet — dat zijn businesskeuzes, zie moduledoc-
 * toelichting in het acceptatierapport).
 */
export function nietVerrekenbareBtwEstimatedNietOndersteundNaarPnLBovenEbitdaRegels(): PurePnLBovenEbitdaRegel[] {
  return [
    kostenRegel(NIET_VERREKENBARE_BTW_PNL_SLEUTEL, {
      status: "ONBEKEND",
      dekkingReden: "TECHNISCH_NIET_ONDERSTEUND",
      toelichting:
        "Estimated Niet verrekenbare BTW is niet gebouwd: de resterende-verwachtingsmethode (Werkelijk t/m afgesloten periode + welke resterende verwachting?) is niet contractueel eenduidig vastgesteld — STOP: BUSINESSBESLISSING (Vervolgtranche 9).",
    }),
  ];
}
