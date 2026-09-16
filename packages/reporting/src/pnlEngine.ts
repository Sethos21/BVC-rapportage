import Decimal from "decimal.js";

/**
 * FASE EBITDA-GAT-001B (2026-09-16) — de pure P&L-/EBITDA-rekenlaag, volgens
 * het EBITDA-GAT-001A-ontwerp (Pure P&L Engine). Deze module implementeert
 * UITSLUITEND Laag B uit dat ontwerp: de presentatie-onafhankelijke
 * samenstelfunctie die reeds economisch geclassificeerde bijdragen
 * (Laag A — bestaande Begroting/Werkelijk/Estimated-calculators) optelt tot
 * Totaal opbrengsten, kostensubtotalen, Totaal kosten en EBITDA, met
 * volledigheid als eersteklas resultaat. Laag C (per-administratie
 * presentatie: labels, volgorde, verbergen, drilldown) bestaat hier
 * NIET — `regelSleutel`/`groep` zijn stabiele, portefeuillebrede
 * canon-sleutels, GEEN presentatielabels.
 *
 * DEZE MODULE KENT GEEN GL/OGB, GEEN BRONBOEKINGEN, GEEN ADMINISTRATIE, GEEN
 * RENDERER. Ze ontvangt uitsluitend reeds geclassificeerde
 * `PurePnLBronRegel`-waarden — nooit een grootboekrekening, OGB-kostensoort
 * of administratiecode. Dat blijft de verantwoordelijkheid van de (nog te
 * bouwen, per module bestaande) adapterlaag tussen een economische
 * calculator en deze engine — zie `pnlEngine.test.ts` voor bewijs-adapters
 * op Rente/Leegstand/Verzekeringen, uitdrukkelijk NIET geëxporteerd als
 * productiecode (zie EBITDA-GAT-001B-opdracht §16: nog geen productiewiring).
 *
 * ── COMPLETENESS: UNKNOWN != ZERO (§4/§6 van de opdracht) ──────────────────
 * `PnLBronBijdrage` kent drie, programmatisch onderscheidbare statussen:
 *  - `BEKEND`: een reëel, bekend bedrag — ook een bewust vastgesteld €0 (bv.
 *    een module met `beoordeeld=true` en nul regels) is hier gewoon `BEKEND`
 *    met `bedrag = Decimal(0)`. Functioneel onvolledig ≠ financieel
 *    onberekenbaar, zelfde principe als overal elders in dit project.
 *  - `NIET_VAN_TOEPASSING`: de post is voor deze administratie bewust
 *    verborgen/inactief (bv. Canon erfpacht bij 070, OB-034: "zonder
 *    erfpacht is de waarde €0,00") — economisch een BEVESTIGDE nul, maar
 *    apart gelabeld van een "normale" `BEKEND`-waarde zodat een latere
 *    presentatielaag ze kan onderscheiden. Telt voor de engine EXACT als
 *    `BEKEND` mee (zie `magMeetellenAlsBekend` hieronder) — beide zijn
 *    "geen onbekendheid", alleen de REDEN verschilt.
 *  - `ONBEKEND`: de ENIGE status die volledigheid blokkeert, met een
 *    GESLOTEN `dekkingReden` (`NIET_GEMAPT` / `TECHNISCH_NIET_ONDERSTEUND` /
 *    `GEEN_BEOORDELING`) — nooit alleen een vrije tekst, zodat volledigheid
 *    programmatisch (niet via string-parsing) kan worden gepropageerd.
 *
 * BELANGRIJKE AANVULLING (§5 van de opdracht, EBITDA-GAT-001A aangescherpt):
 * deze engine LEIDT NERGENS `BEKEND`/`ONBEKEND` AF UIT EEN CONTROLE OP
 * `nietGeclassificeerdTotaal` OF WELKE ANDERE BRONWAARDE DAN OOK — zij NEEMT
 * simpelweg de `PnLBronBijdrage.status` zoals de aanroeper (de adapterlaag)
 * die aanlevert. De AANROEPER is dus verantwoordelijk om zowel "een
 * Werkelijk-calculator bestaat, maar heeft een niet-nul
 * `nietGeclassificeerdTotaal`" (→ `ONBEKEND`/`NIET_GEMAPT`) als "een
 * calculator bestaat nog helemaal niet" (→ `ONBEKEND`/`TECHNISCH_NIET_ONDERSTEUND`,
 * ZONDER dat er een `nietGeclassificeerdTotaal` bestaat om te controleren)
 * naar dezelfde `PnLBronBijdrage`-vorm te vertalen. Dit voorkomt exact het
 * gevaar dat "geen nietGeclassificeerdTotaal" per ongeluk als "dus wel
 * bekend" wordt geïnterpreteerd wanneer de bron er in werkelijkheid
 * helemaal niet is.
 *
 * ── TEKENSEMANTIEK — EXACT ÉÉN NORMALISATIE, GEEN HEURISTIEK (§3) ──────────
 * Bestaande calculators sommeren bronboekingen volgens CAL-FIN-001
 * ("saldo = debet − credit") zonder ooit een teken te heroverwegen — bevestigd
 * consistent over Rente/Leegstand/Verzekeringen/Gemeentelijke Lasten/
 * Onderhoud/Algemene Kosten: kostencategorieën komen daardoor POSITIEF door
 * (bewezen: Rentekosten €1.148.524,51), opbrengstcategorieën NEGATIEF
 * (bewezen: Renteopbrengsten −€1.250,09). De ENE normalisatie die nodig is
 * om deze ruwe, boekhoudkundige saldi om te zetten naar een intuïtieve
 * "EBITDA = Totaal opbrengsten − Totaal kosten"-rekenkunde (beide gewoonlijk
 * positieve bedragen) gebeurt UITSLUITEND in de ADAPTERLAAG, PRECIES ÉÉN
 * KEER per regel, gestuurd door de VASTE `contributieAard`
 * (`"OPBRENGST" | "KOSTEN"`) — nooit afgeleid uit het teken van het bedrag
 * zelf (dat zou de "nooit Math.abs()"-regel schenden, CLAUDE.md §6).
 *
 * DEZE ENGINE ZELF DRAAIT GEEN ENKEL TEKEN OM — ZE SOMMEERT UITSLUITEND. Elk
 * `PnLBronBijdrage.bedrag` dat de engine ontvangt, is al in de conventie
 * "positief = draagt normaal bij aan zijn eigen kolom" (voor een
 * `KOSTEN`-regel is dat identiek aan het ruwe CAL-FIN-001-saldo, voor een
 * `OPBRENGST`-regel is dat het ÉÉN KEER genegeerde ruwe saldo). Doordat de
 * engine zelf NOOIT negeert, kan een `dubbele tekenomkering` (adapter én
 * engine draaien allebei om) hier per constructie niet optreden — de enige
 * plek die ooit negeert is de adapter, en dat gebeurt hier niet.
 *
 * `contributieAard` is voor BOVEN-EBITDA-regels bovendien een goedkope,
 * structurele controle waard: `groep === "OPBRENGSTEN"` moet altijd
 * samengaan met `contributieAard === "OPBRENGST"`, de overige drie groepen
 * altijd met `"KOSTEN"` — een afwijking is een adapterfout en wordt
 * fail-fast afgewezen (`valideerBovenEbitdaRegel`), nooit stil genegeerd.
 *
 * ── GEEN DUBBELE TELLING (§8, invariant 1/2/12) ─────────────────────────────
 * `specificaties` op een `PurePnLBronRegel` zijn UITSLUITEND traceerbaarheid/
 * drilldown — geen enkele functie in deze module itereert ooit over
 * `specificaties` om iets bij een som op te tellen. Elke hoofdregel wordt
 * bovendien—via haar eigen, unieke `groep`—in PRECIES ÉÉN subtotaal
 * meegeteld (nooit meermaals, nooit nul keer als ze in de invoerlijst
 * voorkomt).
 *
 * ── BOVEN/ONDER EBITDA (§9, invariant 3) ────────────────────────────────────
 * `PurePnLBronRegel` is een discriminated union op `boomPositie` —
 * `PurePnLOnderEbitdaRegel`-waarden hebben STRUCTUREEL geen `groep`-veld en
 * worden door `berekenPnLBoom` uitsluitend teruggegeven via het aparte
 * `onderEbitda`-veld; geen enkele optelfunctie in dit bestand leest ooit uit
 * die array om bij te dragen aan `totaalOpbrengsten`/`totaalKosten`/`ebitda`.
 * Dat is geen conventie die "toevallig" wordt nageleefd — het is
 * onmogelijk om een onder-EBITDA-regel per ongeluk in de boven-EBITDA-som
 * te krijgen, want de twee lijsten worden al bij binnenkomst gescheiden op
 * basis van het discriminerende `boomPositie`-veld van de regel zelf.
 */

