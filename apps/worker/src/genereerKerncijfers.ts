import Decimal from "decimal.js";
import { openCacheReadonly, selecteerBoekingen, type BalansstandRow, type BoekingRow } from "@bvc/cache";
import { resolveerGrootboekMapping, type Balansstand, type Boekingsregel } from "@bvc/domain";
import {
  berekenBalansPeriode,
  berekenKasstroomManagementoverzicht,
  berekenNettoResultaat,
  berekenPlPeriode,
  samenstelKerncijfersManagement,
  type KerncijfersManagementResultaat,
} from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { STANDAARD_TEKEN_PER_CATEGORIE } from "./genereerBalansPeriode.js";
import { genereerVastgoedKerncijfers } from "./genereerVastgoedKerncijfers.js";
import { leesGrootboekMappingGesplitst } from "./grootboekmapping.js";
import { naarBalansstand, naarBoekingsregel } from "./rowMappers.js";

/**
 * Kerncijfers / Management-KPI's (v1, 2026-08-26) — tijdelijk CLI-commando,
 * nog GEEN renderer/HTML-rapport. Combineert uitsluitend al-bewezen
 * berekeningen tot één compact overzicht: `berekenPlPeriode` +
 * `berekenNettoResultaat` (totale opbrengsten/kosten, resultaat huidig
 * boekjaar — zelfde aanroep als `genereerBalansPeriode.ts`/
 * `genereerRapportPeriode.ts`), `berekenKasstroomManagementoverzicht`
 * (bankstand einde periode, netto kasstroom, eigenaaronttrekkingen) en
 * `berekenBalansPeriode` (uitsluitend voor `aansluiting.sluitBinnenTolerantie`
 * als datakwaliteitsindicator — de balans wordt NIET gebruikt om een van de
 * zes kerncijfers zelf te herberekenen). Zelfde cache-read/mapping-patroon
 * als `genereerRapportPeriode.ts`, nu voor drie i.p.v. twee bronnen. Geen
 * financiële logica hier — alleen samenstellen (@bvc/reporting's
 * `kerncijfersManagement.ts`).
 *
 * Vastgoedsectie (2026-08-26): hergebruikt `genereerVastgoedKerncijfers.ts`
 * ONGEWIJZIGD (eigen, tweede read-only cacheverbinding — geen aanpassing
 * aan de vastgoed-rekenlogica of aan de financiële logica hierboven). De
 * vastgoedsectie kent bewust geen boekjaar/periode: het blijft een actuele
 * momentopname (`vastgoed.momentopname === true`), losstaand van de
 * periodegebonden financiële velden — zie `kerncijfersManagement.ts`.
 */

export interface GenereerKerncijfersOpties {
  boekjaar: number;
  boekperiodeTotEnMet: string;
  /** Standaard €0,01 (PAR-CTRL-002 pilot-startwaarde), zie genereerBalansPeriode.ts — geldt hier uitsluitend voor de balansaansluitingscontrole. */
  toleranceEuro?: Decimal | undefined;
}

export function genereerKerncijfers(root: string, administratieId: string, opties: GenereerKerncijfersOpties): KerncijfersManagementResultaat {
  const config = leesAdministratieConfig(root, administratieId);
  const mapping = leesGrootboekMappingGesplitst(root, administratieId);
  const mappingRegels = resolveerGrootboekMapping(mapping.master, mapping.override);
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  try {
    const boekjaarRijen = db
      .prepare("SELECT * FROM boekingen WHERE bedrijfsnr = ? AND boekjaar = ?")
      .all(config.bedrijfsnr, opties.boekjaar) as unknown as BoekingRow[];
    const geselecteerd = selecteerBoekingen(boekjaarRijen, {
      bedrijfsnr: config.bedrijfsnr,
      boekjaar: opties.boekjaar,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    });
    const boekingsregels: Boekingsregel[] = geselecteerd.map(naarBoekingsregel);

    const balansstandRijen = db
      .prepare("SELECT * FROM balansstanden WHERE bedrijfsnr = ? AND jaar = ?")
      .all(config.bedrijfsnr, opties.boekjaar) as unknown as BalansstandRow[];
    const balansstanden: Balansstand[] = balansstandRijen.map(naarBalansstand);

    const plResultaat = berekenPlPeriode(boekingsregels, mappingRegels);
    const resultaatHuidigBoekjaar = berekenNettoResultaat(plResultaat.categorieTotalen, STANDAARD_TEKEN_PER_CATEGORIE);
    const balansResultaat = berekenBalansPeriode(
      balansstanden,
      boekingsregels,
      mapping.master,
      mapping.override,
      resultaatHuidigBoekjaar,
      opties.toleranceEuro ?? new Decimal("0.01"),
    );
    const kasstroomResultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingsregels, mappingRegels);
    const vastgoed = genereerVastgoedKerncijfers(root, administratieId);

    return samenstelKerncijfersManagement(plResultaat, resultaatHuidigBoekjaar, kasstroomResultaat, balansResultaat.aansluiting.sluitBinnenTolerantie, vastgoed);
  } finally {
    db.close();
  }
}
