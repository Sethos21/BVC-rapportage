import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * Begrote Algemene kosten — OB-035 (Accountant) + OB-036 (Algemene/
 * Juridische/Makelaars-/Bankkosten): UITSLUITEND de pure rekenlaag, conform
 * het goedgekeurde brononderzoek en de businessbesluiten uit die sessie.
 *
 * VIJF ECONOMISCHE CATEGORIEËN, ÉÉN GENERIEKE MOTOR (kernontwerpbeslissing):
 * ACCOUNTANT / ALGEMENE_KOSTEN / JURIDISCHE_KOSTEN / MAKELAARSKOSTEN /
 * BANKKOSTEN zijn vijf onafhankelijke, afzonderlijk herleidbare P&L-posten —
 * ze verdwijnen NOOIT in één gezamenlijk bedrag (`perCategorie` plus de vijf
 * met naam benoemde totalen `accountantskosten`/`algemeneKosten`/
 * `juridischeKosten`/`makelaarskosten`/`bankkosten` op het resultaat). Het
 * TECHNISCHE model is wél generiek: één regelvorm, één validatiepad, één
 * reviewmodel, hergebruikt voor alle vijf — geen vijf gekopieerde
 * calculators.
 *
 * OGB-KOSTENSOORT IS DE INHOUDELIJKE SPECIFICATIEDIMENSIE, GEEN TWEEDE
 * WAARHEID: deze module bevat GEEN eigen OGB→categorie-kennis. De
 * (administratie-specifieke, buiten deze module opgeslagen/geresolved)
 * lokale algemene-kostenclassificatie wordt als expliciete, pure
 * `classificatie`-parameter aangeleverd (`BgAlgemeneKostenClassificatieRegel[]`)
 * — deze module query't nooit een config/database, en kent zelf geen enkele
 * hardcoded OGB-code. `ogbKostensoortOmschrijving` op een regeluitkomst komt
 * ALTIJD uit een geslaagde lookup in die classificatie, nooit uit vrije tekst
 * op de regel zelf ("nooit joinen op omschrijving").
 *
 * SCOPE VAN DE CLASSIFICATIE (GL 4900–4999) IS GEEN ZAAK VAN DEZE MODULE:
 * de eerste gate ("hoort deze boeking OGB-technisch in het algemene-
 * kostenblok, GL 4900–4999?") hoort bij een LATERE Werkelijk-integratie, die
 * hier expliciet NIET wordt gebouwd. Deze pure module rekent uitsluitend op
 * basis van reeds-ingevoerde begrotingsregels + een reeds-geresolved
 * classificatie — geen boekingen, geen grootboekrekeningen, geen GL-filter.
 *
 * EEN REGEL ZONDER OGB-KOPPELING IS GELDIG (`ogbKostensoortCode: null`) —
 * noodzakelijk voor ACCOUNTANT/JURIDISCHE_KOSTEN, waarvoor het brononderzoek
 * geen bewezen OGB-kostensoort opleverde. Geen fictieve code wordt ooit
 * afgedwongen.
 *
 * OGB-VALIDATIE (twee, en slechts twee, foutgevallen): een opgegeven
 * `ogbKostensoortCode` die niet voorkomt in `classificatie` is KRITIEK
 * (onbekende code); een code die wél bestaat maar bij een ANDERE categorie
 * hoort is eveneens KRITIEK (categorie-mismatch — voorkomt dat een
 * bankkosten-code per ongeluk onder Juridische kosten wordt ingevoerd). Een
 * geldige match levert de gepresenteerde `<code> — <omschrijving>` op via de
 * classificatie, nooit via de regel zelf.
 *
 * FUNCTIONEEL ONVOLLEDIG ≠ FINANCIEEL ONBEREKENBAAR (zelfde principe als elke
 * eerdere begrotingsmodule): een lege `omschrijving` of een onbekende/
 * mismatchende OGB-code geeft een KRITIEK-control, maar laat de financiële
 * `jaarbedrag`-bijdrage ongemoeid. Alleen een ontbrekend/NaN `jaarbedrag`
 * zelf triggert de veilige 0-bijdrage.
 *
 * REKENHULP ACCOUNTANT/BANKKOSTEN (`vorigJaarBedrag`/
 * `verwachteVerhogingPercentage` → `berekendVoorstel`, OB-035/036 §9): puur
 * informatief, structureel op ELKE categorie beschikbaar (generiek model,
 * geen categorie-specifieke branch in de code) maar functioneel vooral
 * bedoeld voor ACCOUNTANT/BANKKOSTEN. `berekendVoorstel` wijzigt NOOIT de
 * regels of `categorieTotaal` — het authoritative begrotingstotaal blijft
 * uitsluitend de som van de handmatige regels. `berekendVoorstel` is `null`
 * zodra één van beide invoerwaarden ontbreekt of ongeldig (NaN) is; een
 * expliciete `Decimal(0)` is voor beide velden een geldige waarde.
 *
 * REVIEW PER CATEGORIE, ONAFHANKELIJK VAN REGELMUTATIES: `beoordeeld` is
 * pure doorgegeven invoer per categorie, nooit afgeleid uit `regels.length`
 * of uit de aanwezigheid van KRITIEKE controls. `beoordeeld=true` met 0
 * regels voor een categorie is een bewuste, geldige €0-begroting voor die
 * ENE categorie (`REVIEWED_ZERO_RULES`) — een andere categorie kan
 * tegelijkertijd `NOT_REVIEWED` zijn.
 *
 * BUITEN SCOPE (deze fase, expliciet niet gebouwd — geen aanname): Werkelijk/
 * historische GL-import, Estimated, P&L-rendering, UI, een generieke
 * OGB-classificatie-engine voor andere exploitatiekostenmodules, classificatie
 * van OGB 4991 (Afronding/betalingsversch), complexvalidatie/-aggregatie,
 * persistence/frozen (zie `@bvc/begroting-data`).
 */

export const ALGEMENE_KOSTEN_CATEGORIEEN = [
  "ACCOUNTANT",
  "ALGEMENE_KOSTEN",
  "JURIDISCHE_KOSTEN",
  "MAKELAARSKOSTEN",
  "BANKKOSTEN",
] as const;
export type BgAlgemeneKostenCategorie = (typeof ALGEMENE_KOSTEN_CATEGORIEEN)[number];

export type BgAlgemeneKostenControleErnst = BgControleErnst;

export interface BgAlgemeneKostenControleItem {
  categorie: BgAlgemeneKostenCategorie;
  /** Positie van de betrokken regel BINNEN de regels van deze categorie — `null` = categoriebreed (bv. de rekenhulp), niet aan één regel toe te wijzen. */
  regelIndex: number | null;
  ernst: BgAlgemeneKostenControleErnst;
  bericht: string;
}

/**
 * Eén regel van de lokale algemene-kostenclassificatie (GL 4900–4999),
 * administratie-specifiek geresolved en als pure invoer aangeleverd — deze
 * module leest of query't zelf nooit een classificatieconfig/database (zie
 * moduledoc).
 */
export interface BgAlgemeneKostenClassificatieRegel {
  ogbKostensoort: string;
  ogbKostensoortOmschrijving: string;
  categorie: BgAlgemeneKostenCategorie;
}

export interface BgAlgemeneKostenRegelInvoer {
  categorie: BgAlgemeneKostenCategorie;
  /** `null` = geen OGB-koppeling — structureel geldig (o.a. ACCOUNTANT/JURIDISCHE_KOSTEN zonder bewezen code). */
  ogbKostensoortCode: string | null;
  omschrijving: string;
  /** `null` = administratiebreed, geen validatie/aggregatie op dit veld (buiten scope, zie moduledoc). */
  complexnummer: string | null;
  /** `null` = nog niet ingevoerd — GEEN default naar 0. */
  jaarbedrag: Decimal | null;
}

export interface BgAlgemeneKostenCategorieAannames {
  beoordeeld: boolean;
  /** Rekenhulp (OB-035/036 §9) — puur informatief, zie moduledoc. */
  vorigJaarBedrag: Decimal | null;
  verwachteVerhogingPercentage: Decimal | null;
}

export type BgAlgemeneKostenReviewStatus = "NOT_REVIEWED" | "REVIEWED_ZERO_RULES" | "REVIEWED_WITH_RULES";

export interface BgAlgemeneKostenRegelUitkomst {
  /** Positie binnen de regels van DEZE categorie (na filtering op categorie) — geen businessbetekenis buiten deze aanroep. */
  index: number;
  invoer: BgAlgemeneKostenRegelInvoer;
  /** Uitsluitend gevuld bij een geldige, bekende OGB-koppeling binnen de juiste categorie — ALTIJD via de classificatie geresolved (moduledoc). */
  ogbKostensoortOmschrijving: string | null;
  /** Veilige berekende bijdrage: `null`/NaN jaarbedrag is al naar 0 herleid; een negatief bedrag blijft ongewijzigd. */
  jaarbedrag: Decimal;
}

export interface BgAlgemeneKostenCategorieResultaat {
  categorie: BgAlgemeneKostenCategorie;
  /** Pure doorgifte van de aanname — nooit hier afgeleid. */
  beoordeeld: boolean;
  reviewStatus: BgAlgemeneKostenReviewStatus;
  regels: BgAlgemeneKostenRegelUitkomst[];
  categorieTotaal: Decimal;
  /** Pure doorgifte van de aanname — traceerbaarheid. */
  vorigJaarBedrag: Decimal | null;
  /** Pure doorgifte van de aanname — traceerbaarheid. */
  verwachteVerhogingPercentage: Decimal | null;
  /** `vorigJaarBedrag × (1 + verwachteVerhogingPercentage/100)` indien beide geldig, anders `null`. Uitsluitend rekenhulp — wijzigt nooit `categorieTotaal`. */
  berekendVoorstel: Decimal | null;
}

export interface BgAlgemeneKostenResultaat {
  begrotingsjaar: number;
  /** Vaste volgorde: `ALGEMENE_KOSTEN_CATEGORIEEN`. */
  perCategorie: BgAlgemeneKostenCategorieResultaat[];
  accountantskosten: Decimal;
  algemeneKosten: Decimal;
  juridischeKosten: Decimal;
  makelaarskosten: Decimal;
  bankkosten: Decimal;
  /** Som van de vijf categorieTotalen. */
  moduleTotaal: Decimal;
  controleVereist: BgAlgemeneKostenControleItem[];
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

function veiligJaarbedrag(waarde: Decimal | null): Decimal {
  return isGeldigDecimal(waarde) ? waarde : new Decimal(0);
}

function valideerRegel(
  invoer: BgAlgemeneKostenRegelInvoer,
  index: number,
  classificatie: readonly BgAlgemeneKostenClassificatieRegel[],
): { controleVereist: BgAlgemeneKostenControleItem[]; ogbKostensoortOmschrijving: string | null } {
  const controleVereist: BgAlgemeneKostenControleItem[] = [];
  const meld = (bericht: string, ernst: BgAlgemeneKostenControleErnst = "KRITIEK") =>
    controleVereist.push({ categorie: invoer.categorie, regelIndex: index, ernst, bericht });

  if (leeg(invoer.omschrijving)) {
    meld(`${invoer.categorie} regel ${index}: omschrijving ontbreekt — verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
  }

  if (invoer.jaarbedrag === null) {
    meld(`${invoer.categorie} regel ${index}: jaarbedrag ontbreekt — verplicht voor vaststellen; veilige bijdrage 0 toegepast.`);
  } else if (invoer.jaarbedrag.isNaN()) {
    meld(`${invoer.categorie} regel ${index}: jaarbedrag is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
  } else if (invoer.jaarbedrag.isNegative()) {
    meld(`${invoer.categorie} regel ${index}: jaarbedrag is negatief (${invoer.jaarbedrag.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
  }

  let ogbKostensoortOmschrijving: string | null = null;
  if (invoer.ogbKostensoortCode !== null) {
    const gevonden = classificatie.find((c) => c.ogbKostensoort === invoer.ogbKostensoortCode);
    if (gevonden === undefined) {
      meld(
        `${invoer.categorie} regel ${index}: OGB-kostensoort "${invoer.ogbKostensoortCode}" komt niet voor in de lokale algemene-kostenclassificatie van deze administratie — onbekende code.`,
      );
    } else if (gevonden.categorie !== invoer.categorie) {
      meld(
        `${invoer.categorie} regel ${index}: OGB-kostensoort "${invoer.ogbKostensoortCode}" is in de classificatie gekoppeld aan ${gevonden.categorie}, niet aan ${invoer.categorie}.`,
      );
    } else {
      ogbKostensoortOmschrijving = gevonden.ogbKostensoortOmschrijving;
    }
  }

  return { controleVereist, ogbKostensoortOmschrijving };
}

function berekenCategorie(
  categorie: BgAlgemeneKostenCategorie,
  regelsInvoer: readonly BgAlgemeneKostenRegelInvoer[],
  aannames: BgAlgemeneKostenCategorieAannames,
  classificatie: readonly BgAlgemeneKostenClassificatieRegel[],
): { resultaat: BgAlgemeneKostenCategorieResultaat; controleVereist: BgAlgemeneKostenControleItem[] } {
  const controleVereist: BgAlgemeneKostenControleItem[] = [];

  const regels: BgAlgemeneKostenRegelUitkomst[] = regelsInvoer.map((invoer, index) => {
    const { controleVereist: meldingen, ogbKostensoortOmschrijving } = valideerRegel(invoer, index, classificatie);
    controleVereist.push(...meldingen);
    return { index, invoer, ogbKostensoortOmschrijving, jaarbedrag: veiligJaarbedrag(invoer.jaarbedrag) };
  });

  const categorieTotaal = som(regels.map((r) => r.jaarbedrag));

  const reviewStatus: BgAlgemeneKostenReviewStatus = !aannames.beoordeeld
    ? "NOT_REVIEWED"
    : regels.length === 0
      ? "REVIEWED_ZERO_RULES"
      : "REVIEWED_WITH_RULES";

  if (aannames.vorigJaarBedrag !== null) {
    if (aannames.vorigJaarBedrag.isNaN()) {
      controleVereist.push({
        categorie,
        regelIndex: null,
        ernst: "KRITIEK",
        bericht: `${categorie}: vorigJaarBedrag is geen geldig getal (NaN) — rekenhulp-voorstel niet berekend.`,
      });
    } else if (aannames.vorigJaarBedrag.isNegative()) {
      controleVereist.push({
        categorie,
        regelIndex: null,
        ernst: "WAARSCHUWING",
        bericht: `${categorie}: vorigJaarBedrag is negatief (${aannames.vorigJaarBedrag.toString()}) — toegestaan, rekenkundig verwerkt.`,
      });
    }
  }
  if (aannames.verwachteVerhogingPercentage !== null) {
    if (aannames.verwachteVerhogingPercentage.isNaN()) {
      controleVereist.push({
        categorie,
        regelIndex: null,
        ernst: "KRITIEK",
        bericht: `${categorie}: verwachteVerhogingPercentage is geen geldig getal (NaN) — rekenhulp-voorstel niet berekend.`,
      });
    } else if (aannames.verwachteVerhogingPercentage.isNegative()) {
      controleVereist.push({
        categorie,
        regelIndex: null,
        ernst: "WAARSCHUWING",
        bericht: `${categorie}: verwachteVerhogingPercentage is negatief (${aannames.verwachteVerhogingPercentage.toString()}) — toegestaan, rekenkundig verwerkt.`,
      });
    }
  }

  const berekendVoorstel =
    isGeldigDecimal(aannames.vorigJaarBedrag) && isGeldigDecimal(aannames.verwachteVerhogingPercentage)
      ? aannames.vorigJaarBedrag.times(new Decimal(1).plus(aannames.verwachteVerhogingPercentage.dividedBy(100)))
      : null;

  return {
    resultaat: {
      categorie,
      beoordeeld: aannames.beoordeeld,
      reviewStatus,
      regels,
      categorieTotaal,
      vorigJaarBedrag: aannames.vorigJaarBedrag,
      verwachteVerhogingPercentage: aannames.verwachteVerhogingPercentage,
      berekendVoorstel,
    },
    controleVereist,
  };
}

export function berekenBegroteAlgemeneKosten(
  regelsInvoer: readonly BgAlgemeneKostenRegelInvoer[],
  categorieAannames: Record<BgAlgemeneKostenCategorie, BgAlgemeneKostenCategorieAannames>,
  classificatie: readonly BgAlgemeneKostenClassificatieRegel[],
  context: { begrotingsjaar: number },
): BgAlgemeneKostenResultaat {
  const controleVereist: BgAlgemeneKostenControleItem[] = [];

  const perCategorie: BgAlgemeneKostenCategorieResultaat[] = ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie) => {
    const regelsVoorCategorie = regelsInvoer.filter((r) => r.categorie === categorie);
    const { resultaat, controleVereist: meldingen } = berekenCategorie(categorie, regelsVoorCategorie, categorieAannames[categorie], classificatie);
    controleVereist.push(...meldingen);
    return resultaat;
  });

  const totaalVoor = (categorie: BgAlgemeneKostenCategorie): Decimal => perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;

  return {
    begrotingsjaar: context.begrotingsjaar,
    perCategorie,
    accountantskosten: totaalVoor("ACCOUNTANT"),
    algemeneKosten: totaalVoor("ALGEMENE_KOSTEN"),
    juridischeKosten: totaalVoor("JURIDISCHE_KOSTEN"),
    makelaarskosten: totaalVoor("MAKELAARSKOSTEN"),
    bankkosten: totaalVoor("BANKKOSTEN"),
    moduleTotaal: som(perCategorie.map((c) => c.categorieTotaal)),
    controleVereist,
  };
}
