import { BEHEER_WERKELIJK_CATEGORIEEN, type BeheerWerkelijkCategorie, type WerkelijkBeheerResultaat } from "./werkelijkBeheer.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE GAT-002C (2026-09-16) — DE Pure P&L-adapter voor Werkelijk Beheer:
 * vertaalt een reeds via de centrale mapping geclassificeerd
 * `WerkelijkBeheerResultaat` (`werkelijkBeheer.ts`/`beheerCentraleMapping.ts`)
 * naar de canonieke, boven-EBITDA `PurePnLBronRegel`'s die de Pure P&L
 * Engine (`pnlEngine.ts`, commit d25783e) verwacht — zelfde patroon als
 * `huurWerkelijkPnLAdapter.ts` (GAT-002B).
 *
 * GEEN ADMINISTRATIE-SPECIFIEKE KENNIS: deze module bevat GEEN
 * grootboekrekening, GEEN OGB-code, GEEN administratiecode/`bedrijfsnr`-
 * vergelijking — uitsluitend de ene vaste economische Beheer-categorie
 * (`BEHEER_WERKELIJK_CATEGORIEEN`). Elke administratie met een eigen
 * GL/OGB→BEHEER-mapping (zie `beheerCentraleMapping.ts`) levert hier een
 * `WerkelijkBeheerResultaat` af met exact dezelfde vorm.
 *
 * PLAATSING BOVEN EBITDA (GAT-002C-opdracht, expliciet): Beheer is een
 * exploitatiekost in de groep `MANAGEMENT_EN_BEHEER` — NIET `EXPLOITATIE_LASTEN`
 * (die groep is voor Onderhoud/Leegstand/Verzekeringen/Gemeentelijke
 * Lasten/BTW) en NIET onder EBITDA.
 *
 * TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE (zelfde grens als `pnlEngine.ts`'s
 * moduledoc en `huurWerkelijkPnLAdapter.ts`): `WerkelijkBeheerResultaat.
 * perCategorie[].categorieTotaal` is het RUWE, ongewijzigde CAL-FIN-001-saldo
 * (zie `werkelijkBeheer.ts`) — de vaste `contributieAard` voor Beheer is
 * `"KOSTEN"`, en de bronproef laat zien dat het ruwe saldo voor GL4000 al
 * POSITIEF binnenkomt (een normale kostendebitering) — exact de reeds
 * bewezen "kosten komen positief door"-conventie (Rente/Onderhoud). De ÉNE
 * normalisatiestap hier is daarom de IDENTITEIT (geen tekenomkering nodig)
 * — net zo min als de engine zelf ooit een teken omdraait. Zou een
 * toekomstige administratie GL4000-achtige boekingen ooit tegengesteld
 * geboekt aanleveren, dan is dat een bronfeit voor DIE mapping/administratie,
 * nooit een reden om hier een tekenheuristiek op het bedrag zelf te bouwen.
 *
 * COMPLETENESS (zelfde patroon als `huurWerkelijkPnLAdapter.ts`, GAT-001B
 * §5-invariant): `nietGeclassificeerdTotaal != 0` betekent NOOIT dat de
 * bekende BEHEERKOSTEN-categorie fout is — een niet-geclassificeerde
 * boeking is per definitie in GEEN categorieTotaal meegeteld (zie
 * `werkelijkBeheer.ts`). Het betekent wél dat het Beheer-Werkelijk-beeld als
 * geheel NIET aantoonbaar volledig is. Dat wordt hier weergegeven als een
 * TWEEDE, expliciet ONBEKEND regel (`BEHEER_NIET_GECLASSIFICEERD`) — NOOIT
 * als €0 behandeld, NOOIT genegeerd.
 *
 * `brondekkingBevestigd` (GAT-001B §5, herhaald): `nietGeclassificeerdTotaal
 * === 0` is NOODZAKELIJK maar NIET VOLDOENDE bewijs van volledige dekking.
 * De aanroepende orchestratielaag (buiten scope van GAT-002C — geen
 * Worker-wiring hier) moet dekking daarom EXPLICIET bevestigen; zonder die
 * bevestiging blijft de BEHEERKOSTEN-categorie ONBEKEND, ongeacht haar
 * berekende waarde.
 */

const BEHEER_NIET_GECLASSIFICEERD_SLEUTEL = "BEHEER_NIET_GECLASSIFICEERD";

export function beheerWerkelijkNaarPnLBovenEbitdaRegels(resultaat: WerkelijkBeheerResultaat, brondekkingBevestigd: boolean): PurePnLBovenEbitdaRegel[] {
  function categorieBijdrage(categorie: BeheerWerkelijkCategorie): PnLBronBijdrage {
    if (!brondekkingBevestigd) {
      return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Bron-/mappingdekking voor Beheer-Werkelijk (${categorie}) is niet expliciet bevestigd door de aanroepende laag.` };
    }
    const categorieResultaat = resultaat.perCategorie.find((c) => c.categorie === categorie)!;
    return { status: "BEKEND", bedrag: categorieResultaat.categorieTotaal };
  }

  const regels: PurePnLBovenEbitdaRegel[] = BEHEER_WERKELIJK_CATEGORIEEN.map((categorie) => ({
    regelSleutel: categorie,
    boomPositie: "BOVEN_EBITDA",
    groep: "MANAGEMENT_EN_BEHEER",
    contributieAard: "KOSTEN",
    waarde: categorieBijdrage(categorie),
  }));

  if (brondekkingBevestigd && !resultaat.nietGeclassificeerdTotaal.isZero()) {
    regels.push({
      regelSleutel: BEHEER_NIET_GECLASSIFICEERD_SLEUTEL,
      boomPositie: "BOVEN_EBITDA",
      groep: "MANAGEMENT_EN_BEHEER",
      contributieAard: "KOSTEN",
      waarde: {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Beheer-Werkelijk heeft ${resultaat.nietGeclassificeerdAantalBoekingen} niet-geclassificeerde boeking(en), totaal ${resultaat.nietGeclassificeerdTotaal.toString()} — niet toe te rekenen aan de bekende BEHEERKOSTEN-categorie.`,
      },
    });
  }

  return regels;
}
