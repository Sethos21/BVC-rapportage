import type { DatabaseSync } from "node:sqlite";
import {
  algemeneKostenBegrotingNaarPnLBovenEbitdaRegels,
  algemeneKostenEstimatedNaarPnLBovenEbitdaRegels,
  beheerBegrotingNaarPnLBovenEbitdaRegels,
  beheerEstimatedNaarPnLBovenEbitdaRegels,
  berekenEstimatedBeheer,
  berekenEstimatedHuur,
  berekenEstimatedManagement,
  gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels,
  gemeentelijkeLastenEstimatedNaarPnLBovenEbitdaRegels,
  huurBegrotingNaarPnLBovenEbitdaRegels,
  huurEstimatedNaarPnLBovenEbitdaRegels,
  managementBegrotingNaarPnLBovenEbitdaRegels,
  managementEstimatedNaarPnLBovenEbitdaRegels,
  onderhoudBegrotingNaarPnLBovenEbitdaRegels,
  onderhoudEstimatedTotaalNaarPnLBovenEbitdaRegels,
  verzekeringEstimatedNaarPnLBovenEbitdaRegels,
  verzekeringenBegrotingNaarPnLBovenEbitdaRegels,
  type BgBeheerResultaat,
  type BgHuurResultaat,
  type BgManagementResultaat,
  type BgOnderhoudKwartaal,
  type PurePnLBovenEbitdaRegel,
  type WerkelijkBeheerResultaat,
  type WerkelijkHuurResultaat,
  type WerkelijkManagementResultaat,
  type WerkelijkAlgemeneKostenResultaat,
  type WerkelijkGemeentelijkeLastenResultaat,
  type WerkelijkOnderhoudResultaat,
  type WerkelijkVerzekeringResultaat,
} from "@bvc/reporting";
import { leesAlgemeneKostenEstimatedResultaat } from "./algemeneKostenEstimated.js";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import { leesFrozenAlgemeneKostenResultaat } from "./frozenAlgemeneKostenResultaat.js";
import { leesFrozenCorrectiefDagelijksOnderhoudResultaat } from "./frozenCorrectiefDagelijksOnderhoudResultaat.js";
import { leesFrozenGemeentelijkeLastenResultaat } from "./frozenGemeentelijkeLastenResultaat.js";
import { leesFrozenGeplandOnderhoudResultaat } from "./frozenGeplandOnderhoudResultaat.js";
import { leesFrozenModule3Resultaat } from "./frozenModule3Resultaat.js";
import { leesFrozenBegrotingsresultaat } from "./frozenResultaat.js";
import { leesFrozenVerzekeringResultaat } from "./frozenVerzekeringResultaat.js";
import { leesGemeentelijkeLastenEstimatedResultaat } from "./gemeentelijkeLastenEstimated.js";
import { herberekenBegroting } from "./herberekenen.js";
import { leesOnderhoudTotaalResultaat } from "./onderhoudOrchestratie.js";
import { leesVerzekeringEstimatedResultaat } from "./verzekeringEstimated.js";

/**
 * Begroting/Estimated → PURE P&L-REGELS voor één begrotingsversie (Vervolgtranche 6, ketencontrole): de dunne
 * verbinding tussen de reeds gebouwde begrotingslogica en de pure P&L-engine (`berekenPnLBoom`). Rekent NIETS: het
 * leest volgens de lifecycle en vertaalt via de pure adapters in `@bvc/reporting`. Schrijft nooit.
 *
 * - `leesBegrotingPnLRegels`: CONCEPT → live herberekend; VASTGESTELD → uitsluitend de bevroren output (immutable).
 *   De aanroeper geeft de regels aan `berekenPnLBoom("BEGROTING_NIEUW_JAAR" | "BEGROTING_VORIG_JAAR", …)`.
 * - `leesEstimatedPnLRegels`: Estimated = Werkelijk (aangeleverd, exact éénmaal) + handmatige resterende verwachting,
 *   voor Onderhoud (totaalniveau), Verzekeringen, Gemeentelijke lasten en Algemene kosten. Estimated leest de
 *   Begroting en muteert haar nooit (ook niet na vaststellen). Aanvraag voor `berekenPnLBoom("ESTIMATED", …)`.
 *
 * HUUR, BEHEERSVERGOEDING EN MANAGEMENTVERGOEDING (Vervolgtranche 7): Estimated = Werkelijk (aangeleverd, exact éénmaal) +
 * de resterende maanden uit de Begroting van deze versie (concept herberekend, vastgesteld bevroren) — automatisch uit de
 * contract-/begrotingslogica (FO OB-024), zonder persistentie. `resterendeMaanden` is expliciete invoer (kalendermaanden ná
 * de laatst afgesloten periode). Werkelijk-dekking per module bepaalt de aanroeper (zie `bepaalGemapteCategorieen`): zonder
 * bewezen mapping — bekend voor Management bij 070 — is de regel ONBEKEND.
 * Werkelijk komt uit de aparte Werkelijk-keten (`berekenPnLPeriode`), niet uit dit bestand.
 */

