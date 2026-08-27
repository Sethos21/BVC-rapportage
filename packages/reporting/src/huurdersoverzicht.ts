import Decimal from "decimal.js";
import type { OnbekendOf } from "@bvc/domain";
import { bepaalContractGeldigheid, type HuurContractRegel } from "./huurKerncijfers.js";

/**
 * Huurdersoverzicht v1 (2026-08-27) — eerste contract-geankerde module
 * (één regel per contract, GEEN rij per rentroll-regel, GEEN kunstmatige
 * unittoewijzing), gebouwd op het bottom-up onderzoek + `contract-huurder-
 * diagnose`-run tegen de echte 070_Rooise_Zoom-data (zie
 * packages/reporting/README.md). Ontwerp expliciet goedgekeurd vóór bouw.
 *
 * Hergebruikt bewust `bepaalContractGeldigheid` uit `huurKerncijfers.ts`
 * (ongewijzigd, rechtstreeks geïmporteerd) voor de vraag "telt deze
 * rentroll-regel mee in de jaarhuur van dit contract op deze peildatum" —
 * dezelfde functie die het al-bevestigde 070-portefeuillecijfer
 * (€687.900,88 bruto jaarhuur, 6.589,5 m² verhuurde VVO) oplevert. Dat is
 * de garantie tegen een tweede huur-/m²-definitie (zie de reconciliatie-
 * regressietest). De bronPeildatum-bepaling en de bruto/netto/€-per-m²-
 * berekening zelf zijn — net als tussen `vastgoedKerncijfers.ts` en
 * `huurKerncijfers.ts` — bewust opnieuw lokaal gedefinieerd i.p.v. gedeeld
 * (dezelfde, kleine, triviale berekening, apart bewezen).
 *
 * `bepaalContractGeldigheid` (afloopdatum-gebaseerd) is NIET geschikt voor
 * contracteinde/restlooptijd/status: bij 070 is `afloopdatum` 0/12 gevuld
 * terwijl `expiratie_expiratiedatum` 12/12 gevuld is. Daarvoor bestaat hier
 * een aparte, nieuwe functie `bepaalContracteindeStatus` — geen wijziging
 * aan `bepaalContractGeldigheid` of `huurKerncijfers.ts`.
 *
 * `Complexomschrijving` (→ `objectomschrijving`) is UITSLUITEND een
 * gebruiksvriendelijke aanduiding naast `complexnummer` — de echte
 * 070-data bewijst geen 1-op-1 relatie (complexnummer "003" komt voor met
 * drie verschillende omschrijvingen, "Cuijk 33A" komt voor onder zowel
 * complexnummer "002" als "003"). Nooit gebruikt voor joins, aggregaties
 * of reconciliaties — puur presentatie, ongevalideerd doorgegeven.
 *
 * `rentroll.Service_voorschot_jaar` is het CONTRACTUELE jaarlijkse
 * servicekostenvoorschot — bewust NIET hetzelfde als
 * `servicekostenPositie.ts`'s `voorschottenPerContractHuurder` (geboekt,
 * periodegebonden). Dat laatste hoort hier niet thuis; een toekomstige
 * reconciliatie tussen beide is expliciet NIET in v1 gebouwd.
 *
 * Openstaand saldo/debiteuren (ouderdomsanalyse) en kosten-per-huurder
 * zijn BEWUST GEEN velden in v1 — niet als `null`-placeholder, gewoon
 * afwezig in het type (zie README voor de vervolgacties).
 */

export type ContracteindeStatus = "VERLOOPT_BINNENKORT" | "AANDACHT" | "GEEN_URGENTIE" | "EXPIRATIEDATUM_GEPASSEERD" | "ONBEKEND";

export type HuurdersoverzichtControleErnst = "KRITIEK" | "WAARSCHUWING" | "INFORMATIEF";

export interface HuurdersoverzichtControleItem {
  /** `null` = niet aan één specifiek contract toe te wijzen. */
  contractnummer: string | null;
  ernst: HuurdersoverzichtControleErnst;
  bericht: string;
}

