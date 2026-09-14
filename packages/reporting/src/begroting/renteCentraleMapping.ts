import type Decimal from "decimal.js";
import { RENTE_CATEGORIEEN, berekenWerkelijkRente, type BgRenteCategorie, type RenteClassificatieRegel, type WerkelijkRenteBoekingRegel, type WerkelijkRenteResultaat } from "./begroteRente.js";
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

// ── FASE M3b — daadwerkelijke wiring (2026-09-14) ──────────────────────────

/**
 * M3b-BEVINDING (vóór wijziging onderzocht, zie rapportage): er bestond GEEN
 * enkel productiepad dat `berekenWerkelijkRente` ooit met echte boekingen
 * aanriep — geen Worker-commando, geen `@bvc/begroting-data`-orchestratie.
 * `berekenWerkelijkRente`/`RenteClassificatieRegel` waren uitsluitend vanuit
 * tests bereikbaar. Er was dus NIETS "te herwiren" — M3b creëert hiermee het
 * EERSTE echte oproeppad, en dat pad gebruikt vanaf het begin uitsluitend de
 * centrale resolver, nooit de oude classificatietabel rechtstreeks.
 *
 * WAAROM `WerkelijkRenteBoekingRegel` ZELF NIET IS UITGEBREID MET EEN
 * GROOTBOEKREKENING-VELD (zie M3b-opdracht §8): de calculator mag zelf geen
 * GL/OGB-classificatie uitvoeren — GL is dus ALLEEN nodig tijdens classificatie,
 * vóórdat een boeking een `WerkelijkRenteBoekingRegel` wordt. `RenteRuweBoekingRegel`
 * (hieronder) is daarom een NIEUW, apart, RIJKER brontype dat uitsluitend in
 * déze orchestratielaag leeft — GL wordt hier verbruikt (bepaalt, samen met
 * OGB, de categorie), en verdwijnt daarna: de calculator ontvangt nog steeds
 * exact het bestaande `{ ogbKostensoort, saldo }`. Dit is de kleinste
 * architecturaal correcte wijziging: `begroteRente.ts` (de pure calculator)
 * blijft LETTERLIJK ongewijzigd, elke bestaande caller/test van
 * `berekenWerkelijkRente` blijft ongeraakt, en het patroon
 * (rijk bronformaat → resolver → afgeleide `RenteClassificatieRegel[]` →
 * ongewijzigde calculator) is 1-op-1 herbruikbaar voor elke volgende module
 * (Leegstand, Geplande Verkoop, en de nog te bouwen Werkelijk-koppelingen).
 *
 * GEEN GL-AFLEIDING UIT OGB/VRIJE TEKST: `grootboekrekening` komt hier
 * uitsluitend rechtstreeks van de aanroeper (in productie: van de bronregel
 * zelf) — deze functie leest, raadt of parseert nooit een GL.
 *
 * ÉÉN BOEKJAAR/PERIODE-CONTEXT PER AANROEP (CLAUDE.md §6: periodekeuze is
 * altijd expliciet): alle boekingen in één aanroep worden geclassificeerd
 * tegen HETZELFDE `(boekjaar, boekperiode, opSysteemtijdstip)`-referentiepunt
 * — geen impliciete per-boeking-periode-resolutie. Een batch die meerdere
 * boekjaren/periodes bestrijkt met een tussentijdse mappingwijziging vereist
 * dus voorlopig aparte aanroepen per periode-context; dat is een bewuste,
 * eenvoudige eerste stap, geen aanname over hoe dat later gebruikt wordt.
 */

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface RenteRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is (dan is dit veld sowieso betekenisloos) — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  saldo: Decimal;
}

