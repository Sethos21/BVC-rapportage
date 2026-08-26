import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { openCacheReadonly, selecteerBoekingen, type BalansstandRow, type BoekingRow } from "@bvc/cache";
import { resolveerGrootboekMapping, type Balansstand, type Boekingsregel } from "@bvc/domain";
import {
  berekenKasstroomManagementoverzicht,
  berekenTopOverigeUitgaven,
  renderManagementRapportHtml,
  samenstelManagementRapport,
  type ManagementRapportResultaat,
} from "@bvc/reporting";
import { administratieCachePad, administratieRapportenDir } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { genereerKerncijfers } from "./genereerKerncijfers.js";
import { genereerHuurKerncijfers } from "./genereerHuurKerncijfers.js";
import { leesGrootboekMappingGesplitst } from "./grootboekmapping.js";
import { naarBalansstand, naarBoekingsregel } from "./rowMappers.js";

/**
 * Eerste gecombineerde managementrapportage (v1, 2026-08-26) — HERGEBRUIKT
 * uitsluitend al-bewezen Worker-generators/rekenfuncties, voegt zelf GEEN
 * financiële/vastgoed-berekening toe:
 * - `genereerKerncijfers.ts` (financieel + vastgoed, al gekoppeld);
 * - `genereerHuurKerncijfers.ts` (huur, momentopname);
 * - `berekenKasstroomManagementoverzicht`/`berekenTopOverigeUitgaven`
 *   rechtstreeks, voor de VOLLEDIGE kasstroomdetail (sectie 4 heeft meer
 *   velden dan de samenvatting die al in `genereerKerncijfers` zit) — dit
 *   herhaalt bewust dezelfde cache-read/bereken-aanroep die
 *   `genereerKasstroomManagementoverzicht.ts` ook doet (zelfde patroon als
 *   overal in deze codebase: elke Worker-generator is zelfstandig, geen
 *   gedeelde runtime-cache tussen commando's — determinisme garandeert
 *   consistente uitkomsten). Schrijft BEWUST geen los kasstroom-HTML-
 *   bestand (dat doet alleen `kasstroom-managementoverzicht` zelf).
 *
 * `@bvc/reporting`'s `samenstelManagementRapport` (puur, rekent niets) en
 * `renderManagementRapportHtml` (puur presenteren) doen de rest.
 */

export interface GenereerManagementRapportOpties {
  boekjaar: number;
  boekperiodeTotEnMet: string;
  toleranceEuro?: Decimal | undefined;
}

export interface GenereerManagementRapportResultaat {
  html: string;
  pad: string;
  resultaat: ManagementRapportResultaat;
}

export function genereerManagementRapport(root: string, administratieId: string, opties: GenereerManagementRapportOpties): GenereerManagementRapportResultaat {
  const config = leesAdministratieConfig(root, administratieId);
  const mapping = leesGrootboekMappingGesplitst(root, administratieId);
  const mappingRegels = resolveerGrootboekMapping(mapping.master, mapping.override);
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  let kasstroomResultaat;
  let topOverigeUitgaven;
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

    kasstroomResultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingsregels, mappingRegels);
    topOverigeUitgaven = berekenTopOverigeUitgaven(boekingsregels, mappingRegels);
  } finally {
    db.close();
  }

  const kerncijfers = genereerKerncijfers(root, administratieId, { boekjaar: opties.boekjaar, boekperiodeTotEnMet: opties.boekperiodeTotEnMet, toleranceEuro: opties.toleranceEuro });
  const huur = genereerHuurKerncijfers(root, administratieId);

  const resultaat = samenstelManagementRapport({
    administratieNaam: config.weergavenaam,
    bedrijfsnr: config.bedrijfsnr,
    boekjaar: opties.boekjaar,
    boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    gegenereerdOp: new Date(),
    kerncijfers,
    kasstroom: kasstroomResultaat,
    huur,
    topOverigeUitgaven,
  });

  const html = renderManagementRapportHtml(resultaat);
  const rapportenDir = administratieRapportenDir(root, administratieId);
  mkdirSync(rapportenDir, { recursive: true });
  const tijdstempel = new Date().toISOString().replace(/[:.]/g, "-");
  const pad = join(rapportenDir, `management-rapport-${opties.boekjaar}-${opties.boekperiodeTotEnMet}-${tijdstempel}.html`);
  writeFileSync(pad, html, "utf-8");

  return { html, pad, resultaat };
}
