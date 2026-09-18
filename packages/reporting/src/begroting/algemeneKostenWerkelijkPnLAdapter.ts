import { ALGEMENE_KOSTEN_CATEGORIEEN, type BgAlgemeneKostenCategorie } from "./begroteAlgemeneKosten.js";
import type { WerkelijkAlgemeneKostenResultaat } from "./werkelijkAlgemeneKosten.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE GAT-009 (2026-09-16) — DE Pure P&L-adapter voor Werkelijk Algemene
 * Kosten: vertaalt een reeds via de centrale mapping geclassificeerd
 * `WerkelijkAlgemeneKostenResultaat` (`werkelijkAlgemeneKosten.ts`/
 * `algemeneKostenCentraleMapping.ts`) naar de canonieke, boven-EBITDA
 * `PurePnLBronRegel`'s die de Pure P&L Engine (`pnlEngine.ts`, commit
 * d25783e) verwacht — zelfde patroon als de Huur-/Beheer-/Management-
 * adapters (GAT-002B/C/D).
 *
 * GEEN ADMINISTRATIE-SPECIFIEKE KENNIS: deze module bevat GEEN
 * grootboekrekening, GEEN OGB-code, GEEN administratiecode/`bedrijfsnr`-
 * vergelijking, GEEN rekeningnaam uit Informant — uitsluitend de vijf
 * bestaande, ongewijzigde economische categorieën (`ALGEMENE_KOSTEN_CATEGORIEEN`
 * uit `begroteAlgemeneKosten.ts`). Elke administratie met een eigen
 * GL/OGB→ALGEMENE_KOSTEN-mapping (zie `algemeneKostenCentraleMapping.ts`)
 * levert hier een `WerkelijkAlgemeneKostenResultaat` af met exact dezelfde
 * vorm.
 *
 * AFZONDERLIJKE P&L-REGELS PER CATEGORIE, GEEN DUBBELE TELLING
 * (GAT-009-opdracht §4): elke van de vijf categorieën (ACCOUNTANT/
 * ALGEMENE_KOSTEN/JURIDISCHE_KOSTEN/MAKELAARSKOSTEN/BANKKOSTEN) wordt een
 * eigen `PurePnLBovenEbitdaRegel` — GEEN samengevoegde "Algemene Kosten"-
 * regel. "Taxatie/Verhuurbemiddeling" is een presentatielabel BINNEN
 * MAKELAARSKOSTEN (zie moduledoc `algemeneKostenCentraleMapping.ts`) — dus
 * GEEN aparte regel hier, dat zou hetzelfde bedrag tweemaal in de boom
 * introduceren.
 *
 * PLAATSING BOVEN EBITDA, GROEP ALGEMENE_KOSTEN (GAT-009-opdracht,
 * expliciet): een eigen, vierde boven-EBITDA-groep — NIET `EXPLOITATIE_LASTEN`
 * en NIET `MANAGEMENT_EN_BEHEER`.
 *
 * TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE (zelfde grens als `pnlEngine.ts`'s
 * moduledoc en de Huur-/Beheer-/Management-adapters): `WerkelijkAlgemeneKostenResultaat.
 * perCategorie[].categorieTotaal` is het RUWE, ongewijzigde CAL-FIN-001-saldo
 * (zie `werkelijkAlgemeneKosten.ts`) — de vaste `contributieAard` voor elke
 * Algemene-Kosten-categorie is `"KOSTEN"`, en de bewezen 070/GL4990-bronproef
 * laat zien dat het ruwe saldo al POSITIEF binnenkomt (een normale
 * kostendebitering) — exact de reeds bewezen "kosten komen positief door"-
 * conventie. De ÉNE normalisatiestap hier is daarom de IDENTITEIT (geen
 * tekenomkering nodig).
 *
 * COMPLETENESS (zelfde patroon als de Huur-/Beheer-/Management-adapters,
 * GAT-001B §5-invariant): `nietGeclassificeerdTotaal != 0` betekent NOOIT dat
 * een bekende categorie fout is — een niet-geclassificeerde boeking is per
 * definitie in GEEN categorieTotaal meegeteld (zie `werkelijkAlgemeneKosten.ts`).
 * Het betekent wél dat het Algemene-Kosten-Werkelijk-beeld als geheel NIET
 * aantoonbaar volledig is. Dat wordt hier weergegeven als een ZESDE,
 * expliciet ONBEKEND regel (`ALGEMENE_KOSTEN_NIET_GECLASSIFICEERD`) — NOOIT
 * als €0 behandeld, NOOIT genegeerd.
 *
 * `brondekkingBevestigd` (GAT-001B §5, herhaald): `nietGeclassificeerdTotaal
 * === 0` is NOODZAKELIJK maar NIET VOLDOENDE bewijs van volledige dekking.
 * De aanroepende orchestratielaag (buiten scope van GAT-009 — geen
 * Worker-wiring hier) moet dekking daarom EXPLICIET bevestigen; zonder die
 * bevestiging blijven ALLE VIJF categorieën ONBEKEND, ongeacht hun berekende
 * waarde.
 */

const ALGEMENE_KOSTEN_NIET_GECLASSIFICEERD_SLEUTEL = "ALGEMENE_KOSTEN_NIET_GECLASSIFICEERD";

export function algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(resultaat: WerkelijkAlgemeneKostenResultaat, brondekkingBevestigd: boolean): PurePnLBovenEbitdaRegel[] {
  function categorieBijdrage(categorie: BgAlgemeneKostenCategorie): PnLBronBijdrage {
    if (!brondekkingBevestigd) {
      return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Bron-/mappingdekking voor Algemene-Kosten-Werkelijk (${categorie}) is niet expliciet bevestigd door de aanroepende laag.` };
    }
    const categorieResultaat = resultaat.perCategorie.find((c) => c.categorie === categorie)!;
    return { status: "BEKEND", bedrag: categorieResultaat.categorieTotaal };
  }

  const regels: PurePnLBovenEbitdaRegel[] = ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie) => ({
    regelSleutel: categorie,
    boomPositie: "BOVEN_EBITDA",
    groep: "ALGEMENE_KOSTEN",
    contributieAard: "KOSTEN",
    waarde: categorieBijdrage(categorie),
  }));

  if (brondekkingBevestigd && !resultaat.nietGeclassificeerdTotaal.isZero()) {
    regels.push({
      regelSleutel: ALGEMENE_KOSTEN_NIET_GECLASSIFICEERD_SLEUTEL,
      boomPositie: "BOVEN_EBITDA",
      groep: "ALGEMENE_KOSTEN",
      contributieAard: "KOSTEN",
      waarde: {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Algemene-Kosten-Werkelijk heeft ${resultaat.nietGeclassificeerdAantalBoekingen} niet-geclassificeerde boeking(en), totaal ${resultaat.nietGeclassificeerdTotaal.toString()} — niet toe te rekenen aan een van de vijf bekende categorieën.`,
      },
    });
  }

  return regels;
}
