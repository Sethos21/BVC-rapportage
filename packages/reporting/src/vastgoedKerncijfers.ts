import Decimal from "decimal.js";
import type { OnbekendOf } from "@bvc/domain";

/**
 * Vastgoed-KPI's v1 (2026-08-26): bezettingsgraad/leegstand per complex +
 * portefeuille. STRIKT GESCHEIDEN van de financiële periodeberekeningen
 * (plPeriodeBerekening.ts/balansPeriodeBerekening.ts/
 * kasstroomManagementoverzicht.ts/kerncijfersManagement.ts) — geen import
 * van, of afhankelijkheid op, die modules; geen boekjaar/periode; eigen,
 * lokale invoertypen (geen `Boekingsregel`).
 *
 * Bronkeuze — voor 070_Rooise_Zoom inhoudelijk bottom-up gereconcilieerd
 * (zie packages/reporting/README.md), NIET vastgelegd als universele
 * boekhoudkundige waarheid voor elke toekomstige bron/administratie:
 * afwijkingen blijven altijd zichtbaar via `controleVereist`, nooit
 * stilzwijgend gecorrigeerd.
 * - Totale VVO per complex = som van `units.VVO`.
 * - Verhuurde VVO per complex = som van `rentroll.gehuurd_oppervlak` voor
 *   regels met `gehuurd_oppervlak > 0`.
 * - `complex_totalen` is UITSLUITEND een onafhankelijke controlebron —
 *   nooit een fallback voor een ontbrekende/afwijkende units-/
 *   rentroll-waarde.
 * - `contracten` is in v1 GEEN bron voor oppervlakte: bij 070 is
 *   aangetoond dat een contract zonder `unitnr` meerdere units kan
 *   omvatten (contract 0000000043, complex 001, 750 m² over
 *   vermoedelijk 2 units) — een unit-niveau-telling op basis van
 *   `contracten` zou dat stilzwijgend missen. Om diezelfde reden wordt in
 *   v1 ook geen "aantal verhuurde units"-KPI gebouwd.
 *
 * Momentopname: geen van de drie bronnen heeft een betrouwbare,
 * gezamenlijke historische periodeselectie (zie onderzoek 2026-08-26) —
 * dit is dus altijd een actuele bronstand, nooit een boekjaar/periode-
 * gebonden cijfer. `rentroll.rapportage_datum` wordt uitsluitend als
 * `bronPeildatum` gerapporteerd als ALLE aangeleverde, niet-lege waarden
 * identiek zijn — anders `null` (nooit een peildatum verzinnen/kiezen).
 */

export type VastgoedControleErnst = "KRITIEK" | "WAARSCHUWING" | "INFORMATIEF";

export interface VastgoedControleItem {
  /** `null` = niet aan één specifiek complex toe te wijzen (bv. een rentroll-regel zonder complexnummer). */
  complexnr: string | null;
  ernst: VastgoedControleErnst;
  bericht: string;
}

export interface VastgoedUnitRegel {
  complexnr: string;
  unitnr: string;
  vvo: Decimal | null;
}

export interface VastgoedRentrollRegel {
  contractnummer: string;
  complexnr: string | null;
  gehuurdOppervlak: Decimal | null;
  prolongatieBedragJaar: Decimal | null;
  rapportageDatum: Date | null;
}

export interface VastgoedComplexTotaalRegel {
  complexnr: string;
  totaalOppervlakte: Decimal | null;
  totaalVerhuurd: Decimal | null;
  totaalLeegstand: Decimal | null;
}

export interface VastgoedKpiWaarden {
  totaalVvo: OnbekendOf<Decimal>;
  verhuurdeVvo: OnbekendOf<Decimal>;
  leegstandVvo: OnbekendOf<Decimal>;
  bezettingsgraad: OnbekendOf<Decimal>;
  leegstandspercentage: OnbekendOf<Decimal>;
}

export interface VastgoedComplexKpi extends VastgoedKpiWaarden {
  complexnr: string;
}

export interface VastgoedKerncijfersResultaat {
  /** Altijd `true` in v1: een actuele bronstand, geen boekjaar/periode-gebonden cijfer. */
  momentopname: true;
  bronPeildatum: Date | null;
  portefeuille: VastgoedKpiWaarden;
  perComplex: VastgoedComplexKpi[];
  controleVereist: VastgoedControleItem[];
}

/** Simpele optelling, bewust GEEN `telOpMetAfronding` (@bvc/domain) — dat is een geldbedragen-afrondingshelper (centen), niet van toepassing op m². */
function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function isBekend<T>(waarde: OnbekendOf<T>): waarde is { type: "bekend"; waarde: T } {
  return waarde.type === "bekend";
}

