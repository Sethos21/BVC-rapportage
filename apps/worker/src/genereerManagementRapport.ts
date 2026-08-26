import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { openCacheReadonly, selecteerBoekingen, type BalansstandRow, type BoekingRow } from "@bvc/cache";
import { resolveerGrootboekMapping, type Balansstand, type Boekingsregel } from "@bvc/domain";
import {
  berekenKasstroomManagementoverzicht,
  berekenKasstroomManagementoverzichtSubperiode,
  berekenNettoResultaat,
  berekenPlPeriode,
  berekenTopOverigeUitgaven,
  categorieTotaalOf,
  renderManagementRapportHtml,
  samenstelManagementRapport,
  KOSTEN_CATEGORIE,
  OPBRENGSTEN_CATEGORIE,
  type ManagementRapportResultaat,
} from "@bvc/reporting";
import { administratieCachePad, administratieRapportenDir } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { STANDAARD_TEKEN_PER_CATEGORIE } from "./genereerBalansPeriode.js";
import { genereerKerncijfers } from "./genereerKerncijfers.js";
import { genereerHuurKerncijfers } from "./genereerHuurKerncijfers.js";
import { leesGrootboekMappingGesplitst } from "./grootboekmapping.js";
import { naarBalansstand, naarBoekingsregel } from "./rowMappers.js";

/**
 * Gecombineerde managementrapportage (v1, 2026-08-26; periode-van
 * uitgebreid 2026-08-26). Deze module is UITSLUITEND verantwoordelijk voor
 * selectie (welke boekingen horen bij welke periode-range) en
 * samenstelling (welke al-bewezen functie-uitkomsten in welk veld) — geen
 * enkele nieuwe financiële formule staat hier; die zitten in
 * `@bvc/reporting` (`berekenPlPeriode`, `berekenNettoResultaat`,
 * `berekenKasstroomManagementoverzicht`/`berekenKasstroomManagementoverzichtSubperiode`,
 * `berekenTopOverigeUitgaven`).
 *
 * Drie boekingenselecties, alle via de bestaande `selecteerBoekingen`:
 * - `boekingenPeriode` (boekperiodeVan..boekperiodeTotEnMet) — voor de
 *   "Periode"-sectie: P&L + kasstroom UITSLUITEND over de gekozen range.
 * - `boekingenVoorPeriode` (01..(boekperiodeVan−1)) — uitsluitend als
 *   invoer voor `berekenKasstroomManagementoverzichtSubperiode`, om de
 *   werkelijke bankstand aan het begin van boekperiodeVan af te leiden
 *   (nooit de jaarbeginstand + alleen periode-boekingen combineren).
 * - `boekingenYtd` (01..boekperiodeTotEnMet) — voor de "Stand/YTD"-sectie
 *   (bankstand einde) — dit IS dezelfde selectie als de bestaande
 *   YTD-kasstroomweergave.
 *
 * `genereerKerncijfers()` wordt ongewijzigd hergebruikt, maar uitsluitend
 * voor de drie velden die NOOIT door `boekperiodeVan` mogen veranderen:
 * `resultaatHuidigBoekjaar` (YTD, nodig voor de balansaansluiting),
 * `balansSluitBinnenTolerantie` en `vastgoed`. De rest van zijn output
 * (opbrengsten/kosten/bankstand/kasstroom, daar altijd YTD) wordt hier NIET
 * gebruikt — die worden voor dit rapport apart, periode-bewust herberekend.
 */

export interface GenereerManagementRapportOpties {
  boekjaar: number;
  /** Standaard "01" (heel het jaar tot en met boekperiodeTotEnMet) — zelfde default-gedrag als vóór periode-van bestond. */
  boekperiodeVan?: string | undefined;
  boekperiodeTotEnMet: string;
  toleranceEuro?: Decimal | undefined;
}

export interface GenereerManagementRapportResultaat {
  html: string;
  pad: string;
  resultaat: ManagementRapportResultaat;
}

/** Boekperiode "01".."12" min 1 stap, als 2-cijferige string; "01" - 1 = "00" (matcht dan bewust geen enkele echte boekperiode, zie selecteerBoekingen). */
function voorgaandeBoekperiode(boekperiode: string): string {
  return String(Number(boekperiode) - 1).padStart(2, "0");
}

