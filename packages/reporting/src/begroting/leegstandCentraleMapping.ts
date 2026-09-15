import type Decimal from "decimal.js";
import {
  LEEGSTAND_CATEGORIEEN,
  berekenWerkelijkLeegstand,
  type BgLeegstandCategorie,
  type LeegstandClassificatieRegel,
  type WerkelijkLeegstandBoekingRegel,
  type WerkelijkLeegstandResultaat,
} from "./begroteLeegstand.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { classificeerBoekingenViaPnLMapping } from "../pnlBronmappingClassificatie.js";

/**
 * FASE M5 (2026-09-15) — Leegstand (OB-031) als eerste échte, volledig
 * gewirede migratie op de centrale P&L-bronmappingresolver
 * (`resolveerPnLBronmapping`, commit 5ece248), direct volgens het M3b-patroon
 * (Rente, commit ee6e340): resolver-adapter + productieklare orchestratie in
 * hetzelfde bestand, in één keer — geen aparte "compatibiliteitsbewijs"-fase
 * meer nodig, dat patroon is inmiddels bewezen.
 *
 * VOORAF ONDERZOCHTE, BELANGRIJKE BEVINDING (gericht op uitsluitend de
 * Leegstand-bestanden, geen brede repo-analyse): de bestaande Leegstand-
 * Werkelijk-classificatie (`berekenWerkelijkLeegstand` + `LeegstandClassificatieRegel`,
 * `begroteLeegstand.ts`) is — EXACT als Rente vóór M3 — VOLLEDIG OGB-only.
 * `WerkelijkLeegstandBoekingRegel` draagt GEEN grootboekrekening-veld. GL
 * (bewezen: 4350 voor 070) diende tot nu toe uitsluitend als bronselectie/
 * gate bij het ophalen van boekingen, nooit als onderdeel van de
 * classificatie zelf. Er is GEEN fallback-mechanisme: een `ogbKostensoort:
 * null` of een onbekende OGB-code resulteert ALTIJD in "niet geclassificeerd"
 * (WAARSCHUWING, `nietGeclassificeerdTotaal`/`-AantalBoekingen`), ongeacht
 * welke GL erbij hoort — er bestond ook GEEN productiepad dat
 * `berekenWerkelijkLeegstand` ooit met echte boekingen aanriep (geen
 * Worker-commando, geen `@bvc/begroting-data`-orchestratie), exact dezelfde
 * bevinding als M3b voor Rente.
 *
 * ONTWERPKEUZE OM 100% GEDRAGSPARITEIT TE GARANDEREN (zelfde afweging als
 * Rente/M3): de centrale mapping voor Leegstand wordt UITSLUITEND opgebouwd
 * met GL+OGB-SPECIFIEKE rijen — BEWUST GEEN `(GL, null)` GL-default-rij. Een
 * GL-default zou een onbekende/ontbrekende OGB-code op een bekende
 * Leegstand-GL plotseling een categorie geven in plaats van "niet
 * geclassificeerd" — een ECHTE gedragswijziging. Het toevoegen van een
 * GL-default voor Leegstand is een aparte, latere businessbeslissing, geen
 * impliciet gevolg van deze migratie.
 *
 * BEWEZEN BRONMAPPING: UITSLUITEND 070/GL4350/OGB4319 → SERVICEKOSTEN_LEEGSTAND
 * (`leegstandClassificatie.test.ts`/`begroteLeegstand.test.ts`'s bronproef,
 * 6 boekingen, complex 003, totaal €1.354,10). Er is GEEN bewezen bronmapping
 * voor NUTS_LEEGSTAND of OVERIGE_LEEGSTANDSKOSTEN voor 070 — de overige rijen
 * in `leegstandClassificatie.test.ts` (bv. 070/4998, 019/4700) zijn generieke
 * testfixtures, GEEN bewezen bronproef. Er wordt daarom BEWUST GEEN fictieve
 * 070-mapping voor Nuts/Overige aangemaakt — die categorieën blijven
 * functioneel bestaan (in `LEEGSTAND_CATEGORIEEN`, in elke `perCategorie`-
 * uitkomst) zonder automatische 070-bronmapping. Dat is correct gedrag, geen
 * ontbrekende functionaliteit.
 *
 * SERVICEKOSTEN EIGENAAR IS GEEN LEEGSTANDSCATEGORIE (zie OB-031/moduledoc
 * `begroteLeegstand.ts` "BUITEN SCOPE"): deze migratie voegt geen nieuwe
 * categorie toe en herclassificeert niets — uitsluitend de bestaande drie
 * `LEEGSTAND_CATEGORIEEN` blijven bestaan.
 *
 * GEEN WIJZIGING AAN DE BESTAANDE CALCULATORS: `berekenWerkelijkLeegstand` en
 * `berekenEstimatedLeegstand` blijven volledig ongewijzigd — deze module
 * levert uitsluitend een vertaling (centrale resolver →
 * `LeegstandClassificatieRegel[]`, exact de vorm die `berekenWerkelijkLeegstand`
 * al als parameter accepteert) en, daarna, de daadwerkelijke productieketen
 * (ruwe boeking met GL → resolver → categorie → ongewijzigde calculator).
 *
 * GEEN GL-AFLEIDING UIT OGB/VRIJE TEKST, GEEN UNIT-PARSING: `grootboekrekening`
 * komt uitsluitend rechtstreeks van de aanroeper — deze module leest, raadt
 * of parseert nooit een GL, unit, of categorie uit een omschrijving.
 *
 * GEEN TWEEDE LEEGSTAND-MAPPINGTABEL: persistence loopt uitsluitend via de
 * bestaande, generieke M4/M4b-repository (`@bvc/begroting-data`'s
 * `pnlBronmappingRepository.ts`) — deze module kent geen eigen opslag, geen
 * eigen SQL. De bestaande `leegstandClassificatie.ts`-tabel (OGB-only,
 * administratie-breed) blijft ongewijzigd bestaan als regressiereferentie,
 * wordt hier niet verwijderd of gemuteerd.
 *
 * ÉÉN BOEKJAAR/PERIODE-CONTEXT PER AANROEP (CLAUDE.md §6, zelfde patroon als
 * M3b): alle boekingen in één aanroep worden geclassificeerd tegen HETZELFDE
 * `(boekjaar, boekperiode, opSysteemtijdstip)`-referentiepunt.
 */

