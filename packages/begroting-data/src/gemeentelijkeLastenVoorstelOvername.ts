import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgWozVoorstelControle } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import { leesGemeentelijkeLastenRegels, schrijfGemeentelijkeLastenRegels, type GemeentelijkeLastenRegel } from "./gemeentelijkeLastenRegels.js";
import { berekenGemeentelijkeLastenUitInvoer, leesHerberekenInvoerZonderTransactie } from "./herberekenen.js";

/**
 * "Voorstel overnemen" — domein-/servicefunctie voor een TOEKOMSTIGE UI-actie (Vervolgtranche 6 deel A; besluit na
 * Vervolgtranche 4). Er is bewust GEEN UI: dit bestand legt uitsluitend het contract vast waarop een latere
 * knop/dialoog kan aansluiten.
 *
 * BESLUIT (Master Contract §6.8): het WOZ-voorstel blijft onderbouwing/referentie en wordt NOOIT automatisch over
 * meerdere GL's verdeeld. Bij EXACT ÉÉN relevante GL mag de gebruiker bewust "Voorstel overnemen": het volledige
 * WOZ-voorstel wordt dan het jaarbedrag van de GL-regel van die GL. Bij meerdere relevante GL's vult de gebruiker de
 * bedragen zelf in — deze functie weigert dan (`MEERDERE_RELEVANTE_GLS`) en verdeelt nooit.
 *
 * UI-CONTRACT
 *  1. `leesGemeentelijkeLastenVoorstelStatus(db, versieId)` — read-only; levert de controle `WOZ-voorstel | Begroot via
 *     GL-regels | Verschil` en of/waarom overnemen mogelijk is (`mogelijk`, `blokkade`, `reden`, `doelGrootboek`). Een
 *     UI schakelt de knop uit zolang `mogelijk = false` en toont `reden`.
 *  2. `neemWozVoorstelOver(db, versieId)` — de bewuste actie; schrijft via de bestaande complete-list-save
 *     (`schrijfGemeentelijkeLastenRegels`) en faalt met `VoorstelOvernameGeweigerdError` (met `blokkade`) als de status
 *     `mogelijk = false` is. Er is geen "stille" variant en geen automatische aanroep ergens in de keten.
 *
 * VOORWAARDEN (alle expliciet, geen aanname): CONCEPT-versie; WOZ-objecten aanwezig en WOZ-set bevestigd (vóór de
 * bevestiging bestaat er geen voorstel); exact één relevante GL volgens de centrale mapping van de administratie; het
 * voorstel is betrouwbaar (geen KRITIEK in de WOZ-berekening — een voorstel op basis van ontbrekende aannames zou een
 * veilige 0 kunnen zijn en wordt nooit overgenomen); de bestaande GL-regels zijn ondubbelzinnig: geen regel, of
 * precies één regel voor de doel-GL (die wordt bijgewerkt, OGB blijft behouden). Overige bestaande regels zouden bij
 * overschrijven gebruikersinvoer wegnemen en worden daarom niet stil vervangen (`BESTAANDE_REGELS_TEGENSTRIJDIG`).
 *
 * De actie zet NIETS anders: geen bevestiging, geen beoordeling, geen periodiciteit/complexdimensie.
 */

export type VoorstelOvernameBlokkade =
  | "VERSIE_NIET_CONCEPT"
  | "GEEN_WOZ_OBJECTEN"
  | "WOZ_SET_NIET_BEVESTIGD"
  | "VOORSTEL_ONBETROUWBAAR"
  | "GEEN_RELEVANTE_GL"
  | "MEERDERE_RELEVANTE_GLS"
  | "BESTAANDE_REGELS_TEGENSTRIJDIG";

export interface GemeentelijkeLastenVoorstelStatus {
  mogelijk: boolean;
  blokkade: VoorstelOvernameBlokkade | null;
  reden: string | null;
  /** De GL waarop het voorstel zou worden gezet; alleen gevuld bij `mogelijk = true`. */
  doelGrootboek: string | null;
  /** `WOZ-voorstel | Begroot via GL-regels | Verschil`; `null` bij een niet-CONCEPT-versie (dan is er geen herberekening). */
  controle: BgWozVoorstelControle | null;
}

export class VoorstelOvernameGeweigerdError extends Error {
  readonly blokkade: VoorstelOvernameBlokkade;
  constructor(blokkade: VoorstelOvernameBlokkade, reden: string) {
    super(`Voorstel overnemen niet mogelijk (${blokkade}): ${reden}`);
    this.name = "VoorstelOvernameGeweigerdError";
    this.blokkade = blokkade;
  }
}

interface Beslissing {
  status: GemeentelijkeLastenVoorstelStatus;
  voorstel: Decimal | null;
  bestaandeDoelRegel: GemeentelijkeLastenRegel | null;
}

function geblokkeerd(blokkade: VoorstelOvernameBlokkade, reden: string, controle: BgWozVoorstelControle | null): Beslissing {
  return { status: { mogelijk: false, blokkade, reden, doelGrootboek: null, controle }, voorstel: null, bestaandeDoelRegel: null };
}

