import Decimal from "decimal.js";
import { openCacheReadonly, selecteerBoekingen, type BalansstandRow, type BoekingRow } from "@bvc/cache";
import { resolveerGrootboekMapping, type Balansstand, type Boekingsregel, type OnbekendOf } from "@bvc/domain";
import { berekenBalansPeriode, berekenNettoResultaat, berekenPlPeriode, type BalansPeriodeResultaat, type NettoResultaatTeken } from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { leesGrootboekMappingGesplitst } from "./grootboekmapping.js";
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
 *
 * "Resultaat huidig boekjaar" heeft geen eigen grootboekrekening — dat
 * wordt hier berekend via dezelfde boekingenselectie met `berekenPlPeriode`
 * + `berekenNettoResultaat` (@bvc/reporting) en als extra invoer aan
 * `berekenBalansPeriode` meegegeven (twee outputs van dezelfde rekenlaag,
 * CLAUDE.md §2 — geen parallelle P&L-herberekening).
 */

/** Standaard optel-/aftrekteken per P&L-rapportagecategorie voor het nettoresultaat. */
export const STANDAARD_TEKEN_PER_CATEGORIE: ReadonlyMap<string, NettoResultaatTeken> = new Map([
  ["Opbrengsten", 1],
  ["Kosten", -1],
]);

export interface GenereerBalansPeriodeOpties {
  boekjaar: number;
  boekperiodeTotEnMet: string;
  /** Standaard €0,01 (PAR-CTRL-002 pilot-startwaarde), zie @bvc/domain's bankaansluiting/boekstukcontrole. */
  toleranceEuro?: Decimal | undefined;
  /**
   * Optel-/aftrekteken per P&L-rapportagecategorie voor "resultaat huidig
   * boekjaar" (zie `berekenNettoResultaat`, @bvc/reporting). Standaard:
   * `STANDAARD_TEKEN_PER_CATEGORIE` (Opbrengsten +1, Kosten -1 — de enige
   * twee rapportagecategorieën die nu system-breed gebruikt worden, zie
   * packages/config/README.md "Bewust uitgesteld"). Dit is een expliciete,
   * voorlopige boekhoudkundige standaardaanname (resultaat = opbrengsten -
   * kosten), geen per-administratie geverifieerd gegeven — override indien
   * een administratie andere/fijnere rapportagecategorieën gebruikt.
   */
  tekenPerCategorie?: ReadonlyMap<string, NettoResultaatTeken> | undefined;
}

export interface GenereerBalansPeriodeResultaat {
  resultaat: BalansPeriodeResultaat;
  /** Het aan de balans meegegeven P&L-resultaat, apart teruggegeven voor traceerbaarheid (bv. om te vergelijken met een los pl-periode-commando). */
  resultaatHuidigBoekjaar: OnbekendOf<Decimal>;
}

export function genereerBalansPeriode(root: string, administratieId: string, opties: GenereerBalansPeriodeOpties): GenereerBalansPeriodeResultaat {
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
    const resultaatHuidigBoekjaar = berekenNettoResultaat(plResultaat.categorieTotalen, opties.tekenPerCategorie ?? STANDAARD_TEKEN_PER_CATEGORIE);

    const resultaat = berekenBalansPeriode(
      balansstanden,
      boekingsregels,
      mapping.master,
      mapping.override,
      resultaatHuidigBoekjaar,
      opties.toleranceEuro ?? new Decimal("0.01"),
    );
    return { resultaat, resultaatHuidigBoekjaar };
  } finally {
    db.close();
  }
}
