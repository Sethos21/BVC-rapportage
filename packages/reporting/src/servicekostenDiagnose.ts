import Decimal from "decimal.js";

/**
 * Servicekosten-diagnose (2026-08-26) — TIJDELIJK, ALLEEN-LEZEN: puur
 * signalerend/inventariserend overzicht van de servicekostenbron, exact
 * naar het patroon van `rentrollDiagnose.ts`/`kasstroomTegenrekeningDiagnose.ts`.
 * Geen KPI, geen classificatie van voorschot/afrekening/doorbelastbaar,
 * geen mapping — dat is precies waar dit instrument een antwoord op moet
 * helpen vinden vóórdat een echte servicekosten-rekenmodule gebouwd wordt.
 * Wijzigt niets aan `controlerapport.ts`'s `berekenServicekostenPerKostensoort`
 * of enige andere bestaande rekenfunctie.
 *
 * Belangrijke aanvulling (gebruiker, 2026-08-26): kostensoortcode alleen
 * is niet genoeg — de gebruiker gaf aan dat grootboek 1712 de werkelijke/
 * geboekte servicekosten bevat (uitgesplitst naar kostensoort) en grootboek
 * 1711 de vooraf ontvangen voorschotten, en dat bv. kostensoort "2000"
 * onder 1711 iets anders betekent dan diezelfde code elders. De
 * servicekosten-brontabel zelf heeft geen grootboekrekening-veld — de
 * enige technische link naar een grootboekrekening is een JOIN met de
 * `boekingen`-tabel op (bedrijfsnr, boekjaar, dagboeknummer, boekstuknummer,
 * volgnummer), dezelfde velden die de natuurlijke sleutel van een
 * servicekostenregel vormen. Of die sleutel daadwerkelijk matcht (dezelfde
 * dagboek-/boekstuk-/volgnummering in beide bronnen) is NIET bevestigd —
 * dat is precies wat `boekingKoppeling` hieronder meet, geen aanname.
 */

export interface ServicekostenDiagnoseRegel {
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
  doorbelasten: string | null;
  uitsluitingsstatus: string;
}

export interface ServicekostenDiagnoseBoekingRegel {
  dagboeknr: string;
  boekstuknr: string;
  volgnr: string;
  grootboeknr: string;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
}

/** Begrensde lijst — `aantalTotaal` blijft het werkelijke aantal, `voorbeeld` is nooit stilzwijgend de volledige (mogelijk honderden regels lange) lijst. */
export interface ServicekostenDiagnoseBegrensdeLijst<T> {
  aantalTotaal: number;
  voorbeeld: T[];
}

const MAX_OMSCHRIJVINGEN_VOORBEELD = 10;

function begrensOmschrijvingen(waarden: readonly string[]): ServicekostenDiagnoseBegrensdeLijst<string> {
  return { aantalTotaal: waarden.length, voorbeeld: waarden.slice(0, MAX_OMSCHRIJVINGEN_VOORBEELD) };
}

export interface ServicekostenDiagnoseKostensoortTotaal {
  kostensoort: string;
  /** Alle DISTINCT omschrijvingen gezien bij deze code (begrensd) — meer dan 1 is een signaal (zie controleVereist). */
  omschrijvingen: ServicekostenDiagnoseBegrensdeLijst<string>;
  debet: Decimal;
  credit: Decimal;
  saldo: Decimal;
  aantalRegels: number;
}

export interface ServicekostenDiagnoseComplexTotaal {
  complexnummer: string | null;
  aantalRegels: number;
  debet: Decimal;
  credit: Decimal;
  saldo: Decimal;
  kostensoorten: string[];
}

export interface ServicekostenDiagnoseUnitContractTotaal {
  complexnummer: string | null;
  unitnummer: string | null;
  contractnummer: string | null;
  huurdernummer: string | null;
  aantalRegels: number;
  debet: Decimal;
  credit: Decimal;
  saldo: Decimal;
  kostensoorten: string[];
}

