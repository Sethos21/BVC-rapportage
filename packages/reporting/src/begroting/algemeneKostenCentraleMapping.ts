import type Decimal from "decimal.js";
import { ALGEMENE_KOSTEN_CATEGORIEEN, type BgAlgemeneKostenCategorie, type BgAlgemeneKostenClassificatieRegel } from "./begroteAlgemeneKosten.js";
import { berekenWerkelijkAlgemeneKosten, type WerkelijkAlgemeneKostenBoekingRegel, type WerkelijkAlgemeneKostenResultaat } from "./werkelijkAlgemeneKosten.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { classificeerElkeBoekingViaPnLMapping } from "../pnlBronmappingClassificatie.js";

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
 *
 * ADDENDUM — FASE GAT-009 (2026-09-16): de hierboven beschreven bevinding
 * ("geen Werkelijk-classificatie van boekingen") is met deze fase VERVALLEN
 * — zie `berekenWerkelijkAlgemeneKostenViaCentraleMapping` verderop in dit
 * bestand en `werkelijkAlgemeneKosten.ts` voor de nu wél bestaande,
 * standalone Werkelijk-productieketen (Boekingen → centrale mapping →
 * `berekenWerkelijkAlgemeneKosten` → Pure P&L-adapter). Deze nieuwe keten
 * hergebruikt de M2-resolver hieronder ONGEWIJZIGD; de M2-functies zelf
 * (`resolveerAlgemeneKostenCategorieViaCentraleMapping`/
 * `bouwAlgemeneKostenClassificatieViaCentraleMapping`) en hun bestaande
 * Begroting-validatiestroom blijven exact zoals hierboven beschreven.
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

/**
 * FASE GAT-009 (2026-09-16) — AANVULLING: de Werkelijk-productieketen voor
 * Algemene Kosten, volgens hetzelfde M7-/GAT-002B-/GAT-002C-/GAT-002D-patroon
 * (`onderhoudCentraleMapping.ts`/`huurCentraleMapping.ts`/
 * `beheerCentraleMapping.ts`/`managementCentraleMapping.ts`): ruwe boekingen
 * (met GL) → centrale P&L-bronmappingresolver → economischeModule=
 * ALGEMENE_KOSTEN + categorie → de pure `berekenWerkelijkAlgemeneKosten`.
 * Hergebruikt bewust de BOVENSTAANDE, reeds bestaande
 * `resolveerAlgemeneKostenCategorieViaCentraleMapping` (M2) — GEEN tweede
 * resolver, GEEN gedupliceerde mappingarchitectuur. Het verschil met de
 * M2-functies hierboven is uitsluitend WAT ermee gevoed wordt: M2 vertaalt
 * naar de OUDE, OGB-array-gebaseerde `BgAlgemeneKostenClassificatieRegel[]`
 * (voor de bestaande, ongewijzigde Begroting-validatiestroom); deze
 * aanvulling classificeert RUWE BOEKINGEN rechtstreeks, per boeking, via
 * `classificeerElkeBoekingViaPnLMapping` (het M7-patroon, structureel immuun
 * voor het M6a-batchcollisieprobleem) voor de nieuwe Werkelijk-calculator.
 *
 * GENERIEK, GEEN 070-SPECIFIEKE CODE: deze functies bevatten zelf geen enkele
 * GL-waarde, OGB-code of administratiecode — GL4990/OGB4990/4991/4992/4995
 * bestaan uitsluitend als 070-MAPPINGGEGEVENS die als `PnLBronmappingRegel[]`
 * worden aangeleverd (zie `algemeneKostenWerkelijkKetenProof.test.ts`), niet
 * iets dat in deze broncode staat.
 */

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface AlgemeneKostenRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  saldo: Decimal;
}

export interface AlgemeneKostenWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface AlgemeneKostenWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkAlgemeneKostenResultaat;
  /** (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet beschikbaar voor latere mappingcontrole/P&L-diagnostiek. */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN VOOR ALGEMENE-KOSTEN-WERKELIJK: ruwe boekingen
 * (met GL) → centrale P&L-bronmappingresolver → economischeModule=
 * ALGEMENE_KOSTEN + categorie → de pure `berekenWerkelijkAlgemeneKosten`.
 * Geen legacy-classificatietabel, geen terugvertaling, geen koppeling met
 * Module 2 (zie moduledoc `werkelijkAlgemeneKosten.ts`).
 */
export function berekenWerkelijkAlgemeneKostenViaCentraleMapping(
  invoer: AlgemeneKostenWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly AlgemeneKostenRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): AlgemeneKostenWerkelijkViaCentraleMappingResultaat {
  const { boekingen: geclassificeerd, nietGemapt } = classificeerElkeBoekingViaPnLMapping(invoer, boekingen, mappingregels, resolveerAlgemeneKostenCategorieViaCentraleMapping);

  const werkelijkBoekingen: WerkelijkAlgemeneKostenBoekingRegel[] = geclassificeerd.map(({ boeking, categorie }) => ({ economischeCategorie: categorie, saldo: boeking.saldo }));

  const werkelijk = berekenWerkelijkAlgemeneKosten(werkelijkBoekingen);

  return { werkelijk, nietGemapt };
}