function isBgLeegstandCategorie(waarde: string): waarde is BgLeegstandCategorie {
  return (LEEGSTAND_CATEGORIEEN as readonly string[]).includes(waarde);
}

export interface LeegstandCentraleMappingInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

/**
 * Resolveert één OGB-kostensoort (of `null`) binnen één grootboekrekening
 * via de centrale resolver, naar de bestaande `BgLeegstandCategorie`. `null`
 * = NIET_GEMAPT (nooit geraden). Faalt hard als de resolver voor deze GL een
 * `economischeModule` anders dan `LEEGSTAND` teruggeeft, of een categorie
 * die geen bestaande `BgLeegstandCategorie` is.
 */
export function resolveerLeegstandCategorieViaCentraleMapping(
  invoer: LeegstandCentraleMappingInvoer,
  ogbKostensoort: string | null,
  mappingregels: readonly PnLBronmappingRegel[],
): { categorie: BgLeegstandCategorie; specificiteit: "GL_OGB" | "GL_DEFAULT" } | null {
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

  if (resultaat.economischeModule !== "LEEGSTAND") {
    throw new Error(
      `Interne fout: grootboekrekening ${invoer.grootboekrekening} (bedrijfsnr ${invoer.bedrijfsnr}) resolveert via de centrale mapping naar economischeModule "${resultaat.economischeModule}", niet "LEEGSTAND" — configuratiefout, geen coercie toegepast.`,
    );
  }
  if (!isBgLeegstandCategorie(resultaat.economischeCategorie)) {
    throw new Error(
      `Interne fout: de centrale mapping voor grootboekrekening ${invoer.grootboekrekening}/OGB ${ogbKostensoort ?? "(geen)"} resolveert naar economischeCategorie "${resultaat.economischeCategorie}", geen bestaande Leegstand-categorie.`,
    );
  }

  return { categorie: resultaat.economischeCategorie, specificiteit: resultaat.specificiteit };
}

export interface LeegstandCentraleMappingResultaat {
  classificatie: readonly LeegstandClassificatieRegel[];
  /** OGB-kostensoorten waarvoor de centrale mapping GEEN uitkomst opleverde — expliciet zichtbaar, nooit stil genegeerd. */
  nietGemapt: readonly string[];
}

/**
 * Bouwt, voor een gegeven lijst reeds-bekende (OGB-kostensoort +
 * omschrijving)-paren, de equivalente `LeegstandClassificatieRegel[]` op via
 * de centrale resolver — exact de vorm die `berekenWerkelijkLeegstand`
 * vandaag als `classificatie`-parameter ontvangt.
 */
export function bouwLeegstandClassificatieViaCentraleMapping(
  invoer: LeegstandCentraleMappingInvoer,
  ogbKostensoorten: readonly { ogbKostensoort: string; ogbKostensoortOmschrijving: string }[],
  mappingregels: readonly PnLBronmappingRegel[],
): LeegstandCentraleMappingResultaat {
  const classificatie: LeegstandClassificatieRegel[] = [];
  const nietGemapt: string[] = [];

  for (const { ogbKostensoort, ogbKostensoortOmschrijving } of ogbKostensoorten) {
    const resultaat = resolveerLeegstandCategorieViaCentraleMapping(invoer, ogbKostensoort, mappingregels);
    if (resultaat === null) {
      nietGemapt.push(ogbKostensoort);
      continue;
    }
    classificatie.push({ ogbKostensoort, ogbKostensoortOmschrijving, categorie: resultaat.categorie });
  }

  return { classificatie, nietGemapt };
}