// ── Canon (portefeuillebreed, GEEN administratie-specifieke waarden) ───────

/** De vier boven-EBITDA-groepen uit OB-042 — een structureel P&L-feit, geen bronmapping. */
export const PNL_GROEPEN_BOVEN_EBITDA = ["OPBRENGSTEN", "MANAGEMENT_EN_BEHEER", "EXPLOITATIE_LASTEN", "ALGEMENE_KOSTEN"] as const;
export type PnLGroepBovenEbitda = (typeof PNL_GROEPEN_BOVEN_EBITDA)[number];

export type PnLBoomPositie = "BOVEN_EBITDA" | "ONDER_EBITDA";

/** VASTE eigenschap van een canon-regel — nooit afgeleid uit het teken van het actuele bedrag (zie moduledoc). */
export type PnLContributieAard = "OPBRENGST" | "KOSTEN";

export const PNL_DEKKING_REDENEN = ["NIET_GEMAPT", "TECHNISCH_NIET_ONDERSTEUND", "GEEN_BEOORDELING"] as const;
export type PnLDekkingReden = (typeof PNL_DEKKING_REDENEN)[number];

export const PNL_WAARDESOORTEN = ["BEGROTING_VORIG_JAAR", "WERKELIJK", "ESTIMATED", "BEGROTING_NIEUW_JAAR"] as const;
export type PnLWaardesoort = (typeof PNL_WAARDESOORTEN)[number];

