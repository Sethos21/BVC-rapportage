import type { GrootboekMappingRegel } from "@bvc/config";
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
    return {
      type: "onbekend",
      reden: `Grootboekrekening "${grootboekrekening}" heeft een inactieve mapping (rapportagepost "${regel.rapportagepost}") — Controle vereist.`,
    };
  }
  return { type: "bekend", waarde: regel };
}

/**
 * Vertaalt de tekenconventie van een mappingregel naar de presentatiefactor
 * (1 of -1) die op een brondata-saldo toegepast moet worden. Een nog niet
 * bevestigde tekenconventie (`null`) levert `onbekend` op — nooit stilzwijgend
 * "ZOALS_BRON" (factor 1) aannemen.
 */
export function presentatiefactorVoorRegel(regel: Pick<GrootboekMappingRegel, "tekenconventie">): OnbekendOf<1 | -1> {
  if (regel.tekenconventie === null) {
    return {
      type: "onbekend",
      reden: "Tekenconventie nog niet bevestigd voor deze grootboekrekening — Controle vereist, geen aanname toegestaan.",
    };
  }
  return { type: "bekend", waarde: regel.tekenconventie === "ZOALS_BRON" ? 1 : -1 };
}
