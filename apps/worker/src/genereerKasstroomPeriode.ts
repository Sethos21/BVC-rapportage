import { openCacheReadonly, selecteerBoekingen, type BalansstandRow, type BoekingRow } from "@bvc/cache";
import type { Balansstand, Boekingsregel } from "@bvc/domain";
import { berekenKasstroomPeriode, type KasstroomPeriodeResultaat } from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { leesGrootboekMapping } from "./grootboekmapping.js";
import { naarBalansstand, naarBoekingsregel } from "./rowMappers.js";

/**
 * Draait de kasstroom-periodeberekening (`@bvc/reporting`'s
 * `berekenKasstroomPeriode`) tegen de al-herbouwde cache van één
 * administratie, met expliciete periodeselectie (`@bvc/cache`'s
 * `selecteerBoekingen`) en de goedgekeurde grootboekmapping (dezelfde bron
 * als `genereerPlPeriode`/`genereerBalansPeriode` — geen eigen/parallelle
 * mapping). Bewust GEEN renderer/HTML — dit levert de rekenkern. Eerste,
 * eenvoudige versie: alleen mutatie bankstand, zie kasstroomBerekening.ts.
 */

export interface GenereerKasstroomPeriodeOpties {
  boekjaar: number;
  boekperiodeTotEnMet: string;
}

export interface GenereerKasstroomPeriodeResultaat {
  resultaat: KasstroomPeriodeResultaat;
}

export function genereerKasstroomPeriode(root: string, administratieId: string, opties: GenereerKasstroomPeriodeOpties): GenereerKasstroomPeriodeResultaat {
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

    const resultaat = berekenKasstroomPeriode(balansstanden, boekingsregels, mapping.regels);
    return { resultaat };
  } finally {
    db.close();
  }
}
