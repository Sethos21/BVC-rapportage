import Decimal from "decimal.js";
import { telOpMetAfronding, type OnbekendOf } from "@bvc/domain";
import type { ServicekostenParameters } from "@bvc/config";

/**
 * Servicekosten — definitieve module (2026-08-27), gebouwd op het bewezen
 * onderzoek voor 070_Rooise_Zoom (`servicekostenAfrekeningDiagnose.ts`,
 * `servicekostenGrootboekReconciliatieDiagnose.ts` — zie die bestanden en
 * README voor de volledige onderbouwing van elke aanname hieronder).
 *
 * Drie conceptueel gescheiden onderdelen, altijd samen berekend:
 * - A. Actuele positie: werkelijke kosten + voorschotten in de gekozen
 *   periode, `actueelSaldo = kostenSaldo + voorschottenSaldo` (NOOIT
 *   aftrekken — voorschotten zijn credit-normaal, dus al negatief).
 * - B. Afrekening voorgaand jaar (kostensoort(en) in `uitgeslotenKostensoorten`,
 *   bewezen "9600" bij 070): staat NOOIT in A, blijft wel volledig
 *   traceerbaar (portefeuille/complex/contract-huurder/afrekenjaar).
 * - C. Financiële reconciliatie tegen het grootboek: de doelrekeningen
 *   ("1711"/"1712" bij 070) zijn een PARAMETER, geen aanname in deze
 *   module — elke aanroep bewijst de aansluiting opnieuw, voor exact de
 *   opgegeven periode. Geen bedrag-matching, uitsluitend de natuurlijke
 *   sleutel (boekjaar+dagboek+boekstuk+volgnummer).
 *
 * Classificatie (`bepaalServicekostenStroom`) gebruikt TWEE onafhankelijke
 * signalen die elkaar moeten bevestigen: de bestaande, config-gestuurde
 * `uitgeslotenKostensoorten`-lijst (bepaalt AFREKENING_VOORGAAND_JAAR) en
 * het bron-native `Kostensoort_Soort`-veld (bepaalt WERKELIJKE_KOSTEN/
 * VOORSCHOT voor de rest). Bij tegenspraak — een uitgesloten kostensoort
 * met een andere Kostensoort_Soort dan "Nvt", of een "Nvt"-regel die niet
 * in de uitsluitingslijst staat — wordt de regel ONBEKEND en NOOIT
 * meegeteld in A of B; het saldo verschijnt uitsluitend in
 * `controleVereist`. Dit is de expliciete vangrail tegen stilzwijgend
 * generaliseren van het 070-patroon naar een administratie met een
 * afwijkende structuur.
 *
 * Bewust GEEN kostenallocatie per huurder: slechts een klein deel van de
 * kostenregels heeft een contract-/huurderkoppeling (bewezen ~5% bij 070),
 * dus een "kosten per huurder"-tabel zou schijnprecisie zijn zonder een
 * bewezen verdeelsleutel (die hier niet wordt geïntroduceerd). Voorschotten
 * en afrekening-voorgaand-jaar zijn wél per contract/huurder gerapporteerd
 * waar de bron dat rechtstreeks (niet afgeleid) ondersteunt.
 */

export interface Servicekostenregel {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  dagboeknummer: string;
  boekstuknummer: string;
  volgnummer: string;
  complexnummer: string | null;
  unitnummer: string | null;
  contractnummer: string | null;
  huurdernummer: string | null;
  kostensoort: string;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
  /** debet - credit — nooit een andere bronwaarde, CAL-FIN-001. */
  saldo: Decimal;
  /** Bron-native "Kosten"/"Voorschotten"/"Nvt" (of iets anders) — ongewijzigd, geen classificatie hier. */
  kostensoortSoort: string | null;
  /** Uitsluitend een getoond attribuut van een afrekeningsregel — nooit een selectiecriterium. */
  jaarSvAfrekening: string | null;
}

export interface ServicekostenBoekingRegel {
  boekjaar: number;
  boekperiode: string;
  dagboeknr: string;
  boekstuknr: string;
  volgnr: string;
  grootboeknr: string;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
  saldo: Decimal;
}

// ── Classificatie ──────────────────────────────────────────────────────

export type ServicekostenStroom = "WERKELIJKE_KOSTEN" | "VOORSCHOT" | "AFREKENING_VOORGAAND_JAAR" | "ONBEKEND";

