import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import {
  leesGemeentelijkeLastenModule,
  schrijfGemeentelijkeLastenModule,
  type GemeentelijkeLastenModuleInvoer,
} from "./gemeentelijkeLastenModule.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-gemeentelijke-lasten-module-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NIEUWE_VERSIE_INPUT: NieuweBegrotingsversieInput = {
  originType: "NIEUW",
  bedrijfsnr: "070",
  begrotingsjaar: 2027,
  bronPeildatum: new Date(Date.UTC(2026, 6, 31)),
};

function invoer(overrides: Partial<GemeentelijkeLastenModuleInvoer> = {}): GemeentelijkeLastenModuleInvoer {
  return {
    werkelijkeGemeentelijkeLasten: new Decimal(12744.32),
    wozStijgingPercentage: new Decimal(10),
    lastenPercentageStijging: new Decimal(5),
    begrotingsPercentageOverride: null,
    beoordeeld: true,
    ...overrides,
  };
}

describe("schrijfGemeentelijkeLastenModule / leesGemeentelijkeLastenModule", () => {
  it("1. geen rij -> alle aannamevelden null, beoordeeld false (geen aparte derde toestand)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const gelezen = leesGemeentelijkeLastenModule(db, versie.id);
    expect(gelezen).toEqual({
      werkelijkeGemeentelijkeLasten: null,
      wozStijgingPercentage: null,
      lastenPercentageStijging: null,
      begrotingsPercentageOverride: null,
      beoordeeld: false,
    });
  });

  it("2. volledige module-invoer round-trip exact (Decimal-precisie, geen floating-point conversie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGemeentelijkeLastenModule(db, versie.id, invoer({ werkelijkeGemeentelijkeLasten: new Decimal("12744.3256789") }));

    const ruweRij = db
      .prepare(`SELECT werkelijke_gemeentelijke_lasten, typeof(werkelijke_gemeentelijke_lasten) AS lasten_type FROM begroting_gemeentelijke_lasten_module WHERE begroting_versie_id = ?`)
      .get(versie.id) as { werkelijke_gemeentelijke_lasten: string; lasten_type: string };
    expect(ruweRij.lasten_type).toBe("text");
    expect(ruweRij.werkelijke_gemeentelijke_lasten).toBe("12744.3256789");

    const gelezen = leesGemeentelijkeLastenModule(db, versie.id);
    expect(gelezen.werkelijkeGemeentelijkeLasten?.toString()).toBe("12744.3256789");
    expect(gelezen.wozStijgingPercentage?.toString()).toBe("10");
    expect(gelezen.lastenPercentageStijging?.toString()).toBe("5");
    expect(gelezen.begrotingsPercentageOverride).toBeNull();
    expect(gelezen.beoordeeld).toBe(true);
  });

  it("3. null versus expliciet Decimal(0) blijven onderscheiden voor elk aannameveld", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGemeentelijkeLastenModule(
      db,
      versie.id,
      invoer({
        werkelijkeGemeentelijkeLasten: new Decimal(0),
        wozStijgingPercentage: null,
        lastenPercentageStijging: new Decimal(0),
        begrotingsPercentageOverride: new Decimal(0),
      }),
    );
    const gelezen = leesGemeentelijkeLastenModule(db, versie.id);
    expect(gelezen.werkelijkeGemeentelijkeLasten?.toString()).toBe("0");
    expect(gelezen.wozStijgingPercentage).toBeNull();
    expect(gelezen.lastenPercentageStijging?.toString()).toBe("0");
    expect(gelezen.begrotingsPercentageOverride?.toString()).toBe("0");
  });

  it("4. beoordeeld=false round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGemeentelijkeLastenModule(db, versie.id, invoer({ beoordeeld: true }));
    schrijfGemeentelijkeLastenModule(db, versie.id, invoer({ beoordeeld: false }));
    expect(leesGemeentelijkeLastenModule(db, versie.id).beoordeeld).toBe(false);
  });

  it("5. tweede write vervangt de eerste volledig (geen gedeeltelijke patch)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGemeentelijkeLastenModule(db, versie.id, invoer({ werkelijkeGemeentelijkeLasten: new Decimal(1000), wozStijgingPercentage: new Decimal(1) }));
    schrijfGemeentelijkeLastenModule(db, versie.id, invoer({ werkelijkeGemeentelijkeLasten: new Decimal(2000), wozStijgingPercentage: null }));
    const gelezen = leesGemeentelijkeLastenModule(db, versie.id);
    expect(gelezen.werkelijkeGemeentelijkeLasten?.toString()).toBe("2000");
    expect(gelezen.wozStijgingPercentage).toBeNull();
  });

  it("6. andere begrotingsversie blijft onaangetast", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGemeentelijkeLastenModule(db, versieA.id, invoer());
    expect(leesGemeentelijkeLastenModule(db, versieB.id).beoordeeld).toBe(false);
  });

  it("7. schrijven op een VASTGESTELDE versie wordt via de API geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfGemeentelijkeLastenModule(db, versie.id, invoer())).toThrow(/VASTGESTELD/);
  });

  it("8. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGemeentelijkeLastenModule(db, versie.id, invoer());
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_gemeentelijke_lasten_module (begroting_versie_id, beoordeeld) VALUES (?, 1)`)
        .run("een-andere-versie-id"),
    ).toThrow(/immutable|FOREIGN KEY/);
    expect(() =>
      db.prepare(`UPDATE begroting_gemeentelijke_lasten_module SET beoordeeld = 0 WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_gemeentelijke_lasten_module WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
  });

  it("9. CHECK weigert een ongeldige beoordeeld-waarde via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db.prepare(`INSERT INTO begroting_gemeentelijke_lasten_module (begroting_versie_id, beoordeeld) VALUES (?, 2)`).run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });
});
