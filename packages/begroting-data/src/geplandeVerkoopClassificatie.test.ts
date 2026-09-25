import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase } from "./database.js";
import { leesGeplandeVerkoopClassificatie, schrijfGeplandeVerkoopClassificatie, type GeplandeVerkoopClassificatieRegel } from "./geplandeVerkoopClassificatie.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-geplande-verkoop-classificatie-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Bewezen bronproef (2026-09, administratie 023, GL08830/00166/00167, boekjaar 2026 periode 04) — uitsluitend als testfixture. */
const KLASSIFICATIE_023: GeplandeVerkoopClassificatieRegel[] = [
  { ogbKostensoort: "3010", ogbKostensoortOmschrijving: "afwaardering ASW", component: "BOEKWAARDE_AFBOEKING" },
];

describe("schrijfGeplandeVerkoopClassificatie / leesGeplandeVerkoopClassificatie", () => {
  it("1. geen classificatie geschreven -> lege lijst, geen fout", () => {
    expect(leesGeplandeVerkoopClassificatie(db, "023")).toEqual([]);
  });

  it("2. 023-bewezen mapping: 3010 -> BOEKWAARDE_AFBOEKING", () => {
    schrijfGeplandeVerkoopClassificatie(db, "023", KLASSIFICATIE_023);
    const gelezen = leesGeplandeVerkoopClassificatie(db, "023");
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]?.component).toBe("BOEKWAARDE_AFBOEKING");
  });

  it("3. administraties blijven volledig gescheiden", () => {
    schrijfGeplandeVerkoopClassificatie(db, "023", KLASSIFICATIE_023);
    schrijfGeplandeVerkoopClassificatie(db, "013", [{ ogbKostensoort: "3010", ogbKostensoortOmschrijving: "iets anders", component: "VERKOOPOPBRENGST" }]);

    expect(leesGeplandeVerkoopClassificatie(db, "023")[0]?.component).toBe("BOEKWAARDE_AFBOEKING");
    expect(leesGeplandeVerkoopClassificatie(db, "013")[0]?.component).toBe("VERKOOPOPBRENGST");
  });

  it("4. duplicate OGB-code in dezelfde save wordt geweigerd, geen enkele mutatie uitgevoerd", () => {
    schrijfGeplandeVerkoopClassificatie(db, "023", KLASSIFICATIE_023);
    expect(() =>
      schrijfGeplandeVerkoopClassificatie(db, "023", [
        { ogbKostensoort: "3010", ogbKostensoortOmschrijving: "afwaardering ASW", component: "BOEKWAARDE_AFBOEKING" },
        { ogbKostensoort: "3010", ogbKostensoortOmschrijving: "dubbel", component: "VERKOOPOPBRENGST" },
      ]),
    ).toThrow(/meerdere keren voor in één classificatie-save/);
    expect(leesGeplandeVerkoopClassificatie(db, "023")).toEqual(KLASSIFICATIE_023);
  });

  it("5. PRIMARY KEY (bedrijfsnr, ogb_kostensoort) weigert direct SQL een tweede component voor dezelfde code", () => {
    schrijfGeplandeVerkoopClassificatie(db, "023", KLASSIFICATIE_023);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_geplande_verkoop_classificatie (bedrijfsnr, ogb_kostensoort, ogb_kostensoort_omschrijving, component) VALUES ('023', '3010', 'x', 'VERKOOPOPBRENGST')`)
        .run(),
    ).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
  });

  it("6. tweede write vervangt de eerste volledig (complete-list, geen gedeeltelijke patch)", () => {
    schrijfGeplandeVerkoopClassificatie(db, "023", KLASSIFICATIE_023);
    schrijfGeplandeVerkoopClassificatie(db, "023", [{ ogbKostensoort: "4000", ogbKostensoortOmschrijving: "Opbrengst verkoop pand", component: "VERKOOPOPBRENGST" }]);
    const gelezen = leesGeplandeVerkoopClassificatie(db, "023");
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]?.ogbKostensoort).toBe("4000");
  });

  it("7. classificatie is GEEN begrotingsversie-gebonden data — geen CONCEPT/VASTGESTELD-immutability", () => {
    expect(() => schrijfGeplandeVerkoopClassificatie(db, "023", KLASSIFICATIE_023)).not.toThrow();
    expect(leesGeplandeVerkoopClassificatie(db, "023")).toHaveLength(1);
  });
});
