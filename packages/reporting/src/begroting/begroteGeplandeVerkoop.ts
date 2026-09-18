import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * Geplande verkoop — OB-039 (2026-09-11): UITSLUITEND de pure rekenlaag,
 * conform de goedgekeurde OB-039-bronfase (bronproef 023, GL 08830/00166/
 * 00167, boekjaar 2026 periode 04) en de daaropvolgende businessbesluiten.
 *
 * PRIMAIR EEN BUSINESS-PLANNINGSMODULE, GEEN VERKOOPREGISTER: de bronfase
 * toonde geen betrouwbare structurele bron voor geplande verkoopdatum,
 * verwachte verkoopprijs, boekwaarde, verkoopkosten of een generiek gekoppeld
 * boekhoudkundig verkoopresultaat. Deze module bouwt daarom GEEN
 * object-sale-master en GEEN leningmaster-achtige structuur — uitsluitend
 * handmatige planningsregels + een rekenhulp op de handmatige bedragen.
 *
 * GEEN CATEGORIEËN (bewust anders dan Leegstand/Rente): "geplande verkoop" is
 * één homogene regelsoort — één module-brede `beoordeeld`-vlag (zelfde
 * patroon als Correctief/Dagelijks Onderhoud OB-028), geen categoriedimensie.
 *
 * ONBEKEND BLIJFT ONBEKEND — GEEN VEILIGE 0-BIJDRAGE VOOR BEDRAGEN (bewust
 * ANDERS dan alle eerdere Begroting-modules): `verwachteVerkoopopbrengst`/
 * `verwachteBoekwaarde`/`verwachteVerkoopkosten` zijn en blijven `null` zolang
 * niet ingevuld — GEEN `Decimal(0)`-fallback, ook niet voor een totaal (zie
 * hieronder). Reden: een geplande verkoop mag bewust bestaan zonder volledig
 * verwacht verkoopresultaat (OB039-008) — een fallback naar 0 zou een
 * verwacht verlies/winst van €0 SUGGEREREN waar in werkelijkheid niets bekend
 * is; dat is precies de schijnzekerheid die voorkomen moet worden.
 *
 * `objectreferentie`/`omschrijving`/`geplandeVerkoopdatum` zijn WEL verplicht
 * (KRITIEK bij ontbreken) — dit zijn de drie velden die zonder "optionele"
 * te zijn opgesomd staan in de businessbesluiten. `objectreferentie` is
 * bewust een vrij tekstveld (GEEN gevalideerde/gejoinde complexnummer-
 * koppeling met de units-cache) — het bronproef toonde dat een verkoop niet
 * altijd een gevuld, cache-bekend complexnummer draagt (bv. de
 * Hoofdstraat-transactie in het 023-bronproef had geen enkel complexnummer
 * ingevuld) en dat "welk object" soms alleen uit vrije tekst blijkt.
 *
 * GEEN TOTAAL/MODULETOTAAL (bewuste, structurele afwezigheid — ANDERS dan
 * elke eerdere Begroting-module): een naïeve som van `verwachtVerkoopresultaat`
 * over alle regels zou regels met een onbekend (`null`) resultaat stilzwijgend
 * als €0 moeten behandelen om te kunnen sommeren — exact de schijnzekerheid
 * die OB039-008 verbiedt. Per regel tonen, nooit optellen tot één
 * portefeuillecijfer, is hier de bewuste ontwerpkeuze.
 *
 * REKENHULP PER REGEL: `verwachtVerkoopresultaat = verwachteVerkoopopbrengst -
 * verwachteBoekwaarde - verwachteVerkoopkosten`, UITSLUITEND wanneer alle drie
 * bekend EN geldig zijn — anders `null` (nooit een gedeeltelijke berekening).
 * Dit is een rekenhulp/begrotingsresultaat op basis van handmatige invoer,
 * GEEN bronmatig vastgesteld boekhoudkundig resultaat (OB039-002).
 *
 * `verwachteEinddatumHuurExploitatie` is UITSLUITEND een planningssignaal
 * (OB039-003) — deze module leest, valideert of muteert NOOIT Module 1/
 * huurcontracten/Leegstand. Een latere UX-laag mag hiermee signaleren
 * ("Verkoop/einde exploitatie gepland vanaf datum X — controleer
 * huurprognose/leegstandskosten"), maar die signaaltekst is presentatie, geen
 * onderdeel van deze rekenlaag.
 *
 * ESTIMATED HERGEBRUIKT DEZELFDE FUNCTIE (bewust GEEN aparte
 * `berekenEstimatedGeplandeVerkoop`): anders dan OB-030/031/037/038 (waar
 * Estimated = Werkelijk-tot-nu-toe + handmatige verwachting resterend jaar)
 * is Estimated hier conceptueel een TWEEDE, onafhankelijk bijgewerkte set
 * planningsregels met exact dezelfde vorm/rekenhulp als de Begrotingsregels
 * (OB039-006) — dezelfde `berekenBegroteGeplandeVerkoop` wordt door de
 * aanroeper twee keer gebruikt: één keer op de CONCEPT-Begrotingsregels, één
 * keer op de apart gepersisteerde, nooit-bevroren Estimated-regels (zie
 * `@bvc/begroting-data`). Begroting wordt door Estimated nooit aangepast.
 *
 * WERKELIJK (`berekenWerkelijkGeplandeVerkoop`) — TWEE ONAFHANKELIJKE
 * CLASSIFICATIEBRONNEN PER ADMINISTRATIE (2026-09-11-correctie, ná eerdere
 * eindrapport-controle): elke boeking wordt eerst geprobeerd via OGB-
 * kostensoort (`ogbClassificatie`), en — ALLEEN als er geen OGB-kostensoort
 * aanwezig is óf de aanwezige code onbekend is — via grootboekrekening
 * (`grootboekClassificatie`). Reden: het 023-bronproef toonde dat GL 08830
 * "Opbrengst verkoop pand" op BEIDE geconstateerde regels GEEN
 * OGB-kostensoort droeg — een zuiver OGB-gebaseerde classificatie zou
 * VERKOOPOPBRENGST voor die administratie dus NOOIT herkennen, wat de
 * aanvankelijke (onjuiste) eindrapportclaim "Werkelijk loopt via OGB-
 * classificatie" tegensprak. Zowel OGB- als GL-classificatie zijn per
 * aanroep AL voor de juiste administratie geresolved (bedrijfsnr-scoped,
 * `@bvc/begroting-data`) — GEEN portfolio-brede GL-/OGB-betekenis, exact
 * hetzelfde principe als Rente/Leegstand.
 *
 * VERKOOPOPBRENGST en BOEKWAARDE_AFBOEKING blijven twee STRIKT GESCHEIDEN
 * componenten, NOOIT tot één "gerealiseerd verkoopresultaat" opgeteld, en
 * NOOIT automatisch aan elkaar gekoppeld: elke boeking wordt volledig
 * onafhankelijk van elke andere boeking geclassificeerd. Het bronproef
 * bewees waarom een automatische koppeling niet zou kloppen: twee
 * onafhankelijke verkopen (Hoofdstraat/Driebergen) deelden dezelfde
 * grootboekrekening én periode; boekstukSleutel bewees welke regels bij
 * elkaar hoorden, maar geen enkele regel bevatte zowel een opbrengst- als een
 * boekwaardecomponent voor dezelfde transactie — er bestaat dus GEEN vaste,
 * generieke GL-paarregel ("opbrengst-GL X hoort altijd bij boekwaarde-GL Y")
 * om een resultaat automatisch te construeren. GEEN vrije-tekstherkenning
 * van pand/verkoop, GEEN boekstukSleutel-gebaseerde automatische koppeling —
 * boekstukSleutel blijft uitsluitend bewijs/onderbouwing, nooit een
 * classificatieregel.
 *
 * BUITEN SCOPE (expliciet, geen aanname): object-sale-master/verkoopregister,
 * automatische Module1/huurcontract/Leegstand-mutatie, automatische
 * Werkelijk-verkoopresultaatberekening, generieke GL-paarkoppeling,
 * boekstukSleutel-gebaseerde classificatie, persistence/frozen-lifecycle (zie
 * `@bvc/begroting-data`), UI/rendering/signaaltekst.
 */

export type BgGeplandeVerkoopControleErnst = BgControleErnst;

export interface BgGeplandeVerkoopControleItem {
  /** Positie van de betrokken regel in de invoerlijst van deze aanroep — `null` = module-breed, niet aan één regel toe te wijzen. */
  regelIndex: number | null;
  ernst: BgGeplandeVerkoopControleErnst;
  bericht: string;
}

// ── Begroting / Estimated (zelfde vorm, zie moduledoc) ─────────────────────

export interface BgGeplandeVerkoopRegelInvoer {
  /** Vrij tekstveld — GEEN gevalideerde/gejoinde complexnummer-koppeling (zie moduledoc). Verplicht. */
  objectreferentie: string;
  omschrijving: string;
  /** `null` = nog niet ingevuld — verplicht voor vaststellen (OB039-002). */
  geplandeVerkoopdatum: Date | null;
  /** `null` = onbekend, GEEN `Decimal(0)`-fallback (OB039-008). */
  verwachteVerkoopopbrengst: Decimal | null;
  verwachteBoekwaarde: Decimal | null;
  verwachteVerkoopkosten: Decimal | null;
  /** Puur planningssignaal (OB039-003) — nooit gevalideerd, nooit gebruikt om Module1/Leegstand te muteren. */
  verwachteEinddatumHuurExploitatie: Date | null;
  toelichting: string | null;
}

export interface BgGeplandeVerkoopAannames {
  begrotingsjaar: number;
  beoordeeld: boolean;
}

export type BgGeplandeVerkoopReviewStatus = "NOT_REVIEWED" | "REVIEWED_ZERO_RULES" | "REVIEWED_WITH_RULES";

export interface BgGeplandeVerkoopRegelUitkomst {
  index: number;
  invoer: BgGeplandeVerkoopRegelInvoer;
  /** `opbrengst - boekwaarde - kosten`, UITSLUITEND wanneer alle drie bekend+geldig zijn — anders `null` (nooit gedeeltelijk, nooit 0 als fallback). */
  verwachtVerkoopresultaat: Decimal | null;
}

export interface BgGeplandeVerkoopResultaat {
  begrotingsjaar: number;
  /** Pure doorgifte van `aannames.beoordeeld` — nooit hier afgeleid. */
  beoordeeld: boolean;
  reviewStatus: BgGeplandeVerkoopReviewStatus;
  regels: BgGeplandeVerkoopRegelUitkomst[];
  /** GEEN totaal/moduleTotaal — zie moduledoc (schijnzekerheid voorkomen). */
  controleVereist: BgGeplandeVerkoopControleItem[];
}

function leeg(waarde: string): boolean {
  return waarde.trim().length === 0;
}

function isGeldigDecimal(waarde: Decimal | null): waarde is Decimal {
  return waarde !== null && !waarde.isNaN();
}

function isGeldigeDatum(waarde: Date | null): waarde is Date {
  return waarde !== null && !Number.isNaN(waarde.getTime());
}

function valideerRegel(invoer: BgGeplandeVerkoopRegelInvoer, index: number): BgGeplandeVerkoopControleItem[] {
  const controleVereist: BgGeplandeVerkoopControleItem[] = [];
  const meld = (bericht: string, ernst: BgGeplandeVerkoopControleErnst = "KRITIEK") => controleVereist.push({ regelIndex: index, ernst, bericht });

  if (leeg(invoer.objectreferentie)) {
    meld(`Regel ${index}: objectreferentie ontbreekt — verplicht voor vaststellen.`);
  }
  if (leeg(invoer.omschrijving)) {
    meld(`Regel ${index}: omschrijving ontbreekt — verplicht voor vaststellen.`);
  }
  if (invoer.geplandeVerkoopdatum === null) {
    meld(`Regel ${index}: geplande verkoopdatum ontbreekt — verplicht voor vaststellen.`);
  } else if (!isGeldigeDatum(invoer.geplandeVerkoopdatum)) {
    meld(`Regel ${index}: geplande verkoopdatum is geen geldige datum.`);
  }

  if (invoer.verwachteVerkoopopbrengst !== null) {
    if (invoer.verwachteVerkoopopbrengst.isNaN()) {
      meld(`Regel ${index}: verwachte verkoopopbrengst is geen geldig getal (NaN) — verwacht verkoopresultaat niet berekend.`);
    } else if (invoer.verwachteVerkoopopbrengst.isNegative()) {
      meld(`Regel ${index}: verwachte verkoopopbrengst is negatief (${invoer.verwachteVerkoopopbrengst.toString()}) — ongebruikelijk, wel toegestaan.`, "WAARSCHUWING");
    }
  }
  if (invoer.verwachteBoekwaarde !== null) {
    if (invoer.verwachteBoekwaarde.isNaN()) {
      meld(`Regel ${index}: verwachte boekwaarde is geen geldig getal (NaN) — verwacht verkoopresultaat niet berekend.`);
    } else if (invoer.verwachteBoekwaarde.isNegative()) {
      meld(`Regel ${index}: verwachte boekwaarde is negatief (${invoer.verwachteBoekwaarde.toString()}) — ongebruikelijk, wel toegestaan.`, "WAARSCHUWING");
    }
  }
  if (invoer.verwachteVerkoopkosten !== null) {
    if (invoer.verwachteVerkoopkosten.isNaN()) {
      meld(`Regel ${index}: verwachte verkoopkosten is geen geldig getal (NaN) — verwacht verkoopresultaat niet berekend.`);
    } else if (invoer.verwachteVerkoopkosten.isNegative()) {
      meld(`Regel ${index}: verwachte verkoopkosten is negatief (${invoer.verwachteVerkoopkosten.toString()}) — ongebruikelijk, wel toegestaan.`, "WAARSCHUWING");
    }
  }

  return controleVereist;
}

function berekenVerwachtVerkoopresultaat(invoer: BgGeplandeVerkoopRegelInvoer): Decimal | null {
  if (!isGeldigDecimal(invoer.verwachteVerkoopopbrengst) || !isGeldigDecimal(invoer.verwachteBoekwaarde) || !isGeldigDecimal(invoer.verwachteVerkoopkosten)) {
    return null;
  }
  return invoer.verwachteVerkoopopbrengst.minus(invoer.verwachteBoekwaarde).minus(invoer.verwachteVerkoopkosten);
}

export function berekenBegroteGeplandeVerkoop(
  regelsInvoer: readonly BgGeplandeVerkoopRegelInvoer[],
  aannames: BgGeplandeVerkoopAannames,
): BgGeplandeVerkoopResultaat {
  const controleVereist: BgGeplandeVerkoopControleItem[] = [];
  const regels: BgGeplandeVerkoopRegelUitkomst[] = regelsInvoer.map((invoer, index) => {
    controleVereist.push(...valideerRegel(invoer, index));
    return { index, invoer, verwachtVerkoopresultaat: berekenVerwachtVerkoopresultaat(invoer) };
  });

  const reviewStatus: BgGeplandeVerkoopReviewStatus = !aannames.beoordeeld
    ? "NOT_REVIEWED"
    : regels.length === 0
      ? "REVIEWED_ZERO_RULES"
      : "REVIEWED_WITH_RULES";

  return {
    begrotingsjaar: aannames.begrotingsjaar,
    beoordeeld: aannames.beoordeeld,
    reviewStatus,
    regels,
    controleVereist,
  };
}

// ── Werkelijk ────────────────────────────────────────────────────────────

export const GEPLANDE_VERKOOP_COMPONENTEN = ["VERKOOPOPBRENGST", "BOEKWAARDE_AFBOEKING"] as const;
export type BgGeplandeVerkoopComponent = (typeof GEPLANDE_VERKOOP_COMPONENTEN)[number];

/**
 * Eén regel van de lokale geplande-verkoop-OGB-classificatie (OGB-kostensoort
 * → component), ADMINISTRATIE-SPECIFIEK geresolved en als pure invoer
 * aangeleverd — deze module leest of query't zelf nooit een
 * classificatieconfig/database.
 */
export interface GeplandeVerkoopClassificatieRegel {
  ogbKostensoort: string;
  ogbKostensoortOmschrijving: string;
  component: BgGeplandeVerkoopComponent;
}

/**
 * Eén regel van de lokale geplande-verkoop-GL-classificatie
 * (grootboekrekening → component), ADMINISTRATIE-SPECIFIEK geresolved en als
 * pure invoer aangeleverd (2026-09-11-correctie op de aanvankelijke
 * eindrapportclaim, zie moduledoc). Bewezen nodig: het 023-bronproef toonde
 * dat GL 08830 "Opbrengst verkoop pand" op BEIDE geconstateerde regels GEEN
 * OGB-kostensoort droeg — zonder een GL-classificatiebron zou
 * VERKOOPOPBRENGST voor die administratie dus NOOIT werkelijk-classificeerbaar
 * zijn, ondanks de eerder gedane belofte dat OGB-classificatie zou volstaan.
 * GEEN portfolio-brede betekenis (zelfde bedrijfsnr-scoping als de
 * OGB-classificatie hierboven) en GEEN koppeling met de OGB-classificatie —
 * de twee bronnen worden onafhankelijk per boeking geprobeerd, zie
 * `berekenWerkelijkGeplandeVerkoop`.
 */
export interface GeplandeVerkoopGrootboekClassificatieRegel {
  grootboekrekening: string;
  grootboekOmschrijving: string;
  component: BgGeplandeVerkoopComponent;
}

/**
 * Eén reeds-geselecteerde boeking (Werkelijk) — `saldo` is al door de
 * aanroeper correct bepaald (debet - credit, CAL-FIN-001). `grootboekrekening`
 * is, anders dan `ogbKostensoort`, altijd aanwezig — een boeking staat per
 * definitie op een grootboekrekening.
 */
export interface WerkelijkGeplandeVerkoopBoekingRegel {
  grootboekrekening: string;
  /** `null` = geen OGB-kostensoort op de boeking — dit betekent NIET automatisch "niet classificeerbaar": de GL-classificatie wordt dan geprobeerd, zie moduledoc. */
  ogbKostensoort: string | null;
  saldo: Decimal;
}

export interface WerkelijkGeplandeVerkoopOgbTotaal {
  ogbKostensoort: string;
  ogbKostensoortOmschrijving: string;
  saldo: Decimal;
  aantalBoekingen: number;
}

export interface WerkelijkGeplandeVerkoopGrootboekTotaal {
  grootboekrekening: string;
  grootboekOmschrijving: string;
  saldo: Decimal;
  aantalBoekingen: number;
}

export interface WerkelijkGeplandeVerkoopComponentResultaat {
  component: BgGeplandeVerkoopComponent;
  componentTotaal: Decimal;
  /** Uitsluitend ter onderbouwing — uitsluitend regels die via een OGB-match zijn geclassificeerd. */
  perOgbKostensoort: WerkelijkGeplandeVerkoopOgbTotaal[];
  /** Uitsluitend ter onderbouwing — uitsluitend regels die via een GL-match zijn geclassificeerd (geen OGB-match gevonden/aanwezig). */
  perGrootboekrekening: WerkelijkGeplandeVerkoopGrootboekTotaal[];
}

export interface WerkelijkGeplandeVerkoopControleItem {
  ernst: BgGeplandeVerkoopControleErnst;
  ogbKostensoort: string | null;
  bericht: string;
}

export interface WerkelijkGeplandeVerkoopResultaat {
  /** Vaste volgorde: `GEPLANDE_VERKOOP_COMPONENTEN`. STRIKT GESCHEIDEN — nooit opgeteld tot één verkoopresultaat (zie moduledoc). */
  perComponent: WerkelijkGeplandeVerkoopComponentResultaat[];
  /** Boekingen die via GEEN van beide classificatiebronnen (OGB of GL) herkend konden worden — NOOIT geraden, NOOIT meegeteld in een component. */
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
  controleVereist: WerkelijkGeplandeVerkoopControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

interface Geclassificeerd {
  regel: WerkelijkGeplandeVerkoopBoekingRegel;
  via: "OGB" | "GL";
}

/**
 * Classificeert boekingen naar component via TWEE onafhankelijke,
 * administratie-specifieke bronnen (2026-09-11-correctie): eerst OGB-
 * kostensoort (indien aanwezig én bekend), anders grootboekrekening (indien
 * bekend). Dit is bewust GEEN generieke portfolio-brede GL-/OGB-betekenis —
 * beide classificatielijsten zijn per aanroep al voor de juiste
 * administratie geresolved, exact zoals `classificatie` dat al deed. GEEN
 * gebruik van boekstukSleutel/vrije tekst als classificatiebron (die blijven
 * uitsluitend bewijs/onderbouwing, zie moduledoc) en GEEN automatische
 * koppeling tussen VERKOOPOPBRENGST- en BOEKWAARDE_AFBOEKING-regels — elke
 * boeking wordt onafhankelijk van elke andere boeking geclassificeerd.
 */
export function berekenWerkelijkGeplandeVerkoop(
  boekingen: readonly WerkelijkGeplandeVerkoopBoekingRegel[],
  ogbClassificatie: readonly GeplandeVerkoopClassificatieRegel[],
  grootboekClassificatie: readonly GeplandeVerkoopGrootboekClassificatieRegel[],
): WerkelijkGeplandeVerkoopResultaat {
  const controleVereist: WerkelijkGeplandeVerkoopControleItem[] = [];
  const perComponentRegels = new Map<BgGeplandeVerkoopComponent, Geclassificeerd[]>(GEPLANDE_VERKOOP_COMPONENTEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkGeplandeVerkoopBoekingRegel[] = [];

  for (const regel of boekingen) {
    const gevondenOgb = regel.ogbKostensoort !== null ? ogbClassificatie.find((c) => c.ogbKostensoort === regel.ogbKostensoort) : undefined;
    if (gevondenOgb !== undefined) {
      perComponentRegels.get(gevondenOgb.component)!.push({ regel, via: "OGB" });
      continue;
    }

    const gevondenGl = grootboekClassificatie.find((c) => c.grootboekrekening === regel.grootboekrekening);
    if (gevondenGl !== undefined) {
      perComponentRegels.get(gevondenGl.component)!.push({ regel, via: "GL" });
      continue;
    }

    nietGeclassificeerd.push(regel);
    const ogbDeel =
      regel.ogbKostensoort === null
        ? "geen OGB-kostensoort"
        : `OGB-kostensoort "${regel.ogbKostensoort}" komt niet voor in de lokale classificatie`;
    controleVereist.push({
      ernst: "WAARSCHUWING",
      ogbKostensoort: regel.ogbKostensoort,
      bericht: `Boeking op grootboekrekening "${regel.grootboekrekening}" (saldo ${regel.saldo.toString()}): ${ogbDeel} en deze grootboekrekening komt niet voor in de lokale GL-classificatie — niet classificeerbaar, buiten alle componenttotalen gehouden.`,
    });
  }

  function ogbTotalen(geclassificeerd: readonly Geclassificeerd[]): WerkelijkGeplandeVerkoopOgbTotaal[] {
    const perOgb = new Map<string, WerkelijkGeplandeVerkoopBoekingRegel[]>();
    for (const { regel, via } of geclassificeerd) {
      if (via !== "OGB") continue;
      const groep = perOgb.get(regel.ogbKostensoort!) ?? [];
      groep.push(regel);
      perOgb.set(regel.ogbKostensoort!, groep);
    }
    return Array.from(perOgb.entries())
      .map(([ogbKostensoort, groep]) => ({
        ogbKostensoort,
        ogbKostensoortOmschrijving: ogbClassificatie.find((c) => c.ogbKostensoort === ogbKostensoort)!.ogbKostensoortOmschrijving,
        saldo: som(groep.map((r) => r.saldo)),
        aantalBoekingen: groep.length,
      }))
      .sort((a, b) => a.ogbKostensoort.localeCompare(b.ogbKostensoort));
  }

  function grootboekTotalen(geclassificeerd: readonly Geclassificeerd[]): WerkelijkGeplandeVerkoopGrootboekTotaal[] {
    const perGl = new Map<string, WerkelijkGeplandeVerkoopBoekingRegel[]>();
    for (const { regel, via } of geclassificeerd) {
      if (via !== "GL") continue;
      const groep = perGl.get(regel.grootboekrekening) ?? [];
      groep.push(regel);
      perGl.set(regel.grootboekrekening, groep);
    }
    return Array.from(perGl.entries())
      .map(([grootboekrekening, groep]) => ({
        grootboekrekening,
        grootboekOmschrijving: grootboekClassificatie.find((c) => c.grootboekrekening === grootboekrekening)!.grootboekOmschrijving,
        saldo: som(groep.map((r) => r.saldo)),
        aantalBoekingen: groep.length,
      }))
      .sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));
  }

  const perComponent: WerkelijkGeplandeVerkoopComponentResultaat[] = GEPLANDE_VERKOOP_COMPONENTEN.map((component) => {
    const geclassificeerd = perComponentRegels.get(component)!;
    return {
      component,
      componentTotaal: som(geclassificeerd.map((g) => g.regel.saldo)),
      perOgbKostensoort: ogbTotalen(geclassificeerd),
      perGrootboekrekening: grootboekTotalen(geclassificeerd),
    };
  });

  return {
    perComponent,
    nietGeclassificeerdTotaal: som(nietGeclassificeerd.map((r) => r.saldo)),
    nietGeclassificeerdAantalBoekingen: nietGeclassificeerd.length,
    controleVereist,
  };
}
