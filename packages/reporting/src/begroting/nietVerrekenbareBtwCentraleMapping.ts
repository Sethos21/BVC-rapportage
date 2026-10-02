import type Decimal from "decimal.js";
import {
  NIET_VERREKENBARE_BTW_WERKELIJK_CATEGORIEEN,
  berekenWerkelijkNietVerrekenbareBtw,
  type NietVerrekenbareBtwWerkelijkCategorie,
  type WerkelijkNietVerrekenbareBtwBoekingRegel,
  type WerkelijkNietVerrekenbareBtwResultaat,
} from "./werkelijkNietVerrekenbareBtw.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { classificeerElkeBoekingViaPnLMapping } from "../pnlBronmappingClassificatie.js";

/**
 * Vervolgtranche 9 Deel B — centrale-mapping-orchestratie voor Werkelijk Niet
 * verrekenbare BTW. Zie `werkelijkNietVerrekenbareBtw.ts` voor de calculator
 * zelf. Volgt letterlijk het M7-/GAT-002D-patroon
 * (`managementCentraleMapping.ts`/`servicekostenEigenaarCentraleMapping.ts`):
 * ruwe boekingen (met GL) → centrale P&L-bronmappingresolver →
 * economischeModule=NIET_VERREKENBARE_BTW + categorie → de pure
 * `berekenWerkelijkNietVerrekenbareBtw`. GEEN legacy-classificatietabel, GEEN
 * terugvertaling, GEEN administratie-specifieke code hier — die kennis stopt
 * bij de mappingregels zelf (`PnLBronmappingRegel[]`, aangeleverd door de
 * aanroeper).
 *
 * GENERIEK, GEEN 070-SPECIFIEKE CODE: deze module bevat zelf geen enkele
 * GL-waarde, OGB-code of administratiecode — GL4903 is uitsluitend
 * 070-MAPPINGGEGEVENS die als `PnLBronmappingRegel[]` worden aangeleverd
 * (zie de bijbehorende testsuite), niet iets dat in deze broncode staat. Een
 * andere administratie zonder bewezen mapping levert via de bestaande
 * resolver simpelweg NIET_GEMAPT op (Unknown != zero) — nooit geraden.
 */

function isNietVerrekenbareBtwWerkelijkCategorie(waarde: string): waarde is NietVerrekenbareBtwWerkelijkCategorie {
  return (NIET_VERREKENBARE_BTW_WERKELIJK_CATEGORIEEN as readonly string[]).includes(waarde);
}

export interface NietVerrekenbareBtwCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening via
 * de centrale resolver, naar de bestaande `NietVerrekenbareBtwWerkelijkCategorie`.
 * `null` = NIET_GEMAPT. Faalt hard als de resolver voor deze GL een
 * `economischeModule` anders dan `NIET_VERREKENBARE_BTW` teruggeeft, of een
 * categorie die geen bestaande categorie van deze module is.
 */
export function resolveerNietVerrekenbareBtwCategorieViaCentraleMapping(
  invoer: NietVerrekenbareBtwCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: NietVerrekenbareBtwWerkelijkCategorie; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
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

  if (resultaat.economischeModule !== "NIET_VERREKENBARE_BTW") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "NIET_VERREKENBARE_BTW" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isNietVerrekenbareBtwWerkelijkCategorie(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Niet-Verrekenbare-BTW-categorie.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface NietVerrekenbareBtwRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  saldo: Decimal;
}

export interface NietVerrekenbareBtwWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface NietVerrekenbareBtwWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkNietVerrekenbareBtwResultaat;
  /** (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet beschikbaar voor latere mappingcontrole/P&L-diagnostiek. */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN VOOR NIET-VERREKENBARE-BTW-WERKELIJK: ruwe
 * boekingen (met GL) → centrale P&L-bronmappingresolver →
 * economischeModule=NIET_VERREKENBARE_BTW + categorie → de pure
 * `berekenWerkelijkNietVerrekenbareBtw`.
 */
export function berekenWerkelijkNietVerrekenbareBtwViaCentraleMapping(
  invoer: NietVerrekenbareBtwWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly NietVerrekenbareBtwRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): NietVerrekenbareBtwWerkelijkViaCentraleMappingResultaat {
  const { boekingen: geclassificeerd, nietGemapt } = classificeerElkeBoekingViaPnLMapping(invoer, boekingen, mappingregels, resolveerNietVerrekenbareBtwCategorieViaCentraleMapping);

  const werkelijkBoekingen: WerkelijkNietVerrekenbareBtwBoekingRegel[] = geclassificeerd.map(({ boeking, categorie }) => ({ economischeCategorie: categorie, saldo: boeking.saldo }));

  const werkelijk = berekenWerkelijkNietVerrekenbareBtw(werkelijkBoekingen);

  return { werkelijk, nietGemapt };
}