export interface ServicekostenDiagnoseKostensoortOmschrijvingCombinatie {
  kostensoort: string;
  omschrijving: string | null;
  aantalRegels: number;
}

export interface ServicekostenDiagnoseGekoppeldTotaal {
  kostensoort: string;
  grootboekrekening: string;
  aantalRegels: number;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
  saldo: Decimal;
}

export interface ServicekostenDiagnoseNietGekoppeldVoorbeeld {
  natuurlijkeSleutel: string;
  kostensoort: string;
  saldo: Decimal;
}

export interface ServicekostenDiagnoseBoekingKoppeling {
  methode: string;
  aantalGekoppeld: number;
  aantalNietGekoppeld: number;
  perKostensoortGrootboekrekening: ServicekostenDiagnoseGekoppeldTotaal[];
  /** Eerste (maximaal 20) niet-gekoppelde regels, puur om de koppelmethode te kunnen debuggen. */
  voorbeeldenNietGekoppeld: ServicekostenDiagnoseNietGekoppeldVoorbeeld[];
}

export interface ServicekostenDiagnoseNietEenduidigeRegel {
  natuurlijkeSleutel: string;
  reden: string;
}

export interface ServicekostenDiagnoseControleItem {
  ernst: "WAARSCHUWING" | "INFORMATIEF";
  bericht: string;
}

export interface ServicekostenDiagnoseResultaat {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiodeTotEnMet: string;
  aantalRegelsTotaal: number;
  perKostensoort: ServicekostenDiagnoseKostensoortTotaal[];
  perComplex: ServicekostenDiagnoseComplexTotaal[];
  perUnitContract: ServicekostenDiagnoseUnitContractTotaal[];
  aantalRegelsZonderUnitOfContract: number;
  kostensoortOmschrijvingCombinaties: ServicekostenDiagnoseKostensoortOmschrijvingCombinatie[];
  boekingKoppeling: ServicekostenDiagnoseBoekingKoppeling;
  nietEenduidigeRegels: ServicekostenDiagnoseNietEenduidigeRegel[];
  doorbelastenWaardenGezien: string[];
  controleVereist: ServicekostenDiagnoseControleItem[];
}

function natuurlijkeSleutel(regel: ServicekostenDiagnoseRegel): string {
  return [regel.bedrijfsnr, regel.boekjaar, regel.boekperiode, regel.dagboeknummer, regel.boekstuknummer, regel.volgnummer].join("::");
}

function boekingSleutel(dagboeknr: string, boekstuknr: string, volgnr: string): string {
  return [dagboeknr, boekstuknr, volgnr].join("::");
}

/** Gedeeld met `servicekostenAfrekeningDiagnose.ts` — geen tweede optelhulp. */
export function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

