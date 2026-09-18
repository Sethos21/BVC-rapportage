import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { openOrCreateDatabase, leesPnLBronmappingRegels } from "@bvc/begroting-data";
import { berekenPnLPeriode, renderPnLPeriodeHtml, type PnLPeriodeOrchestratieResultaat, type PnLRuweBoekingRegel } from "@bvc/reporting";
import { resolveBron } from "./sourceResolver.js";
import { ExcelBronAdapter } from "./bronAdapter.js";
import { leesAdministratieConfig } from "./administratie.js";
import { administratieRapportenDir, pnlBronmappingDatabasePad } from "./paths.js";

/**
 * DELTA BUILD (2026-09-18) — "Pure P&L → Worker + Renderer": DE EERSTE
 * productie-integratie van de Pure P&L Engine (`@bvc/reporting`'s
 * `berekenPnLPeriode`/`pnlEngine.ts`) in de Worker. Dunne I/O-laag,
 * ZELF GEEN FINANCIËLE REKENLOGICA — verzamelt uitsluitend de twee
 * bestaande brontypen die de orchestratielaag nodig heeft en geeft ze
 * ongewijzigd door.
 *
 * WAAROM DE RUWE BOEKINGENBRON RECHTSTREEKS (NIET DE CACHE): de acht
 * bestaande productieketens vereisen `ogbKostensoort` per boeking — de
 * `boekingen`-cachetabel (`@bvc/cache`'s schema.ts) modelleert dat veld
 * (nog) niet (`grootboek_a`/`grootboek_b` zijn iets anders). Dit is GEEN
 * nieuw parallel data-importpad: `genereerOnderhoudBoekingenDiagnose.ts`
 * gebruikt exact hetzelfde bestaande mechanisme (`resolveBron` +
 * `ExcelBronAdapter().leesRuweRijen`) om precies dezelfde reden — hier
 * uitsluitend hergebruikt, niet opnieuw ontworpen.
 *
 * WAAROM DE PNL-BRONMAPPING-DATABASE (NIEUW PRODUCTIEPAD): vóór deze
 * Delta Build riep `apps/worker` `@bvc/begroting-data`'s
 * `leesPnLBronmappingRegels`/`openOrCreateDatabase` nog nooit aan — die
 * repository-functie bestond al (FASE M4) en is al getest
 * (`pnlBronmappingRepository.test.ts`), maar had nog geen productie-
 * aanroeper. Deze functie is de EERSTE. Een administratie zonder ooit
 * geregistreerde mapping levert simpelweg een lege regelset op — de acht
 * calculators/adapters classificeren dan correct alles als NIET_GEMAPT/
 * ONBEKEND (nooit een aanname), precies het bestaande, bewezen gedrag.
 *
 * GEEN NIEUWE FINANCIËLE LOGICA: `berekenPnLPeriode` (de partitionering +
 * de acht bestaande calculators/adapters + `berekenPnLBoom`) is de ENIGE
 * plek die classificeert/optelt. Dit bestand vertaalt uitsluitend
 * ruwe-rij-vormen.
 */

export interface GenereerPnLPeriodeOpties {
  boekjaar: number;
  boekperiodeVan?: string | undefined;
  boekperiodeTotEnMet: string;
}

export interface GenereerPnLPeriodeResultaat extends PnLPeriodeOrchestratieResultaat {
  html: string;
  pad: string;
}

function tekst(v: unknown): string {
  return String(v ?? "").trim();
}

function tekstOfNull(v: unknown): string | null {
  const s = tekst(v);
  return s.length === 0 ? null : s;
}

function naarPnLRuweBoekingRegel(row: Record<string, unknown>): PnLRuweBoekingRegel {
  const debet = new Decimal(tekst(row["Boeking_Bedrag_Debet"]) || "0");
  const credit = new Decimal(tekst(row["Boeking_Bedrag_Credit"]) || "0");
  return {
    grootboekrekening: tekst(row["Boeking_Grootboeknr"]),
    ogbKostensoort: tekstOfNull(row["Boeking_OGB_Kostensoort"]),
    ogbKostensoortOmschrijving: tekstOfNull(row["Boeking_OGB_Kostensoort_Omschr"]),
    complexnummer: tekstOfNull(row["Boeking_Complexnr"]),
    saldo: debet.minus(credit), // CAL-FIN-001: saldo = debet - credit
  };
}

export function genereerPnLPeriode(root: string, administratieId: string, opties: GenereerPnLPeriodeOpties): GenereerPnLPeriodeResultaat {
  const config = leesAdministratieConfig(root, administratieId);
  const boekperiodeVan = opties.boekperiodeVan ?? "01";

  const bron = resolveBron(root, administratieId, "boekingen");
  if (!bron.bestaat) {
    throw new Error(`Boekingen-bronbestand niet gevonden op "${bron.pad}" — draai eerst rebuild-cache of controleer bronlocaties.json.`);
  }
  const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);

  const boekingen: PnLRuweBoekingRegel[] = ruweRijen
    .filter((row) => tekst(row["Bedrijfsnr"]) === config.bedrijfsnr)
    .filter((row) => Number(tekst(row["Boeking_Boekjaar"])) === opties.boekjaar)
    .filter((row) => {
      const periode = tekst(row["Boeking_Boekperiode"]);
      return periode >= boekperiodeVan && periode <= opties.boekperiodeTotEnMet;
    })
    .map(naarPnLRuweBoekingRegel);

  const mappingDb = openOrCreateDatabase(pnlBronmappingDatabasePad(root, administratieId));
  let mappingregels;
  try {
    mappingregels = leesPnLBronmappingRegels(mappingDb, config.bedrijfsnr);
  } finally {
    mappingDb.close();
  }

  const context = { bedrijfsnr: config.bedrijfsnr, boekjaar: opties.boekjaar, boekperiode: opties.boekperiodeTotEnMet, opSysteemtijdstip: new Date() };
  const { resultaat, nietMeegenomen } = berekenPnLPeriode(context, boekingen, mappingregels);

  const html = renderPnLPeriodeHtml({
    administratieNaam: config.weergavenaam,
    bedrijfsnr: config.bedrijfsnr,
    boekjaar: opties.boekjaar,
    ...(opties.boekperiodeVan !== undefined ? { boekperiodeVan: opties.boekperiodeVan } : {}),
    boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    gegenereerdOp: new Date(),
    resultaat,
    nietMeegenomen,
  });

  const rapportenDir = administratieRapportenDir(root, administratieId);
  mkdirSync(rapportenDir, { recursive: true });
  const tijdstempel = new Date().toISOString().replace(/[:.]/g, "-");
  const pad = join(rapportenDir, `pnl-periode-${opties.boekjaar}-${opties.boekperiodeTotEnMet}-${tijdstempel}.html`);
  writeFileSync(pad, html, "utf-8");

  return { resultaat, nietMeegenomen, html, pad };
}
