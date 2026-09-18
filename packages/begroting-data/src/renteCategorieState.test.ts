import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RENTE_CATEGORIEEN, type BgRenteCategorie } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesRenteCategorieState, schrijfRenteCategorieState, type RenteCategorieStateInvoer } from "./renteCategorieState.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-rente-categorie-state-"));
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

function alleStates(overrides: Partial<Record<BgRenteCategorie, Partial<RenteCategorieStateInvoer>>> = {}): Record<BgRenteCategorie, RenteCategorieStateInvoer> {
  return Object.fromEntries(RENTE_CATEGORIEEN.map((c) => [c, { beoordeeld: true, ...overrides[c] }])) as Record<BgRenteCategorie, RenteCategorieStateInvoer>;
}

describe("schrijfRenteCategorieState / leesRenteCategorieState", () => {
  it("1. geen rij geschreven -> beide categorieën beoordeeld=false (geen aparte derde toestand)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const gelezen = leesRenteCategorieState(db, versie.id);
    for (const categorie of RENTE_CATEGORIEEN) {
      expect(gelezen[categorie]).toEqual({ beoordeeld: false });
    }
  });

  it("2. review onafhankelijk per categorie: Rentekosten beoordeeld, Rente opbrengsten niet", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteCategorieState(db, versie.id, alleStates({ RENTEKOSTEN: { beoordeeld: true }, RENTE_OPBRENGSTEN: { beoordeeld: false } }));
    const gelezen = leesRenteCategorieState(db, versie.id);
    expect(gelezen.RENTEKOSTEN.beoordeeld).toBe(true);
    expect(gelezen.RENTE_OPBRENGSTEN.beoordeeld).toBe(false);
  });

  it("3. tweede write vervangt de eerste volledig, geen gedeeltelijke patch", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteCategorieState(db, versie.id, alleStates({ RENTEKOSTEN: { beoordeeld: true } }));
    schrijfRenteCategorieState(db, versie.id, alleStates({ RENTEKOSTEN: { beoordeeld: false } }));
    expect(leesRenteCategorieState(db, versie.id).RENTEKOSTEN.beoordeeld).toBe(false);
  });

  it("4. andere begrotingsversie blijft onaangetast", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteCategorieState(db, versieA.id, alleStates({ RENTEKOSTEN: { beoordeeld: true } }));
    expect(leesRenteCategorieState(db, versieB.id).RENTEKOSTEN.beoordeeld).toBe(false);
  });

  it("5. schrijven op een VASTGESTELDE versie wordt via de API geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfRenteCategorieState(db, versie.id, alleStates())).toThrow(/VASTGESTELD/);
  });

  it("6. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteCategorieState(db, versie.id, alleStates());
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db.prepare(`INSERT INTO begroting_rente_categorie_state (begroting_versie_id, categorie, beoordeeld) VALUES (?, 'RENTEKOSTEN', 1)`).run("een-andere-versie-id"),
    ).toThrow(/immutable|FOREIGN KEY/);
    expect(() => db.prepare(`UPDATE begroting_rente_categorie_state SET beoordeeld = 0 WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_rente_categorie_state WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
  });

  it("7. CHECK weigert een onbekende categoriewaarde via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() => db.prepare(`INSERT INTO begroting_rente_categorie_state (begroting_versie_id, categorie, beoordeeld) VALUES (?, 'ONBEKEND', 1)`).run(versie.id)).toThrow(
      /CHECK constraint failed/,
    );
  });
});
