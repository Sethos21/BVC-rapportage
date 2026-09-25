import type Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import {
  berekenEstimatedVerzekeringenPerPolis,
  type BgVerzekeringControleErnst,
  type BgVerzekeringEstimatedPolisUitkomst,
  type BgVerzekeringResultaat,
  type EstimatedVerzekeringResultaat,
  type WerkelijkVerzekeringResultaat,
} from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import { leesFrozenVerzekeringResultaat } from "./frozenVerzekeringResultaat.js";
import { berekenVerzekeringUitInvoer, type HerberekendVerzekeringResultaat } from "./herberekenen.js";
import { leesVerzekeringBeoordeeld } from "./verzekeringBeoordeeld.js";
import { leesVerzekeringEstimatedPolissen, type VerzekeringEstimatedPolis } from "./verzekeringEstimatedPolissen.js";
import { leesVerzekeringRegels } from "./verzekeringRegels.js";

/**
 * Verzekeringen — Estimated met handmatige aanpassing per polis (besluit
 * 2026-09-25): koppelt de Begroting-polissen en de persistente handmatige
 * aanpassingen UITSLUITEND via de stabiele `regel_id` (nooit via positie of
 * inhoud), en voedt daarna de pure `berekenEstimatedVerzekeringenPerPolis`.
 * DUNNE laag: geen eigen financiële regels, geen persistentie van het
 * samengestelde resultaat (afgeleid), schrijft NOOIT.
 *
 * Lifecycle (bestaand patroon): CONCEPT → Begroting herberekend uit de concept-
 * regels; VASTGESTELD → bevroren Begroting-output (immutable). De handmatige
 * aanpassingen worden altijd ACTUEEL gelezen en muteren de Begroting nooit.
 *
 * Een handmatige aanpassing zonder bijbehorende polis in de Begroting (orphan —
 * door de FK normaal onmogelijk) faalt hard; nooit stil gedropt.
 *
 * Werkelijk is een aangeleverd bronfeit op MODULENIVEAU en telt exact éénmaal
 * mee. Bewust GEEN Werkelijk of Estimated-totaal PER POLIS (de boekingen kennen
 * geen polissleutel; zie `berekenEstimatedVerzekeringenPerPolis`).
 */

export interface VerzekeringEstimatedPolisMetId {
  regelId: number;
  automatischResterendVoorstel: Decimal | null;
  handmatigeResterendeVerwachting: Decimal | null;
  effectieveResterendeVerwachting: Decimal | null;
}

export interface VerzekeringEstimatedControleItem {
  /** Stabiele regel-id van de betrokken polis. */
  regelId: number;
  ernst: BgVerzekeringControleErnst;
  bericht: string;
}

export interface VerzekeringEstimatedResultaat {
  begrotingsVersieId: string;
  begrotingsjaar: number;
  /** Polissen in de volgorde van de Begroting (alleen weergavevolgorde; de koppeling is de regel-id). */
  polissen: VerzekeringEstimatedPolisMetId[];
  resterendeVerwachtingTotaal: Decimal | null;
  estimated: EstimatedVerzekeringResultaat;
  controleVereist: VerzekeringEstimatedControleItem[];
}

export interface VerzekeringEstimatedInvoer {
  versieId: string;
  begroting: HerberekendVerzekeringResultaat;
  handmatig: readonly VerzekeringEstimatedPolis[];
  werkelijk: WerkelijkVerzekeringResultaat;
  werkelijkDekkingBevestigd: boolean;
  resterendeMaanden: readonly number[];
}

/** PURE combinatie (geen I/O): koppelt via regel-id en rekent via de pure Estimated-per-polis-calculator. */
export function combineerVerzekeringEstimated(invoer: VerzekeringEstimatedInvoer): VerzekeringEstimatedResultaat {
  const begrotingIds = new Set(invoer.begroting.regels.map((r) => r.persistentieId));
  const handmatigPerId = new Map<number, Decimal>();
  for (const polis of invoer.handmatig) {
    if (handmatigPerId.has(polis.regelId)) {
      throw new Error(`Interne fout: handmatige Estimated-aanpassing voor regel-id ${polis.regelId} komt meerdere keren voor — koppeling via stabiele ID niet eenduidig.`);
    }
    if (!begrotingIds.has(polis.regelId)) {
      throw new Error(`Interne fout: handmatige Estimated-aanpassing verwijst naar regel-id ${polis.regelId}, die niet voorkomt in de Begroting Verzekeringen — orphan Estimated-data, geen koppeling verzonnen.`);
    }
    handmatigPerId.set(polis.regelId, polis.handmatigeResterendeVerwachting);
  }

  const pureBegroting: BgVerzekeringResultaat = { ...invoer.begroting, regels: invoer.begroting.regels.map((r) => r.regel) };
  const handmatigePerPolis = invoer.begroting.regels.map((r) => handmatigPerId.get(r.persistentieId) ?? null);
  const pure = berekenEstimatedVerzekeringenPerPolis(pureBegroting, invoer.werkelijk, invoer.werkelijkDekkingBevestigd, handmatigePerPolis, invoer.resterendeMaanden);

  const regelIdVanIndex = (index: number): number => {
    const regel = invoer.begroting.regels[index];
    if (regel === undefined) throw new Error(`Interne fout: polisindex ${index} buiten bereik — positionele id-correlatie geschonden.`);
    return regel.persistentieId;
  };

  return {
    begrotingsVersieId: invoer.versieId,
    begrotingsjaar: invoer.begroting.begrotingsjaar,
    polissen: pure.polissen.map((p: BgVerzekeringEstimatedPolisUitkomst) => ({
      regelId: regelIdVanIndex(p.index),
      automatischResterendVoorstel: p.automatischResterendVoorstel,
      handmatigeResterendeVerwachting: p.handmatigeResterendeVerwachting,
      effectieveResterendeVerwachting: p.effectieveResterendeVerwachting,
    })),
    resterendeVerwachtingTotaal: pure.resterendeVerwachtingTotaal,
    estimated: pure.estimated,
    controleVereist: pure.controleVereist.map((c) => ({ regelId: regelIdVanIndex(c.regelIndex as number), ernst: c.ernst, bericht: c.bericht })),
  };
}

/** Leest Begroting (volgens lifecycle) + actuele handmatige aanpassingen in één leestransactie en combineert; schrijft nooit. */
export function leesVerzekeringEstimatedResultaat(
  db: DatabaseSync,
  versieId: string,
  werkelijk: WerkelijkVerzekeringResultaat,
  werkelijkDekkingBevestigd: boolean,
  resterendeMaanden: readonly number[],
): VerzekeringEstimatedResultaat {
  db.exec("BEGIN");
  let invoer: VerzekeringEstimatedInvoer;
  try {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    let begroting: HerberekendVerzekeringResultaat;
    if (versie.status === "VASTGESTELD") {
      const frozen = leesFrozenVerzekeringResultaat(db, versieId);
      if (frozen === null) {
        throw new Error(`Begrotingsversie ${versieId} is VASTGESTELD, maar de bevroren Verzekeringen-output ontbreekt (interne inconsistentie).`);
      }
      begroting = frozen;
    } else {
      begroting = berekenVerzekeringUitInvoer(versieId, versie.begrotingsjaar, leesVerzekeringRegels(db, versieId), leesVerzekeringBeoordeeld(db, versieId));
    }
    invoer = { versieId, begroting, handmatig: leesVerzekeringEstimatedPolissen(db, versieId), werkelijk, werkelijkDekkingBevestigd, resterendeMaanden };
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return combineerVerzekeringEstimated(invoer);
}
