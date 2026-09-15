import type Decimal from "decimal.js";
import {
  GEPLANDE_VERKOOP_COMPONENTEN,
  berekenWerkelijkGeplandeVerkoop,
  type BgGeplandeVerkoopComponent,
  type GeplandeVerkoopClassificatieRegel,
  type GeplandeVerkoopGrootboekClassificatieRegel,
  type WerkelijkGeplandeVerkoopBoekingRegel,
  type WerkelijkGeplandeVerkoopResultaat,
} from "./begroteGeplandeVerkoop.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { classificeerBoekingenViaPnLMapping } from "../pnlBronmappingClassificatie.js";

/**
 * FASE M6a (2026-09-15) — Geplande Verkoop (OB-039) migreert naar de
 * centrale P&L-bronmappingresolver, NA een expliciet businessbesluit dat de
 * M6-gate-stop noodzakelijk maakte (zie moduledoc `begroteGeplandeVerkoop.
 * test.ts`'s "V"-testblok voor de volledige historie).
 *
 * BUSINESSBESLUIT (2026-09-15): een OGB-code heeft GEEN administratiebrede
 * economische betekenis los van de grootboekrekening waarop de boeking
 * staat. Geplande Verkoop volgt vanaf nu DEZELFDE GL-geneste resolutie als
 * elke andere gemigreerde module: (GL, OGB)-specifiek → anders GL-default
 * van DIEZELFDE GL → anders NIET_GEMAPT. Dit is een BEWUSTE wijziging van de
 * legacy-semantiek van `berekenWerkelijkGeplandeVerkoop`'s EIGEN,
 * ONGEWIJZIGDE interne algoritme (dat OGB nog altijd administratiebreed
 * vóór GL probeert) — de wijziging zit UITSLUITEND in WELKE classificatie-
 * arrays deze module aan die ongewijzigde calculator meegeeft, nooit in de
 * calculator zelf.
 *
 * WAAROM DE CALCULATOR ZELF ONGEWIJZIGD KAN BLIJVEN, EN HOE DE VERTALING
 * WERKT: `berekenWerkelijkGeplandeVerkoop` accepteert TWEE aparte, platte
 * classificatiebronnen — `ogbClassificatie` (gesleuteld op OGB, GEEN
 * GL-dimensie) en `grootboekClassificatie` (gesleuteld op GL) — en probeert
 * zelf eerst de OGB-bron, dan de GL-bron. Om dat algoritme correct de
 * centrale, GL-geneste resolutie te laten UITVOEREN, moet deze module de
 * twee bronnen PER BATCH VERS AFLEIDEN uit de daadwerkelijke boekingen, via
 * de generieke `classificeerBoekingenViaPnLMapping` (`pnlBronmappingClassificatie.ts`,
 * M6): een GL+OGB-SPECIFIEK geresolveerde combinatie (`specificiteit:
 * "GL_OGB"`) gaat naar de OGB-bron (`perOgb`); een via GL-DEFAULT
 * geresolveerde combinatie (`specificiteit: "GL_DEFAULT"`) gaat naar de
 * GL-bron (`perGrootboek`) — NOOIT naar de OGB-bron, want dat zou de
 * bewust vervallen "OGB betekent hetzelfde ongeacht GL"-semantiek
 * onbedoeld terugbrengen (de calculator zou die OGB-code dan weer
 * administratiebreed toepassen). Deze GL_OGB/GL_DEFAULT-routering zit al in
 * de generieke helper zelf (M6a-uitbreiding), inclusief een fail-fast als
 * dezelfde OGB-code binnen één batch via twee verschillende
 * grootboekrekeningen naar twee verschillende categorieën zou resolveren
 * (een OGB-gesleutelde array kan zo'n tegenstrijdigheid niet weergeven) —
 * voor de bewezen 023-brondata komt dit nooit voor (zie hieronder).
 *
 * WAT ER LEGACY IS GEWORDEN (zie ook `begroteGeplandeVerkoop.test.ts`'s
 * bijgewerkte "V"-testblok): de oude classificatietabellen
 * (`geplandeVerkoopClassificatie.ts`/`geplandeVerkoopGrootboekClassificatie.ts`,
 * `@bvc/begroting-data`) EN het interne "OGB-eerst-administratiebreed-dan-
 * GL"-algoritme van `berekenWerkelijkGeplandeVerkoop` zelf blijven bestaan
 * en ongewijzigd — ze zijn alleen niet langer de PRODUCTIEBRON van de
 * classificatie-arrays: dat is vanaf nu de centrale, persistente
 * `PnLBronmappingRepository` (zie `@bvc/begroting-data`). Een OGB-code die
 * op twee verschillende GL's zou voorkomen met twee verschillende
 * betekenissen — zoals de oude testfixture "GL08830/OGB3010" bewust
 * kunstmatig deed — geeft daarom vanaf nu NIET meer automatisch dezelfde
 * categorie op beide GL's; dat gedrag was uitsluitend legacy-precedentie,
 * nooit een bewezen bronfeit (zie het M6-eindrapport).
 *
 * BEWEZEN BRONMAPPING (023_Malcon_Beheer_BV, boekjaar 2026 periode 04):
 *  - GL00166 + OGB "3010" → BOEKWAARDE_AFBOEKING (GL+OGB-specifiek).
 *  - GL08830 (GEEN OGB, of een niet-specifiek gemapte OGB) → VERKOOPOPBRENGST
 *    (GL-default).
 *  - GL00167 → GEEN mapping (nooit bewezen) → blijft NIET_GEMAPT.
 * Zie `geplandeVerkoopCentraleMapping.test.ts` voor het volledige oud-vs-
 * nieuw-bewijs op de ECHTE bronproef (Hoofdstraat/Driebergen).
 *
 * GEEN WIJZIGING AAN DE BESTAANDE CALCULATOR: `berekenWerkelijkGeplandeVerkoop`
 * blijft volledig ongewijzigd — GEEN automatische pairing verkoopopbrengst/
 * boekwaarde, GEEN automatische netto-verkoopresultaatreconstructie, GEEN
 * vrije-tekstmatching, GEEN €0-aanname voor ontbrekende boekwaarde/
 * verkoopkosten (dat blijft uitsluitend de Begroting/Estimated-rekenhulp,
 * zie `begroteGeplandeVerkoop.ts`'s moduledoc).
 */

