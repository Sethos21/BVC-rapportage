import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";

/**
 * Rente — OB-037 (Rentekosten) + OB-038 (Rente opbrengsten): ÉÉN
 * samenhangende Begroting–Werkelijk–Estimated-module voor twee AFZONDERLIJKE
 * P&L-posten, conform het goedgekeurde brononderzoek (2026-09,
 * 023_Malcon_Beheer_BV voor Rentekosten/GL 4600, 013 voor Rente
 * opbrengsten/GL 4620) en de businessbesluiten uit die sessie. Uitsluitend
 * de pure rekenlaag.
 *
 * TWEE AFZONDERLIJKE P&L-POSTEN, GEEN GEZAMENLIJK MODULETOTAAL: anders dan
 * OB-031 (drie sub-categorieën van ÉÉN hoofdregel "Leegstandskosten") zijn
 * Rentekosten en Rente opbrengsten twee losse posten — deze module telt ze
 * daarom NOOIT bij elkaar op tot één gecombineerd bedrag. `perCategorie`
 * blijft de enige aggregatievorm; er is bewust geen `moduleTotaal`.
 *
 * REKENHULP IS PER REGEL, NIET PER CATEGORIE (bewust afwijkend van OB-031/
 * OB-035/036, waar de rekenhulp categoriebreed was): elke financieringsregel
 * (een lening, een R/C, een spaarrekening) heeft zijn EIGEN
 * `laatstBekendSaldo` en `rentepercentage` — een categoriebrede rekenhulp
 * zou hier geen betekenis hebben zodra een categorie meerdere, onafhankelijke
 * financieringen bevat. `berekendVoorstel = laatstBekendSaldo ×
 * rentepercentage / 100` per regel, puur informatief, wijzigt nooit
 * `begrotingsbedrag` (het daadwerkelijk meetellende bedrag) of
 * `categorieTotaal`.
 *
 * GEEN LENINGMASTER, GEEN AUTOMATISCHE OGB→LENING-KOPPELING: `ogbReferentie`
 * op een regel is een vrij, puur informatief tekstveld (bv. "OGB 4606 —
 * lening 747") — deze module leest, valideert of joint er nooit op. Het
 * bronproef toonde dat een leningidentiteit alleen uit vrije tekst
 * (OGB-/rekeningomschrijving) is af te leiden, nooit betrouwbaar
 * gestructureerd — die aanname wordt hier bewust niet gemaakt.
 * `laatstBekendSaldo` is BEWUST een handmatige invoer (geen BRON/HANDMATIG-
 * herkomstonderscheid zoals bij OB-031's servicekostenvoorschot): er bestaat
 * voor Rente geen automatische bronkoppeling om ooit als "BRON" te
 * markeren — het bronproef toonde uitdrukkelijk dat restschuld/percentage
 * niet gestructureerd beschikbaar zijn.
 *
 * COMPLEX IS OPTIONEEL, GEEN VERPLICHTE DIMENSIE: relevanter voor
 * RENTEKOSTEN (financiering kan aan een complex gekoppeld zijn) dan voor
 * RENTE_OPBRENGSTEN (bankrente is typisch niet complexgebonden — bewezen in
 * het bronproef: complex bleek daar een vermoedelijke systeem-default, geen
 * economisch signaal) — het datamodel dwingt geen verschil af, het staat
 * uitsluitend de gebruiker vrij het al dan niet in te vullen.
 *
 * FUNCTIONEEL ONVOLLEDIG ≠ FINANCIEEL ONBEREKENBAAR: een lege `omschrijving`
 * geeft een KRITIEK-control maar laat `begrotingsbedrag` ongemoeid. Alleen
 * een ontbrekend/NaN `begrotingsbedrag` zelf triggert de veilige
 * 0-bijdrage.
 *
 * REVIEW PER CATEGORIE: `beoordeeld` is pure doorgegeven invoer, nooit
 * afgeleid. `beoordeeld=true` met 0 regels is een geldige €0-begroting voor
 * die ene categorie (`REVIEWED_ZERO_RULES`).
 *
 * WERKELIJK (`berekenWerkelijkRente`): classificeert reeds-geselecteerde
 * boekingsregels via een expliciete, pure `classificatie`-parameter
 * (OGB-kostensoort → categorie) — ADMINISTRATIE-SPECIFIEK, nooit
 * portfolio-breed verondersteld. Bewezen: bij 023 betekent OGB 4604 "Rente
 * lening .500" (RENTEKOSTEN); bij 013 betekent DEZELFDE CODE 4604 "Rente
 * r/c" (RENTE_OPBRENGSTEN) — twee tegengestelde economische betekenissen.
 * Deze module kent zelf geen enkele hardcoded OGB-code; de classificatie is
 * altijd een door de aanroeper aangeleverde, administratie-specifieke
 * parameter. GL (bv. 4600/4620) dient uitsluitend als bronselectie/gate bij
 * het ophalen van boekingen, nooit als classificatiekenmerk zelf. Een
 * boeking met een onbekende/ontbrekende OGB-kostensoort wordt NOOIT
 * geraden — apart gehouden in `nietGeclassificeerd*`. Uitsplitsing per
 * OGB-kostensoort is uitsluitend ter onderbouwing; de P&L toont het
 * categorietotaal.
 *
 * ESTIMATED (`berekenEstimatedRente`, volgt het OB-030/OB-031-patroon):
 * `estimatedTotaal = werkelijkTotaal + verwachtingResterendJaar` per
 * categorie. `begrotingTotaal` wordt ONGEWIJZIGD doorgegeven — Estimated
 * berekent of muteert de Begroting nooit. Geen automatische extrapolatie op
 * basis van een impliciet percentage uit historische boekingen — de
 * verwachting is en blijft een handmatige businessaanname.
 *
 * ARCHITECTUURREGEL — VASTGESTELD BEVRIEST UITSLUITEND DE BEGROTING (zelfde
 * principe als OB-031): Werkelijk/Estimated zijn en blijven actuele
 * rapportagewaarden, bewegen mee met nieuwe boekingen/classificatiewijzigingen,
 * ook ná vaststellen. Geen belofte van reproduceerbaarheid van een historische
 * Werkelijk/Estimated-stand.
 *
 * BUITEN SCOPE (expliciet, geen aanname): Financieringslasten (bv.
 * bereidstellingsprovisie) als aparte P&L-post — het bronproef toonde dat
 * dit niet structureel betrouwbaar van rente te scheiden is (zit binnen
 * dezelfde OGB-kostensoort, alleen onderscheidbaar via vrije boekingstekst).
 * Geen leningmaster, geen automatische OGB→lening-Balans-GL-koppeling, geen
 * Worker-CLI-commando, persistence/frozen-lifecycle (zie
 * `@bvc/begroting-data`), UI/rendering.
 */

