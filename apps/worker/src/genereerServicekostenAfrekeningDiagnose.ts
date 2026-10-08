import type { RowIssue } from "@bvc/data-contracts";
import { parseServicekostenAfrekeningDiagnose } from "@bvc/data-contracts";
import { diagnoseerServicekostenAfrekening, type ServicekostenAfrekeningDiagnoseResultaat } from "@bvc/reporting";
import { resolveBron } from "./sourceResolver.js";
import { ExcelBronAdapter } from "./bronAdapter.js";
import { leesAdministratieConfig } from "./administratie.js";

/** Zelfde patroon als de `parseIssues`/`voorbeeld`-begrenzing in `@bvc/reporting`'s servicekosten-afrekeningsdiagnose — een lange issue-lijst wordt nooit stilzwijgend volledig teruggegeven. */
const MAX_PARSE_ISSUES_VOORBEELD = 20;

export interface ServicekostenAfrekeningDiagnoseMetadata {
  diagnoseVersie: string;
  gegenereerdOp: Date;
  administratieId: string;
  bedrijfsnr: string;
  bronBestand: string;
  aantalRuweRijen: number;
  aantalGeparsedeRijen: number;
}

export interface ServicekostenAfrekeningDiagnoseCommandoResultaat {
  metadata: ServicekostenAfrekeningDiagnoseMetadata;
  /** Elke rij die niet aan het diagnoseschema voldeed — nooit stilzwijgend uit `analyse` verdwenen, zie `parseServicekostenAfrekeningDiagnose`. */
  parseIssues: { aantalTotaal: number; voorbeeld: RowIssue[] };
  analyse: ServicekostenAfrekeningDiagnoseResultaat;
}

/**
 * Leest het RUWE servicekosten-bronbestand (niet de cache/het productieschema)
 * en analyseert `Kostensoort_Soort` + de acht afrekeningsvelden + het
 * bron-eigen `Service_Boeking_Saldo` — zie `servicekostenAfrekeningDiagnose.ts`
 * (`@bvc/reporting`) voor het doel en de volledige onderbouwing. TIJDELIJK,
 * ALLEEN-LEZEN: geen schrijfactie, geen cache/rebuildCache-aanraking, geen
 * koppeling aan `management-rapport`.
 */
export function genereerServicekostenAfrekeningDiagnose(root: string, administratieId: string): ServicekostenAfrekeningDiagnoseCommandoResultaat {
  const config = leesAdministratieConfig(root, administratieId);
  const bron = resolveBron(root, administratieId, "servicekosten");
  if (!bron.bestaat) {
    throw new Error(`Servicekosten-bronbestand niet gevonden op "${bron.pad}" — draai eerst rebuild-cache of controleer bronlocaties.json.`);
  }

  const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);
  const { rijen, issues } = parseServicekostenAfrekeningDiagnose(ruweRijen);
  const eigenRijen = rijen.filter((r) => r.bedrijfsnr === config.bedrijfsnr);

  const analyse = diagnoseerServicekostenAfrekening(eigenRijen);

  return {
    metadata: {
      diagnoseVersie: "1.0.0",
      gegenereerdOp: new Date(),
      administratieId,
      bedrijfsnr: config.bedrijfsnr,
      bronBestand: bron.pad,
      aantalRuweRijen: ruweRijen.length,
      aantalGeparsedeRijen: eigenRijen.length,
    },
    parseIssues: { aantalTotaal: issues.length, voorbeeld: issues.slice(0, MAX_PARSE_ISSUES_VOORBEELD) },
    analyse,
  };
}
