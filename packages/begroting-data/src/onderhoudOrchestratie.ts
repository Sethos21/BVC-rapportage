import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import {
  berekenResterendeVerwachtingCorrectiefDagelijksOnderhoud,
  berekenResterendeVerwachtingGeplandOnderhoud,
  type BgCorrectiefDagelijksControleItem,
  type BgCorrectiefDagelijksEstimatedControleItem,
  type BgCorrectiefDagelijksEstimatedOnlyRegelInvoer,
  type BgCorrectiefDagelijksEstimatedOnlyRegelUitkomst,
  type BgCorrectiefDagelijksRegelUitkomst,
  type BgCorrectiefDagelijksResterendeVerwachtingInvoer,
  type BgCorrectiefDagelijksResterendeVerwachtingUitkomst,
  type BgGeplandOnderhoudActiviteitUitkomst,
  type BgGeplandOnderhoudControleItem,
  type BgGeplandOnderhoudEstimatedControleItem,
  type BgGeplandOnderhoudEstimatedOnlyActiviteitInvoer,
  type BgGeplandOnderhoudEstimatedOnlyActiviteitUitkomst,
  type BgGeplandOnderhoudResterendeVerwachtingInvoer,
  type BgGeplandOnderhoudResterendeVerwachtingUitkomst,
  type BgOnderhoudKwartaal,
  type WerkelijkOnderhoudCategorieResultaat,
  type WerkelijkOnderhoudResultaat,
} from "@bvc/reporting";
import { leesBegrotingsversie, type Begrotingsversie } from "./begrotingsversies.js";
import { leesCorrectiefDagelijksOnderhoudBeoordeeld } from "./correctiefDagelijksOnderhoudBeoordeeld.js";
import {
  leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels,
  leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen,
  type CorrectiefDagelijksOnderhoudEstimatedOnlyRegel,
  type CorrectiefDagelijksOnderhoudEstimatedVerwachting,
} from "./correctiefDagelijksOnderhoudEstimated.js";
import { leesCorrectiefDagelijksOnderhoudRegels } from "./correctiefDagelijksOnderhoudRegels.js";
import { leesFrozenCorrectiefDagelijksOnderhoudResultaat } from "./frozenCorrectiefDagelijksOnderhoudResultaat.js";
import { leesFrozenGeplandOnderhoudResultaat } from "./frozenGeplandOnderhoudResultaat.js";
import {
  leesGeplandOnderhoudEstimatedOnlyActiviteiten,
  leesGeplandOnderhoudEstimatedVerwachtingen,
  type GeplandOnderhoudEstimatedOnlyActiviteit,
  type GeplandOnderhoudEstimatedVerwachting,
} from "./geplandOnderhoudEstimated.js";
import { leesGeplandOnderhoudActiviteiten } from "./geplandOnderhoudActiviteiten.js";
import { leesGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";
import {
  berekenCorrectiefDagelijksUitInvoer,
  berekenGeplandOnderhoudUitInvoer,
  type HerberekendCorrectiefDagelijksResultaat,
  type HerberekendGeplandOnderhoudResultaat,
} from "./herberekenen.js";

/**
 * DELTA BUILD 3 (2026-09-24): Onderhoud-brede orchestratie — brengt de reeds
 * bewezen Begroting-, Werkelijk- en Estimated-bouwstenen samen tot één
 * afgeleid domeinresultaat. DUNNE laag: rekent zelf GEEN financiële
 * businessregels uit — uitsluitend combineren, koppelen en optellen van
 * reeds door de bestaande calculators geleverde totalen.
 *
 * VASTGESTELD CONTRACT (business-/architectuurbesluit na Gate 9):
 * - Werkelijk Onderhoud is uitsluitend op Onderhoud-TOTAALniveau financieel
 *   verantwoord (bron classificeert naar Gebouwen/Terrein/Installaties, NIET
 *   naar Gepland/Correctief). Hier exact ÉÉNMAAL meegenomen (`moduleTotaal`).
 *   Er bestaat bewust GEEN `werkelijkGepland`/`werkelijkCorrectief` en dus
 *   ook geen "Estimated Gepland"/"Estimated Correctief"-totaal.
 * - `estimatedOnderhoudTotaal = werkelijkOnderhoudTotaal + resterendeVerwachtingGepland
 *   + resterendeVerwachtingCorrectiefDagelijks` — Begroting wordt NOOIT bij
 *   Estimated opgeteld.
 * - `nietGeclassificeerdTotaal` staat, per het bestaande Werkelijk-contract
 *   (`werkelijkOnderhoud.ts`: `moduleTotaal` = som van de DRIE geclassificeerde
 *   categorieën, "GEEN vierde boekingscategorie"), buiten `moduleTotaal`. Het
 *   wordt hier ongewijzigd als informatie doorgegeven en NOOIT stilzwijgend
 *   bij Estimated opgeteld.
 *
 * IDENTITEIT: Begroting ↔ Estimated wordt UITSLUITEND gekoppeld via de stabiele
 * persistentie-ID (`activiteit_id` / `regel_id`), via een expliciete
 * ID-map — nooit via arraypositie, sortering, omschrijving, bedrag, complex,
 * grootboek, OGB of leverancier. De positionele `activiteitIndex`/`regelIndex`
 * van de pure Delta-2-calculators bestaat uitsluitend binnen één aanroep en
 * wordt direct daarna via een parallelle ID-array terugvertaald.
 * Een Estimated-verwachting zonder bijbehorende Begroting-activiteit/-regel
 * (orphan — door de FK normaal onmogelijk) faalt hard; nooit stil gedropt,
 * nooit aan een "meest waarschijnlijke" rij gekoppeld.
 *
 * LIFECYCLE: `leesOnderhoudTotaalResultaat` volgt het bestaande patroon —
 * CONCEPT: Begroting wordt uit de concept-input herberekend; VASTGESTELD:
 * de bevroren Begroting-output wordt gelezen (immutable). Estimated wordt
 * altijd ACTUEEL uit de eigen, nooit-bevroren tabellen gelezen. Deze module
 * schrijft NOOIT iets (geen frozen Estimated, geen terugschrijven).
 *
 * BEWUST GEEN percentageverschil (geen bestaand generiek patroon), GEEN
 * presentatie-/viewmodel-velden, GEEN persistentie van het samengestelde
 * resultaat (afgeleid).
 */

export interface OnderhoudGeplandActiviteitCombinatie {
  activiteitId: number;
  begroting: BgGeplandOnderhoudActiviteitUitkomst;
  /** `null` = voor deze activiteit is (nog) geen resterende verwachting vastgelegd — geen koppeling verzonnen. */
  resterendeVerwachting: BgGeplandOnderhoudResterendeVerwachtingUitkomst | null;
}

export interface OnderhoudGeplandResultaat {
  begrotingReviewStatus: HerberekendGeplandOnderhoudResultaat["reviewStatus"];
  activiteiten: readonly OnderhoudGeplandActiviteitCombinatie[];
  estimatedOnlyActiviteiten: readonly BgGeplandOnderhoudEstimatedOnlyActiviteitUitkomst[];
  begrotingTotaal: Decimal;
  resterendeVerwachtingTotaal: Decimal;
  begrotingControleVereist: readonly BgGeplandOnderhoudControleItem[];
  estimatedControleVereist: readonly BgGeplandOnderhoudEstimatedControleItem[];
}

export interface OnderhoudCorrectiefDagelijksRegelCombinatie {
  regelId: number;
  begroting: BgCorrectiefDagelijksRegelUitkomst;
  /** `null` = voor deze regel is (nog) geen resterende verwachting vastgelegd — geen koppeling verzonnen. */
  resterendeVerwachting: BgCorrectiefDagelijksResterendeVerwachtingUitkomst | null;
}

export interface OnderhoudCorrectiefDagelijksResultaat {
  begrotingReviewStatus: HerberekendCorrectiefDagelijksResultaat["reviewStatus"];
  regels: readonly OnderhoudCorrectiefDagelijksRegelCombinatie[];
  estimatedOnlyRegels: readonly BgCorrectiefDagelijksEstimatedOnlyRegelUitkomst[];
  begrotingTotaal: Decimal;
  resterendeVerwachtingTotaal: Decimal;
  begrotingControleVereist: readonly BgCorrectiefDagelijksControleItem[];
  estimatedControleVereist: readonly BgCorrectiefDagelijksEstimatedControleItem[];
}

/** Werkelijk Onderhoud — uitsluitend op Onderhoud-totaalniveau verantwoord; categorieën zijn de boekhoudkundige dimensie (Gebouwen/Terrein/Installaties), nooit vertaald naar Gepland/Correctief. */
export interface OnderhoudWerkelijkTotaal {
  niveau: "ONDERHOUD_TOTAAL";
  /** Bestaand `WerkelijkOnderhoudResultaat.moduleTotaal`, exact éénmaal gebruikt. */
  totaalTotAfgeslotenPeriode: Decimal;
  /** Ongewijzigd doorgegeven uit het bestaande Werkelijk-resultaat. */
  perCategorie: readonly WerkelijkOnderhoudCategorieResultaat[];
  /** Buiten `totaalTotAfgeslotenPeriode` (bestaand Werkelijk-contract) — informatie, nooit bij Estimated opgeteld. */
  nietGeclassificeerdTotaal: Decimal;
  nietGeclassificeerdAantalBoekingen: number;
}

export interface OnderhoudTotaalResultaat {
  begrotingsVersieId: string;
  bedrijfsnr: string;
  begrotingsjaar: number;
  begrotingsversieStatus: Begrotingsversie["status"];
  gepland: OnderhoudGeplandResultaat;
  correctiefDagelijks: OnderhoudCorrectiefDagelijksResultaat;
  begrotingOnderhoudTotaal: Decimal;
  werkelijk: OnderhoudWerkelijkTotaal;
  resterendeVerwachtingOnderhoudTotaal: Decimal;
  estimatedOnderhoudTotaal: Decimal;
  verschilEstimatedVsBegrotingBedrag: Decimal;
}

export interface OnderhoudOrchestratieInvoer {
  versie: Begrotingsversie;
  geplandBegroting: HerberekendGeplandOnderhoudResultaat;
  correctiefDagelijksBegroting: HerberekendCorrectiefDagelijksResultaat;
  geplandEstimatedVerwachtingen: readonly GeplandOnderhoudEstimatedVerwachting[];
  geplandEstimatedOnly: readonly GeplandOnderhoudEstimatedOnlyActiviteit[];
  correctiefDagelijksEstimatedVerwachtingen: readonly CorrectiefDagelijksOnderhoudEstimatedVerwachting[];
  correctiefDagelijksEstimatedOnly: readonly CorrectiefDagelijksOnderhoudEstimatedOnlyRegel[];
  /** Bestaand, bewezen Werkelijk-resultaat (bronfeit) — hier NIET herberekend of opnieuw gemapt. */
  werkelijk: WerkelijkOnderhoudResultaat;
  /** Expliciete invoer (geen nieuwe periode-afsluitingsarchitectuur) — zie `begroteGeplandOnderhoudEstimated.ts`. */
  resterendeKwartalen: readonly BgOnderhoudKwartaal[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function combineerGepland(invoer: OnderhoudOrchestratieInvoer): OnderhoudGeplandResultaat {
  const begrotingIds = new Set(invoer.geplandBegroting.activiteiten.map((a) => a.persistentieId));

  const verwachtingIds: number[] = [];
  const resterendInvoer: BgGeplandOnderhoudResterendeVerwachtingInvoer[] = invoer.geplandEstimatedVerwachtingen.map((v, positie) => {
    if (verwachtingIds.includes(v.activiteitId)) {
      throw new Error(`Interne fout: Estimated-verwachting voor activiteit-id ${v.activiteitId} komt meerdere keren voor — koppeling via stabiele ID niet eenduidig.`);
    }
    if (!begrotingIds.has(v.activiteitId)) {
      throw new Error(
        `Interne fout: Estimated-verwachting verwijst naar activiteit-id ${v.activiteitId}, die niet voorkomt in de Begroting Gepland Onderhoud — orphan Estimated-data, geen koppeling verzonnen.`,
      );
    }
    verwachtingIds.push(v.activiteitId);
    return { activiteitIndex: positie, q1: v.q1, q2: v.q2, q3: v.q3, q4: v.q4 };
  });

  const estimatedOnlyInvoer: BgGeplandOnderhoudEstimatedOnlyActiviteitInvoer[] = invoer.geplandEstimatedOnly.map((a) => ({
    complexnummer: a.complexnummer,
    omschrijving: a.omschrijving,
    grootboekrekening: a.grootboekrekening,
    ogbKostensoort: a.ogbKostensoort,
    q1: a.q1,
    q2: a.q2,
    q3: a.q3,
    q4: a.q4,
  }));

  const resterend = berekenResterendeVerwachtingGeplandOnderhoud(resterendInvoer, estimatedOnlyInvoer, {
    resterendeKwartalen: invoer.resterendeKwartalen,
  });
  if (resterend.resterendeVerwachtingen.length !== verwachtingIds.length) {
    throw new Error(
      `Interne fout: Gepland-Estimated-calculator gaf ${resterend.resterendeVerwachtingen.length} uitkomsten voor ${verwachtingIds.length} verwachtingen — positionele id-correlatie geschonden.`,
    );
  }

  const uitkomstPerActiviteitId = new Map<number, BgGeplandOnderhoudResterendeVerwachtingUitkomst>();
  resterend.resterendeVerwachtingen.forEach((uitkomst, positie) => uitkomstPerActiviteitId.set(verwachtingIds[positie]!, uitkomst));

  return {
    begrotingReviewStatus: invoer.geplandBegroting.reviewStatus,
    activiteiten: invoer.geplandBegroting.activiteiten.map(({ persistentieId, activiteit }) => ({
      activiteitId: persistentieId,
      begroting: activiteit,
      resterendeVerwachting: uitkomstPerActiviteitId.get(persistentieId) ?? null,
    })),
    estimatedOnlyActiviteiten: resterend.estimatedOnlyActiviteiten,
    begrotingTotaal: invoer.geplandBegroting.totaalJaar,
    resterendeVerwachtingTotaal: resterend.totaal,
    begrotingControleVereist: invoer.geplandBegroting.controleVereist,
    estimatedControleVereist: resterend.controleVereist,
  };
}

function combineerCorrectiefDagelijks(invoer: OnderhoudOrchestratieInvoer): OnderhoudCorrectiefDagelijksResultaat {
  const begrotingIds = new Set(invoer.correctiefDagelijksBegroting.regels.map((r) => r.persistentieId));

  const verwachtingIds: number[] = [];
  const resterendInvoer: BgCorrectiefDagelijksResterendeVerwachtingInvoer[] = invoer.correctiefDagelijksEstimatedVerwachtingen.map((v, positie) => {
    if (verwachtingIds.includes(v.regelId)) {
      throw new Error(`Interne fout: Estimated-verwachting voor regel-id ${v.regelId} komt meerdere keren voor — koppeling via stabiele ID niet eenduidig.`);
    }
    if (!begrotingIds.has(v.regelId)) {
      throw new Error(
        `Interne fout: Estimated-verwachting verwijst naar regel-id ${v.regelId}, die niet voorkomt in de Begroting Correctief/Dagelijks Onderhoud — orphan Estimated-data, geen koppeling verzonnen.`,
      );
    }
    verwachtingIds.push(v.regelId);
    return { regelIndex: positie, resterendBedrag: v.resterendBedrag };
  });

  const estimatedOnlyInvoer: BgCorrectiefDagelijksEstimatedOnlyRegelInvoer[] = invoer.correctiefDagelijksEstimatedOnly.map((r) => ({
    omschrijving: r.omschrijving,
    complexnummer: r.complexnummer,
    grootboekrekening: r.grootboekrekening,
    ogbKostensoort: r.ogbKostensoort,
    resterendBedrag: r.resterendBedrag,
  }));

  const resterend = berekenResterendeVerwachtingCorrectiefDagelijksOnderhoud(resterendInvoer, estimatedOnlyInvoer);
  if (resterend.resterendeVerwachtingen.length !== verwachtingIds.length) {
    throw new Error(
      `Interne fout: Correctief/Dagelijks-Estimated-calculator gaf ${resterend.resterendeVerwachtingen.length} uitkomsten voor ${verwachtingIds.length} verwachtingen — positionele id-correlatie geschonden.`,
    );
  }

  const uitkomstPerRegelId = new Map<number, BgCorrectiefDagelijksResterendeVerwachtingUitkomst>();
  resterend.resterendeVerwachtingen.forEach((uitkomst, positie) => uitkomstPerRegelId.set(verwachtingIds[positie]!, uitkomst));

  return {
    begrotingReviewStatus: invoer.correctiefDagelijksBegroting.reviewStatus,
    regels: invoer.correctiefDagelijksBegroting.regels.map(({ persistentieId, regel }) => ({
      regelId: persistentieId,
      begroting: regel,
      resterendeVerwachting: uitkomstPerRegelId.get(persistentieId) ?? null,
    })),
    estimatedOnlyRegels: resterend.estimatedOnlyRegels,
    begrotingTotaal: invoer.correctiefDagelijksBegroting.totaalJaar,
    resterendeVerwachtingTotaal: resterend.totaal,
    begrotingControleVereist: invoer.correctiefDagelijksBegroting.controleVereist,
    estimatedControleVereist: resterend.controleVereist,
  };
}

/**
 * PURE combinatiefunctie (geen I/O): koppelt Begroting en Estimated via
 * stabiele IDs en telt Werkelijk exact éénmaal op Onderhoud-totaalniveau op.
 */
export function combineerOnderhoudTotaal(invoer: OnderhoudOrchestratieInvoer): OnderhoudTotaalResultaat {
  const gepland = combineerGepland(invoer);
  const correctiefDagelijks = combineerCorrectiefDagelijks(invoer);

  const begrotingOnderhoudTotaal = som([gepland.begrotingTotaal, correctiefDagelijks.begrotingTotaal]);
  const resterendeVerwachtingOnderhoudTotaal = som([gepland.resterendeVerwachtingTotaal, correctiefDagelijks.resterendeVerwachtingTotaal]);
  const werkelijkOnderhoudTotaal = invoer.werkelijk.moduleTotaal;
  const estimatedOnderhoudTotaal = som([werkelijkOnderhoudTotaal, resterendeVerwachtingOnderhoudTotaal]);

  return {
    begrotingsVersieId: invoer.versie.id,
    bedrijfsnr: invoer.versie.bedrijfsnr,
    begrotingsjaar: invoer.versie.begrotingsjaar,
    begrotingsversieStatus: invoer.versie.status,
    gepland,
    correctiefDagelijks,
    begrotingOnderhoudTotaal,
    werkelijk: {
      niveau: "ONDERHOUD_TOTAAL",
      totaalTotAfgeslotenPeriode: werkelijkOnderhoudTotaal,
      perCategorie: invoer.werkelijk.perCategorie,
      nietGeclassificeerdTotaal: invoer.werkelijk.nietGeclassificeerdTotaal,
      nietGeclassificeerdAantalBoekingen: invoer.werkelijk.nietGeclassificeerdAantalBoekingen,
    },
    resterendeVerwachtingOnderhoudTotaal,
    estimatedOnderhoudTotaal,
    verschilEstimatedVsBegrotingBedrag: estimatedOnderhoudTotaal.minus(begrotingOnderhoudTotaal),
  };
}

/**
 * Leest Begroting (volgens lifecycle: CONCEPT → herberekend uit concept-input,
 * VASTGESTELD → bevroren output) + actuele Estimated uit SQLite, binnen ÉÉN
 * leestransactie, en combineert met het aangeleverde Werkelijk-resultaat.
 * Schrijft NOOIT iets.
 */
export function leesOnderhoudTotaalResultaat(
  db: DatabaseSync,
  versieId: string,
  werkelijk: WerkelijkOnderhoudResultaat,
  resterendeKwartalen: readonly BgOnderhoudKwartaal[],
): OnderhoudTotaalResultaat {
  db.exec("BEGIN");
  let invoer: OnderhoudOrchestratieInvoer;
  try {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }

    let geplandBegroting: HerberekendGeplandOnderhoudResultaat;
    let correctiefDagelijksBegroting: HerberekendCorrectiefDagelijksResultaat;
    if (versie.status === "VASTGESTELD") {
      const frozenGepland = leesFrozenGeplandOnderhoudResultaat(db, versieId);
      const frozenCorrectief = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versieId);
      if (frozenGepland === null || frozenCorrectief === null) {
        throw new Error(`Begrotingsversie ${versieId} is VASTGESTELD, maar de bevroren Onderhoud-output ontbreekt (interne inconsistentie).`);
      }
      geplandBegroting = frozenGepland;
      correctiefDagelijksBegroting = frozenCorrectief;
    } else {
      geplandBegroting = berekenGeplandOnderhoudUitInvoer(
        versieId,
        versie.begrotingsjaar,
        leesGeplandOnderhoudActiviteiten(db, versieId),
        leesGeplandOnderhoudBeoordeeld(db, versieId),
      );
      correctiefDagelijksBegroting = berekenCorrectiefDagelijksUitInvoer(
        versieId,
        versie.begrotingsjaar,
        leesCorrectiefDagelijksOnderhoudRegels(db, versieId),
        leesCorrectiefDagelijksOnderhoudBeoordeeld(db, versieId),
      );
    }

    invoer = {
      versie,
      geplandBegroting,
      correctiefDagelijksBegroting,
      geplandEstimatedVerwachtingen: leesGeplandOnderhoudEstimatedVerwachtingen(db, versieId),
      geplandEstimatedOnly: leesGeplandOnderhoudEstimatedOnlyActiviteiten(db, versieId),
      correctiefDagelijksEstimatedVerwachtingen: leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versieId),
      correctiefDagelijksEstimatedOnly: leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versieId),
      werkelijk,
      resterendeKwartalen,
    };
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return combineerOnderhoudTotaal(invoer);
}
