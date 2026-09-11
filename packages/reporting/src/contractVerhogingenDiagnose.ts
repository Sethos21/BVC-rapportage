import Decimal from "decimal.js";

/**
 * Contract-verhogingen-diagnose (2026-08-27/28) — TIJDELIJK, ALLEEN-LEZEN:
 * onderzoekt of de NIEUWE bron `contract_verhogingen.xlsx` betrouwbaar
 * gebruikt kan worden voor historische huurindexaties in
 * Huurdersoverzicht. GEEN classificatie, GEEN aanname welke VS-code kale
 * huur is, GEEN aanname wat `Waarde`/`Status`/`Toekomstige_verhoging`
 * betekenen — dit instrument berekent uitsluitend kandidaat-
 * vergelijkingen (Decimal, geen floating point) en toont ze naast elkaar;
 * de conclusie (punt 7, A–I) wordt PAS na een echte 070-run getrokken,
 * niet hier vastgelegd.
 *
 * `voorOfOpBronPeildatum` is een PUUR datumkenmerk (jaar+periode van de
 * regel vs. jaar+maand van `bronPeildatum`) — geen interpretatie van
 * `Status`/`Toekomstige_verhoging`. Jaar+Periode worden NOOIT omgezet naar
 * een `Date` (dat zou een dag-van-de-maand verzinnen) — uitsluitend
 * lexicografische "jjjjpp"-sleutels en een `"jjjj-pp"`-weergavestring.
 */

export interface CvdVsBedrag {
  vs: string;
  bedragOud: Decimal | null;
  bedragBerekend: Decimal | null;
  bedragNieuw: Decimal | null;
}

export interface CvdVerhogingsregel {
  bedrijfsnr: string | null;
  contractnummer: string | null;
  huurdernummer: string | null;
  huurderNaam: string | null;
  complexnummer: string | null;
  unitnummer: string | null;
  jaar: string | null;
  periode: string | null;
  status: string | null;
  verhogingsmethode: string | null;
  waarde: Decimal | null;
  indexeringOud: Decimal | null;
  indexeringNieuw: Decimal | null;
  totaalOud: Decimal | null;
  totaalNieuw: Decimal | null;
  vsBedragen: CvdVsBedrag[];
  /** Bron-native `Toekomstige_verhoging` — ongewijzigd, puur getoond ter vergelijking met `voorOfOpBronPeildatum`. */
  toekomstigeVerhoging: string | null;
  /** Bron-native `Regelnummer` — voor determinisme bij een tie op jaar+periode én als onafhankelijke chronologiecontrole. */
  regelnummer: string | null;
  /** Aanvullende, puur diagnostische bronvelden (2026-08-28) — onderzoek naar de resterende uitzonderingen (Waarde=0, contract 048's factor-3). Ongewijzigd doorgegeven, geen interpretatie. */
  aanmaakwijze: string | null;
  incidenteel: string | null;
  iahVerhogingToegepast: string | null;
  prijsindexOpslagToegepast: string | null;
  prijsindexOpslagPercentage: Decimal | null;
  cbsAfrondingToegepast: string | null;
  tabeljaar: string | null;
  prijsindextabel: string | null;
}

export interface CvdUnitContext {
  bedrijfsnr: string;
  complexnummer: string;
  unitnummer: string;
  vvo: Decimal | null;
  unitomschrijving: string | null;
}

export interface CvdVerhogingsregelAnalyse {
  regel: CvdVerhogingsregel;
  /** (Totaal_Nieuw / Totaal_Oud − 1) × 100 — alleen als beide bekend en Totaal_Oud ≠ 0. Puur signalerend. */
  mutatiePercentageTotaal: Decimal | null;
  /** Waarde − mutatiePercentageTotaal, indien beide bekend. */
  verschilWaardeMetMutatieTotaal: Decimal | null;
  /** Puur datumvergelijking (jaar+periode van de regel vs. bronPeildatum) — `null` als jaar/periode of bronPeildatum ontbreekt. */
  voorOfOpBronPeildatum: boolean | null;
  /** `"jjjj-pp"` weergave van jaar+periode — NOOIT een `Date` (zou een dag-van-de-maand verzinnen). `null` als jaar ontbreekt. */
  jaarPeriodeWeergave: string | null;
}

