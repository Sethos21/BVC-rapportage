import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { openCacheReadonly, selecteerBoekingen, type BalansstandRow, type BoekingRow } from "@bvc/cache";
import type { Balansstand, Boekingsregel } from "@bvc/domain";
import {
  berekenKasstroomManagementoverzicht,
  berekenTopOverigeUitgaven,
  renderKasstroomManagementoverzichtHtml,
  vergelijkKasstroomManagementoverzichtMetVerwacht,
  type KasstroomManagementoverzichtInvoer,
  type KasstroomManagementoverzichtResultaat,
  type KasstroomManagementoverzichtVergelijkingsResultaat,
  type KasstroomManagementoverzichtVerwacht,
  type KasstroomTopUitgaveRegel,
} from "@bvc/reporting";
import { administratieCachePad, administratieRapportenDir } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { leesGrootboekMapping } from "./grootboekmapping.js";
import { naarBalansstand, naarBoekingsregel } from "./rowMappers.js";

/**
 * Bouwt het (vereenvoudigde) Kasstroom-managementoverzicht (`@bvc/reporting`'s
 * `berekenKasstroomManagementoverzicht`) uit de al-herbouwde cache van één
 * administratie, en schrijft het weg naar `rapporten/` (zelfde patroon als
 * `genereerRapportPeriode.ts`/`genereerControlerapport.ts`).
 *
 * Optionele `--verwacht`-vergelijking (zelfde rol als `pl-periode`'s
 * `--verwacht`): legt een eerder handmatig geverifieerde uitkomst vast als
 * regressiepunt. Zie `packages/reporting/README.md` "Kasstroom" — voor
 * 070_Rooise_Zoom boekjaar 2026 t/m periode 06 is dit reeds gedaan.
 */

export interface GenereerKasstroomManagementoverzichtOpties {
  boekjaar: number;
  boekperiodeTotEnMet: string;
  verwachtePad?: string | undefined;
  toleranceEuro?: Decimal | undefined;
}

export interface GenereerKasstroomManagementoverzichtResultaat {
  html: string;
  pad: string;
  resultaat: KasstroomManagementoverzichtResultaat;
  topOverigeUitgaven: readonly KasstroomTopUitgaveRegel[];
  vergelijking?: KasstroomManagementoverzichtVergelijkingsResultaat;
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

    const resultaat = berekenKasstroomManagementoverzicht(balansstanden, boekingsregels, mapping.regels);
    const topOverigeUitgaven = berekenTopOverigeUitgaven(boekingsregels, mapping.regels);

    const invoer: KasstroomManagementoverzichtInvoer = {
      administratieNaam: config.weergavenaam,
      bedrijfsnr: config.bedrijfsnr,
      boekjaar: opties.boekjaar,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
      gegenereerdOp: new Date(),
      resultaat,
      topOverigeUitgaven,
    };

    const html = renderKasstroomManagementoverzichtHtml(invoer);
    const rapportenDir = administratieRapportenDir(root, administratieId);
    mkdirSync(rapportenDir, { recursive: true });
    const tijdstempel = new Date().toISOString().replace(/[:.]/g, "-");
    const pad = join(rapportenDir, `kasstroom-managementoverzicht-${opties.boekjaar}-${opties.boekperiodeTotEnMet}-${tijdstempel}.html`);
    writeFileSync(pad, html, "utf-8");

    if (!opties.verwachtePad) {
      return { html, pad, resultaat, topOverigeUitgaven };
    }

    const verwacht = leesKasstroomManagementoverzichtVerwacht(opties.verwachtePad);
    const vergelijking = vergelijkKasstroomManagementoverzichtMetVerwacht(resultaat, verwacht, opties.toleranceEuro ?? new Decimal("0.01"));
    return { html, pad, resultaat, topOverigeUitgaven, vergelijking };
  } finally {
    db.close();
  }
}

/**
 * Leest een handmatig aangeleverd bestand met een eerder geverifieerde
 * kasstroom-managementoverzicht-uitkomst (regressiepunt). Vaste velden
 * (geen dynamische rapportagepost-lijst zoals bij pl-periode, dit
 * overzicht heeft een klein vast aantal KPI's + vier kwartalen) — elk
 * bedrag als string. Geen zelfbedachte standaardlocatie in de data root —
 * ad-hoc invoer per vergelijking, geen permanente config. Faalt hard op
 * een ongeldig bestand (geen stilzwijgende correctie).
 */
function leesKasstroomManagementoverzichtVerwacht(pad: string): KasstroomManagementoverzichtVerwacht {
  const ruw: unknown = JSON.parse(readFileSync(pad, "utf-8"));
  if (typeof ruw !== "object" || ruw === null || Array.isArray(ruw)) {
    throw new Error(`Verwachte-kasstroombestand (${pad}) moet een JSON-object zijn met bankstandBegin/bankstandEind/ontvangsten/uitgaven/nettoKasstroom/eigenaarOnttrekkingen/overigeUitgaven/perKwartaal.`);
  }
  const veld = ruw as Record<string, unknown>;
  const bedrag = (naam: string): Decimal => {
    const waarde = veld[naam];
    if (typeof waarde !== "string") throw new Error(`Verwachte-kasstroombestand (${pad}): veld "${naam}" ontbreekt of is geen string-bedrag.`);
    return new Decimal(waarde);
  };
  const perKwartaalRuw = veld["perKwartaal"];
  if (!Array.isArray(perKwartaalRuw) || perKwartaalRuw.length !== 4) {
    throw new Error(`Verwachte-kasstroombestand (${pad}): "perKwartaal" moet een array van precies 4 kwartaalregels zijn.`);
  }
  const perKwartaal = perKwartaalRuw.map((regelRuw, index) => {
    if (typeof regelRuw !== "object" || regelRuw === null) throw new Error(`Verwachte-kasstroombestand (${pad}): perKwartaal[${index}] moet een object zijn.`);
    const kwRegel = regelRuw as Record<string, unknown>;
    const kwBedrag = (naam: string): Decimal => {
      const waarde = kwRegel[naam];
      if (typeof waarde !== "string") throw new Error(`Verwachte-kasstroombestand (${pad}): perKwartaal[${index}].${naam} ontbreekt of is geen string-bedrag.`);
      return new Decimal(waarde);
    };
    const kwartaalRuw = kwRegel["kwartaal"];
    const kwartaal: 1 | 2 | 3 | 4 | undefined = kwartaalRuw === 1 ? 1 : kwartaalRuw === 2 ? 2 : kwartaalRuw === 3 ? 3 : kwartaalRuw === 4 ? 4 : undefined;
    if (kwartaal === undefined) {
      throw new Error(`Verwachte-kasstroombestand (${pad}): perKwartaal[${index}].kwartaal moet 1, 2, 3 of 4 zijn.`);
    }
    return { kwartaal, ontvangsten: kwBedrag("ontvangsten"), uitgaven: kwBedrag("uitgaven"), eigenaarOnttrekkingen: kwBedrag("eigenaarOnttrekkingen"), nettoKasstroom: kwBedrag("nettoKasstroom") };
  });

  return {
    bankstandBegin: bedrag("bankstandBegin"),
    bankstandEind: bedrag("bankstandEind"),
    ontvangsten: bedrag("ontvangsten"),
    uitgaven: bedrag("uitgaven"),
    nettoKasstroom: bedrag("nettoKasstroom"),
    eigenaarOnttrekkingen: bedrag("eigenaarOnttrekkingen"),
    overigeUitgaven: bedrag("overigeUitgaven"),
    perKwartaal,
  };
}