export const RENTE_CATEGORIEEN = ["RENTEKOSTEN", "RENTE_OPBRENGSTEN"] as const;
export type BgRenteCategorie = (typeof RENTE_CATEGORIEEN)[number];

export type BgRenteControleErnst = BgControleErnst;

export interface BgRenteControleItem {
  categorie: BgRenteCategorie;
  /** Positie van de betrokken regel BINNEN de regels van deze categorie — `null` = categoriebreed, niet aan één regel toe te wijzen. */
  regelIndex: number | null;
  ernst: BgRenteControleErnst;
  bericht: string;
}

// ── Begroting ────────────────────────────────────────────────────────────

export interface BgRenteRegelInvoer {
  categorie: BgRenteCategorie;
  omschrijving: string;
  /** `null` = geen complexkoppeling — optioneel, geen verplichte economische dimensie (zie moduledoc). */
  complexnummer: string | null;
  /** Puur informatieve referentie/notitie (bv. een OGB-kostensoort of leningomschrijving) — NOOIT gebruikt voor join/validatie/classificatie. */
  ogbReferentie: string | null;
  /** Restschuld (RENTEKOSTEN) of saldo-basis (RENTE_OPBRENGSTEN) — altijd handmatige invoer, geen automatische bronkoppeling. */
  laatstBekendSaldo: Decimal | null;
  /** Altijd handmatige invoer. */
  rentepercentage: Decimal | null;
  /** Het bedrag dat de gebruiker daadwerkelijk overneemt/invoert — dit telt mee in `categorieTotaal`, NOOIT `berekendVoorstel` zelf. */
  begrotingsbedrag: Decimal | null;
}

export interface BgRenteCategorieAannames {
  beoordeeld: boolean;
}

export type BgRenteReviewStatus = "NOT_REVIEWED" | "REVIEWED_ZERO_RULES" | "REVIEWED_WITH_RULES";

