import type Decimal from "decimal.js";
import { HUUR_WERKELIJK_CATEGORIEEN, berekenWerkelijkHuur, type HuurWerkelijkCategorie, type WerkelijkHuurBoekingRegel, type WerkelijkHuurResultaat } from "./werkelijkHuur.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { classificeerElkeBoekingViaPnLMapping } from "../pnlBronmappingClassificatie.js";

/**
 * FASE GAT-002B (2026-09-16) — centrale-mapping-orchestratie voor Werkelijk
 * Huur. Zie `werkelijkHuur.ts` voor de calculator zelf. Volgt letterlijk het
 * M7-patroon (`onderhoudCentraleMapping.ts`): ruwe boekingen (met GL) →
 * centrale P&L-bronmappingresolver → economischeModule=HUUR + categorie →
 * de pure `berekenWerkelijkHuur`. GEEN legacy-classificatietabel, GEEN
 * terugvertaling, GEEN administratie-specifieke code hier — die kennis stopt
 * bij de mappingregels zelf (`PnLBronmappingRegel[]`, aangeleverd door de
 * aanroeper).
 *
 * BEWEZEN BRONMAPPING (GAT-002B-opdracht §3 en §4-brongate, bevestigd tegen
 * `packages/config/README.md`), UITSLUITEND GL-DEFAULTS (geen OGB-verfijning
 * aangeleverd/bewezen — een kunstmatige OGB-verfijning zou hier een
 * onderscheid suggereren dat de bron niet bewijst):
 *  - GL8800 → HUUROPBRENGST_BELAST
 *  - GL8801 → HUUROPBRENGST_ONBELAST
 *  - GL8805 → VERLEENDE_HUURKORTING
 *
 * GENERIEK, GEEN 070-SPECIFIEKE CODE: deze module bevat zelf geen enkele
 * GL-waarde, OGB-code of administratiecode — GL8800/8801/8805 hierboven zijn
 * uitsluitend de 070-MAPPINGGEGEVENS die als `PnLBronmappingRegel[]` worden
 * aangeleverd (zie `huurCentraleMapping.test.ts`), niet iets dat in deze
 * broncode staat. Een andere administratie met andere GL-nummers gebruikt
 * exact dezelfde functies hieronder, uitsluitend met een andere
 * mappingregel-set (zie de synthetische TEST071-acceptatietest).
 */

function isHuurWerkelijkCategorie(waarde: string): waarde is HuurWerkelijkCategorie {
  return (HUUR_WERKELIJK_CATEGORIEEN as readonly string[]).includes(waarde);
}

export interface HuurCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening
 * via de centrale resolver, naar de bestaande `HuurWerkelijkCategorie`.
 * `null` = NIET_GEMAPT. Faalt hard als de resolver voor deze GL een
 * `economischeModule` anders dan `HUUR` teruggeeft, of een categorie die
 * geen bestaande Huur-categorie is.
 */
export function resolveerHuurCategorieViaCentraleMapping(
  invoer: HuurCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: HuurWerkelijkCategorie; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
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

  if (resultaat.economischeModule !== "HUUR") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "HUUR" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isHuurWerkelijkCategorie(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Huur-categorie.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface HuurRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  saldo: Decimal;
}

export interface HuurWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface HuurWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkHuurResultaat;
  /** (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet beschikbaar voor latere mappingcontrole/P&L-diagnostiek. */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN VOOR HUUR-WERKELIJK: ruwe boekingen (met GL) →
 * centrale P&L-bronmappingresolver → economischeModule=HUUR + categorie →
 * de pure `berekenWerkelijkHuur`. Volgt het M7-patroon: geen legacy-
 * classificatietabel, geen terugvertaling, geen Contracten/RentRoll/Module-1-
 * koppeling (zie moduledoc `werkelijkHuur.ts`).
 */
export function berekenWerkelijkHuurViaCentraleMapping(
  invoer: HuurWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly HuurRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): HuurWerkelijkViaCentraleMappingResultaat {
  const { boekingen: geclassificeerd, nietGemapt } = classificeerElkeBoekingViaPnLMapping(invoer, boekingen, mappingregels, resolveerHuurCategorieViaCentraleMapping);

  const werkelijkBoekingen: WerkelijkHuurBoekingRegel[] = geclassificeerd.map(({ boeking, categorie }) => ({ economischeCategorie: categorie, saldo: boeking.saldo }));

  const werkelijk = berekenWerkelijkHuur(werkelijkBoekingen);

  return { werkelijk, nietGemapt };
}
