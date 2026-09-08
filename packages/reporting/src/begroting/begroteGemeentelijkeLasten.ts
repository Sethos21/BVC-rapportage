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
 * WOZ-OBJECT ≠ UNIT/CONTRACT/BOEKINGSREGEL (OB033-003/004): een WOZ-object
 * is een zelfstandig, door de gebruiker vastgelegd concept, geïdentificeerd
 * via het vrije tekstveld `wozObjectAdres` (GEEN formeel WOZ-objectnummer —
 * dat bestaat niet in de bron, zie brononderzoek). Elke regel hoort bij
 * exact één `complexnummer`.
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
 * TOTALE WERKELIJKE WOZ = 0 IS EEN REKENKRITISCHE SITUATIE (OB033-010/017):
 * delen door nul wordt nooit uitgevoerd. Zowel "geen enkel WOZ-object" als
 * "alle WOZ-objecten hebben een ongeldig/ontbrekend werkelijkeWoz" leiden
 * tot `totaleWerkelijkeWoz = 0`, en dus tot een module-brede KRITIEK plus
 * een veilige `Decimal(0)` voor `historischLastenPercentage`/
 * `automatischBegrotingsPercentage`. Dit is een APARTE control, los van de
 * WAARSCHUWING voor "0 WOZ-objecten" (OB033-016) — beide kunnen tegelijk
 * optreden zonder tegenstrijdig te zijn: de WAARSCHUWING signaleert "nog
 * niets ingevoerd", de KRITIEK signaleert "het percentage kan wiskundig
 * niet worden bepaald".
 *
 * REVIEW/BEOORDEELD (OB033-015/016): zelfde onafhankelijke-dimensie-
 * principe als de eerdere begrotingsmodules — `beoordeeld` is pure
 * doorgegeven invoer, nooit afgeleid uit `wozObjecten.length` of uit de
 * aanwezigheid van KRITIEKE controls. `beoordeeld=true` met 0 objecten
 * geeft `REVIEWED_ZERO_OBJECTS` MET een WAARSCHUWING (nooit een KRITIEK
 * uitsluitend vanwege het aantal objecten zelf).
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

export interface BgWozObjectInvoer {
  /** `null` = nog niet ingevuld — KRITIEK, blokkeert de financiële bijdrage niet, wel de complexaggregatie (zie moduledoc). */
  complexnummer: string | null;
  /** Vrij tekstveld, GEEN formeel WOZ-objectnummer (OB033-004). `null` = nog niet ingevuld — KRITIEK, blokkeert de berekening niet. */
  wozObjectAdres: string | null;
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
  if (leegOfNull(invoer.wozObjectAdres)) {
    meld(`WOZ-object ${index}: wozObjectAdres ontbreekt — verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
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
  } else if (invoer.werkelijkeWoz.isNegative()) {
    meld(`WOZ-object ${index}: werkelijkeWoz is negatief (${invoer.werkelijkeWoz.toString()}) — ongebruikelijk, toegestaan, telt rekenkundig mee.`, "WAARSCHUWING");
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

  const wozStijgingGeldig = isGeldigDecimal(aannames.wozStijgingPercentage);
  if (!wozStijgingGeldig && wozObjectenInvoer.length > 0) {
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
  if (aannames.werkelijkeGemeentelijkeLasten === null) {
    meldModulebreed("werkelijkeGemeentelijkeLasten ontbreekt — historisch lastenpercentage kan niet worden bepaald, veilige waarde 0 toegepast.");
  } else if (aannames.werkelijkeGemeentelijkeLasten.isNaN()) {
    meldModulebreed("werkelijkeGemeentelijkeLasten is geen geldig getal (NaN) — historisch lastenpercentage kan niet worden bepaald, veilige waarde 0 toegepast.");
  }

  const totaleWerkelijkeWozIsNul = totaleWerkelijkeWoz.isZero();
  if (totaleWerkelijkeWozIsNul) {
    meldModulebreed("totale werkelijke WOZ is nul — historisch lastenpercentage kan niet worden bepaald (deling door nul voorkomen), veilige waarde 0 toegepast.");
  }

  const historischLastenPercentageGeldig = werkelijkeGemeentelijkeLastenGeldig && !totaleWerkelijkeWozIsNul;
  const historischLastenPercentage = historischLastenPercentageGeldig
    ? (aannames.werkelijkeGemeentelijkeLasten as Decimal).dividedBy(totaleWerkelijkeWoz).times(100)
    : new Decimal(0);

  const lastenPercentageStijgingGeldig = isGeldigDecimal(aannames.lastenPercentageStijging);
  if (aannames.lastenPercentageStijging === null) {
    meldModulebreed("lastenPercentageStijging ontbreekt — automatisch begrotingspercentage kan niet worden bepaald, veilige waarde 0 toegepast.");
  } else if (aannames.lastenPercentageStijging.isNaN()) {
    meldModulebreed("lastenPercentageStijging is geen geldig getal (NaN) — automatisch begrotingspercentage kan niet worden bepaald, veilige waarde 0 toegepast.");
  } else if (aannames.lastenPercentageStijging.isNegative()) {
    meldModulebreed(`lastenPercentageStijging is negatief (${aannames.lastenPercentageStijging.toString()}) — toegestaan, rekenkundig verwerkt.`, "WAARSCHUWING");
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
