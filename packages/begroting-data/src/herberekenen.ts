import type { DatabaseSync } from "node:sqlite";
import { berekenBegroteBeheersvergoeding, berekenBegroteHuuropbrengsten, type BgBeheerResultaat, type BgHuurResultaat } from "@bvc/reporting";
import { leesBegrotingsversie, type Begrotingsversie } from "./begrotingsversies.js";
import { leesModule1Aannames } from "./module1Aannames.js";
import { leesModule1Overrides } from "./module1Overrides.js";
import { leesModule1Snapshot } from "./module1Snapshot.js";
import { leesModule2Config } from "./module2Config.js";

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
 */
export interface HerberekendeBegroting {
  versie: Begrotingsversie;
  module1: BgHuurResultaat;
  module2: BgBeheerResultaat;
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
 * Herberekent Module 1 + Module 2 voor `versieId`, uitsluitend gebaseerd op
 * wat al in SQLite staat.
 *
 * Consistentie van de invoer: de vijf/zes afzonderlijke reads (versie,
 * snapshot, aannames, overrides, config) gebeuren allemaal bínnen ÉÉN
 * `BEGIN`…`COMMIT`-leestransactie (geen van de bestaande `lees*`-functies
 * opent zelf een transactie), zodat ze gegarandeerd tegen exact dezelfde
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
 *
 * Faalt hard (geen catch-and-continue, geen stille lege resultaten) als:
 * - de versie niet bestaat;
 * - de versie niet CONCEPT is (VASTGESTELD krijgt in Fase 1D.6 een eigen
 *   frozen-outputpad — hier expliciet nog geweigerd);
 * - er geen Module-1-aannames zijn opgeslagen.
 * Een lege snapshot/overrides/Module-2-config is daarentegen een geldige,
 * bestaande toestand — die wordt ongewijzigd doorgegeven aan de pure lagen,
 * die zelf bepalen welke controles daaruit volgen.
 *
 * Rekenfouten uit de pure lagen worden nooit verborgen — uitsluitend
 * aangevuld met `versieId`/module-context in de foutmelding (de
 * oorspronkelijke boodschap blijft letterlijk aanwezig, plus `cause`).
 */
export function herberekenBegroting(db: DatabaseSync, versieId: string): HerberekendeBegroting {
  const invoer = withReadTransaction(db, () => {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status !== "CONCEPT") {
      throw new Error(
        `Begrotingsversie ${versieId} heeft status ${versie.status} — herberekenen is in deze fase uitsluitend mogelijk voor een CONCEPT-versie (een VASTGESTELDE versie krijgt in Fase 1D.6 een eigen frozen-outputpad, geen impliciete live-herberekening).`,
      );
    }

    const aannames = leesModule1Aannames(db, versieId);
    if (aannames === null) {
      throw new Error(`Begrotingsversie ${versieId}: geen Module-1-aannames opgeslagen — herberekenen is zonder aannames niet mogelijk.`);
    }

    return {
      versie,
      contracten: leesModule1Snapshot(db, versieId),
      aannames,
      overrides: leesModule1Overrides(db, versieId),
      configs: leesModule2Config(db, versieId),
    };
  });

  let module1: BgHuurResultaat;
  try {
    module1 = berekenBegroteHuuropbrengsten(invoer.contracten, invoer.overrides, invoer.aannames, invoer.versie.bronPeildatum);
  } catch (error) {
    throw new Error(
      `Herberekening van begrotingsversie ${versieId} is mislukt tijdens Module 1: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  let module2: BgBeheerResultaat;
  try {
    module2 = berekenBegroteBeheersvergoeding(module1, invoer.configs);
  } catch (error) {
    throw new Error(
      `Herberekening van begrotingsversie ${versieId} is mislukt tijdens Module 2: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  return { versie: invoer.versie, module1, module2 };
}
