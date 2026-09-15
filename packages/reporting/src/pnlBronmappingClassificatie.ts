import type { PnLBronmappingRegel, PnLMappingSpecificiteit } from "./pnlBronmapping.js";

/**
 * FASE M6 (2026-09-15) — consolidatie van het technische patroon dat M3b
 * (Rente) en M5 (Leegstand) allebei onafhankelijk hebben bewezen: ruwe
 * boekingen → unieke (grootboekrekening, ogbKostensoort)-combinaties →
 * centrale resolver → categorie of NIET_GEMAPT. Beide modules bleken exact
 * dezelfde boilerplate te bevatten — deze ÉÉN kleine, generieke helper
 * vervangt die duplicatie zonder er nieuwe abstractielagen bovenop te
 * bouwen.
 *
 * STRIKTE SCHEIDING (M6-opdracht §11), hier technisch afgedwongen door de
 * signatuur zelf:
 *  - CENTRAAL (deze functie): administratie + GL + OGB → categorie /
 *    NIET_GEMAPT. Kent GEEN modulespecifieke categorie-enum (`TCategorie` is
 *    een generic, puur een `string`-subtype), GEEN calculator, GEEN
 *    economische berekening.
 *  - MODULE (de aanroeper, bv. `renteCentraleMapping.ts`/
 *    `leegstandCentraleMapping.ts`): categorie + bedragen/context →
 *    Werkelijk/Estimated. Blijft verantwoordelijk voor de eigen
 *    categorie-enum-validatie (via de meegegeven `resolveerCategorie`-
 *    functie, bv. `resolveerRenteCategorieViaCentraleMapping`) en voor het
 *    vertalen van dit resultaat naar de eigen, bestaande
 *    `XClassificatieRegel[]`-vorm en het aanroepen van de eigen,
 *    ONGEWIJZIGDE calculator.
 *  - PRESENTATIE: geen onderdeel van deze of enige laag hierboven (latere
 *    fase).
 *
 * GEEN SPECIALE NULL-OGB-KORTSLUITING (bewuste, kleine generalisatie t.o.v.
 * de oorspronkelijke Rente-/Leegstand-code): de eerdere per-module code
 * sloeg een boeking met `ogbKostensoort: null` altijd rechtstreeks op als
 * NIET_GEMAPT, zonder de resolver te raadplegen — correct voor Rente/
 * Leegstand, want geen van beide kent een GL-default, dus de resolver zou
 * toch NIET_GEMAPT hebben teruggegeven. Die kortsluiting was echter impliciet
 * afhankelijk van "deze module heeft toevallig geen GL-default" — voor een
 * toekomstige module MET een GL-default zou hij ten onrechte een geldige
 * default-classificatie hebben overgeslagen. Deze generieke helper roept
 * daarom ALTIJD `resolveerCategorie` aan, ook voor `ogbKostensoort: null` —
 * de resolver zelf beslist dan correct tussen GL-default en NIET_GEMAPT (zie
 * `resolveerPnLBronmapping`). Bewezen bij Rente/Leegstand: identiek gedrag,
 * want zonder GL-default resolveert `null` daar sowieso altijd naar
 * NIET_GEMAPT (zie `renteCentraleMapping.test.ts`/`leegstandCentraleMapping.test.ts`).
 *
 * Classificeert elke UNIEKE `(grootboekrekening, ogbKostensoort)`-combinatie
 * in de batch precies één keer (zelfde efficiëntie-/consistentieoverweging
 * als de oorspronkelijke per-module implementaties).
 *
 * BEWUSTE BEPERKING (geen over-engineering voor een hypothetische toekomst):
 * `perOgb` is — exact zoals `RenteClassificatieRegel`/`LeegstandClassificatieRegel`
 * dat vandaag ZELF al zijn — uitsluitend OGB-gesleuteld, GEEN GL-dimensie.
 * Resolveert een `ogbKostensoort: null`-combinatie ooit succesvol (alleen
 * mogelijk voor een toekomstige module MET een GL-default; voor Rente/
 * Leegstand gebeurt dit nooit, zie boven), dan heeft die uitkomst hier geen
 * plek in `perOgb` — precies omdat de bestaande calculator-classificatieregels
 * van Rente/Leegstand zelf al geen "categorie zonder OGB"-concept kennen. Een
 * toekomstige module MET een GL-default en een GL-gesleutelde
 * classificatieregel-vorm hergebruikt deze helper dus niet 1-op-1 — dat is
 * verwacht en geen gebrek van deze functie, geen generiek framework
 * geforceerd.
 */

