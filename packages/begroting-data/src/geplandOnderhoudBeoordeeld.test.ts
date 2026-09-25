import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesGeplandOnderhoudBeoordeeld, schrijfGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-gepland-onderhoud-beoordeeld-"));
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

describe("schrijfGeplandOnderhoudBeoordeeld / leesGeplandOnderhoudBeoordeeld", () => {
  it("12. geen rij -> false (geen derde/null-status)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesGeplandOnderhoudBeoordeeld(db, versie.id)).toBe(false);
  });

  it("13. beoordeeld=false round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, false);
    expect(leesGeplandOnderhoudBeoordeeld(db, versie.id)).toBe(false);
  });

  it("14. beoordeeld=true round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    expect(leesGeplandOnderhoudBeoordeeld(db, versie.id)).toBe(true);
  });

  it("andere begrotingsversie blijft onaangetast", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudBeoordeeld(db, versieA.id, true);
    expect(leesGeplandOnderhoudBeoordeeld(db, versieB.id)).toBe(false);
  });

  it("schrijven op een VASTGESTELDE versie wordt via de API geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true)).toThrow(/VASTGESTELD/);
  });

  it("25. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db.prepare(`INSERT INTO begroting_gepland_onderhoud_module (begroting_versie_id, beoordeeld) VALUES (?, 1)`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE begroting_gepland_onderhoud_module SET beoordeeld = 0 WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
    expect(() => db.prepare(`DELETE FROM begroting_gepland_onderhoud_module WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
  });

  it("CHECK weigert een ongeldige beoordeeld-waarde via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db.prepare(`INSERT INTO begroting_gepland_onderhoud_module (begroting_versie_id, beoordeeld) VALUES (?, 2)`).run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });
});
