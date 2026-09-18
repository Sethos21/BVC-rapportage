import type Decimal from "decimal.js";
import type { OnbekendOf } from "@bvc/domain";
import type { HuurKerncijfersResultaat } from "./huurKerncijfers.js";
import type { KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";
import type { KasstroomTopUitgaveRegel } from "./kasstroomTopUitgaven.js";
import type { VastgoedKerncijfersResultaat } from "./vastgoedKerncijfers.js";
import type { ServicekostenPositieResultaat } from "./servicekostenPositie.js";

/**
 * Eerste gecombineerde managementrapportage (v1, 2026-08-26; periode-van
 * uitgebreid 2026-08-26) — PURE samenstelfunctie: bundelt uitsluitend
 * al-bewezen uitkomsten. Rekent zelf NIETS uit — geen enkel bedrag/
 * percentage/m² wordt hier herberekend of gecombineerd tot een nieuw
 * getal; dat gebeurt in `apps/worker/src/genereerManagementRapport.ts`
 * (selectie) en de reportingfuncties die het aanroept (`berekenPlPeriode`,
 * `berekenNettoResultaat`, `berekenKasstroomManagementoverzicht`/
 * `berekenKasstroomManagementoverzichtSubperiode`, `berekenTopOverigeUitgaven`).
 *
 * DRIE EXPLICIET GESCHEIDEN GROEPEN, elk met een eigen financiële
 * betekenis — een gebruiker die periode 04–06 selecteert mag nooit hoeven
 * gokken of "resultaat" Q2 of het halfjaar betekent:
 *
 * 1. `periode` — UITSLUITEND boekperiodeVan t/m boekperiodeTotEnMet
 *    (P&L + kasstroom over de geselecteerde sub-periode, bv. "Q2").
 * 2. `stand` — ALTIJD boekperiode 01 t/m boekperiodeTotEnMet, ONGEACHT
 *    boekperiodeVan (bankstand einde, resultaat huidig boekjaar YTD,
 *    balans-sluit-check — een balans is een momentopname aan het einde
 *    van de periode, geen bereik, en resultaat-huidig-boekjaar moet YTD
 *    blijven voor de balansaansluiting activa = passiva + resultaat).
 * 3. `vastgoed`/`huur` — momentopname, volledig los van boekjaar/periode
 *    (ongewijzigd, ook bij een periode-van-selectie).
 * 4. `servicekosten` — UITSLUITEND boekperiodeVan t/m boekperiodeTotEnMet,
 *    zelfde range als `periode` hierboven (`servicekostenPositie.ts`
 *    kent geen YTD-variant, servicekosten zijn pure transactieregels
 *    zonder beginsaldo-afhankelijkheid). De 1711/1712-grootboek-
 *    reconciliatie daarin is een controlemechanisme, geen management-KPI
 *    — wordt daarom NIET apart gerenderd, uitsluitend via `controleVereist`
 *    bij een afwijking (zie `renderManagementRapport.ts`).
 *
 * `controleVereist` combineert de datakwaliteitsmeldingen van alle bronnen
 * tot één genormaliseerde lijst (sectie + ernst + referentie + bericht) —
 * puur herlabelen, geen nieuwe classificatie.
 */

export type ManagementRapportControleErnst = "KRITIEK" | "WAARSCHUWING" | "INFORMATIEF";
export type ManagementRapportSectie = "Financieel" | "Vastgoed" | "Huur" | "Kasstroom" | "Servicekosten";

export interface ManagementRapportControleItem {
  sectie: ManagementRapportSectie;
  ernst: ManagementRapportControleErnst;
  /** Vrije referentie naar waar de melding vandaan komt binnen de sectie (bv. complexnr of grootboekrekening) — puur ter oriëntatie, geen nieuwe classificatie. */
  referentie: string | null;
  bericht: string;
}

/** Uitsluitend boekperiodeVan t/m boekperiodeTotEnMet — GEEN YTD. */
export interface ManagementRapportPeriodeSectie {
  boekperiodeVan: string;
  boekperiodeTotEnMet: string;
  totaleOpbrengsten: Decimal;
  totaleKosten: Decimal;
  resultaatPeriode: OnbekendOf<Decimal>;
  /** Bij boekperiodeVan="01" is dit byte-identiek aan de bestaande YTD-kasstroomweergave; anders van `berekenKasstroomManagementoverzichtSubperiode`. */
  kasstroom: KasstroomManagementoverzichtResultaat;
  topOverigeUitgaven?: readonly KasstroomTopUitgaveRegel[] | undefined;
}

/** ALTIJD boekperiode 01 t/m boekperiodeTotEnMet, ongeacht boekperiodeVan. */
export interface ManagementRapportStandSectie {
  boekperiodeTotEnMet: string;
  bankstandEinde: Decimal;
  resultaatHuidigBoekjaarYtd: OnbekendOf<Decimal>;
  balansSluit: boolean;
}

export interface ManagementRapportInvoer {
  administratieNaam: string;
  bedrijfsnr: string;
  boekjaar: number;
  gegenereerdOp: Date;
  periode: ManagementRapportPeriodeSectie;
  stand: ManagementRapportStandSectie;
  vastgoed: VastgoedKerncijfersResultaat;
  huur: HuurKerncijfersResultaat;
  /** Zelfde boekperiodeVan/boekperiodeTotEnMet als `periode` hierboven — geen aparte periodeselectie. */
  servicekosten: ServicekostenPositieResultaat;
}

export interface ManagementRapportResultaat {
  administratieNaam: string;
  bedrijfsnr: string;
  boekjaar: number;
  gegenereerdOp: Date;
  periode: ManagementRapportPeriodeSectie;
  stand: ManagementRapportStandSectie;
  /** Ongewijzigd doorgegeven (momentopname, eigen `bronPeildatum`/`controleVereist`) — zie `vastgoedKerncijfers.ts`. */
  vastgoed: VastgoedKerncijfersResultaat;
  /** Ongewijzigd doorgegeven (momentopname, eigen `bronPeildatum`/`controleVereist`) — zie `huurKerncijfers.ts`. */
  huur: HuurKerncijfersResultaat;
  /** Ongewijzigd doorgegeven — zie `servicekostenPositie.ts`. De 1711/1712-reconciliatie (sectie C) wordt NIET apart getoond, uitsluitend via `controleVereist` bij een afwijking. */
  servicekosten: ServicekostenPositieResultaat;
  controleVereist: ManagementRapportControleItem[];
}

export function samenstelManagementRapport(invoer: ManagementRapportInvoer): ManagementRapportResultaat {
  const controleVereist: ManagementRapportControleItem[] = [];

  if (invoer.periode.resultaatPeriode.type === "onbekend") {
    controleVereist.push({ sectie: "Financieel", ernst: "WAARSCHUWING", referentie: null, bericht: invoer.periode.resultaatPeriode.reden });
  }
  if (invoer.stand.resultaatHuidigBoekjaarYtd.type === "onbekend") {
    controleVereist.push({ sectie: "Financieel", ernst: "WAARSCHUWING", referentie: null, bericht: invoer.stand.resultaatHuidigBoekjaarYtd.reden });
  }
  if (!invoer.stand.balansSluit) {
    controleVereist.push({ sectie: "Financieel", ernst: "KRITIEK", referentie: null, bericht: "Balans sluit niet binnen tolerantie voor deze periode." });
  }

  for (const item of invoer.vastgoed.controleVereist) {
    controleVereist.push({ sectie: "Vastgoed", ernst: item.ernst, referentie: item.complexnr, bericht: item.bericht });
  }

  for (const item of invoer.huur.controleVereist) {
    controleVereist.push({ sectie: "Huur", ernst: item.ernst, referentie: item.complexnr, bericht: item.bericht });
  }

  for (const item of invoer.periode.kasstroom.controleVereist) {
    controleVereist.push({
      sectie: "Kasstroom",
      ernst: "WAARSCHUWING",
      referentie: item.grootboekrekening,
      bericht: `${item.reden} (saldo ${item.saldo.toString()})`,
    });
  }

  for (const item of invoer.servicekosten.controleVereist) {
    controleVereist.push({ sectie: "Servicekosten", ernst: item.ernst, referentie: item.referentie, bericht: item.bericht });
  }

  return {
    administratieNaam: invoer.administratieNaam,
    bedrijfsnr: invoer.bedrijfsnr,
    boekjaar: invoer.boekjaar,
    gegenereerdOp: invoer.gegenereerdOp,
    periode: invoer.periode,
    stand: invoer.stand,
    vastgoed: invoer.vastgoed,
    huur: invoer.huur,
    servicekosten: invoer.servicekosten,
    controleVereist,
  };
}