export interface BgRenteRegelUitkomst {
  /** Positie binnen de regels van DEZE categorie (na filtering op categorie). */
  index: number;
  invoer: BgRenteRegelInvoer;
  /** `laatstBekendSaldo × (rentepercentage / 100)` indien beide geldig, anders `null`. Uitsluitend rekenhulp — wijzigt nooit `bedrag`/`categorieTotaal`. */
  berekendVoorstel: Decimal | null;
  /** Veilige bijdrage: `null`/NaN `begrotingsbedrag` is al naar 0 herleid, negatief blijft ongewijzigd. */
  bedrag: Decimal;
}

export interface BgRenteCategorieResultaat {
  categorie: BgRenteCategorie;
  /** Pure doorgifte van de aanname — nooit hier afgeleid. */
  beoordeeld: boolean;
  reviewStatus: BgRenteReviewStatus;
  regels: BgRenteRegelUitkomst[];
  categorieTotaal: Decimal;
}

export interface BgRenteResultaat {
  begrotingsjaar: number;
  /** Vaste volgorde: `RENTE_CATEGORIEEN`. */
  perCategorie: BgRenteCategorieResultaat[];
  rentekosten: Decimal;
  renteOpbrengsten: Decimal;
  controleVereist: BgRenteControleItem[];
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

function valideerRegel(invoer: BgRenteRegelInvoer, index: number): { controleVereist: BgRenteControleItem[]; bedrag: Decimal; berekendVoorstel: Decimal | null } {
  const controleVereist: BgRenteControleItem[] = [];
  const meld = (bericht: string, ernst: BgRenteControleErnst = "KRITIEK") => controleVereist.push({ categorie: invoer.categorie, regelIndex: index, ernst, bericht });

  if (leeg(invoer.omschrijving)) {
    meld(`${invoer.categorie} regel ${index}: omschrijving ontbreekt — verplicht voor vaststellen; bedrag blijft financieel meetellen.`);
  }

  if (invoer.begrotingsbedrag === null) {
    meld(`${invoer.categorie} regel ${index}: begrotingsbedrag ontbreekt — verplicht voor vaststellen; veilige bijdrage 0 toegepast.`);
  } else if (invoer.begrotingsbedrag.isNaN()) {
    meld(`${invoer.categorie} regel ${index}: begrotingsbedrag is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
  } else if (invoer.begrotingsbedrag.isNegative()) {
    meld(`${invoer.categorie} regel ${index}: begrotingsbedrag is negatief (${invoer.begrotingsbedrag.toString()}) — toegestaan, telt volledig mee.`, "WAARSCHUWING");
  }

  if (invoer.laatstBekendSaldo !== null) {
    if (invoer.laatstBekendSaldo.isNaN()) {
      meld(`${invoer.categorie} regel ${index}: laatstBekendSaldo is geen geldig getal (NaN) — rekenhulp-voorstel niet berekend.`);
    } else if (invoer.laatstBekendSaldo.isNegative()) {
      meld(`${invoer.categorie} regel ${index}: laatstBekendSaldo is negatief (${invoer.laatstBekendSaldo.toString()}) — toegestaan, rekenkundig verwerkt.`, "WAARSCHUWING");
    }
  }
  if (invoer.rentepercentage !== null) {
    if (invoer.rentepercentage.isNaN()) {
      meld(`${invoer.categorie} regel ${index}: rentepercentage is geen geldig getal (NaN) — rekenhulp-voorstel niet berekend.`);
    } else if (invoer.rentepercentage.isNegative()) {
      meld(`${invoer.categorie} regel ${index}: rentepercentage is negatief (${invoer.rentepercentage.toString()}) — toegestaan, rekenkundig verwerkt.`, "WAARSCHUWING");
    }
  }

  const berekendVoorstel = isGeldigDecimal(invoer.laatstBekendSaldo) && isGeldigDecimal(invoer.rentepercentage) ? invoer.laatstBekendSaldo.times(invoer.rentepercentage.dividedBy(100)) : null;

  return { controleVereist, bedrag: veiligBedrag(invoer.begrotingsbedrag), berekendVoorstel };
}

function berekenCategorie(
  categorie: BgRenteCategorie,
  regelsInvoer: readonly BgRenteRegelInvoer[],
  aannames: BgRenteCategorieAannames,
): { resultaat: BgRenteCategorieResultaat; controleVereist: BgRenteControleItem[] } {
  const controleVereist: BgRenteControleItem[] = [];

  const regels: BgRenteRegelUitkomst[] = regelsInvoer.map((invoer, index) => {
    const { controleVereist: meldingen, bedrag, berekendVoorstel } = valideerRegel(invoer, index);
    controleVereist.push(...meldingen);
    return { index, invoer, berekendVoorstel, bedrag };
  });

  const categorieTotaal = som(regels.map((r) => r.bedrag));

  const reviewStatus: BgRenteReviewStatus = !aannames.beoordeeld ? "NOT_REVIEWED" : regels.length === 0 ? "REVIEWED_ZERO_RULES" : "REVIEWED_WITH_RULES";

  return {
    resultaat: { categorie, beoordeeld: aannames.beoordeeld, reviewStatus, regels, categorieTotaal },
    controleVereist,
  };
}

export function berekenBegroteRente(
  regelsInvoer: readonly BgRenteRegelInvoer[],
  categorieAannames: Record<BgRenteCategorie, BgRenteCategorieAannames>,
  context: { begrotingsjaar: number },
): BgRenteResultaat {
  const controleVereist: BgRenteControleItem[] = [];

  const perCategorie: BgRenteCategorieResultaat[] = RENTE_CATEGORIEEN.map((categorie) => {
    const regelsVoorCategorie = regelsInvoer.filter((r) => r.categorie === categorie);
    const { resultaat, controleVereist: meldingen } = berekenCategorie(categorie, regelsVoorCategorie, categorieAannames[categorie]);
    controleVereist.push(...meldingen);
    return resultaat;
  });

  const totaalVoor = (categorie: BgRenteCategorie): Decimal => perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;

  return {
    begrotingsjaar: context.begrotingsjaar,
    perCategorie,
    rentekosten: totaalVoor("RENTEKOSTEN"),
    renteOpbrengsten: totaalVoor("RENTE_OPBRENGSTEN"),
    controleVereist,
  };
}

// ── Werkelijk ────────────────────────────────────────────────────────────

/**
 * Eén regel van de lokale rente-classificatie (OGB-kostensoort → categorie),
 * ADMINISTRATIE-SPECIFIEK geresolved en als pure invoer aangeleverd — deze
 * module leest of query't zelf nooit een classificatieconfig/database. GL
 * (4600/4620) is uitsluitend een bronselectie/gate bij het ophalen van de
 * `boekingen` hieronder, GEEN onderdeel van deze classificatie zelf.
 */
export interface RenteClassificatieRegel {
  ogbKostensoort: string;
  ogbKostensoortOmschrijving: string;
  categorie: BgRenteCategorie;
}

/**
 * Eén reeds-geselecteerde boeking (Werkelijk) — deze module selecteert zelf
 * geen boekingen: `saldo` is al door de aanroeper correct bepaald (debet -
 * credit, CAL-FIN-001).
 */
export interface WerkelijkRenteBoekingRegel {
  /** `null` = geen OGB-kostensoort op de boeking — nooit classificeerbaar, altijd apart gehouden. */
  ogbKostensoort: string | null;
  saldo: Decimal;
}

export interface WerkelijkRenteOgbTotaal {
  ogbKostensoort: string;
  ogbKostensoortOmschrijving: string;
  saldo: Decimal;
  aantalBoekingen: number;
}

export interface WerkelijkRenteCategorieResultaat {
  categorie: BgRenteCategorie;
  categorieTotaal: Decimal;
  /** Uitsluitend ter onderbouwing — de P&L toont het categorietotaal, zie moduledoc. */
  perOgbKostensoort: WerkelijkRenteOgbTotaal[];
}

export interface WerkelijkRenteControleItem {
  ernst: BgRenteControleErnst;
  ogbKostensoort: string | null;
  bericht: string;
}

export interface WerkelijkRenteResultaat {
  /** Vaste volgorde: `RENTE_CATEGORIEEN`. */
  perCategorie: WerkelijkRenteCategorieResultaat[];
  /** Boekingen met een OGB-kostensoort die niet in `classificatie` voorkomt (of `null`) — NOOIT geraden, NOOIT meegeteld in een categorie. */
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
  controleVereist: WerkelijkRenteControleItem[];
}

export function berekenWerkelijkRente(boekingen: readonly WerkelijkRenteBoekingRegel[], classificatie: readonly RenteClassificatieRegel[]): WerkelijkRenteResultaat {
  const controleVereist: WerkelijkRenteControleItem[] = [];
  const perCategorieRegels = new Map<BgRenteCategorie, WerkelijkRenteBoekingRegel[]>(RENTE_CATEGORIEEN.map((c) => [c, []]));
  const nietGeclassificeerd: WerkelijkRenteBoekingRegel[] = [];

  for (const regel of boekingen) {
    if (regel.ogbKostensoort === null) {
      nietGeclassificeerd.push(regel);
      controleVereist.push({ ernst: "WAARSCHUWING", ogbKostensoort: null, bericht: `Boeking zonder OGB-kostensoort (saldo ${regel.saldo.toString()}) — niet classificeerbaar, buiten alle categorietotalen gehouden.` });
      continue;
    }
    const gevonden = classificatie.find((c) => c.ogbKostensoort === regel.ogbKostensoort);
    if (gevonden === undefined) {
      nietGeclassificeerd.push(regel);
      controleVereist.push({
        ernst: "WAARSCHUWING",
        ogbKostensoort: regel.ogbKostensoort,
        bericht: `OGB-kostensoort "${regel.ogbKostensoort}" komt niet voor in de lokale rente-classificatie van deze administratie — onbekende code, niet geraden, buiten alle categorietotalen gehouden.`,
      });
      continue;
    }
    perCategorieRegels.get(gevonden.categorie)!.push(regel);
  }

  function ogbTotalen(regels: readonly WerkelijkRenteBoekingRegel[]): WerkelijkRenteOgbTotaal[] {
    const perOgb = new Map<string, WerkelijkRenteBoekingRegel[]>();
    for (const regel of regels) {
      const groep = perOgb.get(regel.ogbKostensoort!) ?? [];
      groep.push(regel);
      perOgb.set(regel.ogbKostensoort!, groep);
    }
    return Array.from(perOgb.entries())
      .map(([ogbKostensoort, groep]) => ({
        ogbKostensoort,
        ogbKostensoortOmschrijving: classificatie.find((c) => c.ogbKostensoort === ogbKostensoort)!.ogbKostensoortOmschrijving,
        saldo: som(groep.map((r) => r.saldo)),
        aantalBoekingen: groep.length,
      }))
      .sort((a, b) => a.ogbKostensoort.localeCompare(b.ogbKostensoort));
  }

  const perCategorie: WerkelijkRenteCategorieResultaat[] = RENTE_CATEGORIEEN.map((categorie) => {
    const regels = perCategorieRegels.get(categorie)!;
    return { categorie, categorieTotaal: som(regels.map((r) => r.saldo)), perOgbKostensoort: ogbTotalen(regels) };
  });

  return {
    perCategorie,
    nietGeclassificeerdTotaal: som(nietGeclassificeerd.map((r) => r.saldo)),
    nietGeclassificeerdAantalBoekingen: nietGeclassificeerd.length,
    controleVereist,
  };
}

// ── Estimated ────────────────────────────────────────────────────────────

export interface EstimatedRenteCategorieResultaat {
  categorie: BgRenteCategorie;
  /** Ongewijzigd doorgegeven vanuit het Begroting-resultaat — Estimated berekent of muteert de Begroting nooit. */
  begrotingTotaal: Decimal;
  /** Ongewijzigd doorgegeven vanuit het Werkelijk-resultaat (t/m de laatst afgesloten periode die de aanroeper heeft geselecteerd). */
  werkelijkTotaal: Decimal;
  /** Handmatige businessaanname — `null` zolang niet ingevuld, NOOIT verzonnen, NOOIT automatisch geëxtrapoleerd. */
  verwachtingResterendJaar: Decimal | null;
  /** `werkelijkTotaal + verwachtingResterendJaar`, of `null` zolang de verwachting ontbreekt. */
  estimatedTotaal: Decimal | null;
  /** `estimatedTotaal - begrotingTotaal`, of `null` zolang `estimatedTotaal` onbekend is. */
  afwijking: Decimal | null;
}

export interface EstimatedRenteResultaat {
  perCategorie: EstimatedRenteCategorieResultaat[];
}

export function berekenEstimatedRente(begroting: BgRenteResultaat, werkelijk: WerkelijkRenteResultaat, verwachtingPerCategorie: Record<BgRenteCategorie, Decimal | null>): EstimatedRenteResultaat {
  const perCategorie: EstimatedRenteCategorieResultaat[] = RENTE_CATEGORIEEN.map((categorie) => {
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

  return { perCategorie };
}
