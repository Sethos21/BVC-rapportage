import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { openCacheReadonly, selecteerBoekingen, type BoekingRow } from "@bvc/cache";
import type { Boekingsregel, OnbekendOf } from "@bvc/domain";
import { berekenPlPeriode, vergelijkMetGereconcilieerd, type PlPeriodeResultaat, type PlPeriodeVergelijkingsResultaat } from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { leesGrootboekMapping } from "./grootboekmapping.js";
import { naarBoekingsregel } from "./rowMappers.js";

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
  /**
   * Pad naar een JSON-bestand met eerder handmatig gereconcilieerde
   * bedragen per rapportagepost, zie `leesVerwachtePerRapportagepost`
   * hieronder voor het exacte formaat.
   */
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

/**
 * Leest een handmatig aangeleverd bestand met eerder gereconcilieerde
 * bedragen per rapportagepost. Elke waarde is een `OnbekendOf<Decimal>` in
 * JSON-vorm:
 *
 *   { "<rapportagepost>": { "type": "bekend", "waarde": "<bedrag>" } }
 *   { "<rapportagepost>": { "type": "onbekend", "reden": "<toelichting>" } }
 *
 * Een `"onbekend"`-regel betekent: het verwachte bedrag voor déze periode
 * is bewust nog niet bekend/van toepassing (bv. een post die pas aan het
 * einde van het boekjaar wordt bepaald en geboekt) — `@bvc/reporting`'s
 * `vergelijkMetGereconcilieerd` zet zo'n regel in `nogNietBekend`, nooit in
 * `ontbrekendInBerekening`. Dit is bewust generiek: de beslissing "welke
 * rapportagepost is nu nog onbekend" staat in de databestand-inhoud, niet
 * als hardcoded uitzondering in code (CLAUDE.md §3).
 *
 * Geen zelfbedachte standaardlocatie in de data root — dit is ad-hoc invoer
 * per vergelijking, geen permanente config. Faalt hard op een ongeldig
 * bestand (geen stilzwijgende correctie).
 */
function leesVerwachtePerRapportagepost(pad: string): Map<string, OnbekendOf<Decimal>> {
  const ruw: unknown = JSON.parse(readFileSync(pad, "utf-8"));
  if (typeof ruw !== "object" || ruw === null || Array.isArray(ruw)) {
    throw new Error(`Verwachte-bedragenbestand (${pad}) moet een JSON-object zijn van rapportagepost naar { type, waarde|reden }.`);
  }
  const resultaat = new Map<string, OnbekendOf<Decimal>>();
  for (const [rapportagepost, waarde] of Object.entries(ruw as Record<string, unknown>)) {
    if (typeof waarde !== "object" || waarde === null || Array.isArray(waarde)) {
      throw new Error(
        `Verwachte-bedragenbestand (${pad}): waarde voor "${rapportagepost}" moet een object zijn ({"type":"bekend","waarde":...} of {"type":"onbekend","reden":...}), kreeg ${typeof waarde}.`,
      );
    }
    const entry = waarde as Record<string, unknown>;
    if (entry["type"] === "bekend") {
      const bedrag = entry["waarde"];
      if (typeof bedrag !== "string" && typeof bedrag !== "number") {
        throw new Error(`Verwachte-bedragenbestand (${pad}): "${rapportagepost}".waarde moet een getal/string zijn, kreeg ${typeof bedrag}.`);
      }
      resultaat.set(rapportagepost, { type: "bekend", waarde: new Decimal(bedrag) });
    } else if (entry["type"] === "onbekend") {
      const reden = entry["reden"];
      if (typeof reden !== "string") {
        throw new Error(`Verwachte-bedragenbestand (${pad}): "${rapportagepost}".reden moet een string zijn, kreeg ${typeof reden}.`);
      }
      resultaat.set(rapportagepost, { type: "onbekend", reden });
    } else {
      throw new Error(`Verwachte-bedragenbestand (${pad}): "${rapportagepost}".type moet "bekend" of "onbekend" zijn, kreeg ${JSON.stringify(entry["type"])}.`);
    }
  }
  return resultaat;
}
