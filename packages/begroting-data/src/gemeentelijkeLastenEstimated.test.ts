import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenWerkelijkGemeentelijkeLasten } from "@bvc/reporting";
import { maakBegrotingsversie, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesGemeentelijkeLastenEstimatedResultaat, leesGemeentelijkeLastenEstimatedVerwachting, schrijfGemeentelijkeLastenEstimatedVerwachting } from "./gemeentelijkeLastenEstimated.js";
import { schrijfGemeentelijkeLastenModule, schrijfWozSetBevestigd } from "./gemeentelijkeLastenModule.js";
import { schrijfGemeentelijkeLastenRegels } from "./gemeentelijkeLastenRegels.js";
import { schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Snapshot } from "./module1Snapshot.js";
import { voegPnLBronmappingMutatieToe } from "./pnlBronmappingRepository.js";
import { schrijfWozObjecten } from "./wozObjecten.js";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-gl-estimated-"));
  db = openOrCreateDatabase(join(dir, "begrotingen.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const D = (n: string | number) => new Decimal(n);
const VERSIE: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "003", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };
const werkelijk4000 = () => berekenWerkelijkGemeentelijkeLasten([{ economischeCategorie: "GEMEENTELIJKE_LASTEN", complexnummer: "001", saldo: D(4000) }]);

function maakVersie(): string {
  voegPnLBronmappingMutatieToe(db, {
    bedrijfsnr: "003", grootboekrekening: "4701", grootboekOmschrijving: null, ogbKostensoort: null, ogbKostensoortOmschrijving: null,
    economischeModule: "GEMEENTELIJKE_LASTEN", economischeCategorie: "GEMEENTELIJKE_LASTEN", geldigVanafBoekjaar: 2025, geldigVanafPeriode: "01",
    geldigTotBoekjaar: null, geldigTotPeriode: null, type: "NIEUWE_MAPPING_VANAF_PERIODE", vorigeMappingId: null,
    gewijzigdOp: new Date("2026-09-14T00:00:00.000Z"), gebruiker: "test", wijzigingsreden: "testfixture",
  });
  const id = maakBegrotingsversie(db, VERSIE).id;
  schrijfModule1Snapshot(db, id, []);
  schrijfModule1Aannames(db, id, { begrotingsjaar: 2027, indexatiePercentage: D(3) });
  schrijfWozObjecten(db, id, [{ id: null, complexnummer: "001", objectType: "GEHEEL_COMPLEX", unitnummer: null, aanslagjaar: 2026, waardepeildatum: new Date(Date.UTC(2026, 0, 1)), werkelijkeWoz: D(1000000), verwachteWozOverride: null }]);
  schrijfGemeentelijkeLastenModule(db, id, { werkelijkeGemeentelijkeLasten: D(9000), wozStijgingPercentage: D(10), lastenPercentageStijging: D(5), begrotingsPercentageOverride: null, beoordeeld: true });
  schrijfWozSetBevestigd(db, id, true);
  schrijfGemeentelijkeLastenRegels(db, id, [{ id: null, grootboekrekening: "4701", ogbKostensoort: null, jaarbedrag: D(8200) }]);
  return id;
}

describe("Gemeentelijke lasten Estimated — persistence (migratie 36)", () => {
  it("1. geen rij = niet ingevuld (null); expliciet €0 is geldig en blijft onderscheiden; null verwijdert; NaN/onbekende versie geweigerd", () => {
    const id = maakVersie();
    expect(leesGemeentelijkeLastenEstimatedVerwachting(db, id)).toBeNull();
    expect(schrijfGemeentelijkeLastenEstimatedVerwachting(db, id, D(0))!.toString()).toBe("0");
    expect(schrijfGemeentelijkeLastenEstimatedVerwachting(db, id, D("123.4567"))!.toString()).toBe("123.4567");
    expect(schrijfGemeentelijkeLastenEstimatedVerwachting(db, id, null)).toBeNull();
    expect(() => schrijfGemeentelijkeLastenEstimatedVerwachting(db, id, D(NaN))).toThrow(/NaN/);
    expect(() => schrijfGemeentelijkeLastenEstimatedVerwachting(db, "bestaat-niet", D(1))).toThrow(/bestaat niet/);
  });

  it("2. versiegebonden en cascade bij verwijderen van een CONCEPT-versie", () => {
    const id = maakVersie();
    schrijfGemeentelijkeLastenEstimatedVerwachting(db, id, D(5));
    verwijderConceptVersie(db, id);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM begroting_gemeentelijke_lasten_estimated_verwachting`).get() as { n: number }).n).toBe(0);
  });
});

describe("Gemeentelijke lasten Estimated — vergelijkt met de GL-regelpost, niet met het WOZ-voorstel", () => {
  it("3. begrotingTotaal = som GL-regels (8.200), Werkelijk éénmaal (4.000) + verwachting (4.500) = 8.500; afwijking +300 (niet t.o.v. voorstel 10.395)", () => {
    const id = maakVersie();
    schrijfGemeentelijkeLastenEstimatedVerwachting(db, id, D(4500));
    const r = leesGemeentelijkeLastenEstimatedResultaat(db, id, werkelijk4000(), true);
    expect(r.moduleBegrotingTotaal!.toString()).toBe("8200");
    expect(r.moduleEstimatedTotaal!.toString()).toBe("8500");
    expect(r.perCategorie[0]!.afwijking!.toString()).toBe("300");
  });

  it("4. niet-ingevulde verwachting: Estimated onbekend (null), nooit Werkelijk + 0", () => {
    const id = maakVersie();
    const r = leesGemeentelijkeLastenEstimatedResultaat(db, id, werkelijk4000(), true);
    expect(r.moduleEstimatedTotaal).toBeNull();
    expect(r.perCategorie[0]!.verwachtingResterendJaar).toBeNull();
  });

  it("5. Estimated schrijft en muteert nooit: de GL-regels blijven ongewijzigd na lezen en na het wijzigen van de verwachting", () => {
    const id = maakVersie();
    const voor = leesGemeentelijkeLastenEstimatedResultaat(db, id, werkelijk4000(), true).moduleBegrotingTotaal!.toString();
    schrijfGemeentelijkeLastenEstimatedVerwachting(db, id, D(99999));
    expect(leesGemeentelijkeLastenEstimatedResultaat(db, id, werkelijk4000(), true).moduleBegrotingTotaal!.toString()).toBe(voor);
  });
});
