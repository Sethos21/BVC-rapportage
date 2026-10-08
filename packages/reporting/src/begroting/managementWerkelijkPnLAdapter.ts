import { MANAGEMENT_WERKELIJK_CATEGORIEEN, type ManagementWerkelijkCategorie, type WerkelijkManagementResultaat } from "./werkelijkManagement.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE GAT-002D (2026-09-16) — DE Pure P&L-adapter voor Werkelijk Management:
 * vertaalt een reeds via de centrale mapping geclassificeerd
 * `WerkelijkManagementResultaat` (`werkelijkManagement.ts`/
 * `managementCentraleMapping.ts`) naar de canonieke, boven-EBITDA
 * `PurePnLBronRegel`'s die de Pure P&L Engine (`pnlEngine.ts`, commit
 * d25783e) verwacht — zelfde patroon als `beheerWerkelijkPnLAdapter.ts`
 * (GAT-002C) en `huurWerkelijkPnLAdapter.ts` (GAT-002B).
 *
 * GEEN ADMINISTRATIE-SPECIFIEKE KENNIS: deze module bevat GEEN
 * grootboekrekening, GEEN OGB-code, GEEN administratiecode/`bedrijfsnr`-
 * vergelijking, GEEN relatienaam (bv. "ME Holding") — uitsluitend de ene
 * vaste economische Management-categorie (`MANAGEMENT_WERKELIJK_CATEGORIEEN`).
 * Elke administratie met een eigen GL/OGB→MANAGEMENT-mapping (zie
 * `managementCentraleMapping.ts`) levert hier een `WerkelijkManagementResultaat`
 * af met exact dezelfde vorm.
 *
 * PLAATSING BOVEN EBITDA (GAT-002D-opdracht, expliciet): Management is een
 * AFZONDERLIJKE exploitatiekost in de groep `MANAGEMENT_EN_BEHEER` — met een
 * eigen `regelSleutel` ("MANAGEMENTVERGOEDING"), NOOIT samengevoegd met
 * Beheer se eigen regel ("BEHEERKOSTEN", `beheerWerkelijkPnLAdapter.ts`).
 * Beide regels tellen wél samen mee in het `MANAGEMENT_EN_BEHEER`-subtotaal
 * (dat is de groep, geen samenvoeging van de regels zelf) — precies zoals de
 * Pure P&L Engine groepen/regels al structureel scheidt (zie `pnlEngine.ts`).
 *
 * TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE (zelfde grens als `pnlEngine.ts`'s
 * moduledoc en de Huur-/Beheer-adapters): `WerkelijkManagementResultaat.
 * perCategorie[].categorieTotaal` is het RUWE, ongewijzigde CAL-FIN-001-saldo
 * (zie `werkelijkManagement.ts`) — de vaste `contributieAard` voor Management
 * is `"KOSTEN"`, en de bronproef laat zien dat het ruwe saldo voor GL04001 al
 * POSITIEF binnenkomt (een normale kostendebitering, inclusief de afwijkende/
 * correctieboekingen — bv. "Aanvullend bedrag januari na 4% indexatie" is
 * evengoed ruw positief) — exact de reeds bewezen "kosten komen positief
 * door"-conventie. De ÉNE normalisatiestap hier is daarom de IDENTITEIT
 * (geen tekenomkering nodig), net zo min als de engine zelf ooit een teken
 * omdraait.
 *
 * COMPLETENESS (zelfde patroon als de Huur-/Beheer-adapters, GAT-001B
 * §5-invariant): `nietGeclassificeerdTotaal != 0` betekent NOOIT dat de
 * bekende MANAGEMENTVERGOEDING-categorie fout is — een niet-geclassificeerde
 * boeking is per definitie in GEEN categorieTotaal meegeteld (zie
 * `werkelijkManagement.ts`). Het betekent wél dat het Management-Werkelijk-
 * beeld als geheel NIET aantoonbaar volledig is. Dat wordt hier weergegeven
 * als een TWEEDE, expliciet ONBEKEND regel (`MANAGEMENT_NIET_GECLASSIFICEERD`)
 * — NOOIT als €0 behandeld, NOOIT genegeerd.
 *
 * `brondekkingBevestigd` (GAT-001B §5, herhaald): `nietGeclassificeerdTotaal
 * === 0` is NOODZAKELIJK maar NIET VOLDOENDE bewijs van volledige dekking.
 * De aanroepende orchestratielaag (buiten scope van GAT-002D — geen
 * Worker-wiring hier) moet dekking daarom EXPLICIET bevestigen; zonder die
 * bevestiging blijft de MANAGEMENTVERGOEDING-categorie ONBEKEND, ongeacht
 * haar berekende waarde.
 */

const MANAGEMENT_NIET_GECLASSIFICEERD_SLEUTEL = "MANAGEMENT_NIET_GECLASSIFICEERD";

export function managementWerkelijkNaarPnLBovenEbitdaRegels(resultaat: WerkelijkManagementResultaat, brondekkingBevestigd: boolean): PurePnLBovenEbitdaRegel[] {
  function categorieBijdrage(categorie: ManagementWerkelijkCategorie): PnLBronBijdrage {
    if (!brondekkingBevestigd) {
      return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Bron-/mappingdekking voor Management-Werkelijk (${categorie}) is niet expliciet bevestigd door de aanroepende laag.` };
    }
    const categorieResultaat = resultaat.perCategorie.find((c) => c.categorie === categorie)!;
    return { status: "BEKEND", bedrag: categorieResultaat.categorieTotaal };
  }

  const regels: PurePnLBovenEbitdaRegel[] = MANAGEMENT_WERKELIJK_CATEGORIEEN.map((categorie) => ({
    regelSleutel: categorie,
    boomPositie: "BOVEN_EBITDA",
    groep: "MANAGEMENT_EN_BEHEER",
    contributieAard: "KOSTEN",
    waarde: categorieBijdrage(categorie),
  }));

  if (brondekkingBevestigd && !resultaat.nietGeclassificeerdTotaal.isZero()) {
    regels.push({
      regelSleutel: MANAGEMENT_NIET_GECLASSIFICEERD_SLEUTEL,
      boomPositie: "BOVEN_EBITDA",
      groep: "MANAGEMENT_EN_BEHEER",
      contributieAard: "KOSTEN",
      waarde: {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Management-Werkelijk heeft ${resultaat.nietGeclassificeerdAantalBoekingen} niet-geclassificeerde boeking(en), totaal ${resultaat.nietGeclassificeerdTotaal.toString()} — niet toe te rekenen aan de bekende MANAGEMENTVERGOEDING-categorie.`,
      },
    });
  }

  return regels;
}
