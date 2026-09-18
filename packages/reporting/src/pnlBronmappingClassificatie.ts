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
 *    `leegstandCentraleMapping.ts`/`geplandeVerkoopCentraleMapping.ts`):
 *    categorie + bedragen/context → Werkelijk/Estimated. Blijft
 *    verantwoordelijk voor de eigen categorie-enum-validatie (via de
 *    meegegeven `resolveerCategorie`-functie, bv.
 *    `resolveerRenteCategorieViaCentraleMapping`) en voor het vertalen van
 *    dit resultaat naar de eigen, bestaande `XClassificatieRegel[]`-vorm en
 *    het aanroepen van de eigen, ONGEWIJZIGDE calculator.
 *  - PRESENTATIE: geen onderdeel van deze of enige laag hierboven (latere
 *    fase).
 *
 * GEEN SPECIALE NULL-OGB-KORTSLUITING (bewuste, kleine generalisatie t.o.v.
 * de oorspronkelijke Rente-/Leegstand-code): de eerdere per-module code
 * sloeg een boeking met `ogbKostensoort: null` altijd rechtstreeks op als
 * NIET_GEMAPT, zonder de resolver te raadplegen — correct voor Rente/
 * Leegstand, want geen van beide kent een GL-default, dus de resolver zou
 * toch NIET_GEMAPT hebben teruggegeven. Deze helper roept daarom ALTIJD
 * `resolveerCategorie` aan, ook voor `ogbKostensoort: null` — de resolver
 * zelf beslist dan correct tussen GL-default en NIET_GEMAPT (zie
 * `resolveerPnLBronmapping`).
 *
 * TWEE RESULTAATBRONNEN — `perOgb` (GL_OGB-specifiek) EN `perGrootboek`
 * (GL_DEFAULT) — TOEGEVOEGD IN FASE M6a (2026-09-15) VOOR GEPLANDE VERKOOP:
 * Rente/Leegstand kennen geen GL-default, dus voor hen bleef `perOgb` de
 * enige relevante uitkomst (`perGrootboek` blijft voor die twee altijd leeg).
 * Geplande Verkoop (OB-039) heeft daarentegen een bestaande, TWEEDELIGE
 * classificatiebron (OGB-array + GL-array, zie `begroteGeplandeVerkoop.ts`)
 * — een GL_DEFAULT-resolutie hoort daar NOOIT in de OGB-array te belanden
 * (dat zou de bewust vervallen legacy-semantiek "een OGB-code betekent
 * hetzelfde ongeacht de GL" ONBEDOELD terugbrengen), maar in de GL-array,
 * gesleuteld op de grootboekrekening. Vandaar de expliciete
 * `specificiteit`-routering hieronder: GL_OGB → `perOgb`, GL_DEFAULT →
 * `perGrootboek`.
 *
 * FAIL-FAST BIJ EEN BATCH-BREDE OGB-INCONSISTENTIE (kern van de M6a-
 * correctheid, niet alleen een cosmetische afronding): `perOgb` is
 * uitsluitend OGB-gesleuteld, GEEN GL-dimensie — exact de vorm die
 * `RenteClassificatieRegel`/`LeegstandClassificatieRegel`/
 * `GeplandeVerkoopClassificatieRegel` vandaag AL hebben. Een calculator die
 * zo'n array ontvangt (bv. `berekenWerkelijkGeplandeVerkoop`) past een
 * gevonden OGB-match toe OP ELKE boeking met die OGB-code, ONGEACHT de GL
 * van die boeking — de calculator zelf is dus inherent GL-blind zodra hij
 * eenmaal een OGB-array in handen heeft. Zou dezelfde ogbKostensoort binnen
 * één batch op TWEE VERSCHILLENDE grootboekrekeningen voorkomen met een
 * verschillende centrale uitkomst (een andere categorie, EEN VAN BEIDE
 * NIET_GEMAPT, of één ervan via GL-default in plaats van GL+OGB-specifiek),
 * dan zou het plaatsen van die code in `perOgb` de boeking(en) op de ANDERE
 * grootboekrekening(en) STILZWIJGEND FOUT classificeren zodra de aanroeper
 * deze array aan de bestaande calculator doorgeeft — een risico dat pas met
 * de M6a-Geplande-Verkoop-migratie relevant werd (Rente/Leegstand hergebruiken
 * per bewezen administratie nooit dezelfde OGB-code op meerdere GL's).
 * Vandaar de EXPLICIETE, VOORAFGAANDE batch-brede consistentiecheck
 * hieronder — vóór welke uitkomst dan ook aan `perOgb`/`perGrootboek` wordt
 * toegevoegd: elke ogbKostensoort die op meer dan één grootboekrekening in
 * de batch voorkomt, moet overal IDENTIEK resolveren (zelfde categorie, of
 * overal NIET_GEMAPT). Zo niet, dan gooit deze functie een expliciete fout
 * — nooit een willekeurige/laatst-gewonnen keuze. Voor alle bewezen
 * brondata (Rente/Leegstand/Geplande Verkoop) komt dit nooit voor; mocht een
 * toekomstige administratie dit wél doen, dan is dat een expliciete
 * architectuurvraag, nooit een stille misclassificatie. `perGrootboek` kan
 * in de praktijk nooit onderling botsen (CLAUDE.md §6: één periodecontext
 * per aanroep levert per GL altijd dezelfde default op) — de gelijknamige
 * check daar is uitsluitend defensief.
 *
 * Classificeert elke UNIEKE `(grootboekrekening, ogbKostensoort)`-combinatie
 * in de batch precies één keer (zelfde efficiëntie-/consistentieoverweging
 * als de oorspronkelijke per-module implementaties).
 */

export interface PnLRuweBoekingBasis {
  readonly grootboekrekening: string;
  readonly ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  readonly ogbKostensoortOmschrijving: string | null;
  /**
   * Optioneel: uitsluitend relevant voor een module met een GL-default-
   * classificatiebron (bv. Geplande Verkoop). Rente/Leegstand kennen geen
   * GL-default en laten dit veld weg — dit veld MOET optioneel blijven zodat
   * hun bestaande, rijkere boekingtypes (zonder dit veld) deze generieke
   * helper kunnen blijven gebruiken zonder wijziging.
   */
  readonly grootboekOmschrijving?: string | null;
}

export interface PnLNietGemapteCombinatie {
  readonly grootboekrekening: string;
  readonly ogbKostensoort: string | null;
}

export interface PnLGeclassificeerdeBoekingenResultaat<TCategorie extends string> {
  /** Per succesvol GL+OGB-specifiek geresolvede OGB-kostensoort: de categorie + omschrijving. */
  readonly perOgb: ReadonlyMap<string, { categorie: TCategorie; ogbKostensoortOmschrijving: string }>;
  /** Per succesvol via GL-default geresolvede grootboekrekening: de categorie + omschrijving. Voor modules zonder GL-default (Rente/Leegstand) altijd leeg. */
  readonly perGrootboek: ReadonlyMap<string, { categorie: TCategorie; grootboekOmschrijving: string }>;
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

  interface ComboResolutie {
    grootboekrekening: string;
    ogbKostensoort: string | null;
    ogbKostensoortOmschrijving: string | null;
    grootboekOmschrijving: string | null | undefined;
    resolutie: { categorie: TCategorie; specificiteit: PnLMappingSpecificiteit } | null;
  }

  const combos: ComboResolutie[] = Array.from(uniekeCombinaties.values()).map((combinatie) => ({
    grootboekrekening: combinatie.grootboekrekening,
    ogbKostensoort: combinatie.ogbKostensoort,
    ogbKostensoortOmschrijving: combinatie.ogbKostensoortOmschrijving,
    grootboekOmschrijving: combinatie.grootboekOmschrijving,
    resolutie: resolveerCategorie(
      { bedrijfsnr: context.bedrijfsnr, grootboekrekening: combinatie.grootboekrekening, boekjaar: context.boekjaar, boekperiode: context.boekperiode, opSysteemtijdstip: context.opSysteemtijdstip },
      combinatie.ogbKostensoort,
      mappingregels,
    ),
  }));

  // Batch-brede consistentiecheck (zie moduledoc): dezelfde ogbKostensoort op meerdere grootboekrekeningen
  // moet overal identiek resolveren, VOORDAT enige uitkomst aan perOgb/perGrootboek wordt toegevoegd.
  const perOgbCode = new Map<string, ComboResolutie[]>();
  for (const combo of combos) {
    if (combo.ogbKostensoort === null) continue;
    const groep = perOgbCode.get(combo.ogbKostensoort) ?? [];
    groep.push(combo);
    perOgbCode.set(combo.ogbKostensoort, groep);
  }
  for (const [ogbKostensoort, groep] of perOgbCode) {
    const grootboekrekeningen = new Set(groep.map((c) => c.grootboekrekening));
    if (grootboekrekeningen.size <= 1) continue; // dezelfde GL kan hier niet meermaals voorkomen (al gededupliceerd)
    const eerste = groep[0]!;
    const inconsistent = groep.some((c) => (c.resolutie === null) !== (eerste.resolutie === null) || c.resolutie?.categorie !== eerste.resolutie?.categorie);
    if (inconsistent) {
      const details = groep.map((c) => `GL ${c.grootboekrekening} → ${c.resolutie === null ? "NIET_GEMAPT" : `"${c.resolutie.categorie}" (${c.resolutie.specificiteit})`}`).join("; ");
      throw new Error(
        `OGB-kostensoort "${ogbKostensoort}" resolveert binnen deze batch verschillend afhankelijk van de grootboekrekening (${details}) — een OGB-gesleutelde classificatie-array kan dat niet correct weergeven voor de bestaande calculator (die een OGB-match onafhankelijk van de GL toepast). Dit is een architectuurvraag, geen stille aanname.`,
      );
    }
  }

  const nietGemapt: PnLNietGemapteCombinatie[] = [];
  const perOgb = new Map<string, { categorie: TCategorie; ogbKostensoortOmschrijving: string }>();
  const perGrootboek = new Map<string, { categorie: TCategorie; grootboekOmschrijving: string }>();

  for (const combo of combos) {
    if (combo.resolutie === null) {
      nietGemapt.push({ grootboekrekening: combo.grootboekrekening, ogbKostensoort: combo.ogbKostensoort });
      continue;
    }

    if (combo.resolutie.specificiteit === "GL_OGB" && combo.ogbKostensoort !== null) {
      perOgb.set(combo.ogbKostensoort, { categorie: combo.resolutie.categorie, ogbKostensoortOmschrijving: combo.ogbKostensoortOmschrijving ?? combo.ogbKostensoort });
      continue;
    }

    // GL_DEFAULT (of, defensief, GL_OGB zonder ogbKostensoort — kan de resolver in de praktijk nooit teruggeven).
    const bestaandeGl = perGrootboek.get(combo.grootboekrekening);
    if (bestaandeGl !== undefined && bestaandeGl.categorie !== combo.resolutie.categorie) {
      throw new Error(
        `Grootboekrekening ${combo.grootboekrekening} resolveert binnen deze batch naar twee verschillende GL-default-categorieën ("${bestaandeGl.categorie}" vs. "${combo.resolutie.categorie}") — interne inconsistentie, dit kan bij een correcte, enkele periodecontext per aanroep niet gebeuren.`,
      );
    }
    perGrootboek.set(combo.grootboekrekening, { categorie: combo.resolutie.categorie, grootboekOmschrijving: combo.grootboekOmschrijving ?? combo.grootboekrekening });
  }

  return { perOgb, perGrootboek, nietGemapt };
}

/**
 * FASE M7 (2026-09-15) — TWEEDE, EENVOUDIGER generieke classificatiehelper,
 * voor NIEUWE Werkelijk-calculators (Verzekeringen/Gemeentelijke Lasten/
 * Onderhoud) die vanaf het begin volgens het architectuurprincipe uit de
 * M7-opdracht §0 zijn ontworpen: "bronboeking → centrale classificatie →
 * economische categorie → calculator", NOOIT "centrale classificatie →
 * terugvertalen naar een legacy GL/OGB-classificatietabel → opnieuw
 * classificeren" (dat GL-blinde legacy-vertaalpatroon — `perOgb`/
 * `perGrootboek` hierboven — bestaat uitsluitend om Rente/Leegstand/Geplande
 * Verkoop se BESTAANDE, ongewijzigde calculators te kunnen blijven voeden;
 * gebruik het niet als ontwerp voor iets nieuws).
 *
 * Een nieuwe calculator ontvangt daarom simpelweg, per boeking, haar eigen
 * al-bepaalde economische categorie (`null` = NIET_GEMAPT) — GEEN GL, GEEN
 * OGB, geen classificatietabel. Dat maakt deze helper STRUCTUREEL IMMUUN
 * voor het batch-brede-consistentieprobleem van M6a hierboven: omdat elke
 * boeking haar EIGEN resolutie behoudt (nooit gecollapsed tot één
 * OGB-gesleutelde waarde voor de hele batch), kan dezelfde OGB-code op twee
 * verschillende GL's binnen één batch hier gewoon naar twee verschillende
 * (of één NIET_GEMAPT en één wél gemapte) categorieën resolveren zonder
 * enig risico — er is geen calculator meer die een OGB-array GL-blind
 * toepast.
 *
 * Classificeert nog steeds elke unieke `(grootboekrekening, ogbKostensoort)`-
 * combinatie precies één keer (dezelfde efficiëntie als hierboven), maar
 * geeft daarna een resultaat TERUG PER OORSPRONKELIJKE BOEKING (in de
 * oorspronkelijke volgorde, elk veld van de boeking behouden) in plaats van
 * gecollapsed per OGB-code — precies wat een calculator nodig heeft die per
 * boeking saldo/complexnummer/etc. wil blijven zien.
 */
export interface PnLGeclassificeerdeBoeking<TBoeking, TCategorie extends string> {
  readonly boeking: TBoeking;
  /** `null` = deze boeking kon centraal niet worden geclassificeerd (NIET_GEMAPT) — nooit geraden, nooit stil weggelaten. */
  readonly categorie: TCategorie | null;
}

export interface PnLElkeBoekingGeclassificeerdResultaat<TBoeking, TCategorie extends string> {
  /** Elke oorspronkelijke boeking, in de oorspronkelijke volgorde, met haar eigen geresolveerde categorie (of `null`). */
  readonly boekingen: readonly PnLGeclassificeerdeBoeking<TBoeking, TCategorie>[];
  /** Unieke (GL, OGB)-combinaties zonder geldige centrale mapping — voor diagnostiek, dupliceert geen telling (die zit al in `boekingen`). */
  readonly nietGemapt: readonly PnLNietGemapteCombinatie[];
}

export function classificeerElkeBoekingViaPnLMapping<TBoeking extends PnLRuweBoekingBasis, TCategorie extends string>(
  context: PnLClassificatieContext,
  boekingen: readonly TBoeking[],
  mappingregels: readonly PnLBronmappingRegel[],
  resolveerCategorie: (
    invoer: { bedrijfsnr: string; grootboekrekening: string; boekjaar: number; boekperiode: string; opSysteemtijdstip: Date },
    ogbKostensoort: string | null,
    mappingregels: readonly PnLBronmappingRegel[],
  ) => { categorie: TCategorie; specificiteit: PnLMappingSpecificiteit } | null,
): PnLElkeBoekingGeclassificeerdResultaat<TBoeking, TCategorie> {
  const resolutiePerCombo = new Map<string, { categorie: TCategorie; specificiteit: PnLMappingSpecificiteit } | null>();
  for (const boeking of boekingen) {
    const sleutel = `${boeking.grootboekrekening}::${boeking.ogbKostensoort ?? ""}`;
    if (resolutiePerCombo.has(sleutel)) continue;
    resolutiePerCombo.set(
      sleutel,
      resolveerCategorie(
        { bedrijfsnr: context.bedrijfsnr, grootboekrekening: boeking.grootboekrekening, boekjaar: context.boekjaar, boekperiode: context.boekperiode, opSysteemtijdstip: context.opSysteemtijdstip },
        boeking.ogbKostensoort,
        mappingregels,
      ),
    );
  }

  const nietGemapt: PnLNietGemapteCombinatie[] = [];
  const nietGemapteSleutels = new Set<string>();
  const resultaat: PnLGeclassificeerdeBoeking<TBoeking, TCategorie>[] = boekingen.map((boeking) => {
    const sleutel = `${boeking.grootboekrekening}::${boeking.ogbKostensoort ?? ""}`;
    const resolutie = resolutiePerCombo.get(sleutel)!;
    if (resolutie === null) {
      if (!nietGemapteSleutels.has(sleutel)) {
        nietGemapteSleutels.add(sleutel);
        nietGemapt.push({ grootboekrekening: boeking.grootboekrekening, ogbKostensoort: boeking.ogbKostensoort });
      }
      return { boeking, categorie: null };
    }
    return { boeking, categorie: resolutie.categorie };
  });

  return { boekingen: resultaat, nietGemapt };
}
