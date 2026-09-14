import { RENTE_CATEGORIEEN, type BgRenteCategorie, type RenteClassificatieRegel } from "./begroteRente.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE M3 (2026-09-14) — eerste ECHTE Werkelijk-migratieproef op de centrale
 * P&L-bronmappingresolver (`resolveerPnLBronmapping`, commit 5ece248).
 *
 * VOORAF ONDERZOCHTE, BELANGRIJKE BEVINDING (§2/§4 van de M3-opdracht):
 * de bestaande Rente-Werkelijk-classificatie (`berekenWerkelijkRente` +
 * `RenteClassificatieRegel`, `begroteRente.ts`) is VOLLEDIG OGB-only — GL
 * (4600/4620) dient daar uitsluitend als bronselectie/gate bij het ophalen
 * van boekingen, GEEN onderdeel van de classificatie zelf.
 * `WerkelijkRenteBoekingRegel` draagt zelfs GEEN grootboekrekening-veld.
 * Cruciaal: de bestaande classificatie kent GEEN ENKEL fallback-mechanisme
 * (dus geen "A. OGB-eerst-dan-willekeurige-GL-fallback" EN geen "B. al
 * GL-genest") — een `ogbKostensoort: null` of een onbekende OGB-code
 * resulteert ALTIJD in "niet geclassificeerd" (WAARSCHUWING), ongeacht welke
 * GL erbij hoort.
 *
 * ONTWERPKEUZE OM 100% GEDRAGSPARITEIT TE GARANDEREN: de centrale mapping
 * voor Rente wordt daarom UITSLUITEND opgebouwd met GL+OGB-SPECIFIEKE rijen
 * — BEWUST GEEN `(GL, null)` GL-default-rij. Zou er wél een GL-default-rij
 * bestaan, dan zou een onbekende/ontbrekende OGB-code op een bekende
 * Rente-GL plotseling een categorie krijgen in plaats van "niet
 * geclassificeerd" — dat zou een ECHTE gedragswijziging zijn (zie
 * `renteCentraleMapping.test.ts`'s NIET_GEMAPT-paritietests). Bewezen: bij
 * zowel 023 (GL4600, 6 OGB-codes, allemaal RENTEKOSTEN) als 013 (GL4620, 2
 * OGB-codes, allemaal RENTE_OPBRENGSTEN) had elke bewezen OGB-code binnen die
 * GL toch al dezelfde categorie — een GL-default zou voor de bewezen
 * fixtures dus geen ander resultaat hebben gegeven, maar WEL voor de
 * NIET_GEMAPT-rand — vandaar de keuze om er bewust geen te gebruiken in deze
 * migratieproef. Het toevoegen van een GL-default-fallback voor Rente is een
 * aparte, latere businessbeslissing (analoog aan OB-039/Geplande Verkoop,
 * waar die keuze al wél bewust is gemaakt), geen impliciet gevolg van deze
 * migratie.
 *
 * GEEN WIJZIGING AAN DE BESTAANDE CALCULATORS: `berekenWerkelijkRente` en
 * `berekenEstimatedRente` blijven volledig ongewijzigd — deze adapter
 * levert uitsluitend een vertaling (centrale resolver →
 * `RenteClassificatieRegel[]`, exact de vorm die `berekenWerkelijkRente` al
 * als parameter accepteert). Geen persistence: alle
 * `PnLBronmappingRegel`-fixtures zijn in-memory testdata, zie moduledoc van
 * `algemeneKostenCentraleMapping.ts` (M2) voor dezelfde, hier herhaalde
 * afweging.
 */

function isBgRenteCategorie(waarde: string): waarde is BgRenteCategorie {
  return (RENTE_CATEGORIEEN as readonly string[]).includes(waarde);
}

export interface RenteCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening
 * via de centrale resolver, naar de bestaande `BgRenteCategorie`. `null` =
 * NIET_GEMAPT (nooit geraden). Faalt hard als de resolver voor deze GL een
 * `economischeModule` anders dan `RENTE` teruggeeft, of een categorie die
 * geen bestaande `BgRenteCategorie` is.
 */
export function resolveerRenteCategorieViaCentraleMapping(
  invoer: RenteCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: BgRenteCategorie; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
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

  if (resultaat.economischeModule !== "RENTE") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "RENTE" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isBgRenteCategorie(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Rente-categorie.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

export interface RenteCentraleMappingResultaat {
  classificatie: readonly RenteClassificatieRegel[];
  /** OGB-kostensoorten waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet zichtbaar, nooit stil genegeerd. */
  nietGemapt: readonly string[];
}

/**
 * Bouwt, voor een gegeven lijst reeds-bekende (OGB-kostensoort +
 * omschrijving)-paren, de equivalente `RenteClassificatieRegel[]` op via de
 * centrale resolver — exact de vorm die `berekenWerkelijkRente` vandaag als
 * `classificatie`-parameter ontvangt.
 */
export function bouwRenteClassificatieViaCentraleMapping(
  invoer: RenteCentraleMappingInvoer,
  ogbKostensoorten: readonly { ogbKostensoort: string; ogbKostensoortOmschrijving: string }[],
  mappingregels: readonly PnLBronmappingRegel[],
): RenteCentraleMappingResultaat {
  const classificatie: RenteClassificatieRegel[] = [];
  const nietGemapt: string[] = [];

  for (const { ogbKostensoort, ogbKostensoortOmschrijving } of ogbKostensoorten) {
    const resultaat = resolveerRenteCategorieViaCentraleMapping(invoer, ogbKostensoort, mappingregels);
    if (resultaat === null) {
      nietGemapt.push(ogbKostensoort);
      continue;
    }
    classificatie.push({ ogbKostensoort, ogbKostensoortOmschrijving, categorie: resultaat.categorie });
  }

  return { classificatie, nietGemapt };
}
