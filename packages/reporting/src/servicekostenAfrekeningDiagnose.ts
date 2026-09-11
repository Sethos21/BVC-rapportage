import Decimal from "decimal.js";
import { som } from "./servicekostenDiagnose.js";

/**
 * Servicekosten-afrekeningsdiagnose (2026-08-26) — TIJDELIJK, ALLEEN-LEZEN.
 * Onderzoekt drie door de gebruiker aangewezen, nog niet gemodelleerde
 * bronvelden: `Kostensoort_Soort` (Kosten/Voorschotten/Nvt) en acht
 * afrekeningsvelden (Jaar_Afrekening, Jaar_SV_Afrekening, Per_SV_Afrekening,
 * Periode_Afrekening, SV_Afrekening_Soort(+Omschrijving/Vlgnr),
 * Vdsrt_Opbrengsten(+Omschr)), plus het bron-eigen `Service_Boeking_Saldo`
 * (vergeleken met het lokaal herberekende debet−credit).
 *
 * Doel: bewijzen — niet aannemen — hoe de servicekostenbron zelf onderscheid
 * maakt tussen werkelijke kosten (grootboek 1712, per kostensoort),
 * voorschotten (grootboek 1711 + kostensoort 2000) en afrekeningen van een
 * voorgaand jaar (kostensoort 9600). Kostensoort 9600 wordt bewust NOOIT
 * stilzwijgend uit de kosten/voorschotten-secties gefilterd door deze
 * diagnose zelf — 9600-regels verschijnen gewoon in `perKostensoortSoort`
 * als hun `Kostensoort_Soort`-waarde dat oplevert; de aparte `kostensoort9600`
 * -sectie is puur een extra, gerichte uitsplitsing (op expliciet verzoek
 * van de gebruiker), geen filtering van de andere secties.
 *
 * `Kostensoort_Soort` wordt hier gebruikt als LETTERLIJKE groepeersleutel
 * (wat de bron zegt), niet als bevestigde businessclassificatie — een
 * onverwachte waarde blokkeert niets en verschijnt gewoon als eigen groep
 * plus een signaal in `controleVereist`. Geen KPI, geen mapping, geen
 * classificatie van doorbelastbaar/eigenaar. Wijzigt niets aan
 * `servicekostenDiagnose.ts`, `controlerapport.ts` of enige bestaande
 * rekenfunctie.
 */

export interface ServicekostenAfrekeningDiagnoseRegel {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  dagboeknummer: string;
  boekstuknummer: string;
  volgnummer: string;
  complexnummer: string | null;
  unitnummer: string | null;
  contractnummer: string | null;
  huurdernummer: string | null;
  kostensoort: string;
  kostensoortOmschrijving: string | null;
  omschrijving: string | null;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
  saldo: Decimal;
  kostensoortSoort: string | null;
  jaarAfrekening: string | null;
  jaarSvAfrekening: string | null;
  perSvAfrekening: string | null;
  periodeAfrekening: string | null;
  svAfrekeningSoort: string | null;
  svAfrekeningSoortOmschrijving: string | null;
  svAfrekeningVlgnr: string | null;
  vdsrtOpbrengsten: string | null;
  vdsrtOmschr: string | null;
  bronBoekingSaldo: Decimal | null;
}

/** Lijsten die met de data mee kunnen groeien (rijen/distincte waarden) worden altijd begrensd — `aantalTotaal` blijft het WERKELIJKE aantal, `voorbeeld` is nooit stilzwijgend de volledige lijst. */
export interface BegrensdeLijst<T> {
  aantalTotaal: number;
  voorbeeld: T[];
}

const MAX_VOORBEELD_ITEMS = 20;
const MAX_DISTINCTE_WAARDEN = 30;
/** Omschrijvingen per kostensoort kunnen honderden distincte varianten hebben (bv. per-boeking factuuromschrijvingen) — kleinere cap dan MAX_DISTINCTE_WAARDEN, puur ter illustratie. */
const MAX_OMSCHRIJVINGEN_VOORBEELD = 10;
const KOSTENSOORT_9600 = "9600";