export interface ServicekostenStroomClassificatie {
  stroom: ServicekostenStroom;
  /** Niet-null wanneer de twee classificatiesignalen elkaar tegenspreken — altijd een controleVereist-signaal waard. */
  controleBericht: string | null;
}

/**
 * Twee onafhankelijke signalen, geen enkelvoudig vertrouwen: de bestaande
 * `uitgeslotenKostensoorten`-config bepaalt AFREKENING_VOORGAAND_JAAR
 * (verwacht: Kostensoort_Soort "Nvt"); voor de overige regels bepaalt
 * Kostensoort_Soort zelf Kosten/Voorschotten. Spreken de twee signalen
 * elkaar tegen, dan is de classificatie ONBEKEND — nooit een gok.
 */
export function bepaalServicekostenStroom(
  regel: Pick<Servicekostenregel, "kostensoort" | "kostensoortSoort">,
  servicekostenParams: ServicekostenParameters,
): ServicekostenStroomClassificatie {
  const isUitgeslotenKostensoort = servicekostenParams.uitgeslotenKostensoorten.includes(regel.kostensoort.trim());

  if (isUitgeslotenKostensoort) {
    if (regel.kostensoortSoort !== "Nvt") {
      return {
        stroom: "AFREKENING_VOORGAAND_JAAR",
        controleBericht: `Kostensoort ${regel.kostensoort} staat in de uitsluitingslijst (afrekening voorgaand jaar) maar heeft Kostensoort_Soort "${regel.kostensoortSoort ?? "(leeg)"}" i.p.v. het verwachte "Nvt" — controle vereist.`,
      };
    }
    return { stroom: "AFREKENING_VOORGAAND_JAAR", controleBericht: null };
  }

  if (regel.kostensoortSoort === "Kosten") return { stroom: "WERKELIJKE_KOSTEN", controleBericht: null };
  if (regel.kostensoortSoort === "Voorschotten") return { stroom: "VOORSCHOT", controleBericht: null };
  if (regel.kostensoortSoort === "Nvt") {
    return {
      stroom: "ONBEKEND",
      controleBericht: `Kostensoort ${regel.kostensoort} heeft Kostensoort_Soort "Nvt" maar staat niet in de uitsluitingslijst voor afrekening voorgaand jaar — classificatie onbekend, controle vereist.`,
    };
  }
  return {
    stroom: "ONBEKEND",
    controleBericht: `Kostensoort ${regel.kostensoort} heeft een onbekende of ontbrekende Kostensoort_Soort ("${regel.kostensoortSoort ?? "(leeg)"}") — classificatie onbekend, controle vereist.`,
  };
}

// ── Gedeelde helpers ──────────────────────────────────────────────────

function complexHuurderSleutel(regel: Pick<Servicekostenregel, "complexnummer" | "unitnummer" | "contractnummer" | "huurdernummer">): string {
  return [regel.complexnummer, regel.unitnummer, regel.contractnummer, regel.huurdernummer].join("::");
}

function boekingSleutel(boekjaar: number, dagboeknr: string, boekstuknr: string, volgnr: string): string {
  return [boekjaar, dagboeknr, boekstuknr, volgnr].join("::");
}

function servicekostenSleutel(regel: Servicekostenregel): string {
  return boekingSleutel(regel.boekjaar, regel.dagboeknummer, regel.boekstuknummer, regel.volgnummer);
}

// ── A. Actuele positie ──────────────────────────────────────────────────

export type ServicekostenActuelePositieStatus = "KOSTEN_HOGER_DAN_VOORSCHOTTEN" | "VOORSCHOTTEN_HOGER_DAN_KOSTEN" | "IN_EVENWICHT";

export interface ServicekostenActueleComplexTotaal {
  complexnummer: string | null;
  kostenSaldo: Decimal;
  voorschottenSaldo: Decimal;
  actueelSaldo: Decimal;
}

export interface ServicekostenVoorschotContractHuurderTotaal {
  complexnummer: string | null;
  unitnummer: string | null;
  contractnummer: string | null;
  huurdernummer: string | null;
  saldo: Decimal;
}