/** Alleen een peildatum als ALLE aangeleverde, niet-lege rapportage_datum-waarden identiek zijn — anders `null`, nooit gekozen/verzonnen. */
function bepaalBronPeildatum(rentroll: readonly VastgoedRentrollRegel[]): Date | null {
  const datums = new Set(rentroll.map((r) => r.rapportageDatum?.toISOString()).filter((d): d is string => d !== undefined));
  if (datums.size !== 1) return null;
  return rentroll.find((r) => r.rapportageDatum !== null)?.rapportageDatum ?? null;
}

function groepeerPerComplex<T>(regels: readonly T[], complexnrVan: (regel: T) => string | null): Map<string, T[]> {
  const groepen = new Map<string, T[]>();
  for (const regel of regels) {
    const complexnr = complexnrVan(regel);
    if (complexnr === null) continue;
    const bestaand = groepen.get(complexnr);
    if (bestaand) bestaand.push(regel);
    else groepen.set(complexnr, [regel]);
  }
  return groepen;
}

/**
 * Combineert totaalVvo/verhuurdeVvo tot leegstand/bezettingsgraad/
 * leegstandspercentage. `onbekend` als één van beide invoerwaarden
 * onbekend is (nooit een deelresultaat op basis van een onvolledige som).
 * `verhuurd > totaal` is KRITIEK: dan wordt GEEN negatieve leegstand of
 * bezettingsgraad >100% berekend — de afgeleide velden worden `onbekend`,
 * totaalVvo/verhuurdeVvo zelf blijven zichtbaar (bekend) zodat de melding
 * de werkelijke bedragen kan tonen.
 */
function berekenKpiWaarden(totaalVvo: OnbekendOf<Decimal>, verhuurdeVvo: OnbekendOf<Decimal>, complexnr: string | null): { waarden: VastgoedKpiWaarden; issues: VastgoedControleItem[] } {
  if (!isBekend(totaalVvo) || !isBekend(verhuurdeVvo)) {
    const reden = !isBekend(totaalVvo) ? totaalVvo.reden : !isBekend(verhuurdeVvo) ? verhuurdeVvo.reden : "";
    const onbekend: OnbekendOf<Decimal> = { type: "onbekend", reden };
    return { waarden: { totaalVvo, verhuurdeVvo, leegstandVvo: onbekend, bezettingsgraad: onbekend, leegstandspercentage: onbekend }, issues: [] };
  }

  const totaal = totaalVvo.waarde;
  const verhuurd = verhuurdeVvo.waarde;

  if (verhuurd.greaterThan(totaal)) {
    const reden = `Verhuurde VVO (${verhuurd.toString()} m²) is groter dan totale VVO (${totaal.toString()} m²) — geen negatieve leegstand of bezettingsgraad >100% berekend.`;
    const onbekend: OnbekendOf<Decimal> = { type: "onbekend", reden };
    return {
      waarden: { totaalVvo, verhuurdeVvo, leegstandVvo: onbekend, bezettingsgraad: onbekend, leegstandspercentage: onbekend },
      issues: [{ complexnr, ernst: "KRITIEK", bericht: reden }],
    };
  }

  const leegstand = totaal.minus(verhuurd);
  if (totaal.isZero()) {
    const onbekend: OnbekendOf<Decimal> = { type: "onbekend", reden: "Totale VVO is nul — bezettingsgraad/leegstandspercentage niet te bepalen (deling door nul)." };
    return { waarden: { totaalVvo, verhuurdeVvo, leegstandVvo: { type: "bekend", waarde: leegstand }, bezettingsgraad: onbekend, leegstandspercentage: onbekend }, issues: [] };
  }

  return {
    waarden: {
      totaalVvo,
      verhuurdeVvo,
      leegstandVvo: { type: "bekend", waarde: leegstand },
      bezettingsgraad: { type: "bekend", waarde: verhuurd.dividedBy(totaal).times(100) },
      leegstandspercentage: { type: "bekend", waarde: leegstand.dividedBy(totaal).times(100) },
    },
    issues: [],
  };
}

/** `complex_totalen` is uitsluitend controlebron: alleen signaleren bij afwijking, nooit gebruiken om `berekend` te vervangen. */
function vergelijkMetControlebron(complexnr: string, veld: string, berekend: OnbekendOf<Decimal>, controlewaarde: Decimal | null, controleVereist: VastgoedControleItem[]): void {
  if (!isBekend(berekend) || controlewaarde === null) return;
  if (berekend.waarde.equals(controlewaarde)) return;
  controleVereist.push({
    complexnr,
    ernst: "WAARSCHUWING",
    bericht: `complex_totalen.${veld} (${controlewaarde.toString()} m²) wijkt af van de bottom-up berekening (${berekend.waarde.toString()} m²) voor complex ${complexnr} — complex_totalen is een controlebron, niet gebruikt om de KPI te corrigeren.`,
  });
}

