import Decimal from "decimal.js";
import { openCacheReadonly, selecteerBoekingen, type BalansstandRow, type BoekingRow } from "@bvc/cache";
import type { Balansstand, Boekingsregel } from "@bvc/domain";
import { berekenBalansPeriode, type BalansPeriodeResultaat } from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { leesGrootboekMapping } from "./grootboekmapping.js";
import { naarBalansstand, naarBoekingsregel } from "./rowMappers.js";

/**
 * Draait de balans-periodeberekening (`@bvc/reporting`'s
 * `berekenBalansPeriode`) tegen de al-herbouwde cache van één
 * administratie, met expliciete periodeselectie (`@bvc/cache`'s
 * `selecteerBoekingen`) en de goedgekeurde master+override-grootboekmapping
 * (dezelfde bron als `genereerPlPeriode` — geen eigen/parallelle mapping).
 * Bewust GEEN renderer/HTML — dit levert de rekenkern.
 *
 * Peildatum is expliciet: boekjaar + boekperiodeTotEnMet (bv. "06" voor
 * "balans na periode 6"). De beginbalans komt uit de `balansstanden`-tabel
 * (jaarstand bij boekjaarbegin); saldo op de peildatum = beginbalans + som
 * van alle boekingen t/m die boekperiode (zie balansPeriodeBerekening.ts).
 */

export interface GenereerBalansPeriodeOpties {
  boekjaar: number;
  boekperiodeTotEnMet: string;
  /** Standaard €0,01 (PAR-CTRL-002 pilot-startwaarde), zie @bvc/domain's bankaansluiting/boekstukcontrole. */
  toleranceEuro?: Decimal | undefined;
}

export interface GenereerBalansPeriodeResultaat {
  resultaat: BalansPeriodeResultaat;
}

export function genereerBalansPeriode(root: string, administratieId: string, opties: GenereerBalansPeriodeOpties): GenereerBalansPeriodeResultaat {
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

    const resultaat = berekenBalansPeriode(balansstanden, boekingsregels, mapping.regels, opties.toleranceEuro ?? new Decimal("0.01"));
    return { resultaat };
  } finally {
    db.close();
  }
}
