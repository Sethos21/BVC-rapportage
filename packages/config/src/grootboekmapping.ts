import { z } from "zod";

/**
 * Centrale, config-gestuurde grootboekmapping per administratie (CLAUDE.md
 * §3/§6): welke rapportagepost/-categorie bij een grootboekrekening hoort,
 * en met welke tekenconventie, staat hier — nooit hardcoded/verspreid in
 * rapportage- of KPI-code. Eén JSON-bestand per administratie
 * (`config/grootboekmappingen/<administratieId>.json` in de data root, zie
 * apps/worker/src/paths.ts's `grootboekmappingPad`), bewust géén centrale
 * standaardmapping/fallback: een ontbrekend bestand voor een administratie
 * betekent "nog niet geconfigureerd", nooit stilzwijgend de mapping van een
 * andere administratie hergebruiken.
 *
 * Bewust eerste, eenvoudige versie: alleen de velden die de huidige
 * classificatiebehoefte dekken. Dit is een ANDER, eenvoudiger model dan het
 * bestaande `GrootboekMapping`-type in `@bvc/domain` (dat een uitgebreider,
 * nog ongebruikt geldigheids-/goedkeuringsmodel uit een extern
 * dossierdocument (GROOTBOEKMAPPING_SPEC_v0.1.md) volgt) — zie
 * packages/config/README.md voor hoe deze twee zich tot elkaar verhouden
 * en waarom ze (nog) niet zijn samengevoegd.
 */

/**
 * ZOALS_BRON: rapportagebedrag = brondata-saldo (debet - credit) ongewijzigd.
 * OMGEKEERD: rapportagebedrag = -1 x brondata-saldo (bv. een opbrengst-
 * rekening die credit-normaal geboekt wordt en in de rapportage als
 * positief bedrag getoond moet worden).
 *
 * Nullable: `null` betekent expliciet "nog niet bevestigd" — nooit een
 * standaardwaarde aannemen (CLAUDE.md §6, "Controle vereist" i.p.v.
 * gokken). Downstream-code moet een `null`-tekenconventie behandelen als
 * onbekend (zie `@bvc/domain`'s `presentatiefactorVoorRegel`), nooit als
 * "ZOALS_BRON" interpreteren.
 */
export const TekenconventieSchema = z.enum(["ZOALS_BRON", "OMGEKEERD"]);
export type Tekenconventie = z.infer<typeof TekenconventieSchema>;

/**
 * Rapportmapping-status (CLAUDE.md §6): een AI/Claude-sessie mag een regel
 * uitsluitend als VOORGESTELD registreren. GOEDGEKEURD is uitsluitend een
 * menselijke stap — er is bewust geen code in deze repository die een
 * regel van VOORGESTELD naar GOEDGEKEURD zet.
 */
export const MappingStatusSchema = z.enum(["VOORGESTELD", "GOEDGEKEURD"]);
export type MappingStatus = z.infer<typeof MappingStatusSchema>;

export const GrootboekMappingRegelSchema = z.object({
  /** Grootboekrekeningnummer zoals in de bron (Boeking_Grootboeknr / Grootboekrekeningnr), bv. "4000". */
  grootboekrekening: z.string().min(1),
  /** Specifieke rapportregel, bv. "Beheerkosten". */
  rapportagepost: z.string().min(1),
  /** Bredere groepering van rapportageposten, bv. "Kosten" / "Opbrengsten". */
  rapportagecategorie: z.string().min(1),
  tekenconventie: TekenconventieSchema.nullable(),
  /** Operationele aan/uit-schakelaar, los van de goedkeuringsstatus. */
  actief: z.boolean(),
  status: MappingStatusSchema,
});
export type GrootboekMappingRegel = z.infer<typeof GrootboekMappingRegelSchema>;

export const GrootboekMappingSchema = z.object({
  versie: z.string(),
  administratieId: z.string().min(1),
  regels: z.array(GrootboekMappingRegelSchema),
});
export type GrootboekMappingConfig = z.infer<typeof GrootboekMappingSchema>;

/**
 * Valideert en normaliseert een ruwe grootboekmapping. Faalt hard (geen
 * stilzwijgende correctie) op een ongeldige structuur of op dubbele
 * grootboekrekeningnummers — een rekening mag maar één keer voorkomen,
 * anders is de mapping voor die rekening ambigu.
 */
export function parseGrootboekMapping(ruw: unknown): GrootboekMappingConfig {
  const geparsed = GrootboekMappingSchema.parse(ruw);
  const nummers = geparsed.regels.map((regel) => regel.grootboekrekening);
  const duplicaten = [...new Set(nummers.filter((nummer, index) => nummers.indexOf(nummer) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(`Grootboekmapping voor administratie "${geparsed.administratieId}" bevat dubbele grootboekrekening(en): ${duplicaten.join(", ")}`);
  }
  return geparsed;
}
