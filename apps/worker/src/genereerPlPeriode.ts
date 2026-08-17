import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { openCacheReadonly, selecteerBoekingen, type BoekingRow } from "@bvc/cache";
import type { Boekingsregel } from "@bvc/domain";
import { berekenPlPeriode, vergelijkMetGereconcilieerd, type PlPeriodeResultaat, type PlPeriodeVergelijkingsResultaat } from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { leesGrootboekMapping } from "./grootboekmapping.js";

/**
 * Draait de P&L-periodeberekening (`@bvc/reporting`'s `berekenPlPeriode`)
 * tegen de al-herbouwde cache van één administratie, met expliciete
 * periodeselectie (`@bvc/cache`'s `selecteerBoekingen`) en de goedgekeurde
 * grootboekmapping. Bewust GEEN renderer/HTML — dit levert de rekenkern +
 * optioneel een automatische vergelijking met eerder handmatig
 * gereconcilieerde bedragen; het volledige P&L-rapport is een latere,
 * losse bouwstap.
 */

export interface GenereerPlPeriodeOpties {
  boekjaar: number;
  boekperiodeVan?: string | undefined;
  boekperiodeTotEnMet?: string | undefined;
  /** Pad naar een JSON-bestand { "<rapportagepost>": "<bedrag>" } met eerder handmatig gereconcilieerde bedragen. */
  verwachtePad?: string | undefined;
  /** Standaard €0,01 (PAR-CTRL-002 pilot-startwaarde), zie @bvc/domain's bankaansluiting/boekstukcontrole. */
  toleranceEuro?: Decimal | undefined;
}

export interface GenereerPlPeriodeResultaat {
  resultaat: PlPeriodeResultaat;
  vergelijking?: PlPeriodeVergelijkingsResultaat;
}

export function genereerPlPeriode(root: string, administratieId: string, opties: GenereerPlPeriodeOpties): GenereerPlPeriodeResultaat {
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
      boekperiodeVan: opties.boekperiodeVan,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    });

    const boekingsregels: Boekingsregel[] = geselecteerd.map(naarBoekingsregel);
    const resultaat = berekenPlPeriode(boekingsregels, mapping.regels);

    if (!opties.verwachtePad) {
      return { resultaat };
    }

    const verwachtePerPost = leesVerwachtePerRapportagepost(opties.verwachtePad);
    const vergelijking = vergelijkMetGereconcilieerd(resultaat, verwachtePerPost, opties.toleranceEuro ?? new Decimal("0.01"));
    return { resultaat, vergelijking };
  } finally {
    db.close();
  }
}

function naarBoekingsregel(row: BoekingRow): Boekingsregel {
  return {
    bedrijfsnr: row.bedrijfsnr,
    boekjaar: row.boekjaar,
    dagboeknr: row.dagboeknr,
    boekstuknr: row.boekstuknr,
    volgnr: row.volgnr,
    boekstukSleutel: row.boekstuk_sleutel,
    grootboeknr: row.grootboeknr,
    boekdatum: new Date(row.boekdatum),
    omschrijving: row.omschrijving ?? "",
    bedragDebet: new Decimal(row.bedrag_debet),
    bedragCredit: new Decimal(row.bedrag_credit),
    complexnr: row.complexnr ?? undefined,
    unitnr: row.unitnr ?? undefined,
    contractnr: row.contractnr ?? undefined,
  };
}

/**
 * Leest een handmatig aangeleverd bestand met eerder gereconcilieerde
 * bedragen: `{ "<rapportagepost>": "<bedrag>" }`. Geen zelfbedachte
 * standaardlocatie/-formaat in de data root — dit is ad-hoc invoer per
 * vergelijking, geen permanente config. Faalt hard op een ongeldig bestand
 * (geen stilzwijgende correctie).
 */
function leesVerwachtePerRapportagepost(pad: string): Map<string, Decimal> {
  const ruw: unknown = JSON.parse(readFileSync(pad, "utf-8"));
  if (typeof ruw !== "object" || ruw === null || Array.isArray(ruw)) {
    throw new Error(`Verwachte-bedragenbestand (${pad}) moet een JSON-object zijn van rapportagepost naar bedrag.`);
  }
  const resultaat = new Map<string, Decimal>();
  for (const [rapportagepost, waarde] of Object.entries(ruw as Record<string, unknown>)) {
    if (typeof waarde !== "string" && typeof waarde !== "number") {
      throw new Error(`Verwachte-bedragenbestand (${pad}): waarde voor "${rapportagepost}" moet een getal/string zijn, kreeg ${typeof waarde}.`);
    }
    resultaat.set(rapportagepost, new Decimal(waarde));
  }
  return resultaat;
}