function isBgGeplandeVerkoopComponent(waarde: string): waarde is BgGeplandeVerkoopComponent {
  return (GEPLANDE_VERKOOP_COMPONENTEN as readonly string[]).includes(waarde);
}

export interface GeplandeVerkoopCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening
 * via de centrale resolver, naar de bestaande `BgGeplandeVerkoopComponent`.
 * `null` = NIET_GEMAPT (nooit geraden). Faalt hard als de resolver voor deze
 * GL een `economischeModule` anders dan `VERKOOP` teruggeeft, of een
 * categorie die geen bestaande `BgGeplandeVerkoopComponent` is.
 */
export function resolveerGeplandeVerkoopComponentViaCentraleMapping(
  invoer: GeplandeVerkoopCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: BgGeplandeVerkoopComponent; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
  const resultaat = resolveerPnLBronmapping(
    {
      bedrijfsnr: invoer.bedrijfsnr,
      grootboekrekening: invoer.grootboekrekening,
      ogbKostensoort,
      boekjaar: invoer.boekjaar,
      boekperiode: invoer.boekperiode,
      opSysteemtijdstip: invoer.opSysteemtijdstip,
    },
    mappingregels,
  );

  if (resultaat.status === "NIET_GEMAPT") {
    return null;
  }

  if (resultaat.economischeModule !== "VERKOOP") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "VERKOOP" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isBgGeplandeVerkoopComponent(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Geplande-Verkoop-component.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface GeplandeVerkoopRuweBoekingRegel {
  grootboekrekening: string;
  /** Uitsluitend informatief (GL-drilldown) — codes zijn leidend, zie moduledoc. */
  grootboekOmschrijving: string | null;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  saldo: Decimal;
}

export interface GeplandeVerkoopWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface GeplandeVerkoopWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkGeplandeVerkoopResultaat;
  /**
   * (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst
   * opleverde — expliciet beschikbaar voor latere mappingcontrole/
   * P&L-diagnostiek. Deze boekingen zitten ALTIJD OOK al in
   * `werkelijk.nietGeclassificeerdTotaal`/`-AantalBoekingen`.
   */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN VOOR GEPLANDE-VERKOOP-WERKELIJK: ruwe
 * boekingen (met GL) → centrale P&L-bronmappingresolver →
 * economischeModule=VERKOOP + component → de bestaande, ONGEWIJZIGDE
 * `berekenWerkelijkGeplandeVerkoop`. Zie moduledoc voor de vertaling van
 * `specificiteit` (GL_OGB → `ogbClassificatie`, GL_DEFAULT →
 * `grootboekClassificatie`) — dit is de kern van hoe de ongewijzigde
 * calculator toch de striktere, GL-geneste centrale semantiek uitvoert.
 */
export function berekenWerkelijkGeplandeVerkoopViaCentraleMapping(
  invoer: GeplandeVerkoopWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly GeplandeVerkoopRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): GeplandeVerkoopWerkelijkViaCentraleMappingResultaat {
  const { perOgb, perGrootboek, nietGemapt } = classificeerBoekingenViaPnLMapping(invoer, boekingen, mappingregels, resolveerGeplandeVerkoopComponentViaCentraleMapping);

  const ogbClassificatie: GeplandeVerkoopClassificatieRegel[] = Array.from(perOgb.entries()).map(([ogbKostensoort, info]) => ({
    ogbKostensoort,
    ogbKostensoortOmschrijving: info.ogbKostensoortOmschrijving,
    component: info.categorie,
  }));
  const grootboekClassificatie: GeplandeVerkoopGrootboekClassificatieRegel[] = Array.from(perGrootboek.entries()).map(([grootboekrekening, info]) => ({
    grootboekrekening,
    grootboekOmschrijving: info.grootboekOmschrijving,
    component: info.categorie,
  }));

  const werkelijkBoekingen: WerkelijkGeplandeVerkoopBoekingRegel[] = boekingen.map((b) => ({ grootboekrekening: b.grootboekrekening, ogbKostensoort: b.ogbKostensoort, saldo: b.saldo }));

  const werkelijk = berekenWerkelijkGeplandeVerkoop(werkelijkBoekingen, ogbClassificatie, grootboekClassificatie);

  return { werkelijk, nietGemapt };
}
