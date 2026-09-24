import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * Begrote Gemeentelijke lasten / WOZ — OB-033 (2026-09-08): UITSLUITEND de
 * pure rekenlaag, conform het goedgekeurde brononderzoek en de
 * businessbesluiten OB033-001 t/m 019.
 *
 * ÉÉN P&L-POST, GEEN OZB/WATER/RIOOL-SPLITSING (OB033-001): het leidende FO
 * en het brononderzoek bevestigen dat één totaalbedrag "Gemeentelijke
 * lasten pand" volstaat — deze module begroot/administreert dus GEEN
 * afzonderlijke belastingsoorten. `werkelijkeGemeentelijkeLasten` is het
 * ENIGE historische lastenbedrag dat deze module kent.
 *
 * GEEN GL-QUERY, GEEN BRONINTEGRATIE (OB033-006/010): hoewel bewezen is dat
 * `werkelijkeGemeentelijkeLasten` in de praktijk straks uit grootboek
 * 4700+4710 zal komen, benadert deze pure module de boekhouding NOOIT
 * rechtstreeks — het is expliciete, door de aanroeper aangeleverde invoer
 * (zelfde architectuurgrens als Module 1/2/3/Gepland Onderhoud/Correctief-
 * Dagelijks Onderhoud/Verzekeringen: geen cache/SQLite/Excel/bestanden/
 * klok/IO/renderer/CLI).
 *
 * WOZ IS HANDMATIGE HISTORISCHE DATA (OB033-002/007): de bron bevat geen
 * betrouwbare gestructureerde WOZ-waarde/-objectnummer/-adres/
 * waardepeildatum — `wozObjectenInvoer` is daarom altijd expliciete,
 * door de aanroeper aangeleverde invoer; deze module doet geen eigen
 * historieselectie en benadert geen enkele bron.
 *
 * WOZ-OBJECT = BESTAAND COMPLEX + "GEHEEL COMPLEX" OF BESTAANDE UNIT (Master
 * Contract §6.8 / UX §9.2, vastgestelde correctie 2026-09-24 — vervangt de oudere
 * FO-formulering "WOZ-object/adresniveau"): een WOZ-waarde wordt gekoppeld aan een
 * bestaand complex (`complexnummer`, bronsleutel) en daarna aan `GEHEEL_COMPLEX`
 * of aan een bestaande unit (`unitnummer`, bronsleutel binnen het complex; bron:
 * Units-stam, natuurlijke sleutel Bedrijfsnr+Complexnummer+Unitnummer). GEEN vrij
 * adres-/objectveld, nooit koppelen op een omschrijving. Deze pure module toetst
 * NIET of een complex/unit in de bron bestaat (geen bronaccess) — alleen de
 * structurele geldigheid van de keuze; de aanroepende laag levert bestaande sleutels.
 *
 * DRIE ONAFHANKELIJKE, NIET-CUMULATIEVE STAPPEN (OB033-008/009/011/012/013):
 * 1. per WOZ-object: `automatischVerwachteWoz = werkelijkeWoz × (1 +
 *    wozStijgingPercentage/100)`, met `effectiefVerwachteWoz =
 *    verwachteWozOverride ?? automatischVerwachteWoz` (OB033-009 — een
 *    expliciete `Decimal(0)`-override is geldig en wint, geen
 *    truthy/falsy-logica: vergelijking is altijd `!== null`, nooit `??`
 *    op een Decimal-instantie zelf om verwarring met `Decimal(0)` te
 *    voorkomen — zie `isGeldigDecimal`).
 * 2. modulebreed: `historischLastenPercentage = werkelijkeGemeentelijkeLasten
 *    / totaleWerkelijkeWoz × 100`, vervolgens `automatischBegrotingsPercentage
 *    = historischLastenPercentage × (1 + lastenPercentageStijging/100)` — een
 *    RELATIEVE stijging van het percentage zelf, nooit een absolute
 *    optelling (0,30% met 5% stijging wordt 0,315%, nooit 5,30%).
 * 3. `effectiefBegrotingsPercentage = begrotingsPercentageOverride ??
 *    automatischBegrotingsPercentage`, en `begroteGemeentelijkeLasten =
 *    totaleEffectiefVerwachteWoz × effectiefBegrotingsPercentage / 100`.
 *
 * EXACTE DECIMAL-DISTRIBUTIE OVER COMPLEXEN (OB033-014, afrondingsstrategie
 * expliciet vastgelegd): `effectiefBegrotingsPercentage` wordt PRECIES ÉÉN
 * KEER berekend (de enige potentieel niet-afrondende deling in de hele
 * keten zit in `historischLastenPercentage`) en dat ENE Decimal-object
 * wordt vervolgens hergebruikt voor zowel het modulebrede bedrag als elk
 * complexbedrag (`complexEffectiefVerwachteWoz × effectiefBegrotingsPercentage
 * / 100`). Vermenigvuldigen en optellen met een vaste Decimal-waarde is in
 * decimal.js altijd exact (geen precisieverlies, in tegenstelling tot
 * herhaalde onafhankelijke delingen zoals bij Verzekeringen se maandelijkse
 * `/12`-som) — de som van de per-complexbedragen is daardoor GEGARANDEERD
 * exact gelijk aan het modulebedrag, mits complex-toewijzing van elk
 * WOZ-object geldig is (zie hieronder voor het geval dat niet zo is).
 *
 * OBJECTEN ZONDER GELDIG COMPLEXNUMMER (zelfde precedent als Gepland
 * Onderhoud): een leeg/ontbrekend `complexnummer` geeft een KRITIEK-control
 * en het object wordt NOOIT in `perComplex` meegeteld — maar de financiële
 * bijdrage (`effectiefVerwachteWoz`) blijft wel gewoon meetellen in alle
 * MODULEBREDE totalen. Bij zo'n object sluit de som van `perComplex` dus
 * NIET meer exact aan op het modulebedrag — dat is dan een correcte,
 * verwachte afwijking (veroorzaakt door de ontbrekende complextoewijzing
 * zelf, niet door afronding), geen technisch defect.
 *
 * TOTALE WERKELIJKE WOZ = 0 — TWEE EXPLICIET VERSCHILLENDE TOESTANDEN
 * (OB033-010/016/017, gecorrigeerd 2026-09-08): delen door nul wordt nooit
 * uitgevoerd, maar "geen enkel WOZ-object" en "objecten aanwezig maar samen
 * op nul uitkomend" zijn GEEN gelijk geval:
 * - GEEN WOZ-OBJECTEN (`wozObjecten.length === 0`): er is per definitie geen
 *   rekenketen die een historisch lastenpercentage/begrotingspercentage
 *   hoeft te produceren. `totaleWerkelijkeWoz` is triviaal `0`, maar dit
 *   geeft GEEN module-brede KRITIEK — ook niet als `wozStijgingPercentage`/
 *   `werkelijkeGemeentelijkeLasten`/`lastenPercentageStijging` ontbreken
 *   (die aannames zijn dan simpelweg niet nodig om een begroting van €0 te
 *   bepalen). `beoordeeld=true` geeft dan uitsluitend de bestaande
 *   WAARSCHUWING (OB033-016) — deze toestand ("afgerond, niets ingevoerd")
 *   is een BEWUST toegestane, vaststelbare afronding, geen fout. Alle
 *   financiële uitkomsten zijn veilig `Decimal(0)`.
 * - ÉÉN OF MEER WOZ-OBJECTEN, MAAR `totaleWerkelijkeWoz` KOMT UIT OP NUL
 *   (bv. één object met `werkelijkeWoz = 0`, ongeldige/ontbrekende
 *   `werkelijkeWoz`-waarden, of meerdere objecten die elkaar optellend
 *   opheffen): dit IS een rekenkritische situatie — het percentage kan
 *   wiskundig niet worden bepaald. Dit geeft WEL een module-brede KRITIEK
 *   plus een veilige `Decimal(0)` voor `historischLastenPercentage`/
 *   `automatischBegrotingsPercentage`, en blokkeert vaststellen zolang de
 *   KRITIEK bestaat (buiten scope van deze fase, zie P3).
 * De module-aannames `wozStijgingPercentage`/`werkelijkeGemeentelijkeLasten`/
 * `lastenPercentageStijging` geven dus uitsluitend een eigen KRITIEK
 * wanneer er WEL WOZ-objecten zijn — bij 0 objecten worden ze overgeslagen.
 *
 * REVIEW/BEOORDEELD (OB033-015/016): zelfde onafhankelijke-dimensie-
 * principe als de eerdere begrotingsmodules — `beoordeeld` is pure
 * doorgegeven invoer, nooit afgeleid uit `wozObjecten.length` of uit de
 * aanwezigheid van KRITIEKE controls. `beoordeeld=true` met 0 objecten
 * geeft `REVIEWED_ZERO_OBJECTS` MET uitsluitend de WAARSCHUWING hierboven,
 * NOOIT een KRITIEK uitsluitend vanwege het aantal objecten zelf.
 *
 * BUITEN SCOPE (deze fase, expliciet niet gebouwd — geen aanname): GL-
 * koppeling/realisatie-integratie, Estimated, P&L-rendering, UI, formeel
 * WOZ-objectnummer, automatische WOZ-bron, afzonderlijke OZB/water/riool-
 * begroting, terugrekenen van WOZ uit een verondersteld belastingtarief.
 */