/** Gedeeld met `servicekostenGrootboekReconciliatieDiagnose.ts` — geen tweede begrenzingshulp. */
export function begrens<T>(items: readonly T[], max: number): BegrensdeLijst<T> {
  return { aantalTotaal: items.length, voorbeeld: items.slice(0, max) };
}

function natuurlijkeSleutel(regel: ServicekostenAfrekeningDiagnoseRegel): string {
  return [regel.bedrijfsnr, regel.boekjaar, regel.boekperiode, regel.dagboeknummer, regel.boekstuknummer, regel.volgnummer].join("::");
}

export interface ServicekostenAfrekeningDiagnoseKostensoortTotaal {
  kostensoort: string;
  omschrijvingen: BegrensdeLijst<string>;
  aantalRegels: number;
  debet: Decimal;
  credit: Decimal;
  saldo: Decimal;
}

function kostensoortTotalen(regels: readonly ServicekostenAfrekeningDiagnoseRegel[]): BegrensdeLijst<ServicekostenAfrekeningDiagnoseKostensoortTotaal> {
  const perKostensoort = new Map<string, ServicekostenAfrekeningDiagnoseRegel[]>();
  for (const regel of regels) {
    const groep = perKostensoort.get(regel.kostensoort) ?? [];
    groep.push(regel);
    perKostensoort.set(regel.kostensoort, groep);
  }
  const totalen = Array.from(perKostensoort.entries())
    .map(([kostensoort, groep]) => ({
      kostensoort,
      omschrijvingen: begrens(Array.from(new Set(groep.map((r) => r.omschrijving ?? r.kostensoortOmschrijving ?? "(leeg)"))).sort(), MAX_OMSCHRIJVINGEN_VOORBEELD),
      aantalRegels: groep.length,
      debet: som(groep.map((r) => r.bedragDebet)),
      credit: som(groep.map((r) => r.bedragCredit)),
      saldo: som(groep.map((r) => r.saldo)),
    }))
    .sort((a, b) => a.kostensoort.localeCompare(b.kostensoort));
  return begrens(totalen, MAX_DISTINCTE_WAARDEN);
}

export interface ServicekostenAfrekeningDiagnoseComplexTotaal {
  complexnummer: string | null;
  aantalRegels: number;
  debet: Decimal;
  credit: Decimal;
  saldo: Decimal;
}

function complexTotalen(regels: readonly ServicekostenAfrekeningDiagnoseRegel[]): BegrensdeLijst<ServicekostenAfrekeningDiagnoseComplexTotaal> {
  const perComplex = new Map<string | null, ServicekostenAfrekeningDiagnoseRegel[]>();
  for (const regel of regels) {
    const groep = perComplex.get(regel.complexnummer) ?? [];
    groep.push(regel);
    perComplex.set(regel.complexnummer, groep);
  }
  const totalen = Array.from(perComplex.entries())
    .map(([complexnummer, groep]) => ({
      complexnummer,
      aantalRegels: groep.length,
      debet: som(groep.map((r) => r.bedragDebet)),
      credit: som(groep.map((r) => r.bedragCredit)),
      saldo: som(groep.map((r) => r.saldo)),
    }))
    .sort((a, b) => (a.complexnummer ?? "").localeCompare(b.complexnummer ?? ""));
  return begrens(totalen, MAX_DISTINCTE_WAARDEN);
}

export interface ServicekostenAfrekeningDiagnoseContractHuurderTotaal {
  complexnummer: string | null;
  unitnummer: string | null;
  contractnummer: string | null;
  huurdernummer: string | null;
  aantalRegels: number;
  debet: Decimal;
  credit: Decimal;
  saldo: Decimal;
}