export interface ServicekostenActuelePositie {
  boekperiodeVan: string;
  boekperiodeTotEnMet: string;
  kostenSaldo: Decimal;
  voorschottenSaldo: Decimal;
  /** kostenSaldo + voorschottenSaldo — nooit aftrekken. */
  actueelSaldo: Decimal;
  status: ServicekostenActuelePositieStatus;
  perComplex: ServicekostenActueleComplexTotaal[];
  /** Volledig, bewezen betrouwbaar (zie moduledoc) — GEEN equivalent voor Kosten. */
  voorschottenPerContractHuurder: ServicekostenVoorschotContractHuurderTotaal[];
  aantalKostenRegelsZonderComplexnummer: number;
  aantalVoorschottenRegelsZonderComplexnummer: number;
  /** Nooit als fout behandeld — bewezen dat de meeste kosten complexbreed zijn, geen huurderkoppeling verwacht. */
  aantalKostenRegelsZonderContractOfHuurder: number;
  aantalVoorschottenRegelsZonderContractOfHuurder: number;
  /**
   * Uitsluitend de SOM van de kostenregels die toevallig wél een contract-/
   * huurderkoppeling hebben — GEEN kostenallocatie, GEEN per-huurder
   * uitsplitsing. Nooit presenteren alsof dit de volledige kostenpositie
   * van die huurder(s) is.
   */
  kostenRechtstreeksGekoppeldTotaal: { aantalRegels: number; saldo: Decimal };
}

function bouwActuelePositie(
  kostenRegels: readonly Servicekostenregel[],
  voorschottenRegels: readonly Servicekostenregel[],
  boekperiodeVan: string,
  boekperiodeTotEnMet: string,
): ServicekostenActuelePositie {
  const kostenSaldo = telOpMetAfronding(kostenRegels.map((r) => r.saldo));
  const voorschottenSaldo = telOpMetAfronding(voorschottenRegels.map((r) => r.saldo));
  const actueelSaldo = kostenSaldo.plus(voorschottenSaldo);
  const status: ServicekostenActuelePositieStatus = actueelSaldo.isZero()
    ? "IN_EVENWICHT"
    : actueelSaldo.isPositive()
      ? "KOSTEN_HOGER_DAN_VOORSCHOTTEN"
      : "VOORSCHOTTEN_HOGER_DAN_KOSTEN";

  const perComplexMap = new Map<string | null, { kosten: Servicekostenregel[]; voorschotten: Servicekostenregel[] }>();
  for (const regel of kostenRegels) {
    const entry = perComplexMap.get(regel.complexnummer) ?? { kosten: [], voorschotten: [] };
    entry.kosten.push(regel);
    perComplexMap.set(regel.complexnummer, entry);
  }
  for (const regel of voorschottenRegels) {
    const entry = perComplexMap.get(regel.complexnummer) ?? { kosten: [], voorschotten: [] };
    entry.voorschotten.push(regel);
    perComplexMap.set(regel.complexnummer, entry);
  }
  const perComplex: ServicekostenActueleComplexTotaal[] = Array.from(perComplexMap.entries())
    .map(([complexnummer, { kosten, voorschotten }]) => {
      const k = telOpMetAfronding(kosten.map((r) => r.saldo));
      const v = telOpMetAfronding(voorschotten.map((r) => r.saldo));
      return { complexnummer, kostenSaldo: k, voorschottenSaldo: v, actueelSaldo: k.plus(v) };
    })
    .sort((a, b) => (a.complexnummer ?? "").localeCompare(b.complexnummer ?? ""));

  const voorschottenPerSleutel = new Map<string, Servicekostenregel[]>();
  for (const regel of voorschottenRegels.filter((r) => r.contractnummer !== null || r.huurdernummer !== null)) {
    const sleutel = complexHuurderSleutel(regel);
    const groep = voorschottenPerSleutel.get(sleutel) ?? [];
    groep.push(regel);
    voorschottenPerSleutel.set(sleutel, groep);
  }
  const voorschottenPerContractHuurder: ServicekostenVoorschotContractHuurderTotaal[] = Array.from(voorschottenPerSleutel.values())
    .map((groep) => {
      const eerste = groep[0]!;
      return { complexnummer: eerste.complexnummer, unitnummer: eerste.unitnummer, contractnummer: eerste.contractnummer, huurdernummer: eerste.huurdernummer, saldo: telOpMetAfronding(groep.map((r) => r.saldo)) };
    })
    .sort((a, b) => `${a.complexnummer ?? ""}::${a.unitnummer ?? ""}::${a.contractnummer ?? ""}`.localeCompare(`${b.complexnummer ?? ""}::${b.unitnummer ?? ""}::${b.contractnummer ?? ""}`));

  const kostenMetContractOfHuurder = kostenRegels.filter((r) => r.contractnummer !== null || r.huurdernummer !== null);

  return {
    boekperiodeVan,
    boekperiodeTotEnMet,
    kostenSaldo,
    voorschottenSaldo,
    actueelSaldo,
    status,
    perComplex,
    voorschottenPerContractHuurder,
    aantalKostenRegelsZonderComplexnummer: kostenRegels.filter((r) => r.complexnummer === null).length,
    aantalVoorschottenRegelsZonderComplexnummer: voorschottenRegels.filter((r) => r.complexnummer === null).length,
    aantalKostenRegelsZonderContractOfHuurder: kostenRegels.filter((r) => r.contractnummer === null && r.huurdernummer === null).length,
    aantalVoorschottenRegelsZonderContractOfHuurder: voorschottenRegels.filter((r) => r.contractnummer === null && r.huurdernummer === null).length,
    kostenRechtstreeksGekoppeldTotaal: { aantalRegels: kostenMetContractOfHuurder.length, saldo: telOpMetAfronding(kostenMetContractOfHuurder.map((r) => r.saldo)) },
  };
}

