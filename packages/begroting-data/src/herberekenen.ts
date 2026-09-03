import type { DatabaseSync } from "node:sqlite";
import {
  berekenBegroteBeheersvergoeding,
  berekenBegroteHuuropbrengsten,
  berekenBegroteManagementvergoeding,
  type BgBeheerComplexConfig,
  type BgBeheerResultaat,
  type BgContractFeiten,
  type BgContractOverride,
  type BgHuurAannames,
  type BgHuurResultaat,
  type BgManagementInvoer,
  type BgManagementResultaat,
} from "@bvc/reporting";
import { leesBegrotingsversie, type Begrotingsversie } from "./begrotingsversies.js";
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
 */
export interface HerberekendeBegroting {
  versie: Begrotingsversie;
  module1: BgHuurResultaat;
  module2: BgBeheerResultaat;
  module3: BgManagementResultaat | null;
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
  };
}

/**
 * Voert de pure Module-1-, Module-2- en (indien aanwezig) Module-3-
 * berekening uit op reeds-gelezen invoer — GEEN eigen transactie, raakt de
 * database niet. Rekenfouten uit de pure lagen worden nooit verborgen —
 * uitsluitend aangevuld met `versieId`/module-context in de foutmelding (de
 * oorspronkelijke boodschap blijft letterlijk aanwezig, plus `cause`).
 *
 * Module 3: bij `invoer.module3Invoer === null` wordt `berekenBegroteManagement
 * vergoeding` NIET aangeroepen — het resultaat is `module3: null` (geen
 * default-invoer, geen `Decimal(0)`-injectie, zie `HerberekendeBegroting`'s
 * moduledoc). Bij geldige invoer wordt uitsluitend de bestaande, ongewijzigde
 * pure functie aangeroepen — geen tweede/parallelle rekenroute.
 */
export function berekenBegrotingUitInvoer(
  versieId: string,
  invoer: HerberekenInvoer,
): { module1: BgHuurResultaat; module2: BgBeheerResultaat; module3: BgManagementResultaat | null } {
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

  return { module1, module2, module3 };
}

/**
 * Herberekent Module 1 + Module 2 voor `versieId`, uitsluitend gebaseerd op
 * wat al in SQLite staat.
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
  const { module1, module2, module3 } = berekenBegrotingUitInvoer(versieId, invoer);
  return { versie: invoer.versie, module1, module2, module3 };
}