export interface RenteWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface RenteWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkRenteResultaat;
  /**
   * (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst
   * opleverde — expliciet beschikbaar voor latere mappingcontrole/
   * P&L-diagnostiek. Deze boekingen zitten ALTIJD OOK al in
   * `werkelijk.nietGeclassificeerdTotaal`/`-AantalBoekingen`
   * (`berekenWerkelijkRente`'s eigen, ongewijzigde "onbekende code"-afhandeling
   * vangt ze af omdat hun OGB-code bewust ontbreekt in de afgeleide
   * classificatie) — dit veld dupliceert dus geen telling, het maakt uitsluitend
   * zichtbaar WELKE (GL, OGB)-combinaties de oorzaak waren.
   */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN (vanaf M3b): ruwe boekingen (met GL) →
 * centrale P&L-bronmappingresolver → economischeModule=RENTE + categorie →
 * de bestaande, ONGEWIJZIGDE `berekenWerkelijkRente`. Elke toekomstige echte
 * aanroeper (een Worker-commando, een `@bvc/begroting-data`-orchestratie)
 * hoort dit — en NOOIT de oude classificatietabel rechtstreeks — aan te
 * roepen voor Rente-Werkelijk.
 *
 * Classificeert elke UNIEKE `(grootboekrekening, ogbKostensoort)`-combinatie
 * in de batch precies één keer (efficiënt, en voorkomt dat dezelfde
 * combinatie tegenstrijdig herbeoordeeld zou kunnen worden binnen één
 * aanroep). Een combinatie met `ogbKostensoort: null` wordt NOOIT aan de
 * resolver aangeboden — Rente heeft bewust geen GL-default (zie moduledoc),
 * dus dit is per definitie NIET_GEMAPT, zonder dat de resolver ervoor hoeft
 * te draaien.
 */
export function berekenWerkelijkRenteViaCentraleMapping(
  invoer: RenteWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly RenteRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): RenteWerkelijkViaCentraleMappingResultaat {
  const uniekeCombinaties = new Map<string, RenteRuweBoekingRegel>();
  for (const b of boekingen) {
    uniekeCombinaties.set(`${b.grootboekrekening}::${b.ogbKostensoort ?? ""}`, b);
  }

  const nietGemapt: { grootboekrekening: string; ogbKostensoort: string | null }[] = [];
  const geresolvdeInfoPerOgb = new Map<string, { categorie: BgRenteCategorie; ogbKostensoortOmschrijving: string }>();

  for (const combinatie of uniekeCombinaties.values()) {
    if (combinatie.ogbKostensoort === null) {
      nietGemapt.push({ grootboekrekening: combinatie.grootboekrekening, ogbKostensoort: null });
      continue;
    }
    const resultaat = resolveerRenteCategorieViaCentraleMapping(
      { bedrijfsnr: invoer.bedrijfsnr, grootboekrekening: combinatie.grootboekrekening, boekjaar: invoer.boekjaar, boekperiode: invoer.boekperiode, opSysteemtijdstip: invoer.opSysteemtijdstip },
      combinatie.ogbKostensoort,
      mappingregels,
    );
    if (resultaat === null) {
      nietGemapt.push({ grootboekrekening: combinatie.grootboekrekening, ogbKostensoort: combinatie.ogbKostensoort });
      continue;
    }
    geresolvdeInfoPerOgb.set(combinatie.ogbKostensoort, { categorie: resultaat.categorie, ogbKostensoortOmschrijving: combinatie.ogbKostensoortOmschrijving ?? combinatie.ogbKostensoort });
  }

  // Uitsluitend succesvol geresolvede OGB-codes krijgen een classificatie-entry — een niet-geresolvde
  // (GL, OGB)-combinatie komt hier bewust NIET in voor, waardoor de ONGEWIJZIGDE `berekenWerkelijkRente`
  // die boeking via haar eigen, bestaande "onbekende code"-pad automatisch als niet-geclassificeerd afvangt.
  const classificatie: RenteClassificatieRegel[] = Array.from(geresolvdeInfoPerOgb.entries()).map(([ogbKostensoort, info]) => ({
    ogbKostensoort,
    ogbKostensoortOmschrijving: info.ogbKostensoortOmschrijving,
    categorie: info.categorie,
  }));

  const werkelijkBoekingen: WerkelijkRenteBoekingRegel[] = boekingen.map((b) => ({ ogbKostensoort: b.ogbKostensoort, saldo: b.saldo }));

  const werkelijk = berekenWerkelijkRente(werkelijkBoekingen, classificatie);

  return { werkelijk, nietGemapt };
}
