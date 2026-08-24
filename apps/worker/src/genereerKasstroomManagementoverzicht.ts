import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { openCacheReadonly, selecteerBoekingen, type BalansstandRow, type BoekingRow } from "@bvc/cache";
import type { Balansstand, Boekingsregel } from "@bvc/domain";
import { berekenKasstroomManagementoverzicht, renderKasstroomManagementoverzichtHtml, type KasstroomManagementoverzichtInvoer, type KasstroomManagementoverzichtResultaat } from "@bvc/reporting";
import { administratieCachePad, administratieRapportenDir } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { leesGrootboekMapping } from "./grootboekmapping.js";
import { naarBalansstand, naarBoekingsregel } from "./rowMappers.js";

/**
 * Bouwt het Kasstroom-managementoverzicht (`@bvc/reporting`'s
 * `berekenKasstroomManagementoverzicht`) uit de al-herbouwde cache van één
 * administratie, en schrijft het weg naar `rapporten/` (zelfde patroon als
 * `genereerRapportPeriode.ts`/`genereerControlerapport.ts`). De
 * `streefwaardeBankstand` komt uit de per-administratie `administratie.json`
 * (nieuw, optioneel veld) — nooit een geraden standaardwaarde.
 */

export interface GenereerKasstroomManagementoverzichtOpties {
  boekjaar: number;
  boekperiodeTotEnMet: string;
}

export interface GenereerKasstroomManagementoverzichtResultaat {
  html: string;
  pad: string;
  resultaat: KasstroomManagementoverzichtResultaat;
}

export function genereerKasstroomManagementoverzicht(
  root: string,
  administratieId: string,
  opties: GenereerKasstroomManagementoverzichtOpties,
): GenereerKasstroomManagementoverzichtResultaat {
  const config = leesAdministratieConfig(root, administratieId);
  const mapping = leesGrootboekMapping(root, administratieId);
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

    const streefwaardeBankstand = config.streefwaardeBankstand ? new Decimal(config.streefwaardeBankstand) : null;
    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingsregels, mapping.regels, streefwaardeBankstand);

    const invoer: KasstroomManagementoverzichtInvoer = {
      administratieNaam: config.weergavenaam,
      bedrijfsnr: config.bedrijfsnr,
      boekjaar: opties.boekjaar,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
      gegenereerdOp: new Date(),
      resultaat,
    };

    const html = renderKasstroomManagementoverzichtHtml(invoer);
    const rapportenDir = administratieRapportenDir(root, administratieId);
    mkdirSync(rapportenDir, { recursive: true });
    const tijdstempel = new Date().toISOString().replace(/[:.]/g, "-");
    const pad = join(rapportenDir, `kasstroom-managementoverzicht-${opties.boekjaar}-${opties.boekperiodeTotEnMet}-${tijdstempel}.html`);
    writeFileSync(pad, html, "utf-8");

    return { html, pad, resultaat };
  } finally {
    db.close();
  }
}
