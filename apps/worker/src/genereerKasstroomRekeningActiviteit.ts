import { openCacheReadonly, selecteerBoekingen, type BoekingRow } from "@bvc/cache";
import type { Boekingsregel } from "@bvc/domain";
import { diagnoseerRekeningActiviteit, type RekeningActiviteitRegel } from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { leesGrootboekMapping } from "./grootboekmapping.js";
import { naarBoekingsregel } from "./rowMappers.js";

/**
 * Alleen-lezen diagnostiek (geen HTML/rapportbestand): zie
 * `@bvc/reporting`'s `diagnoseerRekeningActiviteit` voor het doel en
 * mechanisme. Laadt de cache op exact dezelfde manier als
 * `genereerKasstroomTegenrekeningDiagnose.ts`.
 */

export interface GenereerKasstroomRekeningActiviteitOpties {
  boekjaar: number;
  boekperiodeTotEnMet: string;
  doelRekening: string;
}

export function genereerKasstroomRekeningActiviteit(
  root: string,
  administratieId: string,
  opties: GenereerKasstroomRekeningActiviteitOpties,
): readonly RekeningActiviteitRegel[] {
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

    return diagnoseerRekeningActiviteit(boekingsregels, mapping.regels, opties.doelRekening);
  } finally {
    db.close();
  }
}