export interface HoContractRegel {
  bedrijfsnr: string;
  contractnummer: string;
  huurdernummer: string | null;
  huurderNaam: string | null;
  complexnummer: string | null;
  /** contracten.Complexomschrijving — zie moduledoc: geen authoritative complexnaam. */
  complexomschrijving: string | null;
  unitnummer: string | null;
  ingangsdatum: Date | null;
  afloopdatum: Date | null;
  checkLopendContract: string | null;
  expiratieExpiratiedatum: Date | null;
  expiratieOpzegdatum: Date | null;
  waarborgsom: Decimal | null;
  verhogingDatum: Date | null;
  verhogingJaarVlgd: string | null;
  verhogingPeriodeVlgd: string | null;
  verhogingPercentage: Decimal | null;
  verhogingMethode: string | null;
  omschrijvingIndextabel: string | null;
}

export interface HoRentrollRegel {
  contractnummer: string;
  vorderingsoort: string;
  complexnummer: string | null;
  unitnummer: string | null;
  prolongatieBedragJaar: Decimal | null;
  gehuurdOppervlak: Decimal | null;
  serviceVoorschotJaar: Decimal | null;
  rapportageDatum: Date | null;
  contractExpiratiedatum: Date | null;
  contractOpzegdatum: Date | null;
}

export interface HuurdersoverzichtHuur {
  brutoJaarhuur: OnbekendOf<Decimal>;
  huurkorting: OnbekendOf<Decimal>;
  nettoJaarhuur: OnbekendOf<Decimal>;
  gehuurdOppervlak: OnbekendOf<Decimal>;
  brutoHuurPerM2: OnbekendOf<Decimal>;
  nettoHuurPerM2: OnbekendOf<Decimal>;
}

export interface HuurdersoverzichtContracteinde {
  expiratieExpiratiedatum: Date | null;
  expiratieExpiratiedatumRentroll: Date | null;
  expiratieOpzegdatum: Date | null;
  expiratieOpzegdatumRentroll: Date | null;
}

export interface HuurdersoverzichtIndexering {
  volgendeIndexeringsdatum: Date | null;
  jaarVolgend: string | null;
  periodeVolgend: string | null;
  methode: string | null;
  vastPercentage: Decimal | null;
  omschrijvingIndextabel: string | null;
}

export interface HuurdersoverzichtContractRegel {
  bedrijfsnr: string;
  contractnummer: string;
  huurdernummer: string | null;
  huurderNaam: string | null;
  complexnummer: string | null;
  /** Uitsluitend een aanduiding naast complexnummer — zie moduledoc. */
  objectomschrijving: string | null;
  /** Alleen gevuld als contracten.unitnummer dit contract daadwerkelijk koppelt — nooit afgeleid. */
  unitnummer: string | null;
  ingangsdatum: Date | null;
  contracteinde: HuurdersoverzichtContracteinde;
  restlooptijdDagen: OnbekendOf<number>;
  status: ContracteindeStatus;
  huur: HuurdersoverzichtHuur;
  /** rentroll.Service_voorschot_jaar — contractueel, GEEN geboekt bedrag. */
  servicekostenvoorschotJaar: Decimal | null;
  /** contracten.Waarborgsom — 0 is geldig, `null` = niet geregistreerd. */
  waarborgsom: Decimal | null;
  indexering: HuurdersoverzichtIndexering;
}

export interface HuurdersoverzichtPortefeuilleTotalen {
  brutoJaarhuur: OnbekendOf<Decimal>;
  huurkorting: OnbekendOf<Decimal>;
  nettoJaarhuur: OnbekendOf<Decimal>;
  gehuurdOppervlak: OnbekendOf<Decimal>;
}

