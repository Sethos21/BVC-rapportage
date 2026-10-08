import Decimal from "decimal.js";
import { ALGEMENE_KOSTEN_CATEGORIEEN, type BgAlgemeneKostenCategorie } from "./begroteAlgemeneKosten.js";
import { HUUR_NIET_GECLASSIFICEERD_SLEUTEL } from "./huurWerkelijkPnLAdapter.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * BEGROTING → PURE P&L (Vervolgtranche 6, ketencontrole): de adapters die een (herberekende of bevroren) Begroting
 * per module naar de canonieke boven-EBITDA-regels vertalen, zodat Begroting door DEZELFDE pure P&L-engine loopt als
 * Werkelijk en Estimated. Waardesoort (`BEGROTING_NIEUW_JAAR` / `BEGROTING_VORIG_JAAR`) bepaalt de aanroeper.
 *
 * Alleen vertalen, nooit rekenen: bedragen komen ongewijzigd uit de rekenlaag; er staat geen formule en geen
 * GL/OGB/administratie in dit bestand. Invoer is structureel minimaal (`Pick`-achtige vormen), zodat dezelfde adapter
 * zowel het CONCEPT-resultaat (live herberekend) als het VASTGESTELDE resultaat (bevroren gelezen) kan verwerken.
 *
 * BEKEND ALLEEN WAAR HET BETROUWBAAR IS ("Unknown != zero"): een module telt als BEKEND wanneer zij bewust is
 * beoordeeld en geen KRITIEKE controle heeft (een KRITIEKE controle betekent dat een regel een veilige 0 draagt in
 * plaats van een ingevuld bedrag). Anders ONBEKEND/GEEN_BEOORDELING — nooit een stille 0. Een bewust beoordeelde
 * module zonder regels is een bewuste, bekende €0. Huur/Beheer/Management kennen geen beoordeeld-vlag; daar blokkeert
 * alleen een KRITIEKE controle.
 *
 * SLEUTELS zijn de bestaande canon-sleutels van de Werkelijk-adapters waar die bestaan (HUUROPBRENGST_BELAST/ONBELAST,
 * BEHEERKOSTEN, MANAGEMENTVERGOEDING, GEMEENTELIJKE_LASTEN, de vijf Algemene-kosten-categorieën). Onderhoud en
 * Verzekeringen zijn op Begroting-niveau één P&L-post ("Onderhoud", "Verzekeringen"): de Begroting kent Gepland/
 * Correctief resp. polissen, niet de boekhouddimensie van Werkelijk (Gebouwen/Terrein/Installaties resp. categorie) —
 * er wordt bewust niet tussen die dimensies vertaald. De P&L-subtotalen blijven daardoor vergelijkbaar; regel-voor-
 * regel-uitlijning is presentatie (Laag C, niet gebouwd).
 *
 * VERHUURKORTING: de Begroting-huur is NETTO (korting zit erin, "niet als losse uitgaande P&L-regel gedupliceerd");
 * er komt daarom géén VERLEENDE_HUURKORTING-regel uit de Begroting. Netto huur met onbekende BTW-classificatie wordt
 * niet stil weggelaten of aan belast/onbelast toegewezen, maar als ONBEKEND-regel gemeld.
 */

interface Controle {
  ernst: string;
}

const heeftKritiek = (controles: readonly Controle[]): boolean => controles.some((c) => c.ernst === "KRITIEK");

function bekendOfOnbekend(betrouwbaar: boolean, bedrag: Decimal, onbekendToelichting: string): PnLBronBijdrage {
  return betrouwbaar ? { status: "BEKEND", bedrag } : { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: onbekendToelichting };
}

function kostenRegel(groep: "MANAGEMENT_EN_BEHEER" | "EXPLOITATIE_LASTEN" | "ALGEMENE_KOSTEN", regelSleutel: string, waarde: PnLBronBijdrage): PurePnLBovenEbitdaRegel {
  return { regelSleutel, boomPositie: "BOVEN_EBITDA", groep, contributieAard: "KOSTEN", waarde };
}

// ── Huur ────────────────────────────────────────────────────────────────────

