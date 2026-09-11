import { z } from "zod";

/**
 * Centrale, versioned beheerparameters (CLAUDE.md §3: "config-gestuurd,
 * geen hardcoded uitzonderingen"). Regels als "kostensoort 9600 altijd
 * uitgesloten" horen hier, niet als losse constante in een broncontract of
 * rekenmodule — code leest de parameter, bepaalt hem niet zelf. Nieuwe
 * uitzonderingen of aangepaste normen vereisen dus geen codewijziging,
 * alleen een aangepast parameterbestand (geladen door de aanroepende
 * package, bv. apps/worker vanuit BVC_DATA_ROOT/config/parameters.json).
 */

export const ServicekostenParametersSchema = z.object({
  /**
   * Kostensoorten die altijd worden uitgesloten van servicekosten-analyses
   * (bv. "9600" = afrekening vorig jaar). Vergelijking op de getrimde
   * kostensoortcode.
   */
  uitgeslotenKostensoorten: z.array(z.string()),
  /**
   * Tekstfragmenten (kleine letters) in de omschrijving die duiden op een
   * mogelijke serviceafrekening — signaleert alleen ("Controle vereist"),
   * sluit niet automatisch uit.
   */
  serviceafrekeningVarianten: z.array(z.string()),
});

export type ServicekostenParameters = z.infer<typeof ServicekostenParametersSchema>;

export const BeheerparametersSchema = z.object({
  versie: z.string(),
  servicekosten: ServicekostenParametersSchema,
});

export type Beheerparameters = z.infer<typeof BeheerparametersSchema>;

/**
 * Standaardwaarden — reproduceren het gedrag van vóór het config-gestuurd
 * maken van deze regels. Alleen gebruikt als er geen (of geen geldig)
 * parameterbestand in de data root staat.
 */
export const STANDAARD_PARAMETERS: Beheerparameters = {
  versie: "0.1",
  servicekosten: {
    uitgeslotenKostensoorten: ["9600"],
    serviceafrekeningVarianten: ["serviceafrekening", "service afrekening", "service-afrekening", "serviceafrek", "serv.afrek", "afrekening service"],
  },
};

/** Valideert en normaliseert een ruw (bv. uit JSON ingelezen) parameterobject. */
export function parseBeheerparameters(ruw: unknown): Beheerparameters {
  return BeheerparametersSchema.parse(ruw);
}
