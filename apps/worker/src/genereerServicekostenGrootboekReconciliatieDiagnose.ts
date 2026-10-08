import Decimal from "decimal.js";
import type { RowIssue } from "@bvc/data-contracts";
import { parseServicekostenAfrekeningDiagnose } from "@bvc/data-contracts";
import { openCacheReadonly, selecteerBoekingen, type BoekingRow } from "@bvc/cache";
import {
  diagnoseerServicekostenGrootboekReconciliatie,
  type ServicekostenGrootboekReconciliatieBoekingRegel,
  type ServicekostenGrootboekReconciliatieResultaat,
} from "@bvc/reporting";
import { resolveBron } from "./sourceResolver.js";
import { ExcelBronAdapter } from "./bronAdapter.js";
import { leesAdministratieConfig } from "./administratie.js";
import { administratieCachePad } from "./paths.js";

const MAX_PARSE_ISSUES_VOORBEELD = 20;

export interface GenereerServicekostenGrootboekReconciliatieDiagnoseOpties {
  boekjaar: number;
  /** Standaard "01" — zelfde default-gedrag als elders in dit project. */
  boekperiodeVan?: string | undefined;
  boekperiodeTotEnMet: string;
  /** Grootboekrekeningen om onafhankelijk uit `boekingen` te reconciliëren (bv. ["1711","1712"]) — parameter, niet hardcoded. */
  doelrekeningen: string[];
}

export interface ServicekostenGrootboekReconciliatieDiagnoseMetadata {
  diagnoseVersie: string;
  gegenereerdOp: Date;
  administratieId: string;
  bedrijfsnr: string;
  bronBestand: string;
  boekjaar: number;
  boekperiodeVan: string;
  boekperiodeTotEnMet: string;
  doelrekeningen: string[];
  aantalRuweServicekostenRijen: number;
  aantalGeparsedeServicekostenRijen: number;
  aantalServicekostenRijenInPeriode: number;
  aantalBoekingenInPeriode: number;
}

export interface ServicekostenGrootboekReconciliatieDiagnoseCommandoResultaat {
  metadata: ServicekostenGrootboekReconciliatieDiagnoseMetadata;
  parseIssues: { aantalTotaal: number; voorbeeld: RowIssue[] };
  analyse: ServicekostenGrootboekReconciliatieResultaat;
}

function naarReconciliatieBoekingRegel(row: BoekingRow): ServicekostenGrootboekReconciliatieBoekingRegel {
  return {
    boekjaar: row.boekjaar,
    boekperiode: row.boekperiode,
    dagboeknr: row.dagboeknr,
    boekstuknr: row.boekstuknr,
    volgnr: row.volgnr,
    grootboeknr: row.grootboeknr,
    bedragDebet: new Decimal(row.bedrag_debet),
    bedragCredit: new Decimal(row.bedrag_credit),
    saldo: new Decimal(row.saldo),
  };
}

/**
 * Combineert (a) de RUWE servicekosten-afrekeningsbron (zelfde diagnoseschema
 * als `servicekosten-afrekening-diagnose`, dus MET Kostensoort_Soort) met
 * (b) `boekingen` uit de al-herbouwde cache, en reconcilieert ze op de
 * natuurlijke sleutel (boekjaar+dagboek+boekstuk+volgnummer) — zie
 * `servicekostenGrootboekReconciliatieDiagnose.ts` (`@bvc/reporting`) voor
 * de volledige onderbouwing. TIJDELIJK, ALLEEN-LEZEN: geen schrijfactie,
 * geen wijziging aan cache/rebuildCache, geen koppeling aan management-rapport.
 */
export function genereerServicekostenGrootboekReconciliatieDiagnose(
  root: string,
  administratieId: string,
  opties: GenereerServicekostenGrootboekReconciliatieDiagnoseOpties,
): ServicekostenGrootboekReconciliatieDiagnoseCommandoResultaat {
  const boekperiodeVan = opties.boekperiodeVan ?? "01";
  const config = leesAdministratieConfig(root, administratieId);

  const bron = resolveBron(root, administratieId, "servicekosten");
  if (!bron.bestaat) {
    throw new Error(`Servicekosten-bronbestand niet gevonden op "${bron.pad}" — draai eerst rebuild-cache of controleer bronlocaties.json.`);
  }
  const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);
  const { rijen, issues } = parseServicekostenAfrekeningDiagnose(ruweRijen);
  const eigenRijen = rijen.filter((r) => r.bedrijfsnr === config.bedrijfsnr);
  const rijenInPeriode = eigenRijen.filter(
    (r) => r.boekjaar === opties.boekjaar && r.boekperiode >= boekperiodeVan && r.boekperiode <= opties.boekperiodeTotEnMet,
  );

  const db = openCacheReadonly(administratieCachePad(root, administratieId));
  let boekingenInPeriode: ServicekostenGrootboekReconciliatieBoekingRegel[];
  try {
    const boekjaarRijen = db
      .prepare("SELECT * FROM boekingen WHERE bedrijfsnr = ? AND boekjaar = ?")
      .all(config.bedrijfsnr, opties.boekjaar) as unknown as BoekingRow[];
    const geselecteerd = selecteerBoekingen(boekjaarRijen, {
      bedrijfsnr: config.bedrijfsnr,
      boekjaar: opties.boekjaar,
      boekperiodeVan,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    });
    boekingenInPeriode = geselecteerd.map(naarReconciliatieBoekingRegel);
  } finally {
    db.close();
  }

  const analyse = diagnoseerServicekostenGrootboekReconciliatie(rijenInPeriode, boekingenInPeriode, opties.doelrekeningen);

  return {
    metadata: {
      diagnoseVersie: "1.0.0",
      gegenereerdOp: new Date(),
      administratieId,
      bedrijfsnr: config.bedrijfsnr,
      bronBestand: bron.pad,
      boekjaar: opties.boekjaar,
      boekperiodeVan,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
      doelrekeningen: opties.doelrekeningen,
      aantalRuweServicekostenRijen: ruweRijen.length,
      aantalGeparsedeServicekostenRijen: eigenRijen.length,
      aantalServicekostenRijenInPeriode: rijenInPeriode.length,
      aantalBoekingenInPeriode: boekingenInPeriode.length,
    },
    parseIssues: { aantalTotaal: issues.length, voorbeeld: issues.slice(0, MAX_PARSE_ISSUES_VOORBEELD) },
    analyse,
  };
}
