import Decimal from "decimal.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel, type PnLEconomischeModule } from "./pnlBronmapping.js";
import { berekenPnLBoom, type PurePnLBronRegel, type PurePnLResultaat } from "./pnlEngine.js";
import { berekenWerkelijkHuurViaCentraleMapping } from "./begroting/huurCentraleMapping.js";
import { huurWerkelijkNaarPnLBovenEbitdaRegels } from "./begroting/huurWerkelijkPnLAdapter.js";
import { berekenWerkelijkBeheerViaCentraleMapping } from "./begroting/beheerCentraleMapping.js";
import { beheerWerkelijkNaarPnLBovenEbitdaRegels } from "./begroting/beheerWerkelijkPnLAdapter.js";
import { berekenWerkelijkManagementViaCentraleMapping } from "./begroting/managementCentraleMapping.js";
import { managementWerkelijkNaarPnLBovenEbitdaRegels } from "./begroting/managementWerkelijkPnLAdapter.js";
import { berekenWerkelijkOnderhoudViaCentraleMapping } from "./begroting/onderhoudCentraleMapping.js";
import { onderhoudWerkelijkNaarPnLBovenEbitdaRegels } from "./begroting/onderhoudWerkelijkPnLAdapter.js";
import { berekenWerkelijkServicekostenEigenaarViaCentraleMapping } from "./begroting/servicekostenEigenaarCentraleMapping.js";
import { servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels } from "./begroting/servicekostenEigenaarWerkelijkPnLAdapter.js";
import { berekenWerkelijkVerzekeringenViaCentraleMapping } from "./begroting/verzekeringCentraleMapping.js";
import { verzekeringWerkelijkNaarPnLBovenEbitdaRegels } from "./begroting/verzekeringWerkelijkPnLAdapter.js";
import { berekenWerkelijkGemeentelijkeLastenViaCentraleMapping } from "./begroting/gemeentelijkeLastenCentraleMapping.js";
import { gemeentelijkeLastenWerkelijkNaarPnLBovenEbitdaRegels } from "./begroting/gemeentelijkeLastenWerkelijkPnLAdapter.js";
import { berekenWerkelijkAlgemeneKostenViaCentraleMapping } from "./begroting/algemeneKostenCentraleMapping.js";
import { algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels } from "./begroting/algemeneKostenWerkelijkPnLAdapter.js";

