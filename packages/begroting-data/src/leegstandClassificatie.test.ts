import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase } from "./database.js";
import { leesLeegstandClassificatie, schrijfLeegstandClassificatie, type LeegstandClassificatieRegel } from "./leegstandClassificatie.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-leegstand-classificatie-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Bewezen bronproef (2026-09, 070_Rooise_Zoom, GL 4350): OGB 4319 = "Servicekosten leegstand". */
const KLASSIFICATIE_070: LeegstandClassificatieRegel[] = [{ ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", categorie: "SERVICEKOSTEN_LEEGSTAND" }];

describe("schrijfLeegstandClassificatie / leesLeegstandClassificatie", () => {
  it("1. geen classificatie geschreven -> lege lijst, geen fout", () => {
    expect(leesLeegstandClassificatie(db, "070")).toEqual([]);
  });

  it("2. 070-bewezen mapping: 4319 -> SERVICEKOSTEN_LEEGSTAND", () => {
    schrijfLeegstandClassificatie(db, "070", KLASSIFICATIE_070);
    const gelezen = leesLeegstandClassificatie(db, "070");
    expect(gelezen).toHaveLength(1);
    expect(gelezen.find((r) => r.ogbKostensoort === "4319")?.categorie).toBe("SERVICEKOSTEN_LEEGSTAND");
  });

  it("3. meerdere OGB-codes mogen naar dezelfde categorie wijzen", () => {
    schrijfLeegstandClassificatie(db, "070", [
      { ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", categorie: "SERVICEKOSTEN_LEEGSTAND" },
      { ogbKostensoort: "4320", ogbKostensoortOmschrijving: "Servicekosten leegstand afrekening", categorie: "SERVICEKOSTEN_LEEGSTAND" },
    ]);
    const gelezen = leesLeegstandClassificatie(db, "070");
    expect(gelezen.filter((r) => r.categorie === "SERVICEKOSTEN_LEEGSTAND")).toHaveLength(2);
  });

  it("4. duplicate OGB-code in dezelfde save wordt geweigerd, geen enkele mutatie uitgevoerd", () => {
    schrijfLeegstandClassificatie(db, "070", KLASSIFICATIE_070);
    expect(() =>
      schrijfLeegstandClassificatie(db, "070", [
        { ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", categorie: "SERVICEKOSTEN_LEEGSTAND" },
        { ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand (dubbel)", categorie: "NUTS_LEEGSTAND" },
      ]),
    ).toThrow(/meerdere keren voor in één classificatie-save/);
    expect(leesLeegstandClassificatie(db, "070")).toEqual(KLASSIFICATIE_070);
  });

  it("5. PRIMARY KEY (bedrijfsnr, ogb_kostensoort) weigert direct SQL een tweede categorie voor dezelfde code", () => {
    schrijfLeegstandClassificatie(db, "070", KLASSIFICATIE_070);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_leegstand_classificatie (bedrijfsnr, ogb_kostensoort, ogb_kostensoort_omschrijving, categorie)
           VALUES ('070', '4319', 'Servicekosten leegstand', 'NUTS_LEEGSTAND')`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
  });

  it("6. tweede write vervangt de eerste volledig (complete-list, geen gedeeltelijke patch)", () => {
    schrijfLeegstandClassificatie(db, "070", KLASSIFICATIE_070);
    schrijfLeegstandClassificatie(db, "070", [{ ogbKostensoort: "4998", ogbKostensoortOmschrijving: "Nuts leegstand", categorie: "NUTS_LEEGSTAND" }]);
    const gelezen = leesLeegstandClassificatie(db, "070");
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]?.ogbKostensoort).toBe("4998");
  });

  it("7. classificatie is per administratie (bedrijfsnr) gescheiden, geen kruisbesmetting", () => {
    schrijfLeegstandClassificatie(db, "070", KLASSIFICATIE_070);
    schrijfLeegstandClassificatie(db, "019", [{ ogbKostensoort: "4700", ogbKostensoortOmschrijving: "Nuts leegstand", categorie: "NUTS_LEEGSTAND" }]);
    expect(leesLeegstandClassificatie(db, "070")).toEqual(KLASSIFICATIE_070);
    expect(leesLeegstandClassificatie(db, "019")).toHaveLength(1);
    expect(leesLeegstandClassificatie(db, "019")[0]?.categorie).toBe("NUTS_LEEGSTAND");
  });

  it("8. schrijven voor administratie A wijzigt administratie B niet (complete-list save is per bedrijfsnr geïsoleerd)", () => {
    schrijfLeegstandClassificatie(db, "070", KLASSIFICATIE_070);
    schrijfLeegstandClassificatie(db, "019", [{ ogbKostensoort: "4700", ogbKostensoortOmschrijving: "Nuts leegstand", categorie: "NUTS_LEEGSTAND" }]);
    schrijfLeegstandClassificatie(db, "070", []); // 070 volledig leegmaken
    expect(leesLeegstandClassificatie(db, "070")).toEqual([]);
    expect(leesLeegstandClassificatie(db, "019")).toHaveLength(1); // ongewijzigd
  });

  it("9. classificatie is GEEN begrotingsversie-gebonden data — geen CONCEPT/VASTGESTELD-immutability", () => {
    expect(() => schrijfLeegstandClassificatie(db, "070", KLASSIFICATIE_070)).not.toThrow();
    expect(leesLeegstandClassificatie(db, "070")).toHaveLength(1);
  });
});
