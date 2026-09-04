import type { DatabaseSync } from "node:sqlite";
import {
  berekenBegroteBeheersvergoeding,
  berekenBegroteGeplandOnderhoud,
  berekenBegroteHuuropbrengsten,
  berekenBegroteManagementvergoeding,
  type BgBeheerComplexConfig,
  type BgBeheerResultaat,
  type BgContractFeiten,
  type BgContractOverride,
  type BgGeplandOnderhoudAanleidingType,
  type BgGeplandOnderhoudActiviteitInvoer,
  type BgGeplandOnderhoudActiviteitUitkomst,
  type BgGeplandOnderhoudResultaat,
  type BgGeplandOnderhoudStatus,
  type BgHuurAannames,
  type BgHuurResultaat,
  type BgManagementInvoer,
  type BgManagementResultaat,
} from "@bvc/reporting";
import { leesBegrotingsversie, type Begrotingsversie } from "./begrotingsversies.js";
import { leesGeplandOnderhoudActiviteiten, type GeplandOnderhoudActiviteit } from "./geplandOnderhoudActiviteiten.js";
import { leesGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";
import { leesModule1Aannames } from "./module1Aannames.js";
import { leesModule1Overrides } from "./module1Overrides.js";
import { leesModule1Snapshot } from "./module1Snapshot.js";
import { leesModule2Config } from "./module2Config.js";
import { leesModule3Invoer } from "./module3Invoer.js";

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
 */
export interface HerberekendeBegroting {
  versie: Begrotingsversie;
  module1: BgHuurResultaat;
  module2: BgBeheerResultaat;
  module3: BgManagementResultaat | null;
  geplandOnderhoud: HerberekendGeplandOnderhoudResultaat;
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
 */
export function berekenBegrotingUitInvoer(
  versieId: string,
  invoer: HerberekenInvoer,
): { module1: BgHuurResultaat; module2: BgBeheerResultaat; module3: BgManagementResultaat | null; geplandOnderhoud: HerberekendGeplandOnderhoudResultaat } {
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

  return { module1, module2, module3, geplandOnderhoud };
}

/**
 * Herberekent Module 1 + Module 2 (+ Module 3 indien aanwezig) + Gepland
 * Onderhoud voor `versieId`, uitsluitend gebaseerd op wat al in SQLite staat.
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
  const { module1, module2, module3, geplandOnderhoud } = berekenBegrotingUitInvoer(versieId, invoer);
  return { versie: invoer.versie, module1, module2, module3, geplandOnderhoud };
}
