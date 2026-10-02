import type { DatabaseSync } from "node:sqlite";
import { bepaalRelevanteGemeentelijkeLastenGrootboeken, type BgRelevantGrootboek } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import { leesPnLBronmappingRegels } from "./pnlBronmappingRepository.js";

/**
 * De voor de administratie van een begrotingsversie RELEVANTE Gemeentelijke-lasten-GL's (Vervolgtranche 4,
 * Master Contract §6.8) — uitsluitend GEGEVENSGEDREVEN uit de centrale per-administratie P&L-bronmapping
 * (`pnl_bronmapping`, `economischeModule = GEMEENTELIJKE_LASTEN`), via de pure
 * `bepaalRelevanteGemeentelijkeLastenGrootboeken`. Geen enkele GL/OGB staat in deze code: 070 boekt op GL4700 +
 * GL4710, andere administraties op één GL4701 — dat verschil volgt uitsluitend uit de mappingdata.
 *
 * Gebruik: (1) `berekenBegrotingUitInvoer` toetst elke begrotingsregel hiertegen (KRITIEK bij een GL/OGB buiten
 * de mapping); (2) een latere UI kan hiermee de keuzelijst "relevante GL's" voor de administratie tonen, met
 * de omschrijving uit de mapping. Leest alleen; werkt op elke versiestatus (ook VASTGESTELD, voor terugkijken).
 */

export interface RelevantGemeentelijkeLastenGrootboek extends BgRelevantGrootboek {
  /** Omschrijving van de GL volgens de mapping (nieuwste regel met een omschrijving); `null` als de mapping er geen kent. */
  grootboekOmschrijving: string | null;
}

/** Zuivere invoer voor de calculator: de set relevante GL's voor `bedrijfsnr` in `begrotingsjaar`. Geen versiecontext nodig. */
export function leesRelevanteGemeentelijkeLastenGrootboekenVoorAdministratie(db: DatabaseSync, bedrijfsnr: string, begrotingsjaar: number): RelevantGemeentelijkeLastenGrootboek[] {
  const mappingregels = leesPnLBronmappingRegels(db, bedrijfsnr);
  const relevant = bepaalRelevanteGemeentelijkeLastenGrootboeken(mappingregels, { bedrijfsnr, begrotingsjaar });
  return relevant.map((gl) => {
    const metOmschrijving = mappingregels
      .filter((r) => r.grootboekrekening === gl.grootboekrekening && r.grootboekOmschrijving !== null)
      .sort((a, b) => b.aangemaaktOp.getTime() - a.aangemaaktOp.getTime() || b.id - a.id)[0];
    return { ...gl, grootboekOmschrijving: metOmschrijving?.grootboekOmschrijving ?? null };
  });
}

/** Zelfde als hierboven, voor de administratie + het begrotingsjaar van één begrotingsversie. Faalt als de versie niet bestaat. */
export function leesRelevanteGemeentelijkeLastenGrootboeken(db: DatabaseSync, versieId: string): RelevantGemeentelijkeLastenGrootboek[] {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  return leesRelevanteGemeentelijkeLastenGrootboekenVoorAdministratie(db, versie.bedrijfsnr, versie.begrotingsjaar);
}