// ── B. Afrekening voorgaand jaar ────────────────────────────────────────

export interface ServicekostenAfrekeningComplexTotaal {
  complexnummer: string | null;
  aantalRegels: number;
  saldo: Decimal;
}

export interface ServicekostenAfrekeningContractHuurderTotaal {
  complexnummer: string | null;
  unitnummer: string | null;
  contractnummer: string | null;
  huurdernummer: string | null;
  afrekenjaar: OnbekendOf<string>;
  saldo: Decimal;
}

export interface ServicekostenAfrekeningVoorgaandJaar {
  boekperiodeVan: string;
  boekperiodeTotEnMet: string;
  totaalSaldo: Decimal;
  aantalRegels: number;
  perComplex: ServicekostenAfrekeningComplexTotaal[];
  /** Uitsluitend regels met een contract- of huurderkoppeling, gegroepeerd inclusief afrekenjaar (één huurder kan meerdere afrekenjaren in dezelfde periode hebben). */
  perContractHuurderAfrekenjaar: ServicekostenAfrekeningContractHuurderTotaal[];
  /** Regels zonder contract/huurder — apart, nooit verzwegen of impliciet aan een huurder toegerekend. */
  complexbredeRegels: ServicekostenAfrekeningComplexTotaal[];
  aantalRegelsZonderComplexnummer: number;
}

