import type { DatabaseSync } from "node:sqlite";
import {
  algemeneKostenBegrotingNaarPnLBovenEbitdaRegels,
  algemeneKostenEstimatedNaarPnLBovenEbitdaRegels,
  beheerBegrotingNaarPnLBovenEbitdaRegels,
  gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels,
  gemeentelijkeLastenEstimatedNaarPnLBovenEbitdaRegels,
  huurBegrotingNaarPnLBovenEbitdaRegels,
  managementBegrotingNaarPnLBovenEbitdaRegels,
  onderhoudBegrotingNaarPnLBovenEbitdaRegels,
  onderhoudEstimatedTotaalNaarPnLBovenEbitdaRegels,
  verzekeringEstimatedNaarPnLBovenEbitdaRegels,
  verzekeringenBegrotingNaarPnLBovenEbitdaRegels,
  type BgManagementResultaat,
  type BgOnderhoudKwartaal,
  type PurePnLBovenEbitdaRegel,
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
 * NIET ONDERSTEUND IN ESTIMATED (bewust, niet stil weggelaten): Huur, Beheersvergoeding en Managementvergoeding — hun
 * automatische resterende-verwachting-logica is niet gebouwd. Ze verschijnen als ONBEKEND/TECHNISCH_NIET_ONDERSTEUND,
 * zodat EBITDA-Estimated ONVOLLEDIG is in plaats van te lage kosten/opbrengsten als volledig te presenteren.
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

/** Werkelijk-invoer per module — al berekend door de Werkelijk-keten (bronfeit); hier nooit herberekend. */
export interface EstimatedPnLInvoer {
  onderhoud: { werkelijk: WerkelijkOnderhoudResultaat; dekkingBevestigd: boolean; resterendeKwartalen: readonly BgOnderhoudKwartaal[] };
  verzekeringen: { werkelijk: WerkelijkVerzekeringResultaat; dekkingBevestigd: boolean; resterendeMaanden: readonly number[] };
  gemeentelijkeLasten: { werkelijk: WerkelijkGemeentelijkeLastenResultaat; dekkingBevestigd: boolean };
  algemeneKosten: { werkelijk: WerkelijkAlgemeneKostenResultaat; dekkingBevestigd: boolean };
}

function nietOndersteundeEstimatedRegels(): PurePnLBovenEbitdaRegel[] {
  const onbekend = (module: string) => ({ status: "ONBEKEND" as const, dekkingReden: "TECHNISCH_NIET_ONDERSTEUND" as const, toelichting: `Estimated ${module}: automatische resterende-verwachting-logica is nog niet gebouwd.` });
  return [
    { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: onbekend("Huur") },
    { regelSleutel: "HUUROPBRENGST_ONBELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: onbekend("Huur") },
    { regelSleutel: "BEHEERKOSTEN", boomPositie: "BOVEN_EBITDA", groep: "MANAGEMENT_EN_BEHEER", contributieAard: "KOSTEN", waarde: onbekend("Beheersvergoeding") },
    { regelSleutel: "MANAGEMENTVERGOEDING", boomPositie: "BOVEN_EBITDA", groep: "MANAGEMENT_EN_BEHEER", contributieAard: "KOSTEN", waarde: onbekend("Managementvergoeding") },
  ];
}

/** Estimated → regels voor de modules waarvoor Estimated is gebouwd, plus expliciet-onbekende regels voor de rest (zie moduledoc). */
export function leesEstimatedPnLRegels(db: DatabaseSync, versieId: string, invoer: EstimatedPnLInvoer): PurePnLBovenEbitdaRegel[] {
  const onderhoud = leesOnderhoudTotaalResultaat(db, versieId, invoer.onderhoud.werkelijk, invoer.onderhoud.resterendeKwartalen);
  const verzekering = leesVerzekeringEstimatedResultaat(db, versieId, invoer.verzekeringen.werkelijk, invoer.verzekeringen.dekkingBevestigd, invoer.verzekeringen.resterendeMaanden);
  const gemeentelijkeLasten = leesGemeentelijkeLastenEstimatedResultaat(db, versieId, invoer.gemeentelijkeLasten.werkelijk, invoer.gemeentelijkeLasten.dekkingBevestigd);
  const algemeneKosten = leesAlgemeneKostenEstimatedResultaat(db, versieId, invoer.algemeneKosten.werkelijk, invoer.algemeneKosten.dekkingBevestigd);

  return [
    ...nietOndersteundeEstimatedRegels(),
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