export function berekenVastgoedKerncijfers(
  units: readonly VastgoedUnitRegel[],
  rentroll: readonly VastgoedRentrollRegel[],
  complexTotalen: readonly VastgoedComplexTotaalRegel[],
): VastgoedKerncijfersResultaat {
  const controleVereist: VastgoedControleItem[] = [];

  for (const regel of rentroll.filter((r) => r.complexnr === null)) {
    controleVereist.push({
      complexnr: null,
      ernst: "WAARSCHUWING",
      bericht: `Rentroll-regel voor contract ${regel.contractnummer} heeft geen complexnummer — niet toe te wijzen aan een complex, buiten alle sommen gehouden.`,
    });
  }

  // Totale VVO per complex (units) — regel 4 (null nooit als 0) + regel 5 (VVO=0 informatief, niet meegeteld — draagt toch 0 bij).
  const unitsPerComplex = groepeerPerComplex(units, (u) => u.complexnr);
  const totaalVvoPerComplex = new Map<string, OnbekendOf<Decimal>>();
  for (const [complexnr, regels] of unitsPerComplex) {
    const zonderVvo = regels.filter((r) => r.vvo === null);
    if (zonderVvo.length > 0) {
      const reden = `${zonderVvo.length} unit(s) zonder geregistreerde VVO in complex ${complexnr} (${zonderVvo.map((r) => r.unitnr).join(", ")}) — totale VVO niet te bepalen.`;
      totaalVvoPerComplex.set(complexnr, { type: "onbekend", reden });
      controleVereist.push({ complexnr, ernst: "WAARSCHUWING", bericht: reden });
      continue;
    }
    const nulVvo = regels.filter((r) => r.vvo!.isZero());
    if (nulVvo.length > 0) {
      controleVereist.push({
        complexnr,
        ernst: "INFORMATIEF",
        bericht: `${nulVvo.length} unit(s) met VVO = 0 m² in complex ${complexnr} (${nulVvo.map((r) => r.unitnr).join(", ")}) — niet relevant voor vloeroppervlak-KPI's.`,
      });
    }
    totaalVvoPerComplex.set(complexnr, { type: "bekend", waarde: som(regels.map((r) => r.vvo!)) });
  }

  // Verhuurde VVO per complex (rentroll) — regels 4/6/7.
  const rentrollPerComplex = groepeerPerComplex(rentroll, (r) => r.complexnr);
  const verhuurdeVvoPerComplex = new Map<string, OnbekendOf<Decimal>>();
  for (const [complexnr, regels] of rentrollPerComplex) {
    const zonderOppervlak = regels.filter((r) => r.gehuurdOppervlak === null);
    if (zonderOppervlak.length > 0) {
      const reden = `${zonderOppervlak.length} rentroll-regel(s) zonder geregistreerd gehuurd_oppervlak in complex ${complexnr} (contract(en) ${zonderOppervlak.map((r) => r.contractnummer).join(", ")}) — verhuurde VVO niet te bepalen.`;
      verhuurdeVvoPerComplex.set(complexnr, { type: "onbekend", reden });
      controleVereist.push({ complexnr, ernst: "WAARSCHUWING", bericht: reden });
      continue;
    }

    const positief: Decimal[] = [];
    for (const regel of regels) {
      const oppervlak = regel.gehuurdOppervlak!;
      if (oppervlak.isNegative()) {
        controleVereist.push({
          complexnr,
          ernst: "KRITIEK",
          bericht: `Rentroll-regel voor contract ${regel.contractnummer} in complex ${complexnr} heeft een negatief gehuurd_oppervlak (${oppervlak.toString()} m²) — buiten de som gehouden, geen aanname.`,
        });
        continue;
      }
      if (oppervlak.isZero()) {
        const jaarhuur = regel.prolongatieBedragJaar;
        const afwijkend = jaarhuur !== null && jaarhuur.isPositive();
        controleVereist.push({
          complexnr,
          ernst: afwijkend ? "WAARSCHUWING" : "INFORMATIEF",
          bericht: afwijkend
            ? `Rentroll-regel voor contract ${regel.contractnummer} in complex ${complexnr} heeft 0 m² gehuurd_oppervlak MAAR een positieve jaarhuur (${jaarhuur!.toString()}) — afwijkend patroon, niet meegeteld in de VVO-som.`
            : `Rentroll-regel voor contract ${regel.contractnummer} in complex ${complexnr} heeft 0 m² gehuurd_oppervlak (vermoedelijk een correctie-/kortingsregel) — niet meegeteld in de VVO-som.`,
        });
        continue;
      }
      const jaarhuur = regel.prolongatieBedragJaar;
      if (jaarhuur !== null && jaarhuur.isNegative()) {
        controleVereist.push({
          complexnr,
          ernst: "WAARSCHUWING",
          bericht: `Rentroll-regel voor contract ${regel.contractnummer} in complex ${complexnr} heeft een negatieve jaarhuur (${jaarhuur.toString()}) MAAR gehuurd_oppervlak > 0 (${oppervlak.toString()} m²) — afwijkend patroon, wel meegeteld in de VVO-som.`,
        });
      }
      positief.push(oppervlak);
    }
    verhuurdeVvoPerComplex.set(complexnr, { type: "bekend", waarde: som(positief) });
  }

  // KPI's per complex + reconciliatie tegen complex_totalen (regels 1/2, uitgebreid met Totaal_Leegstand voor symmetrie — vangt bv. een complex waar oppervlakte/verhuurd wél kloppen maar leegstand niet).
  const complexTotaalPerComplex = new Map(complexTotalen.map((c) => [c.complexnr, c] as const));
  const alleComplexen = new Set<string>([...unitsPerComplex.keys(), ...rentrollPerComplex.keys()]);

  const perComplex: VastgoedComplexKpi[] = [];
  for (const complexnr of alleComplexen) {
    const totaalVvo: OnbekendOf<Decimal> = totaalVvoPerComplex.get(complexnr) ?? { type: "onbekend", reden: `Geen units gevonden voor complex ${complexnr}.` };
    const verhuurdeVvo: OnbekendOf<Decimal> = verhuurdeVvoPerComplex.get(complexnr) ?? { type: "onbekend", reden: `Geen rentroll-regels gevonden voor complex ${complexnr}.` };
    const { waarden, issues } = berekenKpiWaarden(totaalVvo, verhuurdeVvo, complexnr);
    controleVereist.push(...issues);

    const controle = complexTotaalPerComplex.get(complexnr);
    if (controle) {
      vergelijkMetControlebron(complexnr, "Totaal_Oppervlakte", waarden.totaalVvo, controle.totaalOppervlakte, controleVereist);
      vergelijkMetControlebron(complexnr, "Totaal_Verhuurd", waarden.verhuurdeVvo, controle.totaalVerhuurd, controleVereist);
      vergelijkMetControlebron(complexnr, "Totaal_Leegstand", waarden.leegstandVvo, controle.totaalLeegstand, controleVereist);
    }

    perComplex.push({ complexnr, ...waarden });
  }
  perComplex.sort((a, b) => a.complexnr.localeCompare(b.complexnr));

  // Portefeuille: alleen optellen als geen enkel complex KRITIEK-geblokkeerd is en alle complexen bekend zijn.
  const kritiekComplexen = new Set(controleVereist.filter((i) => i.ernst === "KRITIEK" && i.complexnr !== null).map((i) => i.complexnr));
  let portefeuille: VastgoedKpiWaarden;
  if (kritiekComplexen.size > 0) {
    const onbekend: OnbekendOf<Decimal> = {
      type: "onbekend",
      reden: `Portefeuilletotaal niet bepaald: complex(en) ${Array.from(kritiekComplexen).join(", ")} hebben een kritieke afwijking (verhuurde VVO > totale VVO).`,
    };
    portefeuille = { totaalVvo: onbekend, verhuurdeVvo: onbekend, leegstandVvo: onbekend, bezettingsgraad: onbekend, leegstandspercentage: onbekend };
  } else if (!perComplex.every((c) => isBekend(c.totaalVvo) && isBekend(c.verhuurdeVvo))) {
    const onbekend: OnbekendOf<Decimal> = { type: "onbekend", reden: "Portefeuilletotaal niet volledig bepaald: één of meer complexen hebben een onbekende totale of verhuurde VVO." };
    portefeuille = { totaalVvo: onbekend, verhuurdeVvo: onbekend, leegstandVvo: onbekend, bezettingsgraad: onbekend, leegstandspercentage: onbekend };
  } else {
    const totaalVvo = som(perComplex.map((c) => (isBekend(c.totaalVvo) ? c.totaalVvo.waarde : new Decimal(0))));
    const verhuurdeVvo = som(perComplex.map((c) => (isBekend(c.verhuurdeVvo) ? c.verhuurdeVvo.waarde : new Decimal(0))));
    portefeuille = berekenKpiWaarden({ type: "bekend", waarde: totaalVvo }, { type: "bekend", waarde: verhuurdeVvo }, null).waarden;
  }

  return { momentopname: true, bronPeildatum: bepaalBronPeildatum(rentroll), portefeuille, perComplex, controleVereist };
}