function bouwAfrekeningVoorgaandJaar(regels: readonly Servicekostenregel[], boekperiodeVan: string, boekperiodeTotEnMet: string): ServicekostenAfrekeningVoorgaandJaar {
  const perComplexMap = new Map<string | null, Servicekostenregel[]>();
  for (const regel of regels) {
    const groep = perComplexMap.get(regel.complexnummer) ?? [];
    groep.push(regel);
    perComplexMap.set(regel.complexnummer, groep);
  }
  const perComplex: ServicekostenAfrekeningComplexTotaal[] = Array.from(perComplexMap.entries())
    .map(([complexnummer, groep]) => ({ complexnummer, aantalRegels: groep.length, saldo: telOpMetAfronding(groep.map((r) => r.saldo)) }))
    .sort((a, b) => (a.complexnummer ?? "").localeCompare(b.complexnummer ?? ""));

  const metKoppeling = regels.filter((r) => r.contractnummer !== null || r.huurdernummer !== null);
  const zonderKoppeling = regels.filter((r) => r.contractnummer === null && r.huurdernummer === null);

  const perSleutelMap = new Map<string, Servicekostenregel[]>();
  for (const regel of metKoppeling) {
    const sleutel = `${complexHuurderSleutel(regel)}::${regel.jaarSvAfrekening ?? "(onbekend)"}`;
    const groep = perSleutelMap.get(sleutel) ?? [];
    groep.push(regel);
    perSleutelMap.set(sleutel, groep);
  }
  const perContractHuurderAfrekenjaar: ServicekostenAfrekeningContractHuurderTotaal[] = Array.from(perSleutelMap.values())
    .map((groep) => {
      const eerste = groep[0]!;
      const afrekenjaar: OnbekendOf<string> =
        eerste.jaarSvAfrekening === null ? { type: "onbekend", reden: "Service_BK_Jaar_SV_Afrekening ontbreekt op deze regel." } : { type: "bekend", waarde: eerste.jaarSvAfrekening };
      return {
        complexnummer: eerste.complexnummer,
        unitnummer: eerste.unitnummer,
        contractnummer: eerste.contractnummer,
        huurdernummer: eerste.huurdernummer,
        afrekenjaar,
        saldo: telOpMetAfronding(groep.map((r) => r.saldo)),
      };
    })
    .sort((a, b) => `${a.complexnummer ?? ""}::${a.unitnummer ?? ""}::${a.contractnummer ?? ""}`.localeCompare(`${b.complexnummer ?? ""}::${b.unitnummer ?? ""}::${b.contractnummer ?? ""}`));

  const complexbredeMap = new Map<string | null, Servicekostenregel[]>();
  for (const regel of zonderKoppeling) {
    const groep = complexbredeMap.get(regel.complexnummer) ?? [];
    groep.push(regel);
    complexbredeMap.set(regel.complexnummer, groep);
  }
  const complexbredeRegels: ServicekostenAfrekeningComplexTotaal[] = Array.from(complexbredeMap.entries())
    .map(([complexnummer, groep]) => ({ complexnummer, aantalRegels: groep.length, saldo: telOpMetAfronding(groep.map((r) => r.saldo)) }))
    .sort((a, b) => (a.complexnummer ?? "").localeCompare(b.complexnummer ?? ""));

  return {
    boekperiodeVan,
    boekperiodeTotEnMet,
    totaalSaldo: telOpMetAfronding(regels.map((r) => r.saldo)),
    aantalRegels: regels.length,
    perComplex,
    perContractHuurderAfrekenjaar,
    complexbredeRegels,
    aantalRegelsZonderComplexnummer: regels.filter((r) => r.complexnummer === null).length,
  };
}

// ── C. Financiële reconciliatie ─────────────────────────────────────────

export interface ServicekostenReconciliatieRekeningTotaal {
  grootboekrekening: string;
  grootboekSaldo: Decimal;
  grootboekAantalRegels: number;
  gekoppeldServicekostenSaldo: Decimal;
  gekoppeldServicekostenAantalRegels: number;
  /** grootboekSaldo - gekoppeldServicekostenSaldo — geen tolerantie, geen automatische verklaring. */
  verschil: Decimal;
}

export interface ServicekostenReconciliatiePeriodeTotaal {
  boekperiode: string;
  grootboekrekening: string;
  grootboekSaldo: Decimal;
  gekoppeldServicekostenSaldo: Decimal;
  verschil: Decimal;
}

export interface ServicekostenReconciliatie {
  /** Parameter — GEEN aanname in deze module dat dit universeel "1711"/"1712" is. */
  doelrekeningen: string[];
  aantalServicekostenTotaal: number;
  aantalServicekostenNietGekoppeld: number;
  perRekening: ServicekostenReconciliatieRekeningTotaal[];
  perRekeningPerPeriode: ServicekostenReconciliatiePeriodeTotaal[];
}

// ── Samengesteld resultaat ───────────────────────────────────────────────

export type ServicekostenControleSectie = "ActuelePositie" | "AfrekeningVoorgaandJaar" | "Reconciliatie";

export interface ServicekostenControleItem {
  sectie: ServicekostenControleSectie;
  ernst: "KRITIEK" | "WAARSCHUWING" | "INFORMATIEF";
  referentie: string | null;
  bericht: string;
}

export interface ServicekostenPositieInvoer {
  administratieNaam: string;
  bedrijfsnr: string;
  boekjaar: number;
  boekperiodeVan: string;
  boekperiodeTotEnMet: string;
  gegenereerdOp: Date;
  /** Al geselecteerd door de aanroeper (Worker, via `selecteerServicekosten`) — deze functie rekent, selecteert niet. */
  servicekosten: readonly Servicekostenregel[];
  /** Al geselecteerd door de aanroeper (Worker, via `selecteerBoekingen`), ALLE grootboekrekeningen — niet vooraf beperkt tot doelrekeningen, de reconciliatie moet onverwachte rekeningen juist kunnen signaleren. */
  boekingen: readonly ServicekostenBoekingRegel[];
  doelrekeningen: readonly string[];
  servicekostenParams: ServicekostenParameters;
}

