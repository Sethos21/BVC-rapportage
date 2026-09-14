import { ALGEMENE_KOSTEN_CATEGORIEEN, type BgAlgemeneKostenCategorie, type BgAlgemeneKostenClassificatieRegel } from "./begroteAlgemeneKosten.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE M2 (2026-09-14) — migratieproef Algemene Kosten op de centrale
 * P&L-bronmappingresolver (`resolveerPnLBronmapping`, commit 5ece248).
 *
 * BELANGRIJKE, VOORAF GERAPPORTEERDE BEVINDING (onverwachte semantiek t.o.v.
 * de M2-opdracht): Algemene Kosten heeft VANDAAG GEEN Werkelijk-classificatie
 * van boekingen — er bestaat geen `berekenWerkelijkAlgemeneKosten`. De
 * bestaande `algemeneKostenClassificatie`-tabel (`@bvc/begroting-data`) wordt
 * uitsluitend gebruikt om het OPTIONELE `ogbKostensoortCode`-veld op een
 * BEGROTINGSREGEL te VALIDEREN (bestaat de code, hoort hij bij de juiste
 * categorie?) — geen GL-dimensie, geen boekingenstroom. Dit bestand
 * MIGREERT DAAROM NIET de bestaande validatiestroom (dat zou, door het
 * ontbreken van een "onbekende code"-KRITIEK-signaal via de nieuwe
 * GL-default-fallback, een ECHTE gedragswijziging zijn — precies wat "geen
 * economische wijziging" verbiedt). In plaats daarvan bewijst dit bestand,
 * puur en losstaand, dat de centrale resolver — gevoed met de bewezen
 * 070/GL4990-bronfeiten — DEZELFDE classificatie-uitkomst (OGB-kostensoort →
 * `BgAlgemeneKostenCategorie`) produceert als een volledig, met de hand
 * ingevulde `algemeneKostenClassificatie`-tabel dat vandaag zou doen. Zie
 * `algemeneKostenCentraleMapping.test.ts` voor het oud-vs-nieuw-bewijs en de
 * bedragsvergelijking.
 *
 * GEEN WIJZIGING AAN DE BESTAANDE CALCULATOR: `berekenBegroteAlgemeneKosten`
 * en `algemeneKostenClassificatie.ts` blijven volledig ongewijzigd. Dit
 * bestand levert uitsluitend een VERTALING (centrale resolver →
 * `BgAlgemeneKostenClassificatieRegel[]`, exact de vorm die de bestaande
 * calculator al als parameter accepteert) — geen runtime dual-write, geen
 * persistence van centrale mappings (die volgt pas in een latere fase; de
 * "module(GL+OGB) == module(GL-default)"-opslaan-invariant wordt dus ook pas
 * dán afgedwongen, hier uitsluitend als runtime-resolutiecheck via
 * `resolveerPnLBronmapping` zelf).
 */

function isBgAlgemeneKostenCategorie(waarde: string): waarde is BgAlgemeneKostenCategorie {
  return (ALGEMENE_KOSTEN_CATEGORIEEN as readonly string[]).includes(waarde);
}

export interface AlgemeneKostenCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening
 * via de centrale resolver, naar de bestaande `BgAlgemeneKostenCategorie`.
 * `null` = NIET_GEMAPT (nooit geraden, zie moduledoc).
 *
 * Faalt hard (fail-fast, geen stille coercie) als de centrale resolver voor
 * deze GL een `economischeModule` teruggeeft die niet `ALGEMENE_KOSTEN` is,
 * of een `economischeCategorie` die geen bestaande `BgAlgemeneKostenCategorie`
 * is — beide zijn configuratiefouten van de (nog te bouwen) mapping-invoer,
 * nooit iets om in deze adapter te verzoenen.
 */
export function resolveerAlgemeneKostenCategorieViaCentraleMapping(
  invoer: AlgemeneKostenCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: BgAlgemeneKostenCategorie; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
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

  if (resultaat.economischeModule !== "ALGEMENE_KOSTEN") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "ALGEMENE_KOSTEN" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isBgAlgemeneKostenCategorie(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Algemene-Kosten-categorie.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

export interface AlgemeneKostenCentraleMappingResultaat {
  classificatie: readonly BgAlgemeneKostenClassificatieRegel[];
  /** OGB-kostensoorten waarvoor de centrale mapping GEEN uitkomst (NIET_GEMAPT) opleverde — expliciet zichtbaar, nooit stil genegeerd. */
  nietGemapt: readonly string[];
}

/**
 * Bouwt, voor een gegeven lijst reeds-bekende (OGB-kostensoort +
 * omschrijving)-paren, de equivalente `BgAlgemeneKostenClassificatieRegel[]`
 * op via de centrale resolver — exact de vorm die
 * `berekenBegroteAlgemeneKosten` vandaag als `classificatie`-parameter
 * ontvangt. Dit is de vertaalstap uit het M2-ontwerp: "OGB-kostensoort →
 * centrale mappingresolver → reeds bestaande economische categorie →
 * bestaande, ongewijzigde calculator".
 */
export function bouwAlgemeneKostenClassificatieViaCentraleMapping(
  invoer: AlgemeneKostenCentraleMappingInvoer,
  ogbKostensoorten: readonly { ogbKostensoort: string; ogbKostensoortOmschrijving: string }[],
  mappingregels: readonly PnLBronmappingRegel[],
): AlgemeneKostenCentraleMappingResultaat {
  const classificatie: BgAlgemeneKostenClassificatieRegel[] = [];
  const nietGemapt: string[] = [];

  for (const { ogbKostensoort, ogbKostensoortOmschrijving } of ogbKostensoorten) {
    const resultaat = resolveerAlgemeneKostenCategorieViaCentraleMapping(invoer, ogbKostensoort, mappingregels);
    if (resultaat === null) {
      nietGemapt.push(ogbKostensoort);
      continue;
    }
    classificatie.push({ ogbKostensoort, ogbKostensoortOmschrijving, categorie: resultaat.categorie });
  }

  return { classificatie, nietGemapt };
}
