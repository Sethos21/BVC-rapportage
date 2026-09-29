import type Decimal from "decimal.js";
import type { BgRenteCategorie, BgRenteResultaat, EstimatedRenteResultaat, WerkelijkRenteResultaat } from "./begroteRente.js";
import type { PnLBronBijdrage, PurePnLOnderEbitdaRegel } from "../pnlEngine.js";

/**
 * Rente (RENTEKOSTEN/RENTE_OPBRENGSTEN) → P&L (Tranche 10): ONDER EBITDA — de
 * eerste productiewiring van `begroteRente.ts`'s reeds bestaande, ongewijzigde
 * Begroting-/Werkelijk-/Estimated-calculators (OB-037/038). Dit bestand voegt
 * GEEN nieuwe financiële rekenlogica toe, uitsluitend vertaling naar
 * `PurePnLOnderEbitdaRegel`.
 *
 * NIEUW BUSINESSBESLUIT (Tranche 10): het uitgebreide leningmodel (FO) wordt
 * NIET gebouwd. Voor de Begroting betekent dit dat `begroteRente.ts`'s
 * per-regel rekenhulp (`laatstBekendSaldo`/`rentepercentage` →
 * `berekendVoorstel`) puur informatief blijft en hier NOOIT wordt gebruikt —
 * uitsluitend `categorieTotaal` (de som van de handmatige
 * `begrotingsbedrag`-regels) telt.
 *
 * TWEE VOLLEDIG ONAFHANKELIJKE P&L-POSTEN, REGELSLEUTEL = INTERNE CATEGORIE
 * (`RENTEKOSTEN`/`RENTE_OPBRENGSTEN`, al bewezen/getest als P&L-canon-sleutel
 * in `pnlEngine.test.ts`'s Rente-bewijsadapter) — GEEN gecombineerd
 * "rentesaldo".
 *
 * TEKENNORMALISATIE, EXACT ÉÉN KEER, GESTUURD DOOR `contributieAard` (zelfde
 * grens als de pure P&L Engine): KOSTEN-categorieën komen volgens CAL-FIN-001
 * al positief door (Rentekosten, bewezen €1.148.524,51) — identiteit.
 * OPBRENGST-categorieën komen NEGATIEF door (Rente opbrengsten, bewezen
 * −€1.250,09) — hier ÉÉN KEER genegeerd. Nooit een sign-flip op basis van het
 * teken van het bedrag zelf.
 *
 * DEKKING-GATING IN DE ADAPTER, NIET IN DE CALCULATOR (bewust het bestaande
 * Rente-patroon, ANDERS dan de nieuwere modules zoals Niet Verrekenbare BTW):
 * `berekenWerkelijkRente`/`berekenEstimatedRente` kennen zelf geen
 * `brondekkingBevestigd`-begrip (zie `begroteRente.ts`, ongewijzigd) — exact
 * zoals `pnlEngine.test.ts`'s Rente-bewijsadapter (`renteOnderEbitdaRegels`)
 * al aantoont: BEIDE voorwaarden (`brondekkingBevestigd` EN
 * `nietGeclassificeerdTotaal === 0`) moeten in de adapter gelden voor BEKEND,
 * nooit alleen uit `nietGeclassificeerdTotaal` afgeleid (Unknown != zero).
 *
 * LET OP — TEKENCONVENTIE VAN DE HANDMATIGE ESTIMATED-VERWACHTING (RENTE_OPBRENGSTEN):
 * `EstimatedRenteCategorieResultaat.estimatedTotaal = werkelijkTotaal + verwachtingResterendJaar`
 * rekent in `begroteRente.ts` ONGEWIJZIGD in de RUWE (CAL-FIN-001) tekenconventie
 * van `werkelijkTotaal` — voor RENTE_OPBRENGSTEN is dat NEGATIEF. Om
 * arithmetisch correct te blijven optellen (en dus GEEN aparte
 * normalisatiestap binnen de reeds bestaande, ongewijzigde pure calculator te
 * hoeven invoeren) wordt de handmatige resterende-verwachtingswaarde voor
 * RENTE_OPBRENGSTEN daarom EVENEENS in de ruwe, negatieve conventie
 * opgeslagen/aangeleverd (een grotere verwachte renteopbrengst is dus een
 * NEGATIEVER getal) — zie `renteEstimatedVerwachting.ts`'s moduledoc. Er is
 * hier bewust geen UI; een toekomstige invoerlaag vertaalt een door een
 * gebruiker ingevoerd positief bedrag naar deze conventie vóórdat het wordt
 * opgeslagen.
 */

const RENTEKOSTEN_PNL_SLEUTEL = "RENTEKOSTEN";
const RENTE_OPBRENGSTEN_PNL_SLEUTEL = "RENTE_OPBRENGSTEN";

const contributieAardVoor = (categorie: BgRenteCategorie): "KOSTEN" | "OPBRENGST" => (categorie === "RENTEKOSTEN" ? "KOSTEN" : "OPBRENGST");
const regelSleutelVoor = (categorie: BgRenteCategorie): string => (categorie === "RENTEKOSTEN" ? RENTEKOSTEN_PNL_SLEUTEL : RENTE_OPBRENGSTEN_PNL_SLEUTEL);

const renteRegel = (categorie: BgRenteCategorie, waarde: PnLBronBijdrage): PurePnLOnderEbitdaRegel => ({
  regelSleutel: regelSleutelVoor(categorie),
  boomPositie: "ONDER_EBITDA",
  contributieAard: contributieAardVoor(categorie),
  waarde,
});

