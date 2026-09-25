import { inventariseerServicekostenBronKolommen, type ServicekostenBronKolomOverzicht } from "./servicekostenBronKolommenDiagnose.js";

/**
 * Vorderingen_met_afboekingen-bronkolommen-diagnose (2026-09-18) —
 * TIJDELIJK, ALLEEN-LEZEN, ter voorbereiding op de BRONGATE "Historische
 * Ouderdomsanalyse": `VorderingMetAfboekingBronSchema` (`@bvc/data-contracts`)
 * modelleert bewust maar 14 van de ~189 ruwe bronkolommen (zie die
 * moduledoc). Vóórdat wordt vastgesteld of een historische reconstructie
 * per peildatum mogelijk is, moet eerst zichtbaar worden of de RUWE bron
 * al kolommen bevat die kunnen wijzen op een gedateerde afboekings-/
 * betalingshistorie (bv. VS_01..VS_20-achtige componenten, een
 * afboekingsdatum, een vervaldatum) — zonder daar nu al enige betekenis
 * aan toe te kennen.
 *
 * Hergebruikt `inventariseerServicekostenBronKolommen` ONGEWIJZIGD (een
 * generieke functie ondanks de naam, werkt op elke ruwe rijenset + bekende-
 * kolommenlijst — zelfde hergebruik als `contracten-bronkolommen`/
 * `boekingen-bronkolommen`) voor kolomnamen/vullingsgraad/voorbeeldwaarden.
 * Voegt uitsluitend twee PUUR OBSERVATIONELE, niet-interpreterende
 * toevoegingen toe:
 *  - `waargenomenFormaat`: afgeleid uitsluitend uit het patroon van de
 *    voorbeeldwaarden zelf (ziet het eruit als "dd-mm-jjjj", een getal, of
 *    geen van beide) — GEEN uitspraak over wat de kolom betekent.
 *  - `aandachtKolommen`: kolomnamen die een case-ongevoelige trefwoordmatch
 *    hebben met een vaste lijst (vervaldatum/betaaldatum/afboekingsdatum/
 *    .../VS_01../afgeboekt/component) — PUUR een filter om bij handmatige
 *    beoordeling sneller te kunnen focussen, GEEN classificatie van de
 *    daadwerkelijke inhoud/betekenis (CLAUDE.md §6: nooit raden op basis
 *    van een naam alleen).
 */

export interface VorderingenBronKolomOverzicht extends ServicekostenBronKolomOverzicht {
  /** Puur afgeleid uit het patroon van `voorbeeldwaarden` zelf — geen interpretatie van de kolombetekenis. `"leeg"` als er geen enkele niet-lege waarde is. */
  waargenomenFormaat: "datum (dd-mm-jjjj)" | "numeriek" | "tekst" | "leeg";
}

export interface VorderingenBronKolommenDiagnoseResultaat {
  aantalRijen: number;
  aantalKolommen: number;
  kolommen: VorderingenBronKolomOverzicht[];
  /** Zie moduledoc — uitsluitend een trefwoordfilter op de kolomNAAM, geen betekenistoekenning. */
  aandachtKolommen: string[];
}

const AANDACHT_TREFWOORDEN = [
  "vervaldatum",
  "betaaldatum",
  "afboekingsdatum",
  "transactiedatum",
  "afhandel",
  "betaling",
  "incasso",
  "boeking",
  "factuur",
  "termijn",
  "openstaand",
  "saldo",
  "credit",
  "verreken",
  "storner",
  "vs_0",
  "vs_1",
  "vs_2",
  "afgeboekt",
  "component",
  "datum",
];

const DATUM_PATROON = /^\d{1,2}-\d{1,2}-\d{4}$/;
const NUMERIEK_PATROON = /^-?\d+(\.\d+)?$/;

function bepaalWaargenomenFormaat(voorbeeldwaarden: readonly string[]): VorderingenBronKolomOverzicht["waargenomenFormaat"] {
  if (voorbeeldwaarden.length === 0) return "leeg";
  if (voorbeeldwaarden.every((w) => DATUM_PATROON.test(w))) return "datum (dd-mm-jjjj)";
  if (voorbeeldwaarden.every((w) => NUMERIEK_PATROON.test(w))) return "numeriek";
  return "tekst";
}

export function inventariseerVorderingenBronKolommen(
  ruweRijen: readonly Record<string, unknown>[],
  reedsGemodelleerdeKolommen: readonly string[],
): VorderingenBronKolommenDiagnoseResultaat {
  const basis = inventariseerServicekostenBronKolommen(ruweRijen, reedsGemodelleerdeKolommen);

  const kolommen: VorderingenBronKolomOverzicht[] = basis.kolommen.map((k) => ({ ...k, waargenomenFormaat: bepaalWaargenomenFormaat(k.voorbeeldwaarden) }));

  const aandachtKolommen = kolommen.map((k) => k.kolom).filter((kolom) => AANDACHT_TREFWOORDEN.some((trefwoord) => kolom.toLowerCase().includes(trefwoord)));

  return { aantalRijen: basis.aantalRijen, aantalKolommen: kolommen.length, kolommen, aandachtKolommen };
}