export function genereerManagementRapport(root: string, administratieId: string, opties: GenereerManagementRapportOpties): GenereerManagementRapportResultaat {
  const boekperiodeVan = opties.boekperiodeVan ?? "01";
  const config = leesAdministratieConfig(root, administratieId);
  const mapping = leesGrootboekMappingGesplitst(root, administratieId);
  const mappingRegels = resolveerGrootboekMapping(mapping.master, mapping.override);
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  let plResultaatPeriode, resultaatPeriode, kasstroomPeriode, topOverigeUitgavenPeriode, bankstandEindeYtd;
  try {
    const boekjaarRijen = db
      .prepare("SELECT * FROM boekingen WHERE bedrijfsnr = ? AND boekjaar = ?")
      .all(config.bedrijfsnr, opties.boekjaar) as unknown as BoekingRow[];

    const boekingenPeriode: Boekingsregel[] = selecteerBoekingen(boekjaarRijen, {
      bedrijfsnr: config.bedrijfsnr,
      boekjaar: opties.boekjaar,
      boekperiodeVan,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    }).map(naarBoekingsregel);

    const boekingenVoorPeriode: Boekingsregel[] = selecteerBoekingen(boekjaarRijen, {
      bedrijfsnr: config.bedrijfsnr,
      boekjaar: opties.boekjaar,
      boekperiodeTotEnMet: voorgaandeBoekperiode(boekperiodeVan),
    }).map(naarBoekingsregel);

    const boekingenYtd: Boekingsregel[] = selecteerBoekingen(boekjaarRijen, {
      bedrijfsnr: config.bedrijfsnr,
      boekjaar: opties.boekjaar,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    }).map(naarBoekingsregel);

    const balansstandRijen = db
      .prepare("SELECT * FROM balansstanden WHERE bedrijfsnr = ? AND jaar = ?")
      .all(config.bedrijfsnr, opties.boekjaar) as unknown as BalansstandRow[];
    const balansstanden: Balansstand[] = balansstandRijen.map(naarBalansstand);

    plResultaatPeriode = berekenPlPeriode(boekingenPeriode, mappingRegels);
    resultaatPeriode = berekenNettoResultaat(plResultaatPeriode.categorieTotalen, STANDAARD_TEKEN_PER_CATEGORIE);

    kasstroomPeriode = berekenKasstroomManagementoverzichtSubperiode({
      balansstanden,
      boekingenVoorPeriode,
      boekingenTotEnMetPeriode: boekingenYtd,
      mappingRegels,
    });
    bankstandEindeYtd = kasstroomPeriode.bankstandEind; // = bankstandEind van berekenKasstroomManagementoverzicht(boekingenYtd) — zie kasstroomManagementoverzichtSubperiode.ts's harde aansluiting.

    topOverigeUitgavenPeriode = berekenTopOverigeUitgaven(boekingenPeriode, mappingRegels);
  } finally {
    db.close();
  }

  const kerncijfers = genereerKerncijfers(root, administratieId, { boekjaar: opties.boekjaar, boekperiodeTotEnMet: opties.boekperiodeTotEnMet, toleranceEuro: opties.toleranceEuro });
  const huur = genereerHuurKerncijfers(root, administratieId);

  const resultaat = samenstelManagementRapport({
    administratieNaam: config.weergavenaam,
    bedrijfsnr: config.bedrijfsnr,
    boekjaar: opties.boekjaar,
    gegenereerdOp: new Date(),
    periode: {
      boekperiodeVan,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
      totaleOpbrengsten: categorieTotaalOf(plResultaatPeriode.categorieTotalen, OPBRENGSTEN_CATEGORIE),
      totaleKosten: categorieTotaalOf(plResultaatPeriode.categorieTotalen, KOSTEN_CATEGORIE),
      resultaatPeriode,
      kasstroom: kasstroomPeriode,
      topOverigeUitgaven: topOverigeUitgavenPeriode,
    },
    stand: {
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
      bankstandEinde: bankstandEindeYtd,
      resultaatHuidigBoekjaarYtd: kerncijfers.resultaatHuidigBoekjaar,
      balansSluit: kerncijfers.balansSluitBinnenTolerantie,
    },
    vastgoed: kerncijfers.vastgoed,
    huur,
  });

  const html = renderManagementRapportHtml(resultaat);
  const rapportenDir = administratieRapportenDir(root, administratieId);
  mkdirSync(rapportenDir, { recursive: true });
  const tijdstempel = new Date().toISOString().replace(/[:.]/g, "-");
  const pad = join(rapportenDir, `management-rapport-${opties.boekjaar}-${boekperiodeVan}-${opties.boekperiodeTotEnMet}-${tijdstempel}.html`);
  writeFileSync(pad, html, "utf-8");

  return { html, pad, resultaat };
}
