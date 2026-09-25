import Decimal from "decimal.js";

/**
 * Read-only vorderingen-RIJdiagnose (2026-09-23) — vervolg op
 * `vorderingenBronKolommenDiagnose.ts` (die uitsluitend kolomstatistieken
 * levert, zonder rijverband). Doel: een klein aantal ECHTE,
 * SAMENHANGENDE bronrijen uit `vorderingen_met_afboekingen` tonen, zodat
 * `Vordering_afgehandeld_datum` en de afboekingsvelden per vordering
 * (niet per kolom los) beoordeeld kunnen worden vóór een eventuele
 * historische Ouderdomsanalyse wordt ontworpen.
 *
 * Bouwt bewust GEEN Ouderdomsanalyse, GEEN aging, GEEN vervaldatum-/
 * betaaldatum-berekening, GEEN classificatie van VS1..VS20 (die blijven
 * pure, ongeïnterpreteerde bronwaarden). De vier selectiegroepen (A-D)
 * zijn uitsluitend diagnostische filters op reeds aanwezige ruwe
 * bronvelden — geen nieuwe businessregel, geen vastlegging van
 * tekenconventie (CLAUDE.md §6 blijft van toepassing op elke toekomstige
 * ECHTE berekening, niet op deze diagnose).
 */

export interface VorderingRijDiagnoseRegel {
  bedrijfsnr: string;
  huurdernr: string;
  contractnr: string;
  complexnummer: string;
  unitnummer: string;
  factuurnummer: string;
  datumVordering: string;
  vorderingBoekjaar: string;
  vorderingBoekperiode: string;
  omschrijvingVordering: string;
  vorderingTotaalbedrag: string;
  bedragAfgeboekt: string;
  vorderingOpenstaand: string;
  vorderingAfgehandeldDatum: string | null;
  vorderingAfgehandeldJaar: string | null;
  vorderingAfgehandeldPeriode: string | null;
  /** Ruwe VS-componentbedragen, alleen de kolommen die in de bron daadwerkelijk bestaan — GEEN businessbetekenis toegekend. */
  afgebBedragVs: Record<string, string>;
  vorderingBedragVs: Record<string, string>;
  /** Puur diagnostisch aantal — GEEN uitspraak over aantal deelbetalingen. */
  aantalNietNulAfgebVsVelden: number;
  aantalNietNulVorderingVsVelden: number;
  /** Vordering_Totaalbedrag - Bedrag_afgeboekt - Vordering_openstaand, als tekenconventie-neutrale controlewaarde. */
  rekenverschilHuidigeStand: string;
}

export interface VorderingenRijdiagnoseGroepen {
  volledigOpenKandidaten: VorderingRijDiagnoseRegel[];
  volledigAfgehandeldKandidaten: VorderingRijDiagnoseRegel[];
  gedeeltelijkAfgeboektKandidaten: VorderingRijDiagnoseRegel[];
  afgehandeldNaPeildatumKandidaten: VorderingRijDiagnoseRegel[];
}

export interface VorderingenRijdiagnoseResultaat {
  aantalOnderzochteRijen: number;
  /** dd-mm-jjjj — puur het diagnostische afkappunt voor groep D, geen persisted businessregel. */
  peildatum: string;
  groepen: VorderingenRijdiagnoseGroepen;
}

export interface VorderingenRijdiagnoseOpties {
  peildatum?: Date;
  maxVolledigOpen?: number;
  maxVolledigAfgehandeld?: number;
  maxGedeeltelijkAfgeboekt?: number;
  maxAfgehandeldNaPeildatum?: number;
}

const STANDAARD_PEILDATUM = new Date(2026, 5, 30);

const DATUM_PATROON = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;

function parseDatum(waarde: string | null): Date | null {
  if (!waarde) return null;
  const match = DATUM_PATROON.exec(waarde);
  if (!match) return null;
  const [, dag, maand, jaar] = match;
  const datum = new Date(Number(jaar), Number(maand) - 1, Number(dag));
  return Number.isNaN(datum.getTime()) ? null : datum;
}

function formatteerDatum(datum: Date): string {
  const dag = String(datum.getDate()).padStart(2, "0");
  const maand = String(datum.getMonth() + 1).padStart(2, "0");
  return `${dag}-${maand}-${datum.getFullYear()}`;
}

function getal(waarde: string): Decimal {
  return new Decimal(waarde.length === 0 ? "0" : waarde);
}

/**
 * Selecteert een klein aantal representatieve, echte rijen (deterministisch:
 * de eerste N in bronvolgorde die aan het criterium voldoen — geen
 * statistische steekproef) in vier observationele groepen. Elke groep is
 * uitsluitend een filter voor menselijke beoordeling, geen classificatie.
 */
export function selecteerVorderingenRijdiagnose(
  regels: readonly VorderingRijDiagnoseRegel[],
  opties: VorderingenRijdiagnoseOpties = {},
): VorderingenRijdiagnoseResultaat {
  const peildatum = opties.peildatum ?? STANDAARD_PEILDATUM;
  const maxA = opties.maxVolledigOpen ?? 5;
  const maxB = opties.maxVolledigAfgehandeld ?? 5;
  const maxC = opties.maxGedeeltelijkAfgeboekt ?? 10;
  const maxD = opties.maxAfgehandeldNaPeildatum ?? 5;

  const volledigOpenKandidaten = regels.filter((r) => getal(r.bedragAfgeboekt).isZero()).slice(0, maxA);

  const volledigAfgehandeldAlle = regels.filter((r) => getal(r.vorderingOpenstaand).isZero());
  const volledigAfgehandeldMetDatum = volledigAfgehandeldAlle.filter((r) => r.vorderingAfgehandeldDatum !== null);
  const volledigAfgehandeldZonderDatum = volledigAfgehandeldAlle.filter((r) => r.vorderingAfgehandeldDatum === null);
  const volledigAfgehandeldKandidaten = [...volledigAfgehandeldMetDatum, ...volledigAfgehandeldZonderDatum].slice(0, maxB);

  const gedeeltelijkAfgeboektKandidaten = regels
    .filter((r) => {
      const afgeboekt = getal(r.bedragAfgeboekt).abs();
      const totaal = getal(r.vorderingTotaalbedrag).abs();
      const openstaand = getal(r.vorderingOpenstaand);
      return afgeboekt.greaterThan(0) && afgeboekt.lessThan(totaal) && !openstaand.isZero();
    })
    .slice(0, maxC);

  const afgehandeldNaPeildatumKandidaten = regels
    .filter((r) => {
      const vorderingDatum = parseDatum(r.datumVordering);
      const afgehandeld = parseDatum(r.vorderingAfgehandeldDatum);
      return (
        vorderingDatum !== null &&
        vorderingDatum.getTime() <= peildatum.getTime() &&
        afgehandeld !== null &&
        afgehandeld.getTime() > peildatum.getTime()
      );
    })
    .slice(0, maxD);

  return {
    aantalOnderzochteRijen: regels.length,
    peildatum: formatteerDatum(peildatum),
    groepen: {
      volledigOpenKandidaten,
      volledigAfgehandeldKandidaten,
      gedeeltelijkAfgeboektKandidaten,
      afgehandeldNaPeildatumKandidaten,
    },
  };
}
