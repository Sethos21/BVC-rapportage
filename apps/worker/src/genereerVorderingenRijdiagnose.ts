import Decimal from "decimal.js";
import {
  selecteerVorderingenRijdiagnose,
  type VorderingRijDiagnoseRegel,
  type VorderingenRijdiagnoseOpties,
  type VorderingenRijdiagnoseResultaat,
} from "@bvc/reporting";
import { resolveBron } from "./sourceResolver.js";
import { ExcelBronAdapter } from "./bronAdapter.js";
import { leesAdministratieConfig } from "./administratie.js";

export interface VorderingenRijdiagnoseRapport extends VorderingenRijdiagnoseResultaat {
  administratieId: string;
  gegenereerdOp: string;
  bron: string;
}

const VS_AFGEB_PATROON = /^Afgeb_bedrag_vs(\d{1,2})$/i;
const VS_VORDERING_PATROON = /^Vordering_bedrag_vs(\d{1,2})$/i;

function tekst(v: unknown): string {
  return String(v ?? "").trim();
}

function tekstOfNull(v: unknown): string | null {
  const s = tekst(v);
  return s.length === 0 ? null : s;
}

function verzamelVsVelden(row: Record<string, unknown>, patroon: RegExp): Record<string, string> {
  const resultaat: Record<string, string> = {};
  for (const [kolom, waarde] of Object.entries(row)) {
    if (patroon.test(kolom)) resultaat[kolom] = tekst(waarde);
  }
  return resultaat;
}

function telNietNul(velden: Record<string, string>): number {
  return Object.values(velden).filter((w) => {
    if (w.length === 0) return false;
    try {
      return !new Decimal(w).isZero();
    } catch {
      return false;
    }
  }).length;
}

/**
 * Vertaalt één ruwe `vorderingen_met_afboekingen`-bronrij naar een
 * `VorderingRijDiagnoseRegel` — puur veldtoegang/tellen, GEEN
 * classificatie, GEEN wijziging van `VorderingMetAfboekingBronSchema`
 * (dat schema blijft ongewijzigd; dit is een aparte, tijdelijke
 * diagnoseweg die niet via de cache loopt).
 */
export function naarVorderingRijDiagnoseRegel(row: Record<string, unknown>): VorderingRijDiagnoseRegel {
  const afgebBedragVs = verzamelVsVelden(row, VS_AFGEB_PATROON);
  const vorderingBedragVs = verzamelVsVelden(row, VS_VORDERING_PATROON);
  const totaalbedrag = tekst(row["Vordering_Totaalbedrag"]);
  const afgeboekt = tekst(row["Bedrag_afgeboekt"]);
  const openstaand = tekst(row["Vordering_openstaand"]);
  const rekenverschil = new Decimal(totaalbedrag || "0").minus(new Decimal(afgeboekt || "0")).minus(new Decimal(openstaand || "0"));
  return {
    bedrijfsnr: tekst(row["Bedrijfsnr"]),
    huurdernr: tekst(row["Huurdernr"]),
    contractnr: tekst(row["Contractnr"]),
    complexnummer: tekst(row["Complexnummer"]),
    unitnummer: tekst(row["Unitnummer"]),
    factuurnummer: tekst(row["Factuurnummer"]),
    datumVordering: tekst(row["Datum_Vordering"]),
    vorderingBoekjaar: tekst(row["Vordering_Boekjaar"]),
    vorderingBoekperiode: tekst(row["Vordering_Boekperiode"]),
    omschrijvingVordering: tekst(row["Omschrijving_Vordering"]),
    vorderingTotaalbedrag: totaalbedrag,
    bedragAfgeboekt: afgeboekt,
    vorderingOpenstaand: openstaand,
    vorderingAfgehandeldDatum: tekstOfNull(row["Vordering_afgehandeld_datum"]),
    vorderingAfgehandeldJaar: tekstOfNull(row["Vordering_afgehandeld_jaar"]),
    vorderingAfgehandeldPeriode: tekstOfNull(row["Vordering_afgehandeld_periode"]),
    afgebBedragVs,
    vorderingBedragVs,
    aantalNietNulAfgebVsVelden: telNietNul(afgebBedragVs),
    aantalNietNulVorderingVsVelden: telNietNul(vorderingBedragVs),
    rekenverschilHuidigeStand: rekenverschil.toString(),
  };
}

/**
 * Read-only vorderingen-RIJdiagnose (2026-09-23) — leest het RUWE
 * `vorderingen_met_afboekingen`-bronbestand (niet de cache), filtert op
 * bedrijfsnr, en levert een klein aantal echte, samenhangende rijen in
 * vier observationele groepen (zie `selecteerVorderingenRijdiagnose`,
 * `@bvc/reporting`). Geen cache-wijziging, geen schrijfactie, geen
 * classificatie — uitsluitend bronbewijs voor de BRONGATE "Historische
 * Ouderdomsanalyse".
 */
export function genereerVorderingenRijdiagnose(
  root: string,
  administratieId: string,
  opties: VorderingenRijdiagnoseOpties = {},
): VorderingenRijdiagnoseRapport {
  const config = leesAdministratieConfig(root, administratieId);
  const bron = resolveBron(root, administratieId, "vorderingen_met_afboekingen");
  if (!bron.bestaat) {
    throw new Error(`Vorderingen_met_afboekingen-bronbestand niet gevonden op "${bron.pad}" — draai eerst rebuild-cache of controleer bronlocaties.json.`);
  }
  const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);
  const regels = ruweRijen
    .filter((row) => tekst(row["Bedrijfsnr"]) === config.bedrijfsnr)
    .map(naarVorderingRijDiagnoseRegel);

  const resultaat = selecteerVorderingenRijdiagnose(regels, opties);

  return {
    administratieId,
    gegenereerdOp: new Date().toISOString(),
    bron: bron.pad,
    ...resultaat,
  };
}
