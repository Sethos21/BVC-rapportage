import Decimal from "decimal.js";

/**
 * Contract/huurder-diagnose (2026-08-27) — TIJDELIJK, ALLEEN-LEZEN: zet per
 * contract alle bronnen die potentieel relevant zijn voor een toekomstig
 * Huurdersoverzicht naast elkaar (contracten, rentroll, ouderdomsanalyse,
 * servicekosten-voorschotten, en een aantal nog NIET gemodelleerde raw
 * contracten-kolommen zoals Waarborgsom, Verhoging_datum en Datum_laatst_geprolongreerd).
 *
 * GEEN classificatie, GEEN keuze van een "authoritative" einddatum, GEEN
 * business-regel, GEEN aanname dat rentroll.service_voorschot_jaar en
 * servicekosten-geboekte-voorschotten dezelfde grootheid zijn — dit
 * instrument toont uitsluitend, laat de mens vergelijken. Alles waar geen
 * deterministische 1-op-1 koppeling voor bestaat blijft een array (nooit
 * een eerste/beste/toevallige match kiezen).
 */

export interface ChdContractRegel {
  bedrijfsnr: string;
  contractnummer: string;
  complexnummer: string | null;
  unitnummer: string | null;
  huurdernummer: string | null;
  ingangsdatum: Date | null;
  afloopdatum: Date | null;
  checkLopendContract: string | null;
  expiratieExpiratiedatum: Date | null;
  expiratieOpzegdatum: Date | null;
}

export interface ChdRentrollRegel {
  contractnummer: string;
  vorderingsoort: string;
  complexnummer: string | null;
  unitnummer: string | null;
  prolongatieBedragJaar: Decimal | null;
  kortingBedragJaar: Decimal | null;
  serviceVoorschotJaar: Decimal | null;
  gehuurdOppervlak: Decimal | null;
  rapportageDatum: Date | null;
  contractExpiratiedatum: Date | null;
  contractOpzegdatum: Date | null;
}

export interface ChdOuderdomsanalyseRegel {
  huurdernr: string;
  boekjaar: number;
  boekperiode: string;
  peildatum: Date;
  achterstand: Decimal;
  vooruitbetaling: Decimal;
  saldo: Decimal;
}

/** Eén regel uit servicekostenPositie's `voorschottenPerContractHuurder` (A. actuele positie) — geboekt, periodegebonden. */
export interface ChdServicekostenVoorschotRegel {
  complexnummer: string | null;
  unitnummer: string | null;
  contractnummer: string | null;
  huurdernummer: string | null;
  saldo: Decimal;
}

/**
 * Eén ruwe rij uit contracten_huidig.xlsx die hetzelfde `Contract`-nummer
 * heeft — ongeacht bedrijfsnr. `contracten_huidig.xlsx` is een GEDEELD
 * bronbestand over alle administraties; `Contract` is uitsluitend uniek
 * binnen een administratie (zie `contractNatuurlijkeSleutel`'s
 * `bedrijfsnr::contract`-sleutel in data-contracts). Puur diagnostisch: als
 * hier meer dan 1 regel staat, of een regel met een ANDER bedrijfsnr dan
 * het contract dat wordt onderzocht, is dat een zichtbare botsing.
 */
export interface ChdRuweContractnummerBotsing {
  bedrijfsnr: string;
  huurderNaam1: string | null;
  complexomschrijving: string | null;
  waarborgsom: string | null;
}

/** Nog NIET gemodelleerde/gecachte contracten-bronkolommen — rechtstreeks uit het ruwe bronbestand, puur als tekst (geen coercion behalve wat de aanroeper zelf toepast). */
export interface ChdRuweContractvelden {
  waarborgsom: string | null;
  waarborgNietGeprolongeerd: string | null;
  waarborgbeheer: string | null;
  complexomschrijving: string | null;
  huurderNaam1: string | null;
  datumLaatstGeprolongeerd: Date | null;
  jaarLaatstGeprolongeerd: string | null;
  periodeLaatstGeprolongeerd: string | null;
  verhogingDatum: Date | null;
  verhogingJaarVolgend: string | null;
  verhogingPeriodeVolgend: string | null;
  verhogingPercentage: string | null;
  verhogingMethode: string | null;
  omschrijvingIndextabel: string | null;
}

export interface ChdRegel {
  bedrijfsnr: string;
  contractnummer: string;
  complexnummer: string | null;
  unitnummer: string | null;
  huurdernummer: string | null;
  contract: ChdContractRegel;
  /** `null` = geen ruwe rij gevonden voor DIT bedrijfsnr + contractnummer (nooit verwacht, wel expliciet zichtbaar als het toch gebeurt). */
  ruweContractvelden: ChdRuweContractvelden | null;
  /** Alle ruwe contracten_huidig-rijen (any bedrijfsnr) met hetzelfde `Contract`-nummer — puur diagnostisch, om een botsing tussen administraties zichtbaar te maken (zie ChdRuweContractnummerBotsing). */
  alleRuweRijenMetDitContractnummer: ChdRuweContractnummerBotsing[];
  /** Alle rentroll-regels voor dit contract (0..n, één per Vorderingsoort) — geen classificatie/optelling. */
  rentrollRegels: ChdRentrollRegel[];
  /** Alle ouderdomsanalyse-regels voor het huurdernummer van dit contract, over alle in de cache aanwezige boekjaar/boekperiodes — leeg als huurdernummer onbekend of geen match. */
  ouderdomsanalyse: ChdOuderdomsanalyseRegel[];
  /** Servicekostenvoorschot-regel(s) die op dit contractnummer matchen, voor de door de aanroeper opgegeven periode — leeg als geen periode is opgegeven of geen match. */
  servicekostenVoorschot: ChdServicekostenVoorschotRegel[];
}

