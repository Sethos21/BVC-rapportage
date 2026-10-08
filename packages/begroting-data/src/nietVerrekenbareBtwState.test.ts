import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase } from "./database.js";
import { leesNietVerrekenbareBtwState, schrijfNietVerrekenbareBtwState } from "./nietVerrekenbareBtwState.js";
import { maakBegrotingsversie } from "./begrotingsversies.js";
import { markeerVastgesteld } from "./begrotingsversies.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-btw-state-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("nietVerrekenbareBtwState", () => {
  it("10. geen rij -> lege staat (beoordeeld=false, vorigJaarWerkelijk=null), nooit een default €0-suggestie", () => {
    const v = maakBegrotingsversie(db, { bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date("2026-07-31"), originType: "NIEUW" });
    expect(leesNietVerrekenbareBtwState(db, v.id)).toEqual({ beoordeeld: false, vorigJaarWerkelijk: null });
  });

  it("schrijft en leest de complete staat terug", () => {
    const v = maakBegrotingsversie(db, { bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date("2026-07-31"), originType: "NIEUW" });
    schrijfNietVerrekenbareBtwState(db, v.id, { beoordeeld: true, vorigJaarWerkelijk: new Decimal("5432.10") });
    expect(leesNietVerrekenbareBtwState(db, v.id)).toEqual({ beoordeeld: true, vorigJaarWerkelijk: new Decimal("5432.10") });
  });

  it("17. mag uitsluitend op CONCEPT worden geschreven — vastgestelde Begroting blijft immutable", () => {
    const v = maakBegrotingsversie(db, { bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date("2026-07-31"), originType: "NIEUW" });
    schrijfNietVerrekenbareBtwState(db, v.id, { beoordeeld: true, vorigJaarWerkelijk: null });
    markeerVastgesteld(db, v.id, new Date("2026-09-29T00:00:00.000Z"));
    expect(() => schrijfNietVerrekenbareBtwState(db, v.id, { beoordeeld: true, vorigJaarWerkelijk: new Decimal("1") })).toThrow(/VASTGESTELD/);
  });

  it("faalt op een niet-bestaande versie", () => {
    expect(() => schrijfNietVerrekenbareBtwState(db, "onbekend", { beoordeeld: true, vorigJaarWerkelijk: null })).toThrow(/bestaat niet/);
  });

  it("faalt op een NaN vorigJaarWerkelijk", () => {
    const v = maakBegrotingsversie(db, { bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date("2026-07-31"), originType: "NIEUW" });
    expect(() => schrijfNietVerrekenbareBtwState(db, v.id, { beoordeeld: true, vorigJaarWerkelijk: new Decimal(NaN) })).toThrow(/NaN/);
  });
});
