import type { BgVerzekeringWerkelijkCategorie, WerkelijkVerzekeringResultaat } from "./begroteVerzekeringen.js";
import { VERZEKERING_WERKELIJK_CATEGORIEEN } from "./begroteVerzekeringen.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE DELTA (2026-09-17) — DE Pure P&L-adapter voor Werkelijk Verzekeringen:
 * vertaalt een reeds via de centrale mapping geclassificeerd
 * `WerkelijkVerzekeringResultaat` (`begroteVerzekeringen.ts`/
 * `verzekeringCentraleMapping.ts`) naar de canonieke, boven-EBITDA
 * `PurePnLBronRegel`'s die de Pure P&L Engine (`pnlEngine.ts`, commit
 * d25783e) verwacht — zelfde patroon als de overige Werkelijk-adapters en
 * EXACT dezelfde regelSleutel/groep/contributieAard-conventie als de reeds
 * bestaande `verzekeringEstimatedPnLAdapter.ts` (GAT-008A).
 *
 * GEEN ADMINISTRATIE-SPECIFIEKE KENNIS: uitsluitend de ene vaste economische
 * categorie (`VERZEKERING_WERKELIJK_CATEGORIEEN`) — GEEN GL/OGB/
 * administratiecode, GEEN complexnummer.
 *
 * PLAATSING BOVEN EBITDA, GROEP EXPLOITATIE_LASTEN.
 *
 * TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE: `WerkelijkVerzekeringResultaat.
 * perCategorie[].categorieTotaal` is het RUWE, ongewijzigde CAL-FIN-001-saldo
 * — de vaste `contributieAard` is `"KOSTEN"`, en de bewezen bronproef (M7,
 * GAT-013) laat zien dat het ruwe saldo al POSITIEF binnenkomt. De ÉNE
 * normalisatiestap hier is daarom de IDENTITEIT (geen tekenomkering nodig).
 *
 * COMPLETENESS (zelfde patroon als de overige Werkelijk-adapters, GAT-001B
 * §5-invariant): `nietGeclassificeerdTotaal != 0` betekent NOOIT dat de
 * bekende categorie fout is — het wordt weergegeven als een TWEEDE,
 * expliciet ONBEKEND regel (`VERZEKERINGEN_NIET_GECLASSIFICEERD`), NOOIT als
 * €0 behandeld.
 *
 * `brondekkingBevestigd` (GAT-001B §5, herhaald): `nietGeclassificeerdTotaal
 * === 0` is NOODZAKELIJK maar NIET VOLDOENDE bewijs van volledige dekking.
 * Zonder expliciete bevestiging blijft de categorie ONBEKEND.
 */

const VERZEKERINGEN_NIET_GECLASSIFICEERD_SLEUTEL = "VERZEKERINGEN_NIET_GECLASSIFICEERD";

export function verzekeringWerkelijkNaarPnLBovenEbitdaRegels(resultaat: WerkelijkVerzekeringResultaat, brondekkingBevestigd: boolean): PurePnLBovenEbitdaRegel[] {
  function categorieBijdrage(categorie: BgVerzekeringWerkelijkCategorie): PnLBronBijdrage {
    if (!brondekkingBevestigd) {
      return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Bron-/mappingdekking voor Verzekeringen-Werkelijk (${categorie}) is niet expliciet bevestigd door de aanroepende laag.` };
    }
    const categorieResultaat = resultaat.perCategorie.find((c) => c.categorie === categorie)!;
    return { status: "BEKEND", bedrag: categorieResultaat.categorieTotaal };
  }

  const regels: PurePnLBovenEbitdaRegel[] = VERZEKERING_WERKELIJK_CATEGORIEEN.map((categorie) => ({
    regelSleutel: categorie,
    boomPositie: "BOVEN_EBITDA",
    groep: "EXPLOITATIE_LASTEN",
    contributieAard: "KOSTEN",
    waarde: categorieBijdrage(categorie),
  }));

  if (brondekkingBevestigd && !resultaat.nietGeclassificeerdTotaal.isZero()) {
    regels.push({
      regelSleutel: VERZEKERINGEN_NIET_GECLASSIFICEERD_SLEUTEL,
      boomPositie: "BOVEN_EBITDA",
      groep: "EXPLOITATIE_LASTEN",
      contributieAard: "KOSTEN",
      waarde: {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Verzekeringen-Werkelijk heeft ${resultaat.nietGeclassificeerdAantalBoekingen} niet-geclassificeerde boeking(en), totaal ${resultaat.nietGeclassificeerdTotaal.toString()} — niet toe te rekenen aan de bekende categorie.`,
      },
    });
  }

  return regels;
}