function contractHuurderTotalen(regels: readonly ServicekostenAfrekeningDiagnoseRegel[]): { lijst: BegrensdeLijst<ServicekostenAfrekeningDiagnoseContractHuurderTotaal>; aantalZonderContractOfHuurder: number } {
  const perSleutel = new Map<string, ServicekostenAfrekeningDiagnoseRegel[]>();
  let aantalZonderContractOfHuurder = 0;
  for (const regel of regels) {
    if (regel.contractnummer === null && regel.huurdernummer === null) {
      aantalZonderContractOfHuurder += 1;
      continue;
    }
    const sleutel = [regel.complexnummer, regel.unitnummer, regel.contractnummer, regel.huurdernummer].join("::");
    const groep = perSleutel.get(sleutel) ?? [];
    groep.push(regel);
    perSleutel.set(sleutel, groep);
  }
  const totalen = Array.from(perSleutel.values())
    .map((groep) => {
      const eerste = groep[0]!;
      return {
        complexnummer: eerste.complexnummer,
        unitnummer: eerste.unitnummer,
        contractnummer: eerste.contractnummer,
        huurdernummer: eerste.huurdernummer,
        aantalRegels: groep.length,
        debet: som(groep.map((r) => r.bedragDebet)),
        credit: som(groep.map((r) => r.bedragCredit)),
        saldo: som(groep.map((r) => r.saldo)),
      };
    })
    .sort((a, b) => `${a.complexnummer ?? ""}::${a.unitnummer ?? ""}::${a.contractnummer ?? ""}`.localeCompare(`${b.complexnummer ?? ""}::${b.unitnummer ?? ""}::${b.contractnummer ?? ""}`));
  return { lijst: begrens(totalen, MAX_DISTINCTE_WAARDEN), aantalZonderContractOfHuurder };
}

export interface ServicekostenAfrekeningDiagnoseStroomSectie {
  kostensoortSoortWaarde: string;
  aantalRegels: number;
  debet: Decimal;
  credit: Decimal;
  saldo: Decimal;
  kostensoortenGezien: string[];
  perKostensoort: BegrensdeLijst<ServicekostenAfrekeningDiagnoseKostensoortTotaal>;
  perComplex: BegrensdeLijst<ServicekostenAfrekeningDiagnoseComplexTotaal>;
  perContractHuurder: BegrensdeLijst<ServicekostenAfrekeningDiagnoseContractHuurderTotaal>;
  aantalRegelsZonderContractOfHuurder: number;
}

function bouwStroomSectie(alleRegels: readonly ServicekostenAfrekeningDiagnoseRegel[], kostensoortSoortWaarde: string): ServicekostenAfrekeningDiagnoseStroomSectie {
  const regels = alleRegels.filter((r) => r.kostensoortSoort === kostensoortSoortWaarde);
  const { lijst: perContractHuurder, aantalZonderContractOfHuurder } = contractHuurderTotalen(regels);
  return {
    kostensoortSoortWaarde,
    aantalRegels: regels.length,
    debet: som(regels.map((r) => r.bedragDebet)),
    credit: som(regels.map((r) => r.bedragCredit)),
    saldo: som(regels.map((r) => r.saldo)),
    kostensoortenGezien: Array.from(new Set(regels.map((r) => r.kostensoort))).sort(),
    perKostensoort: kostensoortTotalen(regels),
    perComplex: complexTotalen(regels),
    perContractHuurder,
    aantalRegelsZonderContractOfHuurder: aantalZonderContractOfHuurder,
  };
}

export interface ServicekostenAfrekeningDiagnoseHuurderTotaal {
  huurdernummer: string | null;
  contractnummer: string | null;
  complexnummer: string | null;
  unitnummer: string | null;
  aantalRegels: number;
  debet: Decimal;
  credit: Decimal;
  saldo: Decimal;
}

export interface ServicekostenAfrekeningDiagnoseAfrekeningVelden {
  natuurlijkeSleutel: string;
  jaarAfrekening: string | null;
  jaarSvAfrekening: string | null;
  perSvAfrekening: string | null;
  periodeAfrekening: string | null;
  svAfrekeningSoort: string | null;
  svAfrekeningSoortOmschrijving: string | null;
  svAfrekeningVlgnr: string | null;
}

export interface ServicekostenAfrekeningDiagnoseKostensoort9600Sectie {
  aantalRegels: number;
  kostensoortSoortWaardenGezien: string[];
  debet: Decimal;
  credit: Decimal;
  saldo: Decimal;
  perHuurder: BegrensdeLijst<ServicekostenAfrekeningDiagnoseHuurderTotaal>;
  regelsMetAfrekeningsvelden: BegrensdeLijst<ServicekostenAfrekeningDiagnoseAfrekeningVelden>;
}