/** Begroting → regels; faalt op een niet-bestaande versie. */
export function leesBegrotingPnLRegels(db: DatabaseSync, versieId: string): PurePnLBovenEbitdaRegel[] {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }

  let m1: Parameters<typeof huurBegrotingNaarPnLBovenEbitdaRegels>[0];
  let m2: Parameters<typeof beheerBegrotingNaarPnLBovenEbitdaRegels>[0];
  let m3: BgManagementResultaat | null;
  let gepland: Parameters<typeof onderhoudBegrotingNaarPnLBovenEbitdaRegels>[0]["gepland"];
  let correctief: Parameters<typeof onderhoudBegrotingNaarPnLBovenEbitdaRegels>[0]["correctiefDagelijks"];
  let verzekering: Parameters<typeof verzekeringenBegrotingNaarPnLBovenEbitdaRegels>[0];
  let gemeentelijkeLasten: Parameters<typeof gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels>[0];
  let algemeneKosten: Parameters<typeof algemeneKostenBegrotingNaarPnLBovenEbitdaRegels>[0];

  if (versie.status === "VASTGESTELD") {
    const frozen12 = leesFrozenBegrotingsresultaat(db, versieId);
    const frozenGepland = leesFrozenGeplandOnderhoudResultaat(db, versieId);
    const frozenCorrectief = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versieId);
    const frozenVerzekering = leesFrozenVerzekeringResultaat(db, versieId);
    const frozenGl = leesFrozenGemeentelijkeLastenResultaat(db, versieId);
    const frozenAk = leesFrozenAlgemeneKostenResultaat(db, versieId);
    if (frozen12 === null || frozenGepland === null || frozenCorrectief === null || frozenVerzekering === null || frozenGl === null || frozenAk === null) {
      throw new Error(`Begrotingsversie ${versieId} is VASTGESTELD, maar (een deel van) de bevroren begroting-output ontbreekt (interne inconsistentie).`);
    }
    m1 = frozen12.module1;
    m2 = frozen12.module2;
    m3 = leesFrozenModule3Resultaat(db, versieId);
    gepland = frozenGepland;
    correctief = frozenCorrectief;
    verzekering = frozenVerzekering;
    gemeentelijkeLasten = frozenGl;
    algemeneKosten = frozenAk;
  } else {
    const b = herberekenBegroting(db, versieId);
    m1 = b.module1;
    m2 = b.module2;
    m3 = b.module3;
    gepland = b.geplandOnderhoud;
    correctief = b.correctiefDagelijksOnderhoud;
    verzekering = b.verzekering;
    gemeentelijkeLasten = b.gemeentelijkeLasten;
    algemeneKosten = b.algemeneKosten;
  }

  return [
    ...huurBegrotingNaarPnLBovenEbitdaRegels(m1),
    ...beheerBegrotingNaarPnLBovenEbitdaRegels(m2),
    ...managementBegrotingNaarPnLBovenEbitdaRegels(m3),
    ...onderhoudBegrotingNaarPnLBovenEbitdaRegels({ gepland, correctiefDagelijks: correctief }),
    ...verzekeringenBegrotingNaarPnLBovenEbitdaRegels(verzekering),
    ...gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels(gemeentelijkeLasten),
    ...algemeneKostenBegrotingNaarPnLBovenEbitdaRegels(algemeneKosten),
  ];
}

/** De Begroting-resultaten van Huur, Beheer en Management volgens de lifecycle (concept herberekend, vastgesteld bevroren). Leest, schrijft nooit. */
function leesHuurBeheerManagementBegroting(db: DatabaseSync, versieId: string): { module1: BgHuurResultaat; module2: BgBeheerResultaat; module3: BgManagementResultaat | null } {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status === "VASTGESTELD") {
    const frozen = leesFrozenBegrotingsresultaat(db, versieId);
    if (frozen === null) {
      throw new Error(`Begrotingsversie ${versieId} is VASTGESTELD, maar de bevroren Huur-/Beheer-output ontbreekt (interne inconsistentie).`);
    }
    return { module1: frozen.module1, module2: frozen.module2, module3: leesFrozenModule3Resultaat(db, versieId) };
  }
  const b = herberekenBegroting(db, versieId);
  return { module1: b.module1, module2: b.module2, module3: b.module3 };
}

