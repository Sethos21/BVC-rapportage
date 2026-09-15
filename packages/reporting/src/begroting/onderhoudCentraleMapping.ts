import type Decimal from "decimal.js";
import { ONDERHOUD_WERKELIJK_CATEGORIEEN, berekenWerkelijkOnderhoud, type OnderhoudWerkelijkCategorie, type WerkelijkOnderhoudBoekingRegel, type WerkelijkOnderhoudResultaat } from "./werkelijkOnderhoud.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { classificeerElkeBoekingViaPnLMapping } from "../pnlBronmappingClassificatie.js";

/**
 * FASE M7 (2026-09-15) — centrale-mapping-orchestratie voor Werkelijk
 * Onderhoud. Zie `werkelijkOnderhoud.ts` voor de calculator zelf en de
 * motivatie waarom dit GEEN "WerkelijkGeplandOnderhoud"/
 * "WerkelijkCorrectiefOnderhoud" is.
 *
 * BEWEZEN BRONMAPPING (M7-opdracht §5), UITSLUITEND GL-DEFAULTS (geen OGB-
 * verfijning aangeleverd/bewezen voor deze drie grootboekrekeningen):
 *  - GL4300 → ONDERHOUD_GEBOUWEN
 *  - GL4330 → ONDERHOUD_TERREIN
 *  - GL4340 → ONDERHOUD_INSTALLATIES
 *
 * GEEN AUTOMATISCHE GEPLAND/CORRECTIEF-CLASSIFICATIE (M7-opdracht §5,
 * expliciet herhaald): deze module — en de centrale mapping die ze voedt —
 * kent NOOIT een "gepland" of "correctief/dagelijks"-dimensie. Een
 * misleidende `ogbKostensoortOmschrijving` of vrije tekst kan de categorie
 * niet beïnvloeden (de resolver kijkt uitsluitend naar GL+OGB-codes, nooit
 * naar omschrijvingen) — zie `onderhoudCentraleMapping.test.ts`.
 *
 * GEEN ECHT PROOFBEDRAG IN DE REPO (M7-opdracht §9, expliciet gerapporteerd,
 * zelfde situatie als Verzekeringen/Gemeentelijke Lasten): uitsluitend de
 * GL→categorie-mapping is bronbewezen (rechtstreeks aangeleverd in de
 * M7-opdracht) — geen bestaand, uit een echte administratie geëxtraheerd
 * eurobedrag. Tests bewijzen classificatie/sommatie op een expliciet
 * gemarkeerde testfixture.
 */

function isOnderhoudWerkelijkCategorie(waarde: string): waarde is OnderhoudWerkelijkCategorie {
  return (ONDERHOUD_WERKELIJK_CATEGORIEEN as readonly string[]).includes(waarde);
}

export interface OnderhoudCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening
 * via de centrale resolver, naar de bestaande `OnderhoudWerkelijkCategorie`.
 * `null` = NIET_GEMAPT. Faalt hard als de resolver voor deze GL een
 * `economischeModule` anders dan `ONDERHOUD` teruggeeft, of een categorie
 * die geen bestaande Onderhoud-categorie is.
 */
export function resolveerOnderhoudCategorieViaCentraleMapping(
  invoer: OnderhoudCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: OnderhoudWerkelijkCategorie; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
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

  if (resultaat.economischeModule !== "ONDERHOUD") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "ONDERHOUD" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isOnderhoudWerkelijkCategorie(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Onderhoud-categorie.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface OnderhoudRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  complexnummer: string | null;
  saldo: Decimal;
}

export interface OnderhoudWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface OnderhoudWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkOnderhoudResultaat;
  /** (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet beschikbaar voor latere mappingcontrole/P&L-diagnostiek. */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN VOOR ONDERHOUD-WERKELIJK: ruwe boekingen (met
 * GL) → centrale P&L-bronmappingresolver → economischeModule=ONDERHOUD +
 * categorie → de nieuwe, pure `berekenWerkelijkOnderhoud`. Volgt het
 * M7-patroon (§0): geen legacy-classificatietabel, geen terugvertaling, en
 * — structureel — geen enkele mogelijkheid tot automatische gepland/
 * correctief-afleiding (die dimensie bestaat nergens in deze keten).
 */
export function berekenWerkelijkOnderhoudViaCentraleMapping(
  invoer: OnderhoudWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly OnderhoudRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): OnderhoudWerkelijkViaCentraleMappingResultaat {
  const { boekingen: geclassificeerd, nietGemapt } = classificeerElkeBoekingViaPnLMapping(invoer, boekingen, mappingregels, resolveerOnderhoudCategorieViaCentraleMapping);

  const werkelijkBoekingen: WerkelijkOnderhoudBoekingRegel[] = geclassificeerd.map(({ boeking, categorie }) => ({
    economischeCategorie: categorie,
    complexnummer: boeking.complexnummer,
    saldo: boeking.saldo,
  }));

  const werkelijk = berekenWerkelijkOnderhoud(werkelijkBoekingen);

  return { werkelijk, nietGemapt };
}
