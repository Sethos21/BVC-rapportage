import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * Begrote managementvergoeding — Module 3 (2026-09-03, gecorrigeerd
 * 2026-09-03), fase 2B: UITSLUITEND de pure rekenlaag, conform OB-026
 * (`FO_Exploitatiebegroting_v1.0.md`) en het Module-3-brononderzoek (fase
 * 2A: 070_Rooise_Zoom bevat GEEN managementvergoeding in de realisatiebron
 * — dat is een BRONFEIT, geen businessregel; het ontbreken van historische
 * realisatie bepaalt NOOIT automatisch dat de begroting €0 moet zijn).
 *
 * CORRECTIE (2026-09-03, businessbeslissing na review): de eerste versie
 * van deze module kende maar twee invoerwijzen ("indexeer bestaand" /
 * "nieuw bedrag") en liet een nieuw bedrag altijd vóór de ingangsdatum op
 * €0 vallen. Dat verwarde twee zakelijk fundamenteel verschillende
 * situaties: (a) een bestaand bedrag dat vanaf een datum wordt VERVANGEN
 * door een nieuw absoluut bedrag (het bestaande bedrag blijft daarvóór
 * gelden — een begroting zou anders stilzwijgend 6+ maanden reële
 * managementkosten kwijtraken), en (b) een vergoeding die vóór haar
 * ingangsdatum werkelijk nog niet bestond. Beide zijn nu expliciet, apart
 * gemodelleerd — zie de drie invoerwijzen hieronder.
 *
 * Architectuurgrens (zelfde als Module 1/2): geen cache/SQLite/Excel/
 * bestanden/klok/IO. Signatuur is uitsluitend: expliciete begrotingsinvoer →
 * berekende Module-3-uitkomst. GEEN bronfeiten hier — indexatiepercentage,
 * indexatiedatum, bestaand/nieuw bedrag en ingangsdatum zijn stuk voor stuk
 * expliciete begrotingsinvoer (er is dus ook geen `bronPeildatum`).
 *
 * Managementvergoeding ≠ Beheervergoeding (OB-026: aparte P&L-posten met een
 * gezamenlijk subtotaal). Deze module importeert daarom BEWUST GEEN functie
 * of type uit `begroteBeheersvergoeding.ts` — alleen de volledig neutrale
 * `BgControleErnst`-vocabulaire (KRITIEK/WAARSCHUWING/INFORMATIEF) wordt
 * hergebruikt, die draagt geen beheer-/managementspecifieke betekenis.
 *
 * STATELESS / GEEN VERBORGEN AFHANKELIJKHEID (businessbeslissing 2): een
 * "bestaand bedrag" (`INDEXEER_BESTAAND`/`WIJZIG_BESTAAND_BEDRAG`) is ALTIJD
 * expliciete invoer van DEZE aanroep — nooit afgeleid uit een eerdere
 * aanroep, sessiestate, cache of vorige begrotingsversie. Een latere
 * orchestratie-/UI-laag mag dit bedrag voorinvullen (bron, vorige begroting,
 * handmatige invoer), maar de herkomst is voor deze functie irrelevant en
 * wordt hier niet vastgelegd.
 *
 * "GEEN BRONBEDRAG BEKEND" IS GEEN VIERDE MECHANISME (businessbeslissing 3):
 * dat is een bron-/orchestratiestatus, geen rekenmechanisme. Deze module
 * kent daarom GEEN wijze voor "onbekend" — een aanroeper die geen betrouwbaar
 * bronvoorstel heeft, kiest zelf welke van de drie wijzen past (bv.
 * `WIJZIG_BESTAAND_BEDRAG` met een handmatig door de gebruiker ingevoerd
 * bestaand bedrag, óók als de boekhouding zelf geen voorstel levert — zie
 * het 070-voorbeeld in de businessbeslissing).
 *
 * €0 ≠ ONBEKEND (belangrijke businessregel): een `Decimal(0)` betekent
 * hier ALTIJD een werkelijk bedrag van nul, nooit "onbekend"/"geen bron".
 * Bij `NIEUWE_VERGOEDING` is een €0-maandbedrag vóór de ingangsmaand geen
 * "bestaand bedrag van €0" — het betekent dat de vergoeding daar nog niet
 * bestond. Dat onderscheid zit in `invoer.wijze` (WIJZIG_BESTAAND_BEDRAG met
 * `bestaandBedrag = 0` vs. NIEUWE_VERGOEDING), NOOIT in de kale getalwaarde
 * zelf.
 *
 * VASTGESTELDE BUSINESSREGELS (2026-09-03):
 *
 * 1. DRIE EXCLUSIEVE INVOERWIJZEN:
 *    - `INDEXEER_BESTAAND`: een bekend bestaand bedrag, percentueel
 *      geïndexeerd vanaf een expliciete indexatiedatum. Bestaand bedrag
 *      blijft gelden vóór de indexatiemaand.
 *    - `WIJZIG_BESTAAND_BEDRAG`: een bekend bestaand bedrag, vanaf een
 *      expliciete ingangsdatum VERVANGEN door een nieuw, zelf ingevoerd
 *      absoluut bedrag (geen percentage). Bestaand bedrag blijft gelden
 *      vóór de ingangsmaand. Structureel hetzelfde mechanisme als Module 1's
 *      bewezen `BgToekomstigeKortingswijziging` (bevroren basiswaarde tot een
 *      datum, dan een nieuwe absolute waarde) — hier een EIGEN, onafhankelijke
 *      Module-3-implementatie, geen hergebruik van Module-1-code (die is
 *      contractgebonden bronlogica, semantisch niet passend hier).
 *    - `NIEUWE_VERGOEDING`: er bestond vóór de ingangsdatum werkelijk geen
 *      managementvergoeding. Vóór de ingangsmaand €0 (geen bestaand bedrag
 *      om voort te zetten), vanaf de ingangsmaand het nieuwe bedrag.
 *      `ingangsdatum === null` = geldt vanaf het begin van het begrotingsjaar.
 *
 * 2. MAAND/JAAR-EENHEID — elk ingevoerd bedrag heeft een eigen expliciete
 *    `eenheid` (`MAAND`|`JAAR`); de andere eenheid wordt deterministisch
 *    afgeleid via `Decimal`-vermenigvuldiging/-deling met 12, ZONDER
 *    tussentijdse afronding (zelfde conventie als Module 1/2 — geen
 *    `.toDecimalPlaces()` in de rekenlaag). Presentatie-afronding is een
 *    latere, aparte laag (OB-022), hier bewust niet gebouwd.
 *
 * 3. GEDEELDE MAANDSTRUCTUUR — voor alle drie wijzen geldt: `bedrag =
 *    basisBedrag + effect` per maand. `basisBedrag` is wat gold VÓÓR het
 *    mechanisme-effect (het bestaande bedrag bij INDEXEER_BESTAAND/
 *    WIJZIG_BESTAAND_BEDRAG — voor de volle 12 maanden constant, ongeacht of
 *    het effect die maand al actief is; bij NIEUWE_VERGOEDING per definitie
 *    0, alle 12 maanden). `effect` is 0 vóór de indexatie-/ingangsmaand en
 *    vanaf die maand: het indexatiebedrag (INDEXEER_BESTAAND), het verschil
 *    nieuw−bestaand (WIJZIG_BESTAAND_BEDRAG), of het volledige nieuwe bedrag
 *    (NIEUWE_VERGOEDING, want daar is `basisBedrag` altijd 0). Werkt op
 *    maandniveau, GEEN dagpro-rata: valt de datum in augustus, dan geldt het
 *    nieuwe/geïndexeerde bedrag de VOLLEDIGE maand augustus.
 *
 * 4. DATUM BUITEN HET BEGROTINGSJAAR — GEEN projectie (bewust NIET Module
 *    1's patroon, dat op een bewezen bronfeit-herhalingsinterval steunt dat
 *    hier niet bestaat):
 *    - datum vóór het begrotingsjaar → het effect was al eerder actief, dus
 *      geldt de VOLLE 12 maanden (bij WIJZIG_BESTAAND_BEDRAG/NIEUWE_VERGOEDING)
 *      resp. wordt NIET toegepast (bij INDEXEER_BESTAAND — indexatie is een
 *      eenmalige stap op een specifieke datum, geen blijvend "vanaf toen"-
 *      effect zoals een bedragvervanging; dit blijft ongewijzigd t.o.v. de
 *      eerste versie van deze module en Module 2's precedent).
 *    - datum ná het begrotingsjaar → het effect is dit jaar nog niet actief,
 *      dus 0 maanden effect (bestaand bedrag blijft de volle 12 maanden
 *      gelden bij WIJZIG_BESTAAND_BEDRAG; €0 de volle 12 maanden bij
 *      NIEUWE_VERGOEDING; geen indexatie bij INDEXEER_BESTAAND).
 *
 * 5. VALIDATIE — een negatief bedrag (bestaand of nieuw) is ONGELDIG
 *    (KRITIEK, Module 2's `vastBedragJaar`-precedent): de hele aanroep levert
 *    dan 12 maandbedragen van 0 (er is geen zinvolle deel-uitkomst als een
 *    van de twee bedragen bij WIJZIG_BESTAAND_BEDRAG ongeldig is). Een
 *    negatief indexatiepercentage is TOEGESTAAN (Module 2's
 *    `vastIndexatiePercentage`-precedent). Een ongeldige (NaN) `Decimal` of
 *    `Invalid Date` is KRITIEK, niet toegepast.
 *
 * BUITEN SCOPE (fase 2B, expliciet niet gebouwd — geen aanname):
 * - Herkomst/bronstatus van een bestaand bedrag (boekhouding, contract,
 *   vorige begroting, handmatig) — dat is orchestratie/persistence, hoort
 *   niet in de pure rekenlaag (businessbeslissing 3).
 * - Elke vorm van persistence, CLI, renderer, P&L-/grootboekintegratie,
 *   Estimated-koppeling aan echte realisatie, of complexgranulariteit (OB-026
 *   schrijft complexniveau niet voor).
 */

export type BgManagementControleErnst = BgControleErnst;

export interface BgManagementControleItem {
  ernst: BgManagementControleErnst;
  bericht: string;
}

export type BgGeldEenheid = "MAAND" | "JAAR";

/** Een ingevoerd bedrag, plus de deterministisch afgeleide andere eenheid — zie moduledoc punt 2. */
export interface BgManagementBedragEenheden {
  maand: Decimal;
  jaar: Decimal;
}

/** Wijze 1 (OB-026): een bekend bestaand bedrag percentueel indexeren vanaf een expliciete datum. */
export interface BgManagementIndexeerBestaandInvoer {
  wijze: "INDEXEER_BESTAAND";
  bestaandBedrag: Decimal;
  eenheid: BgGeldEenheid;
  indexatiePercentage: Decimal;
  indexatiedatum: Date;
}

/** Wijze 2 (businessbeslissing 2026-09-03): een bekend bestaand bedrag vanaf een expliciete datum vervangen door een nieuw absoluut bedrag. */
export interface BgManagementWijzigBestaandBedragInvoer {
  wijze: "WIJZIG_BESTAAND_BEDRAG";
  bestaandBedrag: Decimal;
  bestaandEenheid: BgGeldEenheid;
  nieuwBedrag: Decimal;
  nieuweEenheid: BgGeldEenheid;
  ingangsdatum: Date;
}

/** Wijze 3 (businessbeslissing 2026-09-03): een vergoeding die vóór haar ingangsdatum werkelijk nog niet bestond. `ingangsdatum === null` = vanaf het begin van het begrotingsjaar. */
export interface BgManagementNieuweVergoedingInvoer {
  wijze: "NIEUWE_VERGOEDING";
  bedrag: Decimal;
  eenheid: BgGeldEenheid;
  ingangsdatum: Date | null;
}

export type BgManagementInvoer = BgManagementIndexeerBestaandInvoer | BgManagementWijzigBestaandBedragInvoer | BgManagementNieuweVergoedingInvoer;

export interface BgManagementAannames {
  begrotingsjaar: number;
}

/** `bedrag = basisBedrag + effect` voor alle drie wijzen — zie moduledoc punt 3. */
export interface BgManagementMaandRegel {
  maand: number; // 1..12
  basisBedrag: Decimal;
  effect: Decimal;
  bedrag: Decimal;
}

export interface BgManagementJaartotalen {
  basisBedrag: Decimal;
  effect: Decimal;
  bedrag: Decimal;
}

export interface BgManagementResultaat {
  begrotingsjaar: number;
  /** De precieze invoer die is toegepast — traceerbaarheid (OB-023-achtig principe). */
  invoer: BgManagementInvoer;
  /** Bestaand bedrag in beide eenheden — alleen INDEXEER_BESTAAND/WIJZIG_BESTAAND_BEDRAG, anders `null`. */
  bestaandBedrag: BgManagementBedragEenheden | null;
  /** Nieuw bedrag in beide eenheden — alleen WIJZIG_BESTAAND_BEDRAG/NIEUWE_VERGOEDING, anders `null`. */
  nieuwBedrag: BgManagementBedragEenheden | null;
  /** Alleen gevuld bij INDEXEER_BESTAAND én daadwerkelijk toegepaste indexatie binnen het begrotingsjaar. */
  effectieveIndexatiedatum: Date | null;
  /** Alleen gevuld bij WIJZIG_BESTAAND_BEDRAG/NIEUWE_VERGOEDING én een ingangsdatum die binnen het begrotingsjaar valt. */
  effectieveIngangsdatum: Date | null;
  regels: BgManagementMaandRegel[];
  jaartotaal: BgManagementJaartotalen;
  controleVereist: BgManagementControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function isOngeldigDecimal(waarde: Decimal): boolean {
  return waarde.isNaN();
}

/** Leidt {maand, jaar} deterministisch af uit één ingevoerd bedrag + eenheid — geen afronding, zie moduledoc punt 2. */
function leidBedragEenhedenAf(bedrag: Decimal, eenheid: BgGeldEenheid): BgManagementBedragEenheden {
  return eenheid === "JAAR" ? { maand: bedrag.dividedBy(12), jaar: bedrag } : { maand: bedrag, jaar: bedrag.times(12) };
}

/**
 * Zelfde als `leidBedragEenhedenAf`, maar `null` voor elke waarde die door
 * de bijbehorende `bereken*`-functie als ONGELDIG is afgewezen (NaN óf
 * negatief — niet alleen NaN). Voorkomt dat het top-level resultaat een
 * afgewezen, niet-toegepast bedrag toch als een schijnbaar bruikbare
 * {maand, jaar}-waarde toont naast een KRITIEK-melding — zie moduledoc
 * "€0 ≠ ONBEKEND" en de validatieconventie hieronder.
 */
function geldigBedragEenhedenOfNull(bedrag: Decimal, eenheid: BgGeldEenheid): BgManagementBedragEenheden | null {
  if (isOngeldigDecimal(bedrag) || bedrag.isNegative()) return null;
  return leidBedragEenhedenAf(bedrag, eenheid);
}

function legeRegels(): BgManagementMaandRegel[] {
  return Array.from({ length: 12 }, (_, i) => ({ maand: i + 1, basisBedrag: new Decimal(0), effect: new Decimal(0), bedrag: new Decimal(0) }));
}

function jaartotaalVanRegels(regels: readonly BgManagementMaandRegel[]): BgManagementJaartotalen {
  return {
    basisBedrag: som(regels.map((r) => r.basisBedrag)),
    effect: som(regels.map((r) => r.effect)),
    bedrag: som(regels.map((r) => r.bedrag)),
  };
}

/** Bouwt 12 maandregels met een constante basis en een effect dat 0 is vóór `vanafMaand` en `effectWaarde` vanaf `vanafMaand` (of nooit, als `vanafMaand === null`). */
function bouwRegelsMetEffectVanaf(basisMaandBedrag: Decimal, effectWaarde: Decimal, vanafMaand: number | null): BgManagementMaandRegel[] {
  const regels: BgManagementMaandRegel[] = [];
  for (let maand = 1; maand <= 12; maand += 1) {
    const effectActief = vanafMaand !== null && maand >= vanafMaand;
    const effect = effectActief ? effectWaarde : new Decimal(0);
    regels.push({ maand, basisBedrag: basisMaandBedrag, effect, bedrag: basisMaandBedrag.plus(effect) });
  }
  return regels;
}

function berekenIndexeerBestaand(
  invoer: BgManagementIndexeerBestaandInvoer,
  begrotingsjaar: number,
): { regels: BgManagementMaandRegel[]; effectieveIndexatiedatum: Date | null; controleVereist: BgManagementControleItem[] } {
  const controleVereist: BgManagementControleItem[] = [];

  if (isOngeldigDecimal(invoer.bestaandBedrag)) {
    controleVereist.push({ ernst: "KRITIEK", bericht: `bestaandBedrag is geen geldig getal (NaN) — niet toegepast, alle maandbedragen 0.` });
    return { regels: legeRegels(), effectieveIndexatiedatum: null, controleVereist };
  }
  if (invoer.bestaandBedrag.isNegative()) {
    controleVereist.push({
      ernst: "KRITIEK",
      bericht: `bestaandBedrag is negatief (${invoer.bestaandBedrag.toString()}) — ongeldig, niet toegepast, alle maandbedragen 0.`,
    });
    return { regels: legeRegels(), effectieveIndexatiedatum: null, controleVereist };
  }

  const datumOngeldig = Number.isNaN(invoer.indexatiedatum.getTime());
  const percentageOngeldig = isOngeldigDecimal(invoer.indexatiePercentage);
  if (percentageOngeldig) controleVereist.push({ ernst: "KRITIEK", bericht: `indexatiePercentage is geen geldig getal (NaN) — geen indexatie toegepast.` });
  if (datumOngeldig) controleVereist.push({ ernst: "KRITIEK", bericht: `indexatiedatum is ongeldig (Invalid Date) — geen indexatie toegepast.` });

  const { maand: basisMaandBedrag } = leidBedragEenhedenAf(invoer.bestaandBedrag, invoer.eenheid);

  let indexatiemaand: number | null = null;
  let effectieveIndexatiedatum: Date | null = null;
  if (!datumOngeldig && !percentageOngeldig) {
    if (invoer.indexatiedatum.getUTCFullYear() === begrotingsjaar) {
      indexatiemaand = invoer.indexatiedatum.getUTCMonth() + 1;
      effectieveIndexatiedatum = invoer.indexatiedatum;
    } else {
      controleVereist.push({
        ernst: "WAARSCHUWING",
        bericht: `indexatiedatum (${invoer.indexatiedatum.toISOString().slice(0, 10)}) valt buiten begrotingsjaar ${begrotingsjaar} — geen indexatie toegepast (geen projectie, zie moduledoc).`,
      });
    }
  }

  const indexatiebedrag = !percentageOngeldig ? basisMaandBedrag.times(invoer.indexatiePercentage).dividedBy(100) : new Decimal(0);
  const regels = bouwRegelsMetEffectVanaf(basisMaandBedrag, indexatiebedrag, indexatiemaand);

  return { regels, effectieveIndexatiedatum, controleVereist };
}

function berekenWijzigBestaandBedrag(
  invoer: BgManagementWijzigBestaandBedragInvoer,
  begrotingsjaar: number,
): { regels: BgManagementMaandRegel[]; effectieveIngangsdatum: Date | null; controleVereist: BgManagementControleItem[] } {
  const controleVereist: BgManagementControleItem[] = [];

  if (isOngeldigDecimal(invoer.bestaandBedrag)) {
    controleVereist.push({ ernst: "KRITIEK", bericht: `bestaandBedrag is geen geldig getal (NaN) — niet toegepast, alle maandbedragen 0.` });
  } else if (invoer.bestaandBedrag.isNegative()) {
    controleVereist.push({
      ernst: "KRITIEK",
      bericht: `bestaandBedrag is negatief (${invoer.bestaandBedrag.toString()}) — ongeldig, niet toegepast, alle maandbedragen 0.`,
    });
  }
  if (isOngeldigDecimal(invoer.nieuwBedrag)) {
    controleVereist.push({ ernst: "KRITIEK", bericht: `nieuwBedrag is geen geldig getal (NaN) — niet toegepast, alle maandbedragen 0.` });
  } else if (invoer.nieuwBedrag.isNegative()) {
    controleVereist.push({
      ernst: "KRITIEK",
      bericht: `nieuwBedrag is negatief (${invoer.nieuwBedrag.toString()}) — ongeldig, niet toegepast, alle maandbedragen 0.`,
    });
  }
  if (Number.isNaN(invoer.ingangsdatum.getTime())) {
    controleVereist.push({ ernst: "KRITIEK", bericht: `ingangsdatum is ongeldig (Invalid Date) — niet toegepast, alle maandbedragen 0.` });
  }
  if (controleVereist.some((c) => c.ernst === "KRITIEK")) {
    return { regels: legeRegels(), effectieveIngangsdatum: null, controleVereist };
  }

  const { maand: basisMaandBedrag } = leidBedragEenhedenAf(invoer.bestaandBedrag, invoer.bestaandEenheid);
  const { maand: nieuwMaandBedrag } = leidBedragEenhedenAf(invoer.nieuwBedrag, invoer.nieuweEenheid);
  const wijzigingsEffect = nieuwMaandBedrag.minus(basisMaandBedrag);

  const ingangsjaar = invoer.ingangsdatum.getUTCFullYear();
  let vanafMaand: number | null;
  let effectieveIngangsdatum: Date | null;
  if (ingangsjaar < begrotingsjaar) {
    vanafMaand = 1; // al eerder gewijzigd — geldt de volle 12 maanden.
    effectieveIngangsdatum = null;
  } else if (ingangsjaar > begrotingsjaar) {
    vanafMaand = null; // nog niet gewijzigd dit jaar — bestaand bedrag blijft de volle 12 maanden gelden.
    effectieveIngangsdatum = null;
    controleVereist.push({
      ernst: "INFORMATIEF",
      bericht: `ingangsdatum (${invoer.ingangsdatum.toISOString().slice(0, 10)}) ligt ná begrotingsjaar ${begrotingsjaar} — nog niet gewijzigd, bestaand bedrag blijft de volle 12 maanden gelden.`,
    });
  } else {
    vanafMaand = invoer.ingangsdatum.getUTCMonth() + 1;
    effectieveIngangsdatum = invoer.ingangsdatum;
    if (vanafMaand > 1) {
      controleVereist.push({
        ernst: "INFORMATIEF",
        bericht: `Bestaand bedrag geldt t/m maand ${vanafMaand - 1}, nieuw bedrag vanaf maand ${vanafMaand} van begrotingsjaar ${begrotingsjaar}.`,
      });
    }
  }

  const regels = bouwRegelsMetEffectVanaf(basisMaandBedrag, wijzigingsEffect, vanafMaand);
  return { regels, effectieveIngangsdatum, controleVereist };
}

function berekenNieuweVergoeding(
  invoer: BgManagementNieuweVergoedingInvoer,
  begrotingsjaar: number,
): { regels: BgManagementMaandRegel[]; effectieveIngangsdatum: Date | null; controleVereist: BgManagementControleItem[] } {
  const controleVereist: BgManagementControleItem[] = [];

  if (isOngeldigDecimal(invoer.bedrag)) {
    controleVereist.push({ ernst: "KRITIEK", bericht: `bedrag is geen geldig getal (NaN) — niet toegepast, alle maandbedragen 0.` });
    return { regels: legeRegels(), effectieveIngangsdatum: null, controleVereist };
  }
  if (invoer.bedrag.isNegative()) {
    controleVereist.push({
      ernst: "KRITIEK",
      bericht: `bedrag is negatief (${invoer.bedrag.toString()}) — ongeldig, niet toegepast, alle maandbedragen 0.`,
    });
    return { regels: legeRegels(), effectieveIngangsdatum: null, controleVereist };
  }
  if (invoer.ingangsdatum !== null && Number.isNaN(invoer.ingangsdatum.getTime())) {
    controleVereist.push({ ernst: "KRITIEK", bericht: `ingangsdatum is ongeldig (Invalid Date) — niet toegepast, alle maandbedragen 0.` });
    return { regels: legeRegels(), effectieveIngangsdatum: null, controleVereist };
  }

  const { maand: nieuwMaandBedrag } = leidBedragEenhedenAf(invoer.bedrag, invoer.eenheid);

  if (invoer.ingangsdatum === null) {
    return { regels: bouwRegelsMetEffectVanaf(new Decimal(0), nieuwMaandBedrag, 1), effectieveIngangsdatum: null, controleVereist };
  }

  const ingangsjaar = invoer.ingangsdatum.getUTCFullYear();
  if (ingangsjaar > begrotingsjaar) {
    controleVereist.push({
      ernst: "INFORMATIEF",
      bericht: `ingangsdatum (${invoer.ingangsdatum.toISOString().slice(0, 10)}) ligt ná begrotingsjaar ${begrotingsjaar} — nog niet ingegaan, alle maandbedragen 0 (deze vergoeding bestond nog niet).`,
    });
    return { regels: legeRegels(), effectieveIngangsdatum: null, controleVereist };
  }
  if (ingangsjaar < begrotingsjaar) {
    return { regels: bouwRegelsMetEffectVanaf(new Decimal(0), nieuwMaandBedrag, 1), effectieveIngangsdatum: null, controleVereist };
  }

  const ingangsmaand = invoer.ingangsdatum.getUTCMonth() + 1;
  if (ingangsmaand > 1) {
    controleVereist.push({
      ernst: "INFORMATIEF",
      bericht: `Nieuwe vergoeding gaat in per maand ${ingangsmaand} van begrotingsjaar ${begrotingsjaar} — vóór die maand bestond deze vergoeding nog niet (€ 0, geen bestaand bedrag van nul).`,
    });
  }

  return {
    regels: bouwRegelsMetEffectVanaf(new Decimal(0), nieuwMaandBedrag, ingangsmaand),
    effectieveIngangsdatum: invoer.ingangsdatum,
    controleVereist,
  };
}

export function berekenBegroteManagementvergoeding(invoer: BgManagementInvoer, aannames: BgManagementAannames): BgManagementResultaat {
  const basis = {
    begrotingsjaar: aannames.begrotingsjaar,
    invoer,
    bestaandBedrag: null as BgManagementBedragEenheden | null,
    nieuwBedrag: null as BgManagementBedragEenheden | null,
    effectieveIndexatiedatum: null as Date | null,
    effectieveIngangsdatum: null as Date | null,
  };

  if (invoer.wijze === "INDEXEER_BESTAAND") {
    const { regels, effectieveIndexatiedatum, controleVereist } = berekenIndexeerBestaand(invoer, aannames.begrotingsjaar);
    return {
      ...basis,
      bestaandBedrag: geldigBedragEenhedenOfNull(invoer.bestaandBedrag, invoer.eenheid),
      effectieveIndexatiedatum,
      regels,
      jaartotaal: jaartotaalVanRegels(regels),
      controleVereist,
    };
  }

  if (invoer.wijze === "WIJZIG_BESTAAND_BEDRAG") {
    const { regels, effectieveIngangsdatum, controleVereist } = berekenWijzigBestaandBedrag(invoer, aannames.begrotingsjaar);
    return {
      ...basis,
      bestaandBedrag: geldigBedragEenhedenOfNull(invoer.bestaandBedrag, invoer.bestaandEenheid),
      nieuwBedrag: geldigBedragEenhedenOfNull(invoer.nieuwBedrag, invoer.nieuweEenheid),
      effectieveIngangsdatum,
      regels,
      jaartotaal: jaartotaalVanRegels(regels),
      controleVereist,
    };
  }

  const { regels, effectieveIngangsdatum, controleVereist } = berekenNieuweVergoeding(invoer, aannames.begrotingsjaar);
  return {
    ...basis,
    nieuwBedrag: geldigBedragEenhedenOfNull(invoer.bedrag, invoer.eenheid),
    effectieveIngangsdatum,
    regels,
    jaartotaal: jaartotaalVanRegels(regels),
    controleVereist,
  };
}