// ── Bijdrage/completeness ───────────────────────────────────────────────────

export type PnLBronBijdrage =
  | { status: "BEKEND"; bedrag: Decimal }
  /** Module bewust verborgen/inactief voor deze administratie — economisch een bevestigde nul, apart gelabeld van `BEKEND` (zie moduledoc). */
  | { status: "NIET_VAN_TOEPASSING"; bedrag: Decimal }
  /** De ENIGE status die volledigheid blokkeert. */
  | { status: "ONBEKEND"; dekkingReden: PnLDekkingReden; toelichting: string };

function magMeetellenAlsBekend(bijdrage: PnLBronBijdrage): bijdrage is { status: "BEKEND" | "NIET_VAN_TOEPASSING"; bedrag: Decimal } {
  return bijdrage.status === "BEKEND" || bijdrage.status === "NIET_VAN_TOEPASSING";
}

export interface PurePnLSpecificatieRegel {
  /** Puur traceerbaarheid/drilldown — NOOIT door deze module zelfstandig opgeteld. */
  label: string;
  waarde: PnLBronBijdrage;
}

interface PurePnLBronRegelBasis {
  /** Canon-sleutel — vast, portefeuillebreed, GEEN presentatielabel (bv. "ONDERHOUD", "RENTEKOSTEN", niet "Taxatie/Verhuurbemiddeling"). */
  regelSleutel: string;
  contributieAard: PnLContributieAard;
  waarde: PnLBronBijdrage;
  /** Optioneel, NOOIT zelfstandig opgeteld — zie moduledoc "Geen dubbele telling". */
  specificaties?: readonly PurePnLSpecificatieRegel[];
}

export interface PurePnLBovenEbitdaRegel extends PurePnLBronRegelBasis {
  boomPositie: "BOVEN_EBITDA";
  groep: PnLGroepBovenEbitda;
}

export interface PurePnLOnderEbitdaRegel extends PurePnLBronRegelBasis {
  boomPositie: "ONDER_EBITDA";
}

export type PurePnLBronRegel = PurePnLBovenEbitdaRegel | PurePnLOnderEbitdaRegel;

// ── Resultaat ────────────────────────────────────────────────────────────────

export type PnLVolledigheid =
  | { status: "VOLLEDIG" }
  | { status: "ONVOLLEDIG"; ontbrekend: readonly { regelSleutel: string; reden: PnLDekkingReden; toelichting: string }[] };

export interface PurePnLSubtotaal {
  sleutel: string;
  /** Som van uitsluitend BEKEND/NIET_VAN_TOEPASSING-regels — NOOIT gepresenteerd als "het" totaal wanneer `volledigheid.status === "ONVOLLEDIG"` (zie moduledoc §6/§7 van de opdracht). */
  besteWetenSom: Decimal;
  volledigheid: PnLVolledigheid;
  regels: readonly PurePnLBovenEbitdaRegel[];
}