/** Eén reeds-geselecteerde, RUWE boeking (bronformaat, vóór classificatie) — `grootboekrekening` komt rechtstreeks uit de bron, nooit afgeleid. */
export interface LeegstandRuweBoekingRegel {
  grootboekrekening: string;
  ogbKostensoort: string | null;
  /** `null` als er geen OGB-kostensoort is (dan is dit veld sowieso betekenisloos) — bij een gevulde OGB komt dit rechtstreeks van de bron, nooit verzonnen. */
  ogbKostensoortOmschrijving: string | null;
  complexnummer: string | null;
  saldo: Decimal;
}

export interface LeegstandWerkelijkViaCentraleMappingInvoer {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  opSysteemtijdstip: Date;
}

export interface LeegstandWerkelijkViaCentraleMappingResultaat {
  werkelijk: WerkelijkLeegstandResultaat;
  /**
   * (GL, OGB)-combinaties waarvoor de centrale mapping GEEN uitkomst
   * opleverde — expliciet beschikbaar voor latere mappingcontrole/
   * P&L-diagnostiek. Deze boekingen zitten ALTIJD OOK al in
   * `werkelijk.nietGeclassificeerdTotaal`/`-AantalBoekingen`
   * (`berekenWerkelijkLeegstand`'s eigen, ongewijzigde "onbekende code"-
   * afhandeling vangt ze af omdat hun OGB-code bewust ontbreekt in de
   * afgeleide classificatie) — dit veld dupliceert dus geen telling, het
   * maakt uitsluitend zichtbaar WELKE (GL, OGB)-combinaties de oorzaak waren.
   */
  nietGemapt: readonly { grootboekrekening: string; ogbKostensoort: string | null }[];
}

/**
 * DE CANONIEKE PRODUCTIEKETEN VOOR LEEGSTAND-WERKELIJK: ruwe boekingen (met
 * GL) → centrale P&L-bronmappingresolver → economischeModule=LEEGSTAND +
 * categorie → de bestaande, ONGEWIJZIGDE `berekenWerkelijkLeegstand`. Elke
 * toekomstige echte aanroeper (een Worker-commando, een
 * `@bvc/begroting-data`-orchestratie) hoort dit — en NOOIT de oude
 * classificatietabel rechtstreeks — aan te roepen voor Leegstand-Werkelijk.
 *
 * FASE M6-CONSOLIDATIE: de "ruwe boekingen → unieke (GL, OGB)-combinaties →
 * resolver → NIET_GEMAPT verzamelen"-stap zelf is verplaatst naar de
 * generieke `classificeerBoekingenViaPnLMapping` (`pnlBronmappingClassificatie.ts`)
 * — Rente (M3b) bevatte exact dezelfde boilerplate. Deze functie blijft zelf
 * verantwoordelijk voor het LEEGSTAND-eigen deel: de vertaling naar
 * `LeegstandClassificatieRegel[]`, het ongewijzigd doorgeven van
 * `complexnummer` (bronfeit, geen classificatiedimensie) en de aanroep van
 * de ongewijzigde `berekenWerkelijkLeegstand`.
 */
export function berekenWerkelijkLeegstandViaCentraleMapping(
  invoer: LeegstandWerkelijkViaCentraleMappingInvoer,
  boekingen: readonly LeegstandRuweBoekingRegel[],
  mappingregels: readonly PnLBronmappingRegel[],
): LeegstandWerkelijkViaCentraleMappingResultaat {
  const { perOgb, nietGemapt } = classificeerBoekingenViaPnLMapping(invoer, boekingen, mappingregels, resolveerLeegstandCategorieViaCentraleMapping);

  // Uitsluitend succesvol geresolvede OGB-codes krijgen een classificatie-entry — een niet-geresolvde
  // (GL, OGB)-combinatie komt hier bewust NIET in voor, waardoor de ONGEWIJZIGDE `berekenWerkelijkLeegstand`
  // die boeking via haar eigen, bestaande "onbekende code"-pad automatisch als niet-geclassificeerd afvangt.
  const classificatie: LeegstandClassificatieRegel[] = Array.from(perOgb.entries()).map(([ogbKostensoort, info]) => ({
    ogbKostensoort,
    ogbKostensoortOmschrijving: info.ogbKostensoortOmschrijving,
    categorie: info.categorie,
  }));

  const werkelijkBoekingen: WerkelijkLeegstandBoekingRegel[] = boekingen.map((b) => ({ ogbKostensoort: b.ogbKostensoort, complexnummer: b.complexnummer, saldo: b.saldo }));

  const werkelijk = berekenWerkelijkLeegstand(werkelijkBoekingen, classificatie);

  return { werkelijk, nietGemapt };
}
