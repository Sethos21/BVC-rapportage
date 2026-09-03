import type { DatabaseSync } from "node:sqlite";
import type { BgBeheerResultaat, BgHuurResultaat } from "@bvc/reporting";
import { leesBegrotingsversie, markeerVastgesteld, type Begrotingsversie } from "./begrotingsversies.js";
import { schrijfFrozenBegrotingsresultaatZonderTransactie } from "./frozenResultaat.js";
import { berekenBegrotingUitInvoer, leesHerberekenInvoerZonderTransactie } from "./herberekenen.js";

/**
 * De atomaire VASTSTELLEN-operatie (Fase 1D.6b) — de enige plek waar een
 * CONCEPT-begrotingsversie definitief VASTGESTELD wordt. Eén complete
 * SQLite-schrijftransactie: dezelfde persistente input lezen als
 * `herberekenBegroting`, exact dezelfde pure Module-1/2-berekening
 * uitvoeren, dat resultaat als frozen output opslaan (`schrijfFrozen
 * BegrotingsresultaatZonderTransactie`, 1D.6a's bestaande mapping —
 * ongewijzigd, geen tweede mapping), en pas als allerlaatste schrijfactie
 * de status omzetten (`markeerVastgesteld`, het bestaande 1D.2-bouwblok).
 * Faalt één van deze stappen, dan rolt de VOLLEDIGE transactie terug: geen
 * gedeeltelijke frozen output, geen gedeeltelijke statuswijziging, de
 * versie blijft exact zoals vóór de poging.
 *
 * Bundelt uitsluitend de al bestaande `Begrotingsversie`/`BgHuurResultaat`/
 * `BgBeheerResultaat` — bewust geen shadow-rekenresultaattype.
 */
export interface VastgesteldeBegroting {
  versie: Begrotingsversie;
  module1: BgHuurResultaat;
  module2: BgBeheerResultaat;
}

/**
 * `BEGIN IMMEDIATE` (niet het gewone `BEGIN`/`BEGIN DEFERRED` dat elders in
 * dit package wordt gebruikt voor reads en voor de op-zichzelf-staande
 * schrijfoperaties zoals `schrijfModule1Snapshot`): deze transactie
 * verwerft meteen bij `BEGIN` het schrijfslot, in plaats van pas bij de
 * eerste feitelijke schrijfstatement. Reden, specifiek voor vaststellen:
 * twee gelijktijdige vaststelpogingen op DEZELFDE CONCEPT-versie mogen
 * nooit allebei eerst de volledige (niet-triviale) berekening uitvoeren
 * tegen een CONCEPT-snapshot die door de ander al aan het wijzigen is naar
 * VASTGESTELD. Met `BEGIN IMMEDIATE` wacht de tweede poging (via de
 * bestaande `busy_timeout = 5000` uit 1D.1) op het schrijfslot van de
 * eerste; komt ze daarna aan de beurt, leest ze de dan-al-VASTGESTELDE
 * status opnieuw en weigert via de bestaande statuscheck — nooit een
 * dubbele, race-gevoelige vaststelling. Geen zwaardere locking-
 * infrastructuur nodig; dit is precies waarvoor `BEGIN IMMEDIATE` bestaat.
 */
function withWriteTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
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
 * Stelt begrotingsversie `versieId` definitief vast. Zie moduledoc voor de
 * volledige atomaire flow. `vastgesteldAt` is optioneel — ontbreekt hij, dan
 * wordt `new Date()` exact ÉÉN keer aangeroepen op dit niveau en voor zowel
 * de DB-statusupdate als de geretourneerde versie gebruikt (nooit twee
 * losse `new Date()`-aanroepen die subtiel uiteen zouden kunnen lopen).
 *
 * Alleen CONCEPT mag worden vastgesteld — een niet-bestaande of al
 * VASTGESTELDE versie geeft een duidelijke fout (via
 * `leesHerberekenInvoerZonderTransactie`, dezelfde statuscheck als
 * `herberekenBegroting`; geen tweede, dubbele precheck). Geen idempotente
 * "nogmaals vaststellen" — een tweede poging op een inmiddels VASTGESTELDE
 * versie faalt hard, ongeacht of het resultaat toevallig identiek zou zijn.
 *
 * Bestaande, tijdelijke frozen output van CONCEPT (indien aanwezig) wordt
 * altijd volledig vervangen door een verse berekening tegen de HUIDIGE
 * persistente input op het moment van vaststellen — nooit blind
 * geaccepteerd als definitief.
 *
 * `controleVereist`-items (beide modules) blokkeren vaststellen NIET —
 * alleen een daadwerkelijke pure-laag-exceptie (fail-fast) stopt de
 * operatie; dat is de bestaande, ongewijzigde semantiek van beide pure
 * functies (zie `berekenBegrotingUitInvoer`), hier niet opnieuw
 * geïnterpreteerd.
 */
export function stelBegrotingVast(db: DatabaseSync, versieId: string, vastgesteldAt: Date = new Date()): VastgesteldeBegroting {
  return withWriteTransaction(db, () => {
    const invoer = leesHerberekenInvoerZonderTransactie(db, versieId);
    const { module1, module2 } = berekenBegrotingUitInvoer(versieId, invoer);

    schrijfFrozenBegrotingsresultaatZonderTransactie(db, versieId, { module1, module2 });
    markeerVastgesteld(db, versieId, vastgesteldAt); // allerlaatste schrijfactie vóór commit

    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Interne fout: begrotingsversie ${versieId} kon direct na vaststellen niet worden teruggelezen.`);
    }

    return { versie, module1, module2 };
  });
}