export interface CvdContractHistorie {
  contractnummer: string;
  /** Chronologisch, jaar+periode oplopend (Regelnummer als tiebreaker). */
  regels: CvdVerhogingsregelAnalyse[];
  /**
   * `true` als de Regelnummer-volgorde exact overeenkomt met de jaar+periode-
   * volgorde (onafhankelijke chronologiecontrole) — `null` als Regelnummer
   * op een of meer regels ontbreekt/niet-numeriek is, `false` bij een
   * afwijking (puur gerapporteerd, geen aanname welke bron dan leidend is).
   */
  regelnummerVolgordeConsistent: boolean | null;
}

export interface CvdKoppeling {
  aantalRegels070: number;
  aantalUniekeContracten070InBron: number;
  /** Contracten uit de al-bewezen contracten-cache zonder enige regel in deze bron. */
  contractenZonderVerhogingshistorie: string[];
  /** Volledige regels (bedrijfsnr 070) met een contractnummer dat niet voorkomt in de bekende 070-contracten — puur getoond, geen oorzaak aangenomen. */
  verhogingsregelsZonderContractmatch: CvdVerhogingsregel[];
}

export interface CvdVsVergelijking {
  vs: string;
  bedragNieuw: Decimal | null;
  rentrollBrutoJaarhuur: Decimal | null;
  verschilMetBrutoJaarhuur: Decimal | null;
  rentrollHuurkorting: Decimal | null;
  verschilMetHuurkorting: Decimal | null;
}

export interface CvdReconciliatieRegel {
  contractnummer: string;
  kandidaatLaatsteRegel: CvdVerhogingsregelAnalyse | null;
  redenGeenKandidaat: string | null;
  /** Ruwe (ongeschaalde) vergelijking van elke gevonden VS-code op de kandidaatregel tegen rentroll — complementair aan `vs01Reconciliatie` (die VS_01 specifiek × 12 rekent). */
  vsVergelijking: CvdVsVergelijking[];
}

export interface CvdVs01ReconciliatieRegel {
  contractnummer: string;
  kandidaatGevonden: boolean;
  jaar: string | null;
  periode: string | null;
  status: string | null;
  toekomstigeVerhoging: string | null;
  bedragOudVs01: Decimal | null;
  bedragNieuwVs01: Decimal | null;
  /** Bedrag_Nieuw_VS_01 × 12 (Decimal) — kandidaat-vergelijking op basis van de hypothese "VS_01 is een maandbedrag". */
  bedragNieuwVs01MaalTwaalf: Decimal | null;
  rentrollBrutoJaarhuur: Decimal | null;
  /** bedragNieuwVs01MaalTwaalf − rentrollBrutoJaarhuur — nooit afgerond of verklaard, puur getoond. */
  verschilEuro: Decimal | null;
  redenGeenKandidaat: string | null;
}

export interface CvdVs01ReconciliatieSamenvatting {
  aantalContracten: number;
  aantalExacteMatches: number;
  aantalAfwijkingen: number;
  grootsteAbsoluteAfwijking: Decimal | null;
  perContract: CvdVs01ReconciliatieRegel[];
}

export interface CvdVsWijzigingStatistiek {
  vs: string;
  aantalRegelsMetBeideBedragen: number;
  aantalRegelsMetWijziging: number;
  aantalRegelsZonderWijziging: number;
}

export interface CvdWaardeAnalyseRegel {
  bedrijfsnr: string | null;
  contractnummer: string | null;
  jaar: string | null;
  periode: string | null;
  waarde: Decimal | null;
  bedragOudVs01: Decimal | null;
  bedragNieuwVs01: Decimal | null;
  percentageVs01: Decimal | null;
  verschilWaardeMetPercentageVs01: Decimal | null;
  indexeringOud: Decimal | null;
  indexeringNieuw: Decimal | null;
  percentageIndexering: Decimal | null;
  verschilWaardeMetPercentageIndexering: Decimal | null;
  waardeIsNulMaarVs01Wijzigt: boolean;
}