export interface HuurBegrotingPnLInvoer {
  portefeuilleTotalen: { nettoHuurBelast: Decimal; nettoHuurOnbelast: Decimal; nettoHuurOnbekendeBtw: Decimal };
  controleVereist: readonly Controle[];
}

export function huurBegrotingNaarPnLBovenEbitdaRegels(begroting: HuurBegrotingPnLInvoer): PurePnLBovenEbitdaRegel[] {
  const betrouwbaar = !heeftKritiek(begroting.controleVereist);
  const opbrengst = (regelSleutel: string, bedrag: Decimal): PurePnLBovenEbitdaRegel => ({
    regelSleutel,
    boomPositie: "BOVEN_EBITDA",
    groep: "OPBRENGSTEN",
    contributieAard: "OPBRENGST",
    waarde: bekendOfOnbekend(betrouwbaar, bedrag, `Begroting Huur (${regelSleutel}): de Huur-begroting bevat kritieke controles — bedrag niet betrouwbaar.`),
  });
  const regels = [opbrengst("HUUROPBRENGST_BELAST", begroting.portefeuilleTotalen.nettoHuurBelast), opbrengst("HUUROPBRENGST_ONBELAST", begroting.portefeuilleTotalen.nettoHuurOnbelast)];
  if (!begroting.portefeuilleTotalen.nettoHuurOnbekendeBtw.isZero()) {
    regels.push({
      regelSleutel: HUUR_NIET_GECLASSIFICEERD_SLEUTEL,
      boomPositie: "BOVEN_EBITDA",
      groep: "OPBRENGSTEN",
      contributieAard: "OPBRENGST",
      waarde: {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Begroting Huur: netto huur ${begroting.portefeuilleTotalen.nettoHuurOnbekendeBtw.toString()} heeft een onbekende belast/onbelast-classificatie — niet aan belast of onbelast toegewezen.`,
      },
    });
  }
  return regels;
}

// ── Beheersvergoeding ───────────────────────────────────────────────────────

export interface BeheerBegrotingPnLInvoer {
  portefeuilleTotalen: { totaleVergoeding: Decimal };
  controleVereist: readonly Controle[];
}

export function beheerBegrotingNaarPnLBovenEbitdaRegels(begroting: BeheerBegrotingPnLInvoer): PurePnLBovenEbitdaRegel[] {
  return [
    kostenRegel(
      "MANAGEMENT_EN_BEHEER",
      "BEHEERKOSTEN",
      bekendOfOnbekend(!heeftKritiek(begroting.controleVereist), begroting.portefeuilleTotalen.totaleVergoeding, "Begroting Beheersvergoeding: kritieke controles — bedrag niet betrouwbaar."),
    ),
  ];
}

// ── Managementvergoeding ────────────────────────────────────────────────────

export interface ManagementBegrotingPnLInvoer {
  jaartotaal: { bedrag: Decimal };
  controleVereist: readonly Controle[];
}

/** `null` = er is voor deze begroting geen Managementvergoeding-invoer: onbekend (nooit €0 — "€0 ≠ niet ingevuld"). */
export function managementBegrotingNaarPnLBovenEbitdaRegels(begroting: ManagementBegrotingPnLInvoer | null): PurePnLBovenEbitdaRegel[] {
  if (begroting === null) {
    return [kostenRegel("MANAGEMENT_EN_BEHEER", "MANAGEMENTVERGOEDING", { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: "Begroting Managementvergoeding: geen invoer vastgelegd — onbekend, geen bewuste €0." })];
  }
  return [
    kostenRegel(
      "MANAGEMENT_EN_BEHEER",
      "MANAGEMENTVERGOEDING",
      bekendOfOnbekend(!heeftKritiek(begroting.controleVereist), begroting.jaartotaal.bedrag, "Begroting Managementvergoeding: kritieke controles — bedrag niet betrouwbaar."),
    ),
  ];
}

// ── Onderhoud (totaal = Gepland + Correctief/Dagelijks) ─────────────────────

interface BeoordeeldeModule {
  beoordeeld: boolean;
  totaalJaar: Decimal;
  controleVereist: readonly Controle[];
}

export interface OnderhoudBegrotingPnLInvoer {
  gepland: BeoordeeldeModule;
  correctiefDagelijks: BeoordeeldeModule;
}

export const ONDERHOUD_PNL_SLEUTEL = "ONDERHOUD";

/** `begrotingOnderhoudTotaal = begrotingGepland + begrotingCorrectiefDagelijks` (Master Contract §6.6); BEKEND alleen als beide delen bewust beoordeeld en kritiek-vrij zijn. */
export function onderhoudBegrotingNaarPnLBovenEbitdaRegels(begroting: OnderhoudBegrotingPnLInvoer): PurePnLBovenEbitdaRegel[] {
  const delen = [begroting.gepland, begroting.correctiefDagelijks];
  const betrouwbaar = delen.every((d) => d.beoordeeld && !heeftKritiek(d.controleVereist));
  const totaal = delen.reduce((som, d) => som.plus(d.totaalJaar), new Decimal(0));
  return [kostenRegel("EXPLOITATIE_LASTEN", ONDERHOUD_PNL_SLEUTEL, bekendOfOnbekend(betrouwbaar, totaal, "Begroting Onderhoud: Gepland of Correctief/Dagelijks is niet bewust beoordeeld of bevat kritieke controles."))];
}

// ── Verzekeringen ───────────────────────────────────────────────────────────

export interface VerzekeringBegrotingPnLInvoer {
  beoordeeld: boolean;
  /** Het effectieve jaarbedrag (na eventuele jaaroverride) — maand- en kwartaalverloop tellen daar sluitend naar op. */
  totaalEffectiefBegroot: Decimal;
  controleVereist: readonly Controle[];
}

export const VERZEKERINGEN_PNL_SLEUTEL = "VERZEKERINGEN";

export function verzekeringenBegrotingNaarPnLBovenEbitdaRegels(begroting: VerzekeringBegrotingPnLInvoer): PurePnLBovenEbitdaRegel[] {
  return [
    kostenRegel(
      "EXPLOITATIE_LASTEN",
      VERZEKERINGEN_PNL_SLEUTEL,
      bekendOfOnbekend(begroting.beoordeeld && !heeftKritiek(begroting.controleVereist), begroting.totaalEffectiefBegroot, "Begroting Verzekeringen: niet bewust beoordeeld of kritieke controles."),
    ),
  ];
}

// ── Gemeentelijke lasten ────────────────────────────────────────────────────

/**
 * BEWUST GEEN veld voor het WOZ-voorstel: het WOZ-voorstel is onderbouwing/referentie en nooit de begrotingspost. De
 * post is `grootboekRegels.begroteGemeentelijkeLastenPost` (som van de GL-regels). `grootboekRegels = null` = een vóór
 * migratie 33 bevroren begroting zonder GL-regels: de post is onbekend (nooit het voorstel, nooit €0).
 */
export interface GemeentelijkeLastenBegrotingPnLInvoer {
  beoordeeld: boolean;
  controleVereist: readonly Controle[];
  grootboekRegels: { begroteGemeentelijkeLastenPost: Decimal; controleVereist: readonly Controle[] } | null;
}

export const GEMEENTELIJKE_LASTEN_PNL_SLEUTEL = "GEMEENTELIJKE_LASTEN";

export function gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels(begroting: GemeentelijkeLastenBegrotingPnLInvoer): PurePnLBovenEbitdaRegel[] {
  if (begroting.grootboekRegels === null) {
    return [
      kostenRegel("EXPLOITATIE_LASTEN", GEMEENTELIJKE_LASTEN_PNL_SLEUTEL, {
        status: "ONBEKEND",
        dekkingReden: "GEEN_BEOORDELING",
        toelichting: "Begroting Gemeentelijke lasten: bevroren zonder GL-regels (vóór de directe begroting per GL) — de post is onbekend.",
      }),
    ];
  }
  const betrouwbaar = begroting.beoordeeld && !heeftKritiek(begroting.controleVereist) && !heeftKritiek(begroting.grootboekRegels.controleVereist);
  return [
    kostenRegel(
      "EXPLOITATIE_LASTEN",
      GEMEENTELIJKE_LASTEN_PNL_SLEUTEL,
      bekendOfOnbekend(betrouwbaar, begroting.grootboekRegels.begroteGemeentelijkeLastenPost, "Begroting Gemeentelijke lasten: niet bewust beoordeeld of kritieke controles (o.a. onbevestigde WOZ-set of ongeldige GL-regels)."),
    ),
  ];
}

// ── Algemene kosten (vijf afzonderlijke posten) ─────────────────────────────

export interface AlgemeneKostenBegrotingPnLInvoer {
  perCategorie: readonly { categorie: BgAlgemeneKostenCategorie; beoordeeld: boolean; categorieTotaal: Decimal }[];
  controleVereist: readonly { categorie: BgAlgemeneKostenCategorie; ernst: string }[];
}

export function algemeneKostenBegrotingNaarPnLBovenEbitdaRegels(begroting: AlgemeneKostenBegrotingPnLInvoer): PurePnLBovenEbitdaRegel[] {
  return ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie) => {
    const c = begroting.perCategorie.find((x) => x.categorie === categorie)!;
    const kritiek = begroting.controleVereist.some((x) => x.categorie === categorie && x.ernst === "KRITIEK");
    return kostenRegel("ALGEMENE_KOSTEN", categorie, bekendOfOnbekend(c.beoordeeld && !kritiek, c.categorieTotaal, `Begroting Algemene kosten (${categorie}): niet bewust beoordeeld of kritieke controles.`));
  });
}

// ── Estimated Onderhoud (totaalniveau) ──────────────────────────────────────

export interface OnderhoudEstimatedPnLInvoer {
  /** `werkelijk moduleTotaal + resterend Gepland + resterend Correctief/Dagelijks` (Werkelijk exact éénmaal). */
  estimatedOnderhoudTotaal: Decimal;
  werkelijkDekkingBevestigd: boolean;
  /** Buiten het Werkelijk-`moduleTotaal` (bestaand contract) — een niet-nul waarde betekent dat het Werkelijk-beeld onvolledig is. */
  nietGeclassificeerdTotaal: Decimal;
  /** Begroting-activiteiten/-regels zonder vastgelegde resterende verwachting. Ontbreekt die, dan telt zij in de orchestratie als 0 — maar een bewuste €0 moet expliciet zijn (OB-028), dus hier onbekend. */
  activiteitenZonderResterendeVerwachting: number;
  regelsZonderResterendeVerwachting: number;
}

/**
 * De Estimated-P&L-regel voor Onderhoud op TOTAALniveau (Master Contract §6.6). Vervangt in een P&L-samenstelling de
 * oudere per-Werkelijk-categorie-adapter (`onderhoudEstimatedNaarPnLBovenEbitdaRegels`) — combineer ze NOOIT (dubbele
 * telling): die oudere variant vereist een verwachting per Gebouwen/Terrein/Installaties, een vertaling tussen
 * dimensies die het accepteerde architectuurbesluit uitsluit.
 */
export function onderhoudEstimatedTotaalNaarPnLBovenEbitdaRegels(estimated: OnderhoudEstimatedPnLInvoer): PurePnLBovenEbitdaRegel[] {
  let waarde: PnLBronBijdrage;
  if (!estimated.werkelijkDekkingBevestigd || !estimated.nietGeclassificeerdTotaal.isZero()) {
    waarde = { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: "Estimated Onderhoud: Werkelijk-dekking voor de afgesloten periode is niet voldoende bevestigd (of er zijn niet-geclassificeerde boekingen)." };
  } else if (estimated.activiteitenZonderResterendeVerwachting > 0 || estimated.regelsZonderResterendeVerwachting > 0) {
    waarde = {
      status: "ONBEKEND",
      dekkingReden: "GEEN_BEOORDELING",
      toelichting: `Estimated Onderhoud: voor ${estimated.activiteitenZonderResterendeVerwachting} activiteit(en) en ${estimated.regelsZonderResterendeVerwachting} regel(s) is nog geen resterende verwachting vastgelegd (ook een bewuste €0 moet expliciet zijn).`,
    };
  } else {
    waarde = { status: "BEKEND", bedrag: estimated.estimatedOnderhoudTotaal };
  }
  return [kostenRegel("EXPLOITATIE_LASTEN", ONDERHOUD_PNL_SLEUTEL, waarde)];
}
