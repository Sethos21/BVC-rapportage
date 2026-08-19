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

/**
 * Direct overgenomen uit de "Srt"-kolom van het echte rekeningschema
 * (PxPlus/Informant, "Rekeningschema basisgegevens" per administratie) —
 * geen zelfbedachte categorie. BALANS-rekeningen (Bal) horen per definitie
 * niet op een P&L thuis; RESULTAAT-rekeningen (V&W) wel.
 */
export const RekeningSoortSchema = z.enum(["BALANS", "RESULTAAT"]);
export type RekeningSoort = z.infer<typeof RekeningSoortSchema>;

/**
 * Een BALANS-regel markeert een grootboekrekening als bekend en bewust
 * buiten de P&L-scope (bv. bank, debiteuren/crediteuren, voorzieningen,
 * tussenrekeningen) — géén rapportagepost/-categorie/tekenconventie nodig,
 * want die rekening komt nooit in een P&L-uitkomst terecht. Dit is iets
 * anders dan een onbekende/niet-gemapte rekening: `berekenPlPeriode`
 * (`@bvc/reporting`) negeert een bekende BALANS-rekening stil, terwijl een
 * écht onbekende rekening met saldo in `controleVereist` verschijnt.
 */
export const BalansRegelSchema = z
  .object({
    grootboekrekening: z.string().min(1),
    soort: z.literal("BALANS"),
    actief: z.boolean(),
    status: MappingStatusSchema,
  })
  .strict();

export const ResultaatRegelSchema = z
  .object({
    grootboekrekening: z.string().min(1),
    soort: z.literal("RESULTAAT"),
    /** Specifieke rapportregel, bv. "Beheerkosten". */
    rapportagepost: z.string().min(1),
    /** Bredere groepering van rapportageposten, bv. "Kosten" / "Opbrengsten". */
    rapportagecategorie: z.string().min(1),
    tekenconventie: TekenconventieSchema.nullable(),
    actief: z.boolean(),
    status: MappingStatusSchema,
  })
  .strict();

export const GrootboekMappingRegelSchema = z.discriminatedUnion("soort", [BalansRegelSchema, ResultaatRegelSchema]);
export type GrootboekMappingRegel = z.infer<typeof GrootboekMappingRegelSchema>;
export type BalansRegel = z.infer<typeof BalansRegelSchema>;
export type ResultaatRegel = z.infer<typeof ResultaatRegelSchema>;

/**
 * Administratie-eigen mapping ("override") — mag voortaan PARTIEEL zijn:
 * alleen de regels die voor deze administratie afwijken van (of ontbreken
 * in) de centrale master (zie `GrootboekMappingMasterSchema` hieronder).
 * Een lege/ontbrekende override betekent "volg de master volledig".
 */
export const GrootboekMappingSchema = z.object({
  versie: z.string(),
  administratieId: z.string().min(1),
  regels: z.array(GrootboekMappingRegelSchema),
});
export type GrootboekMappingConfig = z.infer<typeof GrootboekMappingSchema>;

/**
 * Centrale master-grootboekmapping (`config/grootboekmapping_master.json`,
 * één bestand, niet per administratie): rekeningen waarvan de classificatie
 * betrouwbaar gelijk is gebleken over ≥2 administraties (bevestigd via
 * `@bvc/reporting`'s `inventariseerGrootboekrekeningen`) — nooit een
 * rekening die maar bij één Bedrijfsnr voorkomt, ook niet als die op
 * zichzelf `consistent: true` scoort (dat bewijst dan alleen interne
 * consistentie, niet consistentie ÓVER administraties heen). Zie
 * `resolveerGrootboekMapping` (`@bvc/domain`) voor hoe master + een
 * administratie-override tot één effectieve mapping samenkomen.
 */
export const GrootboekMappingMasterSchema = z.object({
  versie: z.string(),
  regels: z.array(GrootboekMappingRegelSchema),
});
export type GrootboekMappingMasterConfig = z.infer<typeof GrootboekMappingMasterSchema>;

function controleerGeenDubbeleRekeningen(regels: readonly GrootboekMappingRegel[], contextLabel: string): void {
  const nummers = regels.map((regel) => regel.grootboekrekening);
  const duplicaten = [...new Set(nummers.filter((nummer, index) => nummers.indexOf(nummer) !== index))];
  if (duplicaten.length > 0) {
    throw new Error(`${contextLabel} bevat dubbele grootboekrekening(en): ${duplicaten.join(", ")}`);
  }
}

/**
 * Valideert en normaliseert een ruwe administratie-override. Faalt hard
 * (geen stilzwijgende correctie) op een ongeldige structuur of op dubbele
 * grootboekrekeningnummers — een rekening mag maar één keer voorkomen,
 * anders is de mapping voor die rekening ambigu.
 */
export function parseGrootboekMapping(ruw: unknown): GrootboekMappingConfig {
  const geparsed = GrootboekMappingSchema.parse(ruw);
  controleerGeenDubbeleRekeningen(geparsed.regels, `Grootboekmapping voor administratie "${geparsed.administratieId}"`);
  return geparsed;
}

/** Valideert en normaliseert de ruwe master-grootboekmapping — zelfde regels als parseGrootboekMapping, zonder administratieId. */
export function parseGrootboekMappingMaster(ruw: unknown): GrootboekMappingMasterConfig {
  const geparsed = GrootboekMappingMasterSchema.parse(ruw);
  controleerGeenDubbeleRekeningen(geparsed.regels, "Master-grootboekmapping");
  return geparsed;
}
