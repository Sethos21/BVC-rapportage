/**
 * Gedeelde invoer voor de Estimated-berekeningen van Huur, Beheersvergoeding en Managementvergoeding (Vervolgtranche 7):
 * de RESTERENDE MAANDEN van het realisatiejaar (kalendermaand 1..12) waarover de verwachting wordt bepaald — de
 * maanden ná de laatst afgesloten periode. Expliciete invoer, geen nieuwe periode-afsluitingsarchitectuur (zelfde
 * principe als `resterendeMaanden` bij Verzekeringen en `resterendeKwartalen` bij Onderhoud): de aanroeper weet welke
 * periode is afgesloten; deze laag raadt nooit een afsluitmoment.
 *
 * Een lege lijst is geldig (het jaar is volledig afgesloten: Estimated = Werkelijk). Ongeldige invoer (geen geheel
 * getal 1..12, dubbel) faalt hard — nooit stil gecorrigeerd, want een verkeerde maandselectie zou Werkelijk dubbel of
 * niet meetellen.
 */
export function normaliseerResterendeMaanden(maanden: readonly number[]): number[] {
  const gezien = new Set<number>();
  for (const maand of maanden) {
    if (!Number.isInteger(maand) || maand < 1 || maand > 12) {
      throw new Error(`Ongeldige resterende maand ${String(maand)} — verwacht een geheel getal 1..12.`);
    }
    if (gezien.has(maand)) {
      throw new Error(`Resterende maand ${maand} komt meerdere keren voor — geen dubbele telling van een maand.`);
    }
    gezien.add(maand);
  }
  return [...gezien].sort((a, b) => a - b);
}
