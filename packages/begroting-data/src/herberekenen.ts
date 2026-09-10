import type { DatabaseSync } from "node:sqlite";
import {
  ALGEMENE_KOSTEN_CATEGORIEEN,
  LEEGSTAND_CATEGORIEEN,
  berekenBegroteAlgemeneKosten,
  berekenBegroteBeheersvergoeding,
  berekenBegroteCorrectiefDagelijksOnderhoud,
  berekenBegroteGemeentelijkeLasten,
  berekenBegroteGeplandOnderhoud,
  berekenBegroteHuuropbrengsten,
  berekenBegroteLeegstand,
  berekenBegroteManagementvergoeding,
  berekenBegroteVerzekeringen,
  type BgAlgemeneKostenCategorie,
  type BgAlgemeneKostenCategorieAannames,
  type BgAlgemeneKostenCategorieResultaat,
  type BgAlgemeneKostenClassificatieRegel,
  type BgAlgemeneKostenRegelInvoer,
  type BgAlgemeneKostenRegelUitkomst,
  type BgAlgemeneKostenResultaat,
  type BgBeheerComplexConfig,
  type BgBeheerResultaat,
  type BgContractFeiten,
  type BgContractOverride,
  type BgCorrectiefDagelijksRegelInvoer,
  type BgCorrectiefDagelijksRegelUitkomst,
  type BgCorrectiefDagelijksResultaat,
  type BgGemeentelijkeLastenResultaat,
  type BgGeplandOnderhoudAanleidingType,
  type BgGeplandOnderhoudActiviteitInvoer,
  type BgGeplandOnderhoudActiviteitUitkomst,
  type BgGeplandOnderhoudResultaat,
  type BgGeplandOnderhoudStatus,
  type BgHuurAannames,
  type BgHuurResultaat,
  type BgLeegstandCategorie,
  type BgLeegstandCategorieAannames,
  type BgLeegstandCategorieResultaat,
  type BgLeegstandRegelInvoer,
  type BgLeegstandRegelUitkomst,
  type BgLeegstandResultaat,
  type BgManagementInvoer,
  type BgManagementResultaat,
  type BgVerzekeringRegelInvoer,
  type BgVerzekeringRegelUitkomst,
  type BgVerzekeringResultaat,
  type BgWozObjectInvoer,
  type BgWozObjectUitkomst,
} from "@bvc/reporting";
import {
  leesAlgemeneKostenCategorieState,
  type AlgemeneKostenCategorieStateInvoer,
} from "./algemeneKostenCategorieState.js";
import { leesAlgemeneKostenClassificatie } from "./algemeneKostenClassificatie.js";
import { leesAlgemeneKostenRegels, type AlgemeneKostenRegel } from "./algemeneKostenRegels.js";
import { leesBegrotingsversie, type Begrotingsversie } from "./begrotingsversies.js";
import {
  leesCorrectiefDagelijksOnderhoudBeoordeeld,
} from "./correctiefDagelijksOnderhoudBeoordeeld.js";
import {
  leesCorrectiefDagelijksOnderhoudRegels,
  type CorrectiefDagelijksOnderhoudRegel,
} from "./correctiefDagelijksOnderhoudRegels.js";
import { leesGemeentelijkeLastenModule, type GemeentelijkeLastenModuleInvoer } from "./gemeentelijkeLastenModule.js";
import { leesGeplandOnderhoudActiviteiten, type GeplandOnderhoudActiviteit } from "./geplandOnderhoudActiviteiten.js";
import { leesGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";
import {
  leesLeegstandCategorieState,
  type LeegstandCategorieStateInvoer,
} from "./leegstandCategorieState.js";
import { leesLeegstandRegels, type LeegstandRegel } from "./leegstandRegels.js";
import { leesModule1Aannames } from "./module1Aannames.js";
import { leesModule1Overrides } from "./module1Overrides.js";
import { leesModule1Snapshot } from "./module1Snapshot.js";
import { leesModule2Config } from "./module2Config.js";
import { leesModule3Invoer } from "./module3Invoer.js";
import { leesVerzekeringBeoordeeld } from "./verzekeringBeoordeeld.js";
import { leesVerzekeringRegels, type VerzekeringRegel } from "./verzekeringRegels.js";
import { leesWozObjecten, type WozObject } from "./wozObjecten.js";

/**
 * Orchestratie: herberekent Module 1 + Module 2 voor één CONCEPT-
 * begrotingsversie, uitsluitend vanuit reeds opgeslagen, bevroren
 * persistente input. UITSLUITEND lezen + pure berekening — schrijft NOOIT
 * iets naar SQLite. Geen eigen rekenlogica, geen totalen/afrondingen/
 * controles die hier opnieuw worden bepaald — dat blijft exclusief het werk
 * van de al bestaande, ongewijzigde pure `@bvc/reporting`-functies.
 *
 * Bundelt uitsluitend de drie al bestaande reporting-/persistence-typen —
 * bewust GEEN shadow-type van een rekenresultaat.
 *
 * `leesHerberekenInvoerZonderTransactie`/`berekenBegrotingUitInvoer` zijn
 * bewust als losse, transactievrije bouwblokken geëxporteerd (niet via
 * `index.ts` — intern hergebruik, zelfde grens als `markeerVastgesteld` in
 * `begrotingsversies.ts`) zodat Fase 1D.6b's `stelBegrotingVast`
 * (`vaststellen.ts`) exact dezelfde lees-/rekenlogica kan hergebruiken
 * bínnen haar eigen, grotere schrijftransactie — zonder de geneste-`BEGIN`-
 * val van `herberekenBegroting`'s eigen leestransactie.
 *
 * MODULE 3 (fase 2C.3, businessbeslissing 2026-09-03): `module3` is bewust
 * `BgManagementResultaat | null`, GEEN default/leeg resultaat. `null`
 * betekent "nog geen Module-3-invoer opgeslagen" — een CONCEPT-versie mag
 * zonder Module-3-invoer bestaan en herberekend worden; dat is een expliciet
 * ANDERE toestand dan een daadwerkelijk berekend resultaat met jaartotaal
 * €0 (dat is wél een `BgManagementResultaat`, nooit `null`). Module 3 heeft
 * GEEN functionele afhankelijkheid van Module 1/2 (in tegenstelling tot
 * Module 2, die Module 1's netto huur als grondslag gebruikt) — er wordt
 * hier dan ook bewust geen koppeling geïntroduceerd die niet bestaat.
 *
 * GEPLAND ONDERHOUD (GO-P2, businessbeslissing 2026-09-04): `geplandOnderhoud`
 * is, ANDERS dan Module 3, bewust NIET `| null`. Module 3's `null` bestaat
 * omdat "nog geen van de drie invoerwijzen gekozen" een echte, aparte
 * betekenisvolle toestand is die niet in een berekening past. Gepland
 * Onderhoud kent dat probleem niet: "0 activiteiten + `beoordeeld=false`" is
 * door `berekenBegroteGeplandOnderhoud` al volledig, zinvol berekenbaar (zie
 * `begroteGeplandOnderhoud.ts` se eigen testsuite) — er ontbreekt dus nooit
 * "invoer om te berekenen", hooguit activiteiten. Elke herberekende CONCEPT-
 * versie bevat daarom altijd een `geplandOnderhoud`-resultaat, ook al is er
 * nog nooit een activiteit of een `beoordeeld`-waarde opgeslagen.
 *
 * `GeplandOnderhoudActiviteitUitkomstMetId`/`HerberekendGeplandOnderhoudResultaat`
 * zijn bewust begroting-data-eigen wrappertypes om het `@bvc/reporting`-
 * type `BgGeplandOnderhoudResultaat` heen — de pure module blijft ZELF
 * ongewijzigd (die kent geen persistentie-ID's, uitsluitend een positionele
 * `index`/`activiteitIndex` als tijdelijke correlatiesleutel binnen één
 * aanroep, zie `begroteGeplandOnderhoud.ts`'s moduledoc). Alleen
 * `activiteiten` wordt vervangen door een ID-geannoteerde variant; élk ander
 * veld (`kwartaalTotalen`/`totaalJaar`/`perComplex`/`totaalZonderGeldigComplex`/
 * `reviewStatus`/`beoordeeld`/`controleVereist`) komt ONGEWIJZIGD van de pure
 * calculator — begroting-data berekent hier zelf niets opnieuw. `controleVereist`
 * behoudt bewust zijn positionele `activiteitIndex` (nog GEEN vertaling naar
 * een persistentie-ID) — die vertaling hoort, indien nodig, bij een latere
 * fase (frozen output), niet bij deze pure lees-en-bereken-stap.
 *
 * CORRECTIEF/DAGELIJKS ONDERHOUD (CD-P2, OB-028, businessbeslissing
 * 2026-09-04): `correctiefDagelijksOnderhoud` volgt EXACT hetzelfde
 * niet-nullable patroon als `geplandOnderhoud`, met dezelfde onderbouwing —
 * "0 regels + `beoordeeld=false`" is door
 * `berekenBegroteCorrectiefDagelijksOnderhoud` al volledig, zinvol
 * berekenbaar (zie die module se eigen testsuite). Bewust GEEN
 * type-boundary-castfunctie nodig zoals `alsPureAanleidingType`/
 * `alsPureStatus` hierboven: Correctief/Dagelijks' enige bijzondere veld
 * (`jaarbedrag: Decimal | null`) mapt eerlijk 1-op-1 tussen persistentie en
 * pure-calculator-invoer, zonder enumcast-omweg — zie
 * `correctiefDagelijksOnderhoudRegels.ts`'s moduledoc.
 *
 * BELANGRIJKE TIJDELIJKE GRENS (CD-P1/CD-P2, expliciet zo afgesproken):
 * `vaststellen.ts` raakt in deze fase NIET aan
 * `correctiefDagelijksOnderhoud` — een KRITIEK-control of `beoordeeld=false`
 * in dit resultaat blokkeert `stelBegrotingVast` (nog) NIET, in tegenstelling
 * tot Gepland Onderhoud (zie `vaststellen.test.ts`'s regressietest). Dat is
 * een bewuste, tijdelijke scope-grens van deze implementatieronde, GEEN
 * businessbeslissing dat Correctief/Dagelijks nooit zou moeten blokkeren —
 * die lifecycle-koppeling volgt pas in een latere, apart te reviewen fase
 * (CD-P3, inmiddels gebouwd — zie `vaststellen.ts`).
 *
 * VERZEKERINGEN (OB-032, businessbeslissingen OB032-001 t/m 013): volgt
 * hetzelfde niet-nullable ALTIJD-berekend-patroon als Gepland Onderhoud/
 * Correctief-Dagelijks Onderhoud — "0 polisregels + `beoordeeld=false`" is
 * door `berekenBegroteVerzekeringen` al volledig, zinvol berekenbaar.
 * Bewust GEEN type-boundary-castfunctie nodig (zoals bij Gepland
 * Onderhoud): `VerzekeringRegel`'s velden (`complexnummer`/`verzekeraar`/
 * `ingangsdatum`/`looptijdMaanden`/`bedrag`/`indexPercentage`/
 * `handmatigBegrootOverride`) mappen eerlijk 1-op-1 naar
 * `BgVerzekeringRegelInvoer` — zie `verzekeringRegels.ts`'s moduledoc.
 *
 * GEMEENTELIJKE LASTEN / WOZ (OB-033, businessbeslissingen OB033-001 t/m
 * 019): volgt hetzelfde niet-nullable ALTIJD-berekend-patroon als
 * Verzekeringen — "0 WOZ-objecten + `beoordeeld=false`" is door
 * `berekenBegroteGemeentelijkeLasten` al volledig, zinvol berekenbaar (zie
 * `begroteGemeentelijkeLasten.ts`'s eigen testsuite). Bewust GEEN
 * type-boundary-castfunctie nodig: `WozObject`'s velden
 * (`complexnummer`/`wozObjectAdres`/`aanslagjaar`/`waardepeildatum`/
 * `werkelijkeWoz`/`verwachteWozOverride`) mappen eerlijk 1-op-1 naar
 * `BgWozObjectInvoer` — zie `wozObjecten.ts`'s moduledoc. De module-brede
 * aannames (`werkelijkeGemeentelijkeLasten`/`wozStijgingPercentage`/
 * `lastenPercentageStijging`/`begrotingsPercentageOverride`/`beoordeeld`)
 * komen 1-op-1 van `leesGemeentelijkeLastenModule` — zie
 * `gemeentelijkeLastenModule.ts`'s moduledoc voor de "geen rij = alle velden
 * null/false"-semantiek.
 *
 * ALGEMENE KOSTEN (OB-035/036, Accountant/Algemene/Juridische/Makelaars-/
 * Bankkosten): volgt hetzelfde niet-nullable ALTIJD-berekend-patroon als
 * Verzekeringen/WOZ — "0 regels + `beoordeeld=false` per categorie" is door
 * `berekenBegroteAlgemeneKosten` al volledig, zinvol berekenbaar (zie
 * `begroteAlgemeneKosten.ts`'s eigen testsuite). ANDERS dan de eerdere
 * modules kent deze module een TWEEDE lees-ingang naast de begrotingsversie:
 * de lokale OGB-classificatie (`algemeneKostenClassificatie.ts`) is
 * administratie-breed (sleutel `bedrijfsnr`, uit `invoer.versie.bedrijfsnr`),
 * GEEN begrotingsversie-gebonden data — zie dat bestand se moduledoc.
 * Positionele persistentie-ID-correlatie gebeurt hier PER CATEGORIE (niet
 * over de volledige regellijst heen): `AlgemeneKostenRegel[]` wordt eerst
 * per categorie gefilterd (stabiele volgorde, exact zoals de pure
 * calculator dat zelf ook doet), waarna `resultaat.perCategorie[i].
 * regels[j]` correspondeert met de j-de regel van diezelfde categorie in de
 * oorspronkelijke, ongefilterde lijst — zie `berekenAlgemeneKostenUitInvoer`.
 *
 * LEEGSTANDSKOSTEN (OB-031, Nuts/Servicekosten/Overige leegstand): volgt
 * hetzelfde niet-nullable ALTIJD-berekend-patroon en dezelfde per-categorie
 * positionele ID-correlatie als Algemene Kosten (`berekenLeegstandUitInvoer`).
 * ANDERS dan Algemene Kosten heeft een Leegstand-begrotingsregel GEEN
 * OGB-koppeling (zie `begroteLeegstand.ts`'s moduledoc) — deze module leest
 * dus GEEN classificatie in `HerberekenInvoer`. De lokale leegstand-
 * classificatie (`leegstandClassificatie.ts`) wordt UITSLUITEND door de
 * losstaande, nooit-gepersisteerde Werkelijk-berekening
 * (`berekenWerkelijkLeegstand`) gebruikt — die maakt bewust GEEN onderdeel
 * uit van `HerberekendeBegroting`/`herberekenBegroting`, want Werkelijk moet
 * altijd live tegen de actuele boekhouding berekend worden, nooit tegen een
 * herberekende CONCEPT-snapshot.
 */
export interface HerberekendeBegroting {
  versie: Begrotingsversie;
  module1: BgHuurResultaat;
  module2: BgBeheerResultaat;
  module3: BgManagementResultaat | null;
  geplandOnderhoud: HerberekendGeplandOnderhoudResultaat;
  correctiefDagelijksOnderhoud: HerberekendCorrectiefDagelijksResultaat;
  verzekering: HerberekendVerzekeringResultaat;
  gemeentelijkeLasten: HerberekendGemeentelijkeLastenResultaat;
  algemeneKosten: HerberekendAlgemeneKostenResultaat;
  leegstand: HerberekendLeegstandResultaat;
}

/** Koppelt een berekende activiteit-uitkomst terug aan haar persistente `id` — uitsluitend positioneel bepaald, nooit herzocht op inhoud (zie moduledoc). */
export interface GeplandOnderhoudActiviteitUitkomstMetId {
  persistentieId: number;
  activiteit: BgGeplandOnderhoudActiviteitUitkomst;
}

/** `BgGeplandOnderhoudResultaat` met uitsluitend `activiteiten` vervangen door de ID-geannoteerde variant — alle overige velden ongewijzigd, rechtstreeks van de pure calculator. */
export interface HerberekendGeplandOnderhoudResultaat extends Omit<BgGeplandOnderhoudResultaat, "activiteiten"> {
  activiteiten: readonly GeplandOnderhoudActiviteitUitkomstMetId[];
}

/** Koppelt een berekende regel-uitkomst terug aan haar persistente `id` — uitsluitend positioneel bepaald, zelfde principe als `GeplandOnderhoudActiviteitUitkomstMetId`. */
export interface CorrectiefDagelijksRegelUitkomstMetId {
  persistentieId: number;
  regel: BgCorrectiefDagelijksRegelUitkomst;
}

/** `BgCorrectiefDagelijksResultaat` met uitsluitend `regels` vervangen door de ID-geannoteerde variant — alle overige velden ongewijzigd, rechtstreeks van de pure calculator. */
export interface HerberekendCorrectiefDagelijksResultaat extends Omit<BgCorrectiefDagelijksResultaat, "regels"> {
  regels: readonly CorrectiefDagelijksRegelUitkomstMetId[];
}

/** Koppelt een berekende Verzekering-regel-uitkomst terug aan haar persistente `id` — uitsluitend positioneel bepaald, zelfde principe als `CorrectiefDagelijksRegelUitkomstMetId`. */
export interface VerzekeringRegelUitkomstMetId {
  persistentieId: number;
  regel: BgVerzekeringRegelUitkomst;
}

/** `BgVerzekeringResultaat` met uitsluitend `regels` vervangen door de ID-geannoteerde variant — alle overige velden ongewijzigd, rechtstreeks van de pure calculator. */
export interface HerberekendVerzekeringResultaat extends Omit<BgVerzekeringResultaat, "regels"> {
  regels: readonly VerzekeringRegelUitkomstMetId[];
}

/** Koppelt een berekende WOZ-object-uitkomst terug aan haar persistente `id` — uitsluitend positioneel bepaald, zelfde principe als `VerzekeringRegelUitkomstMetId`. */
export interface WozObjectUitkomstMetId {
  persistentieId: number;
  wozObject: BgWozObjectUitkomst;
}

/** `BgGemeentelijkeLastenResultaat` met uitsluitend `wozObjecten` vervangen door de ID-geannoteerde variant — alle overige velden ongewijzigd, rechtstreeks van de pure calculator. */
export interface HerberekendGemeentelijkeLastenResultaat extends Omit<BgGemeentelijkeLastenResultaat, "wozObjecten"> {
  wozObjecten: readonly WozObjectUitkomstMetId[];
}

/** Koppelt een berekende Algemene-Kosten-regel-uitkomst terug aan haar persistente `id` — uitsluitend positioneel bepaald BINNEN de regels van diezelfde categorie, zelfde principe als `WozObjectUitkomstMetId`. */
export interface AlgemeneKostenRegelUitkomstMetId {
  persistentieId: number;
  regel: BgAlgemeneKostenRegelUitkomst;
}

/** `BgAlgemeneKostenCategorieResultaat` met uitsluitend `regels` vervangen door de ID-geannoteerde variant — alle overige velden ongewijzigd, rechtstreeks van de pure calculator. */
export interface HerberekendAlgemeneKostenCategorieResultaat extends Omit<BgAlgemeneKostenCategorieResultaat, "regels"> {
  regels: readonly AlgemeneKostenRegelUitkomstMetId[];
}

/** `BgAlgemeneKostenResultaat` met uitsluitend `perCategorie` vervangen door de ID-geannoteerde variant — alle overige velden (incl. de vijf met naam benoemde categorietotalen en `moduleTotaal`) ongewijzigd, rechtstreeks van de pure calculator. */
export interface HerberekendAlgemeneKostenResultaat extends Omit<BgAlgemeneKostenResultaat, "perCategorie"> {
  perCategorie: readonly HerberekendAlgemeneKostenCategorieResultaat[];
}

/** Koppelt een berekende Leegstand-regel-uitkomst terug aan haar persistente `id` — uitsluitend positioneel bepaald BINNEN de regels van diezelfde categorie, zelfde principe als `AlgemeneKostenRegelUitkomstMetId`. */
export interface LeegstandRegelUitkomstMetId {
  persistentieId: number;
  regel: BgLeegstandRegelUitkomst;
}

/** `BgLeegstandCategorieResultaat` met uitsluitend `regels` vervangen door de ID-geannoteerde variant — alle overige velden ongewijzigd, rechtstreeks van de pure calculator. */
export interface HerberekendLeegstandCategorieResultaat extends Omit<BgLeegstandCategorieResultaat, "regels"> {
  regels: readonly LeegstandRegelUitkomstMetId[];
}

/** `BgLeegstandResultaat` met uitsluitend `perCategorie` vervangen door de ID-geannoteerde variant — alle overige velden (incl. de drie met naam benoemde categorietotalen en `moduleTotaal`) ongewijzigd, rechtstreeks van de pure calculator. */
export interface HerberekendLeegstandResultaat extends Omit<BgLeegstandResultaat, "perCategorie"> {
  perCategorie: readonly HerberekendLeegstandCategorieResultaat[];
}

/** Kleine, herbruikbare read-transactie-helper — zelfde BEGIN/COMMIT/ROLLBACK-idioom als elders in dit package (bewust hier gedupliceerd, zie 1D.5-rapport). */
function withReadTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const resultaat = fn();
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Alle persistente input die nodig is voor exact één Module-1+Module-2(+Module-3)-
 * berekening — het tussenresultaat van de leesstap, vóór pure calculatie.
 * `module3Invoer` is bewust `BgManagementInvoer | null` — `null` is een
 * geldige, veelvoorkomende CONCEPT-toestand ("nog niet beoordeeld"), geen
 * foutgeval en geen aanleiding voor een default-invoer (zie
 * `HerberekendeBegroting`'s moduledoc).
 */
export interface HerberekenInvoer {
  versie: Begrotingsversie;
  contracten: readonly BgContractFeiten[];
  aannames: BgHuurAannames;
  overrides: readonly BgContractOverride[];
  configs: readonly BgBeheerComplexConfig[];
  module3Invoer: BgManagementInvoer | null;
  /** Rauwe GO-P1-persistence — GEEN pure-module-vorm; de mapping naar `BgGeplandOnderhoudActiviteitInvoer` gebeurt pas in `berekenBegrotingUitInvoer`. */
  geplandOnderhoudActiviteiten: readonly GeplandOnderhoudActiviteit[];
  /** `leesGeplandOnderhoudBeoordeeld`'s "geen rij → false"-semantiek, ongewijzigd doorgegeven. */
  geplandOnderhoudBeoordeeld: boolean;
  /** Rauwe CD-P1-persistence — GEEN pure-module-vorm; de mapping naar `BgCorrectiefDagelijksRegelInvoer` gebeurt pas in `berekenBegrotingUitInvoer`. */
  correctiefDagelijksRegels: readonly CorrectiefDagelijksOnderhoudRegel[];
  /** `leesCorrectiefDagelijksOnderhoudBeoordeeld`'s "geen rij → false"-semantiek, ongewijzigd doorgegeven. */
  correctiefDagelijksBeoordeeld: boolean;
  /** Rauwe Verzekering-persistence (OB-032) — GEEN pure-module-vorm; de mapping naar `BgVerzekeringRegelInvoer` gebeurt pas in `berekenBegrotingUitInvoer`. */
  verzekeringRegels: readonly VerzekeringRegel[];
  /** `leesVerzekeringBeoordeeld`'s "geen rij → false"-semantiek, ongewijzigd doorgegeven. */
  verzekeringBeoordeeld: boolean;
  /** Rauwe WOZ-objectpersistence (OB-033) — GEEN pure-module-vorm; de mapping naar `BgWozObjectInvoer` gebeurt pas in `berekenBegrotingUitInvoer`. */
  wozObjecten: readonly WozObject[];
  /** `leesGemeentelijkeLastenModule`'s "geen rij → alle aannamevelden null, beoordeeld false"-semantiek, ongewijzigd doorgegeven. */
  gemeentelijkeLastenModule: GemeentelijkeLastenModuleInvoer;
  /** De lokale algemene-kostenclassificatie (OB-035/036) van de administratie van deze begrotingsversie (`versie.bedrijfsnr`) — GEEN begrotingsversie-gebonden data, zie `algemeneKostenClassificatie.ts`'s moduledoc. */
  algemeneKostenClassificatie: readonly BgAlgemeneKostenClassificatieRegel[];
  /** Rauwe Algemene-Kosten-regelpersistence (OB-035/036) — GEEN pure-module-vorm; de mapping naar `BgAlgemeneKostenRegelInvoer` gebeurt pas in `berekenBegrotingUitInvoer`. */
  algemeneKostenRegels: readonly AlgemeneKostenRegel[];
  /** `leesAlgemeneKostenCategorieState`'s "geen rij → beoordeeld false, rekenhulp null"-semantiek, ongewijzigd doorgegeven. */
  algemeneKostenCategorieState: Record<BgAlgemeneKostenCategorie, AlgemeneKostenCategorieStateInvoer>;
  /** Rauwe Leegstand-regelpersistence (OB-031) — GEEN pure-module-vorm; de mapping naar `BgLeegstandRegelInvoer` gebeurt pas in `berekenBegrotingUitInvoer`. GEEN classificatie hier — zie `HerberekendeBegroting`'s moduledoc. */
  leegstandRegels: readonly LeegstandRegel[];
  /** `leesLeegstandCategorieState`'s "geen rij → beoordeeld false, rekenhulp null"-semantiek, ongewijzigd doorgegeven. */
  leegstandCategorieState: Record<BgLeegstandCategorie, LeegstandCategorieStateInvoer>;
}

/**
 * Leest alle voor een Module-1+Module-2-berekening benodigde persistente
 * input voor `versieId` — GEEN eigen transactie (de aanroeper bepaalt de
 * transactiegrens; zie `herberekenBegroting` voor de publieke, kortlevende
 * leestransactie-variant en `stelBegrotingVast` (`vaststellen.ts`) voor
 * hergebruik binnen één grotere schrijftransactie).
 *
 * Faalt hard als de versie niet bestaat, niet CONCEPT is, of geen
 * Module-1-aannames heeft opgeslagen — dezelfde invariant geldt voor beide
 * aanroepers (herberekenen en vaststellen): beide werken uitsluitend op een
 * nog-muteerbare CONCEPT-versie met minimaal een aannameset. Een lege
 * snapshot/overrides/Module-2-config is een geldige bestaande toestand.
 */
export function leesHerberekenInvoerZonderTransactie(db: DatabaseSync, versieId: string): HerberekenInvoer {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — deze operatie is uitsluitend mogelijk voor een CONCEPT-versie.`);
  }

  const aannames = leesModule1Aannames(db, versieId);
  if (aannames === null) {
    throw new Error(`Begrotingsversie ${versieId}: geen Module-1-aannames opgeslagen — berekenen is zonder aannames niet mogelijk.`);
  }

  return {
    versie,
    contracten: leesModule1Snapshot(db, versieId),
    aannames,
    overrides: leesModule1Overrides(db, versieId),
    configs: leesModule2Config(db, versieId),
    module3Invoer: leesModule3Invoer(db, versieId),
    geplandOnderhoudActiviteiten: leesGeplandOnderhoudActiviteiten(db, versieId),
    geplandOnderhoudBeoordeeld: leesGeplandOnderhoudBeoordeeld(db, versieId),
    correctiefDagelijksRegels: leesCorrectiefDagelijksOnderhoudRegels(db, versieId),
    correctiefDagelijksBeoordeeld: leesCorrectiefDagelijksOnderhoudBeoordeeld(db, versieId),
    verzekeringRegels: leesVerzekeringRegels(db, versieId),
    verzekeringBeoordeeld: leesVerzekeringBeoordeeld(db, versieId),
    wozObjecten: leesWozObjecten(db, versieId),
    gemeentelijkeLastenModule: leesGemeentelijkeLastenModule(db, versieId),
    algemeneKostenClassificatie: leesAlgemeneKostenClassificatie(db, versie.bedrijfsnr),
    algemeneKostenRegels: leesAlgemeneKostenRegels(db, versieId),
    algemeneKostenCategorieState: leesAlgemeneKostenCategorieState(db, versieId),
    leegstandRegels: leesLeegstandRegels(db, versieId),
    leegstandCategorieState: leesLeegstandCategorieState(db, versieId),
  };
}

/**
 * Type-boundary, GEEN businessvalidatie: GO-P1-persistence staat bewust élke
 * string (of NULL, voor `aanleidingType`) toe, zodat een functioneel
 * onvolledig CONCEPT opslaanbaar blijft (zie `geplandOnderhoudActiviteiten.ts`).
 * De pure calculator (`berekenBegroteGeplandOnderhoud`) valideert zelf, op
 * runtime, of de waarde één van de geldige enumwaarden is en produceert een
 * KRITIEK-control zo niet — deze cast dupliceert die validatie NIET, hij
 * laat een ontbrekende/ongeldige waarde uitsluitend ongewijzigd de pure
 * calculator bereiken zodat die zijn eigen, al bewezen validatie uitvoert.
 * `null` (nog geen aanleiding gekozen) wordt hier naar `""` genormaliseerd —
 * de pure calculator herkent een lege string net zo min als geldig als een
 * onbekende waarde (zie `begroteGeplandOnderhoud.ts`'s `GELDIGE_AANLEIDING_TYPES`).
 */
function alsPureAanleidingType(waarde: string | null): BgGeplandOnderhoudAanleidingType {
  return (waarde ?? "") as BgGeplandOnderhoudAanleidingType;
}

/** Zelfde type-boundary-principe als `alsPureAanleidingType` — `status` is in GO-P1 al NOT NULL, dus geen `??`-normalisatie nodig. */
function alsPureStatus(waarde: string): BgGeplandOnderhoudStatus {
  return waarde as BgGeplandOnderhoudStatus;
}

/** Letterlijke veldkopie, GEEN transformatie/validatie — zie `alsPureAanleidingType`/`alsPureStatus` voor de enige twee velden die een type-boundary nodig hebben. */
function naarPureGeplandOnderhoudInvoer(activiteit: GeplandOnderhoudActiviteit): BgGeplandOnderhoudActiviteitInvoer {
  return {
    complexnummer: activiteit.complexnummer,
    omschrijving: activiteit.omschrijving,
    aanleidingType: alsPureAanleidingType(activiteit.aanleidingType),
    aanleidingToelichting: activiteit.aanleidingToelichting,
    q1: activiteit.q1,
    q2: activiteit.q2,
    q3: activiteit.q3,
    q4: activiteit.q4,
    status: alsPureStatus(activiteit.status),
    leverancier: activiteit.leverancier,
    offertebedrag: activiteit.offertebedrag,
    notitie: activiteit.notitie,
  };
}

/**
 * Roept de pure Gepland-Onderhoud-calculator aan en koppelt uitsluitend
 * persistentie-ID's terug aan de resulterende activiteit-uitkomsten —
 * positioneel (`invoer[i] ↔ resultaat.activiteiten[i]`), NOOIT herzocht op
 * omschrijving/complexnummer/bedragen. De defensieve lengte-controle bewaakt
 * uitsluitend die correlatie-aanname (een interne inconsistentie, geen
 * businessregel) — `berekenBegroteGeplandOnderhoud` zelf garandeert al een
 * 1-op-1 output-array (zie de pure module se eigen testsuite), dus dit pad is
 * in de praktijk onbereikbaar.
 */
function berekenGeplandOnderhoudUitInvoer(
  versieId: string,
  begrotingsjaar: number,
  activiteiten: readonly GeplandOnderhoudActiviteit[],
  beoordeeld: boolean,
): HerberekendGeplandOnderhoudResultaat {
  let resultaat: BgGeplandOnderhoudResultaat;
  try {
    resultaat = berekenBegroteGeplandOnderhoud(activiteiten.map(naarPureGeplandOnderhoudInvoer), { begrotingsjaar, beoordeeld });
  } catch (error) {
    throw new Error(
      `Berekening van begrotingsversie ${versieId} is mislukt tijdens Gepland Onderhoud: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (resultaat.activiteiten.length !== activiteiten.length) {
    throw new Error(
      `Interne fout: begrotingsversie ${versieId}: Gepland-Onderhoud-calculator gaf ${resultaat.activiteiten.length} activiteit-uitkomsten terug voor ${activiteiten.length} ingevoerde activiteiten — positionele id-correlatie geschonden.`,
    );
  }

  const activiteitenMetId: GeplandOnderhoudActiviteitUitkomstMetId[] = resultaat.activiteiten.map((activiteitUitkomst, index) => ({
    persistentieId: activiteiten[index]!.id,
    activiteit: activiteitUitkomst,
  }));

  return { ...resultaat, activiteiten: activiteitenMetId };
}

/** Letterlijke veldkopie, GEEN transformatie/validatie — GEEN type-boundary-cast nodig (in tegenstelling tot Gepland Onderhoud), zie `HerberekendeBegroting`'s moduledoc. */
function naarPureCorrectiefDagelijksInvoer(regel: CorrectiefDagelijksOnderhoudRegel): BgCorrectiefDagelijksRegelInvoer {
  return {
    omschrijving: regel.omschrijving,
    complexnummer: regel.complexnummer,
    jaarbedrag: regel.jaarbedrag,
  };
}

/**
 * Roept de pure Correctief/Dagelijks-Onderhoud-calculator aan en koppelt
 * uitsluitend persistentie-ID's terug aan de resulterende regel-uitkomsten —
 * positioneel (`invoer[i] ↔ resultaat.regels[i]`), zelfde principe en
 * defensieve lengte-controle als `berekenGeplandOnderhoudUitInvoer`.
 */
function berekenCorrectiefDagelijksUitInvoer(
  versieId: string,
  begrotingsjaar: number,
  regels: readonly CorrectiefDagelijksOnderhoudRegel[],
  beoordeeld: boolean,
): HerberekendCorrectiefDagelijksResultaat {
  let resultaat: BgCorrectiefDagelijksResultaat;
  try {
    resultaat = berekenBegroteCorrectiefDagelijksOnderhoud(regels.map(naarPureCorrectiefDagelijksInvoer), { begrotingsjaar, beoordeeld });
  } catch (error) {
    throw new Error(
      `Berekening van begrotingsversie ${versieId} is mislukt tijdens Correctief/Dagelijks Onderhoud: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (resultaat.regels.length !== regels.length) {
    throw new Error(
      `Interne fout: begrotingsversie ${versieId}: Correctief/Dagelijks-Onderhoud-calculator gaf ${resultaat.regels.length} regel-uitkomsten terug voor ${regels.length} ingevoerde regels — positionele id-correlatie geschonden.`,
    );
  }

  const regelsMetId: CorrectiefDagelijksRegelUitkomstMetId[] = resultaat.regels.map((regelUitkomst, index) => ({
    persistentieId: regels[index]!.id,
    regel: regelUitkomst,
  }));

  return { ...resultaat, regels: regelsMetId };
}

/** Letterlijke veldkopie, GEEN transformatie/validatie — GEEN type-boundary-cast nodig (zie `HerberekendeBegroting`'s moduledoc). */
function naarPureVerzekeringInvoer(regel: VerzekeringRegel): BgVerzekeringRegelInvoer {
  return {
    complexnummer: regel.complexnummer,
    verzekeraar: regel.verzekeraar,
    ingangsdatum: regel.ingangsdatum,
    looptijdMaanden: regel.looptijdMaanden,
    bedrag: regel.bedrag,
    indexPercentage: regel.indexPercentage,
    handmatigBegrootOverride: regel.handmatigBegrootOverride,
  };
}

/**
 * Roept de pure Verzekeringen-calculator aan en koppelt uitsluitend
 * persistentie-ID's terug aan de resulterende regel-uitkomsten —
 * positioneel (`invoer[i] ↔ resultaat.regels[i]`), zelfde principe en
 * defensieve lengte-controle als `berekenCorrectiefDagelijksUitInvoer`.
 */
function berekenVerzekeringUitInvoer(
  versieId: string,
  begrotingsjaar: number,
  regels: readonly VerzekeringRegel[],
  beoordeeld: boolean,
): HerberekendVerzekeringResultaat {
  let resultaat: BgVerzekeringResultaat;
  try {
    resultaat = berekenBegroteVerzekeringen(regels.map(naarPureVerzekeringInvoer), { begrotingsjaar, beoordeeld });
  } catch (error) {
    throw new Error(
      `Berekening van begrotingsversie ${versieId} is mislukt tijdens Verzekeringen: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (resultaat.regels.length !== regels.length) {
    throw new Error(
      `Interne fout: begrotingsversie ${versieId}: Verzekeringen-calculator gaf ${resultaat.regels.length} regel-uitkomsten terug voor ${regels.length} ingevoerde regels — positionele id-correlatie geschonden.`,
    );
  }

  const regelsMetId: VerzekeringRegelUitkomstMetId[] = resultaat.regels.map((regelUitkomst, index) => ({
    persistentieId: regels[index]!.id,
    regel: regelUitkomst,
  }));

  return { ...resultaat, regels: regelsMetId };
}

/** Letterlijke veldkopie, GEEN transformatie/validatie — GEEN type-boundary-cast nodig (zie `HerberekendeBegroting`'s moduledoc). */
function naarPureWozObjectInvoer(wozObject: WozObject): BgWozObjectInvoer {
  return {
    complexnummer: wozObject.complexnummer,
    wozObjectAdres: wozObject.wozObjectAdres,
    aanslagjaar: wozObject.aanslagjaar,
    waardepeildatum: wozObject.waardepeildatum,
    werkelijkeWoz: wozObject.werkelijkeWoz,
    verwachteWozOverride: wozObject.verwachteWozOverride,
  };
}

/**
 * Roept de pure Gemeentelijke-Lasten/WOZ-calculator aan en koppelt
 * uitsluitend persistentie-ID's terug aan de resulterende WOZ-object-
 * uitkomsten — positioneel (`invoer[i] ↔ resultaat.wozObjecten[i]`), zelfde
 * principe en defensieve lengte-controle als `berekenVerzekeringUitInvoer`.
 */
function berekenGemeentelijkeLastenUitInvoer(
  versieId: string,
  begrotingsjaar: number,
  wozObjecten: readonly WozObject[],
  moduleInvoer: GemeentelijkeLastenModuleInvoer,
): HerberekendGemeentelijkeLastenResultaat {
  let resultaat: BgGemeentelijkeLastenResultaat;
  try {
    resultaat = berekenBegroteGemeentelijkeLasten(wozObjecten.map(naarPureWozObjectInvoer), {
      begrotingsjaar,
      werkelijkeGemeentelijkeLasten: moduleInvoer.werkelijkeGemeentelijkeLasten,
      wozStijgingPercentage: moduleInvoer.wozStijgingPercentage,
      lastenPercentageStijging: moduleInvoer.lastenPercentageStijging,
      begrotingsPercentageOverride: moduleInvoer.begrotingsPercentageOverride,
      beoordeeld: moduleInvoer.beoordeeld,
    });
  } catch (error) {
    throw new Error(
      `Berekening van begrotingsversie ${versieId} is mislukt tijdens Gemeentelijke Lasten/WOZ: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (resultaat.wozObjecten.length !== wozObjecten.length) {
    throw new Error(
      `Interne fout: begrotingsversie ${versieId}: Gemeentelijke-Lasten-calculator gaf ${resultaat.wozObjecten.length} WOZ-object-uitkomsten terug voor ${wozObjecten.length} ingevoerde WOZ-objecten — positionele id-correlatie geschonden.`,
    );
  }

  const wozObjectenMetId: WozObjectUitkomstMetId[] = resultaat.wozObjecten.map((wozObjectUitkomst, index) => ({
    persistentieId: wozObjecten[index]!.id,
    wozObject: wozObjectUitkomst,
  }));

  return { ...resultaat, wozObjecten: wozObjectenMetId };
}

/** Letterlijke veldkopie, GEEN transformatie/validatie — GEEN type-boundary-cast nodig (zie `HerberekendeBegroting`'s moduledoc). */
function naarPureAlgemeneKostenRegelInvoer(regel: AlgemeneKostenRegel): BgAlgemeneKostenRegelInvoer {
  return {
    categorie: regel.categorie,
    ogbKostensoortCode: regel.ogbKostensoortCode,
    omschrijving: regel.omschrijving,
    complexnummer: regel.complexnummer,
    jaarbedrag: regel.jaarbedrag,
  };
}

/**
 * Roept de pure Algemene-Kosten-calculator aan en koppelt uitsluitend
 * persistentie-ID's terug aan de resulterende regel-uitkomsten — PER
 * CATEGORIE positioneel (`regelsVoorCategorie[j] ↔
 * resultaat.perCategorie[i].regels[j]`), zelfde principe en defensieve
 * lengte-controle als `berekenGemeentelijkeLastenUitInvoer`, maar toegepast
 * per categorie in plaats van over de volledige lijst — de pure calculator
 * filtert `regelsInvoer` zelf ook per categorie (stabiele volgorde, zie
 * `begroteAlgemeneKosten.ts`), dus hetzelfde filter hier op de
 * ID-dragende regels reproduceert exact dezelfde j-de-positie-correlatie.
 */
function berekenAlgemeneKostenUitInvoer(
  versieId: string,
  begrotingsjaar: number,
  regels: readonly AlgemeneKostenRegel[],
  categorieState: Record<BgAlgemeneKostenCategorie, AlgemeneKostenCategorieStateInvoer>,
  classificatie: readonly BgAlgemeneKostenClassificatieRegel[],
): HerberekendAlgemeneKostenResultaat {
  const categorieAannames = Object.fromEntries(
    ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie): [BgAlgemeneKostenCategorie, BgAlgemeneKostenCategorieAannames] => [
      categorie,
      {
        beoordeeld: categorieState[categorie].beoordeeld,
        vorigJaarBedrag: categorieState[categorie].vorigJaarBedrag,
        verwachteVerhogingPercentage: categorieState[categorie].verwachteVerhogingPercentage,
      },
    ]),
  ) as Record<BgAlgemeneKostenCategorie, BgAlgemeneKostenCategorieAannames>;

  let resultaat: BgAlgemeneKostenResultaat;
  try {
    resultaat = berekenBegroteAlgemeneKosten(regels.map(naarPureAlgemeneKostenRegelInvoer), categorieAannames, classificatie, { begrotingsjaar });
  } catch (error) {
    throw new Error(
      `Berekening van begrotingsversie ${versieId} is mislukt tijdens Algemene Kosten: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const perCategorieMetId: HerberekendAlgemeneKostenCategorieResultaat[] = resultaat.perCategorie.map((categorieResultaat) => {
    const regelsVoorCategorie = regels.filter((r) => r.categorie === categorieResultaat.categorie);
    if (categorieResultaat.regels.length !== regelsVoorCategorie.length) {
      throw new Error(
        `Interne fout: begrotingsversie ${versieId}: Algemene-Kosten-calculator gaf ${categorieResultaat.regels.length} regel-uitkomsten terug voor categorie ${categorieResultaat.categorie} met ${regelsVoorCategorie.length} ingevoerde regels — positionele id-correlatie geschonden.`,
      );
    }
    const regelsMetId: AlgemeneKostenRegelUitkomstMetId[] = categorieResultaat.regels.map((regelUitkomst, index) => ({
      persistentieId: regelsVoorCategorie[index]!.id,
      regel: regelUitkomst,
    }));
    return { ...categorieResultaat, regels: regelsMetId };
  });

  return { ...resultaat, perCategorie: perCategorieMetId };
}

/** Letterlijke veldkopie, GEEN transformatie/validatie — GEEN type-boundary-cast nodig (zie `HerberekendeBegroting`'s moduledoc). GEEN OGB-koppeling: een Leegstand-regel kent dat veld niet (zie `begroteLeegstand.ts`'s moduledoc). */
function naarPureLeegstandRegelInvoer(regel: LeegstandRegel): BgLeegstandRegelInvoer {
  return {
    categorie: regel.categorie,
    complexnummer: regel.complexnummer,
    complexomschrijving: regel.complexomschrijving,
    omschrijving: regel.omschrijving,
    q1: regel.q1,
    q2: regel.q2,
    q3: regel.q3,
    q4: regel.q4,
  };
}

/**
 * Roept de pure Leegstand-Begroting-calculator aan en koppelt uitsluitend
 * persistentie-ID's terug aan de resulterende regel-uitkomsten — PER
 * CATEGORIE positioneel, exact hetzelfde principe en dezelfde defensieve
 * lengte-controle als `berekenAlgemeneKostenUitInvoer`.
 */
function berekenLeegstandUitInvoer(
  versieId: string,
  begrotingsjaar: number,
  regels: readonly LeegstandRegel[],
  categorieState: Record<BgLeegstandCategorie, LeegstandCategorieStateInvoer>,
): HerberekendLeegstandResultaat {
  const categorieAannames = Object.fromEntries(
    LEEGSTAND_CATEGORIEEN.map((categorie): [BgLeegstandCategorie, BgLeegstandCategorieAannames] => [
      categorie,
      {
        beoordeeld: categorieState[categorie].beoordeeld,
        laatstBekendServicekostenvoorschotJaar: categorieState[categorie].laatstBekendServicekostenvoorschotJaar,
        laatstBekendServicekostenvoorschotJaarHerkomst: categorieState[categorie].laatstBekendServicekostenvoorschotJaarHerkomst,
        verwachteLeegstandsperiodeMaanden: categorieState[categorie].verwachteLeegstandsperiodeMaanden,
      },
    ]),
  ) as Record<BgLeegstandCategorie, BgLeegstandCategorieAannames>;

  let resultaat: BgLeegstandResultaat;
  try {
    resultaat = berekenBegroteLeegstand(regels.map(naarPureLeegstandRegelInvoer), categorieAannames, { begrotingsjaar });
  } catch (error) {
    throw new Error(
      `Berekening van begrotingsversie ${versieId} is mislukt tijdens Leegstandskosten: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const perCategorieMetId: HerberekendLeegstandCategorieResultaat[] = resultaat.perCategorie.map((categorieResultaat) => {
    const regelsVoorCategorie = regels.filter((r) => r.categorie === categorieResultaat.categorie);
    if (categorieResultaat.regels.length !== regelsVoorCategorie.length) {
      throw new Error(
        `Interne fout: begrotingsversie ${versieId}: Leegstand-calculator gaf ${categorieResultaat.regels.length} regel-uitkomsten terug voor categorie ${categorieResultaat.categorie} met ${regelsVoorCategorie.length} ingevoerde regels — positionele id-correlatie geschonden.`,
      );
    }
    const regelsMetId: LeegstandRegelUitkomstMetId[] = categorieResultaat.regels.map((regelUitkomst, index) => ({
      persistentieId: regelsVoorCategorie[index]!.id,
      regel: regelUitkomst,
    }));
    return { ...categorieResultaat, regels: regelsMetId };
  });

  return { ...resultaat, perCategorie: perCategorieMetId };
}

/**
 * Voert de pure Module-1-, Module-2-, (indien aanwezig) Module-3- en
 * Gepland-Onderhoud-berekening uit op reeds-gelezen invoer — GEEN eigen
 * transactie, raakt de database niet. Rekenfouten uit de pure lagen worden
 * nooit verborgen — uitsluitend aangevuld met `versieId`/module-context in de
 * foutmelding (de oorspronkelijke boodschap blijft letterlijk aanwezig, plus
 * `cause`).
 *
 * Module 3: bij `invoer.module3Invoer === null` wordt `berekenBegroteManagement
 * vergoeding` NIET aangeroepen — het resultaat is `module3: null` (geen
 * default-invoer, geen `Decimal(0)`-injectie, zie `HerberekendeBegroting`'s
 * moduledoc). Bij geldige invoer wordt uitsluitend de bestaande, ongewijzigde
 * pure functie aangeroepen — geen tweede/parallelle rekenroute.
 *
 * Gepland Onderhoud wordt, ANDERS dan Module 3, ALTIJD berekend — ook met nul
 * activiteiten en `beoordeeld=false` (zie `HerberekendeBegroting`'s moduledoc).
 * Correctief/Dagelijks Onderhoud en Verzekeringen volgen hetzelfde
 * ALTIJD-berekend-patroon.
 */
export function berekenBegrotingUitInvoer(
  versieId: string,
  invoer: HerberekenInvoer,
): {
  module1: BgHuurResultaat;
  module2: BgBeheerResultaat;
  module3: BgManagementResultaat | null;
  geplandOnderhoud: HerberekendGeplandOnderhoudResultaat;
  correctiefDagelijksOnderhoud: HerberekendCorrectiefDagelijksResultaat;
  verzekering: HerberekendVerzekeringResultaat;
  gemeentelijkeLasten: HerberekendGemeentelijkeLastenResultaat;
  algemeneKosten: HerberekendAlgemeneKostenResultaat;
  leegstand: HerberekendLeegstandResultaat;
} {
  let module1: BgHuurResultaat;
  try {
    module1 = berekenBegroteHuuropbrengsten(invoer.contracten, invoer.overrides, invoer.aannames, invoer.versie.bronPeildatum);
  } catch (error) {
    throw new Error(
      `Berekening van begrotingsversie ${versieId} is mislukt tijdens Module 1: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  let module2: BgBeheerResultaat;
  try {
    module2 = berekenBegroteBeheersvergoeding(module1, invoer.configs);
  } catch (error) {
    throw new Error(
      `Berekening van begrotingsversie ${versieId} is mislukt tijdens Module 2: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  let module3: BgManagementResultaat | null = null;
  if (invoer.module3Invoer !== null) {
    try {
      module3 = berekenBegroteManagementvergoeding(invoer.module3Invoer, { begrotingsjaar: invoer.versie.begrotingsjaar });
    } catch (error) {
      throw new Error(
        `Berekening van begrotingsversie ${versieId} is mislukt tijdens Module 3: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  const geplandOnderhoud = berekenGeplandOnderhoudUitInvoer(
    versieId,
    invoer.versie.begrotingsjaar,
    invoer.geplandOnderhoudActiviteiten,
    invoer.geplandOnderhoudBeoordeeld,
  );

  const correctiefDagelijksOnderhoud = berekenCorrectiefDagelijksUitInvoer(
    versieId,
    invoer.versie.begrotingsjaar,
    invoer.correctiefDagelijksRegels,
    invoer.correctiefDagelijksBeoordeeld,
  );

  const verzekering = berekenVerzekeringUitInvoer(versieId, invoer.versie.begrotingsjaar, invoer.verzekeringRegels, invoer.verzekeringBeoordeeld);

  const gemeentelijkeLasten = berekenGemeentelijkeLastenUitInvoer(
    versieId,
    invoer.versie.begrotingsjaar,
    invoer.wozObjecten,
    invoer.gemeentelijkeLastenModule,
  );

  const algemeneKosten = berekenAlgemeneKostenUitInvoer(
    versieId,
    invoer.versie.begrotingsjaar,
    invoer.algemeneKostenRegels,
    invoer.algemeneKostenCategorieState,
    invoer.algemeneKostenClassificatie,
  );

  const leegstand = berekenLeegstandUitInvoer(versieId, invoer.versie.begrotingsjaar, invoer.leegstandRegels, invoer.leegstandCategorieState);

  return { module1, module2, module3, geplandOnderhoud, correctiefDagelijksOnderhoud, verzekering, gemeentelijkeLasten, algemeneKosten, leegstand };
}

/**
 * Herberekent Module 1 + Module 2 (+ Module 3 indien aanwezig) + Gepland
 * Onderhoud + Correctief/Dagelijks Onderhoud + Verzekeringen voor
 * `versieId`, uitsluitend gebaseerd op wat al in SQLite staat.
 *
 * Consistentie van de invoer: alle reads gebeuren bínnen ÉÉN
 * `BEGIN`…`COMMIT`-leestransactie (`leesHerberekenInvoerZonderTransactie`
 * opent zelf geen transactie), zodat ze gegarandeerd tegen exact dezelfde
 * database-state lezen, ook als een andere schrijver tussen twee losse
 * aanroepen in zou schrijven. Onder WAL (al sinds 1D.1 actief) geeft dat een
 * consistente leessnapshot tegen eventuele gelijktijdige schrijvers, zonder
 * enige nieuwe locking-infrastructuur. De transactie sluit meteen na de
 * laatste read (`COMMIT`) — de pure berekening zelf raakt de database niet
 * en hoeft dus niet binnen de transactie te blijven; dat houdt de
 * transactie zo kort mogelijk open.
 *
 * `bronPeildatum` en `begrotingsjaar` komen UITSLUITEND uit de gelezen
 * `Begrotingsversie` (resp. rechtstreeks, en al door `leesModule1Aannames`
 * gereconstrueerd in de teruggegeven `BgHuurAannames`) — nooit `new Date()`,
 * nooit een andere bron.
 */
export function herberekenBegroting(db: DatabaseSync, versieId: string): HerberekendeBegroting {
  const invoer = withReadTransaction(db, () => leesHerberekenInvoerZonderTransactie(db, versieId));
  const { module1, module2, module3, geplandOnderhoud, correctiefDagelijksOnderhoud, verzekering, gemeentelijkeLasten, algemeneKosten, leegstand } =
    berekenBegrotingUitInvoer(versieId, invoer);
  return {
    versie: invoer.versie,
    module1,
    module2,
    module3,
    geplandOnderhoud,
    correctiefDagelijksOnderhoud,
    verzekering,
    gemeentelijkeLasten,
    algemeneKosten,
    leegstand,
  };
}
