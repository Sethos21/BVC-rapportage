import type { DatabaseSync } from "node:sqlite";
import Decimal from "decimal.js";
import {
  berekenPnLBoom,
  type BgOnderhoudKwartaal,
  type PnLBronBijdrage,
  type PnLGroepBovenEbitda,
  type PnLModuleWerkelijkBundel,
  type PurePnLBovenEbitdaRegel,
  type PurePnLOnderEbitdaRegel,
  type PurePnLResultaat,
} from "@bvc/reporting";
import { leesBegrotingPnLRegels, leesEstimatedPnLRegels, type EstimatedPnLInvoer } from "./begrotingPnL.js";

/**
 * TRANCHE 11 — de vergelijkende begrotings-P&L: de werkomgeving waarin de nieuwe
 * exploitatiebegroting wordt opgesteld (Master Contract §11, FO OB-024, UX §3/§11).
 *
 * Rekent en classificeert NIETS zelf. Roept uitsluitend de al bestaande, geaccepteerde
 * functies aan — `leesBegrotingPnLRegels`/`leesEstimatedPnLRegels` (begroting → pure P&L-
 * regels) en `berekenPnLBoom` (de enige plek die optelt/EBITDA afleidt) — en zet de vier
 * resulterende `PurePnLResultaat`-bomen (Begroting vorig jaar, Werkelijk, Estimated, Jouw
 * begroting nieuw jaar) per canonieke `regelSleutel` naast elkaar.
 *
 * "BEGROTING VORIG JAAR" ONTBREEKT ECHT — GEEN RECONSTRUCTIE (FO §7, UX §11): als voor de
 * administratie/het huidige jaar geen VASTGESTELDE begrotingsversie bestaat
 * (`vorigJaarVersieId === null`), kunnen zowel "Begroting vorig jaar" als "Estimated" niet
 * worden berekend — Estimated vereist immers de structuur/aannames van die begroting (zie
 * `leesEstimatedPnLRegels`'s eigen `leesHuurBeheerManagementBegroting`-aanroep). Beide blijven
 * dan `null` op resultaatniveau en `null` (onbekend) per regel — nooit een verzonnen €0 of een
 * afleiding uit Werkelijk/Estimated.
 *
 * VOORSTEL NIEUW BEGROTINGSJAAR (FO §8/§10, UX §3): uitsluitend voor de posten waarvoor de FO
 * al een automatische berekening voorschrijft (Huur belast/onbelast, Beheersvergoeding,
 * Verzekeringen, Gemeentelijke lasten pand) — voor die posten IS de door het systeem berekende
 * "Jouw begroting nieuw jaar" (vóór een eventuele losse handmatige aanpassing) per constructie
 * ook het voorstel, dus wordt hier geen aparte, tweede "voorstel-zonder-overrides"-berekening
 * uitgevoerd (dat is een grotere, aparte uitbreiding — zie acceptatierapport "resterend werk").
 * Elke andere post krijgt `{ type: "HANDMATIG" }` ("Handmatig opgebouwd", UX §3 punt 5) — nooit
 * een verzonnen voorstelalgoritme.
 */

const VOORSTEL_AUTOMATISCH_SLEUTELS: ReadonlySet<string> = new Set(["HUUROPBRENGST_BELAST", "HUUROPBRENGST_ONBELAST", "BEHEERKOSTEN", "VERZEKERINGEN", "GEMEENTELIJKE_LASTEN"]);

export type VergelijkendeBegrotingsPnLVoorstel = { type: "BEDRAG"; bedrag: Decimal } | { type: "HANDMATIG" };

export interface VergelijkendeBegrotingsPnLRegel {
  regelSleutel: string;
  boomPositie: "BOVEN_EBITDA" | "ONDER_EBITDA";
  groep: PnLGroepBovenEbitda | null;
  /** `null` = geen vastgestelde begroting voor het huidige jaar beschikbaar (onbekend, nooit gereconstrueerd). */
  begrotingVorigJaar: PnLBronBijdrage | null;
  werkelijk: PnLBronBijdrage | null;
  /** `null` = kon niet worden berekend omdat `begrotingVorigJaar` ontbreekt (zie moduledoc). */
  estimated: PnLBronBijdrage | null;
  jouwBegroting: PnLBronBijdrage | null;
  voorstel: VergelijkendeBegrotingsPnLVoorstel;
}

export interface VergelijkendeBegrotingsPnLResultaat {
  begrotingVorigJaar: PurePnLResultaat | null;
  werkelijk: PurePnLResultaat;
  estimated: PurePnLResultaat | null;
  jouwBegroting: PurePnLResultaat;
  regels: readonly VergelijkendeBegrotingsPnLRegel[];
}

function alleRegels(resultaat: PurePnLResultaat): readonly (PurePnLBovenEbitdaRegel | PurePnLOnderEbitdaRegel)[] {
  return [...resultaat.totaalOpbrengsten.regels, ...resultaat.managementEnBeheer.regels, ...resultaat.exploitatieLasten.regels, ...resultaat.algemeneKosten.regels, ...resultaat.onderEbitda];
}

function vindWaarde(resultaat: PurePnLResultaat | null, regelSleutel: string): PnLBronBijdrage | null {
  if (resultaat === null) return null;
  return alleRegels(resultaat).find((r) => r.regelSleutel === regelSleutel)?.waarde ?? null;
}

/**
 * Assembleert de vier vergelijkingskolommen voor één (bestaande) nieuwe begrotingsversie.
 * `werkelijkResultaat` en `estimatedInvoer` worden AANGELEVERD (bv. via `bouwEstimatedPnLInvoer`
 * op een echte productie-Werkelijk-ophaal) — deze functie berekent Werkelijk zelf nooit opnieuw.
 * Schrijft niets.
 */