export interface ServicekostenPositieResultaat {
  administratieNaam: string;
  bedrijfsnr: string;
  boekjaar: number;
  boekperiodeVan: string;
  boekperiodeTotEnMet: string;
  gegenereerdOp: Date;
  actuelePositie: ServicekostenActuelePositie;
  afrekeningVoorgaandJaar: ServicekostenAfrekeningVoorgaandJaar;
  reconciliatie: ServicekostenReconciliatie;
  controleVereist: ServicekostenControleItem[];
}

export function samenstelServicekostenPositie(invoer: ServicekostenPositieInvoer): ServicekostenPositieResultaat {
  const controleVereist: ServicekostenControleItem[] = [];

  // ── Classificatie ──────────────────────────────────────────────────
  const kostenRegels: Servicekostenregel[] = [];
  const voorschottenRegels: Servicekostenregel[] = [];
  const afrekeningRegels: Servicekostenregel[] = [];
  const onbekendeRegels: Servicekostenregel[] = [];

  for (const regel of invoer.servicekosten) {
    const { stroom, controleBericht } = bepaalServicekostenStroom(regel, invoer.servicekostenParams);
    if (controleBericht) {
      controleVereist.push({
        sectie: stroom === "AFREKENING_VOORGAAND_JAAR" ? "AfrekeningVoorgaandJaar" : "ActuelePositie",
        ernst: "WAARSCHUWING",
        referentie: regel.kostensoort,
        bericht: controleBericht,
      });
    }
    if (stroom === "WERKELIJKE_KOSTEN") kostenRegels.push(regel);
    else if (stroom === "VOORSCHOT") voorschottenRegels.push(regel);
    else if (stroom === "AFREKENING_VOORGAAND_JAAR") afrekeningRegels.push(regel);
    else onbekendeRegels.push(regel);
  }

  if (onbekendeRegels.length > 0) {
    controleVereist.push({
      sectie: "ActuelePositie",
      ernst: "WAARSCHUWING",
      referentie: null,
      bericht: `${onbekendeRegels.length} servicekostenregel(s) konden niet geclassificeerd worden (saldo ${telOpMetAfronding(onbekendeRegels.map((r) => r.saldo)).toString()}) — buiten de actuele positie en afrekening voorgaand jaar gehouden.`,
    });
  }

  // ── A ──────────────────────────────────────────────────────────────
  const actuelePositie = bouwActuelePositie(kostenRegels, voorschottenRegels, invoer.boekperiodeVan, invoer.boekperiodeTotEnMet);
  if (actuelePositie.aantalKostenRegelsZonderComplexnummer > 0) {
    controleVereist.push({ sectie: "ActuelePositie", ernst: "INFORMATIEF", referentie: null, bericht: `${actuelePositie.aantalKostenRegelsZonderComplexnummer} kosten-regel(s) hebben geen complexnummer.` });
  }
  if (actuelePositie.aantalVoorschottenRegelsZonderComplexnummer > 0) {
    controleVereist.push({ sectie: "ActuelePositie", ernst: "INFORMATIEF", referentie: null, bericht: `${actuelePositie.aantalVoorschottenRegelsZonderComplexnummer} voorschotten-regel(s) hebben geen complexnummer.` });
  }
  if (actuelePositie.aantalKostenRegelsZonderContractOfHuurder > 0) {
    controleVereist.push({
      sectie: "ActuelePositie",
      ernst: "INFORMATIEF",
      referentie: null,
      bericht: `${actuelePositie.aantalKostenRegelsZonderContractOfHuurder} kosten-regel(s) hebben geen contractnummer én geen huurdernummer — verwacht, kosten zijn overwegend complexbreed.`,
    });
  }
  if (actuelePositie.aantalVoorschottenRegelsZonderContractOfHuurder > 0) {
    controleVereist.push({
      sectie: "ActuelePositie",
      ernst: "WAARSCHUWING",
      referentie: null,
      bericht: `${actuelePositie.aantalVoorschottenRegelsZonderContractOfHuurder} voorschotten-regel(s) hebben geen contractnummer én geen huurdernummer — onverwacht, voorschotten zijn bewezen (070) vrijwel altijd gekoppeld.`,
    });
  }

  // ── B ──────────────────────────────────────────────────────────────
  const afrekeningVoorgaandJaar = bouwAfrekeningVoorgaandJaar(afrekeningRegels, invoer.boekperiodeVan, invoer.boekperiodeTotEnMet);
  if (afrekeningVoorgaandJaar.aantalRegels > 0) {
    controleVereist.push({
      sectie: "AfrekeningVoorgaandJaar",
      ernst: "INFORMATIEF",
      referentie: null,
      bericht: `${afrekeningVoorgaandJaar.aantalRegels} afrekening-voorgaand-jaar-regel(s) in deze periode (saldo ${afrekeningVoorgaandJaar.totaalSaldo.toString()}) — buiten de actuele positie gehouden.`,
    });
  }
  if (afrekeningVoorgaandJaar.aantalRegelsZonderComplexnummer > 0) {
    controleVereist.push({ sectie: "AfrekeningVoorgaandJaar", ernst: "INFORMATIEF", referentie: null, bericht: `${afrekeningVoorgaandJaar.aantalRegelsZonderComplexnummer} afrekening-regel(s) hebben geen complexnummer.` });
  }

  // ── C ──────────────────────────────────────────────────────────────
  const boekingenPerSleutel = new Map<string, ServicekostenBoekingRegel[]>();
  for (const boeking of invoer.boekingen) {
    const sleutel = boekingSleutel(boeking.boekjaar, boeking.dagboeknr, boeking.boekstuknr, boeking.volgnr);
    const groep = boekingenPerSleutel.get(sleutel) ?? [];
    groep.push(boeking);
    boekingenPerSleutel.set(sleutel, groep);
  }
  const boekingenPerRekening = new Map<string, ServicekostenBoekingRegel[]>();
  for (const boeking of invoer.boekingen) {
    const groep = boekingenPerRekening.get(boeking.grootboeknr) ?? [];
    groep.push(boeking);
    boekingenPerRekening.set(boeking.grootboeknr, groep);
  }
  function boekingMatches(regel: Servicekostenregel): ServicekostenBoekingRegel[] {
    return boekingenPerSleutel.get(servicekostenSleutel(regel)) ?? [];
  }
  function gekoppeldOpRekening(rekening: string): Servicekostenregel[] {
    return invoer.servicekosten.filter((r) => boekingMatches(r).some((b) => b.grootboeknr === rekening));
  }

  const nietGekoppeld = invoer.servicekosten.filter((r) => boekingMatches(r).length === 0);
  if (nietGekoppeld.length > 0) {
    const percentage = invoer.servicekosten.length > 0 ? Math.round((nietGekoppeld.length / invoer.servicekosten.length) * 100) : 0;
    controleVereist.push({
      sectie: "Reconciliatie",
      ernst: percentage > 25 ? "WAARSCHUWING" : "INFORMATIEF",
      referentie: null,
      bericht: `${nietGekoppeld.length} van ${invoer.servicekosten.length} servicekostenregels (${percentage}%) konden niet aan een boekingsregel gekoppeld worden via de natuurlijke sleutel.`,
    });
  }

  function controleerOnverwachteRekeningen(regels: readonly Servicekostenregel[], stroomLabel: string): void {
    const perRekeningMap = new Map<string, Servicekostenregel[]>();
    for (const regel of regels) {
      for (const boeking of boekingMatches(regel)) {
        const groep = perRekeningMap.get(boeking.grootboeknr) ?? [];
        groep.push(regel);
        perRekeningMap.set(boeking.grootboeknr, groep);
      }
    }
    for (const [rekening, groep] of perRekeningMap) {
      if (!invoer.doelrekeningen.includes(rekening)) {
        controleVereist.push({
          sectie: "Reconciliatie",
          ernst: "WAARSCHUWING",
          referentie: rekening,
          bericht: `${stroomLabel} koppelt ${groep.length} regel(s) (saldo ${telOpMetAfronding(groep.map((r) => r.saldo)).toString()}) aan grootboekrekening "${rekening}" — niet in de opgegeven doelrekeningen (${invoer.doelrekeningen.join(", ")}).`,
        });
      }
    }
  }
  controleerOnverwachteRekeningen(kostenRegels, "Werkelijke kosten");
  controleerOnverwachteRekeningen(voorschottenRegels, "Voorschotten");
  controleerOnverwachteRekeningen(afrekeningRegels, "Afrekening voorgaand jaar");

  const perRekening: ServicekostenReconciliatieRekeningTotaal[] = invoer.doelrekeningen.map((grootboekrekening) => {
    const grootboekRegels = boekingenPerRekening.get(grootboekrekening) ?? [];
    const gekoppeld = gekoppeldOpRekening(grootboekrekening);
    const grootboekSaldo = telOpMetAfronding(grootboekRegels.map((r) => r.saldo));
    const gekoppeldServicekostenSaldo = telOpMetAfronding(gekoppeld.map((r) => r.saldo));
    return {
      grootboekrekening,
      grootboekSaldo,
      grootboekAantalRegels: grootboekRegels.length,
      gekoppeldServicekostenSaldo,
      gekoppeldServicekostenAantalRegels: gekoppeld.length,
      verschil: grootboekSaldo.minus(gekoppeldServicekostenSaldo),
    };
  });
  for (const rek of perRekening) {
    if (!rek.verschil.isZero()) {
      controleVereist.push({
        sectie: "Reconciliatie",
        ernst: "WAARSCHUWING",
        referentie: rek.grootboekrekening,
        bericht: `Grootboekrekening ${rek.grootboekrekening}: grootboeksaldo (${rek.grootboekSaldo.toString()}) wijkt af van het gekoppelde servicekostensaldo (${rek.gekoppeldServicekostenSaldo.toString()}) — verschil ${rek.verschil.toString()}.`,
      });
    }
  }

  const perRekeningPerPeriode: ServicekostenReconciliatiePeriodeTotaal[] = [];
  for (const grootboekrekening of invoer.doelrekeningen) {
    const grootboekPerPeriode = new Map<string, ServicekostenBoekingRegel[]>();
    for (const boeking of boekingenPerRekening.get(grootboekrekening) ?? []) {
      const groep = grootboekPerPeriode.get(boeking.boekperiode) ?? [];
      groep.push(boeking);
      grootboekPerPeriode.set(boeking.boekperiode, groep);
    }
    const gekoppeldePerPeriode = new Map<string, Servicekostenregel[]>();
    for (const regel of gekoppeldOpRekening(grootboekrekening)) {
      const groep = gekoppeldePerPeriode.get(regel.boekperiode) ?? [];
      groep.push(regel);
      gekoppeldePerPeriode.set(regel.boekperiode, groep);
    }
    const alleBoekperiodes = new Set([...grootboekPerPeriode.keys(), ...gekoppeldePerPeriode.keys()]);
    for (const boekperiode of Array.from(alleBoekperiodes).sort()) {
      const grootboekSaldo = telOpMetAfronding((grootboekPerPeriode.get(boekperiode) ?? []).map((r) => r.saldo));
      const gekoppeldServicekostenSaldo = telOpMetAfronding((gekoppeldePerPeriode.get(boekperiode) ?? []).map((r) => r.saldo));
      perRekeningPerPeriode.push({ boekperiode, grootboekrekening, grootboekSaldo, gekoppeldServicekostenSaldo, verschil: grootboekSaldo.minus(gekoppeldServicekostenSaldo) });
    }
  }
  const aantalPeriodesMetVerschil = perRekeningPerPeriode.filter((p) => !p.verschil.isZero()).length;
  if (aantalPeriodesMetVerschil > 0) {
    controleVereist.push({
      sectie: "Reconciliatie",
      ernst: "WAARSCHUWING",
      referentie: null,
      bericht: `${aantalPeriodesMetVerschil} van ${perRekeningPerPeriode.length} periode/grootboekrekening-combinaties hebben een verschil tussen grootboeksaldo en gekoppeld servicekostensaldo.`,
    });
  }

  const reconciliatie: ServicekostenReconciliatie = {
    doelrekeningen: [...invoer.doelrekeningen],
    aantalServicekostenTotaal: invoer.servicekosten.length,
    aantalServicekostenNietGekoppeld: nietGekoppeld.length,
    perRekening,
    perRekeningPerPeriode,
  };

  return {
    administratieNaam: invoer.administratieNaam,
    bedrijfsnr: invoer.bedrijfsnr,
    boekjaar: invoer.boekjaar,
    boekperiodeVan: invoer.boekperiodeVan,
    boekperiodeTotEnMet: invoer.boekperiodeTotEnMet,
    gegenereerdOp: invoer.gegenereerdOp,
    actuelePositie,
    afrekeningVoorgaandJaar,
    reconciliatie,
    controleVereist,
  };
}