export interface HuurdersoverzichtResultaat {
  /** Altijd `true`: een actuele bronstand, geen boekjaar/periode-gebonden cijfer. */
  momentopname: true;
  bronPeildatum: Date | null;
  contracten: HuurdersoverzichtContractRegel[];
  portefeuilleTotalen: HuurdersoverzichtPortefeuilleTotalen;
  controleVereist: HuurdersoverzichtControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function isBekend<T>(waarde: OnbekendOf<T>): waarde is { type: "bekend"; waarde: T } {
  return waarde.type === "bekend";
}

/** Zelfde bepaling als `vastgoedKerncijfers.ts`/`huurKerncijfers.ts` — bewust opnieuw lokaal gedefinieerd (zie moduledoc). */
function bepaalBronPeildatum(rentroll: readonly HoRentrollRegel[]): Date | null {
  const datums = new Set(rentroll.map((r) => r.rapportageDatum?.toISOString()).filter((d): d is string => d !== undefined));
  if (datums.size !== 1) return null;
  return rentroll.find((r) => r.rapportageDatum !== null)?.rapportageDatum ?? null;
}

/**
 * Contracteinde/restlooptijd/status op basis van peildatum + `expiratie_
 * expiratiedatum` — BEWUST GEEN `bepaalContractGeldigheid` (die is
 * afloopdatum-gebaseerd en bij 070 vrijwel altijd "geldig", zie moduledoc).
 * Een gepasseerde expiratiedatum betekent NIET automatisch dat het contract
 * beëindigd is (dezelfde reden waarom `huurKerncijfers.ts` expiratie niet
 * als harde geldigheidsgrens gebruikt) — vandaar een eigen status
 * (`EXPIRATIEDATUM_GEPASSEERD`) i.p.v. dat stilzwijgend te negeren of als
 * "verloopt binnenkort" te labelen.
 */
export function bepaalContracteindeStatus(expiratieExpiratiedatum: Date | null, peildatum: Date): { status: ContracteindeStatus; restlooptijdDagen: OnbekendOf<number> } {
  if (expiratieExpiratiedatum === null) {
    return { status: "ONBEKEND", restlooptijdDagen: { type: "onbekend", reden: "Geen expiratie_expiratiedatum bekend." } };
  }
  const dagen = Math.round((expiratieExpiratiedatum.getTime() - peildatum.getTime()) / (1000 * 60 * 60 * 24));
  const restlooptijdDagen: OnbekendOf<number> = { type: "bekend", waarde: dagen };
  if (dagen < 0) return { status: "EXPIRATIEDATUM_GEPASSEERD", restlooptijdDagen };
  if (dagen < 365) return { status: "VERLOOPT_BINNENKORT", restlooptijdDagen };
  if (dagen < 730) return { status: "AANDACHT", restlooptijdDagen };
  return { status: "GEEN_URGENTIE", restlooptijdDagen };
}

interface Bucket {
  brutoRegels: Decimal[];
  kortingRegels: Decimal[];
  vvoRegels: Decimal[];
}

function berekenHuur(bucket: Bucket): HuurdersoverzichtHuur {
  const brutoJaarhuur = som(bucket.brutoRegels);
  const huurkorting = som(bucket.kortingRegels).abs();
  const nettoJaarhuur = brutoJaarhuur.minus(huurkorting);
  const gehuurdOppervlak = som(bucket.vvoRegels);

  const vvoIsNul = gehuurdOppervlak.isZero();
  const onbekendPerM2 = (label: string): OnbekendOf<Decimal> => ({ type: "onbekend", reden: `Gehuurd oppervlak is nul — ${label} niet te bepalen (deling door nul).` });

  return {
    brutoJaarhuur: { type: "bekend", waarde: brutoJaarhuur },
    huurkorting: { type: "bekend", waarde: huurkorting },
    nettoJaarhuur: { type: "bekend", waarde: nettoJaarhuur },
    gehuurdOppervlak: { type: "bekend", waarde: gehuurdOppervlak },
    brutoHuurPerM2: vvoIsNul ? onbekendPerM2("bruto huur per m²") : { type: "bekend", waarde: brutoJaarhuur.dividedBy(gehuurdOppervlak) },
    nettoHuurPerM2: vvoIsNul ? onbekendPerM2("netto huur per m²") : { type: "bekend", waarde: nettoJaarhuur.dividedBy(gehuurdOppervlak) },
  };
}

function naarHuurContractRegel(c: HoContractRegel): HuurContractRegel {
  return { contractnummer: c.contractnummer, ingangsdatum: c.ingangsdatum, afloopdatum: c.afloopdatum, checkLopendContract: c.checkLopendContract };
}

export function berekenHuurdersoverzicht(contracten: readonly HoContractRegel[], rentroll: readonly HoRentrollRegel[]): HuurdersoverzichtResultaat {
  const controleVereist: HuurdersoverzichtControleItem[] = [];
  const bronPeildatum = bepaalBronPeildatum(rentroll);

  const rentrollPerContract = new Map<string, HoRentrollRegel[]>();
  for (const regel of rentroll) {
    const groep = rentrollPerContract.get(regel.contractnummer) ?? [];
    groep.push(regel);
    rentrollPerContract.set(regel.contractnummer, groep);
  }

  const portefeuilleBucket: Bucket = { brutoRegels: [], kortingRegels: [], vvoRegels: [] };

  const contractRegels: HuurdersoverzichtContractRegel[] = contracten.map((contract) => {
    const bucket: Bucket = { brutoRegels: [], kortingRegels: [], vvoRegels: [] };
    const regels = rentrollPerContract.get(contract.contractnummer) ?? [];

    if (regels.length === 0) {
      controleVereist.push({ contractnummer: contract.contractnummer, ernst: "WAARSCHUWING", bericht: `Contract ${contract.contractnummer}: geen rentroll-regel(s) gevonden — huurvelden onbekend.` });
    }

    let expiratieExpiratiedatumRentroll: Date | null = null;
    let expiratieOpzegdatumRentroll: Date | null = null;
    let aantalGeldige01Regels = 0;

    for (const regel of regels) {
      if (regel.complexnummer !== null && contract.complexnummer !== null && regel.complexnummer !== contract.complexnummer) {
        controleVereist.push({
          contractnummer: contract.contractnummer,
          ernst: "WAARSCHUWING",
          bericht: `Contract ${contract.contractnummer}: rentroll-regel se complexnummer ("${regel.complexnummer}") wijkt af van contracten se complexnummer ("${contract.complexnummer}").`,
        });
      }
      if (regel.unitnummer !== null && contract.unitnummer !== null && regel.unitnummer !== contract.unitnummer) {
        controleVereist.push({
          contractnummer: contract.contractnummer,
          ernst: "WAARSCHUWING",
          bericht: `Contract ${contract.contractnummer}: rentroll-regel se unitnummer ("${regel.unitnummer}") wijkt af van contracten se unitnummer ("${contract.unitnummer}").`,
        });
      }
      // Reconciliatiecontrole expiratie/opzegdatum — puur signalerend, contracten blijft leidend voor weergave (zie HuurdersoverzichtContracteinde).
      if (regel.contractExpiratiedatum !== null) expiratieExpiratiedatumRentroll = regel.contractExpiratiedatum;
      if (regel.contractOpzegdatum !== null) expiratieOpzegdatumRentroll = regel.contractOpzegdatum;

      if (regel.vorderingsoort !== "01" && regel.vorderingsoort !== "13") {
        if (regel.vorderingsoort === "12") {
          controleVereist.push({ contractnummer: contract.contractnummer, ernst: "INFORMATIEF", bericht: `Contract ${contract.contractnummer}: Vorderingsoort "12" (Compensatie OB) — geen onderdeel van huur, niet meegeteld.` });
        } else {
          controleVereist.push({
            contractnummer: contract.contractnummer,
            ernst: "WAARSCHUWING",
            bericht: `Contract ${contract.contractnummer}: onverwachte Vorderingsoort "${regel.vorderingsoort}" — niet meegeteld.`,
          });
        }
        continue;
      }

      if (bronPeildatum === null) continue; // portefeuillebrede melding hieronder, niet per regel herhalen.

      const geldigheid = bepaalContractGeldigheid(naarHuurContractRegel(contract), bronPeildatum);
      if (geldigheid.type === "onbekend") {
        controleVereist.push({ contractnummer: contract.contractnummer, ernst: "WAARSCHUWING", bericht: `${geldigheid.reden} (Vorderingsoort ${regel.vorderingsoort})` });
        continue;
      }
      if (!geldigheid.waarde) {
        controleVereist.push({
          contractnummer: contract.contractnummer,
          ernst: "INFORMATIEF",
          bericht: `Contract ${contract.contractnummer} (Vorderingsoort ${regel.vorderingsoort}) is niet geldig op peildatum ${bronPeildatum.toISOString().slice(0, 10)} — niet meegeteld.`,
        });
        continue;
      }

      if (contract.checkLopendContract !== null) {
        const zegtLopend = contract.checkLopendContract.trim().toLowerCase() === "ja";
        if (zegtLopend !== geldigheid.waarde) {
          controleVereist.push({
            contractnummer: contract.contractnummer,
            ernst: "WAARSCHUWING",
            bericht: `Contract ${contract.contractnummer}: check_lopend_contract ("${contract.checkLopendContract}") wijkt af van de berekende contractgeldigheid.`,
          });
        }
      }

      if (regel.vorderingsoort === "01") {
        if (regel.gehuurdOppervlak === null || regel.gehuurdOppervlak.isZero()) {
          controleVereist.push({ contractnummer: contract.contractnummer, ernst: "WAARSCHUWING", bericht: `Contract ${contract.contractnummer}: Vorderingsoort "01"-regel heeft 0 of ontbrekend gehuurd_oppervlak.` });
        } else if (regel.gehuurdOppervlak.isNegative()) {
          controleVereist.push({ contractnummer: contract.contractnummer, ernst: "KRITIEK", bericht: `Contract ${contract.contractnummer}: Vorderingsoort "01"-regel heeft een negatief gehuurd_oppervlak (${regel.gehuurdOppervlak.toString()} m²) — buiten de som gehouden.` });
        } else {
          bucket.vvoRegels.push(regel.gehuurdOppervlak);
          portefeuilleBucket.vvoRegels.push(regel.gehuurdOppervlak);
        }

        if (regel.prolongatieBedragJaar === null) {
          controleVereist.push({ contractnummer: contract.contractnummer, ernst: "WAARSCHUWING", bericht: `Contract ${contract.contractnummer}: Vorderingsoort "01"-regel heeft geen prolongatie_bedrag_jaar.` });
        } else {
          bucket.brutoRegels.push(regel.prolongatieBedragJaar);
          portefeuilleBucket.brutoRegels.push(regel.prolongatieBedragJaar);
          aantalGeldige01Regels += 1;
        }
      } else {
        // "13"
        if (regel.gehuurdOppervlak !== null && regel.gehuurdOppervlak.greaterThan(0)) {
          controleVereist.push({ contractnummer: contract.contractnummer, ernst: "WAARSCHUWING", bericht: `Contract ${contract.contractnummer}: Vorderingsoort "13"-regel heeft gehuurd_oppervlak > 0 (${regel.gehuurdOppervlak.toString()} m²).` });
        }
        if (regel.prolongatieBedragJaar === null) {
          controleVereist.push({ contractnummer: contract.contractnummer, ernst: "WAARSCHUWING", bericht: `Contract ${contract.contractnummer}: Vorderingsoort "13"-regel heeft geen prolongatie_bedrag_jaar.` });
        } else if (!regel.prolongatieBedragJaar.isNegative()) {
          controleVereist.push({ contractnummer: contract.contractnummer, ernst: "KRITIEK", bericht: `Contract ${contract.contractnummer}: Vorderingsoort "13"-regel heeft een niet-negatieve waarde (${regel.prolongatieBedragJaar.toString()}) — niet meegeteld.` });
        } else {
          bucket.kortingRegels.push(regel.prolongatieBedragJaar);
          portefeuilleBucket.kortingRegels.push(regel.prolongatieBedragJaar);
        }
      }
    }

    if (aantalGeldige01Regels > 1) {
      controleVereist.push({ contractnummer: contract.contractnummer, ernst: "INFORMATIEF", bericht: `Contract ${contract.contractnummer}: meerdere geldige Vorderingsoort "01"-regels (${aantalGeldige01Regels}) — opgeteld.` });
    }

    if (contract.expiratieExpiratiedatum !== null && expiratieExpiratiedatumRentroll !== null && contract.expiratieExpiratiedatum.getTime() !== expiratieExpiratiedatumRentroll.getTime()) {
      controleVereist.push({
        contractnummer: contract.contractnummer,
        ernst: "WAARSCHUWING",
        bericht: `Contract ${contract.contractnummer}: expiratie_expiratiedatum (contracten: ${contract.expiratieExpiratiedatum.toISOString().slice(0, 10)}) wijkt af van rentroll (${expiratieExpiratiedatumRentroll.toISOString().slice(0, 10)}) — contracten blijft leidend voor weergave.`,
      });
    } else if ((contract.expiratieExpiratiedatum === null) !== (expiratieExpiratiedatumRentroll === null)) {
      controleVereist.push({ contractnummer: contract.contractnummer, ernst: "INFORMATIEF", bericht: `Contract ${contract.contractnummer}: expiratie_expiratiedatum is maar in één van de twee bronnen (contracten/rentroll) gevuld.` });
    }
    if (contract.expiratieOpzegdatum !== null && expiratieOpzegdatumRentroll !== null && contract.expiratieOpzegdatum.getTime() !== expiratieOpzegdatumRentroll.getTime()) {
      controleVereist.push({
        contractnummer: contract.contractnummer,
        ernst: "WAARSCHUWING",
        bericht: `Contract ${contract.contractnummer}: expiratie_opzegdatum (contracten: ${contract.expiratieOpzegdatum.toISOString().slice(0, 10)}) wijkt af van rentroll (${expiratieOpzegdatumRentroll.toISOString().slice(0, 10)}) — contracten blijft leidend voor weergave.`,
      });
    } else if ((contract.expiratieOpzegdatum === null) !== (expiratieOpzegdatumRentroll === null)) {
      controleVereist.push({ contractnummer: contract.contractnummer, ernst: "INFORMATIEF", bericht: `Contract ${contract.contractnummer}: expiratie_opzegdatum is maar in één van de twee bronnen (contracten/rentroll) gevuld.` });
    }

    if (contract.unitnummer === null) {
      controleVereist.push({ contractnummer: contract.contractnummer, ernst: "INFORMATIEF", bericht: `Contract ${contract.contractnummer}: geen unitnummer geregistreerd — niet afgeleid.` });
    }
    if (contract.waarborgsom === null) {
      controleVereist.push({ contractnummer: contract.contractnummer, ernst: "INFORMATIEF", bericht: `Contract ${contract.contractnummer}: waarborgsom niet geregistreerd.` });
    }
    if (contract.huurderNaam === null) {
      controleVereist.push({ contractnummer: contract.contractnummer, ernst: "INFORMATIEF", bericht: `Contract ${contract.contractnummer}: geen huurdernaam geregistreerd.` });
    }
    if (contract.verhogingDatum === null) {
      controleVereist.push({ contractnummer: contract.contractnummer, ernst: "INFORMATIEF", bericht: `Contract ${contract.contractnummer}: geen volgende indexeringsdatum geregistreerd.` });
    }

    const { status, restlooptijdDagen } = bronPeildatum !== null
      ? bepaalContracteindeStatus(contract.expiratieExpiratiedatum, bronPeildatum)
      : { status: "ONBEKEND" as ContracteindeStatus, restlooptijdDagen: { type: "onbekend", reden: "Geen bronPeildatum bekend." } as OnbekendOf<number> };
    if (status === "EXPIRATIEDATUM_GEPASSEERD") {
      controleVereist.push({
        contractnummer: contract.contractnummer,
        ernst: "WAARSCHUWING",
        bericht: `Contract ${contract.contractnummer}: expiratie_expiratiedatum ligt in het verleden — dit betekent NIET automatisch dat het contract is beëindigd (kan een optie-/verlengingspunt zijn), controle vereist.`,
      });
    }

    return {
      bedrijfsnr: contract.bedrijfsnr,
      contractnummer: contract.contractnummer,
      huurdernummer: contract.huurdernummer,
      huurderNaam: contract.huurderNaam,
      complexnummer: contract.complexnummer,
      objectomschrijving: contract.complexomschrijving,
      unitnummer: contract.unitnummer,
      ingangsdatum: contract.ingangsdatum,
      contracteinde: {
        expiratieExpiratiedatum: contract.expiratieExpiratiedatum,
        expiratieExpiratiedatumRentroll,
        expiratieOpzegdatum: contract.expiratieOpzegdatum,
        expiratieOpzegdatumRentroll,
      },
      restlooptijdDagen,
      status,
      huur: berekenHuur(bucket),
      servicekostenvoorschotJaar: regels.find((r) => r.serviceVoorschotJaar !== null)?.serviceVoorschotJaar ?? null,
      waarborgsom: contract.waarborgsom,
      indexering: {
        volgendeIndexeringsdatum: contract.verhogingDatum,
        jaarVolgend: contract.verhogingJaarVlgd,
        periodeVolgend: contract.verhogingPeriodeVlgd,
        methode: contract.verhogingMethode,
        vastPercentage: contract.verhogingPercentage,
        omschrijvingIndextabel: contract.omschrijvingIndextabel,
      },
    };
  });

  if (bronPeildatum === null && rentroll.length > 0) {
    controleVereist.push({ contractnummer: null, ernst: "WAARSCHUWING", bericht: "Geen eenduidige bronPeildatum (rentroll.rapportage_datum) beschikbaar — contractgeldigheid kan niet worden bepaald, geen enkele huurregel is meegeteld." });
  }

  const alleBekend = <T>(waarden: OnbekendOf<T>[]): boolean => waarden.every(isBekend);
  const brutoWaarden = contractRegels.map((c) => c.huur.brutoJaarhuur);
  const kortingWaarden = contractRegels.map((c) => c.huur.huurkorting);
  const nettoWaarden = contractRegels.map((c) => c.huur.nettoJaarhuur);
  const vvoWaarden = contractRegels.map((c) => c.huur.gehuurdOppervlak);

  const portefeuilleTotalen: HuurdersoverzichtPortefeuilleTotalen = alleBekend(brutoWaarden) && alleBekend(kortingWaarden) && alleBekend(nettoWaarden) && alleBekend(vvoWaarden)
    ? {
        brutoJaarhuur: { type: "bekend", waarde: som(brutoWaarden.map((w) => (isBekend(w) ? w.waarde : new Decimal(0)))) },
        huurkorting: { type: "bekend", waarde: som(kortingWaarden.map((w) => (isBekend(w) ? w.waarde : new Decimal(0)))) },
        nettoJaarhuur: { type: "bekend", waarde: som(nettoWaarden.map((w) => (isBekend(w) ? w.waarde : new Decimal(0)))) },
        gehuurdOppervlak: { type: "bekend", waarde: som(vvoWaarden.map((w) => (isBekend(w) ? w.waarde : new Decimal(0)))) },
      }
    : {
        brutoJaarhuur: { type: "onbekend", reden: "Eén of meer contracten hebben een onbekende bruto jaarhuur." },
        huurkorting: { type: "onbekend", reden: "Eén of meer contracten hebben een onbekende huurkorting." },
        nettoJaarhuur: { type: "onbekend", reden: "Eén of meer contracten hebben een onbekende netto jaarhuur." },
        gehuurdOppervlak: { type: "onbekend", reden: "Eén of meer contracten hebben een onbekend gehuurd oppervlak." },
      };

  return { momentopname: true, bronPeildatum, contracten: contractRegels, portefeuilleTotalen, controleVereist };
}
