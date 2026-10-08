import Decimal from "decimal.js";
import type { OnbekendOf } from "@bvc/domain";

/**
 * Huur-/rentroll-kerncijfers v1 (2026-08-26) — bruto/netto jaarhuur,
 * huurkortingen, verhuurde VVO en huur per m², per complex + portefeuille.
 * STRIKT ZELFSTANDIG: geen import van/afhankelijkheid op
 * `vastgoedKerncijfers.ts`, `kerncijfersManagement.ts`,
 * `plPeriodeBerekening.ts`/`balansPeriodeBerekening.ts`/
 * `kasstroomManagementoverzicht.ts` of `@bvc/domain/vastgoed.ts` — eigen,
 * lokale invoertypen en een eigen, hier zelf gedefinieerde
 * "verhuurde VVO"-berekening (bewust NIET de VVO uit `vastgoedKerncijfers.ts`
 * hergebruikt: dat is een andere definitie — alle rentroll-regels met
 * `gehuurd_oppervlak > 0` — terwijl deze module specifiek "som
 * `gehuurd_oppervlak` van geldige `01`-regels" gebruikt. Voor 070 komen
 * beide toevallig op hetzelfde getal uit (6.589,5 m², zie
 * `rentrollDiagnose`-onderzoek), maar dat is geen garantie voor andere
 * administraties — vandaar bewust twee onafhankelijke berekeningen,
 * geen gedeelde constante).
 *
 * Bronregels — voor 070_Rooise_Zoom bevestigd via `rentrollDiagnose.ts`
 * (2026-08-26), GEEN universele waarheid voor elke toekomstige bron/
 * administratie:
 * - `Vorderingsoort = "01"` = reguliere bruto jaarhuur.
 * - `Vorderingsoort = "13"` = huurkorting (negatief bedrag verwacht).
 * - `Vorderingsoort = "12"` (Compensatie OB) telt nergens in mee — puur
 *   informatief genegeerd.
 * - `korting_bedrag_jaar` (het aparte kolomveld) is bij 070 altijd 0/
 *   ongebruikt — NOOIT leidend, de huurkorting komt uitsluitend uit de
 *   `13`-regel(s) van `prolongatie_bedrag_jaar`.
 * - Verhuurde VVO (deze module) = som `gehuurd_oppervlak` van geldige
 *   `01`-regels.
 *
 * Contractgeldigheid (peildatum = `bronPeildatum`, zelfde bepaling als
 * `vastgoedKerncijfers.ts`: alleen gevuld als alle aangeleverde
 * `rapportage_datum`-waarden identiek zijn, anders `null`):
 * - `ingangsdatum` onbekend → geldigheid onbekend, nooit aangenomen.
 * - `ingangsdatum > peildatum` → nog niet ingegaan (ongeldig).
 * - `afloopdatum` bekend en `< peildatum` → al afgelopen (ongeldig).
 * - Grenzen INCLUSIEF: `ingangsdatum === peildatum` en
 *   `afloopdatum === peildatum` zijn beide geldig.
 * - `afloopdatum = null` → open einde, blijft geldig zolang ingegaan.
 * `expiratie_expiratiedatum`/`expiratie_opzegdatum` worden bewust NIET
 * gebruikt voor geldigheid (dat lijkt een optie-/verlengingsconcept, geen
 * harde einddatum — zie WALT-onderzoek, later). `check_lopend_contract`
 * is geen tweede geldigheidsbron maar wordt gecrosscheckt: wijkt het af
 * van de berekende geldigheid, dan is dat een WAARSCHUWING (de berekende
 * geldigheid blijft leidend, geen aanname welke bron "gelijk" heeft).
 *
 * Alleen regels die (a) een bekend `Vorderingsoort` (01/13) hebben, (b)
 * deterministisch aan precies 1 contract koppelen, EN (c) op een bekende
 * `bronPeildatum` bekend-geldig zijn, tellen mee — elke andere regel wordt
 * uitgesloten én gemeld via `controleVereist`, nooit stilzwijgend
 * overgeslagen of als 0 behandeld.
 */

export type HuurControleErnst = "KRITIEK" | "WAARSCHUWING" | "INFORMATIEF";

export interface HuurControleItem {
  /** `null` = niet aan één specifiek complex toe te wijzen. */
  complexnr: string | null;
  ernst: HuurControleErnst;
  bericht: string;
}

