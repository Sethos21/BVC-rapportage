import type Decimal from "decimal.js";
import { BEHEER_WERKELIJK_CATEGORIEEN, berekenWerkelijkBeheer, type BeheerWerkelijkCategorie, type WerkelijkBeheerBoekingRegel, type WerkelijkBeheerResultaat } from "./werkelijkBeheer.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { classificeerElkeBoekingViaPnLMapping } from "../pnlBronmappingClassificatie.js";

/**
 * FASE GAT-002C (2026-09-16) — centrale-mapping-orchestratie voor Werkelijk
 * Beheer. Zie `werkelijkBeheer.ts` voor de calculator zelf. Volgt letterlijk
 * het M7-/GAT-002B-patroon (`onderhoudCentraleMapping.ts`/`huurCentraleMapping.ts`):
 * ruwe boekingen (met GL) → centrale P&L-bronmappingresolver →
 * economischeModule=BEHEER + categorie → de pure `berekenWerkelijkBeheer`.
 * GEEN legacy-classificatietabel, GEEN terugvertaling, GEEN administratie-
 * specifieke code hier — die kennis stopt bij de mappingregels zelf
 * (`PnLBronmappingRegel[]`, aangeleverd door de aanroeper).
 *
 * BEWEZEN BRONMAPPING (bronproef tegen de echte 070-cache, zie
 * `werkelijkBeheer.ts`-moduledoc), UITSLUITEND GL-DEFAULT (geen OGB-
 * verfijning aangeleverd/bewezen — de brondata draagt geen OGB-kostensoort):
 *  - GL4000 → BEHEERKOSTEN
 *
 * GENERIEK, GEEN 070-SPECIFIEKE CODE: deze module bevat zelf geen enkele
 * GL-waarde, OGB-code of administratiecode — GL4000 hierboven is uitsluitend
 * de 070-MAPPINGGEGEVENS die als `PnLBronmappingRegel[]` wordt aangeleverd
 * (zie `beheerCentraleMapping.test.ts`), niet iets dat in deze broncode
 * staat. Een andere administratie met een ander GL-nummer gebruikt exact
 * dezelfde functies hieronder, uitsluitend met een andere mappingregel-set.
 */

function isBeheerWerkelijkCategorie(waarde: string): waarde is BeheerWerkelijkCategorie {
  return (BEHEER_WERKELIJK_CATEGORIEEN as readonly string[]).includes(waarde);
}

export interface BeheerCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening
 * via de centrale resolver, naar de bestaande `BeheerWerkelijkCategorie`.
 * `null` = NIET_GEMAPT. Faalt hard als de resolver voor deze GL een
 * `economischeModule` anders dan `BEHEER` teruggeeft, of een categorie die
 * geen bestaande Beheer-categorie is.
 */
export function resolveerBeheerCategorieViaCentraleMapping(
  invoer: BeheerCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: BeheerWerkelijkCategorie; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
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

  if (resultaat.economischeModule !== "BEHEER") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "BEHEER" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isBeheerWerkelijkCategorie(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Beheer-categorie.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface BeheerRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  saldo: Decimal;
}

export interface BeheerWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface BeheerWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkBeheerResultaat;
  /** (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet beschikbaar voor latere mappingcontrole/P&L-diagnostiek. */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN VOOR BEHEER-WERKELIJK: ruwe boekingen (met GL)
 * → centrale P&L-bronmappingresolver → economischeModule=BEHEER + categorie
 * → de pure `berekenWerkelijkBeheer`. Volgt het M7-/GAT-002B-patroon: geen
 * legacy-classificatietabel, geen terugvertaling, geen koppeling met Module 2
 * (zie moduledoc `werkelijkBeheer.ts`).
 */
export function berekenWerkelijkBeheerViaCentraleMapping(
  invoer: BeheerWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly BeheerRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): BeheerWerkelijkViaCentraleMappingResultaat {
  const { boekingen: geclassificeerd, nietGemapt } = classificeerElkeBoekingViaPnLMapping(invoer, boekingen, mappingregels, resolveerBeheerCategorieViaCentraleMapping);

  const werkelijkBoekingen: WerkelijkBeheerBoekingRegel[] = geclassificeerd.map(({ boeking, categorie }) => ({ economischeCategorie: categorie, saldo: boeking.saldo }));

  const werkelijk = berekenWerkelijkBeheer(werkelijkBoekingen);

  return { werkelijk, nietGemapt };
}