export interface PurePnLResultaat {
  waardesoort: PnLWaardesoort;
  totaalOpbrengsten: PurePnLSubtotaal;
  managementEnBeheer: PurePnLSubtotaal;
  exploitatieLasten: PurePnLSubtotaal;
  algemeneKosten: PurePnLSubtotaal;
  /** Afgeleid: managementEnBeheer + exploitatieLasten + algemeneKosten — nooit los aangeleverd. */
  totaalKosten: PurePnLSubtotaal;
  /** Afgeleid: totaalOpbrengsten.besteWetenSom − totaalKosten.besteWetenSom — nooit los aangeleverd. */
  ebitda: { bedrag: Decimal; volledigheid: PnLVolledigheid };
  /** Rente, Verkoopresultaat, HRW/Herwaardering, Waardemutaties activa, Zonnestroom/bijzondere opbrengsten, … — NOOIT meegeteld in boven-EBITDA-sommen (zie moduledoc). */
  onderEbitda: readonly PurePnLOnderEbitdaRegel[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function combineerVolledigheid(volledigheden: readonly PnLVolledigheid[]): PnLVolledigheid {
  const ontbrekend = volledigheden.flatMap((v) => (v.status === "ONVOLLEDIG" ? v.ontbrekend : []));
  return ontbrekend.length === 0 ? { status: "VOLLEDIG" } : { status: "ONVOLLEDIG", ontbrekend };
}

/**
 * Fail-fast structurele controle (geen tekenheuristiek — zie moduledoc):
 * `OPBRENGSTEN`-groep hoort altijd bij `contributieAard: "OPBRENGST"`, de
 * overige drie boven-EBITDA-groepen altijd bij `"KOSTEN"`. Een afwijking is
 * een adapterfout, nooit iets om stil te verzoenen.
 */
function valideerBovenEbitdaRegel(regel: PurePnLBovenEbitdaRegel): void {
  const verwachteAard: PnLContributieAard = regel.groep === "OPBRENGSTEN" ? "OPBRENGST" : "KOSTEN";
  if (regel.contributieAard !== verwachteAard) {
    throw new Error(
      `Interne fout: regel "${regel.regelSleutel}" in groep "${regel.groep}" heeft contributieAard "${regel.contributieAard}", verwacht "${verwachteAard}" — een adapterfout, nooit stil te herstellen.`,
    );
  }
}

function berekenSubtotaal(sleutel: string, regels: readonly PurePnLBovenEbitdaRegel[]): PurePnLSubtotaal {
  const bekendeBedragen: Decimal[] = [];
  const ontbrekend: { regelSleutel: string; reden: PnLDekkingReden; toelichting: string }[] = [];

  for (const regel of regels) {
    valideerBovenEbitdaRegel(regel);
    if (magMeetellenAlsBekend(regel.waarde)) {
      bekendeBedragen.push(regel.waarde.bedrag);
      continue;
    }
    ontbrekend.push({ regelSleutel: regel.regelSleutel, reden: regel.waarde.dekkingReden, toelichting: regel.waarde.toelichting });
  }

  return {
    sleutel,
    besteWetenSom: som(bekendeBedragen),
    volledigheid: ontbrekend.length === 0 ? { status: "VOLLEDIG" } : { status: "ONVOLLEDIG", ontbrekend },
    regels,
  };
}

/**
 * De pure samenstelfunctie — Laag B uit het EBITDA-GAT-001A-ontwerp. Neemt
 * ÉÉN vlakke lijst reeds-geclassificeerde regels (boven én onder EBITDA door
 * elkaar toegestaan — de functie partitioneert zelf op ieders eigen
 * `boomPositie`, zie moduledoc) en levert de volledige, presentatie-
 * onafhankelijke P&L-boom + volledigheid op. Roept nergens een economische
 * calculator, resolver of bronmapping aan — puur optellen en volledigheid
 * propageren.
 */
export function berekenPnLBoom(waardesoort: PnLWaardesoort, regels: readonly PurePnLBronRegel[]): PurePnLResultaat {
  const bovenRegels = regels.filter((r): r is PurePnLBovenEbitdaRegel => r.boomPositie === "BOVEN_EBITDA");
  const onderEbitda = regels.filter((r): r is PurePnLOnderEbitdaRegel => r.boomPositie === "ONDER_EBITDA");

  const perGroep = (groep: PnLGroepBovenEbitda) => bovenRegels.filter((r) => r.groep === groep);

  const totaalOpbrengsten = berekenSubtotaal("TOTAAL_OPBRENGSTEN", perGroep("OPBRENGSTEN"));
  const managementEnBeheer = berekenSubtotaal("MANAGEMENT_EN_BEHEER", perGroep("MANAGEMENT_EN_BEHEER"));
  const exploitatieLasten = berekenSubtotaal("EXPLOITATIE_LASTEN", perGroep("EXPLOITATIE_LASTEN"));
  const algemeneKosten = berekenSubtotaal("ALGEMENE_KOSTEN", perGroep("ALGEMENE_KOSTEN"));

  const totaalKosten: PurePnLSubtotaal = {
    sleutel: "TOTAAL_KOSTEN",
    besteWetenSom: som([managementEnBeheer.besteWetenSom, exploitatieLasten.besteWetenSom, algemeneKosten.besteWetenSom]),
    volledigheid: combineerVolledigheid([managementEnBeheer.volledigheid, exploitatieLasten.volledigheid, algemeneKosten.volledigheid]),
    regels: [...managementEnBeheer.regels, ...exploitatieLasten.regels, ...algemeneKosten.regels],
  };

  const ebitda = {
    bedrag: totaalOpbrengsten.besteWetenSom.minus(totaalKosten.besteWetenSom),
    volledigheid: combineerVolledigheid([totaalOpbrengsten.volledigheid, totaalKosten.volledigheid]),
  };

  return { waardesoort, totaalOpbrengsten, managementEnBeheer, exploitatieLasten, algemeneKosten, totaalKosten, ebitda, onderEbitda };
}

// ── Vergelijking ─────────────────────────────────────────────────────────────

export interface PnLSubtotaalVergelijking {
  sleutel: string;
  basis: Decimal;
  vergelijk: Decimal;
  afwijking: Decimal;
  volledigheid: PnLVolledigheid;
}

export interface PnLVergelijking {
  waardesoortBasis: PnLWaardesoort;
  waardesoortVergelijk: PnLWaardesoort;
  totaalOpbrengsten: PnLSubtotaalVergelijking;
  managementEnBeheer: PnLSubtotaalVergelijking;
  exploitatieLasten: PnLSubtotaalVergelijking;
  algemeneKosten: PnLSubtotaalVergelijking;
  totaalKosten: PnLSubtotaalVergelijking;
  ebitda: PnLSubtotaalVergelijking;
}

function vergelijkSubtotaal(sleutel: string, basis: { besteWetenSom: Decimal; volledigheid: PnLVolledigheid }, vergelijk: { besteWetenSom: Decimal; volledigheid: PnLVolledigheid }): PnLSubtotaalVergelijking {
  return {
    sleutel,
    basis: basis.besteWetenSom,
    vergelijk: vergelijk.besteWetenSom,
    afwijking: vergelijk.besteWetenSom.minus(basis.besteWetenSom),
    volledigheid: combineerVolledigheid([basis.volledigheid, vergelijk.volledigheid]),
  };
}

/**
 * Zet twee reeds berekende `PurePnLResultaat`-waarden naast elkaar —
 * herberekent of wijzigt hun financiële inhoud NOOIT, uitsluitend
 * verschillen (aftrekking) en gecombineerde volledigheid. Bruikbaar voor elke
 * paar waardesoorten (bv. Estimated vs. nieuwe Begroting op de
 * controlepagina) — de functie kent zelf geen vaste "basis"/"vergelijk"-
 * betekenis, dat bepaalt de aanroeper met de volgorde van de argumenten.
 */
export function vergelijkPnLResultaten(basis: PurePnLResultaat, vergelijk: PurePnLResultaat): PnLVergelijking {
  return {
    waardesoortBasis: basis.waardesoort,
    waardesoortVergelijk: vergelijk.waardesoort,
    totaalOpbrengsten: vergelijkSubtotaal("TOTAAL_OPBRENGSTEN", basis.totaalOpbrengsten, vergelijk.totaalOpbrengsten),
    managementEnBeheer: vergelijkSubtotaal("MANAGEMENT_EN_BEHEER", basis.managementEnBeheer, vergelijk.managementEnBeheer),
    exploitatieLasten: vergelijkSubtotaal("EXPLOITATIE_LASTEN", basis.exploitatieLasten, vergelijk.exploitatieLasten),
    algemeneKosten: vergelijkSubtotaal("ALGEMENE_KOSTEN", basis.algemeneKosten, vergelijk.algemeneKosten),
    totaalKosten: vergelijkSubtotaal("TOTAAL_KOSTEN", basis.totaalKosten, vergelijk.totaalKosten),
    ebitda: vergelijkSubtotaal(
      "EBITDA",
      { besteWetenSom: basis.ebitda.bedrag, volledigheid: basis.ebitda.volledigheid },
      { besteWetenSom: vergelijk.ebitda.bedrag, volledigheid: vergelijk.ebitda.volledigheid },
    ),
  };
}