export interface PnLRuweBoekingBasis {
  readonly grootboekrekening: string;
  readonly ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  readonly ogbKostensoortOmschrijving: string | null;
}

export interface PnLNietGemapteCombinatie {
  readonly grootboekrekening: string;
  readonly ogbKostensoort: string | null;
}

export interface PnLGeclassificeerdeBoekingenResultaat<TCategorie extends string> {
  /** Per succesvol geresolvede OGB-kostensoort: de categorie + omschrijving — de aanroeper vertaalt dit naar de eigen module-classificatieregel-vorm. */
  readonly perOgb: ReadonlyMap<string, { categorie: TCategorie; ogbKostensoortOmschrijving: string }>;
  /** (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet zichtbaar, nooit stil genegeerd. */
  readonly nietGemapt: readonly PnLNietGemapteCombinatie[];
}

export interface PnLClassificatieContext {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * De generieke technische stap "ruwe boekingen → unieke (GL, OGB)-
 * combinaties → centrale resolver → categorie/NIET_GEMAPT". `resolveerCategorie`
 * is de module-eigen adapter (bv. `resolveerRenteCategorieViaCentraleMapping`)
 * die zelf al de `economischeModule`-/categorie-enum-validatie doet — deze
 * helper roept hem uitsluitend aan, valideert niets zelf, en kent geen enkele
 * modulespecifieke categorie.
 */
export function classificeerBoekingenViaPnLMapping<TBoeking extends PnLRuweBoekingBasis, TCategorie extends string>(
  context: PnLClassificatieContext,
  boekingen: readonly TBoeking[],
  mappingregels: readonly PnLBronmappingRegel[],
  resolveerCategorie: (
    invoer: { bedrijfsnr: string; grootboekrekening: string; boekjaar: number; boekperiode: string; opSysteemtijdstip: Date },
    ogbKostensoort: string | null,
    mappingregels: readonly PnLBronmappingRegel[],
  ) => { categorie: TCategorie; specificiteit: PnLMappingSpecificiteit } | null,
): PnLGeclassificeerdeBoekingenResultaat<TCategorie> {
  const uniekeCombinaties = new Map<string, TBoeking>();
  for (const boeking of boekingen) {
    uniekeCombinaties.set(`${boeking.grootboekrekening}::${boeking.ogbKostensoort ?? ""}`, boeking);
  }

  const nietGemapt: PnLNietGemapteCombinatie[] = [];
  const perOgb = new Map<string, { categorie: TCategorie; ogbKostensoortOmschrijving: string }>();

  for (const combinatie of uniekeCombinaties.values()) {
    const resultaat = resolveerCategorie(
      { bedrijfsnr: context.bedrijfsnr, grootboekrekening: combinatie.grootboekrekening, boekjaar: context.boekjaar, boekperiode: context.boekperiode, opSysteemtijdstip: context.opSysteemtijdstip },
      combinatie.ogbKostensoort,
      mappingregels,
    );
    if (resultaat === null) {
      nietGemapt.push({ grootboekrekening: combinatie.grootboekrekening, ogbKostensoort: combinatie.ogbKostensoort });
      continue;
    }
    if (combinatie.ogbKostensoort !== null) {
      perOgb.set(combinatie.ogbKostensoort, { categorie: resultaat.categorie, ogbKostensoortOmschrijving: combinatie.ogbKostensoortOmschrijving ?? combinatie.ogbKostensoort });
    }
  }

  return { perOgb, nietGemapt };
}
