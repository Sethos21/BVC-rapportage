import Decimal from "decimal.js";

/**
 * Weergave- en afrondingsregels uit financieleberekeningen.md (huisstijlregel,
 * van toepassing op src/**berekening*, src/**rapport*, src/**exploitatie*,
 * src/utils/**). Hier gecentraliseerd zodat rapportcode nooit zelf afrondt
 * of formatteert — precies de regel "geen berekeningen in de UI-laag".
 */

/** Rond af naar centen. Toepassen ná elke tussenstap, niet pas aan het einde van een lange optelling. */
export function rondAfNaarCenten(bedrag: Decimal): Decimal {
  return bedrag.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Som van bedragen, met afronding na iedere stap (nooit ongeronde drijvende-kommaoptelling). */
export function telOpMetAfronding(bedragen: readonly Decimal[]): Decimal {
  return bedragen.reduce((totaal, bedrag) => rondAfNaarCenten(totaal.plus(bedrag)), new Decimal(0));
}

export type NegatiefStijl = "min_teken" | "haakjes";

/**
 * Formatteert een bedrag als `€ 1.250,75` (punt als duizendtal, komma als
 * decimaal). Negatief: `€ -1.250,75` (standaard) of `(€ 1.250,75)` — kies
 * per rapportcontext bewust één stijl, niet per toeval mengen.
 */
export function formatEUR(bedrag: Decimal, negatiefStijl: NegatiefStijl = "min_teken"): string {
  const afgerond = rondAfNaarCenten(bedrag);
  const absolute = afgerond.abs();
  const [geheel, centen = "00"] = absolute.toFixed(2).split(".");
  const geheelMetPunten = (geheel ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const bedragTekst = `${geheelMetPunten},${centen}`;

  if (afgerond.isNegative()) {
    return negatiefStijl === "haakjes" ? `(€ ${bedragTekst})` : `€ -${bedragTekst}`;
  }
  return `€ ${bedragTekst}`;
}

/** Formatteert een percentage als `12,5%` — komma als decimaal, geen spatie voor het %-teken. */
export function formatPercentage(waarde: Decimal, decimalen = 1): string {
  return `${waarde.toDecimalPlaces(decimalen, Decimal.ROUND_HALF_UP).toFixed(decimalen).replace(".", ",")}%`;
}

/**
 * Valideert dat een waarde numeriek en eindig is vóór gebruik in een
 * berekening. Nul is geldig; alleen null/undefined/NaN/Infinity worden
 * afgewezen (nul is geen "leeg", CLAUDE_AANVULLENDE regel financiele grondslagen).
 */
export function valideerNumeriek(waarde: unknown, veldnaam: string): Decimal {
  if (waarde === null || waarde === undefined || waarde === "") {
    throw new Error(`${veldnaam}: ontbrekende invoer voor een numerieke berekening.`);
  }
  const decimal = waarde instanceof Decimal ? waarde : new Decimal(waarde as Decimal.Value);
  if (!decimal.isFinite()) {
    throw new Error(`${veldnaam}: waarde is niet numeriek/eindig ("${String(waarde)}").`);
  }
  return decimal;
}

/**
 * Controleert dat de som van deelrijen overeenkomt met een gerapporteerd
 * totaal (verplichte resultaatcontrole vóór oplevering).
 */
export function controleerTotaalAansluiting(
  deelrijen: readonly Decimal[],
  gerapporteerdTotaal: Decimal,
  toleranceEuro: Decimal = new Decimal("0.01"),
): { sluit: boolean; verschil: Decimal } {
  const som = telOpMetAfronding(deelrijen);
  const verschil = som.minus(gerapporteerdTotaal);
  return { sluit: verschil.abs().lessThanOrEqualTo(toleranceEuro), verschil };
}