function bouwKostensoort9600Sectie(alleRegels: readonly ServicekostenAfrekeningDiagnoseRegel[]): ServicekostenAfrekeningDiagnoseKostensoort9600Sectie {
  const regels = alleRegels.filter((r) => r.kostensoort === KOSTENSOORT_9600);

  const perHuurderMap = new Map<string, ServicekostenAfrekeningDiagnoseRegel[]>();
  for (const regel of regels) {
    const sleutel = [regel.huurdernummer, regel.contractnummer, regel.complexnummer, regel.unitnummer].join("::");
    const groep = perHuurderMap.get(sleutel) ?? [];
    groep.push(regel);
    perHuurderMap.set(sleutel, groep);
  }
  const perHuurder = Array.from(perHuurderMap.values())
    .map((groep) => {
      const eerste = groep[0]!;
      return {
        huurdernummer: eerste.huurdernummer,
        contractnummer: eerste.contractnummer,
        complexnummer: eerste.complexnummer,
        unitnummer: eerste.unitnummer,
        aantalRegels: groep.length,
        debet: som(groep.map((r) => r.bedragDebet)),
        credit: som(groep.map((r) => r.bedragCredit)),
        saldo: som(groep.map((r) => r.saldo)),
      };
    })
    .sort((a, b) => (a.huurdernummer ?? "").localeCompare(b.huurdernummer ?? ""));

  const regelsMetAfrekeningsvelden = regels.map((r) => ({
    natuurlijkeSleutel: natuurlijkeSleutel(r),
    jaarAfrekening: r.jaarAfrekening,
    jaarSvAfrekening: r.jaarSvAfrekening,
    perSvAfrekening: r.perSvAfrekening,
    periodeAfrekening: r.periodeAfrekening,
    svAfrekeningSoort: r.svAfrekeningSoort,
    svAfrekeningSoortOmschrijving: r.svAfrekeningSoortOmschrijving,
    svAfrekeningVlgnr: r.svAfrekeningVlgnr,
  }));

  return {
    aantalRegels: regels.length,
    kostensoortSoortWaardenGezien: Array.from(new Set(regels.map((r) => r.kostensoortSoort ?? "(leeg)"))).sort(),
    debet: som(regels.map((r) => r.bedragDebet)),
    credit: som(regels.map((r) => r.bedragCredit)),
    saldo: som(regels.map((r) => r.saldo)),
    perHuurder: begrens(perHuurder, MAX_DISTINCTE_WAARDEN),
    regelsMetAfrekeningsvelden: begrens(regelsMetAfrekeningsvelden, MAX_VOORBEELD_ITEMS),
  };
}

export interface ServicekostenAfrekeningDiagnoseVeldAnalyse {
  veld: string;
  aantalNietLeeg: number;
  aantalDistinct: number;
  distincteWaardenVoorbeeld: string[];
  /** Aantal regels per waarde, uitsluitend voor de waarden in `distincteWaardenVoorbeeld` (niet voor afgekapte waarden). */
  aantalRegelsPerWaarde: Record<string, number>;
  komtVoorBijKostensoort9600: boolean;
  komtVoorBijAndereKostensoorten: boolean;
}

function analyseerVeld(
  regels: readonly ServicekostenAfrekeningDiagnoseRegel[],
  veldNaam: string,
  accessor: (r: ServicekostenAfrekeningDiagnoseRegel) => string | null,
): ServicekostenAfrekeningDiagnoseVeldAnalyse {
  const nietLeeg = regels.filter((r) => accessor(r) !== null);
  const distincteWaarden = Array.from(new Set(nietLeeg.map((r) => accessor(r)!))).sort();
  const voorbeeldWaarden = distincteWaarden.slice(0, MAX_DISTINCTE_WAARDEN);
  const aantalRegelsPerWaarde: Record<string, number> = {};
  for (const waarde of voorbeeldWaarden) {
    aantalRegelsPerWaarde[waarde] = nietLeeg.filter((r) => accessor(r) === waarde).length;
  }
  return {
    veld: veldNaam,
    aantalNietLeeg: nietLeeg.length,
    aantalDistinct: distincteWaarden.length,
    distincteWaardenVoorbeeld: voorbeeldWaarden,
    aantalRegelsPerWaarde,
    komtVoorBijKostensoort9600: nietLeeg.some((r) => r.kostensoort === KOSTENSOORT_9600),
    komtVoorBijAndereKostensoorten: nietLeeg.some((r) => r.kostensoort !== KOSTENSOORT_9600),
  };
}

