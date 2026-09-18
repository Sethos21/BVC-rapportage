import Decimal from "decimal.js";
import type { OnbekendOf } from "./types.js";

/**
 * Vastgoed- en contractberekeningen uit 04_BEREKENINGSDEFINITIES_v0.3.md.
 * Zelfde regel als finance.ts: dit zijn de centrale, herbruikbare
 * definities — geen rapportlokale herimplementatie.
 */

export type OppervlakteBron = "Unit_VVO" | "Unit_BVO" | "Gehuurd_oppervlak";

/**
 * CAL-VG-002 — Verhuurbare oppervlakte volgens de vaste voorkeursvolgorde:
 * Unit_VVO > 0, anders Unit_BVO > 0, anders Gehuurd_oppervlak > 0,
 * anders "Onbekend - oppervlakte niet onderhouden". Nooit optellen/middelen.
 */
export function bepaalOppervlakte(input: {
  unitVvo: Decimal | null;
  unitBvo: Decimal | null;
  gehuurdOppervlak: Decimal | null;
}): { bron: OppervlakteBron; waarde: Decimal } | { bron: "onbekend"; reden: "oppervlakte niet onderhouden" } {
  if (input.unitVvo !== null && input.unitVvo.greaterThan(0)) {
    return { bron: "Unit_VVO", waarde: input.unitVvo };
  }
  if (input.unitBvo !== null && input.unitBvo.greaterThan(0)) {
    return { bron: "Unit_BVO", waarde: input.unitBvo };
  }
  if (input.gehuurdOppervlak !== null && input.gehuurdOppervlak.greaterThan(0)) {
    return { bron: "Gehuurd_oppervlak", waarde: input.gehuurdOppervlak };
  }
  return { bron: "onbekend", reden: "oppervlakte niet onderhouden" };
}

export type Unitstatus = "verhuurd" | "mogelijk_leeg_controle_vereist";

/** CAL-VG-001 — actieve verhuurbare unit + geldige contractmatch = verhuurd; zonder match = signaal, nooit "bewezen leeg". */
export function bepaalUnitstatus(heeftGeldigContract: boolean): Unitstatus {
  return heeftGeldigContract ? "verhuurd" : "mogelijk_leeg_controle_vereist";
}

/** CAL-VG-003 — Bezettingsgraad units = verhuurde actieve units / actieve verhuurbare units x 100%. Nooit boven 100%. */
export function bezettingsgraadUnits(verhuurdeUnits: number, actieveVerhuurbareUnits: number): OnbekendOf<Decimal> {
  if (actieveVerhuurbareUnits <= 0) {
    return { type: "onbekend", reden: "geen actieve verhuurbare units" };
  }
  const pct = new Decimal(verhuurdeUnits).dividedBy(actieveVerhuurbareUnits).times(100);
  if (pct.greaterThan(100)) {
    throw new Error(
      `Bezettingsgraad ${pct.toString()}% overschrijdt 100% — publicatieblokkade (PAR-VG-001), geen stille correctie.`,
    );
  }
  return { type: "bekend", waarde: pct };
}

/**
 * CAL-CTR-001 — Actuele jaarhuur = SOM(Prolongatie_bedrag_jaar) voor RentRoll-regels
 * met Vorderingsoort = "01" en geldig contract op peildatum.
 */
export function actueleJaarhuur(
  rentrollRegels: readonly { vorderingsoort: string; prolongatieBedragJaar: Decimal; contractGeldigOpPeildatum: boolean }[],
): Decimal {
  return rentrollRegels
    .filter((regel) => regel.vorderingsoort === "01" && regel.contractGeldigOpPeildatum)
    .reduce((totaal, regel) => totaal.plus(regel.prolongatieBedragJaar), new Decimal(0));
}

/** CAL-CTR-002 — Huurprijs per m2 = Prolongatie_bedrag_jaar / Gehuurd_oppervlak. Onbekend bij noemer nul/ontbrekend. */
export function huurprijsPerM2(prolongatieBedragJaar: Decimal, gehuurdOppervlak: Decimal | null): OnbekendOf<Decimal> {
  if (gehuurdOppervlak === null || gehuurdOppervlak.isZero()) {
    return { type: "onbekend", reden: "gehuurd oppervlak nul of ontbrekend" };
  }
  return { type: "bekend", waarde: prolongatieBedragJaar.dividedBy(gehuurdOppervlak) };
}

/** CAL-CTR-003 — Resterende looptijd = relevante einddatum - peildatum. Ontbrekende einddatum is "Onbekend", nooit nul. */
export function resterendeLooptijdDagen(peildatum: Date, relevanteEinddatum: Date | null): OnbekendOf<number> {
  if (relevanteEinddatum === null) {
    return { type: "onbekend", reden: "geen einddatum bekend" };
  }
  const dagen = Math.round((relevanteEinddatum.getTime() - peildatum.getTime()) / (1000 * 60 * 60 * 24));
  return { type: "bekend", waarde: dagen };
}
