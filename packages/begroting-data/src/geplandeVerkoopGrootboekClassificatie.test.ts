import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase } from "./database.js";
import {
  leesGeplandeVerkoopGrootboekClassificatie,
  schrijfGeplandeVerkoopGrootboekClassificatie,
  type GeplandeVerkoopGrootboekClassificatieRegel,
} from "./geplandeVerkoopGrootboekClassificatie.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-geplande-verkoop-gl-classificatie-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Bewezen bronproef (2026-09, administratie 023, GL08830, boekjaar 2026 periode 04) — uitsluitend als testfixture. */
const GL_KLASSIFICATIE_023: GeplandeVerkoopGrootboekClassificatieRegel[] = [
  { grootboekrekening: "08830", grootboekOmschrijving: "Opbrengst verkoop pand", component: "VERKOOPOPBRENGST" },
];

describe("schrijfGeplandeVerkoopGrootboekClassificatie / leesGeplandeVerkoopGrootboekClassificatie", () => {
  it("1. geen classificatie geschreven -> lege lijst, geen fout", () => {
    expect(leesGeplandeVerkoopGrootboekClassificatie(db, "023")).toEqual([]);
  });

  it("2. 023-bewezen mapping: GL08830 -> VERKOOPOPBRENGST", () => {
    schrijfGeplandeVerkoopGrootboekClassificatie(db, "023", GL_KLASSIFICATIE_023);
    const gelezen = leesGeplandeVerkoopGrootboekClassificatie(db, "023");
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]?.component).toBe("VERKOOPOPBRENGST");
  });

  it("3. administraties blijven volledig gescheiden", () => {
    schrijfGeplandeVerkoopGrootboekClassificatie(db, "023", GL_KLASSIFICATIE_023);
    schrijfGeplandeVerkoopGrootboekClassificatie(db, "013", [{ grootboekrekening: "08830", grootboekOmschrijving: "iets anders", component: "BOEKWAARDE_AFBOEKING" }]);

    expect(leesGeplandeVerkoopGrootboekClassificatie(db, "023")[0]?.component).toBe("VERKOOPOPBRENGST");
    expect(leesGeplandeVerkoopGrootboekClassificatie(db, "013")[0]?.component).toBe("BOEKWAARDE_AFBOEKING");
  });

  it("4. duplicate grootboekrekening in dezelfde save wordt geweigerd, geen enkele mutatie uitgevoerd", () => {
    schrijfGeplandeVerkoopGrootboekClassificatie(db, "023", GL_KLASSIFICATIE_023);
    expect(() =>
      schrijfGeplandeVerkoopGrootboekClassificatie(db, "023", [
        { grootboekrekening: "08830", grootboekOmschrijving: "Opbrengst verkoop pand", component: "VERKOOPOPBRENGST" },
        { grootboekrekening: "08830", grootboekOmschrijving: "dubbel", component: "BOEKWAARDE_AFBOEKING" },
      ]),
    ).toThrow(/meerdere keren voor in één classificatie-save/);
    expect(leesGeplandeVerkoopGrootboekClassificatie(db, "023")).toEqual(GL_KLASSIFICATIE_023);
  });

  it("5. PRIMARY KEY (bedrijfsnr, grootboekrekening) weigert direct SQL een tweede component voor dezelfde rekening", () => {
    schrijfGeplandeVerkoopGrootboekClassificatie(db, "023", GL_KLASSIFICATIE_023);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_geplande_verkoop_grootboek_classificatie (bedrijfsnr, grootboekrekening, grootboek_omschrijving, component) VALUES ('023', '08830', 'x', 'BOEKWAARDE_AFBOEKING')`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
  });

  it("6. tweede write vervangt de eerste volledig (complete-list, geen gedeeltelijke patch)", () => {
    schrijfGeplandeVerkoopGrootboekClassificatie(db, "023", GL_KLASSIFICATIE_023);
    schrijfGeplandeVerkoopGrootboekClassificatie(db, "023", [{ grootboekrekening: "00166", grootboekOmschrijving: "ASW Driebergen", component: "BOEKWAARDE_AFBOEKING" }]);
    const gelezen = leesGeplandeVerkoopGrootboekClassificatie(db, "023");
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]?.grootboekrekening).toBe("00166");
  });

  it("7. classificatie is GEEN begrotingsversie-gebonden data — geen CONCEPT/VASTGESTELD-immutability", () => {
    expect(() => schrijfGeplandeVerkoopGrootboekClassificatie(db, "023", GL_KLASSIFICATIE_023)).not.toThrow();
    expect(leesGeplandeVerkoopGrootboekClassificatie(db, "023")).toHaveLength(1);
  });

  it("8. onafhankelijk van de OGB-classificatietabel — geen gedeelde sleutel/join", () => {
    // Losse tabel, losse PRIMARY KEY — een grootboekrekening en een OGB-kostensoort mogen toevallig
    // dezelfde tekstwaarde hebben zonder dat dit een conflict of koppeling veroorzaakt.
    schrijfGeplandeVerkoopGrootboekClassificatie(db, "023", [{ grootboekrekening: "3010", grootboekOmschrijving: "toevallig dezelfde waarde als een OGB-code", component: "VERKOOPOPBRENGST" }]);
    expect(leesGeplandeVerkoopGrootboekClassificatie(db, "023")[0]?.grootboekrekening).toBe("3010");
  });
});