export interface ServicekostenAfrekeningDiagnoseTekenpatroon {
  kostensoortSoortWaarde: string;
  aantalAlleenDebet: number;
  aantalAlleenCredit: number;
  aantalBeideNul: number;
  aantalBeideNietNul: number;
  voorbeeldenBeideNietNul: BegrensdeLijst<string>;
}

function bouwTekenpatroon(regels: readonly ServicekostenAfrekeningDiagnoseRegel[]): ServicekostenAfrekeningDiagnoseTekenpatroon[] {
  const perWaarde = new Map<string, ServicekostenAfrekeningDiagnoseRegel[]>();
  for (const regel of regels) {
    const sleutel = regel.kostensoortSoort ?? "(leeg)";
    const groep = perWaarde.get(sleutel) ?? [];
    groep.push(regel);
    perWaarde.set(sleutel, groep);
  }
  return Array.from(perWaarde.entries())
    .map(([kostensoortSoortWaarde, groep]) => {
      const alleenDebet = groep.filter((r) => !r.bedragDebet.isZero() && r.bedragCredit.isZero());
      const alleenCredit = groep.filter((r) => r.bedragDebet.isZero() && !r.bedragCredit.isZero());
      const beideNul = groep.filter((r) => r.bedragDebet.isZero() && r.bedragCredit.isZero());
      const beideNietNul = groep.filter((r) => !r.bedragDebet.isZero() && !r.bedragCredit.isZero());
      return {
        kostensoortSoortWaarde,
        aantalAlleenDebet: alleenDebet.length,
        aantalAlleenCredit: alleenCredit.length,
        aantalBeideNul: beideNul.length,
        aantalBeideNietNul: beideNietNul.length,
        voorbeeldenBeideNietNul: begrens(beideNietNul.map((r) => natuurlijkeSleutel(r)), MAX_VOORBEELD_ITEMS),
      };
    })
    .sort((a, b) => a.kostensoortSoortWaarde.localeCompare(b.kostensoortSoortWaarde));
}

export interface ServicekostenAfrekeningDiagnoseSaldoAfwijking {
  natuurlijkeSleutel: string;
  bronSaldo: Decimal;
  herberekendSaldo: Decimal;
}

export interface ServicekostenAfrekeningDiagnoseBronSaldoVergelijking {
  aantalVergeleken: number;
  aantalGelijk: number;
  aantalAfwijkend: number;
  voorbeeldenAfwijkend: BegrensdeLijst<ServicekostenAfrekeningDiagnoseSaldoAfwijking>;
}

/** Uitsluitend Decimal-vergelijking (`.equals`) — nooit JS floating point/Number-conversie. */
function vergelijkBronSaldo(regels: readonly ServicekostenAfrekeningDiagnoseRegel[]): ServicekostenAfrekeningDiagnoseBronSaldoVergelijking {
  const vergelijkbaar = regels.filter((r) => r.bronBoekingSaldo !== null);
  const afwijkend = vergelijkbaar.filter((r) => !r.bronBoekingSaldo!.equals(r.saldo));
  return {
    aantalVergeleken: vergelijkbaar.length,
    aantalGelijk: vergelijkbaar.length - afwijkend.length,
    aantalAfwijkend: afwijkend.length,
    voorbeeldenAfwijkend: begrens(
      afwijkend.map((r) => ({ natuurlijkeSleutel: natuurlijkeSleutel(r), bronSaldo: r.bronBoekingSaldo!, herberekendSaldo: r.saldo })),
      MAX_VOORBEELD_ITEMS,
    ),
  };
}

export interface ServicekostenAfrekeningDiagnoseControleItem {
  ernst: "WAARSCHUWING" | "INFORMATIEF";
  bericht: string;
}