/** `raw` is de RUWE CAL-FIN-001-waarde — hier ÉÉN KEER genormaliseerd naar de presentatieconventie, gestuurd door `contributieAard`. */
function genormaliseerd(categorie: BgRenteCategorie, raw: Decimal): Decimal {
  return categorie === "RENTE_OPBRENGSTEN" ? raw.negated() : raw;
}

// ── Begroting ────────────────────────────────────────────────────────────

/** Begroting: BEKEND als de categorie bewust beoordeeld is (ook met 0 regels = bewuste €0) en geen KRITIEKE controle heeft; anders ONBEKEND. */
export function renteBegrotingNaarPnLOnderEbitdaRegels(begroting: BgRenteResultaat): PurePnLOnderEbitdaRegel[] {
  return begroting.perCategorie.map((c) => {
    const kritiek = begroting.controleVereist.some((x) => x.categorie === c.categorie && x.ernst === "KRITIEK");
    const waarde: PnLBronBijdrage =
      c.beoordeeld && !kritiek
        ? { status: "BEKEND", bedrag: c.categorieTotaal }
        : { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Begroting ${c.categorie} niet bewust beoordeeld of bevat kritieke controles.` };
    return renteRegel(c.categorie, waarde);
  });
}

// ── Werkelijk ────────────────────────────────────────────────────────────

/**
 * Werkelijk Rente: BEKEND uitsluitend wanneer `brondekkingBevestigd`, deze SPECIFIEKE categorie een bewezen mapping
 * heeft (`gemapteCategorieen`, optioneel — `bepaalGemapteCategorieen` voor MODULE RENTE, zelfde precedent als
 * Algemene Kosten/Leegstand: een administratie kan bv. wel Rentekosten bewezen hebben en Rente opbrengsten niet) én
 * er GEEN niet-geclassificeerde boekingen zijn (module-breed — `berekenWerkelijkRente` splitst dat niet per
 * categorie, zie `begroteRente.ts`'s moduledoc). Een niet-nul `nietGeclassificeerdTotaal` maakt daarom BEIDE
 * categorieën ONBEKEND, exact zoals bewezen in `pnlEngine.test.ts`'s Rente-bewijsadapter.
 */
export function renteWerkelijkNaarPnLOnderEbitdaRegels(resultaat: WerkelijkRenteResultaat, brondekkingBevestigd: boolean, gemapteCategorieen?: ReadonlySet<string>): PurePnLOnderEbitdaRegel[] {
  return resultaat.perCategorie.map((c) => {
    let waarde: PnLBronBijdrage;
    if (!brondekkingBevestigd) {
      waarde = { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Bron-/mappingdekking voor Rente-Werkelijk (${c.categorie}) is niet expliciet bevestigd door de aanroepende laag.` };
    } else if (gemapteCategorieen !== undefined && !gemapteCategorieen.has(c.categorie)) {
      waarde = { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: `Voor deze administratie bestaat geen bewezen bronmapping naar ${c.categorie} — onbekend, geen bevestigde €0.` };
    } else if (!resultaat.nietGeclassificeerdTotaal.isZero()) {
      waarde = {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Rente-Werkelijk heeft ${resultaat.nietGeclassificeerdAantalBoekingen} niet-geclassificeerde boeking(en), totaal ${resultaat.nietGeclassificeerdTotaal.toString()} — niet toe te rekenen aan Rentekosten of Rente opbrengsten (Unknown != zero).`,
      };
    } else {
      waarde = { status: "BEKEND", bedrag: genormaliseerd(c.categorie, c.categorieTotaal) };
    }
    return renteRegel(c.categorie, waarde);
  });
}

// ── Estimated ────────────────────────────────────────────────────────────

/**
 * Estimated Rente: `estimatedTotaal = werkelijkTotaal + handmatige resterende verwachting` (`berekenEstimatedRente`,
 * ongewijzigd). Dekking-gating gebeurt HIER (zie moduledoc) met dezelfde raw `WerkelijkRenteResultaat` die ook de
 * Werkelijk-adapter gebruikt — `werkelijkDekkingBevestigd=false`, een categorie zonder bewezen mapping
 * (`gemapteCategorieen`, optioneel) of een niet-nul `nietGeclassificeerdTotaal` maakt de Estimated-regel ONBEKEND,
 * ongeacht een reeds ingevulde verwachting (geen verzonnen totaal op een onbekend Actual).
 */
export function renteEstimatedNaarPnLOnderEbitdaRegels(
  estimated: EstimatedRenteResultaat,
  werkelijk: WerkelijkRenteResultaat,
  werkelijkDekkingBevestigd: boolean,
  gemapteCategorieen?: ReadonlySet<string>,
): PurePnLOnderEbitdaRegel[] {
  const werkelijkVoldoendeBekend = werkelijkDekkingBevestigd && werkelijk.nietGeclassificeerdTotaal.isZero();
  return estimated.perCategorie.map((c) => {
    let waarde: PnLBronBijdrage;
    if (!werkelijkVoldoendeBekend) {
      waarde = { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: `Estimated Rente (${c.categorie}): Werkelijk-dekking voor de afgesloten periode is niet voldoende bevestigd.` };
    } else if (gemapteCategorieen !== undefined && !gemapteCategorieen.has(c.categorie)) {
      waarde = { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: `Estimated Rente (${c.categorie}): voor deze administratie bestaat geen bewezen bronmapping naar deze categorie — Werkelijk onbekend, dus Estimated onbekend.` };
    } else if (c.estimatedTotaal === null) {
      waarde = { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: `Estimated Rente (${c.categorie}): resterende-jaarverwachting is nog niet ingevuld — leeg is onbekend, nooit €0.` };
    } else {
      waarde = { status: "BEKEND", bedrag: genormaliseerd(c.categorie, c.estimatedTotaal) };
    }
    return renteRegel(c.categorie, waarde);
  });
}