export interface CvdWaardeAnalyseSamenvatting {
  aantalRegelsGeanalyseerd: number;
  aantalExacteMatchesMetPercentageVs01: number;
  aantalAfwijkingen: number;
  maximaleAbsoluteAfwijking: Decimal | null;
  aantalWaardeNulMaarVs01Wijzigt: number;
  regels: CvdWaardeAnalyseRegel[];
}

export interface CvdContractZonderHistorieOnderzoek {
  contractnummer: string;
  huurderNaam: string | null;
  ingangsdatum: Date | null;
  huidigeBrutoJaarhuur: Decimal | null;
  volgendeIndexeringsdatum: Date | null;
  /** "jjjjpp" van ingangsdatum, voor vergelijking — puur datumfeit, geen conclusie. */
  ingangsdatumSleutel: string | null;
  /** Meest recente jaar+periode-sleutel over ALLE 070-verhogingsregels (gekoppeld én ongekoppeld). */
  portefeuilleLaatsteVerhogingssleutel: string | null;
  /** `true` als ingangsdatumSleutel > portefeuilleLaatsteVerhogingssleutel — objectief datumsignaal, geen classificatie. */
  ingangNaLaatstePortefeuilleVerhoging: boolean | null;
}

export interface ContractVerhogingenDiagnoseResultaat {
  bronBestaat: boolean;
  ruweKolommen: string[];
  bronPeildatum: Date | null;
  koppeling: CvdKoppeling;
  /** Alle distinct-waarden van Status/Toekomstige_verhoging over de 070-regels — bouwstap om punt 7-F te kunnen beantwoorden zonder de betekenis hier al aan te nemen. */
  distinctStatusWaarden: string[];
  distinctToekomstigeVerhogingWaarden: string[];
  historiePerContract: CvdContractHistorie[];
  reconciliatie: CvdReconciliatieRegel[];
  vs01Reconciliatie: CvdVs01ReconciliatieSamenvatting;
  vsWijzigingStatistiek: CvdVsWijzigingStatistiek[];
  waardeAnalyse: CvdWaardeAnalyseSamenvatting;
  contractenZonderHistorieOnderzoek: CvdContractZonderHistorieOnderzoek[];
  /** Alle 070-units (complex+unit+VVO), rechtstreeks uit de al-bewezen `units`-cache — generiek, niet gefilterd op specifieke contracten, puur context voor de oppervlakte-vraag bij contract 048. */
  unitsContext: CvdUnitContext[];
}

export interface CvdContractContext {
  contractnummer: string;
  huurderNaam: string | null;
  ingangsdatum: Date | null;
  volgendeIndexeringsdatum: Date | null;
  /** Huidige rentroll Vorderingsoort 01-bedrag (bruto jaarhuur), indien aanwezig. */
  brutoJaarhuur: Decimal | null;
  /** Huidige rentroll Vorderingsoort 13-bedrag (huurkorting, zoals in de bron: doorgaans negatief). */
  huurkorting: Decimal | null;
}

/** `jaar`+`periode` naar een lexicografisch sorteerbare sleutel (jjjjpp) — `null` als jaar niet numeriek is. Periode ontbrekend/niet-numeriek → "00" (blijft chronologisch vóór elke bekende periode van hetzelfde jaar, nooit een gok welke periode het wél was). */
function sorteersleutel(jaar: string | null, periode: string | null): string | null {
  if (jaar === null) return null;
  const jaarGetal = Number(jaar);
  if (!Number.isFinite(jaarGetal)) return null;
  const periodeGetal = periode !== null ? Number(periode) : null;
  const periodeDeel = periodeGetal !== null && Number.isFinite(periodeGetal) ? String(periodeGetal).padStart(2, "0") : "00";
  return `${String(jaarGetal).padStart(4, "0")}${periodeDeel}`;
}