export interface ServicekostenAfrekeningDiagnoseResultaat {
  aantalRegelsTotaal: number;
  perKostensoortSoort: {
    kostensoortSoortWaarde: string;
    aantalRegels: number;
    debet: Decimal;
    credit: Decimal;
    saldo: Decimal;
    kostensoorten: BegrensdeLijst<ServicekostenAfrekeningDiagnoseKostensoortTotaal>;
  }[];
  voorschotten: ServicekostenAfrekeningDiagnoseStroomSectie & { bevat2000: boolean };
  kosten: ServicekostenAfrekeningDiagnoseStroomSectie;
  kostensoort9600: ServicekostenAfrekeningDiagnoseKostensoort9600Sectie;
  afrekeningsveldenAnalyse: ServicekostenAfrekeningDiagnoseVeldAnalyse[];
  tekenpatroon: ServicekostenAfrekeningDiagnoseTekenpatroon[];
  bronSaldoVsHerberekend: ServicekostenAfrekeningDiagnoseBronSaldoVergelijking;
  controleVereist: ServicekostenAfrekeningDiagnoseControleItem[];
}

const VERWACHTE_KOSTENSOORT_SOORT_WAARDEN = new Set(["Kosten", "Voorschotten", "Nvt"]);

export function diagnoseerServicekostenAfrekening(regels: readonly ServicekostenAfrekeningDiagnoseRegel[]): ServicekostenAfrekeningDiagnoseResultaat {
  const controleVereist: ServicekostenAfrekeningDiagnoseControleItem[] = [];

  // ── Per Kostensoort_Soort (letterlijke bronwaarde, ongefilterd) ────────
  const perSoortMap = new Map<string, ServicekostenAfrekeningDiagnoseRegel[]>();
  for (const regel of regels) {
    const sleutel = regel.kostensoortSoort ?? "(leeg)";
    const groep = perSoortMap.get(sleutel) ?? [];
    groep.push(regel);
    perSoortMap.set(sleutel, groep);
  }
  const perKostensoortSoort = Array.from(perSoortMap.entries())
    .map(([kostensoortSoortWaarde, groep]) => ({
      kostensoortSoortWaarde,
      aantalRegels: groep.length,
      debet: som(groep.map((r) => r.bedragDebet)),
      credit: som(groep.map((r) => r.bedragCredit)),
      saldo: som(groep.map((r) => r.saldo)),
      kostensoorten: kostensoortTotalen(groep),
    }))
    .sort((a, b) => a.kostensoortSoortWaarde.localeCompare(b.kostensoortSoortWaarde));

  for (const soort of perKostensoortSoort) {
    if (soort.kostensoortSoortWaarde !== "(leeg)" && !VERWACHTE_KOSTENSOORT_SOORT_WAARDEN.has(soort.kostensoortSoortWaarde)) {
      controleVereist.push({
        ernst: "WAARSCHUWING",
        bericht: `Onverwachte Kostensoort_Soort-waarde "${soort.kostensoortSoortWaarde}" (${soort.aantalRegels} regel(s)) — buiten de bekende set Kosten/Voorschotten/Nvt.`,
      });
    }
  }

  // ── Voorschotten / Kosten (op de letterlijke waarde gefilterd) ────────
  const voorschottenSectie = bouwStroomSectie(regels, "Voorschotten");
  const voorschotten = { ...voorschottenSectie, bevat2000: voorschottenSectie.kostensoortenGezien.includes("2000") };
  const kosten = bouwStroomSectie(regels, "Kosten");

  const aantalMetKostensoortSoortIngevuld = regels.filter((r) => r.kostensoortSoort !== null).length;
  if (voorschotten.aantalRegels === 0 && aantalMetKostensoortSoortIngevuld > 0) {
    controleVereist.push({
      ernst: "INFORMATIEF",
      bericht: `Geen regels met Kostensoort_Soort exact "Voorschotten" gevonden (wel ${aantalMetKostensoortSoortIngevuld} regels met een ingevulde Kostensoort_Soort) — zie perKostensoortSoort voor de daadwerkelijke waarden.`,
    });
  }
  if (kosten.aantalRegels === 0 && aantalMetKostensoortSoortIngevuld > 0) {
    controleVereist.push({
      ernst: "INFORMATIEF",
      bericht: `Geen regels met Kostensoort_Soort exact "Kosten" gevonden (wel ${aantalMetKostensoortSoortIngevuld} regels met een ingevulde Kostensoort_Soort) — zie perKostensoortSoort voor de daadwerkelijke waarden.`,
    });
  }
  if (voorschotten.aantalRegelsZonderContractOfHuurder > 0) {
    controleVereist.push({ ernst: "INFORMATIEF", bericht: `${voorschotten.aantalRegelsZonderContractOfHuurder} voorschotten-regel(s) hebben geen contractnummer én geen huurdernummer.` });
  }
  if (kosten.aantalRegelsZonderContractOfHuurder > 0) {
    controleVereist.push({ ernst: "INFORMATIEF", bericht: `${kosten.aantalRegelsZonderContractOfHuurder} kosten-regel(s) hebben geen contractnummer én geen huurdernummer.` });
  }

  // ── Kostensoort 9600 (expliciet onderzoeksfilter, op verzoek van de gebruiker) ──
  const kostensoort9600 = bouwKostensoort9600Sectie(regels);
  if (kostensoort9600.aantalRegels > 0) {
    controleVereist.push({
      ernst: "INFORMATIEF",
      bericht: `Kostensoort 9600: ${kostensoort9600.aantalRegels} regel(s), Kostensoort_Soort-waarden gezien: ${kostensoort9600.kostensoortSoortWaardenGezien.join(", ")}.`,
    });
  }

  // ── Afrekeningsvelden (puur signalerend, geen semantische conclusie) ──
  const afrekeningsveldenAnalyse: ServicekostenAfrekeningDiagnoseVeldAnalyse[] = [
    analyseerVeld(regels, "Service_BK_Jaar_Afrekening", (r) => r.jaarAfrekening),
    analyseerVeld(regels, "Service_BK_Jaar_SV_Afrekening", (r) => r.jaarSvAfrekening),
    analyseerVeld(regels, "Service_BK_Per_SV_Afrekening", (r) => r.perSvAfrekening),
    analyseerVeld(regels, "Service_BK_Periode_Afrekening", (r) => r.periodeAfrekening),
    analyseerVeld(regels, "Service_BK_SV_Afrekening_Soort", (r) => r.svAfrekeningSoort),
    analyseerVeld(regels, "Service_BK_SV_Afrekening_Soort_Omschrijving", (r) => r.svAfrekeningSoortOmschrijving),
    analyseerVeld(regels, "Service_BK_SV_Afrekening_Vlgnr", (r) => r.svAfrekeningVlgnr),
    analyseerVeld(regels, "Service_BK_Vdsrt_Opbrengsten", (r) => r.vdsrtOpbrengsten),
    analyseerVeld(regels, "Service_BK_Vdsrt_Omschr", (r) => r.vdsrtOmschr),
  ];

  // ── Tekenpatroon per Kostensoort_Soort ─────────────────────────────────
  const tekenpatroon = bouwTekenpatroon(regels);
  for (const patroon of tekenpatroon) {
    if (patroon.aantalBeideNietNul > 0) {
      controleVereist.push({
        ernst: "WAARSCHUWING",
        bericht: `Kostensoort_Soort "${patroon.kostensoortSoortWaarde}": ${patroon.aantalBeideNietNul} regel(s) hebben zowel debet als credit niet-nul.`,
      });
    }
  }

  // ── Service_Boeking_Saldo vs. lokaal herberekend (debet - credit) ─────
  const bronSaldoVsHerberekend = vergelijkBronSaldo(regels);
  if (bronSaldoVsHerberekend.aantalAfwijkend > 0) {
    controleVereist.push({
      ernst: "WAARSCHUWING",
      bericht: `${bronSaldoVsHerberekend.aantalAfwijkend} van ${bronSaldoVsHerberekend.aantalVergeleken} regels met een Service_Boeking_Saldo-bronwaarde wijken af van het lokaal herberekende saldo (debet - credit).`,
    });
  }

  return {
    aantalRegelsTotaal: regels.length,
    perKostensoortSoort,
    voorschotten,
    kosten,
    kostensoort9600,
    afrekeningsveldenAnalyse,
    tekenpatroon,
    bronSaldoVsHerberekend,
    controleVereist,
  };
}
