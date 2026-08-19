import type { GrootboekMappingRegel, ResultaatRegel } from "@bvc/config";
import type { OnbekendOf } from "./types.js";

/**
 * Zoekt de mappingregel voor een grootboekrekening op. Geeft nooit
 * stilzwijgend een "leeg"/default resultaat: een onbekende rekening of een
 * inactieve regel levert expliciet `onbekend` op (CLAUDE.md §6, "Controle
 * vereist" i.p.v. gokken) — de aanroeper moet dit zichtbaar afhandelen, nooit
 * intern negeren of op 0 laten vallen.
 */
export function zoekMappingRegel(
  regels: readonly GrootboekMappingRegel[],
  grootboekrekening: string,
): OnbekendOf<GrootboekMappingRegel> {
  const regel = regels.find((r) => r.grootboekrekening === grootboekrekening);
  if (!regel) {
    return { type: "onbekend", reden: `Grootboekrekening "${grootboekrekening}" komt niet voor in de grootboekmapping — Controle vereist.` };
  }
  if (!regel.actief) {
    const omschrijving = regel.soort === "RESULTAAT" ? ` (rapportagepost "${regel.rapportagepost}")` : " (BALANS-rekening)";
    return {
      type: "onbekend",
      reden: `Grootboekrekening "${grootboekrekening}" heeft een inactieve mapping${omschrijving} — Controle vereist.`,
    };
  }
  return { type: "bekend", waarde: regel };
}

/**
 * Vertaalt de tekenconventie van een RESULTAAT-mappingregel naar de
 * presentatiefactor (1 of -1) die op een brondata-saldo toegepast moet
 * worden. Een nog niet bevestigde tekenconventie (`null`) levert `onbekend`
 * op — nooit stilzwijgend "ZOALS_BRON" (factor 1) aannemen. Niet van
 * toepassing op BALANS-regels (die hebben geen tekenconventie — een
 * BALANS-rekening hoort nooit door deze functie te lopen, zie
 * `@bvc/reporting`'s `berekenPlPeriode`, dat BALANS-regels al eerder negeert).
 */
export function presentatiefactorVoorRegel(regel: Pick<ResultaatRegel, "tekenconventie">): OnbekendOf<1 | -1> {
  if (regel.tekenconventie === null) {
    return {
      type: "onbekend",
      reden: "Tekenconventie nog niet bevestigd voor deze grootboekrekening — Controle vereist, geen aanname toegestaan.",
    };
  }
  return { type: "bekend", waarde: regel.tekenconventie === "ZOALS_BRON" ? 1 : -1 };
}

/**
 * Combineert de centrale master-grootboekmapping met een administratie-
 * eigen override tot één effectieve regelset: per grootboekrekening wint
 * de override-regel als die bestaat, anders geldt de master-regel. Een
 * override mag dus partieel zijn ("alleen wat afwijkt van de master") —
 * dat is precies het doel van deze functie. Geen validatie hier (dubbele
 * grootboekrekeningen binnen master/override zijn al uitgesloten door
 * `parseGrootboekMapping`/`parseGrootboekMappingMaster`); het resultaat
 * kan dus per constructie nooit een dubbele grootboekrekening bevatten.
 */
export function resolveerGrootboekMapping(
  master: readonly GrootboekMappingRegel[],
  override: readonly GrootboekMappingRegel[],
): GrootboekMappingRegel[] {
  const overrideRekeningen = new Set(override.map((regel) => regel.grootboekrekening));
  const masterZonderOverrides = master.filter((regel) => !overrideRekeningen.has(regel.grootboekrekening));
  return [...masterZonderOverrides, ...override];
}
