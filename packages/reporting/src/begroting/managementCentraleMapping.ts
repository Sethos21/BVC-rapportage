import type Decimal from "decimal.js";
import { MANAGEMENT_WERKELIJK_CATEGORIEEN, berekenWerkelijkManagement, type ManagementWerkelijkCategorie, type WerkelijkManagementBoekingRegel, type WerkelijkManagementResultaat } from "./werkelijkManagement.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { classificeerElkeBoekingViaPnLMapping } from "../pnlBronmappingClassificatie.js";

/**
 * FASE GAT-002D (2026-09-16) — centrale-mapping-orchestratie voor Werkelijk
 * Management. Zie `werkelijkManagement.ts` voor de calculator zelf. Volgt
 * letterlijk het M7-/GAT-002B-/GAT-002C-patroon
 * (`onderhoudCentraleMapping.ts`/`huurCentraleMapping.ts`/`beheerCentraleMapping.ts`):
 * ruwe boekingen (met GL) → centrale P&L-bronmappingresolver →
 * economischeModule=MANAGEMENT + categorie → de pure `berekenWerkelijkManagement`.
 * GEEN legacy-classificatietabel, GEEN terugvertaling, GEEN administratie-
 * specifieke code hier — die kennis stopt bij de mappingregels zelf
 * (`PnLBronmappingRegel[]`, aangeleverd door de aanroeper).
 *
 * BEWEZEN BRONMAPPING (bronproef tegen de echte 023_Malcon_Beheer_BV-cache,
 * zie `werkelijkManagement.ts`-moduledoc), UITSLUITEND GL-DEFAULT: GL04001 →
 * MANAGEMENTVERGOEDING. OGB 4003 is bij deze bron aanwezig, maar levert geen
 * bewezen tweede businesscategorie op (alle acht bronboekingen zijn
 * economisch homogeen) — er wordt daarom BEWUST geen kunstmatige OGB-
 * verfijning toegevoegd (zie GAT-002D-opdracht: "Maak geen onnodige
 * subcategorie wanneer de bron daarvoor geen businessbehoefte bewijst").
 *
 * GENERIEK, GEEN 023-SPECIFIEKE CODE: deze module bevat zelf geen enkele
 * GL-waarde, OGB-code of administratiecode — GL04001 hierboven is
 * uitsluitend de 023-MAPPINGGEGEVENS die als `PnLBronmappingRegel[]` wordt
 * aangeleverd (zie `managementCentraleMapping.test.ts`), niet iets dat in
 * deze broncode staat. Een andere administratie met een ander GL-nummer
 * gebruikt exact dezelfde functies hieronder, uitsluitend met een andere
 * mappingregel-set.
 */

function isManagementWerkelijkCategorie(waarde: string): waarde is ManagementWerkelijkCategorie {
  return (MANAGEMENT_WERKELIJK_CATEGORIEEN as readonly string[]).includes(waarde);
}

export interface ManagementCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening
 * via de centrale resolver, naar de bestaande `ManagementWerkelijkCategorie`.
 * `null` = NIET_GEMAPT. Faalt hard als de resolver voor deze GL een
 * `economischeModule` anders dan `MANAGEMENT` teruggeeft, of een categorie
 * die geen bestaande Management-categorie is.
 */
export function resolveerManagementCategorieViaCentraleMapping(
  invoer: ManagementCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: ManagementWerkelijkCategorie; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
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

  if (resultaat.economischeModule !== "MANAGEMENT") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "MANAGEMENT" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isManagementWerkelijkCategorie(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Management-categorie.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface ManagementRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  saldo: Decimal;
}

export interface ManagementWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface ManagementWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkManagementResultaat;
  /** (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet beschikbaar voor latere mappingcontrole/P&L-diagnostiek. */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN VOOR MANAGEMENT-WERKELIJK: ruwe boekingen (met
 * GL) → centrale P&L-bronmappingresolver → economischeModule=MANAGEMENT +
 * categorie → de pure `berekenWerkelijkManagement`. Volgt het M7-/GAT-002B-/
 * GAT-002C-patroon: geen legacy-classificatietabel, geen terugvertaling, geen
 * koppeling met de Managementvergoeding-Begroting (zie moduledoc
 * `werkelijkManagement.ts`).
 */
export function berekenWerkelijkManagementViaCentraleMapping(
  invoer: ManagementWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly ManagementRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): ManagementWerkelijkViaCentraleMappingResultaat {
  const { boekingen: geclassificeerd, nietGemapt } = classificeerElkeBoekingViaPnLMapping(invoer, boekingen, mappingregels, resolveerManagementCategorieViaCentraleMapping);

  const werkelijkBoekingen: WerkelijkManagementBoekingRegel[] = geclassificeerd.map(({ boeking, categorie }) => ({ economischeCategorie: categorie, saldo: boeking.saldo }));

  const werkelijk = berekenWerkelijkManagement(werkelijkBoekingen);

  return { werkelijk, nietGemapt };
}
