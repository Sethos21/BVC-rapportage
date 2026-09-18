import Decimal from "decimal.js";
import { openCacheReadonly } from "@bvc/cache";
import {
  diagnoseerOnderhoudBoekingen,
  type OnderhoudBoekingRegel,
  type OnderhoudBoekingenDiagnoseResultaat,
} from "@bvc/reporting";
import { resolveBron } from "./sourceResolver.js";
import { ExcelBronAdapter } from "./bronAdapter.js";
import { leesAdministratieConfig } from "./administratie.js";
import { administratieCachePad } from "./paths.js";

export interface GenereerOnderhoudBoekingenDiagnoseOpties {
  /** Grootboekrekeningen om op te filteren (bv. ["4300","4330","4340"]) — parameter, niet hardcoded. */
  grootboekrekeningen: string[];
  boekjaar: number;
  /** Standaard "01" — zelfde default-gedrag als elders in dit project. */
  boekperiodeVan?: string | undefined;
  boekperiodeTotEnMet: string;
}

function tekst(v: unknown): string {
  return String(v ?? "").trim();
}

function tekstOfNull(v: unknown): string | null {
  const s = tekst(v);
  return s.length === 0 ? null : s;
}

function naarOnderhoudBoekingRegel(row: Record<string, unknown>): OnderhoudBoekingRegel {
  const boekdatumRuw = row["Boeking_Boekdatum"];
  const boekdatum = boekdatumRuw !== undefined && boekdatumRuw !== null && tekst(boekdatumRuw).length > 0 ? new Date(String(boekdatumRuw)) : null;
  return {
    boekjaar: Number(tekst(row["Boeking_Boekjaar"])),
    boekperiode: tekst(row["Boeking_Boekperiode"]),
    boekdatum: boekdatum && !Number.isNaN(boekdatum.getTime()) ? boekdatum : null,
    boekstukSleutel: tekst(row["Boekstuk_Sleutel"]),
    dagboeknr: tekst(row["Boeking_Dagboeknr"]),
    dagboekomschrijving: tekstOfNull(row["Dagboekomschrijving"]),
    grootboeknr: tekst(row["Boeking_Grootboeknr"]),
    bedragDebet: new Decimal(tekst(row["Boeking_Bedrag_Debet"]) || "0"),
    bedragCredit: new Decimal(tekst(row["Boeking_Bedrag_Credit"]) || "0"),
    omschrijving: tekstOfNull(row["Boeking_Omschrijving"]),
    ogbKostensoort: tekstOfNull(row["Boeking_OGB_Kostensoort"]),
    ogbKostensoortOmschrijving: tekstOfNull(row["Boeking_OGB_Kostensoort_Omschr"]),
    complexnr: tekstOfNull(row["Boeking_Complexnr"]),
    factuurnr: tekstOfNull(row["Boeking_Factuurnr"]) ?? tekstOfNull(row["Factuur_Factuurnr"]),
    relatienr: tekstOfNull(row["Factuur_Relatienr"]),
    relatienaam: tekstOfNull(row["Factuur_Relatie_Naam_1"]),
  };
}

/**
 * Gerichte, TIJDELIJKE, ALLEEN-LEZEN vervolgdiagnose op `boekingen-bronkolommen`
 * (2026-09-02): leest de RUWE boekingen-bron (niet de cache — de cache kent
 * `Boeking_OGB_Kostensoort`/`Boeking_OGB_Kostensoort_Omschr` nog niet, dat
 * zijn niet-gemodelleerde kolommen), filtert op bedrijfsnr + boekjaar +
 * periode + een expliciete lijst grootboekrekeningen, en levert zowel de
 * line-level regels als aggregaties (per grootboekrekening, grootboek x
 * OGB-kostensoort-matrix, per complex) op — puur bronbewijs verzamelen om
 * te bepalen of OGB-kostensoort een bruikbare exploitatiekostensoort-
 * dimensie is. Bouwt GEEN begrotingscode, GEEN mappingwijziging, GEEN
 * classificatie — zie `diagnoseerOnderhoudBoekingen` (`@bvc/reporting`)
 * voor de pure aggregatielogica.
 *
 * `bekendeComplexnummers` komt uit de al-herbouwde cache (`units`-tabel) —
 * dat is de authoritative complexbron; complexomschrijving wordt hier
 * bewust niet gebruikt als sleutel (alleen als presentatielabel elders).
 */
export function genereerOnderhoudBoekingenDiagnose(
  root: string,
  administratieId: string,
  opties: GenereerOnderhoudBoekingenDiagnoseOpties,
): OnderhoudBoekingenDiagnoseResultaat {
  const boekperiodeVan = opties.boekperiodeVan ?? "01";
  const config = leesAdministratieConfig(root, administratieId);
  const doelrekeningen = new Set(opties.grootboekrekeningen.map((r) => r.trim()));

  const bron = resolveBron(root, administratieId, "boekingen");
  if (!bron.bestaat) {
    throw new Error(`Boekingen-bronbestand niet gevonden op "${bron.pad}" — draai eerst rebuild-cache of controleer bronlocaties.json.`);
  }
  const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);

  const regels = ruweRijen
    .filter((row) => tekst(row["Bedrijfsnr"]) === config.bedrijfsnr)
    .filter((row) => Number(tekst(row["Boeking_Boekjaar"])) === opties.boekjaar)
    .filter((row) => {
      const periode = tekst(row["Boeking_Boekperiode"]);
      return periode >= boekperiodeVan && periode <= opties.boekperiodeTotEnMet;
    })
    .filter((row) => doelrekeningen.has(tekst(row["Boeking_Grootboeknr"])))
    .map(naarOnderhoudBoekingRegel);

  const db = openCacheReadonly(administratieCachePad(root, administratieId));
  let bekendeComplexnummers: string[];
  try {
    const rijen = db
      .prepare("SELECT DISTINCT complexnummer FROM units WHERE bedrijfsnr = ?")
      .all(config.bedrijfsnr) as unknown as { complexnummer: string }[];
    bekendeComplexnummers = rijen.map((r) => r.complexnummer);
  } finally {
    db.close();
  }

  return diagnoseerOnderhoudBoekingen(regels, bekendeComplexnummers);
}