function jaarPeriodeWeergave(jaar: string | null, periode: string | null): string | null {
  if (jaar === null) return null;
  return periode !== null ? `${jaar}-${periode}` : jaar;
}

function datumSleutel(datum: Date): string {
  return `${String(datum.getUTCFullYear()).padStart(4, "0")}${String(datum.getUTCMonth() + 1).padStart(2, "0")}`;
}

function analyseerRegel(regel: CvdVerhogingsregel, bronPeildatumSleutel: string | null): CvdVerhogingsregelAnalyse {
  const mutatiePercentageTotaal =
    regel.totaalOud !== null && regel.totaalNieuw !== null && !regel.totaalOud.isZero() ? regel.totaalNieuw.dividedBy(regel.totaalOud).minus(1).times(100) : null;
  const verschilWaardeMetMutatieTotaal = regel.waarde !== null && mutatiePercentageTotaal !== null ? regel.waarde.minus(mutatiePercentageTotaal) : null;

  const regelSleutel = sorteersleutel(regel.jaar, regel.periode);
  const voorOfOpBronPeildatum = regelSleutel !== null && bronPeildatumSleutel !== null ? regelSleutel <= bronPeildatumSleutel : null;

  return { regel, mutatiePercentageTotaal, verschilWaardeMetMutatieTotaal, voorOfOpBronPeildatum, jaarPeriodeWeergave: jaarPeriodeWeergave(regel.jaar, regel.periode) };
}

function sorteerChronologisch(regels: CvdVerhogingsregelAnalyse[]): CvdVerhogingsregelAnalyse[] {
  return [...regels].sort((a, b) => {
    const sleutelVerschil = (sorteersleutel(a.regel.jaar, a.regel.periode) ?? "").localeCompare(sorteersleutel(b.regel.jaar, b.regel.periode) ?? "");
    if (sleutelVerschil !== 0) return sleutelVerschil;
    const regelnrA = a.regel.regelnummer !== null ? Number(a.regel.regelnummer) : null;
    const regelnrB = b.regel.regelnummer !== null ? Number(b.regel.regelnummer) : null;
    if (regelnrA !== null && regelnrB !== null && Number.isFinite(regelnrA) && Number.isFinite(regelnrB)) return regelnrA - regelnrB;
    return 0;
  });
}

/** `null` als Regelnummer op een of meer regels ontbreekt/niet-numeriek is (geen uitspraak mogelijk); anders of de Regelnummer-volgorde exact gelijk is aan de jaar+periode-volgorde. */
function bepaalRegelnummerConsistentie(chronologisch: CvdVerhogingsregelAnalyse[]): boolean | null {
  const regelnummers = chronologisch.map((r) => (r.regel.regelnummer !== null ? Number(r.regel.regelnummer) : null));
  if (regelnummers.some((n) => n === null || !Number.isFinite(n))) return null;
  const getallen = regelnummers as number[];
  const gesorteerd = [...getallen].sort((a, b) => a - b);
  return getallen.every((n, i) => n === gesorteerd[i]);
}