export interface ChdResultaat {
  servicekostenPeriode: { boekjaar: number; boekperiodeVan: string; boekperiodeTotEnMet: string } | null;
  contracten: ChdRegel[];
  aantalContractenZonderRuweMatch: number;
  aantalRentrollRegelsZonderContractmatch: number;
  aantalOuderdomsanalyseRegelsZonderHuurdermatch: number;
}

/** `bedrijfsnr::contractnummer` — dezelfde compound-sleutelconventie als `contractNatuurlijkeSleutel` (data-contracts), verplicht omdat `Contract` uitsluitend uniek is binnen een administratie in het gedeelde contracten_huidig-bestand. */
export function ruweContractSleutel(bedrijfsnr: string, contractnummer: string): string {
  return [bedrijfsnr, contractnummer].join("::");
}

export function diagnoseerContractHuurder(
  contracten: readonly ChdContractRegel[],
  rentroll: readonly ChdRentrollRegel[],
  ouderdomsanalyse: readonly ChdOuderdomsanalyseRegel[],
  /** Sleutel: `ruweContractSleutel(bedrijfsnr, contractnummer)` — NOOIT alleen contractnummer (zie moduledoc/ChdRuweContractnummerBotsing). */
  ruweContractvelden: ReadonlyMap<string, ChdRuweContractvelden>,
  /** Sleutel: uitsluitend contractnummer — alle ruwe rijen (elk bedrijfsnr) met dat nummer, voor botsingsdiagnose. */
  alleRuweRijenPerContractnummer: ReadonlyMap<string, readonly ChdRuweContractnummerBotsing[]>,
  servicekostenVoorschotten: readonly ChdServicekostenVoorschotRegel[],
  servicekostenPeriode: { boekjaar: number; boekperiodeVan: string; boekperiodeTotEnMet: string } | null,
): ChdResultaat {
  const rentrollPerContract = new Map<string, ChdRentrollRegel[]>();
  for (const regel of rentroll) {
    const groep = rentrollPerContract.get(regel.contractnummer) ?? [];
    groep.push(regel);
    rentrollPerContract.set(regel.contractnummer, groep);
  }

  const ouderdomsanalysePerHuurder = new Map<string, ChdOuderdomsanalyseRegel[]>();
  for (const regel of ouderdomsanalyse) {
    const groep = ouderdomsanalysePerHuurder.get(regel.huurdernr) ?? [];
    groep.push(regel);
    ouderdomsanalysePerHuurder.set(regel.huurdernr, groep);
  }

  const voorschotPerContract = new Map<string, ChdServicekostenVoorschotRegel[]>();
  for (const regel of servicekostenVoorschotten) {
    if (regel.contractnummer === null) continue;
    const groep = voorschotPerContract.get(regel.contractnummer) ?? [];
    groep.push(regel);
    voorschotPerContract.set(regel.contractnummer, groep);
  }

  const contractnummers = new Set(contracten.map((c) => c.contractnummer));

  const chdRegels: ChdRegel[] = contracten.map((contract) => ({
    bedrijfsnr: contract.bedrijfsnr,
    contractnummer: contract.contractnummer,
    complexnummer: contract.complexnummer,
    unitnummer: contract.unitnummer,
    huurdernummer: contract.huurdernummer,
    contract,
    ruweContractvelden: ruweContractvelden.get(ruweContractSleutel(contract.bedrijfsnr, contract.contractnummer)) ?? null,
    alleRuweRijenMetDitContractnummer: [...(alleRuweRijenPerContractnummer.get(contract.contractnummer) ?? [])],
    rentrollRegels: rentrollPerContract.get(contract.contractnummer) ?? [],
    ouderdomsanalyse: contract.huurdernummer !== null ? (ouderdomsanalysePerHuurder.get(contract.huurdernummer) ?? []) : [],
    servicekostenVoorschot: voorschotPerContract.get(contract.contractnummer) ?? [],
  }));

  return {
    servicekostenPeriode,
    contracten: chdRegels,
    aantalContractenZonderRuweMatch: chdRegels.filter((r) => r.ruweContractvelden === null).length,
    aantalRentrollRegelsZonderContractmatch: rentroll.filter((r) => !contractnummers.has(r.contractnummer)).length,
    aantalOuderdomsanalyseRegelsZonderHuurdermatch: ouderdomsanalyse.filter(
      (r) => !contracten.some((c) => c.huurdernummer === r.huurdernr),
    ).length,
  };
}
