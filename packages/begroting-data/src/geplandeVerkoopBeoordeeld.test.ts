import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesGeplandeVerkoopBeoordeeld, schrijfGeplandeVerkoopBeoordeeld } from "./geplandeVerkoopBeoordeeld.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-geplande-verkoop-beoordeeld-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NIEUWE_VERSIE_INPUT: NieuweBegrotingsversieInput = {
  originType: "NIEUW",
  bedrijfsnr: "023",
  begrotingsjaar: 2027,
  bronPeildatum: new Date(Date.UTC(2026, 6, 31)),
};

describe("schrijfGeplandeVerkoopBeoordeeld / leesGeplandeVerkoopBeoordeeld", () => {
  it("1. geen rij -> false (geen derde/null-status)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesGeplandeVerkoopBeoordeeld(db, versie.id)).toBe(false);
  });

  it("2. beoordeeld=false round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopBeoordeeld(db, versie.id, true);
    schrijfGeplandeVerkoopBeoordeeld(db, versie.id, false);
    expect(leesGeplandeVerkoopBeoordeeld(db, versie.id)).toBe(false);
  });

  it("3. beoordeeld=true round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopBeoordeeld(db, versie.id, true);
    expect(leesGeplandeVerkoopBeoordeeld(db, versie.id)).toBe(true);
  });

  it("4. andere begrotingsversie blijft onaangetast", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopBeoordeeld(db, versieA.id, true);
    expect(leesGeplandeVerkoopBeoordeeld(db, versieB.id)).toBe(false);
  });

  it("5. schrijven op een VASTGESTELDE versie wordt via de API geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfGeplandeVerkoopBeoordeeld(db, versie.id, true)).toThrow(/VASTGESTELD/);
  });

  it("6. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopBeoordeeld(db, versie.id, true);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => db.prepare(`INSERT INTO begroting_geplande_verkoop_module (begroting_versie_id, beoordeeld) VALUES (?, 1)`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE begroting_geplande_verkoop_module SET beoordeeld = 0 WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_geplande_verkoop_module WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
  });

  it("7. CHECK weigert een ongeldige beoordeeld-waarde via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() => db.prepare(`INSERT INTO begroting_geplande_verkoop_module (begroting_versie_id, beoordeeld) VALUES (?, 2)`).run(versie.id)).toThrow(/CHECK constraint failed/);
  });
});
