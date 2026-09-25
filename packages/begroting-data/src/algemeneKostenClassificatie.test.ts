import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase } from "./database.js";
import {
  leesAlgemeneKostenClassificatie,
  schrijfAlgemeneKostenClassificatie,
  type AlgemeneKostenClassificatieRegel,
} from "./algemeneKostenClassificatie.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-algemene-kosten-classificatie-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const KLASSIFICATIE_070: AlgemeneKostenClassificatieRegel[] = [
  { ogbKostensoort: "4990", ogbKostensoortOmschrijving: "Diverse alg kosten", categorie: "ALGEMENE_KOSTEN" },
  { ogbKostensoort: "4992", ogbKostensoortOmschrijving: "makelaarskosten", categorie: "MAKELAARSKOSTEN" },
  { ogbKostensoort: "4995", ogbKostensoortOmschrijving: "Bankkosten", categorie: "BANKKOSTEN" },
];

describe("schrijfAlgemeneKostenClassificatie / leesAlgemeneKostenClassificatie", () => {
  it("1. geen classificatie geschreven -> lege lijst, geen fout", () => {
    expect(leesAlgemeneKostenClassificatie(db, "070")).toEqual([]);
  });

  it("2. 070-bewezen mapping: 4990 -> ALGEMENE_KOSTEN, 4992 -> MAKELAARSKOSTEN, 4995 -> BANKKOSTEN", () => {
    schrijfAlgemeneKostenClassificatie(db, "070", KLASSIFICATIE_070);
    const gelezen = leesAlgemeneKostenClassificatie(db, "070");
    expect(gelezen).toHaveLength(3);
    expect(gelezen.find((r) => r.ogbKostensoort === "4990")?.categorie).toBe("ALGEMENE_KOSTEN");
    expect(gelezen.find((r) => r.ogbKostensoort === "4992")?.categorie).toBe("MAKELAARSKOSTEN");
    expect(gelezen.find((r) => r.ogbKostensoort === "4995")?.categorie).toBe("BANKKOSTEN");
  });

  it("3. OGB 4991 (Afronding/betalingsversch) blijft ongeclassificeerd als hij niet wordt geschreven", () => {
    schrijfAlgemeneKostenClassificatie(db, "070", KLASSIFICATIE_070);
    const gelezen = leesAlgemeneKostenClassificatie(db, "070");
    expect(gelezen.some((r) => r.ogbKostensoort === "4991")).toBe(false);
  });

  it("4. meerdere OGB-codes mogen naar dezelfde categorie wijzen", () => {
    schrijfAlgemeneKostenClassificatie(db, "070", [
      { ogbKostensoort: "4990", ogbKostensoortOmschrijving: "Diverse alg kosten", categorie: "ALGEMENE_KOSTEN" },
      { ogbKostensoort: "4993", ogbKostensoortOmschrijving: "Kantoorbenodigdheden", categorie: "ALGEMENE_KOSTEN" },
    ]);
    const gelezen = leesAlgemeneKostenClassificatie(db, "070");
    expect(gelezen.filter((r) => r.categorie === "ALGEMENE_KOSTEN")).toHaveLength(2);
  });

  it("5. duplicate OGB-code in dezelfde save wordt geweigerd, geen enkele mutatie uitgevoerd", () => {
    schrijfAlgemeneKostenClassificatie(db, "070", KLASSIFICATIE_070);
    expect(() =>
      schrijfAlgemeneKostenClassificatie(db, "070", [
        { ogbKostensoort: "4990", ogbKostensoortOmschrijving: "Diverse alg kosten", categorie: "ALGEMENE_KOSTEN" },
        { ogbKostensoort: "4990", ogbKostensoortOmschrijving: "Diverse alg kosten (dubbel)", categorie: "BANKKOSTEN" },
      ]),
    ).toThrow(/meerdere keren voor in één classificatie-save/);
    // Origineel blijft ongewijzigd — geen enkele mutatie, ook niet van de eerdere geldige save.
    expect(leesAlgemeneKostenClassificatie(db, "070")).toEqual(KLASSIFICATIE_070);
  });

  it("6. PRIMARY KEY (bedrijfsnr, ogb_kostensoort) weigert direct SQL een tweede categorie voor dezelfde code", () => {
    schrijfAlgemeneKostenClassificatie(db, "070", KLASSIFICATIE_070);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_algemene_kosten_classificatie (bedrijfsnr, ogb_kostensoort, ogb_kostensoort_omschrijving, categorie)
           VALUES ('070', '4990', 'Diverse alg kosten', 'BANKKOSTEN')`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
  });

  it("7. tweede write vervangt de eerste volledig (complete-list, geen gedeeltelijke patch)", () => {
    schrijfAlgemeneKostenClassificatie(db, "070", KLASSIFICATIE_070);
    schrijfAlgemeneKostenClassificatie(db, "070", [
      { ogbKostensoort: "4995", ogbKostensoortOmschrijving: "Bankkosten", categorie: "BANKKOSTEN" },
    ]);
    const gelezen = leesAlgemeneKostenClassificatie(db, "070");
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]?.ogbKostensoort).toBe("4995");
  });

  it("8. classificatie is per administratie (bedrijfsnr) gescheiden, geen kruisbesmetting", () => {
    schrijfAlgemeneKostenClassificatie(db, "070", KLASSIFICATIE_070);
    schrijfAlgemeneKostenClassificatie(db, "019", [
      { ogbKostensoort: "04900", ogbKostensoortOmschrijving: "Accountantskosten", categorie: "ACCOUNTANT" },
    ]);
    expect(leesAlgemeneKostenClassificatie(db, "070")).toEqual(KLASSIFICATIE_070);
    expect(leesAlgemeneKostenClassificatie(db, "019")).toHaveLength(1);
    expect(leesAlgemeneKostenClassificatie(db, "019")[0]?.categorie).toBe("ACCOUNTANT");
  });

  it("9. schrijven voor administratie A wijzigt administratie B niet (complete-list save is per bedrijfsnr geïsoleerd)", () => {
    schrijfAlgemeneKostenClassificatie(db, "070", KLASSIFICATIE_070);
    schrijfAlgemeneKostenClassificatie(db, "019", [
      { ogbKostensoort: "04900", ogbKostensoortOmschrijving: "Accountantskosten", categorie: "ACCOUNTANT" },
    ]);
    schrijfAlgemeneKostenClassificatie(db, "070", []); // 070 volledig leegmaken
    expect(leesAlgemeneKostenClassificatie(db, "070")).toEqual([]);
    expect(leesAlgemeneKostenClassificatie(db, "019")).toHaveLength(1); // ongewijzigd
  });

  it("10. classificatie is GEEN begrotingsversie-gebonden data — geen CONCEPT/VASTGESTELD-immutability", () => {
    // Bewust geen begroting_versie_id-kolom op deze tabel — de schrijffunctie vraagt er ook geen om.
    // Bewijs: schrijven/lezen werkt zonder ooit een begrotingsversie aan te maken.
    expect(() => schrijfAlgemeneKostenClassificatie(db, "070", KLASSIFICATIE_070)).not.toThrow();
    expect(leesAlgemeneKostenClassificatie(db, "070")).toHaveLength(3);
  });
});