function bepaalBeslissing(db: DatabaseSync, versieId: string): Beslissing {
  db.exec("BEGIN");
  try {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    if (versie.status !== "CONCEPT") {
      db.exec("COMMIT");
      return geblokkeerd("VERSIE_NIET_CONCEPT", `begrotingsversie heeft status ${versie.status}; het voorstel kan alleen op een CONCEPT-versie worden overgenomen.`, null);
    }
    const invoer = leesHerberekenInvoerZonderTransactie(db, versieId);
    db.exec("COMMIT");

    const resultaat = berekenGemeentelijkeLastenUitInvoer(versieId, invoer.versie.begrotingsjaar, invoer.wozObjecten, invoer.gemeentelijkeLastenModule, invoer.gemeentelijkeLastenRegels, invoer.gemeentelijkeLastenRelevanteGrootboeken);
    const controle = resultaat.grootboekRegels.wozVoorstelControle;

    if (invoer.wozObjecten.length === 0) {
      return geblokkeerd("GEEN_WOZ_OBJECTEN", "er zijn geen WOZ-objecten, dus er is geen WOZ-voorstel (bewuste-€0-pad blijft van toepassing).", controle);
    }
    if (!invoer.gemeentelijkeLastenModule.wozSetBevestigd) {
      return geblokkeerd("WOZ_SET_NIET_BEVESTIGD", "de WOZ-set is nog niet als compleet bevestigd; vóór bevestiging wordt geen voorstel berekend.", controle);
    }
    if (resultaat.controleVereist.some((c) => c.ernst === "KRITIEK") || resultaat.begroteGemeentelijkeLasten === null) {
      return geblokkeerd("VOORSTEL_ONBETROUWBAAR", "de WOZ-berekening bevat kritieke controles (ontbrekende of ongeldige aannames/gegevens); een voorstel daarop wordt niet overgenomen.", controle);
    }
    const relevant = invoer.gemeentelijkeLastenRelevanteGrootboeken;
    if (relevant.length === 0) {
      return geblokkeerd("GEEN_RELEVANTE_GL", "voor deze administratie is in de centrale mapping geen relevante Gemeentelijke-lasten-GL bekend.", controle);
    }
    if (relevant.length > 1) {
      return geblokkeerd("MEERDERE_RELEVANTE_GLS", `er zijn ${relevant.length} relevante GL's (${relevant.map((g) => g.grootboekrekening).join(", ")}); het voorstel wordt nooit verdeeld — vul de bedragen per GL zelf in.`, controle);
    }

    const doel = relevant[0]!.grootboekrekening;
    const bestaand = invoer.gemeentelijkeLastenRegels;
    if (bestaand.length > 1 || (bestaand.length === 1 && bestaand[0]!.grootboekrekening !== doel)) {
      return geblokkeerd("BESTAANDE_REGELS_TEGENSTRIJDIG", `er bestaan al GL-regels die niet eenduidig op GL ${doel} zijn te vervangen (${bestaand.length} regel(s)); pas ze eerst bewust aan.`, controle);
    }
    return {
      status: { mogelijk: true, blokkade: null, reden: null, doelGrootboek: doel, controle },
      voorstel: resultaat.begroteGemeentelijkeLasten,
      bestaandeDoelRegel: bestaand[0] ?? null,
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* transactie was al gesloten */
    }
    throw error;
  }
}

/** Read-only: de controle en de overname-mogelijkheid voor een toekomstige UI. Faalt alleen op een niet-bestaande versie. */
export function leesGemeentelijkeLastenVoorstelStatus(db: DatabaseSync, versieId: string): GemeentelijkeLastenVoorstelStatus {
  return bepaalBeslissing(db, versieId).status;
}

export interface WozVoorstelOvername {
  regelId: number;
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** Het overgenomen (volledige) WOZ-voorstel. */
  jaarbedrag: Decimal;
  /** Het bedrag van de regel vóór de overname; `null` als de regel nieuw is of nog geen bedrag had (niet ingevuld). */
  vorigJaarbedrag: Decimal | null;
}

/** De bewuste actie "Voorstel overnemen"; zie het UI-contract in de moduledoc. */
export function neemWozVoorstelOver(db: DatabaseSync, versieId: string): WozVoorstelOvername {
  const { status, voorstel, bestaandeDoelRegel } = bepaalBeslissing(db, versieId);
  if (!status.mogelijk || voorstel === null || status.doelGrootboek === null) {
    throw new VoorstelOvernameGeweigerdError(status.blokkade ?? "VOORSTEL_ONBETROUWBAAR", status.reden ?? "onbekende reden");
  }
  schrijfGemeentelijkeLastenRegels(db, versieId, [
    { id: bestaandeDoelRegel?.id ?? null, grootboekrekening: status.doelGrootboek, ogbKostensoort: bestaandeDoelRegel?.ogbKostensoort ?? null, jaarbedrag: voorstel },
  ]);
  const regel = leesGemeentelijkeLastenRegels(db, versieId)[0]!;
  return { regelId: regel.id, grootboekrekening: regel.grootboekrekening, ogbKostensoort: regel.ogbKostensoort, jaarbedrag: voorstel, vorigJaarbedrag: bestaandeDoelRegel?.jaarbedrag ?? null };
}
