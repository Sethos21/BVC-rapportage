import type Decimal from "decimal.js";
import {
  GEMEENTELIJKE_LASTEN_WERKELIJK_CATEGORIEEN,
  berekenWerkelijkGemeentelijkeLasten,
  type BgGemeentelijkeLastenWerkelijkCategorie,
  type WerkelijkGemeentelijkeLastenBoekingRegel,
  type WerkelijkGemeentelijkeLastenResultaat,
} from "./begroteGemeentelijkeLasten.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { classificeerElkeBoekingViaPnLMapping } from "../pnlBronmappingClassificatie.js";

/**
 * FASE M7 (2026-09-15) — eerste Werkelijk-laag voor GEMEENTELIJKE LASTEN,
 * vanaf het begin gebouwd op de centrale P&L-bronmappingresolver. Zie
 * `begroteGemeentelijkeLasten.ts`'s "Werkelijk"-sectie voor de calculator
 * zelf en de "ÉÉN P&L-POST"-motivatie.
 *
 * BEWEZEN BRONMAPPING (M7-opdracht §4): GL4700 ("WOZ / OZB") + OGB4701
 * ("OZB") → GEMEENTELIJKE_LASTEN (GL+OGB-specifiek); GL4710 ("Gemeentelijke
 * heffingen") → GEMEENTELIJKE_LASTEN via GL-DEFAULT (geen bewezen
 * OGB-verfijning voor deze GL). Beide grootboekrekeningen dragen
 * `economischeModule = GEMEENTELIJKE_LASTEN` — voldoet aan de M4b-
 * GL-domein-invariant, want elke GL heeft precies één module, ook al
 * verschilt de specificiteit per GL.
 *
 * GL4700 KRIJGT BEWUST GEEN GL-DEFAULT: een boeking op GL4700 zonder OGB4701
 * (of met een andere/onbekende OGB-code) heeft geen bewezen betekenis —
 * NIET automatisch als GEMEENTELIJKE_LASTEN meegeteld, blijft NIET_GEMAPT.
 * Dat is een BEWUSTE asymmetrie tussen GL4700 (wél OGB-verfijning bewezen)
 * en GL4710 (uitsluitend GL-niveau bewezen) — geen aanname dat afwezigheid
 * van bewijs voor de één ook voor de ander geldt.
 *
 * GEEN ECHT PROOFBEDRAG IN DE REPO (M7-opdracht §9, expliciet gerapporteerd,
 * zelfde situatie als Verzekeringen): uitsluitend de GL/OGB→categorie-mapping
 * is bronbewezen (rechtstreeks aangeleverd in de M7-opdracht) — geen
 * bestaand, uit een echte administratie geëxtraheerd eurobedrag. Tests
 * bewijzen classificatie/sommatie op een expliciet gemarkeerde testfixture.
 */

function isBgGemeentelijkeLastenWerkelijkCategorie(waarde: string): waarde is BgGemeentelijkeLastenWerkelijkCategorie {
  return (GEMEENTELIJKE_LASTEN_WERKELIJK_CATEGORIEEN as readonly string[]).includes(waarde);
}

export interface GemeentelijkeLastenCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening
 * via de centrale resolver, naar de bestaande `BgGemeentelijkeLastenWerkelijkCategorie`.
 * `null` = NIET_GEMAPT. Faalt hard als de resolver voor deze GL een
 * `economischeModule` anders dan `GEMEENTELIJKE_LASTEN` teruggeeft, of een
 * categorie die geen bestaande categorie is.
 */
export function resolveerGemeentelijkeLastenCategorieViaCentraleMapping(
  invoer: GemeentelijkeLastenCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: BgGemeentelijkeLastenWerkelijkCategorie; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
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

  if (resultaat.economischeModule !== "GEMEENTELIJKE_LASTEN") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "GEMEENTELIJKE_LASTEN" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isBgGemeentelijkeLastenWerkelijkCategorie(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Gemeentelijke-Lasten-categorie.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface GemeentelijkeLastenRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  complexnummer: string | null;
  saldo: Decimal;
}

export interface GemeentelijkeLastenWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface GemeentelijkeLastenWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkGemeentelijkeLastenResultaat;
  /** (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet beschikbaar voor latere mappingcontrole/P&L-diagnostiek. */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN VOOR GEMEENTELIJKE-LASTEN-WERKELIJK: ruwe
 * boekingen (met GL) → centrale P&L-bronmappingresolver →
 * economischeModule=GEMEENTELIJKE_LASTEN + categorie → de nieuwe, pure
 * `berekenWerkelijkGemeentelijkeLasten`. Volgt het M7-patroon (§0): geen
 * legacy-classificatietabel, geen terugvertaling.
 */
export function berekenWerkelijkGemeentelijkeLastenViaCentraleMapping(
  invoer: GemeentelijkeLastenWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly GemeentelijkeLastenRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): GemeentelijkeLastenWerkelijkViaCentraleMappingResultaat {
  const { boekingen: geclassificeerd, nietGemapt } = classificeerElkeBoekingViaPnLMapping(invoer, boekingen, mappingregels, resolveerGemeentelijkeLastenCategorieViaCentraleMapping);

  const werkelijkBoekingen: WerkelijkGemeentelijkeLastenBoekingRegel[] = geclassificeerd.map(({ boeking, categorie }) => ({
    economischeCategorie: categorie,
    complexnummer: boeking.complexnummer,
    saldo: boeking.saldo,
  }));

  const werkelijk = berekenWerkelijkGemeentelijkeLasten(werkelijkBoekingen);

  return { werkelijk, nietGemapt };
}
