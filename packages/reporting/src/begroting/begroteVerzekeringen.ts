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
 * kwartaalinvoer, `perComplex`-aggregatie (niet aantoonbaar nodig, zie
 * OB032-012).
 *
 * GROOTBOEKREKENING/OGB (Master Contract §6.7 / UX §9.1, toegevoegd 2026-09-24):
 * `grootboekrekening` is VERPLICHT per polisregel en leidend voor de P&L-post;
 * `ogbKostensoort` is OPTIONEEL en onafhankelijk. Zelfde principe als
 * complexnummer/verzekeraar: een ontbrekende grootboekrekening is KRITIEK
 * (blokkeert beoordeling/vaststellen) maar laat het bedrag financieel
 * meetellen. Er is GEEN nieuwe mapping/classificatielogica — uitsluitend de
 * invoervelden zelf; OGB beïnvloedt nooit een bedrag of validatie. (Dit
 * vervangt de eerdere "OGB als polisinput buiten scope"-afbakening van fase
 * OB-032, ingehaald door het vastgestelde UX-contract.)
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
  /** Verplicht, leidend voor de P&L-post (code, nooit omschrijving). Leeg = KRITIEK, bedrag blijft meetellen. */
  grootboekrekening: string;
  /** Optioneel, onafhankelijk van `grootboekrekening` — ontbreken maakt een regel niet ongeldig. */
  ogbKostensoort?: string | null;
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
  if (invoer.grootboekrekening.trim().length === 0) {
    meld(`Regel ${index}: grootboekrekening ontbreekt — verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
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

export type VerzekeringMaandStatus = "NIET_BESTAAND" | "BASIS" | "GEINDEXEERD";

/**
 * Classificeert de twaalf maanden van `begrotingsjaar` voor één polis: bestond de
 * polis al (regime A/B/C, zie moduledoc), en is de maand al geïndexeerd (vanaf de
 * maand van het EERSTE relevante verlengmoment, OB032-004/005). Enige bron van
 * waarheid voor `berekenJaarpremie`, het maandverloop en het resterende-premie-
 * voorstel — nooit een tweede, parallelle maandlogica.
 */
function bepaalMaandStatussen(
  ingangsdatum: Date,
  looptijdMaanden: number,
  begrotingsjaar: number,
): { statussen: VerzekeringMaandStatus[]; eersteRelevanteVerlengmoment: Date | null; relevanteVerlengmomenten: Date[] } {
  const relevanteVerlengmomenten = bepaalRelevanteVerlengmomenten(ingangsdatum, looptijdMaanden, begrotingsjaar);
  const eersteRelevanteVerlengmoment = relevanteVerlengmomenten[0] ?? null;
  const geïndexeerdVanafMaand = eersteRelevanteVerlengmoment !== null ? eersteRelevanteVerlengmoment.getUTCMonth() + 1 : null;

  const ingangsdatumJaar = ingangsdatum.getUTCFullYear();
  const ingangsMaand = ingangsdatum.getUTCMonth() + 1;

  const statussen: VerzekeringMaandStatus[] = [];
  for (let maand = 1; maand <= 12; maand += 1) {
    const polisBestaatNogNietDezeMaand = ingangsdatumJaar > begrotingsjaar || (ingangsdatumJaar === begrotingsjaar && maand < ingangsMaand);
    if (polisBestaatNogNietDezeMaand) {
      statussen.push("NIET_BESTAAND"); // telt mee als €0.
      continue;
    }
    statussen.push(geïndexeerdVanafMaand !== null && maand >= geïndexeerdVanafMaand ? "GEINDEXEERD" : "BASIS");
  }
  return { statussen, eersteRelevanteVerlengmoment, relevanteVerlengmomenten };
}

function indexFactorVan(indexPercentage: Decimal): Decimal {
  return new Decimal(1).plus(indexPercentage.dividedBy(100));
}

/**
 * Teller (vóór deling door 12) van een deelverzameling maanden: aantal BASIS-maanden × bedrag
 * + aantal GEINDEXEERDE maanden × bedrag × indexfactor. Telt AANTALLEN (geen Decimal-deling per
 * maand) en deelt pas aan het eind één keer door 12 — zie de exactheidsmotivatie in
 * `berekenJaarpremie`.
 */
function tellerVoorMaanden(statussen: readonly VerzekeringMaandStatus[], maanden: readonly number[], bedrag: Decimal, indexFactor: Decimal): Decimal {
  let basis = 0;
  let geïndexeerd = 0;
  for (const maand of maanden) {
    const status = statussen[maand - 1];
    if (status === "BASIS") basis += 1;
    else if (status === "GEINDEXEERD") geïndexeerd += 1;
  }
  return new Decimal(basis).times(bedrag).plus(new Decimal(geïndexeerd).times(bedrag).times(indexFactor));
}

const ALLE_MAANDEN: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function berekenJaarpremie(
  ingangsdatum: Date,
  looptijdMaanden: number,
  bedrag: Decimal,
  indexPercentage: Decimal,
  begrotingsjaar: number,
): { berekendBegroot: Decimal; eersteRelevanteVerlengmoment: Date | null; relevanteVerlengmomenten: Date[] } {
  const { statussen, eersteRelevanteVerlengmoment, relevanteVerlengmomenten } = bepaalMaandStatussen(ingangsdatum, looptijdMaanden, begrotingsjaar);

  // Tel per categorie het AANTAL maanden (geen Decimal-deling per maand) en deel pas HELEMAAL AAN HET EIND
  // één keer door 12 — twaalf losse `/12`-delingen en die weer optellen zou bij een niet-exact-door-12-deelbaar
  // bedrag (bv. 100.10) een repeterende-breuk-afrondingsfout opstapelen die de som niet meer exact op het
  // oorspronkelijke bedrag laat uitkomen (bewezen met een falende Decimal-exactheidstest tijdens implementatie).
  const berekendBegroot = tellerVoorMaanden(statussen, ALLE_MAANDEN, bedrag, indexFactorVan(indexPercentage)).dividedBy(12);

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

// ── Maandverloop / kwartalen / resterende-premievoorstel (Master Contract §6.7, 2026-09-24) ──

function heeftRekenbareVelden(invoer: BgVerzekeringRegelInvoer): invoer is BgVerzekeringRegelInvoer & {
  ingangsdatum: Date;
  looptijdMaanden: number;
  bedrag: Decimal;
  indexPercentage: Decimal;
} {
  return isGeldigeDatum(invoer.ingangsdatum) && isGeldigeLooptijd(invoer.looptijdMaanden) && isGeldigDecimal(invoer.bedrag) && isGeldigDecimal(invoer.indexPercentage);
}

export interface BgVerzekeringMaandBedrag {
  /** 1 = januari … 12 = december. */
  maand: number;
  bedrag: Decimal;
  status: VerzekeringMaandStatus;
  /** `true` uitsluitend voor de maand van het EERSTE relevante verlengmoment (de eerste geïndexeerde maand). */
  isEersteIndexatiemaand: boolean;
}

export interface BgVerzekeringMaandverloop {
  maanden: BgVerzekeringMaandBedrag[];
  /** Q1..Q4, elk één keer gedeeld door 12 over het aantal-maanden-teller (zelfde exactheidstechniek als het jaarbedrag). */
  kwartalen: [Decimal, Decimal, Decimal, Decimal];
}

/**
 * CONTROLE-INFORMATIE (UX §9.1: "Maand- en kwartaalbedragen zijn controle-informatie, geen
 * extra invoer"): het maandverloop januari–december en de afgeleide Q1–Q4 van het BEREKENDE
 * VOORSTEL (`berekendBegroot`) van één polis. Een handmatige jaaroverride verandert deze
 * afleiding NIET (de override is een jaarbedrag; er is geen vastgesteld besluit hoe die over
 * maanden zou verdelen — dus bewust geen verdeling verzonnen). `null` zodra één van de vier
 * rekenkritische velden ontbreekt/ongeldig is (onbekend, nooit een stille €0-maandreeks).
 * Herleidt uitsluitend uit dezelfde `bepaalMaandStatussen` als het jaarbedrag; door de deling
 * per maand/kwartaal kan de som van de kwartalen bij niet-terminerende breuken op Decimal-
 * precisieniveau van het jaarbedrag afwijken — het jaarbedrag blijft altijd `berekendBegroot`.
 */
export function berekenVerzekeringMaandverloop(invoer: BgVerzekeringRegelInvoer, begrotingsjaar: number): BgVerzekeringMaandverloop | null {
  if (!heeftRekenbareVelden(invoer)) return null;
  const { statussen, eersteRelevanteVerlengmoment } = bepaalMaandStatussen(invoer.ingangsdatum, invoer.looptijdMaanden, begrotingsjaar);
  const eersteIndexatiemaand = eersteRelevanteVerlengmoment !== null ? eersteRelevanteVerlengmoment.getUTCMonth() + 1 : null;
  const factor = indexFactorVan(invoer.indexPercentage);

  const maanden: BgVerzekeringMaandBedrag[] = ALLE_MAANDEN.map((maand) => ({
    maand,
    bedrag: tellerVoorMaanden(statussen, [maand], invoer.bedrag, factor).dividedBy(12),
    status: statussen[maand - 1]!,
    isEersteIndexatiemaand: eersteIndexatiemaand === maand && statussen[maand - 1] === "GEINDEXEERD",
  }));
  const kwartaal = (eerste: number) => tellerVoorMaanden(statussen, [eerste, eerste + 1, eerste + 2], invoer.bedrag, factor).dividedBy(12);
  return { maanden, kwartalen: [kwartaal(1), kwartaal(4), kwartaal(7), kwartaal(10)] };
}

export interface BgVerzekeringResterendePremieVoorstel {
  /** Som van de maandbedragen (voorstel) van alle polissen over de resterende maanden. `null` zodra minstens één polis niet rekenbaar is — nooit een gedeeltelijke som die onvolledigheid verbergt. */
  voorstel: Decimal | null;
  /** Posities (in de aangeleverde lijst) van polissen met ontbrekende/ongeldige rekenvelden. */
  onrekenbareRegelIndices: number[];
}

/**
 * AUTOMATISCH BEREKENDE RESTERENDE PREMIE (FO OB-032 / Master Contract §6.7: "Estimated =
 * Werkelijk + automatisch berekende resterende premie, handmatig aanpasbaar"): het voorstel
 * voor `verwachtingResterendJaar` van `berekenEstimatedVerzekeringen` — uitsluitend de som van
 * de voorstel-maandbedragen over `resterendeMaanden`. De resterende maanden zijn EXPLICIETE
 * invoer van de aanroeper (geen nieuwe periode-afsluitingsarchitectuur, zelfde aanpak als
 * Estimated Onderhoud). Het voorstel is de berekende premie (`berekendBegroot`-pad); een
 * handmatige jaaroverride op de Begroting verandert het niet. De gebruiker blijft het
 * voorstel handmatig kunnen aanpassen: dat gebeurt door een andere `verwachtingResterendJaar`
 * aan `berekenEstimatedVerzekeringen` mee te geven — niets hier muteert Begroting of Estimated.
 */
export function berekenResterendePremieVoorstel(
  regelsInvoer: readonly BgVerzekeringRegelInvoer[],
  begrotingsjaar: number,
  resterendeMaanden: readonly number[],
): BgVerzekeringResterendePremieVoorstel {
  if (resterendeMaanden.some((m) => !Number.isInteger(m) || m < 1 || m > 12) || new Set(resterendeMaanden).size !== resterendeMaanden.length) {
    throw new RangeError("resterendeMaanden moet unieke gehele maandnummers 1..12 bevatten.");
  }

  const onrekenbareRegelIndices: number[] = [];
  const tellers: Decimal[] = [];
  regelsInvoer.forEach((invoer, index) => {
    if (!heeftRekenbareVelden(invoer)) {
      onrekenbareRegelIndices.push(index);
      return;
    }
    const { statussen } = bepaalMaandStatussen(invoer.ingangsdatum, invoer.looptijdMaanden, begrotingsjaar);
    tellers.push(tellerVoorMaanden(statussen, resterendeMaanden, invoer.bedrag, indexFactorVan(invoer.indexPercentage)));
  });

  return { voorstel: onrekenbareRegelIndices.length === 0 ? som(tellers).dividedBy(12) : null, onrekenbareRegelIndices };
}

// ── Werkelijk (FASE M7, 2026-09-15) ─────────────────────────────────────────

/**
 * ÉÉN BEWEZEN CATEGORIE (M7-opdracht §3): GL4130 "Verzekering" + OGB4131
 * "Brand-/opstalverzekering" is de enige bewezen (GL, OGB)-classificatie
 * voor deze module — geen nieuwe verzekeringstypen verzonnen. De enum blijft
 * bewust een gesloten lijst (zelfde patroon als `LEEGSTAND_CATEGORIEEN`/
 * `RENTE_CATEGORIEEN`) zodat een toekomstig TWEEDE bewezen type de lijst
 * expliciet moet uitbreiden, nooit stilzwijgend via een vrije string.
 *
 * NIEUW ARCHITECTUURPATROON (M7-opdracht §0 — GEEN GL/OGB-vertaling meer):
 * anders dan Rente/Leegstand/Geplande Verkoop (M3b/M5/M6a, die een BESTAANDE,
 * GL/OGB-classificerende calculator ongewijzigd moesten laten) is er voor
 * Verzekeringen NOOIT een Werkelijk-calculator geweest — dit is de EERSTE
 * calculator die vanaf het begin het NIEUWE patroon volgt:
 * `WerkelijkVerzekeringBoekingRegel.economischeCategorie` is de reeds door de
 * centrale P&L-bronmappingresolver bepaalde categorie (`null` = NIET_GEMAPT).
 * Deze calculator kent GEEN grootboekrekening, GEEN OGB-kostensoort, GEEN
 * classificatietabel — puur economische betekenis in, economisch resultaat
 * uit (zie `verzekeringCentraleMapping.ts` voor de daadwerkelijke
 * bron-naar-categorie-vertaling).
 *
 * ESTIMATED (FASE GAT-008A, 2026-09-17, `berekenEstimatedVerzekeringen`
 * hieronder) — volgt LETTERLIJK het bewezen OB-030/031-patroon van
 * `berekenEstimatedRente`/`berekenEstimatedLeegstand`: `estimatedTotaal =
 * werkelijkTotaal + verwachtingResterendJaar`, waarbij `verwachtingResterendJaar`
 * een EXPLICIETE, handmatig aanpasbare/overridable aanname blijft (`Decimal |
 * null`) — GEEN automatische afleiding uit `berekenJaarpremie`'s eigen
 * maandlogica. Dat is een BEWUSTE keuze (GAT-008A-opdracht: "mag worden
 * gebaseerd op ... maar moet handmatig aanpasbaar/overridable blijven"): een
 * bekende premiewijziging gedurende het jaar werkt periodecorrect door omdat
 * de AANROEPER (die de vastgestelde polisregels al kent) haar eigen
 * `verwachtingResterendJaar` op basis daarvan bepaalt — deze calculator zelf
 * herberekent de polisregels niet nogmaals, om geen tweede, parallelle
 * jaarpremie-rekenlaag te introduceren naast `berekenJaarpremie` hierboven.
 * `begrotingTotaal` (`totaalEffectiefBegroot`) wordt ONGEWIJZIGD doorgegeven
 * — Estimated berekent of muteert de Begroting nooit.
 *
 * WERKELIJK-DEKKING ALS AANVULLENDE, EXPLICIETE VOORWAARDE (GAT-008A-opdracht,
 * GAT-001B §5-invariant toegepast op Estimated — een uitbreiding t.o.v. het
 * oorspronkelijke Rente/Leegstand-Estimated-patroon, dat deze check nog niet
 * kende): `estimatedTotaal` is UITSLUITEND niet-`null` wanneer zowel (a)
 * `werkelijkDekkingBevestigd` waar is ÉN `werkelijk.nietGeclassificeerdTotaal`
 * nul is (Werkelijk-dekking "voldoende bekend"), ALS (b) `verwachtingResterendJaar`
 * een geldige Decimal is. Ontbreekt één van beide, dan blijft `estimatedTotaal`
 * expliciet `null` — nooit een stilzwijgende €0 of een gedeeltelijke som.
 */
export const VERZEKERING_WERKELIJK_CATEGORIEEN = ["BRAND_OPSTALVERZEKERING"] as const;
export type BgVerzekeringWerkelijkCategorie = (typeof VERZEKERING_WERKELIJK_CATEGORIEEN)[number];

/** Eén reeds economisch geclassificeerde boeking — GEEN grootboekrekening/OGB, zie moduledoc. */
export interface WerkelijkVerzekeringBoekingRegel {
  /** `null` = niet centraal geclassificeerd (NIET_GEMAPT) — nooit geraden, nooit stil weggelaten. */
  economischeCategorie: BgVerzekeringWerkelijkCategorie | null;
  complexnummer: string | null;
  saldo: Decimal;
}

export interface WerkelijkVerzekeringComplexTotaal {
  complexnummer: string | null;
  saldo: Decimal;
  aantalBoekingen: number;
}

export interface WerkelijkVerzekeringCategorieResultaat {
  categorie: BgVerzekeringWerkelijkCategorie;
  categorieTotaal: Decimal;
  perComplex: WerkelijkVerzekeringComplexTotaal[];
}

export interface WerkelijkVerzekeringResultaat {
  /** Vaste volgorde: `VERZEKERING_WERKELIJK_CATEGORIEEN`. */
  perCategorie: WerkelijkVerzekeringCategorieResultaat[];
  /** Som van de categorieTotalen — het werkelijk geboekte Verzekeringen-saldo. */
  moduleTotaal: Decimal;
  /** Boekingen zonder geldige centrale mapping — NOOIT geraden, NOOIT meegeteld in een categorie. */
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
}

function complexTotalenVerzekering(regels: readonly WerkelijkVerzekeringBoekingRegel[]): WerkelijkVerzekeringComplexTotaal[] {
  const perComplexMap = new Map<string | null, WerkelijkVerzekeringBoekingRegel[]>();
  for (const regel of regels) {
    const groep = perComplexMap.get(regel.complexnummer) ?? [];
    groep.push(regel);
    perComplexMap.set(regel.complexnummer, groep);
  }
  return Array.from(perComplexMap.entries())
    .map(([complexnummer, groep]) => ({ complexnummer, saldo: som(groep.map((r) => r.saldo)), aantalBoekingen: groep.length }))
    .sort((a, b) => (a.complexnummer ?? "").localeCompare(b.complexnummer ?? ""));
}

/**
 * Groepeert reeds economisch geclassificeerde boekingen per categorie —
 * GEEN classificatielogica hierin (zie moduledoc). `moduleTotaal` is
 * uitsluitend de som van de categorieTotalen, nooit een aparte, potentieel
 * dubbelgetelde boekingscategorie.
 */
export function berekenWerkelijkVerzekeringen(boekingen: readonly WerkelijkVerzekeringBoekingRegel[]): WerkelijkVerzekeringResultaat {
  const perCategorieRegels = new Map<BgVerzekeringWerkelijkCategorie, WerkelijkVerzekeringBoekingRegel[]>(VERZEKERING_WERKELIJK_CATEGORIEEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkVerzekeringBoekingRegel[] = [];

  for (const regel of boekingen) {
    if (regel.economischeCategorie === null) {
      nietGeclassificeerd.push(regel);
      continue;
    }
    perCategorieRegels.get(regel.economischeCategorie)!.push(regel);
  }

  const perCategorie: WerkelijkVerzekeringCategorieResultaat[] = VERZEKERING_WERKELIJK_CATEGORIEEN.map((categorie) => {
    const regels = perCategorieRegels.get(categorie)!;
    return { categorie, categorieTotaal: som(regels.map((r) => r.saldo)), perComplex: complexTotalenVerzekering(regels) };
  });

  return {
    perCategorie,
    moduleTotaal: som(perCategorie.map((c) => c.categorieTotaal)),
    nietGeclassificeerdTotaal: som(nietGeclassificeerd.map((r) => r.saldo)),
    nietGeclassificeerdAantalBoekingen: nietGeclassificeerd.length,
  };
}

// ── Estimated (FASE GAT-008A, 2026-09-17) ───────────────────────────────────

export interface EstimatedVerzekeringCategorieResultaat {
  categorie: BgVerzekeringWerkelijkCategorie;
  /** Ongewijzigde doorgifte van de Begroting — Estimated berekent/muteert de Begroting nooit. */
  begrotingTotaal: Decimal;
  werkelijkTotaal: Decimal;
  /** `false` zodra Werkelijk-dekking voor de afgesloten periode niet expliciet bevestigd is, of `nietGeclassificeerdTotaal` niet nul is — zie moduledoc. */
  werkelijkVoldoendeBekend: boolean;
  /** Handmatige, expliciet aangeleverde/overridable aanname — `null` = nog niet ingevuld, NOOIT een default naar 0. */
  verwachtingResterendJaar: Decimal | null;
  /** `werkelijkTotaal + verwachtingResterendJaar`, uitsluitend wanneer zowel Werkelijk-dekking als de verwachting bekend zijn — anders expliciet `null` (zie moduledoc). */
  estimatedTotaal: Decimal | null;
  afwijking: Decimal | null;
}

export interface EstimatedVerzekeringResultaat {
  /** Vaste volgorde: `VERZEKERING_WERKELIJK_CATEGORIEEN` (momenteel één element). */
  perCategorie: EstimatedVerzekeringCategorieResultaat[];
  moduleBegrotingTotaal: Decimal;
  moduleWerkelijkTotaal: Decimal;
  /** `null` zodra één van de categorieën `estimatedTotaal === null` heeft — nooit een gedeeltelijke som die onvolledigheid verbergt. */
  moduleEstimatedTotaal: Decimal | null;
}

/**
 * `estimatedTotaal = werkelijkTotaal + verwachtingResterendJaar`, exact het
 * bewezen OB-030/031-patroon (`berekenEstimatedRente`/`berekenEstimatedLeegstand`),
 * hier uitgebreid met een expliciete Werkelijk-dekkingsvoorwaarde (zie
 * moduledoc). `werkelijkDekkingBevestigd` is een module-brede vlag (deze
 * module kent één categorie) — de aanroepende laag bevestigt hiermee dat de
 * Werkelijk-boekingen voor de afgesloten periode daadwerkelijk volledig en
 * betrouwbaar zijn opgehaald (bv. geen bekende ontbrekende periode), los van
 * het reeds aanwezige `nietGeclassificeerdTotaal`-signaal.
 */
export function berekenEstimatedVerzekeringen(
  begroting: BgVerzekeringResultaat,
  werkelijk: WerkelijkVerzekeringResultaat,
  werkelijkDekkingBevestigd: boolean,
  verwachtingPerCategorie: Record<BgVerzekeringWerkelijkCategorie, Decimal | null>,
): EstimatedVerzekeringResultaat {
  const werkelijkVoldoendeBekend = werkelijkDekkingBevestigd && werkelijk.nietGeclassificeerdTotaal.isZero();

  const perCategorie: EstimatedVerzekeringCategorieResultaat[] = VERZEKERING_WERKELIJK_CATEGORIEEN.map((categorie) => {
    const werkelijkTotaal = werkelijk.perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;
    const verwachting = verwachtingPerCategorie[categorie];
    const estimatedTotaal = werkelijkVoldoendeBekend && isGeldigDecimal(verwachting) ? werkelijkTotaal.plus(verwachting) : null;
    return {
      categorie,
      begrotingTotaal: begroting.totaalEffectiefBegroot,
      werkelijkTotaal,
      werkelijkVoldoendeBekend,
      verwachtingResterendJaar: verwachting,
      estimatedTotaal,
      afwijking: estimatedTotaal !== null ? estimatedTotaal.minus(begroting.totaalEffectiefBegroot) : null,
    };
  });

  const moduleEstimatedTotaal = perCategorie.every((c) => c.estimatedTotaal !== null) ? som(perCategorie.map((c) => c.estimatedTotaal!)) : null;

  return {
    perCategorie,
    moduleBegrotingTotaal: begroting.totaalEffectiefBegroot,
    moduleWerkelijkTotaal: werkelijk.moduleTotaal,
    moduleEstimatedTotaal,
  };
}
