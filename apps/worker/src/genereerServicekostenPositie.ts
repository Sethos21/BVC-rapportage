import Decimal from "decimal.js";
import { openCacheReadonly, selecteerBoekingen, selecteerServicekosten, type BoekingRow, type ServicekostenRow } from "@bvc/cache";
import { samenstelServicekostenPositie, type Servicekostenregel, type ServicekostenBoekingRegel, type ServicekostenPositieResultaat } from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { laadBeheerparameters } from "./parameters.js";

/**
 * Definitieve servicekostenmodule (v1, 2026-08-27) — orchestratie: selecteert
 * uit de al-herbouwde cache (`selecteerServicekosten`/`selecteerBoekingen`,
 * beide met exact dezelfde boekjaar/periodeVan/periodeTotEnMet) en geeft de
 * rijen door aan `samenstelServicekostenPositie` (`@bvc/reporting`), die
 * alle rekenlogica bevat. Deze functie rekent zelf niets uit.
 *
 * De doelrekeningen (bv. "1711"/"1712" bij 070) zijn een verplichte
 * PARAMETER — geen aanname hier of in de rekenlaag dat dit universeel geldt.
 * Nog GEEN koppeling aan management-rapport, geen renderer.
 */

export interface GenereerServicekostenPositieOpties {
  boekjaar: number;
  /** Standaard "01". */
  boekperiodeVan?: string | undefined;
  boekperiodeTotEnMet: string;
  doelrekeningen: string[];
}

function naarServicekostenregel(row: ServicekostenRow): Servicekostenregel {
  return {
    bedrijfsnr: row.bedrijfsnr,
    boekjaar: row.boekjaar,
    boekperiode: row.boekperiode,
    dagboeknummer: row.dagboeknummer,
    boekstuknummer: row.boekstuknummer,
    volgnummer: row.volgnummer,
    complexnummer: row.complexnummer,
    unitnummer: row.unitnummer,
    contractnummer: row.contractnummer,
    huurdernummer: row.huurdernummer,
    kostensoort: row.kostensoort,
    bedragDebet: new Decimal(row.bedrag_debet),
    bedragCredit: new Decimal(row.bedrag_credit),
    saldo: new Decimal(row.saldo),
    kostensoortSoort: row.kostensoort_soort,
    jaarSvAfrekening: row.jaar_sv_afrekening,
    huurderNaam: row.huurder_naam,
  };
}

function naarServicekostenBoekingRegel(row: BoekingRow): ServicekostenBoekingRegel {
  return {
    boekjaar: row.boekjaar,
    boekperiode: row.boekperiode,
    dagboeknr: row.dagboeknr,
    boekstuknr: row.boekstuknr,
    volgnr: row.volgnr,
    grootboeknr: row.grootboeknr,
    bedragDebet: new Decimal(row.bedrag_debet),
    bedragCredit: new Decimal(row.bedrag_credit),
    saldo: new Decimal(row.saldo),
  };
}

export function genereerServicekostenPositie(root: string, administratieId: string, opties: GenereerServicekostenPositieOpties): ServicekostenPositieResultaat {
  const boekperiodeVan = opties.boekperiodeVan ?? "01";
  const config = leesAdministratieConfig(root, administratieId);
  const beheerparameters = laadBeheerparameters(root);
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  let servicekosten: Servicekostenregel[];
  let boekingen: ServicekostenBoekingRegel[];
  try {
    const servicekostenRijen = db
      .prepare("SELECT * FROM servicekosten WHERE bedrijfsnr = ? AND boekjaar = ?")
      .all(config.bedrijfsnr, opties.boekjaar) as unknown as ServicekostenRow[];
    servicekosten = selecteerServicekosten(servicekostenRijen, {
      bedrijfsnr: config.bedrijfsnr,
      boekjaar: opties.boekjaar,
      boekperiodeVan,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    }).map(naarServicekostenregel);

    const boekingRijen = db
      .prepare("SELECT * FROM boekingen WHERE bedrijfsnr = ? AND boekjaar = ?")
      .all(config.bedrijfsnr, opties.boekjaar) as unknown as BoekingRow[];
    boekingen = selecteerBoekingen(boekingRijen, {
      bedrijfsnr: config.bedrijfsnr,
      boekjaar: opties.boekjaar,
      boekperiodeVan,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    }).map(naarServicekostenBoekingRegel);
  } finally {
    db.close();
  }

  return samenstelServicekostenPositie({
    administratieNaam: config.weergavenaam,
    bedrijfsnr: config.bedrijfsnr,
    boekjaar: opties.boekjaar,
    boekperiodeVan,
    boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    gegenereerdOp: new Date(),
    servicekosten,
    boekingen,
    doelrekeningen: opties.doelrekeningen,
    servicekostenParams: beheerparameters.servicekosten,
  });
}