export function diagnoseerContractVerhogingen(
  ruweKolommen: readonly string[],
  regels070: readonly CvdVerhogingsregel[],
  bekendeContracten: readonly CvdContractContext[],
  bronPeildatum: Date | null,
  unitsContext: readonly CvdUnitContext[] = [],
): ContractVerhogingenDiagnoseResultaat {
  const bekendeContractnummers = bekendeContracten.map((c) => c.contractnummer);
  const bekendeSet = new Set(bekendeContractnummers);
  const contextPerContract = new Map(bekendeContracten.map((c) => [c.contractnummer, c] as const));
  const bronPeildatumSleutel = bronPeildatum !== null ? datumSleutel(bronPeildatum) : null;

  // ── Koppeling ────────────────────────────────────────────────────────
  const perContract = new Map<string, CvdVerhogingsregel[]>();
  const zonderContractmatch: CvdVerhogingsregel[] = [];
  for (const regel of regels070) {
    if (regel.contractnummer === null || !bekendeSet.has(regel.contractnummer)) {
      zonderContractmatch.push(regel);
      continue;
    }
    const groep = perContract.get(regel.contractnummer) ?? [];
    groep.push(regel);
    perContract.set(regel.contractnummer, groep);
  }
  const contractenZonderVerhogingshistorie = bekendeContractnummers.filter((c) => !perContract.has(c));

  // ── Historie per contract + chronologiecontrole ─────────────────────
  const historiePerContract: CvdContractHistorie[] = Array.from(perContract.entries())
    .map(([contractnummer, regels]) => {
      const chronologisch = sorteerChronologisch(regels.map((r) => analyseerRegel(r, bronPeildatumSleutel)));
      return { contractnummer, regels: chronologisch, regelnummerVolgordeConsistent: bepaalRegelnummerConsistentie(chronologisch) };
    })
    .sort((a, b) => a.contractnummer.localeCompare(b.contractnummer));

  // ── Bestaande (ongeschaalde) VS-vergelijking op de datum-kandidaat ──
  const reconciliatie: CvdReconciliatieRegel[] = historiePerContract.map(({ contractnummer, regels }) => {
    const kandidaten = regels.filter((r) => r.voorOfOpBronPeildatum === true);
    if (kandidaten.length === 0) {
      const reden = bronPeildatum === null ? "bronPeildatum onbekend (rentroll.rapportage_datum niet eenduidig)." : "Geen enkele regel heeft een jaar+periode vóór/op bronPeildatum.";
      return { contractnummer, kandidaatLaatsteRegel: null, redenGeenKandidaat: reden, vsVergelijking: [] };
    }
    const kandidaat = kandidaten[kandidaten.length - 1]!;
    const context = contextPerContract.get(contractnummer) ?? null;
    const vsVergelijking: CvdVsVergelijking[] = kandidaat.regel.vsBedragen.map((vs) => ({
      vs: vs.vs,
      bedragNieuw: vs.bedragNieuw,
      rentrollBrutoJaarhuur: context?.brutoJaarhuur ?? null,
      verschilMetBrutoJaarhuur: vs.bedragNieuw !== null && context?.brutoJaarhuur != null ? vs.bedragNieuw.minus(context.brutoJaarhuur) : null,
      rentrollHuurkorting: context?.huurkorting ?? null,
      verschilMetHuurkorting: vs.bedragNieuw !== null && context?.huurkorting != null ? vs.bedragNieuw.minus(context.huurkorting) : null,
    }));
    return { contractnummer, kandidaatLaatsteRegel: kandidaat, redenGeenKandidaat: null, vsVergelijking };
  });

  // ── Punt 1: VS_01 × 12 reconciliatie ────────────────────────────────
  const vs01PerContract: CvdVs01ReconciliatieRegel[] = historiePerContract.map(({ contractnummer, regels }) => {
    const kandidaten = regels.filter((r) => r.voorOfOpBronPeildatum === true);
    const context = contextPerContract.get(contractnummer) ?? null;
    if (kandidaten.length === 0) {
      const reden = bronPeildatum === null ? "bronPeildatum onbekend." : "Geen enkele regel heeft een jaar+periode vóór/op bronPeildatum.";
      return {
        contractnummer, kandidaatGevonden: false, jaar: null, periode: null, status: null, toekomstigeVerhoging: null,
        bedragOudVs01: null, bedragNieuwVs01: null, bedragNieuwVs01MaalTwaalf: null, rentrollBrutoJaarhuur: context?.brutoJaarhuur ?? null,
        verschilEuro: null, redenGeenKandidaat: reden,
      };
    }
    const kandidaat = kandidaten[kandidaten.length - 1]!.regel;
    const vs01 = kandidaat.vsBedragen.find((v) => v.vs === "VS_01") ?? null;
    const bedragNieuwVs01MaalTwaalf = vs01?.bedragNieuw != null ? vs01.bedragNieuw.times(12) : null;
    const verschilEuro = bedragNieuwVs01MaalTwaalf !== null && context?.brutoJaarhuur != null ? bedragNieuwVs01MaalTwaalf.minus(context.brutoJaarhuur) : null;
    return {
      contractnummer, kandidaatGevonden: true, jaar: kandidaat.jaar, periode: kandidaat.periode, status: kandidaat.status, toekomstigeVerhoging: kandidaat.toekomstigeVerhoging,
      bedragOudVs01: vs01?.bedragOud ?? null, bedragNieuwVs01: vs01?.bedragNieuw ?? null, bedragNieuwVs01MaalTwaalf,
      rentrollBrutoJaarhuur: context?.brutoJaarhuur ?? null, verschilEuro, redenGeenKandidaat: null,
    };
  });
  const vs01MetVerschil = vs01PerContract.filter((r) => r.verschilEuro !== null);
  const vs01Reconciliatie: CvdVs01ReconciliatieSamenvatting = {
    aantalContracten: vs01PerContract.length,
    aantalExacteMatches: vs01MetVerschil.filter((r) => r.verschilEuro!.isZero()).length,
    aantalAfwijkingen: vs01MetVerschil.filter((r) => !r.verschilEuro!.isZero()).length,
    grootsteAbsoluteAfwijking: vs01MetVerschil.length > 0 ? vs01MetVerschil.reduce((max, r) => (r.verschilEuro!.abs().greaterThan(max) ? r.verschilEuro!.abs() : max), new Decimal(0)) : null,
    perContract: vs01PerContract,
  };

  // ── Punt 2: welke VS-codes veranderen daadwerkelijk, over ALLE 070-regels ──
  const vsCodesGezien = new Set<string>();
  for (const r of regels070) for (const v of r.vsBedragen) vsCodesGezien.add(v.vs);
  const vsWijzigingStatistiek: CvdVsWijzigingStatistiek[] = Array.from(vsCodesGezien)
    .sort()
    .map((vs) => {
      let metBeide = 0;
      let metWijziging = 0;
      for (const r of regels070) {
        const v = r.vsBedragen.find((x) => x.vs === vs);
        if (!v || v.bedragOud === null || v.bedragNieuw === null) continue;
        metBeide += 1;
        if (!v.bedragOud.equals(v.bedragNieuw)) metWijziging += 1;
      }
      return { vs, aantalRegelsMetBeideBedragen: metBeide, aantalRegelsMetWijziging: metWijziging, aantalRegelsZonderWijziging: metBeide - metWijziging };
    });

  // ── Punt 3: betekenis van Waarde, over ALLE 070-regels met positieve Bedrag_oud_VS_01 ──
  const waardeRegels: CvdWaardeAnalyseRegel[] = regels070
    .map((r): CvdWaardeAnalyseRegel | null => {
      const vs01 = r.vsBedragen.find((v) => v.vs === "VS_01") ?? null;
      const bedragOudVs01 = vs01?.bedragOud ?? null;
      const bedragNieuwVs01 = vs01?.bedragNieuw ?? null;
      if (bedragOudVs01 === null || !bedragOudVs01.greaterThan(0) || bedragNieuwVs01 === null) return null;

      const percentageVs01 = bedragNieuwVs01.dividedBy(bedragOudVs01).minus(1).times(100);
      const verschilWaardeMetPercentageVs01 = r.waarde !== null ? r.waarde.minus(percentageVs01) : null;

      const percentageIndexering =
        r.indexeringOud !== null && r.indexeringNieuw !== null && !r.indexeringOud.isZero() ? r.indexeringNieuw.dividedBy(r.indexeringOud).minus(1).times(100) : null;
      const verschilWaardeMetPercentageIndexering = r.waarde !== null && percentageIndexering !== null ? r.waarde.minus(percentageIndexering) : null;

      const waardeIsNulMaarVs01Wijzigt = r.waarde !== null && r.waarde.isZero() && !bedragOudVs01.equals(bedragNieuwVs01);

      return {
        bedrijfsnr: r.bedrijfsnr, contractnummer: r.contractnummer, jaar: r.jaar, periode: r.periode, waarde: r.waarde,
        bedragOudVs01, bedragNieuwVs01, percentageVs01, verschilWaardeMetPercentageVs01,
        indexeringOud: r.indexeringOud, indexeringNieuw: r.indexeringNieuw, percentageIndexering, verschilWaardeMetPercentageIndexering,
        waardeIsNulMaarVs01Wijzigt,
      };
    })
    .filter((r): r is CvdWaardeAnalyseRegel => r !== null);
  const waardeMetVerschil = waardeRegels.filter((r) => r.verschilWaardeMetPercentageVs01 !== null);
  const waardeAnalyse: CvdWaardeAnalyseSamenvatting = {
    aantalRegelsGeanalyseerd: waardeRegels.length,
    aantalExacteMatchesMetPercentageVs01: waardeMetVerschil.filter((r) => r.verschilWaardeMetPercentageVs01!.isZero()).length,
    aantalAfwijkingen: waardeMetVerschil.filter((r) => !r.verschilWaardeMetPercentageVs01!.isZero()).length,
    maximaleAbsoluteAfwijking:
      waardeMetVerschil.length > 0 ? waardeMetVerschil.reduce((max, r) => (r.verschilWaardeMetPercentageVs01!.abs().greaterThan(max) ? r.verschilWaardeMetPercentageVs01!.abs() : max), new Decimal(0)) : null,
    aantalWaardeNulMaarVs01Wijzigt: waardeRegels.filter((r) => r.waardeIsNulMaarVs01Wijzigt).length,
    regels: waardeRegels,
  };

  // ── Punt 4: contracten zonder verhogingshistorie ────────────────────
  const alleRegelSleutels070 = regels070.map((r) => sorteersleutel(r.jaar, r.periode)).filter((s): s is string => s !== null);
  const portefeuilleLaatsteVerhogingssleutel = alleRegelSleutels070.length > 0 ? alleRegelSleutels070.reduce((max, s) => (s > max ? s : max)) : null;
  const contractenZonderHistorieOnderzoek: CvdContractZonderHistorieOnderzoek[] = contractenZonderVerhogingshistorie.map((contractnummer) => {
    const context = contextPerContract.get(contractnummer) ?? null;
    const ingangsdatumSleutel = context?.ingangsdatum ? datumSleutel(context.ingangsdatum) : null;
    return {
      contractnummer,
      huurderNaam: context?.huurderNaam ?? null,
      ingangsdatum: context?.ingangsdatum ?? null,
      huidigeBrutoJaarhuur: context?.brutoJaarhuur ?? null,
      volgendeIndexeringsdatum: context?.volgendeIndexeringsdatum ?? null,
      ingangsdatumSleutel,
      portefeuilleLaatsteVerhogingssleutel,
      ingangNaLaatstePortefeuilleVerhoging: ingangsdatumSleutel !== null && portefeuilleLaatsteVerhogingssleutel !== null ? ingangsdatumSleutel > portefeuilleLaatsteVerhogingssleutel : null,
    };
  });

  const distinctStatusWaarden = Array.from(new Set(regels070.map((r) => r.status).filter((s): s is string => s !== null))).sort();
  const distinctToekomstigeVerhogingWaarden = Array.from(new Set(regels070.map((r) => r.toekomstigeVerhoging).filter((s): s is string => s !== null))).sort();

  return {
    bronBestaat: true,
    ruweKolommen: [...ruweKolommen],
    bronPeildatum,
    koppeling: {
      aantalRegels070: regels070.length,
      aantalUniekeContracten070InBron: perContract.size,
      contractenZonderVerhogingshistorie,
      verhogingsregelsZonderContractmatch: zonderContractmatch,
    },
    distinctStatusWaarden,
    distinctToekomstigeVerhogingWaarden,
    historiePerContract,
    reconciliatie,
    vs01Reconciliatie,
    vsWijzigingStatistiek,
    waardeAnalyse,
    contractenZonderHistorieOnderzoek,
    unitsContext: [...unitsContext],
  };
}