/**
 * DELTA BUILD (2026-09-18) — "Pure P&L → Worker + Renderer": de dunne
 * orchestratielaag die de acht bestaande, ongewijzigde productieketens
 * (centrale mapping → Werkelijk-calculator → Werkelijk-P&L-adapter, voor
 * Huur/Beheer/Management/Onderhoud/Servicekosten Eigenaar/Verzekeringen/
 * Gemeentelijke Lasten/Algemene Kosten) verbindt met de bestaande Pure P&L
 * Engine (`pnlEngine.ts`'s `berekenPnLBoom`, commit d25783e). Dit bestand
 * bevat GEEN ENKELE financiële rekenregel — het routeert uitsluitend al
 * ingelezen, nog niet geclassificeerde boekingen naar de juiste, bestaande
 * calculator en verzamelt de acht bestaande adapters' uitkomsten.
 *
 * WAAROM EEN PARTITIONERINGSSTAP NODIG IS (nieuw risico van deze Delta
 * Build, niet eerder bewezen): elke `resolveerXCategorieViaCentraleMapping`
 * (bv. `resolveerBeheerCategorieViaCentraleMapping`) gooit een HARDE fout
 * zodra een boeking wordt aangeboden wiens grootboekrekening naar een
 * ANDER `economischeModule` resolveert dan die ene module zelf verwacht
 * ("configuratiefout, geen coercie toegepast" — zie elke
 * `xCentraleMapping.ts`). GAT-013's testharness omzeilde dit door de
 * boekingen VOORAF, PER MODULE, in aparte fixture-arrays te zetten; een
 * echte productie-bron levert daarentegen ALLE boekingen van een
 * administratie in één, ongesorteerde stroom aan. Deze orchestratielaag
 * lost dat op door ÉÉN keer, generiek, `resolveerPnLBronmapping` (de
 * bestaande, ongewijzigde, module-AGNOSTISCHE resolver uit
 * `pnlBronmapping.ts`) per unieke (GL, OGB)-combinatie aan te roepen om te
 * bepalen welk `economischeModule` een boeking toebehoort, en routeert
 * PAS DAARNA elke boeking naar de bijbehorende, bestaande module-specifieke
 * calculator — die daardoor nooit meer een boeking van een andere module
 * te zien krijgt en dus nooit de hierboven genoemde fout kan gooien.
 *
 * GEEN NIEUWE CLASSIFICATIE: de partitionering hergebruikt uitsluitend
 * `resolveerPnLBronmapping` (ongewijzigd) — er wordt geen nieuwe
 * economische betekenis toegekend, alleen bepaald welke REEDS BESTAANDE
 * calculator een boeking moet verwerken.
 *
 * BOEKINGEN BUITEN DE ACHT PRODUCTIEKETENS (bv. Rente/BTW/Waardering/
 * Administratiekosten-doorbelasting/Leegstand/Verkoop — economische
 * hoofddomeinen die WEL in `PNL_ECONOMISCHE_MODULES` bestaan maar waarvoor
 * nog geen productie-adapter is gebouwd, zie packages/reporting's
 * INVENTARISATIEGATE-rapport) EN boekingen die HELEMAAL NIET mappen
 * (NIET_GEMAPT) worden NOOIT stilzwijgend weggelaten en NOOIT zelf als een
 * fictieve boven/onder-EBITDA-P&L-regel geconstrueerd (dat zou gokken naar
 * boomPositie zijn, wat deze laag expliciet niet doet) — ze komen terecht
 * in `nietMeegenomen`, een diagnostisch veld NAAST de P&L-boom, zodat een
 * renderer altijd kan tonen dat en waarom het rapport (nog) niet volledig
 * is, zonder de Pure P&L Engine zelf een regel te laten verzinnen voor een
 * module die ze niet kent.
 *
 * `berekenPnLBoom` blijft de ENIGE plek die optelt/EBITDA berekent — deze
 * module roept hem exact één keer aan, met de samengevoegde regels van de
 * acht bestaande adapters, en wijzigt zijn uitkomst nooit.
 */

export interface PnLRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  /** `null` voor modules zonder complexdimensie (bv. Huur/Beheer/Management/Algemene Kosten) — nooit verzonnen. */
  complexnummer: string | null;
  saldo: Decimal;
}

