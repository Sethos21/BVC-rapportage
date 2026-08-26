import type Decimal from "decimal.js";
import type { OnbekendOf } from "@bvc/domain";
import type { KerncijfersManagementResultaat } from "./kerncijfersManagement.js";
import type { HuurKerncijfersResultaat } from "./huurKerncijfers.js";
import type { KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";
import type { KasstroomTopUitgaveRegel } from "./kasstroomTopUitgaven.js";
import type { VastgoedKerncijfersResultaat } from "./vastgoedKerncijfers.js";

/**
 * Eerste gecombineerde managementrapportage (v1, 2026-08-26) — PURE
 * samenstelfunctie: bundelt uitsluitend de al-bewezen uitkomsten van
 * `kerncijfersManagement.ts` (financieel + vastgoed), `huurKerncijfers.ts`
 * en `kasstroomManagementoverzicht.ts` (volledige detail, incl.
 * `topOverigeUitgaven`). Rekent zelf NIETS uit — geen enkel bedrag/
 * percentage/m² wordt hier herberekend of gecombineerd tot een nieuw
 * getal. `renderManagementRapport.ts` ontvangt uitsluitend
 * `ManagementRapportResultaat` en presenteert; ook de renderer rekent
 * niets. CLAUDE.md §2 in optima forma: "twee outputs van dezelfde
 * rekenlaag", hier vier bronnen tot één rapport.
 *
 * `controleVereist` combineert de datakwaliteitsmeldingen van alle
 * onderliggende modules tot één genormaliseerde lijst (sectie + ernst +
 * referentie + bericht) — puur herlabelen, geen nieuwe classificatie. De
 * financiële sectie krijgt twee AFGELEIDE meldingen die in de bronmodules
 * zelf geen `controleVereist`-item zijn (`resultaatHuidigBoekjaar` is
 * `onbekend`, of `balansSluitBinnenTolerantie` is `false`) — ook dat is
 * puur weergeven van een al-bestaand veld, geen nieuwe beoordeling.
 */

export type ManagementRapportControleErnst = "KRITIEK" | "WAARSCHUWING" | "INFORMATIEF";
export type ManagementRapportSectie = "Financieel" | "Vastgoed" | "Huur" | "Kasstroom";

export interface ManagementRapportControleItem {
  sectie: ManagementRapportSectie;
  ernst: ManagementRapportControleErnst;
  /** Vrije referentie naar waar de melding vandaan komt binnen de sectie (bv. complexnr of grootboekrekening) — puur ter oriëntatie, geen nieuwe classificatie. */
  referentie: string | null;
  bericht: string;
}

export interface ManagementRapportSamenvatting {
  totaleOpbrengsten: Decimal;
  totaleKosten: Decimal;
  resultaatHuidigBoekjaar: OnbekendOf<Decimal>;
  bankstandEinde: Decimal;
  nettoKasstroom: Decimal;
  eigenaarOnttrekkingen: Decimal;
  balansSluit: boolean;
}

export interface ManagementRapportInvoer {
  administratieNaam: string;
  bedrijfsnr: string;
  boekjaar: number;
  boekperiodeTotEnMet: string;
  gegenereerdOp: Date;
  kerncijfers: KerncijfersManagementResultaat;
  kasstroom: KasstroomManagementoverzichtResultaat;
  huur: HuurKerncijfersResultaat;
  topOverigeUitgaven?: readonly KasstroomTopUitgaveRegel[] | undefined;
}

export interface ManagementRapportResultaat {
  administratieNaam: string;
  bedrijfsnr: string;
  boekjaar: number;
  boekperiodeTotEnMet: string;
  gegenereerdOp: Date;
  managementsamenvatting: ManagementRapportSamenvatting;
  /** Ongewijzigd doorgegeven (momentopname, eigen `bronPeildatum`/`controleVereist`) — zie `vastgoedKerncijfers.ts`. */
  vastgoed: VastgoedKerncijfersResultaat;
  /** Ongewijzigd doorgegeven (momentopname, eigen `bronPeildatum`/`controleVereist`) — zie `huurKerncijfers.ts`. */
  huur: HuurKerncijfersResultaat;
  /** Ongewijzigd doorgegeven, volledige detail (bankstand begin/eind, ontvangsten/uitgaven, kwartalen) — zie `kasstroomManagementoverzicht.ts`. */
  kasstroom: KasstroomManagementoverzichtResultaat;
  topOverigeUitgaven?: readonly KasstroomTopUitgaveRegel[] | undefined;
  controleVereist: ManagementRapportControleItem[];
}

export function samenstelManagementRapport(invoer: ManagementRapportInvoer): ManagementRapportResultaat {
  const controleVereist: ManagementRapportControleItem[] = [];

  if (invoer.kerncijfers.resultaatHuidigBoekjaar.type === "onbekend") {
    controleVereist.push({ sectie: "Financieel", ernst: "WAARSCHUWING", referentie: null, bericht: invoer.kerncijfers.resultaatHuidigBoekjaar.reden });
  }
  if (!invoer.kerncijfers.balansSluitBinnenTolerantie) {
    controleVereist.push({ sectie: "Financieel", ernst: "KRITIEK", referentie: null, bericht: "Balans sluit niet binnen tolerantie voor deze periode." });
  }

  for (const item of invoer.kerncijfers.vastgoed.controleVereist) {
    controleVereist.push({ sectie: "Vastgoed", ernst: item.ernst, referentie: item.complexnr, bericht: item.bericht });
  }

  for (const item of invoer.huur.controleVereist) {
    controleVereist.push({ sectie: "Huur", ernst: item.ernst, referentie: item.complexnr, bericht: item.bericht });
  }

  for (const item of invoer.kasstroom.controleVereist) {
    controleVereist.push({
      sectie: "Kasstroom",
      ernst: "WAARSCHUWING",
      referentie: item.grootboekrekening,
      bericht: `${item.reden} (saldo ${item.saldo.toString()})`,
    });
  }

  return {
    administratieNaam: invoer.administratieNaam,
    bedrijfsnr: invoer.bedrijfsnr,
    boekjaar: invoer.boekjaar,
    boekperiodeTotEnMet: invoer.boekperiodeTotEnMet,
    gegenereerdOp: invoer.gegenereerdOp,
    managementsamenvatting: {
      totaleOpbrengsten: invoer.kerncijfers.totaleOpbrengsten,
      totaleKosten: invoer.kerncijfers.totaleKosten,
      resultaatHuidigBoekjaar: invoer.kerncijfers.resultaatHuidigBoekjaar,
      bankstandEinde: invoer.kerncijfers.bankstandEindePeriode,
      nettoKasstroom: invoer.kerncijfers.nettoKasstroom,
      eigenaarOnttrekkingen: invoer.kerncijfers.eigenaarOnttrekkingen,
      balansSluit: invoer.kerncijfers.balansSluitBinnenTolerantie,
    },
    vastgoed: invoer.kerncijfers.vastgoed,
    huur: invoer.huur,
    kasstroom: invoer.kasstroom,
    topOverigeUitgaven: invoer.topOverigeUitgaven,
    controleVereist,
  };
}
