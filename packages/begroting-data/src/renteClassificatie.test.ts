import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase } from "./database.js";
import { leesRenteClassificatie, schrijfRenteClassificatie, type RenteClassificatieRegel } from "./renteClassificatie.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-rente-classificatie-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Bewezen bronproef (2026-09, administratie 023, GL 4600, boekjaar 2025) — uitsluitend als testfixture. */
const KLASSIFICATIE_023: RenteClassificatieRegel[] = [
  { ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", categorie: "RENTEKOSTEN" },
  { ogbKostensoort: "4606", ogbKostensoortOmschrijving: "rente lening 747", categorie: "RENTEKOSTEN" },
];

describe("schrijfRenteClassificatie / leesRenteClassificatie", () => {
  it("1. geen classificatie geschreven -> lege lijst, geen fout", () => {
    expect(leesRenteClassificatie(db, "023")).toEqual([]);
  });

  it("2. 023-bewezen mapping: 4601/4606 -> RENTEKOSTEN", () => {
    schrijfRenteClassificatie(db, "023", KLASSIFICATIE_023);
    const gelezen = leesRenteClassificatie(db, "023");
    expect(gelezen).toHaveLength(2);
    expect(gelezen.find((r) => r.ogbKostensoort === "4601")?.categorie).toBe("RENTEKOSTEN");
  });

  it("3. dezelfde OGB-code betekent bij een andere administratie iets anders — administraties blijven volledig gescheiden", () => {
    schrijfRenteClassificatie(db, "023", [{ ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente lening .500", categorie: "RENTEKOSTEN" }]);
    schrijfRenteClassificatie(db, "013", [{ ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente r/c", categorie: "RENTE_OPBRENGSTEN" }]);

    expect(leesRenteClassificatie(db, "023")[0]?.categorie).toBe("RENTEKOSTEN");
    expect(leesRenteClassificatie(db, "013")[0]?.categorie).toBe("RENTE_OPBRENGSTEN");
  });

  it("4. duplicate OGB-code in dezelfde save wordt geweigerd, geen enkele mutatie uitgevoerd", () => {
    schrijfRenteClassificatie(db, "023", KLASSIFICATIE_023);
    expect(() =>
      schrijfRenteClassificatie(db, "023", [
        { ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", categorie: "RENTEKOSTEN" },
        { ogbKostensoort: "4601", ogbKostensoortOmschrijving: "dubbel", categorie: "RENTE_OPBRENGSTEN" },
      ]),
    ).toThrow(/meerdere keren voor in één classificatie-save/);
    expect(leesRenteClassificatie(db, "023")).toEqual(KLASSIFICATIE_023);
  });

  it("5. PRIMARY KEY (bedrijfsnr, ogb_kostensoort) weigert direct SQL een tweede categorie voor dezelfde code", () => {
    schrijfRenteClassificatie(db, "023", KLASSIFICATIE_023);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_rente_classificatie (bedrijfsnr, ogb_kostensoort, ogb_kostensoort_omschrijving, categorie) VALUES ('023', '4601', 'x', 'RENTE_OPBRENGSTEN')`)
        .run(),
    ).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
  });

  it("6. tweede write vervangt de eerste volledig (complete-list, geen gedeeltelijke patch)", () => {
    schrijfRenteClassificatie(db, "023", KLASSIFICATIE_023);
    schrijfRenteClassificatie(db, "023", [{ ogbKostensoort: "4602", ogbKostensoortOmschrijving: "Rente en Provisie ING R/C", categorie: "RENTEKOSTEN" }]);
    const gelezen = leesRenteClassificatie(db, "023");
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]?.ogbKostensoort).toBe("4602");
  });

  it("7. classificatie is GEEN begrotingsversie-gebonden data — geen CONCEPT/VASTGESTELD-immutability", () => {
    expect(() => schrijfRenteClassificatie(db, "023", KLASSIFICATIE_023)).not.toThrow();
    expect(leesRenteClassificatie(db, "023")).toHaveLength(2);
  });
});
