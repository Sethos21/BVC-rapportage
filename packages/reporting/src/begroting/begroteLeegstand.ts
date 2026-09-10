import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * Leegstandskosten — OB-031: ÉÉN samenhangende Begroting–Werkelijk–Estimated-
 * module voor de P&L-hoofdregel `Leegstandskosten`, conform het goedgekeurde
 * brononderzoek (2026-09, 070_Rooise_Zoom) en de businessbesluiten uit die
 * sessie. Uitsluitend de pure rekenlaag — drie onafhankelijke rekenfuncties,
 * geen database, geen boekingen-selectie, geen presentatie.
 *
 * DRIE ECONOMISCHE CATEGORIEËN (zelfde generieke-motor-patroon als OB-035/036):
 * NUTS_LEEGSTAND / SERVICEKOSTEN_LEEGSTAND / OVERIGE_LEEGSTANDSKOSTEN blijven
 * altijd afzonderlijk herleidbaar (`perCategorie`), nooit samengevoegd tot
 * één bedrag.
 *
 * GEEN OGB OP DE BEGROTINGSREGEL: anders dan OB-035/036 heeft een
 * Leegstandskosten-begrotingsregel GEEN OGB-kostensoort-dimensie — het
 * bronproef (2026-09) toonde dat OGB-classificatie hier uitsluitend zinvol is
 * om WERKELIJKE boekingen te classificeren, niet om een begrotingsregel te
 * valideren. Een begrotingsregel heeft complex (optioneel/NTB) + omschrijving
 * + Q1-Q4.
 *
 * UNIT IS GEEN DIMENSIE: het bronproef toonde dat unit-identiteit voor 070
 * niet generiek betrouwbaar af te leiden is (multi-unit-contracten zonder
 * unitnummer) — noch de Begroting, noch Werkelijk, noch Estimated kent hier
 * een unitveld.
 *
 * FUNCTIONEEL ONVOLLEDIG ≠ FINANCIEEL ONBEREKENBAAR: een lege `omschrijving`
 * geeft een KRITIEK-control maar laat de financiële bijdrage van de regel
 * ongemoeid. Elk van Q1-Q4 wordt AFZONDERLIJK gevalideerd: `null`/NaN triggert
 * een veilige 0-bijdrage VOOR DAT KWARTAAL (KRITIEK), een negatief bedrag telt
 * volledig mee (WAARSCHUWING). `totaal` is de som van de vier (veilige)
 * kwartaalbedragen.
 *
 * REKENHULP SERVICEKOSTEN LEEGSTAND (`laatstBekendServicekostenvoorschotJaar`
 * × `verwachteLeegstandsperiodeMaanden` / 12 → `berekendVoorstel`): puur
 * informatief, structureel op elke categorie beschikbaar (generiek model,
 * geen categorie-specifieke branch) maar functioneel uitsluitend bedoeld voor
 * SERVICEKOSTEN_LEEGSTAND. Het voorstel wijzigt NOOIT de regels of
 * `categorieTotaal` — de gebruiker moet het uiteindelijke begrotingsbedrag
 * altijd expliciet zelf invoeren in een Q1-Q4-regel.
 *
 * `verwachteLeegstandsperiodeMaanden` is en blijft ALTIJD een handmatige
 * businessaanname — geen enkele bron levert een "verwachte toekomstige
 * leegstandsduur", dus hier is geen BRON-variant mogelijk.
 *
 * `laatstBekendServicekostenvoorschotJaar` heeft TWEE geldige herkomsten,
 * bijgehouden via het aparte veld `laatstBekendServicekostenvoorschotJaarHerkomst`
 * (`"BRON" | "HANDMATIG" | null`, `null` uitsluitend wanneer het bedrag zelf
 * ook `null` is):
 * - `"BRON"`: de AANROEPER (buiten deze pure module — bv. een latere
 *   Worker-integratie) heeft een betrouwbaar gekoppeld `servicekostenvoorschotJaar`
 *   gevonden (bv. via Huurdersoverzicht/RentRoll voor een unit met een
 *   LOPEND contract) en geeft dat hier als reeds-geresolved voorstel-bedrag
 *   door. Deze module ZOEKT/QUERY'T dat zelf nooit — ze ontvangt het bedrag
 *   uitsluitend als pure invoer, exact zoals de classificatie bij Werkelijk.
 *   Bewust GEEN automatische reconstructie van "het laatst bekende contract"
 *   voor een NU VACANTE unit — het bronproef toonde dat zo'n reconstructie
 *   niet generiek betrouwbaar is (multi-unit-contracten zonder unitnummer,
 *   onbevestigde RentRoll-historiediepte). Voor die situatie ontbreekt de
 *   bronwaarde dus terecht (`null`) — nooit een geraden vervanger.
 * - `"HANDMATIG"`: de gebruiker heeft zelf een bedrag ingevuld, hetzij omdat
 *   er geen betrouwbare bronkoppeling bestaat, hetzij als bewuste correctie
 *   op een aangeboden BRON-waarde.
 * Beide herkomsten worden IDENTIEK doorgerekend (`berekendVoorstel` kijkt
 * uitsluitend naar de numerieke waarde, nooit naar de herkomst) — de
 * herkomst is uitsluitend traceerbaarheid/presentatie, geen rekenregel. Bij
 * ontbrekende/ongeldige invoer is `berekendVoorstel` `null` — nooit een
 * verzonnen bedrag.
 *
 * REVIEW PER CATEGORIE: `beoordeeld` is pure doorgegeven invoer, nooit
 * afgeleid. `beoordeeld=true` met 0 regels is een geldige €0-begroting voor
 * die ene categorie (`REVIEWED_ZERO_RULES`).
 *
 * WERKELIJK (`berekenWerkelijkLeegstand`): classificeert reeds-geselecteerde
 * boekingsregels via een expliciete, pure `classificatie`-parameter
 * (OGB-kostensoort → categorie) — bewezen voor 070: OGB 4319 =
 * "Servicekosten leegstand". GEEN eigen OGB-kennis, GEEN vrije-tekst
 * unit-parsing (bewezen onbetrouwbaar, bronproef), GEEN GL-nummer hardcoded
 * als universele betekenis. Een boeking met een onbekende/ontbrekende
 * OGB-kostensoort wordt NOOIT geraden — apart gehouden in
 * `nietGeclassificeerd*`, altijd zichtbaar via `controleVereist`.
 * Aggregatie is op categorie + complex (complexnummer `null` apart
 * gegroepeerd) — nooit op een specifieke begrotingsregel, want de bron
 * ondersteunt die koppeling niet (bronproef).
 *
 * ESTIMATED (`berekenEstimatedLeegstand`, volgt het OB-030-patroon):
 * `estimatedTotaal = werkelijkTotaal + verwachtingResterendJaar` per
 * categorie. `verwachtingResterendJaar` is een handmatige businessaanname per
 * categorie (het niveau waarop Werkelijk zelf betrouwbaar is, bronproef) —
 * `null` zolang niet ingevuld, NOOIT een verzonnen bedrag. `begrotingTotaal`
 * wordt ONGEWIJZIGD doorgegeven vanuit het Begroting-resultaat — Estimated
 * berekent of muteert nooit de Begroting. Geen dubbeltelling: `werkelijkTotaal`
 * bevat reeds ALLE geboekte prolongatie/afrekening/correctie binnen dezelfde
 * OGB-categorie (één keer, via saldo), `verwachtingResterendJaar` dekt
 * uitsluitend de nog niet geboekte rest van het jaar.
 *
 * ARCHITECTUURREGEL — VASTGESTELD BEVRIEST UITSLUITEND DE BEGROTING (expliciet
 * vastgelegd 2026-09-10): `VASTGESTELD` bevriest de Begroting-kant van deze
 * module (zie `@bvc/begroting-data`'s `frozenLeegstandResultaat.ts`). Werkelijk
 * en Estimated zijn en blijven ACTUELE rapportagewaarden — ze bewegen mee met
 * nieuwe boekingen en met wijzigingen aan de levende OGB-classificatie, ook
 * ná het vaststellen van een begrotingsversie. Er wordt daarom NOOIT beloofd
 * dat de historische stand van Werkelijk/Estimated op de vaststeldatum later
 * exact reproduceerbaar is — dat zou een bevroren classificatie/Werkelijk-
 * snapshot vereisen, wat welbewust NIET gebouwd wordt (zie hierboven en
 * `frozenLeegstandResultaat.ts`'s moduledoc voor het volledige bewijs).
 *
 * BUITEN SCOPE (expliciet, geen aanname): Servicekosten eigenaar/VvE (hoort
 * niet onder OB-031), persistence/frozen-lifecycle (zie
 * `@bvc/begroting-data`), UI/rendering, een Worker-CLI-commando, automatische
 * classificatie van Nuts/Overige leegstandskosten zonder bewezen bron/mapping.
 */

export const LEEGSTAND_CATEGORIEEN = ["NUTS_LEEGSTAND", "SERVICEKOSTEN_LEEGSTAND", "OVERIGE_LEEGSTANDSKOSTEN"] as const;
export type BgLeegstandCategorie = (typeof LEEGSTAND_CATEGORIEEN)[number];

export type BgLeegstandControleErnst = BgControleErnst;

export interface BgLeegstandControleItem {
  categorie: BgLeegstandCategorie;
  /** Positie van de betrokken regel BINNEN de regels van deze categorie — `null` = categoriebreed (bv. de rekenhulp), niet aan één regel toe te wijzen. */
  regelIndex: number | null;
  ernst: BgLeegstandControleErnst;
  bericht: string;
}

// ── Begroting ────────────────────────────────────────────────────────────

export interface BgLeegstandRegelInvoer {
  categorie: BgLeegstandCategorie;
  /** `null` = nog niet toegewezen (NTB) — complex is optioneel, geen validatie/verplichting. */
  complexnummer: string | null;
  /** Puur presentatie naast `complexnummer` — nooit voor joins/aggregaties (zelfde conventie als `contracten.Complexomschrijving`). */
  complexomschrijving: string | null;
  omschrijving: string;
  /** `null` = nog niet ingevoerd voor dit kwartaal — GEEN default naar 0. */
  q1: Decimal | null;
  q2: Decimal | null;
  q3: Decimal | null;
  q4: Decimal | null;
}

/** Herkomst van `laatstBekendServicekostenvoorschotJaar` — zie moduledoc. `null` uitsluitend wanneer het bedrag zelf ook `null` is. */
export type BgLeegstandBasisbedragHerkomst = "BRON" | "HANDMATIG";

export interface BgLeegstandCategorieAannames {
  beoordeeld: boolean;
  /** Rekenhulp (uitsluitend functioneel relevant voor SERVICEKOSTEN_LEEGSTAND, zie moduledoc) — puur invoer, deze module zoekt/query't dit zelf nooit. */
  laatstBekendServicekostenvoorschotJaar: Decimal | null;
  /** `"BRON"` = door de aanroeper aangeleverd als betrouwbaar gekoppeld bronbedrag; `"HANDMATIG"` = door de gebruiker zelf ingevuld; `null` = geen bedrag (zie moduledoc). */
  laatstBekendServicekostenvoorschotJaarHerkomst: BgLeegstandBasisbedragHerkomst | null;
  /** Verwachte leegstandsduur in maanden (ALTIJD handmatige businessaanname, zie moduledoc) — geldig bereik is niet afgedwongen (geen aanname over een maximum). */
  verwachteLeegstandsperiodeMaanden: Decimal | null;
}

export type BgLeegstandReviewStatus = "NOT_REVIEWED" | "REVIEWED_ZERO_RULES" | "REVIEWED_WITH_RULES";

export interface BgLeegstandRegelUitkomst {
  /** Positie binnen de regels van DEZE categorie (na filtering op categorie). */
  index: number;
  invoer: BgLeegstandRegelInvoer;
  /** Veilige kwartaalbedragen: `null`/NaN is al naar 0 herleid, negatief blijft ongewijzigd. */
  q1: Decimal;
  q2: Decimal;
  q3: Decimal;
  q4: Decimal;
  /** q1+q2+q3+q4 (veilige bedragen). */
  totaal: Decimal;
}

export interface BgLeegstandCategorieResultaat {
  categorie: BgLeegstandCategorie;
  /** Pure doorgifte van de aanname — nooit hier afgeleid. */
  beoordeeld: boolean;
  reviewStatus: BgLeegstandReviewStatus;
  regels: BgLeegstandRegelUitkomst[];
  categorieTotaal: Decimal;
  /** Pure doorgifte van de aanname — traceerbaarheid. */
  laatstBekendServicekostenvoorschotJaar: Decimal | null;
  /** Pure doorgifte van de aanname — traceerbaarheid van BRON versus HANDMATIG, zie moduledoc. */
  laatstBekendServicekostenvoorschotJaarHerkomst: BgLeegstandBasisbedragHerkomst | null;
  verwachteLeegstandsperiodeMaanden: Decimal | null;
  /** `laatstBekendServicekostenvoorschotJaar × (verwachteLeegstandsperiodeMaanden / 12)` indien beide geldig, anders `null`. Uitsluitend rekenhulp — wijzigt nooit `categorieTotaal`. */
  berekendVoorstel: Decimal | null;
}

export interface BgLeegstandResultaat {
  begrotingsjaar: number;
  /** Vaste volgorde: `LEEGSTAND_CATEGORIEEN`. */
  perCategorie: BgLeegstandCategorieResultaat[];
  nutsLeegstand: Decimal;
  servicekostenLeegstand: Decimal;
  overigeLeegstandskosten: Decimal;
  /** Som van de drie categorieTotalen — de P&L-hoofdregel `Leegstandskosten`. */
  moduleTotaal: Decimal;
  controleVereist: BgLeegstandControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function isGeldigDecimal(waarde: Decimal | null): waarde is Decimal {
  return waarde !== null && !waarde.isNaN();
}

function leeg(waarde: string): boolean {
  return waarde.trim().length === 0;
}

function veiligBedrag(waarde: Decimal | null): Decimal {
  return isGeldigDecimal(waarde) ? waarde : new Decimal(0);
}

const KWARTALEN = ["q1", "q2", "q3", "q4"] as const;
type Kwartaal = (typeof KWARTALEN)[number];

function valideerRegel(
  invoer: BgLeegstandRegelInvoer,
  index: number,
): { controleVereist: BgLeegstandControleItem[]; veilig: Record<Kwartaal, Decimal> } {
  const controleVereist: BgLeegstandControleItem[] = [];
  const meld = (bericht: string, ernst: BgLeegstandControleErnst = "KRITIEK") =>
    controleVereist.push({ categorie: invoer.categorie, regelIndex: index, ernst, bericht });

  if (leeg(invoer.omschrijving)) {
    meld(`${invoer.categorie} regel ${index}: omschrijving ontbreekt — verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
  }

  const veilig = {} as Record<Kwartaal, Decimal>;
  for (const kwartaal of KWARTALEN) {
    const waarde = invoer[kwartaal];
    if (waarde === null) {
      meld(`${invoer.categorie} regel ${index}: ${kwartaal.toUpperCase()} ontbreekt — verplicht voor vaststellen; veilige bijdrage 0 toegepast.`);
    } else if (waarde.isNaN()) {
      meld(`${invoer.categorie} regel ${index}: ${kwartaal.toUpperCase()} is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
    } else if (waarde.isNegative()) {
      meld(`${invoer.categorie} regel ${index}: ${kwartaal.toUpperCase()} is negatief (${waarde.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
    }
    veilig[kwartaal] = veiligBedrag(waarde);
  }

  return { controleVereist, veilig };
}

function berekenCategorie(
  categorie: BgLeegstandCategorie,
  regelsInvoer: readonly BgLeegstandRegelInvoer[],
  aannames: BgLeegstandCategorieAannames,
): { resultaat: BgLeegstandCategorieResultaat; controleVereist: BgLeegstandControleItem[] } {
  const controleVereist: BgLeegstandControleItem[] = [];

  const regels: BgLeegstandRegelUitkomst[] = regelsInvoer.map((invoer, index) => {
    const { controleVereist: meldingen, veilig } = valideerRegel(invoer, index);
    controleVereist.push(...meldingen);
    return { index, invoer, q1: veilig.q1, q2: veilig.q2, q3: veilig.q3, q4: veilig.q4, totaal: som([veilig.q1, veilig.q2, veilig.q3, veilig.q4]) };
  });

  const categorieTotaal = som(regels.map((r) => r.totaal));

  const reviewStatus: BgLeegstandReviewStatus = !aannames.beoordeeld
    ? "NOT_REVIEWED"
    : regels.length === 0
      ? "REVIEWED_ZERO_RULES"
      : "REVIEWED_WITH_RULES";

  if (aannames.laatstBekendServicekostenvoorschotJaar !== null) {
    if (aannames.laatstBekendServicekostenvoorschotJaar.isNaN()) {
      controleVereist.push({
        categorie,
        regelIndex: null,
        ernst: "KRITIEK",
        bericht: `${categorie}: laatstBekendServicekostenvoorschotJaar is geen geldig getal (NaN) — rekenhulp-voorstel niet berekend.`,
      });
    } else if (aannames.laatstBekendServicekostenvoorschotJaar.isNegative()) {
      controleVereist.push({
        categorie,
        regelIndex: null,
        ernst: "WAARSCHUWING",
        bericht: `${categorie}: laatstBekendServicekostenvoorschotJaar is negatief (${aannames.laatstBekendServicekostenvoorschotJaar.toString()}) — toegestaan, rekenkundig verwerkt.`,
      });
    }
  }
  if (aannames.verwachteLeegstandsperiodeMaanden !== null) {
    if (aannames.verwachteLeegstandsperiodeMaanden.isNaN()) {
      controleVereist.push({
        categorie,
        regelIndex: null,
        ernst: "KRITIEK",
        bericht: `${categorie}: verwachteLeegstandsperiodeMaanden is geen geldig getal (NaN) — rekenhulp-voorstel niet berekend.`,
      });
    } else if (aannames.verwachteLeegstandsperiodeMaanden.isNegative()) {
      controleVereist.push({
        categorie,
        regelIndex: null,
        ernst: "WAARSCHUWING",
        bericht: `${categorie}: verwachteLeegstandsperiodeMaanden is negatief (${aannames.verwachteLeegstandsperiodeMaanden.toString()}) — toegestaan, rekenkundig verwerkt.`,
      });
    }
  }

  const berekendVoorstel =
    isGeldigDecimal(aannames.laatstBekendServicekostenvoorschotJaar) && isGeldigDecimal(aannames.verwachteLeegstandsperiodeMaanden)
      ? aannames.laatstBekendServicekostenvoorschotJaar.times(aannames.verwachteLeegstandsperiodeMaanden.dividedBy(12))
      : null;

  return {
    resultaat: {
      categorie,
      beoordeeld: aannames.beoordeeld,
      reviewStatus,
      regels,
      categorieTotaal,
      laatstBekendServicekostenvoorschotJaar: aannames.laatstBekendServicekostenvoorschotJaar,
      laatstBekendServicekostenvoorschotJaarHerkomst: aannames.laatstBekendServicekostenvoorschotJaarHerkomst,
      verwachteLeegstandsperiodeMaanden: aannames.verwachteLeegstandsperiodeMaanden,
      berekendVoorstel,
    },
    controleVereist,
  };
}

export function berekenBegroteLeegstand(
  regelsInvoer: readonly BgLeegstandRegelInvoer[],
  categorieAannames: Record<BgLeegstandCategorie, BgLeegstandCategorieAannames>,
  context: { begrotingsjaar: number },
): BgLeegstandResultaat {
  const controleVereist: BgLeegstandControleItem[] = [];

  const perCategorie: BgLeegstandCategorieResultaat[] = LEEGSTAND_CATEGORIEEN.map((categorie) => {
    const regelsVoorCategorie = regelsInvoer.filter((r) => r.categorie === categorie);
    const { resultaat, controleVereist: meldingen } = berekenCategorie(categorie, regelsVoorCategorie, categorieAannames[categorie]);
    controleVereist.push(...meldingen);
    return resultaat;
  });

  const totaalVoor = (categorie: BgLeegstandCategorie): Decimal => perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;

  return {
    begrotingsjaar: context.begrotingsjaar,
    perCategorie,
    nutsLeegstand: totaalVoor("NUTS_LEEGSTAND"),
    servicekostenLeegstand: totaalVoor("SERVICEKOSTEN_LEEGSTAND"),
    overigeLeegstandskosten: totaalVoor("OVERIGE_LEEGSTANDSKOSTEN"),
    moduleTotaal: som(perCategorie.map((c) => c.categorieTotaal)),
    controleVereist,
  };
}

// ── Werkelijk ────────────────────────────────────────────────────────────

/**
 * Eén regel van de lokale leegstand-classificatie (OGB-kostensoort →
 * categorie), administratie-specifiek geresolved en als pure invoer
 * aangeleverd — deze module leest of query't zelf nooit een
 * classificatieconfig/database (zelfde conventie als OB-035/036).
 */
export interface LeegstandClassificatieRegel {
  ogbKostensoort: string;
  ogbKostensoortOmschrijving: string;
  categorie: BgLeegstandCategorie;
}

/**
 * Eén reeds-geselecteerde boeking (Werkelijk) — deze module selecteert zelf
 * geen boekingen, doet geen GL-filter en kent geen debet/credit-conventie:
 * `saldo` is al door de aanroeper correct bepaald (debet - credit, CAL-FIN-001).
 */
export interface WerkelijkLeegstandBoekingRegel {
  /** `null` = geen OGB-kostensoort op de boeking — nooit classificeerbaar, altijd apart gehouden. */
  ogbKostensoort: string | null;
  complexnummer: string | null;
  saldo: Decimal;
}

export interface WerkelijkLeegstandComplexTotaal {
  complexnummer: string | null;
  saldo: Decimal;
  aantalBoekingen: number;
}

export interface WerkelijkLeegstandCategorieResultaat {
  categorie: BgLeegstandCategorie;
  categorieTotaal: Decimal;
  perComplex: WerkelijkLeegstandComplexTotaal[];
}

export interface WerkelijkLeegstandControleItem {
  ernst: BgLeegstandControleErnst;
  ogbKostensoort: string | null;
  bericht: string;
}

export interface WerkelijkLeegstandResultaat {
  /** Vaste volgorde: `LEEGSTAND_CATEGORIEEN`. */
  perCategorie: WerkelijkLeegstandCategorieResultaat[];
  /** Som van de drie categorieTotalen — het werkelijk geboekte Leegstandskosten-saldo. */
  moduleTotaal: Decimal;
  /** Boekingen met een OGB-kostensoort die niet in `classificatie` voorkomt (of `null`) — NOOIT geraden, NOOIT meegeteld in een categorie. */
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
  controleVereist: WerkelijkLeegstandControleItem[];
}

function complexTotalen(regels: readonly WerkelijkLeegstandBoekingRegel[]): WerkelijkLeegstandComplexTotaal[] {
  const perComplexMap = new Map<string | null, WerkelijkLeegstandBoekingRegel[]>();
  for (const regel of regels) {
    const groep = perComplexMap.get(regel.complexnummer) ?? [];
    groep.push(regel);
    perComplexMap.set(regel.complexnummer, groep);
  }
  return Array.from(perComplexMap.entries())
    .map(([complexnummer, groep]) => ({ complexnummer, saldo: som(groep.map((r) => r.saldo)), aantalBoekingen: groep.length }))
    .sort((a, b) => (a.complexnummer ?? "").localeCompare(b.complexnummer ?? ""));
}

export function berekenWerkelijkLeegstand(
  boekingen: readonly WerkelijkLeegstandBoekingRegel[],
  classificatie: readonly LeegstandClassificatieRegel[],
): WerkelijkLeegstandResultaat {
  const controleVereist: WerkelijkLeegstandControleItem[] = [];
  const perCategorieRegels = new Map<BgLeegstandCategorie, WerkelijkLeegstandBoekingRegel[]>(LEEGSTAND_CATEGORIEEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkLeegstandBoekingRegel[] = [];

  for (const regel of boekingen) {
    if (regel.ogbKostensoort === null) {
      nietGeclassificeerd.push(regel);
      controleVereist.push({
        ernst: "WAARSCHUWING",
        ogbKostensoort: null,
        bericht: `Boeking zonder OGB-kostensoort (complex ${regel.complexnummer ?? "(onbekend)"}, saldo ${regel.saldo.toString()}) — niet classificeerbaar, buiten alle categorietotalen gehouden.`,
      });
      continue;
    }
    const gevonden = classificatie.find((c) => c.ogbKostensoort === regel.ogbKostensoort);
    if (gevonden === undefined) {
      nietGeclassificeerd.push(regel);
      controleVereist.push({
        ernst: "WAARSCHUWING",
        ogbKostensoort: regel.ogbKostensoort,
        bericht: `OGB-kostensoort "${regel.ogbKostensoort}" komt niet voor in de lokale leegstand-classificatie van deze administratie — onbekende code, niet geraden, buiten alle categorietotalen gehouden.`,
      });
      continue;
    }
    perCategorieRegels.get(gevonden.categorie)!.push(regel);
  }

  const perCategorie: WerkelijkLeegstandCategorieResultaat[] = LEEGSTAND_CATEGORIEEN.map((categorie) => {
    const regels = perCategorieRegels.get(categorie)!;
    return { categorie, categorieTotaal: som(regels.map((r) => r.saldo)), perComplex: complexTotalen(regels) };
  });

  return {
    perCategorie,
    moduleTotaal: som(perCategorie.map((c) => c.categorieTotaal)),
    nietGeclassificeerdTotaal: som(nietGeclassificeerd.map((r) => r.saldo)),
    nietGeclassificeerdAantalBoekingen: nietGeclassificeerd.length,
    controleVereist,
  };
}

// ── Estimated ────────────────────────────────────────────────────────────

export interface EstimatedLeegstandCategorieResultaat {
  categorie: BgLeegstandCategorie;
  /** Ongewijzigd doorgegeven vanuit het Begroting-resultaat — Estimated berekent of muteert de Begroting nooit. */
  begrotingTotaal: Decimal;
  /** Ongewijzigd doorgegeven vanuit het Werkelijk-resultaat (t/m de laatst afgesloten periode die de aanroeper heeft geselecteerd). */
  werkelijkTotaal: Decimal;
  /** Handmatige businessaanname — `null` zolang niet ingevuld, NOOIT verzonnen. */
  verwachtingResterendJaar: Decimal | null;
  /** `werkelijkTotaal + verwachtingResterendJaar`, of `null` zolang de verwachting ontbreekt. */
  estimatedTotaal: Decimal | null;
  /** `estimatedTotaal - begrotingTotaal`, of `null` zolang `estimatedTotaal` onbekend is. */
  afwijking: Decimal | null;
}

export interface EstimatedLeegstandResultaat {
  perCategorie: EstimatedLeegstandCategorieResultaat[];
  moduleBegrotingTotaal: Decimal;
  moduleWerkelijkTotaal: Decimal;
  /** `null` zolang één of meer categorieën geen `verwachtingResterendJaar` hebben — nooit een gedeeltelijke som voorwenden als compleet. */
  moduleEstimatedTotaal: Decimal | null;
}

/**
 * `verwachtingResterendJaar` per categorie — het niveau waarop Werkelijk zelf
 * bewezen betrouwbaar is (bronproef): per categorie, NIET per complex/regel.
 */
export function berekenEstimatedLeegstand(
  begroting: BgLeegstandResultaat,
  werkelijk: WerkelijkLeegstandResultaat,
  verwachtingPerCategorie: Record<BgLeegstandCategorie, Decimal | null>,
): EstimatedLeegstandResultaat {
  const perCategorie: EstimatedLeegstandCategorieResultaat[] = LEEGSTAND_CATEGORIEEN.map((categorie) => {
    const begrotingTotaal = begroting.perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;
    const werkelijkTotaal = werkelijk.perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;
    const verwachting = verwachtingPerCategorie[categorie];
    const estimatedTotaal = isGeldigDecimal(verwachting) ? werkelijkTotaal.plus(verwachting) : null;
    return {
      categorie,
      begrotingTotaal,
      werkelijkTotaal,
      verwachtingResterendJaar: verwachting,
      estimatedTotaal,
      afwijking: estimatedTotaal !== null ? estimatedTotaal.minus(begrotingTotaal) : null,
    };
  });

  const moduleEstimatedTotaal = perCategorie.every((c) => c.estimatedTotaal !== null) ? som(perCategorie.map((c) => c.estimatedTotaal!)) : null;

  return {
    perCategorie,
    moduleBegrotingTotaal: begroting.moduleTotaal,
    moduleWerkelijkTotaal: werkelijk.moduleTotaal,
    moduleEstimatedTotaal,
  };
}