export interface PnLPeriodeOrchestratieContext {
  bedrijfsnr: string;
  boekjaar: number;
  /** Het referentiepunt voor mappingresolutie (CLAUDE.md §6: periodekeuze altijd expliciet) — typisch de laatste periode van het gevraagde bereik. */
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/** Boekingen die niet in een van de acht productieketens terechtkwamen — `economischeModule: null` = NIET_GEMAPT (GL/OGB onbekend bij de centrale mapping), anders een WEL gemapt, maar (nog) niet aangesloten hoofddomein. */
export interface PnLNietMeegenomenGroep {
  economischeModule: PnLEconomischeModule | null;
  totaal: Decimal;
  aantalBoekingen: number;
}

export interface PnLPeriodeOrchestratieResultaat {
  resultaat: PurePnLResultaat;
  nietMeegenomen: readonly PnLNietMeegenomenGroep[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

interface ModuleBuckets {
  huur: PnLRuweBoekingRegel[];
  beheer: PnLRuweBoekingRegel[];
  management: PnLRuweBoekingRegel[];
  onderhoud: PnLRuweBoekingRegel[];
  servicekostenEigenaar: PnLRuweBoekingRegel[];
  verzekeringen: PnLRuweBoekingRegel[];
  gemeentelijkeLasten: PnLRuweBoekingRegel[];
  algemeneKosten: PnLRuweBoekingRegel[];
}

interface PartitieResultaat {
  buckets: ModuleBuckets;
  nietGemapt: PnLRuweBoekingRegel[];
  nietOndersteund: Map<PnLEconomischeModule, PnLRuweBoekingRegel[]>;
}

/** ÉÉN generieke resolutie per unieke (GL, OGB)-combinatie (efficiëntie, geen nieuwe classificatiebetekenis — zelfde patroon als `classificeerBoekingenViaPnLMapping`). */
function partitioneerPerModule(context: PnLPeriodeOrchestratieContext, boekingen: readonly PnLRuweBoekingRegel[], mappingregels: readonly PnLBronmappingRegel[]): PartitieResultaat {
  const resolutieCache = new Map<string, PnLEconomischeModule | null>();

  function resolveerModule(grootboekrekening: string, ogbKostensoort: string | null): PnLEconomischeModule | null {
    const sleutel = `${grootboekrekening}::${ogbKostensoort ?? ""}`;
    const cached = resolutieCache.get(sleutel);
    if (cached !== undefined) return cached;

    const resultaat = resolveerPnLBronmapping(
      { bedrijfsnr: context.bedrijfsnr, grootboekrekening, ogbKostensoort, boekjaar: context.boekjaar, boekperiode: context.boekperiode, opSysteemtijdstip: context.opSysteemtijdstip },
      mappingregels,
    );
    const module = resultaat.status === "NIET_GEMAPT" ? null : resultaat.economischeModule;
    resolutieCache.set(sleutel, module);
    return module;
  }

  const buckets: ModuleBuckets = { huur: [], beheer: [], management: [], onderhoud: [], servicekostenEigenaar: [], verzekeringen: [], gemeentelijkeLasten: [], algemeneKosten: [] };
  const nietGemapt: PnLRuweBoekingRegel[] = [];
  const nietOndersteund = new Map<PnLEconomischeModule, PnLRuweBoekingRegel[]>();

  for (const boeking of boekingen) {
    const module = resolveerModule(boeking.grootboekrekening, boeking.ogbKostensoort);
    if (module === null) {
      nietGemapt.push(boeking);
      continue;
    }
    switch (module) {
      case "HUUR":
        buckets.huur.push(boeking);
        break;
      case "BEHEER":
        buckets.beheer.push(boeking);
        break;
      case "MANAGEMENT":
        buckets.management.push(boeking);
        break;
      case "ONDERHOUD":
        buckets.onderhoud.push(boeking);
        break;
      case "SERVICEKOSTEN_EIGENAAR":
        buckets.servicekostenEigenaar.push(boeking);
        break;
      case "VERZEKERINGEN":
        buckets.verzekeringen.push(boeking);
        break;
      case "GEMEENTELIJKE_LASTEN":
        buckets.gemeentelijkeLasten.push(boeking);
        break;
      case "ALGEMENE_KOSTEN":
        buckets.algemeneKosten.push(boeking);
        break;
      default: {
        const groep = nietOndersteund.get(module) ?? [];
        groep.push(boeking);
        nietOndersteund.set(module, groep);
      }
    }
  }

  return { buckets, nietGemapt, nietOndersteund };
}

function naarBasisRegel(b: PnLRuweBoekingRegel) {
  return { grootboekrekening: b.grootboekrekening, ogbKostensoort: b.ogbKostensoort, ogbKostensoortOmschrijving: b.ogbKostensoortOmschrijving, saldo: b.saldo };
}

function naarRegelMetComplex(b: PnLRuweBoekingRegel) {
  return { ...naarBasisRegel(b), complexnummer: b.complexnummer };
}

/**
 * DE PRODUCTIEKETEN: ruwe, nog niet geclassificeerde boekingen (van een
 * administratie, voor één periodebereik) → partitionering per
 * economischeModule → de acht bestaande, ongewijzigde
 * `berekenXWerkelijkViaCentraleMapping`-calculators → de acht bestaande,
 * ongewijzigde `xWerkelijkNaarPnLBovenEbitdaRegels`-adapters →
 * `berekenPnLBoom`. `brondekkingBevestigd: true` voor elke adapter, omdat
 * deze functie per constructie ALLE aangeleverde boekingen van de
 * administratie/periode verwerkt (geen partiële/voorgefilterde
 * deelverzameling) — exact dezelfde aanname als GAT-013's bewezen harness.
 */
export function berekenPnLPeriode(context: PnLPeriodeOrchestratieContext, boekingen: readonly PnLRuweBoekingRegel[], mappingregels: readonly PnLBronmappingRegel[]): PnLPeriodeOrchestratieResultaat {
  const { buckets, nietGemapt, nietOndersteund } = partitioneerPerModule(context, boekingen, mappingregels);
  const invoer = { bedrijfsnr: context.bedrijfsnr, boekjaar: context.boekjaar, boekperiode: context.boekperiode, opSysteemtijdstip: context.opSysteemtijdstip };

  const huur = berekenWerkelijkHuurViaCentraleMapping(invoer, buckets.huur.map(naarBasisRegel), mappingregels);
  const beheer = berekenWerkelijkBeheerViaCentraleMapping(invoer, buckets.beheer.map(naarBasisRegel), mappingregels);
  const management = berekenWerkelijkManagementViaCentraleMapping(invoer, buckets.management.map(naarBasisRegel), mappingregels);
  const onderhoud = berekenWerkelijkOnderhoudViaCentraleMapping(invoer, buckets.onderhoud.map(naarRegelMetComplex), mappingregels);
  const ske = berekenWerkelijkServicekostenEigenaarViaCentraleMapping(invoer, buckets.servicekostenEigenaar.map(naarRegelMetComplex), mappingregels);
  const verzekering = berekenWerkelijkVerzekeringenViaCentraleMapping(invoer, buckets.verzekeringen.map(naarRegelMetComplex), mappingregels);
  const gemLasten = berekenWerkelijkGemeentelijkeLastenViaCentraleMapping(invoer, buckets.gemeentelijkeLasten.map(naarRegelMetComplex), mappingregels);
  const algemeneKosten = berekenWerkelijkAlgemeneKostenViaCentraleMapping(invoer, buckets.algemeneKosten.map(naarBasisRegel), mappingregels);

  const regels: PurePnLBronRegel[] = [
    ...huurWerkelijkNaarPnLBovenEbitdaRegels(huur.werkelijk, true),
    ...beheerWerkelijkNaarPnLBovenEbitdaRegels(beheer.werkelijk, true),
    ...managementWerkelijkNaarPnLBovenEbitdaRegels(management.werkelijk, true),
    ...onderhoudWerkelijkNaarPnLBovenEbitdaRegels(onderhoud.werkelijk, true),
    ...servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels(ske.werkelijk, true),
    ...verzekeringWerkelijkNaarPnLBovenEbitdaRegels(verzekering.werkelijk, true),
    ...gemeentelijkeLastenWerkelijkNaarPnLBovenEbitdaRegels(gemLasten.werkelijk, true),
    ...algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(algemeneKosten.werkelijk, true),
  ];

  const resultaat = berekenPnLBoom("WERKELIJK", regels);

  const nietMeegenomen: PnLNietMeegenomenGroep[] = [];
  if (nietGemapt.length > 0) {
    nietMeegenomen.push({ economischeModule: null, totaal: som(nietGemapt.map((b) => b.saldo)), aantalBoekingen: nietGemapt.length });
  }
  for (const [economischeModule, groep] of nietOndersteund) {
    nietMeegenomen.push({ economischeModule, totaal: som(groep.map((b) => b.saldo)), aantalBoekingen: groep.length });
  }

  return { resultaat, nietMeegenomen };
}
