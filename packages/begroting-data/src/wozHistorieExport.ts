import type { DatabaseSync } from "node:sqlite";
import { bouwWozHistorieCsv, type BgWozHistorieCsvResultaat, type BgWozHistorieFilter, type BgWozObjectInvoer, type BgWozObjectType } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import { leesGemeentelijkeLastenModule } from "./gemeentelijkeLastenModule.js";
import { leesWozObjecten } from "./wozObjecten.js";

/**
 * WOZ-historie CSV-export voor één begrotingsversie (Master Contract §6.8, besluit
 * 2026-09-25): leest de persistente WOZ-set, de administratiecode (`bedrijfsnr` van de
 * versie) en de expliciete "WOZ-set compleet"-bevestiging in ÉÉN leestransactie en laat de
 * pure `bouwWozHistorieCsv` het werk doen (kolommen, filters, escaping, beschikbaarheid).
 * Schrijft nooit; werkt voor CONCEPT en VASTGESTELD (de gegevens zijn dan read-only).
 * Bij een niet-bevestigde set is de export niet beschikbaar.
 */
export function leesWozHistorieCsv(db: DatabaseSync, versieId: string, filter: BgWozHistorieFilter = {}): BgWozHistorieCsvResultaat {
  db.exec("BEGIN");
  try {
    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
    }
    const objecten: BgWozObjectInvoer[] = leesWozObjecten(db, versieId).map((o) => ({
      complexnummer: o.complexnummer,
      // Type-boundary zoals in herberekenen.ts: NULL blijft NULL; een ongeldige waarde is door de enum-CHECK uitgesloten.
      objectType: o.objectType as BgWozObjectType | null,
      unitnummer: o.unitnummer,
      aanslagjaar: o.aanslagjaar,
      waardepeildatum: o.waardepeildatum,
      werkelijkeWoz: o.werkelijkeWoz,
      verwachteWozOverride: o.verwachteWozOverride,
    }));
    const resultaat = bouwWozHistorieCsv({
      administratie: versie.bedrijfsnr,
      wozObjecten: objecten,
      wozSetBevestigd: leesGemeentelijkeLastenModule(db, versieId).wozSetBevestigd,
      filter,
    });
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
