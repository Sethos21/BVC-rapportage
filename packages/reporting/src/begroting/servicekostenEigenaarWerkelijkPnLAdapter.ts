import { SERVICEKOSTEN_EIGENAAR_WERKELIJK_CATEGORIEEN, type ServicekostenEigenaarWerkelijkCategorie, type WerkelijkServicekostenEigenaarResultaat } from "./werkelijkServicekostenEigenaar.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE GAT-006 (2026-09-17) — DE Pure P&L-adapter voor Werkelijk
 * Servicekosten Eigenaar: vertaalt een reeds via de centrale mapping
 * geclassificeerd `WerkelijkServicekostenEigenaarResultaat`
 * (`werkelijkServicekostenEigenaar.ts`/`servicekostenEigenaarCentraleMapping.ts`)
 * naar de canonieke, boven-EBITDA `PurePnLBronRegel`'s die de Pure P&L
 * Engine (`pnlEngine.ts`, commit d25783e) verwacht — zelfde patroon als de
 * overige Werkelijk-adapters (Huur/Beheer/Management/Algemene Kosten/
 * Onderhoud-Estimated). GEEN wijziging aan de Pure P&L Engine zelf.
 *
 * ECONOMISCH HOOFDDOMEIN EN P&L-PRESENTATIE BLIJVEN GESCHEIDEN (GAT-006-
 * opdracht, kernprincipe): beide categorieën landen in DEZELFDE groep
 * (`EXPLOITATIE_LASTEN`) als Leegstand's eigen categorieën
 * (`NUTS_LEEGSTAND`/`OVERIGE_LEEGSTANDSKOSTEN`, hoofddomein `LEEGSTAND`) —
 * dat is bewust: een latere presentatielaag (niet in deze fase gebouwd) kan
 * `SERVICEKOSTEN_LEEGSTAND` (dit hoofddomein) visueel naast Leegstand se
 * eigen categorieën tonen zonder dat de ECONOMISCHE classificatie
 * verandert. De Pure P&L Engine zelf kent geen concept "presentatiegroep
 * los van boekhoudgroep" — dat hoeft ook niet: `regelSleutel` is al uniek en
 * onderscheidend genoeg voor een latere presentatielaag om te hergroeperen.
 *
 * GEEN ADMINISTRATIE-SPECIFIEKE KENNIS: uitsluitend de twee vaste economische
 * categorieën (`SERVICEKOSTEN_EIGENAAR_WERKELIJK_CATEGORIEEN`) — GEEN GL/OGB/
 * administratiecode.
 *
 * TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE: `WerkelijkServicekostenEigenaarResultaat.
 * perCategorie[].categorieTotaal` is het RUWE, ongewijzigde CAL-FIN-001-saldo
 * (zie `werkelijkServicekostenEigenaar.ts`) — de vaste `contributieAard` is
 * `"KOSTEN"` voor beide categorieën, en de bewezen 070/GL4350-bronproef laat
 * zien dat het ruwe saldo al POSITIEF binnenkomt (dezelfde conventie als
 * eerder bewezen voor GL4350 onder M5). De ÉNE normalisatiestap hier is
 * daarom de IDENTITEIT (geen tekenomkering nodig).
 *
 * COMPLETENESS (zelfde patroon als de overige Werkelijk-adapters, GAT-001B
 * §5-invariant): `nietGeclassificeerdTotaal != 0` (GL-residual) betekent
 * NOOIT dat een bekende categorie fout is — het wordt weergegeven als een
 * DERDE, expliciet ONBEKEND regel (`SERVICEKOSTEN_EIGENAAR_NIET_GECLASSIFICEERD`),
 * NOOIT als €0 behandeld, NOOIT stil verdeeld over REGULIER/LEEGSTAND.
 *
 * `brondekkingBevestigd` (GAT-001B §5, herhaald): `nietGeclassificeerdTotaal
 * === 0` is NOODZAKELIJK maar NIET VOLDOENDE bewijs van volledige dekking.
 * Zonder expliciete bevestiging blijven beide categorieën ONBEKEND.
 */

const SERVICEKOSTEN_EIGENAAR_NIET_GECLASSIFICEERD_SLEUTEL = "SERVICEKOSTEN_EIGENAAR_NIET_GECLASSIFICEERD";

export function servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels(resultaat: WerkelijkServicekostenEigenaarResultaat, brondekkingBevestigd: boolean): PurePnLBovenEbitdaRegel[] {
  function categorieBijdrage(categorie: ServicekostenEigenaarWerkelijkCategorie): PnLBronBijdrage {
    if (!brondekkingBevestigd) {
      return { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Bron-/mappingdekking voor Servicekosten-Eigenaar-Werkelijk (${categorie}) is niet expliciet bevestigd door de aanroepende laag.` };
    }
    const categorieResultaat = resultaat.perCategorie.find((c) => c.categorie === categorie)!;
    return { status: "BEKEND", bedrag: categorieResultaat.categorieTotaal };
  }

  const regels: PurePnLBovenEbitdaRegel[] = SERVICEKOSTEN_EIGENAAR_WERKELIJK_CATEGORIEEN.map((categorie) => ({
    regelSleutel: categorie,
    boomPositie: "BOVEN_EBITDA",
    groep: "EXPLOITATIE_LASTEN",
    contributieAard: "KOSTEN",
    waarde: categorieBijdrage(categorie),
  }));

  if (brondekkingBevestigd && !resultaat.nietGeclassificeerdTotaal.isZero()) {
    regels.push({
      regelSleutel: SERVICEKOSTEN_EIGENAAR_NIET_GECLASSIFICEERD_SLEUTEL,
      boomPositie: "BOVEN_EBITDA",
      groep: "EXPLOITATIE_LASTEN",
      contributieAard: "KOSTEN",
      waarde: {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Servicekosten-Eigenaar-Werkelijk heeft ${resultaat.nietGeclassificeerdAantalBoekingen} niet-geclassificeerde boeking(en), totaal ${resultaat.nietGeclassificeerdTotaal.toString()} — niet toe te rekenen aan REGULIER of LEEGSTAND (GL-residual, Unknown != zero).`,
      },
    });
  }

  return regels;
}
