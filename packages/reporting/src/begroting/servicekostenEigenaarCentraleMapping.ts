import type Decimal from "decimal.js";
import {
  SERVICEKOSTEN_EIGENAAR_WERKELIJK_CATEGORIEEN,
  berekenWerkelijkServicekostenEigenaar,
  type ServicekostenEigenaarWerkelijkCategorie,
  type WerkelijkServicekostenEigenaarBoekingRegel,
  type WerkelijkServicekostenEigenaarResultaat,
} from "./werkelijkServicekostenEigenaar.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { classificeerElkeBoekingViaPnLMapping } from "../pnlBronmappingClassificatie.js";

/**
 * FASE GAT-006 (2026-09-17) — centrale-mapping-orchestratie voor Werkelijk
 * Servicekosten Eigenaar. Zie `werkelijkServicekostenEigenaar.ts` voor de
 * calculator zelf. Volgt letterlijk het M7-patroon
 * (`onderhoudCentraleMapping.ts`/`beheerCentraleMapping.ts`/e.a.): ruwe
 * boekingen (met GL) → centrale P&L-bronmappingresolver →
 * economischeModule=SERVICEKOSTEN_EIGENAAR + categorie → de pure
 * `berekenWerkelijkServicekostenEigenaar`. GEEN legacy-classificatietabel,
 * GEEN terugvertaling, GEEN administratie-specifieke code hier — die kennis
 * stopt bij de mappingregels zelf (`PnLBronmappingRegel[]`, aangeleverd door
 * de aanroeper).
 *
 * BEWEZEN BRONMAPPING (GAT-006-opdracht, hergebruik van het bestaande M5-
 * bewijs — geen nieuwe bronanalyse): 070/GL4350/OGB4319 ("Servicekosten
 * leegstand") → SERVICEKOSTEN_LEEGSTAND, uitsluitend GL+OGB-specifiek. GEEN
 * GL-default voor GL4350 (zelfde discipline als M5 destijds koos voor
 * LEEGSTAND: een onbekende/andere OGB-code op GL4350 is NIET automatisch
 * REGULIER of LEEGSTAND — Unknown != zero, blijft NIET_GEMAPT totdat een
 * echte bronproef die verfijning levert). Zie
 * `servicekostenEigenaarCentraleMapping.test.ts` voor het volledige bewijs
 * (6 boekingen, complex 003, totaal €1.354,10 — ongewijzigd t.o.v. het
 * eerdere M5-bewijs, nu onder het correcte hoofddomein).
 *
 * M4B BLIJFT INTACT: deze module voegt geen nieuwe mappingopslag toe — de
 * `(bedrijfsnr, GL) → één stabiel hoofddomein`-invariant wordt, zoals overal
 * elders, uitsluitend afgedwongen door de bestaande, ongewijzigde
 * `resolveerPnLBronmapping` (fail-fast bij een GL+OGB-rij met een andere
 * `economischeModule` dan de GL-default van dezelfde grootboekrekening) en —
 * bij daadwerkelijke persistence — `@bvc/begroting-data`'s
 * `pnlBronmappingRepository.ts`. Geen van beide is in deze fase gewijzigd.
 *
 * GENERIEK, GEEN 070-SPECIFIEKE CODE: deze module bevat zelf geen enkele
 * GL-waarde, OGB-code of administratiecode — GL4350/OGB4319 hierboven zijn
 * uitsluitend de 070-MAPPINGGEGEVENS die als `PnLBronmappingRegel[]` worden
 * aangeleverd, niet iets dat in deze broncode staat.
 */

function isServicekostenEigenaarWerkelijkCategorie(waarde: string): waarde is ServicekostenEigenaarWerkelijkCategorie {
  return (SERVICEKOSTEN_EIGENAAR_WERKELIJK_CATEGORIEEN as readonly string[]).includes(waarde);
}

export interface ServicekostenEigenaarCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening
 * via de centrale resolver, naar de bestaande `ServicekostenEigenaarWerkelijkCategorie`.
 * `null` = NIET_GEMAPT. Faalt hard als de resolver voor deze GL een
 * `economischeModule` anders dan `SERVICEKOSTEN_EIGENAAR` teruggeeft (dus
 * ook bij `LEEGSTAND` — dit voorkomt structureel dat de Leegstand-calculator
 * per ongeluk reguliere servicekosten van de eigenaar als leegstand
 * behandelt, of andersom), of een categorie die geen bestaande
 * Servicekosten-Eigenaar-categorie is.
 */
export function resolveerServicekostenEigenaarCategorieViaCentraleMapping(
  invoer: ServicekostenEigenaarCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: ServicekostenEigenaarWerkelijkCategorie; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
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

  if (resultaat.economischeModule !== "SERVICEKOSTEN_EIGENAAR") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "SERVICEKOSTEN_EIGENAAR" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isServicekostenEigenaarWerkelijkCategorie(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Servicekosten-Eigenaar-categorie.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface ServicekostenEigenaarRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  complexnummer: string | null;
  saldo: Decimal;
}

export interface ServicekostenEigenaarWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface ServicekostenEigenaarWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkServicekostenEigenaarResultaat;
  /** (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet beschikbaar voor latere mappingcontrole/P&L-diagnostiek. */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN VOOR SERVICEKOSTEN-EIGENAAR-WERKELIJK: ruwe
 * boekingen (met GL) → centrale P&L-bronmappingresolver →
 * economischeModule=SERVICEKOSTEN_EIGENAAR + categorie → de pure
 * `berekenWerkelijkServicekostenEigenaar`. Geen legacy-classificatietabel,
 * geen terugvertaling.
 */
export function berekenWerkelijkServicekostenEigenaarViaCentraleMapping(
  invoer: ServicekostenEigenaarWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly ServicekostenEigenaarRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): ServicekostenEigenaarWerkelijkViaCentraleMappingResultaat {
  const { boekingen: geclassificeerd, nietGemapt } = classificeerElkeBoekingViaPnLMapping(invoer, boekingen, mappingregels, resolveerServicekostenEigenaarCategorieViaCentraleMapping);

  const werkelijkBoekingen: WerkelijkServicekostenEigenaarBoekingRegel[] = geclassificeerd.map(({ boeking, categorie }) => ({
    economischeCategorie: categorie,
    complexnummer: boeking.complexnummer,
    saldo: boeking.saldo,
  }));

  const werkelijk = berekenWerkelijkServicekostenEigenaar(werkelijkBoekingen);

  return { werkelijk, nietGemapt };
}
