import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * Begrote Verzekeringen — OB-032 (2026-09-07): UITSLUITEND de pure
 * rekenlaag, conform het goedgekeurde brononderzoek en de businessbesluiten
 * OB032-001 t/m 013.
 *
 * Architectuurgrens (zelfde als Module 1/2/3/Gepland Onderhoud/Correctief-
 * Dagelijks Onderhoud): geen cache/SQLite/Excel/bestanden/klok/IO/renderer/
 * CLI. Geen koppeling met Boekingen/OGB — het brononderzoek heeft bewezen
 * dat de boekhouding geen betrouwbare polisbron is (geen polisnummer, geen
 * structureel indexpercentage, geen betrouwbare ingangsdatum/looptijd over
 * meerdere complexen heen) — polisgegevens zijn daarom uitsluitend
 * expliciete begrotingsinvoer, nooit uit Boekingen afgeleid.
 *
 * DRIE REGIMES VOOR "BEDRAG" (OB032-003, gecorrigeerd na review): `bedrag`
 * is ALTIJD de huidige jaarpremie die geldt VOORDAT een eventueel relevant
 * verleng-/indexatiemoment optreedt — nooit gedeeld/vermenigvuldigd met
 * `looptijdMaanden` (dat bepaalt uitsluitend het verlengritme, niet de
 * financiële periodiciteit van `bedrag`). Per regel geldt één van drie
 * regimes, bepaald door de kalenderjaarpositie van `ingangsdatum` t.o.v.
 * `begrotingsjaar`:
 *
 * A. Polis bestaat al vóór het begrotingsjaar (ingangsdatum-jaar <
 *    begrotingsjaar): `bedrag` geldt vanaf januari; een relevant
 *    verlengmoment ín het begrotingsjaar kan vanaf die maand indexatie
 *    activeren.
 * B. Polis gaat in tíjdens het begrotingsjaar (ingangsdatum-jaar ===
 *    begrotingsjaar): vóór de ingangsmaand geldt €0 (de polis bestond nog
 *    niet), vanaf de ingangsmaand geldt `bedrag`. De ingangsdatum zelf is
 *    NOOIT een verlengmoment (OB032-001/Correctie 1) — alleen een
 *    daadwerkelijk latere contractuele verlenging (zie hieronder) kan
 *    binnen hetzelfde jaar nog indexatie activeren.
 * C. Polis gaat pas ná het begrotingsjaar in (ingangsdatum-jaar >
 *    begrotingsjaar): `berekendBegroot` is €0 voor dit begrotingsjaar. Dit
 *    is een GELDIGE berekening, GEEN KRITIEK uitsluitend vanwege een
 *    toekomstige ingangsdatum (Correctie: "toekomstige geldige
 *    ingangsdatum is op zichzelf geen KRITIEK").
 *
 * VERLENGMOMENTEN ZIJN NOOIT DE INGANGSDATUM ZELF (OB032-004/Correctie 2):
 * de contractuele verlengcyclus wordt gezocht vanaf `ingangsdatum +
 * looptijdMaanden`, `ingangsdatum + 2×looptijdMaanden`, enzovoort — NOOIT
 * vanaf `ingangsdatum + 0×looptijdMaanden` (dat zou de ingang zelf als
 * "verlenging" behandelen). Zie `bepaalRelevanteVerlengmomenten` hieronder.
 * Deze zoekfunctie is REGIME-ONAFHANKELIJK: voor regime B levert hij
 * vanzelf een lege lijst op zolang de eerste werkelijke verlenging nog niet
 * in hetzelfde begrotingsjaar valt (het gebruikelijke geval bij een
 * jaarpolis die medio het jaar ingaat), en voor regime C altijd een lege
 * lijst (de polis, laat staan haar verlengingen, ligt nog verder in de
 * toekomst).
 *
 * MEERDERE VERLENGMOMENTEN, GEEN CUMULATIEVE INDEXATIE (OB032-004/005):
 * bij een `looptijdMaanden` korter dan twaalf kunnen meerdere
 * verlengmomenten binnen hetzelfde begrotingsjaar vallen — dat wordt NIET
 * kunstmatig beperkt. Alléén het EERSTE relevante verlengmoment activeert
 * `indexPercentage` voor dit begrotingsjaar; een eventueel tweede/derde
 * moment binnen hetzelfde jaar verhoogt de premie NIET nogmaals.
 * `relevanteVerlengmomenten` (het volledige, ongekapte resultaat van de
 * zoekfunctie) blijft als pure-calculator-output zichtbaar voor
 * traceerbaarheid, ook al draagt alleen het eerste element financieel bij.
 *
 * MAANDNAUWKEURIGHEID (OB032-006): dezelfde "de maand van de datum zelf
 * hoort al bij de nieuwe waarde"-conventie als Module 1/3 wordt HERGEBRUIKT
 * omdat de businessbetekenis identiek is (een gebeurtenis op dag X van
 * maand M betekent dat maand M al de nieuwe waarde krijgt) — de
 * dag-geklemde maand-rekenkunde (`addMaandenUTC` hieronder) is een
 * ONAFHANKELIJKE, eigen implementatie (geen import uit
 * `begroteHuuropbrengsten.ts`), want die functies zijn daar niet
 * geëxporteerd en de eigenlijke verlengmoment-zoeklogica (meerdere
 * kalendercycli, ingangsdatum nooit een verlengmoment) is zelf wél
 * volledig OB-032-specifiek — zelfde precedent als Module 3, die ook geen
 * Module-1-code hergebruikte ondanks een vergelijkbaar indexatieconcept.
 *
 * COMPLEX IS VERPLICHT MAAR BLOKKEERT HET BEDRAG NIET (OB032-002): een
 * ontbrekend/leeg complexnummer geeft een KRITIEK-control (anders dan
 * Correctief/Dagelijks Onderhoud, waar `null` een structureel geldige
 * NTB-eindstatus is) — maar de financiële bijdrage van de regel verdwijnt
 * daardoor niet stil (zelfde "functioneel onvolledig ≠ financieel
 * onberekenbaar"-principe als elders). Hetzelfde geldt voor `verzekeraar`
 * (OB032-009).
 *
 * VIER REKENKRITISCHE VELDEN (OB032-011): `ingangsdatum`, `looptijdMaanden`,
 * `bedrag` en `indexPercentage` zijn — anders dan `complexnummer`/
 * `verzekeraar` — daadwerkelijk nodig OM te kunnen rekenen. Ontbreekt of is
 * ongeldig één van deze vier, dan is de volledige regelberekening
 * onmogelijk: `berekendBegroot` wordt een veilige `Decimal(0)`, met behoud
 * van de KRITIEK-control (nooit stilzwijgend als bewuste €0
 * interpreteerbaar — vaststellen blijft geblokkeerd, zie `vaststellen.ts`).
 *
 * OVERRIDE (OB032-008): `handmatigBegrootOverride: Decimal | null` naast
 * `berekendBegroot` — `effectiefBegroot` is de override indien aanwezig en
 * geldig, anders `berekendBegroot`. Een expliciete `Decimal(0)`-override is
 * geldig en wint van een positieve `berekendBegroot`. Een NaN-override
 * wordt genegeerd (KRITIEK, `effectiefBegroot` valt terug op
 * `berekendBegroot`) — de override overschrijft de berekening nooit stil.
 *
 * REVIEW/BEOORDEELD (OB032-001): zelfde onafhankelijke-dimensie-principe
 * als Gepland Onderhoud/Correctief-Dagelijks Onderhoud — `beoordeeld` is
 * pure doorgegeven invoer, nooit afgeleid uit `regels.length` of uit de
 * aanwezigheid van KRITIEKE controls. Eigen naamgeving
 * (`REVIEWED_ZERO_POLICIES`/`REVIEWED_WITH_POLICIES`), geen hergebruik van
 * de Onderhoud-namen (bewust, per OB032-001: dit is een zelfstandige
 * heroverweging, geen automatische overname van het GO/CD-model).
 *
 * BUITEN SCOPE (deze fase, expliciet niet gebouwd — geen aanname): polis-
 * bron/import, automatische polisafleiding uit Boekingen, realisatie-
 * calculator, Estimated, P&L-rendering, UI, polisnummer, notities,
 * kwartaalinvoer, OGB als polisinput, `perComplex`-aggregatie (niet
 * aantoonbaar nodig, zie OB032-012).
 */

export type BgVerzekeringControleErnst = BgControleErnst;

export interface BgVerzekeringControleItem {
  /** Positie van de betrokken regel in de invoerlijst van deze aanroep — `null` = module-breed, niet aan één regel toe te wijzen. */
  regelIndex: number | null;
  ernst: BgVerzekeringControleErnst;
  bericht: string;
}

export interface BgVerzekeringRegelInvoer {
  /** `null` = NTB — nog steeds functioneel VERPLICHT voor een geldige, vast te stellen regel (OB032-002); `null` geeft KRITIEK maar blokkeert de berekening niet. */
  complexnummer: string | null;
  /** `null` = nog niet ingevuld (OB032-009) — KRITIEK, blokkeert de berekening niet. */
  verzekeraar: string | null;
  /** `null` = nog niet ingevuld — rekenkritisch veld, KRITIEK + veilige 0-bijdrage (OB032-011). */
  ingangsdatum: Date | null;
  /** Positief geheel aantal maanden. `null`/≤0/niet-geheel = ongeldig — rekenkritisch veld. */
  looptijdMaanden: number | null;
  /** Huidige jaarpremie, geldend vóór een eventueel relevant verleng-/indexatiemoment (OB032-003) — rekenkritisch veld. */
  bedrag: Decimal | null;
  /** Expliciete begrotingsaanname; bron levert dit niet betrouwbaar (OB032-007) — rekenkritisch veld, `0` is een geldige bewuste waarde. */
  indexPercentage: Decimal | null;
  /** `null` = geen override — `berekendBegroot` blijft dan leidend voor `effectiefBegroot`. */
  handmatigBegrootOverride: Decimal | null;
}

export interface BgVerzekeringAannames {
  begrotingsjaar: number;
  beoordeeld: boolean;
}

export type BgVerzekeringReviewStatus = "NOT_REVIEWED" | "REVIEWED_ZERO_POLICIES" | "REVIEWED_WITH_POLICIES";

export interface BgVerzekeringRegelUitkomst {
  index: number;
  /** De oorspronkelijke invoer — traceerbaarheid, inclusief een eventueel ongeldig/ontbrekend rekenkritisch veld. */
  invoer: BgVerzekeringRegelInvoer;
  /** Veilige berekende jaarpremie: `Decimal(0)` zodra één van de vier rekenkritische velden ontbreekt/ongeldig is. */
  berekendBegroot: Decimal;
  /** `invoer.handmatigBegrootOverride` indien aanwezig en geldig (geen NaN), anders `berekendBegroot`. */
  effectiefBegroot: Decimal;
  /** Eerste verlengmoment binnen `begrotingsjaar` dat indexatie activeert — `null` als er geen verlengmoment in dit begrotingsjaar valt (of de rekenkritische velden ontbreken). */
  eersteRelevanteVerlengmoment: Date | null;
  /** ALLE verlengmomenten binnen `begrotingsjaar` (kan leeg, één, of meerdere zijn) — uitsluitend het eerste element draagt financieel bij (OB032-004/005). */
  relevanteVerlengmomenten: Date[];
  /**
   * `relevanteVerlengmomenten.length` — als EIGEN, expliciet veld (code-review-correctie
   * 2026-09-08) zodat het werkelijke aantal onafhankelijk van de volledige datumlijst
   * beschikbaar blijft. Reden: frozen persistence bewaart bewust niet de volledige
   * `relevanteVerlengmomenten`-lijst (zie `frozenVerzekeringResultaat.ts`'s moduledoc), maar
   * het exacte aantal moet ook ná een frozen round-trip behouden blijven — dit veld maakt dat
   * type-safe mogelijk zonder de datumlijst te hoeven reconstrueren.
   */
  aantalRelevanteVerlengmomenten: number;
}

export interface BgVerzekeringResultaat {
  begrotingsjaar: number;
  /** Pure doorgifte van `aannames.beoordeeld` — nooit hier afgeleid. */
  beoordeeld: boolean;
  reviewStatus: BgVerzekeringReviewStatus;
  regels: BgVerzekeringRegelUitkomst[];
  totaalBerekendBegroot: Decimal;
  totaalEffectiefBegroot: Decimal;
  controleVereist: BgVerzekeringControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function leegOfNull(waarde: string | null): boolean {
  return waarde === null || waarde.trim().length === 0;
}

function isGeldigeLooptijd(waarde: number | null): waarde is number {
  return waarde !== null && Number.isInteger(waarde) && waarde > 0;
}

function isGeldigeDatum(waarde: Date | null): waarde is Date {
  return waarde !== null && !Number.isNaN(waarde.getTime());
}

function isGeldigDecimal(waarde: Decimal | null): waarde is Decimal {
  return waarde !== null && !waarde.isNaN();
}

/**
 * Telt `aantalMaanden` op bij `datum` via gehele-getallen-maandrekenkunde
 * (jaar×12+maand), met de dag geklemd op de laatste dag van de doelmaand
 * als de oorspronkelijke dag daar niet bestaat (31 jan + 1 maand → 28/29
 * feb, nooit stilzwijgend doorlopend naar maart) — zelfde bewezen techniek
 * als Module 1's `addMaandenUTC`, hier onafhankelijk geïmplementeerd (zie
 * moduledoc).
 */
function addMaandenUTC(datum: Date, aantalMaanden: number): Date {
  const jaarMaandIndex = datum.getUTCFullYear() * 12 + datum.getUTCMonth() + aantalMaanden;
  const doelJaar = Math.floor(jaarMaandIndex / 12);
  const doelMaand0 = jaarMaandIndex - doelJaar * 12;
  const laatsteDagVanDoelMaand = new Date(Date.UTC(doelJaar, doelMaand0 + 1, 0)).getUTCDate();
  const dag = Math.min(datum.getUTCDate(), laatsteDagVanDoelMaand);
  return new Date(Date.UTC(doelJaar, doelMaand0, dag));
}

/** Defensieve iteratiegrens — voorkomt een oneindige lus bij een intern inconsistente aanroep; bij bewezen geldige invoer (looptijdMaanden > 0) ruimschoots voldoende voor elk realistisch begrotingsjaarverschil. */
const MAX_ITERATIES = 2000;

/**
 * Bepaalt ALLE contractuele verlengmomenten van een polis die binnen
 * `begrotingsjaar` vallen — gezocht vanaf `ingangsdatum + 1×looptijdMaanden`,
 * `ingangsdatum + 2×looptijdMaanden`, enzovoort. De ingangsdatum ZELF wordt
 * nooit als verlengmoment meegeteld (OB032-004/Correctie 2) — dat is
 * waarom de zoekreeks bij `k = 1` begint, niet bij `k = 0`.
 *
 * ELKE OCCURRENCE WORDT RECHTSTREEKS VANUIT DE ORIGINELE `ingangsdatum`
 * BEREKEND (`addMaandenUTC(ingangsdatum, k × looptijdMaanden)`) — NOOIT
 * vanaf de vorige, mogelijk al geklemde kandidaat (code-review-correctie
 * 2026-09-08). Een vorige-kandidaat-als-basis zou bij een dag die niet in
 * elke doelmaand bestaat (bv. ingangsdatum 31 januari, looptijd 1 maand)
 * een KETTING van steeds verder driftende klemmingen veroorzaken: de eerste
 * stap klemt 31 januari + 1 maand af op 28 februari, en een volgende stap
 * VANAF DIE GEKLEMDE 28e zou een contractueel onjuiste 28 maart opleveren
 * in plaats van de correcte 31 maart (het contract loopt nog steeds af op
 * de 31e van elke looptijd-maand, de februari-klemming is een eenmalig
 * kalenderfeit, geen nieuwe contractdag). Door iedere `k` onafhankelijk
 * vanaf de ongewijzigde `ingangsdatum` te berekenen, is elke klemming
 * geïsoleerd en herstelt de eerstvolgende occurrence automatisch naar de
 * oorspronkelijke dag-van-de-maand zodra de doelmaand die dag weer heeft.
 *
 * Regime-onafhankelijk (zie moduledoc): deze functie hoeft niet te weten of
 * `ingangsdatum` vóór, in, of ná `begrotingsjaar` ligt — voor elk van die
 * gevallen levert de zoekreeks vanzelf de juiste (mogelijk lege)
 * verzameling op.
 */
export function bepaalRelevanteVerlengmomenten(ingangsdatum: Date, looptijdMaanden: number, begrotingsjaar: number): Date[] {
  const momenten: Date[] = [];
  let k = 1;
  let kandidaat = addMaandenUTC(ingangsdatum, k * looptijdMaanden);
  let iteraties = 0;

  while (kandidaat.getUTCFullYear() < begrotingsjaar && iteraties < MAX_ITERATIES) {
    k += 1;
    kandidaat = addMaandenUTC(ingangsdatum, k * looptijdMaanden);
    iteraties += 1;
  }
  while (kandidaat.getUTCFullYear() === begrotingsjaar && iteraties < MAX_ITERATIES) {
    momenten.push(kandidaat);
    k += 1;
    kandidaat = addMaandenUTC(ingangsdatum, k * looptijdMaanden);
    iteraties += 1;
  }

  return momenten;
}

function valideerRegel(invoer: BgVerzekeringRegelInvoer, index: number): BgVerzekeringControleItem[] {
  const controleVereist: BgVerzekeringControleItem[] = [];
  const meld = (bericht: string, ernst: BgVerzekeringControleErnst = "KRITIEK") => controleVereist.push({ regelIndex: index, ernst, bericht });

  if (leegOfNull(invoer.complexnummer)) {
    meld(`Regel ${index}: complexnummer ontbreekt — verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
  }
  if (leegOfNull(invoer.verzekeraar)) {
    meld(`Regel ${index}: verzekeraar ontbreekt — verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
  }
  if (!isGeldigeDatum(invoer.ingangsdatum)) {
    meld(`Regel ${index}: ingangsdatum ontbreekt of is ongeldig — berekening niet mogelijk, veilige bijdrage 0 toegepast.`);
  }
  if (!isGeldigeLooptijd(invoer.looptijdMaanden)) {
    meld(`Regel ${index}: looptijdMaanden ontbreekt, is geen geheel getal, of is niet positief — berekening niet mogelijk, veilige bijdrage 0 toegepast.`);
  }
  if (invoer.bedrag === null) {
    meld(`Regel ${index}: bedrag ontbreekt — berekening niet mogelijk, veilige bijdrage 0 toegepast.`);
  } else if (invoer.bedrag.isNaN()) {
    meld(`Regel ${index}: bedrag is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
  } else if (invoer.bedrag.isNegative()) {
    meld(`Regel ${index}: bedrag is negatief (${invoer.bedrag.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
  }
  if (invoer.indexPercentage === null) {
    meld(`Regel ${index}: indexPercentage ontbreekt — berekening niet mogelijk, veilige bijdrage 0 toegepast.`);
  } else if (invoer.indexPercentage.isNaN()) {
    meld(`Regel ${index}: indexPercentage is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
  } else if (invoer.indexPercentage.isNegative()) {
    meld(`Regel ${index}: indexPercentage is negatief (${invoer.indexPercentage.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
  }
  if (invoer.handmatigBegrootOverride !== null) {
    if (invoer.handmatigBegrootOverride.isNaN()) {
      meld(`Regel ${index}: handmatigBegrootOverride is geen geldig getal (NaN) — override genegeerd, berekendBegroot blijft leidend.`);
    } else if (invoer.handmatigBegrootOverride.isNegative()) {
      meld(`Regel ${index}: handmatigBegrootOverride is negatief (${invoer.handmatigBegrootOverride.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
    }
  }

  return controleVereist;
}

function berekenJaarpremie(
  ingangsdatum: Date,
  looptijdMaanden: number,
  bedrag: Decimal,
  indexPercentage: Decimal,
  begrotingsjaar: number,
): { berekendBegroot: Decimal; eersteRelevanteVerlengmoment: Date | null; relevanteVerlengmomenten: Date[] } {
  const relevanteVerlengmomenten = bepaalRelevanteVerlengmomenten(ingangsdatum, looptijdMaanden, begrotingsjaar);
  const eersteRelevanteVerlengmoment = relevanteVerlengmomenten[0] ?? null;
  const geïndexeerdVanafMaand = eersteRelevanteVerlengmoment !== null ? eersteRelevanteVerlengmoment.getUTCMonth() + 1 : null;

  const ingangsdatumJaar = ingangsdatum.getUTCFullYear();
  const ingangsMaand = ingangsdatum.getUTCMonth() + 1;
  const indexFactor = new Decimal(1).plus(indexPercentage.dividedBy(100));

  // Tel per categorie het AANTAL maanden (geen Decimal-deling per maand) en deel pas HELEMAAL AAN HET EIND
  // één keer door 12 — twaalf losse `/12`-delingen en die weer optellen zou bij een niet-exact-door-12-deelbaar
  // bedrag (bv. 100.10) een repeterende-breuk-afrondingsfout opstapelen die de som niet meer exact op het
  // oorspronkelijke bedrag laat uitkomen (bewezen met een falende Decimal-exactheidstest tijdens implementatie).
  let aantalBasisMaanden = 0;
  let aantalGeïndexeerdeMaanden = 0;
  for (let maand = 1; maand <= 12; maand += 1) {
    const polisBestaatNogNietDezeMaand = ingangsdatumJaar > begrotingsjaar || (ingangsdatumJaar === begrotingsjaar && maand < ingangsMaand);
    if (polisBestaatNogNietDezeMaand) continue; // telt mee als €0, geen bijdrage aan teller nodig.
    const geïndexeerd = geïndexeerdVanafMaand !== null && maand >= geïndexeerdVanafMaand;
    if (geïndexeerd) aantalGeïndexeerdeMaanden += 1;
    else aantalBasisMaanden += 1;
  }

  const teller = new Decimal(aantalBasisMaanden).times(bedrag).plus(new Decimal(aantalGeïndexeerdeMaanden).times(bedrag).times(indexFactor));
  const berekendBegroot = teller.dividedBy(12);

  return { berekendBegroot, eersteRelevanteVerlengmoment, relevanteVerlengmomenten };
}

function berekenRegel(
  invoer: BgVerzekeringRegelInvoer,
  index: number,
  begrotingsjaar: number,
): { uitkomst: BgVerzekeringRegelUitkomst; controleVereist: BgVerzekeringControleItem[] } {
  const controleVereist = valideerRegel(invoer, index);

  const rekenvoorwaardenGeldig =
    isGeldigeDatum(invoer.ingangsdatum) && isGeldigeLooptijd(invoer.looptijdMaanden) && isGeldigDecimal(invoer.bedrag) && isGeldigDecimal(invoer.indexPercentage);

  let berekendBegroot: Decimal;
  let eersteRelevanteVerlengmoment: Date | null = null;
  let relevanteVerlengmomenten: Date[] = [];

  if (rekenvoorwaardenGeldig) {
    const resultaat = berekenJaarpremie(
      invoer.ingangsdatum as Date,
      invoer.looptijdMaanden as number,
      invoer.bedrag as Decimal,
      invoer.indexPercentage as Decimal,
      begrotingsjaar,
    );
    berekendBegroot = resultaat.berekendBegroot;
    eersteRelevanteVerlengmoment = resultaat.eersteRelevanteVerlengmoment;
    relevanteVerlengmomenten = resultaat.relevanteVerlengmomenten;
  } else {
    berekendBegroot = new Decimal(0);
  }

  const overrideGeldig = isGeldigDecimal(invoer.handmatigBegrootOverride);
  const effectiefBegroot = overrideGeldig ? (invoer.handmatigBegrootOverride as Decimal) : berekendBegroot;

  return {
    uitkomst: {
      index,
      invoer,
      berekendBegroot,
      effectiefBegroot,
      eersteRelevanteVerlengmoment,
      relevanteVerlengmomenten,
      aantalRelevanteVerlengmomenten: relevanteVerlengmomenten.length,
    },
    controleVereist,
  };
}

export function berekenBegroteVerzekeringen(regelsInvoer: readonly BgVerzekeringRegelInvoer[], aannames: BgVerzekeringAannames): BgVerzekeringResultaat {
  const controleVereist: BgVerzekeringControleItem[] = [];
  const regels: BgVerzekeringRegelUitkomst[] = regelsInvoer.map((invoer, index) => {
    const { uitkomst, controleVereist: meldingen } = berekenRegel(invoer, index, aannames.begrotingsjaar);
    controleVereist.push(...meldingen);
    return uitkomst;
  });

  const totaalBerekendBegroot = som(regels.map((r) => r.berekendBegroot));
  const totaalEffectiefBegroot = som(regels.map((r) => r.effectiefBegroot));

  const reviewStatus: BgVerzekeringReviewStatus = !aannames.beoordeeld
    ? "NOT_REVIEWED"
    : regels.length === 0
      ? "REVIEWED_ZERO_POLICIES"
      : "REVIEWED_WITH_POLICIES";

  return {
    begrotingsjaar: aannames.begrotingsjaar,
    beoordeeld: aannames.beoordeeld,
    reviewStatus,
    regels,
    totaalBerekendBegroot,
    totaalEffectiefBegroot,
    controleVereist,
  };
}