export function leesVergelijkendeBegrotingsPnL(
  db: DatabaseSync,
  input: { nieuweVersieId: string; vorigJaarVersieId: string | null },
  werkelijkResultaat: PurePnLResultaat,
  estimatedInvoer: EstimatedPnLInvoer,
): VergelijkendeBegrotingsPnLResultaat {
  const jouwBegroting = berekenPnLBoom("BEGROTING_NIEUW_JAAR", leesBegrotingPnLRegels(db, input.nieuweVersieId));

  let begrotingVorigJaar: PurePnLResultaat | null = null;
  let estimated: PurePnLResultaat | null = null;
  if (input.vorigJaarVersieId !== null) {
    begrotingVorigJaar = berekenPnLBoom("BEGROTING_VORIG_JAAR", leesBegrotingPnLRegels(db, input.vorigJaarVersieId));
    estimated = berekenPnLBoom("ESTIMATED", leesEstimatedPnLRegels(db, input.vorigJaarVersieId, estimatedInvoer));
  }

  const canon = new Map<string, { boomPositie: "BOVEN_EBITDA" | "ONDER_EBITDA"; groep: PnLGroepBovenEbitda | null }>();
  for (const bron of [jouwBegroting, werkelijkResultaat, begrotingVorigJaar, estimated]) {
    if (bron === null) continue;
    for (const regel of alleRegels(bron)) {
      if (!canon.has(regel.regelSleutel)) {
        canon.set(regel.regelSleutel, { boomPositie: regel.boomPositie, groep: regel.boomPositie === "BOVEN_EBITDA" ? regel.groep : null });
      }
    }
  }

  const regels: VergelijkendeBegrotingsPnLRegel[] = [...canon.entries()].map(([regelSleutel, { boomPositie, groep }]) => {
    const jouwWaarde = vindWaarde(jouwBegroting, regelSleutel);
    const voorstel: VergelijkendeBegrotingsPnLVoorstel =
      VOORSTEL_AUTOMATISCH_SLEUTELS.has(regelSleutel) && jouwWaarde !== null && jouwWaarde.status !== "ONBEKEND" ? { type: "BEDRAG", bedrag: jouwWaarde.bedrag } : { type: "HANDMATIG" };
    return {
      regelSleutel,
      boomPositie,
      groep,
      begrotingVorigJaar: vindWaarde(begrotingVorigJaar, regelSleutel),
      werkelijk: vindWaarde(werkelijkResultaat, regelSleutel),
      estimated: vindWaarde(estimated, regelSleutel),
      jouwBegroting: jouwWaarde,
      voorstel,
    };
  });

  return { begrotingVorigJaar, werkelijk: werkelijkResultaat, estimated, jouwBegroting, regels };
}

/**
 * Bouwt `EstimatedPnLInvoer` uit een `PnLModuleWerkelijkBundel` (het additieve resultaatveld
 * van `berekenPnLPeriode`, TRANCHE 11) — vermijdt dat een aanroeper Werkelijk een tweede keer
 * per module hoeft te berekenen of typen hoeft te dupliceren. `resterendeMaanden`/
 * `resterendeKwartalen` blijven expliciete invoer (CLAUDE.md §6: periodekeuze altijd
 * expliciet) — deze functie leidt ze niet zelf af uit een boekperiode.
 */
export function bouwEstimatedPnLInvoer(moduleWerkelijk: PnLModuleWerkelijkBundel, resterendeMaanden: readonly number[], resterendeKwartalen: readonly BgOnderhoudKwartaal[]): EstimatedPnLInvoer {
  return {
    resterendeMaanden,
    huur: moduleWerkelijk.huur,
    beheer: moduleWerkelijk.beheer,
    management: moduleWerkelijk.management,
    onderhoud: { ...moduleWerkelijk.onderhoud, resterendeKwartalen },
    verzekeringen: { ...moduleWerkelijk.verzekeringen, resterendeMaanden },
    gemeentelijkeLasten: moduleWerkelijk.gemeentelijkeLasten,
    algemeneKosten: moduleWerkelijk.algemeneKosten,
    leegstand: { ...moduleWerkelijk.leegstand, resterendeKwartalen },
    nietVerrekenbareBtw: moduleWerkelijk.nietVerrekenbareBtw,
    rente: moduleWerkelijk.rente,
  };
}

/** Kalendermaanden ná een "laatst afgesloten boekperiode" (bv. "08" → [9,10,11,12]; "12" → []). */
export function bepaalResterendeMaanden(laatstAfgeslotenBoekperiode: string): number[] {
  const laatste = Number(laatstAfgeslotenBoekperiode);
  const maanden: number[] = [];
  for (let m = laatste + 1; m <= 12; m++) maanden.push(m);
  return maanden;
}

const KWARTAAL_LAATSTE_MAAND: Record<BgOnderhoudKwartaal, number> = { Q1: 3, Q2: 6, Q3: 9, Q4: 12 };

/** Kwartalen die na een "laatst afgesloten boekperiode" nog niet volledig zijn afgesloten (bv. "08" → [Q3, Q4]). */
export function bepaalResterendeKwartalen(laatstAfgeslotenBoekperiode: string): BgOnderhoudKwartaal[] {
  const laatste = Number(laatstAfgeslotenBoekperiode);
  return (["Q1", "Q2", "Q3", "Q4"] as const).filter((q) => KWARTAAL_LAATSTE_MAAND[q] > laatste);
}