export interface HuurRentrollRegel {
  contractnummer: string;
  complexnr: string | null;
  vorderingsoort: string;
  prolongatieBedragJaar: Decimal | null;
  gehuurdOppervlak: Decimal | null;
  rapportageDatum: Date | null;
}

export interface HuurContractRegel {
  contractnummer: string;
  ingangsdatum: Date | null;
  afloopdatum: Date | null;
  checkLopendContract: string | null;
}

export interface HuurKpiWaarden {
  brutoJaarhuur: OnbekendOf<Decimal>;
  huurkortingen: OnbekendOf<Decimal>;
  nettoJaarhuur: OnbekendOf<Decimal>;
  verhuurdeVvo: OnbekendOf<Decimal>;
  brutoHuurPerM2: OnbekendOf<Decimal>;
  nettoHuurPerM2: OnbekendOf<Decimal>;
}

export interface HuurComplexKpi extends HuurKpiWaarden {
  complexnr: string;
}

export interface HuurKerncijfersResultaat {
  /** Altijd `true` in v1: een actuele bronstand, geen boekjaar/periode-gebonden cijfer. */
  momentopname: true;
  bronPeildatum: Date | null;
  portefeuille: HuurKpiWaarden;
  perComplex: HuurComplexKpi[];
  controleVereist: HuurControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

/** Alleen een peildatum als ALLE aangeleverde, niet-lege `rapportage_datum`-waarden identiek zijn — anders `null`, nooit gekozen/verzonnen. Zelfde bepaling als `vastgoedKerncijfers.ts` (bewust hier apart gehouden, zie moduledoc). */
function bepaalBronPeildatum(rentroll: readonly HuurRentrollRegel[]): Date | null {
  const datums = new Set(rentroll.map((r) => r.rapportageDatum?.toISOString()).filter((d): d is string => d !== undefined));
  if (datums.size !== 1) return null;
  return rentroll.find((r) => r.rapportageDatum !== null)?.rapportageDatum ?? null;
}

/**
 * Contractgeldigheid op een peildatum — zie de moduledoc hierboven voor de
 * volledige regel/grensgevallen. Apart geëxporteerd zodat de datumlogica
 * los van de rest te testen is.
 */
export function bepaalContractGeldigheid(contract: HuurContractRegel, peildatum: Date): OnbekendOf<boolean> {
  if (contract.ingangsdatum === null) {
    return { type: "onbekend", reden: `Contract ${contract.contractnummer}: geen ingangsdatum bekend — contractgeldigheid niet te bepalen.` };
  }
  if (contract.ingangsdatum.getTime() > peildatum.getTime()) {
    return { type: "bekend", waarde: false };
  }
  if (contract.afloopdatum !== null && contract.afloopdatum.getTime() < peildatum.getTime()) {
    return { type: "bekend", waarde: false };
  }
  return { type: "bekend", waarde: true };
}

interface Bucket {
  brutoRegels: Decimal[];
  kortingRegels: Decimal[];
  vvoRegels: Decimal[];
}

function nieuweBucket(): Bucket {
  return { brutoRegels: [], kortingRegels: [], vvoRegels: [] };
}

function berekenHuurKpiWaarden(bucket: Bucket): HuurKpiWaarden {
  const brutoJaarhuur = som(bucket.brutoRegels);
  const huurkortingen = som(bucket.kortingRegels).abs();
  const nettoJaarhuur = brutoJaarhuur.minus(huurkortingen);
  const verhuurdeVvo = som(bucket.vvoRegels);

  const vvoIsNul = verhuurdeVvo.isZero();
  const onbekendPerM2 = (label: string): OnbekendOf<Decimal> => ({ type: "onbekend", reden: `Verhuurde VVO is nul — ${label} niet te bepalen (deling door nul).` });

  return {
    brutoJaarhuur: { type: "bekend", waarde: brutoJaarhuur },
    huurkortingen: { type: "bekend", waarde: huurkortingen },
    nettoJaarhuur: { type: "bekend", waarde: nettoJaarhuur },
    verhuurdeVvo: { type: "bekend", waarde: verhuurdeVvo },
    brutoHuurPerM2: vvoIsNul ? onbekendPerM2("bruto huur per m²") : { type: "bekend", waarde: brutoJaarhuur.dividedBy(verhuurdeVvo) },
    nettoHuurPerM2: vvoIsNul ? onbekendPerM2("netto huur per m²") : { type: "bekend", waarde: nettoJaarhuur.dividedBy(verhuurdeVvo) },
  };
}

export function berekenHuurKerncijfers(rentroll: readonly HuurRentrollRegel[], contracten: readonly HuurContractRegel[]): HuurKerncijfersResultaat {
  const controleVereist: HuurControleItem[] = [];
  const bronPeildatum = bepaalBronPeildatum(rentroll);

  const contractenPerNummer = new Map<string, HuurContractRegel[]>();
  for (const contract of contracten) {
    const bestaand = contractenPerNummer.get(contract.contractnummer);
    if (bestaand) bestaand.push(contract);
    else contractenPerNummer.set(contract.contractnummer, [contract]);
  }

  const perComplexBucket = new Map<string, Bucket>();
  const portefeuilleBucket = nieuweBucket();
  const geteldeEenRegelsPerContract = new Map<string, { complexnr: string; aantal: number }>();

  function bucketVoor(complexnr: string): Bucket {
    let bucket = perComplexBucket.get(complexnr);
    if (!bucket) {
      bucket = nieuweBucket();
      perComplexBucket.set(complexnr, bucket);
    }
    return bucket;
  }

  for (const regel of rentroll) {
    const { vorderingsoort, complexnr, contractnummer, prolongatieBedragJaar, gehuurdOppervlak } = regel;

    if (vorderingsoort !== "01" && vorderingsoort !== "13") {
      if (vorderingsoort === "12") {
        controleVereist.push({ complexnr, ernst: "INFORMATIEF", bericht: `Vorderingsoort "12" (Compensatie OB) voor contract ${contractnummer} — geen onderdeel van huur-KPI's, niet meegeteld.` });
      } else {
        controleVereist.push({
          complexnr,
          ernst: "WAARSCHUWING",
          bericht: `Onverwachte Vorderingsoort "${vorderingsoort}" voor contract ${contractnummer} — niet meegeteld, buiten de bij 070 bewezen structuur (01/12/13).`,
        });
      }
      continue;
    }

    if (complexnr === null) {
      controleVereist.push({
        complexnr: null,
        ernst: "WAARSCHUWING",
        bericht: `Rentroll-regel (Vorderingsoort ${vorderingsoort}) voor contract ${contractnummer} heeft geen complexnummer — niet toe te wijzen, buiten alle sommen gehouden.`,
      });
      continue;
    }

    const gekoppeld = contractenPerNummer.get(contractnummer) ?? [];
    if (gekoppeld.length === 0) {
      controleVereist.push({ complexnr, ernst: "WAARSCHUWING", bericht: `Contract ${contractnummer} (Vorderingsoort ${vorderingsoort}) niet gevonden in contracten — contractgeldigheid niet te bepalen, niet meegeteld.` });
      continue;
    }
    if (gekoppeld.length > 1) {
      controleVereist.push({
        complexnr,
        ernst: "WAARSCHUWING",
        bericht: `Contract ${contractnummer} (Vorderingsoort ${vorderingsoort}) komt ${gekoppeld.length} keer voor in contracten — niet eenduidig, niet meegeteld.`,
      });
      continue;
    }
    const contract = gekoppeld[0]!;

    if (bronPeildatum === null) continue; // portefeuillebrede melding hieronder, niet per regel herhalen.

    const geldigheid = bepaalContractGeldigheid(contract, bronPeildatum);
    if (geldigheid.type === "onbekend") {
      controleVereist.push({ complexnr, ernst: "WAARSCHUWING", bericht: `${geldigheid.reden} (Vorderingsoort ${vorderingsoort}, contract ${contractnummer})` });
      continue;
    }
    if (!geldigheid.waarde) {
      controleVereist.push({
        complexnr,
        ernst: "INFORMATIEF",
        bericht: `Contract ${contractnummer} (Vorderingsoort ${vorderingsoort}) is niet geldig op peildatum ${bronPeildatum.toISOString().slice(0, 10)} — niet meegeteld.`,
      });
      continue;
    }

    if (contract.checkLopendContract !== null) {
      const zegtLopend = contract.checkLopendContract.trim().toLowerCase() === "ja";
      if (zegtLopend !== geldigheid.waarde) {
        controleVereist.push({
          complexnr,
          ernst: "WAARSCHUWING",
          bericht: `Contract ${contractnummer}: check_lopend_contract ("${contract.checkLopendContract}") wijkt af van de berekende contractgeldigheid (${geldigheid.waarde ? "geldig" : "niet geldig"} op ${bronPeildatum.toISOString().slice(0, 10)}) — berekende geldigheid blijft leidend.`,
        });
      }
    }

    const bucket = bucketVoor(complexnr);

    if (vorderingsoort === "01") {
      if (gehuurdOppervlak === null || gehuurdOppervlak.isZero()) {
        controleVereist.push({ complexnr, ernst: "WAARSCHUWING", bericht: `Vorderingsoort "01"-regel voor contract ${contractnummer} heeft 0 of ontbrekend gehuurd_oppervlak — afwijkend van de bij 070 bewezen structuur.` });
      } else if (gehuurdOppervlak.isNegative()) {
        controleVereist.push({ complexnr, ernst: "KRITIEK", bericht: `Vorderingsoort "01"-regel voor contract ${contractnummer} heeft een negatief gehuurd_oppervlak (${gehuurdOppervlak.toString()} m²) — buiten de VVO-som gehouden.` });
      } else {
        bucket.vvoRegels.push(gehuurdOppervlak);
        portefeuilleBucket.vvoRegels.push(gehuurdOppervlak);
      }

      if (prolongatieBedragJaar === null) {
        controleVereist.push({ complexnr, ernst: "WAARSCHUWING", bericht: `Vorderingsoort "01"-regel voor contract ${contractnummer} heeft geen prolongatie_bedrag_jaar — niet meegeteld in bruto jaarhuur.` });
      } else {
        bucket.brutoRegels.push(prolongatieBedragJaar);
        portefeuilleBucket.brutoRegels.push(prolongatieBedragJaar);
        const teller = geteldeEenRegelsPerContract.get(contractnummer);
        if (teller) teller.aantal += 1;
        else geteldeEenRegelsPerContract.set(contractnummer, { complexnr, aantal: 1 });
      }
    } else {
      // "13"
      if (gehuurdOppervlak !== null && gehuurdOppervlak.greaterThan(0)) {
        controleVereist.push({
          complexnr,
          ernst: "WAARSCHUWING",
          bericht: `Vorderingsoort "13"-regel voor contract ${contractnummer} heeft gehuurd_oppervlak > 0 (${gehuurdOppervlak.toString()} m²) — afwijkend van de bij 070 bewezen structuur (13-regels hebben normaliter 0 m²).`,
        });
      }

      if (prolongatieBedragJaar === null) {
        controleVereist.push({ complexnr, ernst: "WAARSCHUWING", bericht: `Vorderingsoort "13"-regel voor contract ${contractnummer} heeft geen prolongatie_bedrag_jaar — niet meegeteld in huurkortingen.` });
      } else if (!prolongatieBedragJaar.isNegative()) {
        controleVereist.push({
          complexnr,
          ernst: "KRITIEK",
          bericht: `Vorderingsoort "13"-regel voor contract ${contractnummer} heeft een niet-negatieve waarde (${prolongatieBedragJaar.toString()}) — een huurkorting hoort negatief te zijn, niet meegeteld in huurkortingen.`,
        });
      } else {
        bucket.kortingRegels.push(prolongatieBedragJaar);
        portefeuilleBucket.kortingRegels.push(prolongatieBedragJaar);
      }
    }
  }

  if (bronPeildatum === null && rentroll.length > 0) {
    controleVereist.push({
      complexnr: null,
      ernst: "WAARSCHUWING",
      bericht: "Geen eenduidige bronPeildatum (rentroll.rapportage_datum) beschikbaar — contractgeldigheid kan niet worden bepaald, geen enkele regel is meegeteld.",
    });
  }

  for (const { complexnr, aantal } of geteldeEenRegelsPerContract.values()) {
    if (aantal > 1) {
      controleVereist.push({
        complexnr,
        ernst: "INFORMATIEF",
        bericht: `Meerdere geldige Vorderingsoort "01"-regels voor hetzelfde contract (${aantal}) — opgeteld, afwijkend van de bij 070 bewezen structuur (1 regel per contract).`,
      });
    }
  }

  const perComplex: HuurComplexKpi[] = Array.from(perComplexBucket.entries())
    .map(([complexnr, bucket]) => ({ complexnr, ...berekenHuurKpiWaarden(bucket) }))
    .sort((a, b) => a.complexnr.localeCompare(b.complexnr));

  const portefeuille = berekenHuurKpiWaarden(portefeuilleBucket);

  return { momentopname: true, bronPeildatum, portefeuille, perComplex, controleVereist };
}