export type BgGemeentelijkeLastenControleErnst = BgControleErnst;

export interface BgGemeentelijkeLastenControleItem {
  /** Positie van het betrokken WOZ-object in de invoerlijst van deze aanroep — `null` = module-breed, niet aan één object toe te wijzen. */
  objectIndex: number | null;
  ernst: BgGemeentelijkeLastenControleErnst;
  bericht: string;
}

export type BgWozObjectType = "GEHEEL_COMPLEX" | "UNIT";
const GELDIGE_OBJECT_TYPES: readonly BgWozObjectType[] = ["GEHEEL_COMPLEX", "UNIT"];

export interface BgWozObjectInvoer {
  /** `null` = nog niet ingevuld — KRITIEK, blokkeert de financiële bijdrage niet, wel de complexaggregatie (zie moduledoc). */
  complexnummer: string | null;
  /** `null` = nog niet gekozen — KRITIEK, blokkeert de berekening niet. */
  objectType: BgWozObjectType | null;
  /** Bronsleutel van de unit; verplicht bij `UNIT`, moet `null` zijn bij `GEHEEL_COMPLEX`. */
  unitnummer: string | null;
  /** `null`/niet-geheel = ongeldig — KRITIEK, zuiver traceerbaarheidsveld, raakt geen enkele formule (OB033-005). */
  aanslagjaar: number | null;
  /** `null`/ongeldige datum = KRITIEK, zuiver traceerbaarheidsveld, raakt geen enkele formule (OB033-005). */
  waardepeildatum: Date | null;
  /** Rekenkritisch veld — `null`/NaN geeft KRITIEK + veilige 0-bijdrage. */
  werkelijkeWoz: Decimal | null;
  /** `null` = geen override — `automatischVerwachteWoz` blijft dan leidend voor `effectiefVerwachteWoz`. Expliciete `Decimal(0)` is een geldige override (OB033-009). */
  verwachteWozOverride: Decimal | null;
}

