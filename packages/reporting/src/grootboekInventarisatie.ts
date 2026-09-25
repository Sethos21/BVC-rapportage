import Decimal from "decimal.js";

/**
 * Diagnostisch, alleen-lezen overzicht van grootboekrekeninggebruik over
 * ALLE administraties heen — de voorbereidende stap voor een centrale
 * master-grootboekmapping (CLAUDE.md §3). Rekent zelf niets aan een
 * P&L/balans toe en past geen mapping toe — puur inventarisatie op de
 * rauwe, gedeelde bronnen `boekingen` en `balans_per_jaar`, zodat een
 * mensen kan beoordelen welke rekeningen betrouwbaar dezelfde betekenis
 * hebben over administraties (kandidaat voor de master) en welke niet
 * (expliciete uitzondering/vraag) — nooit automatisch gegokt.
 */

export interface GrootboekBoekingActiviteit {
  bedrijfsnr: string;
  grootboekrekening: string;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
}

export interface GrootboekBalansOmschrijving {
  bedrijfsnr: string;
  grootboekrekening: string;
  jaar: number;
  /** Vrije-tekst omschrijving uit de bron (`Rekening_omschrijving`), indien aanwezig. */
  omschrijving: string | null;
  /** Ruwe waarde van de bronkolom `Balans_vw` — mogelijk (nog niet bevestigd) een Bal/V&W-signaal, zie packages/config/README.md. */
  balansVw: string | null;
}

export interface GrootboekGebruikPerBedrijf {
  bedrijfsnr: string;
  /** Omschrijving van het meest recente boekjaar dat voor dit bedrijfsnr+rekening in de balans-bron voorkomt; null als de rekening daar niet in voorkomt. */
  omschrijving: string | null;
  balansVw: string | null;
  aantalBoekingen: number;
  /** Som van boekingssaldi (debet - credit), rauw — geen tekenconventie toegepast, uitsluitend voor omvang-indicatie. */
  saldoTotaal: Decimal;
}

export interface GrootboekRekeningOverzicht {
  grootboekrekening: string;
  bedrijven: GrootboekGebruikPerBedrijf[];
  /**
   * true als omschrijving én balansVw identiek zijn (of bij alle bedrijven
   * beide ontbreken) voor elk bedrijf dat deze rekening gebruikt — een
   * betrouwbare kandidaat voor één centrale masterclassificatie. false
   * betekent: expliciet als uitzondering/vraag beoordelen, nooit gokken.
   */
  consistent: boolean;
}

export interface GrootboekInventarisatieResultaat {
  rekeningen: GrootboekRekeningOverzicht[];
  totaalUniekeRekeningen: number;
  aantalConsistent: number;
  aantalInconsistent: number;
}

export function inventariseerGrootboekrekeningen(
  boekingen: readonly GrootboekBoekingActiviteit[],
  balansomschrijvingen: readonly GrootboekBalansOmschrijving[],
): GrootboekInventarisatieResultaat {
  const boekingStatsPerSleutel = new Map<string, { aantal: number; saldoTotaal: Decimal }>();
  for (const boeking of boekingen) {
    const sleutel = sleutelVoor(boeking.bedrijfsnr, boeking.grootboekrekening);
    const bestaand = boekingStatsPerSleutel.get(sleutel);
    const saldo = boeking.bedragDebet.minus(boeking.bedragCredit);
    if (bestaand) {
      bestaand.aantal += 1;
      bestaand.saldoTotaal = bestaand.saldoTotaal.plus(saldo);
    } else {
      boekingStatsPerSleutel.set(sleutel, { aantal: 1, saldoTotaal: saldo });
    }
  }

  const omschrijvingPerSleutel = new Map<string, { jaar: number; omschrijving: string | null; balansVw: string | null }>();
  for (const regel of balansomschrijvingen) {
    const sleutel = sleutelVoor(regel.bedrijfsnr, regel.grootboekrekening);
    const bestaand = omschrijvingPerSleutel.get(sleutel);
    if (!bestaand || regel.jaar > bestaand.jaar) {
      omschrijvingPerSleutel.set(sleutel, { jaar: regel.jaar, omschrijving: regel.omschrijving, balansVw: regel.balansVw });
    }
  }

  const alleSleutels = new Set([...boekingStatsPerSleutel.keys(), ...omschrijvingPerSleutel.keys()]);
  const perRekening = new Map<string, GrootboekGebruikPerBedrijf[]>();
  for (const sleutel of alleSleutels) {
    const [bedrijfsnr, grootboekrekening] = ontleedSleutel(sleutel);
    const boekingStats = boekingStatsPerSleutel.get(sleutel);
    const omschrijving = omschrijvingPerSleutel.get(sleutel);
    const gebruik: GrootboekGebruikPerBedrijf = {
      bedrijfsnr,
      omschrijving: omschrijving?.omschrijving ?? null,
      balansVw: omschrijving?.balansVw ?? null,
      aantalBoekingen: boekingStats?.aantal ?? 0,
      saldoTotaal: boekingStats?.saldoTotaal ?? new Decimal(0),
    };
    const bestaand = perRekening.get(grootboekrekening);
    if (bestaand) bestaand.push(gebruik);
    else perRekening.set(grootboekrekening, [gebruik]);
  }

  const rekeningen: GrootboekRekeningOverzicht[] = Array.from(perRekening.entries())
    .map(([grootboekrekening, bedrijven]) => ({
      grootboekrekening,
      bedrijven: bedrijven.sort((a, b) => a.bedrijfsnr.localeCompare(b.bedrijfsnr)),
      consistent: isConsistent(bedrijven),
    }))
    .sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));

  return {
    rekeningen,
    totaalUniekeRekeningen: rekeningen.length,
    aantalConsistent: rekeningen.filter((r) => r.consistent).length,
    aantalInconsistent: rekeningen.filter((r) => !r.consistent).length,
  };
}

function isConsistent(bedrijven: readonly GrootboekGebruikPerBedrijf[]): boolean {
  if (bedrijven.length <= 1) return true;
  const eerste = bedrijven[0]!;
  return bedrijven.every((b) => b.omschrijving === eerste.omschrijving && b.balansVw === eerste.balansVw);
}

function sleutelVoor(bedrijfsnr: string, grootboekrekening: string): string {
  return `${bedrijfsnr}::${grootboekrekening}`;
}

function ontleedSleutel(sleutel: string): [string, string] {
  const index = sleutel.indexOf("::");
  return [sleutel.slice(0, index), sleutel.slice(index + 2)];
}
