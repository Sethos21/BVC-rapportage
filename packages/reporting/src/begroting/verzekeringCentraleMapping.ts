import type Decimal from "decimal.js";
import {
  VERZEKERING_WERKELIJK_CATEGORIEEN,
  berekenWerkelijkVerzekeringen,
  type BgVerzekeringWerkelijkCategorie,
  type WerkelijkVerzekeringBoekingRegel,
  type WerkelijkVerzekeringResultaat,
} from "./begroteVerzekeringen.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { classificeerElkeBoekingViaPnLMapping } from "../pnlBronmappingClassificatie.js";

/**
 * FASE M7 (2026-09-15) — eerste Werkelijk-laag voor VERZEKERINGEN, vanaf het
 * begin gebouwd op de centrale P&L-bronmappingresolver. Zie
 * `begroteVerzekeringen.ts`'s "Werkelijk"-sectie voor de calculator zelf en
 * de motivatie waarom deze GEEN GL/OGB-kennis heeft.
 *
 * BEWEZEN BRONMAPPING (M7-opdracht §3): UITSLUITEND GL4130 ("Verzekering")
 * + OGB4131 ("Brand-/opstalverzekering") → BRAND_OPSTALVERZEKERING. GEEN
 * GL-default voor GL4130 — een boeking op GL4130 zonder OGB4131 (of met een
 * andere/onbekende OGB-code) heeft geen bewezen betekenis en blijft daarom
 * NIET_GEMAPT, nooit geraden.
 *
 * GEEN ECHT PROOFBEDRAG IN DE REPO (M7-opdracht §9, expliciet gerapporteerd):
 * er is geen bestaand, uit een echte administratie geëxtraheerd eurobedrag
 * voor GL4130/OGB4131 beschikbaar — uitsluitend de GL/OGB→categorie-mapping
 * zelf is bronbewezen (rechtstreeks aangeleverd in de M7-opdracht). De tests
 * bewijzen daarom de CLASSIFICATIE en SOMMATIE-logica op een expliciet
 * gemarkeerde testfixture, niet een reëel bronbedrag.
 */

function isBgVerzekeringWerkelijkCategorie(waarde: string): waarde is BgVerzekeringWerkelijkCategorie {
  return (VERZEKERING_WERKELIJK_CATEGORIEEN as readonly string[]).includes(waarde);
}

export interface VerzekeringCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening
 * via de centrale resolver, naar de bestaande `BgVerzekeringWerkelijkCategorie`.
 * `null` = NIET_GEMAPT. Faalt hard als de resolver voor deze GL een
 * `economischeModule` anders dan `VERZEKERINGEN` teruggeeft, of een
 * categorie die geen bestaande verzekeringscategorie is.
 */
export function resolveerVerzekeringCategorieViaCentraleMapping(
  invoer: VerzekeringCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: BgVerzekeringWerkelijkCategorie; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
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

  if (resultaat.economischeModule !== "VERZEKERINGEN") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "VERZEKERINGEN" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isBgVerzekeringWerkelijkCategorie(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Verzekeringen-categorie.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface VerzekeringRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  complexnummer: string | null;
  saldo: Decimal;
}

export interface VerzekeringWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface VerzekeringWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkVerzekeringResultaat;
  /** (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet beschikbaar voor latere mappingcontrole/P&L-diagnostiek. */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN VOOR VERZEKERINGEN-WERKELIJK: ruwe boekingen
 * (met GL) → centrale P&L-bronmappingresolver → economischeModule=VERZEKERINGEN
 * + categorie → de nieuwe, pure `berekenWerkelijkVerzekeringen` (die zelf
 * GEEN GL/OGB-kennis heeft, zie moduledoc `begroteVerzekeringen.ts`). Volgt
 * het NIEUWE M7-patroon (§0): geen legacy-classificatietabel, geen
 * terugvertaling — elke boeking behoudt gewoon haar eigen resultaat via
 * `classificeerElkeBoekingViaPnLMapping`.
 */
export function berekenWerkelijkVerzekeringenViaCentraleMapping(
  invoer: VerzekeringWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly VerzekeringRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): VerzekeringWerkelijkViaCentraleMappingResultaat {
  const { boekingen: geclassificeerd, nietGemapt } = classificeerElkeBoekingViaPnLMapping(invoer, boekingen, mappingregels, resolveerVerzekeringCategorieViaCentraleMapping);

  const werkelijkBoekingen: WerkelijkVerzekeringBoekingRegel[] = geclassificeerd.map(({ boeking, categorie }) => ({
    economischeCategorie: categorie,
    complexnummer: boeking.complexnummer,
    saldo: boeking.saldo,
  }));

  const werkelijk = berekenWerkelijkVerzekeringen(werkelijkBoekingen);

  return { werkelijk, nietGemapt };
}