/** Werkelijk-invoer per module — al berekend door de Werkelijk-keten (bronfeit); hier nooit herberekend. */
export interface EstimatedPnLInvoer {
  /** Kalendermaanden (1..12) ná de laatst afgesloten periode — voor Huur, Beheer en Management. Leeg = jaar volledig afgesloten. */
  resterendeMaanden: readonly number[];
  huur: { werkelijk: WerkelijkHuurResultaat; dekkingBevestigd: boolean };
  beheer: { werkelijk: WerkelijkBeheerResultaat; dekkingBevestigd: boolean };
  management: { werkelijk: WerkelijkManagementResultaat; dekkingBevestigd: boolean };
  onderhoud: { werkelijk: WerkelijkOnderhoudResultaat; dekkingBevestigd: boolean; resterendeKwartalen: readonly BgOnderhoudKwartaal[] };
  verzekeringen: { werkelijk: WerkelijkVerzekeringResultaat; dekkingBevestigd: boolean; resterendeMaanden: readonly number[] };
  gemeentelijkeLasten: { werkelijk: WerkelijkGemeentelijkeLastenResultaat; dekkingBevestigd: boolean };
  algemeneKosten: { werkelijk: WerkelijkAlgemeneKostenResultaat; dekkingBevestigd: boolean };
}

/** Estimated → regels voor Huur, Beheer, Management, Onderhoud (totaal), Verzekeringen, Gemeentelijke lasten en Algemene kosten (zie moduledoc). */
export function leesEstimatedPnLRegels(db: DatabaseSync, versieId: string, invoer: EstimatedPnLInvoer): PurePnLBovenEbitdaRegel[] {
  const basis = leesHuurBeheerManagementBegroting(db, versieId);
  const huur = berekenEstimatedHuur(basis.module1, invoer.huur.werkelijk, invoer.huur.dekkingBevestigd, invoer.resterendeMaanden);
  const beheer = berekenEstimatedBeheer(basis.module1, basis.module2, invoer.beheer.werkelijk, invoer.beheer.dekkingBevestigd, invoer.resterendeMaanden);
  const management = berekenEstimatedManagement(basis.module3, invoer.management.werkelijk, invoer.management.dekkingBevestigd, invoer.resterendeMaanden);
  const onderhoud = leesOnderhoudTotaalResultaat(db, versieId, invoer.onderhoud.werkelijk, invoer.onderhoud.resterendeKwartalen);
  const verzekering = leesVerzekeringEstimatedResultaat(db, versieId, invoer.verzekeringen.werkelijk, invoer.verzekeringen.dekkingBevestigd, invoer.verzekeringen.resterendeMaanden);
  const gemeentelijkeLasten = leesGemeentelijkeLastenEstimatedResultaat(db, versieId, invoer.gemeentelijkeLasten.werkelijk, invoer.gemeentelijkeLasten.dekkingBevestigd);
  const algemeneKosten = leesAlgemeneKostenEstimatedResultaat(db, versieId, invoer.algemeneKosten.werkelijk, invoer.algemeneKosten.dekkingBevestigd);

  return [
    ...huurEstimatedNaarPnLBovenEbitdaRegels(huur),
    ...beheerEstimatedNaarPnLBovenEbitdaRegels(beheer),
    ...managementEstimatedNaarPnLBovenEbitdaRegels(management),
    ...onderhoudEstimatedTotaalNaarPnLBovenEbitdaRegels({
      estimatedOnderhoudTotaal: onderhoud.estimatedOnderhoudTotaal,
      werkelijkDekkingBevestigd: invoer.onderhoud.dekkingBevestigd,
      nietGeclassificeerdTotaal: onderhoud.werkelijk.nietGeclassificeerdTotaal,
      activiteitenZonderResterendeVerwachting: onderhoud.gepland.activiteiten.filter((a) => a.resterendeVerwachting === null).length,
      regelsZonderResterendeVerwachting: onderhoud.correctiefDagelijks.regels.filter((r) => r.resterendeVerwachting === null).length,
    }),
    ...verzekeringEstimatedNaarPnLBovenEbitdaRegels(verzekering.estimated),
    ...gemeentelijkeLastenEstimatedNaarPnLBovenEbitdaRegels(gemeentelijkeLasten),
    ...algemeneKostenEstimatedNaarPnLBovenEbitdaRegels(algemeneKosten),
  ];
}