export function diagnoseerServicekosten(
  servicekosten: readonly ServicekostenDiagnoseRegel[],
  boekingen: readonly ServicekostenDiagnoseBoekingRegel[],
  criteria: { bedrijfsnr: string; boekjaar: number; boekperiodeTotEnMet: string },
): ServicekostenDiagnoseResultaat {
  const controleVereist: ServicekostenDiagnoseControleItem[] = [];

  // ── Per kostensoort ──────────────────────────────────────────────────
  const perKostensoortMap = new Map<string, ServicekostenDiagnoseRegel[]>();
  for (const regel of servicekosten) {
    const groep = perKostensoortMap.get(regel.kostensoort) ?? [];
    groep.push(regel);
    perKostensoortMap.set(regel.kostensoort, groep);
  }
  const perKostensoort: ServicekostenDiagnoseKostensoortTotaal[] = Array.from(perKostensoortMap.entries())
    .map(([kostensoort, groep]) => {
      const omschrijvingen = Array.from(new Set(groep.map((r) => r.omschrijving ?? r.kostensoortOmschrijving ?? "(leeg)"))).sort();
      return {
        kostensoort,
        omschrijvingen: begrensOmschrijvingen(omschrijvingen),
        debet: som(groep.map((r) => r.bedragDebet)),
        credit: som(groep.map((r) => r.bedragCredit)),
        saldo: som(groep.map((r) => r.saldo)),
        aantalRegels: groep.length,
      };
    })
    .sort((a, b) => a.kostensoort.localeCompare(b.kostensoort));

  for (const kt of perKostensoort) {
    if (kt.omschrijvingen.aantalTotaal > 1) {
      controleVereist.push({
        ernst: "WAARSCHUWING",
        bericht: `Kostensoort ${kt.kostensoort} komt voor met ${kt.omschrijvingen.aantalTotaal} verschillende omschrijvingen: ${kt.omschrijvingen.voorbeeld.map((o) => `"${o}"`).join(", ")}${kt.omschrijvingen.aantalTotaal > kt.omschrijvingen.voorbeeld.length ? ", ..." : ""}.`,
      });
    }
  }

  // ── Per complex ──────────────────────────────────────────────────────
  const perComplexMap = new Map<string | null, ServicekostenDiagnoseRegel[]>();
  for (const regel of servicekosten) {
    const groep = perComplexMap.get(regel.complexnummer) ?? [];
    groep.push(regel);
    perComplexMap.set(regel.complexnummer, groep);
  }
  const perComplex: ServicekostenDiagnoseComplexTotaal[] = Array.from(perComplexMap.entries())
    .map(([complexnummer, groep]) => ({
      complexnummer,
      aantalRegels: groep.length,
      debet: som(groep.map((r) => r.bedragDebet)),
      credit: som(groep.map((r) => r.bedragCredit)),
      saldo: som(groep.map((r) => r.saldo)),
      kostensoorten: Array.from(new Set(groep.map((r) => r.kostensoort))).sort(),
    }))
    .sort((a, b) => (a.complexnummer ?? "").localeCompare(b.complexnummer ?? ""));

  const aantalRegelsZonderComplex = servicekosten.filter((r) => r.complexnummer === null).length;
  if (aantalRegelsZonderComplex > 0) {
    controleVereist.push({ ernst: "INFORMATIEF", bericht: `${aantalRegelsZonderComplex} van ${servicekosten.length} regels hebben geen complexnummer.` });
  }

  // ── Per unit/contract ────────────────────────────────────────────────
  const perUnitContractMap = new Map<string, ServicekostenDiagnoseRegel[]>();
  let aantalRegelsZonderUnitOfContract = 0;
  for (const regel of servicekosten) {
    if (regel.unitnummer === null && regel.contractnummer === null) {
      aantalRegelsZonderUnitOfContract += 1;
      continue;
    }
    const sleutel = [regel.complexnummer, regel.unitnummer, regel.contractnummer, regel.huurdernummer].join("::");
    const groep = perUnitContractMap.get(sleutel) ?? [];
    groep.push(regel);
    perUnitContractMap.set(sleutel, groep);
  }
  const perUnitContract: ServicekostenDiagnoseUnitContractTotaal[] = Array.from(perUnitContractMap.values())
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
        kostensoorten: Array.from(new Set(groep.map((r) => r.kostensoort))).sort(),
      };
    })
    .sort((a, b) => `${a.complexnummer ?? ""}::${a.unitnummer ?? ""}::${a.contractnummer ?? ""}`.localeCompare(`${b.complexnummer ?? ""}::${b.unitnummer ?? ""}::${b.contractnummer ?? ""}`));

  if (aantalRegelsZonderUnitOfContract > 0) {
    controleVereist.push({
      ernst: "INFORMATIEF",
      bericht: `${aantalRegelsZonderUnitOfContract} van ${servicekosten.length} regels hebben geen unitnummer én geen contractnummer.`,
    });
  }

  // ── Kostensoort ↔ omschrijving combinaties ──────────────────────────
  const combinatieMap = new Map<string, { kostensoort: string; omschrijving: string | null; aantalRegels: number }>();
  for (const regel of servicekosten) {
    const sleutel = `${regel.kostensoort}::${regel.omschrijving ?? ""}`;
    const bestaand = combinatieMap.get(sleutel);
    if (bestaand) bestaand.aantalRegels += 1;
    else combinatieMap.set(sleutel, { kostensoort: regel.kostensoort, omschrijving: regel.omschrijving, aantalRegels: 1 });
  }
  const kostensoortOmschrijvingCombinaties = Array.from(combinatieMap.values()).sort(
    (a, b) => a.kostensoort.localeCompare(b.kostensoort) || (a.omschrijving ?? "").localeCompare(b.omschrijving ?? ""),
  );

  // ── Koppeling met boekingen (grootboekrekening-context) ─────────────
  const boekingenPerSleutel = new Map<string, ServicekostenDiagnoseBoekingRegel[]>();
  for (const boeking of boekingen) {
    const sleutel = boekingSleutel(boeking.dagboeknr, boeking.boekstuknr, boeking.volgnr);
    const bestaand = boekingenPerSleutel.get(sleutel);
    if (bestaand) bestaand.push(boeking);
    else boekingenPerSleutel.set(sleutel, [boeking]);
  }

  const gekoppeldMap = new Map<string, { kostensoort: string; grootboekrekening: string; regels: ServicekostenDiagnoseRegel[] }>();
  const voorbeeldenNietGekoppeld: ServicekostenDiagnoseNietGekoppeldVoorbeeld[] = [];
  let aantalGekoppeld = 0;
  let aantalNietGekoppeld = 0;

  for (const regel of servicekosten) {
    const boekingMatches = boekingenPerSleutel.get(boekingSleutel(regel.dagboeknummer, regel.boekstuknummer, regel.volgnummer)) ?? [];
    if (boekingMatches.length === 0) {
      aantalNietGekoppeld += 1;
      if (voorbeeldenNietGekoppeld.length < 20) {
        voorbeeldenNietGekoppeld.push({ natuurlijkeSleutel: natuurlijkeSleutel(regel), kostensoort: regel.kostensoort, saldo: regel.saldo });
      }
      continue;
    }
    aantalGekoppeld += 1;
    for (const boeking of boekingMatches) {
      const sleutel = `${regel.kostensoort}::${boeking.grootboeknr}`;
      const bestaand = gekoppeldMap.get(sleutel);
      if (bestaand) bestaand.regels.push(regel);
      else gekoppeldMap.set(sleutel, { kostensoort: regel.kostensoort, grootboekrekening: boeking.grootboeknr, regels: [regel] });
    }
  }

  const perKostensoortGrootboekrekening: ServicekostenDiagnoseGekoppeldTotaal[] = Array.from(gekoppeldMap.values())
    .map(({ kostensoort, grootboekrekening, regels }) => ({
      kostensoort,
      grootboekrekening,
      aantalRegels: regels.length,
      bedragDebet: som(regels.map((r) => r.bedragDebet)),
      bedragCredit: som(regels.map((r) => r.bedragCredit)),
      saldo: som(regels.map((r) => r.saldo)),
    }))
    .sort((a, b) => a.kostensoort.localeCompare(b.kostensoort) || a.grootboekrekening.localeCompare(b.grootboekrekening));

  const boekingKoppeling: ServicekostenDiagnoseBoekingKoppeling = {
    methode:
      "Join op (bedrijfsnr, boekjaar, dagboeknummer, boekstuknummer, volgnummer) tussen servicekosten en boekingen — ONGEVERIFIEERD of dit de juiste koppelsleutel is, dit commando meet dat.",
    aantalGekoppeld,
    aantalNietGekoppeld,
    perKostensoortGrootboekrekening,
    voorbeeldenNietGekoppeld,
  };

  if (servicekosten.length > 0) {
    const percentageNietGekoppeld = Math.round((aantalNietGekoppeld / servicekosten.length) * 100);
    controleVereist.push({
      ernst: "INFORMATIEF",
      bericht: `${aantalNietGekoppeld} van ${servicekosten.length} servicekostenregels (${percentageNietGekoppeld}%) konden niet aan een boekingsregel gekoppeld worden via (dagboeknummer, boekstuknummer, volgnummer) — koppelmethode nog niet bevestigd.`,
    });
  }

  // ── Niet-eenduidige regels: boekstuk-brede kostensoort/complex-mix ──
  const perBoekstukMap = new Map<string, ServicekostenDiagnoseRegel[]>();
  for (const regel of servicekosten) {
    const sleutel = [regel.bedrijfsnr, regel.boekjaar, regel.dagboeknummer, regel.boekstuknummer].join("::");
    const groep = perBoekstukMap.get(sleutel) ?? [];
    groep.push(regel);
    perBoekstukMap.set(sleutel, groep);
  }
  const nietEenduidigeRegels: ServicekostenDiagnoseNietEenduidigeRegel[] = [];
  let aantalBoekstukkenMetGemengdeKostensoort = 0;
  for (const groep of perBoekstukMap.values()) {
    const kostensoorten = new Set(groep.map((r) => r.kostensoort));
    const complexen = new Set(groep.map((r) => r.complexnummer));
    if (kostensoorten.size > 1 || complexen.size > 1) {
      aantalBoekstukkenMetGemengdeKostensoort += 1;
      const eerste = groep[0]!;
      const redenDelen: string[] = [];
      if (kostensoorten.size > 1) redenDelen.push(`verschillende kostensoorten (${Array.from(kostensoorten).sort().join(", ")})`);
      if (complexen.size > 1) redenDelen.push(`verschillende complexnummers (${Array.from(complexen).map((c) => c ?? "(leeg)").sort().join(", ")})`);
      nietEenduidigeRegels.push({
        natuurlijkeSleutel: `${eerste.bedrijfsnr}::${eerste.boekjaar}::${eerste.dagboeknummer}::${eerste.boekstuknummer}`,
        reden: `Boekstuk heeft regels met ${redenDelen.join(" en ")}.`,
      });
    }
  }
  if (aantalBoekstukkenMetGemengdeKostensoort > 0) {
    controleVereist.push({
      ernst: "WAARSCHUWING",
      bericht: `${aantalBoekstukkenMetGemengdeKostensoort} boekstuk(ken) bevatten meerdere verschillende kostensoorten en/of complexnummers binnen hetzelfde boekstuk.`,
    });
  }

  // ── Doorbelasten-waarden (puur signalerend) ─────────────────────────
  const doorbelastenWaardenGezien = Array.from(new Set(servicekosten.map((r) => r.doorbelasten ?? "(leeg)"))).sort();

  // ── Uitsluitingsstatus-verdeling (informatief) ──────────────────────
  const uitsluitingsstatusAantallen = new Map<string, number>();
  for (const regel of servicekosten) {
    uitsluitingsstatusAantallen.set(regel.uitsluitingsstatus, (uitsluitingsstatusAantallen.get(regel.uitsluitingsstatus) ?? 0) + 1);
  }
  for (const [status, aantal] of uitsluitingsstatusAantallen) {
    if (status === "GEEN") continue;
    controleVereist.push({ ernst: "INFORMATIEF", bericht: `${aantal} regel(s) hebben uitsluitingsstatus ${status}.` });
  }

  return {
    bedrijfsnr: criteria.bedrijfsnr,
    boekjaar: criteria.boekjaar,
    boekperiodeTotEnMet: criteria.boekperiodeTotEnMet,
    aantalRegelsTotaal: servicekosten.length,
    perKostensoort,
    perComplex,
    perUnitContract,
    aantalRegelsZonderUnitOfContract,
    kostensoortOmschrijvingCombinaties,
    boekingKoppeling,
    nietEenduidigeRegels,
    doorbelastenWaardenGezien,
    controleVereist,
  };
}