export interface BgGemeentelijkeLastenAannames {
  begrotingsjaar: number;
  /** Expliciete invoer — GEEN GL-query (OB033-006). Rekenkritisch voor het historisch lastenpercentage. */
  werkelijkeGemeentelijkeLasten: Decimal | null;
  /** Module-breed. `null` geeft KRITIEK zodra er WOZ-objecten zijn (zonder objecten is dit veld niet nodig). */
  wozStijgingPercentage: Decimal | null;
  /** Module-breed, RELATIEVE stijging van `historischLastenPercentage` (OB033-011). Rekenkritisch. */
  lastenPercentageStijging: Decimal | null;
  /** `null` = geen override — `automatischBegrotingsPercentage` blijft dan leidend. */
  begrotingsPercentageOverride: Decimal | null;
  beoordeeld: boolean;
}

export type BgGemeentelijkeLastenReviewStatus = "NOT_REVIEWED" | "REVIEWED_ZERO_OBJECTS" | "REVIEWED_WITH_OBJECTS";

export interface BgWozObjectUitkomst {
  index: number;
  /** De oorspronkelijke invoer — traceerbaarheid, inclusief een eventueel ongeldig/ontbrekend veld. */
  invoer: BgWozObjectInvoer;
  /** Veilig: `Decimal(0)` zodra `werkelijkeWoz` of het module-brede `wozStijgingPercentage` ontbreekt/ongeldig is. Blijft ALTIJD zichtbaar als referentie, ook wanneer een override actief is. */
  automatischVerwachteWoz: Decimal;
  /** `invoer.verwachteWozOverride` indien aanwezig en geldig (geen NaN), anders `automatischVerwachteWoz`. */
  effectiefVerwachteWoz: Decimal;
}

export interface BgGemeentelijkeLastenComplexTotaal {
  complexnummer: string;
  effectiefVerwachteWoz: Decimal;
  begroteGemeentelijkeLasten: Decimal;
}

