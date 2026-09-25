import Decimal from "decimal.js";

/**
 * Openstaande-posten v1 (2026-08-31) — pure domeinlogica, NOG GEEN
 * renderer/UI/koppeling aan Huurdersoverzicht of het managementrapport.
 *
 * Detailbron: `vorderingen_met_afboekingen` (individuele posten,
 * contractattributie). Control-/ouderdomsbron: `saldo_huurders` (huurder-
 * niveau officieel saldo + Informant-ouderdomsbuckets — dezelfde cache-
 * tabel als voorheen `ouderdomsanalyse`, zie packages/reporting/README.md
 * voor de bronmigratie). Bewezen tegen de echte 070-cache (2026-08-31):
 * detail-openstaand € 65.811,57 sluit exact op saldo_huurders (14/14
 * huurders MATCH), inclusief de creditpost (-€146,90) en de iTapToo-
 * contractsplitsing (044: € 3.544,33 / 049: € 1.409,38).
 *
 * `Datum_Vordering` blijft ONGEWIJZIGD als vervaldatum-kandidaat voor
 * reguliere huur — NOOIT genormaliseerd naar de eerste van de maand
 * (bewezen: contract-specifieke afwijkingen bestaan, bv. altijd de 8e van
 * de maand bij één 011-contract). Voor andere vorderingstypen (service-
 * afrekeningen e.d.) wordt geen vervaldatumsemantiek aangenomen — deze
 * module doet daarom GEEN eigen ouderdomsberekening; de bewezen
 * Informant-buckets uit `saldo_huurders` blijven de enige ouderdomsbron
 * (exacte bucketgrenzen zijn niet volledig bewezen, zie README).
 *
 * Bankaflettering-context (businessfeit, bevestigd 2026-08-31): niet elke
 * administratie wordt door ons op de bank/aflettering bijgehouden. Een
 * reconciliatieverschil tussen detail en saldo_huurders is daarom GEEN
 * automatische technische fout — de ernst hangt af van
 * `DebiteurenbeheerStatus` (zie @bvc/worker's administratie.ts):
 * - `true`  → verschil is een echt datakwaliteitssignaal (WAARSCHUWING).
 * - `false` → verschil wordt niet als fout gepresenteerd; één structurele
 *             INFORMATIEF-melding legt de context uit.
 * - `"onbekend"` → nog niet geclassificeerd, WAARSCHUWING met neutrale
 *             melding (geen aanname over betrouwbaarheid).
 * Businessstatus en presentatietekst blijven hier gescheiden: dit domein
 * bepaalt WAT er staat (ernst + bericht, precies één keer geformuleerd),
 * een toekomstige renderer beslist alleen HOE dat getoond wordt.
 */

export type DebiteurenbeheerStatus = boolean | "onbekend";

export interface OpVorderingRegel {
  bedrijfsnr: string;
  contractnummer: string;
  vorderingVolgnummer: string;
  huurdernummer: string;
  complexnummer: string | null;
  unitnummer: string | null;
  factuurnummer: string | null;
  /** Periodestartdatum uit de bron — voor reguliere "Periode …"-huur de vervaldatum-kandidaat, ONGEWIJZIGD, nooit genormaliseerd. */
  datumVordering: Date;
  omschrijving: string | null;
  totaalbedrag: Decimal;
  bedragAfgeboekt: Decimal;
  openstaand: Decimal;
}

export interface OpSaldoHuurderRegel {
  huurdernummer: string;
  achterstand: Decimal;
  achterstandTm30Dagen: Decimal;
  achterstandTm60Dagen: Decimal;
  achterstandTm90Dagen: Decimal;
  achterstand90PlusDagen: Decimal;
  vooruitbetaling: Decimal;
  saldo: Decimal;
}

export type OpControleErnst = "KRITIEK" | "WAARSCHUWING" | "INFORMATIEF";

export interface OpControleItem {
  /** `null` = niet aan één specifieke huurder toe te wijzen (bv. de administratiebrede debiteurenbeheer-melding). */
  huurdernummer: string | null;
  ernst: OpControleErnst;
  bericht: string;
}

export interface OpHuurderRegel {
  huurdernummer: string;
  openstaandePosten: OpVorderingRegel[];
  /** Som van openstaand over deze huurder se posten in de detailbron. */
  detailtotaal: Decimal;
  /** `null` = geen saldo_huurders-rij voor deze huurder gevonden. */
  saldoHuurders: Decimal | null;
  /** `null` als saldoHuurders ontbreekt. */
  verschilMetSaldo: Decimal | null;
  /** Bronbuckets uit saldo_huurders — NOOIT zelfberekend. `null` als geen saldo_huurders-rij bestaat. */
  buckets: {
    tm30: Decimal;
    tm60: Decimal;
    tm90: Decimal;
    negentigPlus: Decimal;
    vooruitbetaling: Decimal;
  } | null;
}