export interface BgGemeentelijkeLastenResultaat {
  begrotingsjaar: number;
  /** Pure doorgifte van `aannames.beoordeeld` — nooit hier afgeleid. */
  beoordeeld: boolean;
  reviewStatus: BgGemeentelijkeLastenReviewStatus;
  wozObjecten: BgWozObjectUitkomst[];
  totaleWerkelijkeWoz: Decimal;
  /** Veilig `Decimal(0)` (met KRITIEK) zodra `werkelijkeGemeentelijkeLasten` ontbreekt of `totaleWerkelijkeWoz` nul is. */
  historischLastenPercentage: Decimal;
  /** Pure doorgifte van de aanname — traceerbaarheid. */
  wozStijgingPercentage: Decimal | null;
  /** Pure doorgifte van de aanname — traceerbaarheid. */
  lastenPercentageStijging: Decimal | null;
  /** Veilig `Decimal(0)` zodra `historischLastenPercentage` of `lastenPercentageStijging` onbetrouwbaar is. */
  automatischBegrotingsPercentage: Decimal;
  /** Pure doorgifte van de aanname — traceerbaarheid. */
  begrotingsPercentageOverride: Decimal | null;
  /** `begrotingsPercentageOverride` indien aanwezig en geldig, anders `automatischBegrotingsPercentage`. */
  effectiefBegrotingsPercentage: Decimal;
  totaleAutomatischVerwachteWoz: Decimal;
  totaleEffectiefVerwachteWoz: Decimal;
  begroteGemeentelijkeLasten: Decimal;
  /** Uitsluitend WOZ-objecten met een geldig, niet-leeg `complexnummer` (zie moduledoc). */
  perComplex: BgGemeentelijkeLastenComplexTotaal[];
  controleVereist: BgGemeentelijkeLastenControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function leegOfNull(waarde: string | null): boolean {
  return waarde === null || waarde.trim().length === 0;
}

function isGeldigAanslagjaar(waarde: number | null): waarde is number {
  return waarde !== null && Number.isInteger(waarde);
}

function isGeldigeDatum(waarde: Date | null): waarde is Date {
  return waarde !== null && !Number.isNaN(waarde.getTime());
}

function isGeldigDecimal(waarde: Decimal | null): waarde is Decimal {
  return waarde !== null && !waarde.isNaN();
}

function valideerWozObject(invoer: BgWozObjectInvoer, index: number): BgGemeentelijkeLastenControleItem[] {
  const controleVereist: BgGemeentelijkeLastenControleItem[] = [];
  const meld = (bericht: string, ernst: BgGemeentelijkeLastenControleErnst = "KRITIEK") =>
    controleVereist.push({ objectIndex: index, ernst, bericht });

  if (leegOfNull(invoer.complexnummer)) {
    meld(`WOZ-object ${index}: complexnummer ontbreekt — verplicht voor vaststellen; bedrag blijft financieel meetellen (niet in perComplex).`);
  }
  if (invoer.objectType === null || !GELDIGE_OBJECT_TYPES.includes(invoer.objectType)) {
    meld(`WOZ-object ${index}: objectkeuze ontbreekt of is ongeldig — kies "Geheel complex" of een bestaande unit; verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
  } else if (invoer.objectType === "UNIT" && leegOfNull(invoer.unitnummer)) {
    meld(`WOZ-object ${index}: unitnummer ontbreekt bij objectkeuze unit — verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
  } else if (invoer.objectType === "GEHEEL_COMPLEX" && invoer.unitnummer !== null) {
    meld(`WOZ-object ${index}: objectkeuze "Geheel complex" mag geen unitnummer hebben — verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
  }
  if (!isGeldigAanslagjaar(invoer.aanslagjaar)) {
    meld(`WOZ-object ${index}: aanslagjaar ontbreekt of is ongeldig — verplicht voor vaststellen; raakt geen enkele berekening.`);
  }
  if (!isGeldigeDatum(invoer.waardepeildatum)) {
    meld(`WOZ-object ${index}: waardepeildatum ontbreekt of is ongeldig — verplicht voor vaststellen; raakt geen enkele berekening.`);
  }
  if (invoer.werkelijkeWoz === null) {
    meld(`WOZ-object ${index}: werkelijkeWoz ontbreekt — berekening niet mogelijk, veilige bijdrage 0 toegepast.`);
  } else if (invoer.werkelijkeWoz.isNaN()) {
    meld(`WOZ-object ${index}: werkelijkeWoz is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
  } else if (invoer.werkelijkeWoz.lessThanOrEqualTo(0)) {
    meld(`WOZ-object ${index}: werkelijkeWoz moet positief zijn (${invoer.werkelijkeWoz.toString()}) — verplicht voor vaststellen (Master Contract §6.8); de waarde blijft rekenkundig meetellen.`);
  }
  if (invoer.verwachteWozOverride !== null) {
    if (invoer.verwachteWozOverride.isNaN()) {
      meld(`WOZ-object ${index}: verwachteWozOverride is geen geldig getal (NaN) — override genegeerd, automatischVerwachteWoz blijft leidend.`);
    } else if (invoer.verwachteWozOverride.isNegative()) {
      meld(`WOZ-object ${index}: verwachteWozOverride is negatief (${invoer.verwachteWozOverride.toString()}) — ongebruikelijk, toegestaan, telt rekenkundig mee.`, "WAARSCHUWING");
    }
  }

  return controleVereist;
}

export function berekenBegroteGemeentelijkeLasten(
  wozObjectenInvoer: readonly BgWozObjectInvoer[],
  aannames: BgGemeentelijkeLastenAannames,
): BgGemeentelijkeLastenResultaat {
  const controleVereist: BgGemeentelijkeLastenControleItem[] = [];
  const meldModulebreed = (bericht: string, ernst: BgGemeentelijkeLastenControleErnst = "KRITIEK") =>
    controleVereist.push({ objectIndex: null, ernst, bericht });

  // OB033-016-correctie (2026-09-08): "geen enkel WOZ-object" en "objecten aanwezig maar
  // totale WOZ = 0" zijn twee expliciet verschillende toestanden — zie moduledoc. Bij 0
  // objecten is er per definitie geen rekenketen die een historisch lastenpercentage/
  // begrotingspercentage hoeft te produceren, dus mogen de daarvoor benodigde module-
  // aannames (wozStijgingPercentage/werkelijkeGemeentelijkeLasten/lastenPercentageStijging)
  // ontbreken zonder een KRITIEK die REVIEWED_ZERO_OBJECTS feitelijk onbereikbaar maakt.
  const heeftObjecten = wozObjectenInvoer.length > 0;

  const wozStijgingGeldig = isGeldigDecimal(aannames.wozStijgingPercentage);
  if (!wozStijgingGeldig && heeftObjecten) {
    meldModulebreed("wozStijgingPercentage ontbreekt of is ongeldig — berekening per WOZ-object niet mogelijk, veilige bijdrage 0 toegepast.");
  } else if (wozStijgingGeldig && (aannames.wozStijgingPercentage as Decimal).isNegative()) {
    meldModulebreed(`wozStijgingPercentage is negatief (${(aannames.wozStijgingPercentage as Decimal).toString()}) — toegestaan, rekenkundig verwerkt.`, "WAARSCHUWING");
  }

  const wozObjecten: BgWozObjectUitkomst[] = wozObjectenInvoer.map((invoer, index) => {
    const meldingen = valideerWozObject(invoer, index);
    controleVereist.push(...meldingen);

    const objectRekenvoorwaardenGeldig = isGeldigDecimal(invoer.werkelijkeWoz) && wozStijgingGeldig;
    const automatischVerwachteWoz = objectRekenvoorwaardenGeldig
      ? (invoer.werkelijkeWoz as Decimal).times(new Decimal(1).plus((aannames.wozStijgingPercentage as Decimal).dividedBy(100)))
      : new Decimal(0);

    const overrideGeldig = isGeldigDecimal(invoer.verwachteWozOverride);
    const effectiefVerwachteWoz = overrideGeldig ? (invoer.verwachteWozOverride as Decimal) : automatischVerwachteWoz;

    return { index, invoer, automatischVerwachteWoz, effectiefVerwachteWoz };
  });

  const totaleWerkelijkeWoz = som(wozObjecten.map((o) => (isGeldigDecimal(o.invoer.werkelijkeWoz) ? (o.invoer.werkelijkeWoz as Decimal) : new Decimal(0))));
  const totaleAutomatischVerwachteWoz = som(wozObjecten.map((o) => o.automatischVerwachteWoz));
  const totaleEffectiefVerwachteWoz = som(wozObjecten.map((o) => o.effectiefVerwachteWoz));

  const werkelijkeGemeentelijkeLastenGeldig = isGeldigDecimal(aannames.werkelijkeGemeentelijkeLasten);
  if (heeftObjecten) {
    if (aannames.werkelijkeGemeentelijkeLasten === null) {
      meldModulebreed("werkelijkeGemeentelijkeLasten ontbreekt — historisch lastenpercentage kan niet worden bepaald, veilige waarde 0 toegepast.");
    } else if (aannames.werkelijkeGemeentelijkeLasten.isNaN()) {
      meldModulebreed("werkelijkeGemeentelijkeLasten is geen geldig getal (NaN) — historisch lastenpercentage kan niet worden bepaald, veilige waarde 0 toegepast.");
    }
  }

  const totaleWerkelijkeWozIsNul = totaleWerkelijkeWoz.isZero();
  // Alleen KRITIEK wanneer er daadwerkelijk objecten zijn die samen op nul uitkomen
  // (bv. één object met werkelijkeWoz=0, of objecten die elkaar optellend opheffen) —
  // bij 0 objecten is totaleWerkelijkeWoz triviaal nul en géén rekenkritische situatie
  // (zie moduledoc, OB033-016-correctie).
  if (totaleWerkelijkeWozIsNul && heeftObjecten) {
    meldModulebreed("totale werkelijke WOZ is nul — historisch lastenpercentage kan niet worden bepaald (deling door nul voorkomen), veilige waarde 0 toegepast.");
  }

  const historischLastenPercentageGeldig = werkelijkeGemeentelijkeLastenGeldig && !totaleWerkelijkeWozIsNul;
  const historischLastenPercentage = historischLastenPercentageGeldig
    ? (aannames.werkelijkeGemeentelijkeLasten as Decimal).dividedBy(totaleWerkelijkeWoz).times(100)
    : new Decimal(0);

  const lastenPercentageStijgingGeldig = isGeldigDecimal(aannames.lastenPercentageStijging);
  if (heeftObjecten) {
    if (aannames.lastenPercentageStijging === null) {
      meldModulebreed("lastenPercentageStijging ontbreekt — automatisch begrotingspercentage kan niet worden bepaald, veilige waarde 0 toegepast.");
    } else if (aannames.lastenPercentageStijging.isNaN()) {
      meldModulebreed("lastenPercentageStijging is geen geldig getal (NaN) — automatisch begrotingspercentage kan niet worden bepaald, veilige waarde 0 toegepast.");
    }
  }
  if (lastenPercentageStijgingGeldig && (aannames.lastenPercentageStijging as Decimal).isNegative()) {
    meldModulebreed(`lastenPercentageStijging is negatief (${(aannames.lastenPercentageStijging as Decimal).toString()}) — toegestaan, rekenkundig verwerkt.`, "WAARSCHUWING");
  }

  const automatischBegrotingsPercentageGeldig = historischLastenPercentageGeldig && lastenPercentageStijgingGeldig;
  const automatischBegrotingsPercentage = automatischBegrotingsPercentageGeldig
    ? historischLastenPercentage.times(new Decimal(1).plus((aannames.lastenPercentageStijging as Decimal).dividedBy(100)))
    : new Decimal(0);

  if (aannames.begrotingsPercentageOverride !== null && aannames.begrotingsPercentageOverride.isNaN()) {
    meldModulebreed("begrotingsPercentageOverride is geen geldig getal (NaN) — override genegeerd, automatischBegrotingsPercentage blijft leidend.");
  }
  const begrotingsPercentageOverrideGeldig = isGeldigDecimal(aannames.begrotingsPercentageOverride);
  const effectiefBegrotingsPercentage = begrotingsPercentageOverrideGeldig
    ? (aannames.begrotingsPercentageOverride as Decimal)
    : automatischBegrotingsPercentage;

  const begroteGemeentelijkeLasten = totaleEffectiefVerwachteWoz.times(effectiefBegrotingsPercentage).dividedBy(100);

  const perComplexMap = new Map<string, Decimal>();
  for (const object of wozObjecten) {
    if (leegOfNull(object.invoer.complexnummer)) continue;
    const complexnummer = object.invoer.complexnummer as string;
    perComplexMap.set(complexnummer, (perComplexMap.get(complexnummer) ?? new Decimal(0)).plus(object.effectiefVerwachteWoz));
  }
  const perComplex: BgGemeentelijkeLastenComplexTotaal[] = [...perComplexMap.entries()].map(([complexnummer, effectiefVerwachteWoz]) => ({
    complexnummer,
    effectiefVerwachteWoz,
    begroteGemeentelijkeLasten: effectiefVerwachteWoz.times(effectiefBegrotingsPercentage).dividedBy(100),
  }));

  if (aannames.beoordeeld && wozObjecten.length === 0) {
    meldModulebreed("beoordeeld=true met 0 WOZ-objecten — bewuste afronding zonder objectregels, geen inhoudelijke fout.", "WAARSCHUWING");
  }

  const reviewStatus: BgGemeentelijkeLastenReviewStatus = !aannames.beoordeeld
    ? "NOT_REVIEWED"
    : wozObjecten.length === 0
      ? "REVIEWED_ZERO_OBJECTS"
      : "REVIEWED_WITH_OBJECTS";

  return {
    begrotingsjaar: aannames.begrotingsjaar,
    beoordeeld: aannames.beoordeeld,
    reviewStatus,
    wozObjecten,
    totaleWerkelijkeWoz,
    historischLastenPercentage,
    wozStijgingPercentage: aannames.wozStijgingPercentage,
    lastenPercentageStijging: aannames.lastenPercentageStijging,
    automatischBegrotingsPercentage,
    begrotingsPercentageOverride: aannames.begrotingsPercentageOverride,
    effectiefBegrotingsPercentage,
    totaleAutomatischVerwachteWoz,
    totaleEffectiefVerwachteWoz,
    begroteGemeentelijkeLasten,
    perComplex,
    controleVereist,
  };
}

// ── Werkelijk (FASE M7, 2026-09-15) ─────────────────────────────────────────

/**
 * ÉÉN CATEGORIE, GEEN OZB/WATER/RIOOL-SPLITSING (M7-opdracht §4, zelfde
 * businessbeslissing als Begroting se OB033-001 hierboven — "ÉÉN P&L-POST"):
 * de bewezen bronmapping omvat GL4700 ("WOZ / OZB") + OGB4701 ("OZB") EN
 * GL4710 ("Gemeentelijke heffingen"), maar BEIDE grootboekrekeningen voeden
 * dezelfde, ENE categorie — geen fictieve uitsplitsing tussen OZB/water/
 * riool/overige heffingen, want de bron ondersteunt die splitsing niet
 * betrouwbaar. GL4700 heeft uitsluitend een bewezen GL+OGB-specifieke rij
 * (OGB4701); GL4710 heeft GEEN bewezen OGB-verfijning en krijgt daarom een
 * GL-default. Zie `gemeentelijkeLastenCentraleMapping.ts` voor de
 * daadwerkelijke bron-naar-categorie-vertaling.
 *
 * NIEUW ARCHITECTUURPATROON (M7-opdracht §0, zelfde als Verzekeringen
 * hierboven): deze calculator kent GEEN grootboekrekening/OGB — puur
 * economische betekenis in, economisch resultaat uit.
 *
 * DE BESTAANDE HANDMATIGE WOZ-/BEGROTINGSLOGICA WORDT NIET VERVANGEN
 * (M7-opdracht §4): `berekenBegroteGemeentelijkeLasten` hierboven (met haar
 * handmatige `werkelijkeGemeentelijkeLasten`-aanname en WOZ-objecten) blijft
 * volledig ongewijzigd — deze Werkelijk-calculator is een AANVULLING, geen
 * vervanging, en de twee zijn NIET aan elkaar gekoppeld (de aanroeper mag
 * `berekenWerkelijkGemeentelijkeLasten`'s `moduleTotaal` desgewenst als
 * betere/actuele bron voor de bestaande `werkelijkeGemeentelijkeLasten`-
 * aanname gebruiken — dat is een latere, aparte keuze, geen onderdeel van
 * deze fase).
 *
 * ESTIMATED (FASE GAT-008A, 2026-09-17, `berekenEstimatedGemeentelijkeLasten`
 * hieronder) — volgt hetzelfde bewezen OB-030/031-patroon als Rente/Leegstand/
 * Verzekeringen: `estimatedTotaal = werkelijkTotaal + verwachtingResterendJaar`.
 * ANDERS DAN VERZEKERINGEN heeft de Begroting hier GEEN maand-voor-maand
 * interne structuur (`begroteGemeentelijkeLasten` is een vlak jaarbedrag,
 * uitsluitend WOZ × percentage — geen periodiciteit om aan te ontlenen) — en
 * gemeentelijke lasten worden bovendien bewezen NIET gelijkmatig maandelijks
 * geboekt (GAT-008A-opdracht, expliciet). Een lineaire Werkelijk-extrapolatie
 * of een automatische "ontbrekende maand = €0"-aanname is daarom UITGESLOTEN
 * — `verwachtingResterendJaar` blijft daarom, nog sterker dan bij
 * Verzekeringen, een PUUR handmatige, expliciete businessaanname (`Decimal |
 * null`), zonder enige interne afleidingslogica in deze module.
 * `begroteGemeentelijkeLasten` wordt ONGEWIJZIGD doorgegeven — Estimated
 * berekent of muteert de Begroting nooit.
 *
 * WERKELIJK-DEKKING ALS AANVULLENDE, EXPLICIETE VOORWAARDE (zelfde
 * GAT-001B-§5-toepassing als Verzekeringen): `estimatedTotaal` is
 * uitsluitend niet-`null` wanneer zowel Werkelijk-dekking bevestigd is
 * (`werkelijkDekkingBevestigd` én `nietGeclassificeerdTotaal === 0`) als
 * `verwachtingResterendJaar` een geldige Decimal is.
 */
export const GEMEENTELIJKE_LASTEN_WERKELIJK_CATEGORIEEN = ["GEMEENTELIJKE_LASTEN"] as const;
export type BgGemeentelijkeLastenWerkelijkCategorie = (typeof GEMEENTELIJKE_LASTEN_WERKELIJK_CATEGORIEEN)[number];

/** Eén reeds economisch geclassificeerde boeking — GEEN grootboekrekening/OGB, zie moduledoc. */
export interface WerkelijkGemeentelijkeLastenBoekingRegel {
  /** `null` = niet centraal geclassificeerd (NIET_GEMAPT) — nooit geraden, nooit stil weggelaten. */
  economischeCategorie: BgGemeentelijkeLastenWerkelijkCategorie | null;
  complexnummer: string | null;
  saldo: Decimal;
}

export interface WerkelijkGemeentelijkeLastenComplexTotaal {
  complexnummer: string | null;
  saldo: Decimal;
  aantalBoekingen: number;
}

export interface WerkelijkGemeentelijkeLastenCategorieResultaat {
  categorie: BgGemeentelijkeLastenWerkelijkCategorie;
  categorieTotaal: Decimal;
  perComplex: WerkelijkGemeentelijkeLastenComplexTotaal[];
}

export interface WerkelijkGemeentelijkeLastenResultaat {
  /** Vaste volgorde: `GEMEENTELIJKE_LASTEN_WERKELIJK_CATEGORIEEN` (momenteel één element). */
  perCategorie: WerkelijkGemeentelijkeLastenCategorieResultaat[];
  moduleTotaal: Decimal;
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
}

function complexTotalenGemeentelijkeLasten(regels: readonly WerkelijkGemeentelijkeLastenBoekingRegel[]): WerkelijkGemeentelijkeLastenComplexTotaal[] {
  const perComplexMap = new Map<string | null, WerkelijkGemeentelijkeLastenBoekingRegel[]>();
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
 * GEEN classificatielogica hierin (zie moduledoc).
 */
export function berekenWerkelijkGemeentelijkeLasten(boekingen: readonly WerkelijkGemeentelijkeLastenBoekingRegel[]): WerkelijkGemeentelijkeLastenResultaat {
  const perCategorieRegels = new Map<BgGemeentelijkeLastenWerkelijkCategorie, WerkelijkGemeentelijkeLastenBoekingRegel[]>(GEMEENTELIJKE_LASTEN_WERKELIJK_CATEGORIEEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkGemeentelijkeLastenBoekingRegel[] = [];

  for (const regel of boekingen) {
    if (regel.economischeCategorie === null) {
      nietGeclassificeerd.push(regel);
      continue;
    }
    perCategorieRegels.get(regel.economischeCategorie)!.push(regel);
  }

  const perCategorie: WerkelijkGemeentelijkeLastenCategorieResultaat[] = GEMEENTELIJKE_LASTEN_WERKELIJK_CATEGORIEEN.map((categorie) => {
    const regels = perCategorieRegels.get(categorie)!;
    return { categorie, categorieTotaal: som(regels.map((r) => r.saldo)), perComplex: complexTotalenGemeentelijkeLasten(regels) };
  });

  return {
    perCategorie,
    moduleTotaal: som(perCategorie.map((c) => c.categorieTotaal)),
    nietGeclassificeerdTotaal: som(nietGeclassificeerd.map((r) => r.saldo)),
    nietGeclassificeerdAantalBoekingen: nietGeclassificeerd.length,
  };
}

// ── Estimated (FASE GAT-008A, 2026-09-17) ───────────────────────────────────

export interface EstimatedGemeentelijkeLastenCategorieResultaat {
  categorie: BgGemeentelijkeLastenWerkelijkCategorie;
  /** Ongewijzigde doorgifte van de Begroting — Estimated berekent/muteert de Begroting nooit. */
  begrotingTotaal: Decimal;
  werkelijkTotaal: Decimal;
  /** `false` zodra Werkelijk-dekking voor de afgesloten periode niet expliciet bevestigd is, of `nietGeclassificeerdTotaal` niet nul is — zie moduledoc. */
  werkelijkVoldoendeBekend: boolean;
  /** Handmatige, expliciet aangeleverde/overridable aanname — `null` = nog niet ingevuld. GEEN lineaire extrapolatie, GEEN aanname dat een ontbrekende boeking €0 betekent (zie moduledoc). */
  verwachtingResterendJaar: Decimal | null;
  estimatedTotaal: Decimal | null;
  afwijking: Decimal | null;
}

export interface EstimatedGemeentelijkeLastenResultaat {
  /** Vaste volgorde: `GEMEENTELIJKE_LASTEN_WERKELIJK_CATEGORIEEN` (momenteel één element). */
  perCategorie: EstimatedGemeentelijkeLastenCategorieResultaat[];
  moduleBegrotingTotaal: Decimal;
  moduleWerkelijkTotaal: Decimal;
  /** `null` zodra één van de categorieën `estimatedTotaal === null` heeft. */
  moduleEstimatedTotaal: Decimal | null;
}

/**
 * `estimatedTotaal = werkelijkTotaal + verwachtingResterendJaar` — zie
 * moduledoc voor waarom hier, anders dan Verzekeringen, GEEN enkele interne
 * afleiding van `verwachtingResterendJaar` bestaat.
 */
export function berekenEstimatedGemeentelijkeLasten(
  begroting: BgGemeentelijkeLastenResultaat,
  werkelijk: WerkelijkGemeentelijkeLastenResultaat,
  werkelijkDekkingBevestigd: boolean,
  verwachtingPerCategorie: Record<BgGemeentelijkeLastenWerkelijkCategorie, Decimal | null>,
): EstimatedGemeentelijkeLastenResultaat {
  const werkelijkVoldoendeBekend = werkelijkDekkingBevestigd && werkelijk.nietGeclassificeerdTotaal.isZero();

  const perCategorie: EstimatedGemeentelijkeLastenCategorieResultaat[] = GEMEENTELIJKE_LASTEN_WERKELIJK_CATEGORIEEN.map((categorie) => {
    const werkelijkTotaal = werkelijk.perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;
    const verwachting = verwachtingPerCategorie[categorie];
    const estimatedTotaal = werkelijkVoldoendeBekend && isGeldigDecimal(verwachting) ? werkelijkTotaal.plus(verwachting) : null;
    return {
      categorie,
      begrotingTotaal: begroting.begroteGemeentelijkeLasten,
      werkelijkTotaal,
      werkelijkVoldoendeBekend,
      verwachtingResterendJaar: verwachting,
      estimatedTotaal,
      afwijking: estimatedTotaal !== null ? estimatedTotaal.minus(begroting.begroteGemeentelijkeLasten) : null,
    };
  });

  const moduleEstimatedTotaal = perCategorie.every((c) => c.estimatedTotaal !== null) ? som(perCategorie.map((c) => c.estimatedTotaal!)) : null;

  return {
    perCategorie,
    moduleBegrotingTotaal: begroting.begroteGemeentelijkeLasten,
    moduleWerkelijkTotaal: werkelijk.moduleTotaal,
    moduleEstimatedTotaal,
  };
}

// ── WOZ-historie: ontwikkeling per complex/unit (Master Contract §6.8, 2026-09-24) ──

export interface BgWozHistorieRegel {
  complexnummer: string;
  objectType: BgWozObjectType;
  unitnummer: string | null;
  aanslagjaar: number;
  waardepeildatum: Date;
  werkelijkeWoz: Decimal;
  /** Verschil met de WOZ-waarde van het voorgaande aanslagjaar van hetzelfde object. `null` voor het eerste jaar (geen voorgaande waarde). */
  ontwikkelingBedrag: Decimal | null;
  /** (huidig − voorgaand) / voorgaand × 100. `null` voor het eerste jaar, of wanneer de voorgaande waarde niet positief is (deling door nul voorkomen). */
  ontwikkelingPercentage: Decimal | null;
}

export interface BgWozHistorieFilter {
  complexnummer?: string;
  aanslagjaarVan?: number;
  aanslagjaarTot?: number;
}

export interface BgWozHistorieResultaat {
  regels: BgWozHistorieRegel[];
  /** Posities (in de aangeleverde lijst) van objecten die niet in de historie kunnen (onvolledige sleutel, ongeldig aanslagjaar/WOZ) — nooit stil weggelaten. */
  uitgeslotenObjectIndices: number[];
}

function objectSleutel(complexnummer: string, objectType: BgWozObjectType, unitnummer: string | null): string {
  return objectType === "UNIT" ? `${complexnummer}::UNIT::${unitnummer ?? ""}` : `${complexnummer}::GEHEEL_COMPLEX`;
}

/**
 * WOZ-HISTORIE (UX §9.2: "De historie bewaart per complex/unit de jaarlijkse waarde en
 * ontwikkeling in euro's en procenten"): één regel per object (complex + geheel complex/unit)
 * per aanslagjaar, gesorteerd op complex, object en aanslagjaar. De ontwikkeling wordt
 * berekend op de VOLLEDIGE historie van het object en pas daarna gefilterd — het eerste
 * gefilterde jaar toont dus zijn ontwikkeling t.o.v. het (eventueel buiten het filter
 * liggende) voorgaande jaar. `filter` (complex en/of aanslagjaarperiode, beide grenzen
 * inclusief) levert de gefilterde rijen waaruit een export kan worden opgebouwd; deze
 * functie legt GEEN exportformaat vast. Alleen objecten met complete sleutel, geldig
 * aanslagjaar/waardepeildatum en een geldige WOZ-waarde doen mee; de rest wordt
 * expliciet gerapporteerd. Twee waarden voor hetzelfde object én aanslagjaar zijn een
 * data-invoerfout waarvoor geen besluit bestaat: beide rijen blijven, in invoervolgorde.
 */
export function bepaalWozHistorie(wozObjectenInvoer: readonly BgWozObjectInvoer[], filter: BgWozHistorieFilter = {}): BgWozHistorieResultaat {
  const uitgeslotenObjectIndices: number[] = [];
  const kandidaten: { index: number; regel: Omit<BgWozHistorieRegel, "ontwikkelingBedrag" | "ontwikkelingPercentage"> }[] = [];

  wozObjectenInvoer.forEach((invoer, index) => {
    const objectTypeGeldig = invoer.objectType !== null && GELDIGE_OBJECT_TYPES.includes(invoer.objectType);
    const sleutelGeldig =
      !leegOfNull(invoer.complexnummer) &&
      objectTypeGeldig &&
      (invoer.objectType === "UNIT" ? !leegOfNull(invoer.unitnummer) : invoer.unitnummer === null);
    if (!sleutelGeldig || !isGeldigAanslagjaar(invoer.aanslagjaar) || !isGeldigeDatum(invoer.waardepeildatum) || !isGeldigDecimal(invoer.werkelijkeWoz)) {
      uitgeslotenObjectIndices.push(index);
      return;
    }
    kandidaten.push({
      index,
      regel: {
        complexnummer: (invoer.complexnummer as string).trim(),
        objectType: invoer.objectType as BgWozObjectType,
        unitnummer: invoer.objectType === "UNIT" ? (invoer.unitnummer as string).trim() : null,
        aanslagjaar: invoer.aanslagjaar,
        waardepeildatum: invoer.waardepeildatum,
        werkelijkeWoz: invoer.werkelijkeWoz,
      },
    });
  });

  const perObject = new Map<string, typeof kandidaten>();
  for (const kandidaat of kandidaten) {
    const sleutel = objectSleutel(kandidaat.regel.complexnummer, kandidaat.regel.objectType, kandidaat.regel.unitnummer);
    const groep = perObject.get(sleutel) ?? [];
    groep.push(kandidaat);
    perObject.set(sleutel, groep);
  }

  const regels: BgWozHistorieRegel[] = [];
  for (const groep of perObject.values()) {
    const gesorteerd = [...groep].sort((a, b) => a.regel.aanslagjaar - b.regel.aanslagjaar || a.index - b.index);
    gesorteerd.forEach((kandidaat, positie) => {
      const vorige = positie > 0 ? gesorteerd[positie - 1]!.regel.werkelijkeWoz : null;
      const ontwikkelingBedrag = vorige !== null ? kandidaat.regel.werkelijkeWoz.minus(vorige) : null;
      const ontwikkelingPercentage = vorige !== null && vorige.greaterThan(0) ? kandidaat.regel.werkelijkeWoz.minus(vorige).dividedBy(vorige).times(100) : null;
      regels.push({ ...kandidaat.regel, ontwikkelingBedrag, ontwikkelingPercentage });
    });
  }

  regels.sort(
    (a, b) =>
      a.complexnummer.localeCompare(b.complexnummer) ||
      (a.objectType === b.objectType ? 0 : a.objectType === "GEHEEL_COMPLEX" ? -1 : 1) ||
      (a.unitnummer ?? "").localeCompare(b.unitnummer ?? "") ||
      a.aanslagjaar - b.aanslagjaar,
  );

  const gefilterd = regels.filter(
    (r) =>
      (filter.complexnummer === undefined || r.complexnummer === filter.complexnummer) &&
      (filter.aanslagjaarVan === undefined || r.aanslagjaar >= filter.aanslagjaarVan) &&
      (filter.aanslagjaarTot === undefined || r.aanslagjaar <= filter.aanslagjaarTot),
  );

  return { regels: gefilterd, uitgeslotenObjectIndices };
}