export interface OpResultaat {
  debiteurenbeheer: DebiteurenbeheerStatus;
  huurders: OpHuurderRegel[];
  totaalOpenstaandDetail: Decimal;
  totaalSaldoHuurders: Decimal;
  controleVereist: OpControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

/**
 * Vervallen/credit-classificatie (2026-09-01) — businessbeslissing, geen
 * bronfeit: geen van de vier onderzochte bronnen (vorderingen_met_
 * afboekingen, 1310-boekingen, contracten_huidig, rentroll) bevat een echt
 * vervaldatum-/betaaltermijnveld (`Vordering_aut_incasso` is een ja/nee-vlag,
 * geen termijn; `Debiteur_Betaaltermijn` op de 1310-boekingen is voor alle
 * 070-rijen 0). Vastgesteld beleid: `vervaldatum = Datum_Vordering +
 * betaaltermijnDagen`; vervallen zodra `peildatum > vervaldatum`. Voor 070
 * geldt `betaaltermijnDagen = 0`, dus exact `Datum_Vordering < peildatum`
 * (bewezen met de septemberposten op peildatum 2026-09-01: Datum_Vordering
 * = peildatum → NIET_VERVALLEN, dus de dag zelf telt nog niet mee).
 * `betaaltermijnDagen` is de enige knop voor een toekomstige administratie
 * met een andere betaaltermijn — bewust GEEN eigen configbestand/-schema,
 * één `number`-parameter volstaat (zie @bvc/worker's `administratie.ts`'s
 * `DebiteurenbeheerConfig.betaaltermijnDagen`).
 */
export type OpClassificatie = "NIET_VERVALLEN" | "VERVALLEN" | "CREDIT";

export interface OpGeclassificeerdePost extends OpVorderingRegel {
  classificatie: OpClassificatie;
  /** Alleen gevuld bij VERVALLEN: `peildatum - (Datum_Vordering + betaaltermijnDagen)` in hele dagen. */
  dagenVervallen: number | null;
  /** Bewezen periodeweergave uit `omschrijving`, of `"onbekend"` — zie `bepaalPeriodeWeergave`. */
  periodeWeergave: string;
}

const MAANDNAMEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const MAAND_PATROON = MAANDNAMEN.join("|");
const PERIODE_ENKELE_MAAND = new RegExp(`^Periode\\s+(${MAAND_PATROON})\\s+(\\d{4})$`, "i");
const PERIODE_MEERDERE_MAANDEN = new RegExp(`^Periode\\s+(${MAAND_PATROON})\\s+t/m\\s+(${MAAND_PATROON})\\s+(\\d{4})$`, "i");

function hoofdletter(tekst: string): string {
  return tekst.charAt(0).toUpperCase() + tekst.slice(1);
}

/**
 * Bewezen periodeweergave voor een detailpost — UITSLUITEND de twee
 * exact-geverifieerde patronen (070, 2026-08): `"Periode <maand> <jaar>"`
 * (545/678 regels, één kalendermaand — Datum_Vordering bevestigd gelijk aan
 * Vordering_Boekperiode/-Boekjaar) wordt teruggebracht tot `"<Maand> <jaar>"`;
 * `"Periode <maand> t/m <maand> <jaar>"` (43/678, meerdere maanden) wordt
 * VERBATIM getoond, nooit tot één maand teruggebracht. Al het overige
 * (service-afrekening, suppletie, doorbelasting, correctie, boete, vrije
 * tekst, of afwijkende varianten zoals "... correctie"-suffixen) → `"onbekend"`
 * — geen periode verzinnen.
 */
export function bepaalPeriodeWeergave(omschrijving: string | null): string {
  if (omschrijving === null) return "onbekend";
  const enkeleMaand = PERIODE_ENKELE_MAAND.exec(omschrijving.trim());
  if (enkeleMaand) return `${hoofdletter(enkeleMaand[1]!.toLowerCase())} ${enkeleMaand[2]}`;
  const meerdereMaanden = PERIODE_MEERDERE_MAANDEN.exec(omschrijving.trim());
  if (meerdereMaanden) return omschrijving.trim();
  return "onbekend";
}

const DAG_IN_MS = 1000 * 60 * 60 * 24;

/**
 * Classificeert reeds-openstaande posten (`openstaand !== 0`) als
 * NIET_VERVALLEN/VERVALLEN/CREDIT — zie moduledoc hierboven voor de
 * vastgestelde vervaldatum-regel. Verwacht posten die AL uit
 * `berekenOpenstaandePosten`'s resultaat komen (bv.
 * `opResultaat.huurders.flatMap(h => h.openstaandePosten)`) — filtert hier
 * dus NIET nogmaals op nul (voorkomt een tweede bronberekening/-filter,
 * zie moduledoc). `peildatum` moet expliciet worden meegegeven (nooit
 * `new Date()` hier).
 */
export function classificeerOpenstaandePosten(
  posten: readonly OpVorderingRegel[],
  peildatum: Date,
  betaaltermijnDagen: number,
): OpGeclassificeerdePost[] {
  return posten
    .filter((post) => !post.openstaand.isZero())
    .map((post) => {
      const periodeWeergave = bepaalPeriodeWeergave(post.omschrijving);

      if (post.openstaand.isNegative()) {
        return { ...post, classificatie: "CREDIT" as const, dagenVervallen: null, periodeWeergave };
      }

      const vervaldatum = new Date(post.datumVordering.getTime() + betaaltermijnDagen * DAG_IN_MS);
      if (peildatum.getTime() > vervaldatum.getTime()) {
        const dagenVervallen = Math.round((peildatum.getTime() - vervaldatum.getTime()) / DAG_IN_MS);
        return { ...post, classificatie: "VERVALLEN" as const, dagenVervallen, periodeWeergave };
      }
      return { ...post, classificatie: "NIET_VERVALLEN" as const, dagenVervallen: null, periodeWeergave };
    });
}

/**
 * De exacte tekst voor de debiteurenbeheer-melding, ÉÉN keer geformuleerd
 * (nooit dupliceren in een toekomstige renderer). `null` betekent: geen
 * melding nodig (bankaflettering wordt volledig door ons bijgehouden).
 */
function debiteurenbeheerMelding(status: DebiteurenbeheerStatus): { ernst: OpControleErnst; bericht: string } | null {
  if (status === true) return null;
  if (status === false) {
    return {
      ernst: "INFORMATIEF",
      bericht: "Bank-/debiteurenaflettering wordt voor deze administratie niet door ons bijgehouden. Het getoonde saldo is de Informant-registratie en hoeft niet gelijk te zijn aan de werkelijke betaalachterstand.",
    };
  }
  return {
    ernst: "WAARSCHUWING",
    bericht: "De betrouwbaarheid van de debiteurenstand voor deze administratie is nog niet geclassificeerd (bankaflettering-status onbekend) — het getoonde saldo kan een werkelijke achterstand zijn óf een niet-bijgewerkte Informant-registratie.",
  };
}

export function berekenOpenstaandePosten(
  vorderingen: readonly OpVorderingRegel[],
  saldoHuurders: readonly OpSaldoHuurderRegel[],
  debiteurenbeheer: DebiteurenbeheerStatus,
): OpResultaat {
  const controleVereist: OpControleItem[] = [];

  const openPerHuurder = new Map<string, OpVorderingRegel[]>();
  for (const rij of vorderingen) {
    if (rij.openstaand.isZero()) continue;
    const groep = openPerHuurder.get(rij.huurdernummer) ?? [];
    groep.push(rij);
    openPerHuurder.set(rij.huurdernummer, groep);
  }

  const saldoPerHuurder = new Map(saldoHuurders.map((r) => [r.huurdernummer, r]));
  const alleHuurdernummers = new Set([...openPerHuurder.keys(), ...saldoPerHuurder.keys()]);

  const melding = debiteurenbeheerMelding(debiteurenbeheer);
  if (melding !== null) {
    controleVereist.push({ huurdernummer: null, ernst: melding.ernst, bericht: melding.bericht });
  }

  const huurders: OpHuurderRegel[] = [...alleHuurdernummers].sort().map((huurdernummer) => {
    const posten = openPerHuurder.get(huurdernummer) ?? [];
    const detailtotaal = som(posten.map((p) => p.openstaand));
    const saldoRij = saldoPerHuurder.get(huurdernummer) ?? null;
    const saldoHuurdersWaarde = saldoRij?.saldo ?? null;
    const verschilMetSaldo = saldoHuurdersWaarde === null ? null : detailtotaal.minus(saldoHuurdersWaarde);

    if (debiteurenbeheer === true && verschilMetSaldo !== null && !verschilMetSaldo.isZero()) {
      controleVereist.push({
        huurdernummer,
        ernst: "WAARSCHUWING",
        bericht: `Huurder ${huurdernummer}: detailtotaal openstaand (${detailtotaal.toString()}) wijkt af van saldo_huurders (${saldoHuurdersWaarde!.toString()}) — verschil ${verschilMetSaldo.toString()}.`,
      });
    }
    if (debiteurenbeheer === true && posten.length > 0 && saldoRij === null) {
      controleVereist.push({
        huurdernummer,
        ernst: "WAARSCHUWING",
        bericht: `Huurder ${huurdernummer}: ${posten.length} openstaande post(en) in de detailbron, maar geen saldo_huurders-rij gevonden.`,
      });
    }

    return {
      huurdernummer,
      openstaandePosten: posten,
      detailtotaal,
      saldoHuurders: saldoHuurdersWaarde,
      verschilMetSaldo,
      buckets:
        saldoRij === null
          ? null
          : {
              tm30: saldoRij.achterstandTm30Dagen,
              tm60: saldoRij.achterstandTm60Dagen,
              tm90: saldoRij.achterstandTm90Dagen,
              negentigPlus: saldoRij.achterstand90PlusDagen,
              vooruitbetaling: saldoRij.vooruitbetaling,
            },
    };
  });

  return {
    debiteurenbeheer,
    huurders,
    totaalOpenstaandDetail: som(huurders.map((h) => h.detailtotaal)),
    totaalSaldoHuurders: som(saldoHuurders.map((r) => r.saldo)),
    controleVereist,
  };
}
