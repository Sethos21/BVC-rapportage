import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALGEMENE_KOSTEN_CATEGORIEEN, type BgAlgemeneKostenCategorie } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import {
  leesAlgemeneKostenCategorieState,
  schrijfAlgemeneKostenCategorieState,
  type AlgemeneKostenCategorieStateInvoer,
} from "./algemeneKostenCategorieState.js";
import { openOrCreateDatabase } from "./database.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-algemene-kosten-categorie-state-"));
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

function state(overrides: Partial<AlgemeneKostenCategorieStateInvoer> = {}): AlgemeneKostenCategorieStateInvoer {
  return { beoordeeld: true, vorigJaarBedrag: null, verwachteVerhogingPercentage: null, ...overrides };
}

function alleStates(
  overrides: Partial<Record<BgAlgemeneKostenCategorie, Partial<AlgemeneKostenCategorieStateInvoer>>> = {},
): Record<BgAlgemeneKostenCategorie, AlgemeneKostenCategorieStateInvoer> {
  return Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, state(overrides[c])])) as Record<
    BgAlgemeneKostenCategorie,
    AlgemeneKostenCategorieStateInvoer
  >;
}

describe("schrijfAlgemeneKostenCategorieState / leesAlgemeneKostenCategorieState", () => {
  it("1. geen rij geschreven -> alle vijf categorieën beoordeeld=false, rekenhulp null (geen aparte derde toestand)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const gelezen = leesAlgemeneKostenCategorieState(db, versie.id);
    for (const categorie of ALGEMENE_KOSTEN_CATEGORIEEN) {
      expect(gelezen[categorie]).toEqual({ beoordeeld: false, vorigJaarBedrag: null, verwachteVerhogingPercentage: null });
    }
  });

  it("2. review onafhankelijk per categorie: Accountant beoordeeld, Juridisch niet", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenCategorieState(db, versie.id, alleStates({ ACCOUNTANT: { beoordeeld: true }, JURIDISCHE_KOSTEN: { beoordeeld: false } }));
    const gelezen = leesAlgemeneKostenCategorieState(db, versie.id);
    expect(gelezen.ACCOUNTANT.beoordeeld).toBe(true);
    expect(gelezen.JURIDISCHE_KOSTEN.beoordeeld).toBe(false);
  });

  it("3. rekenhulp round-trip exact (Decimal-precisie, geen floating-point conversie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenCategorieState(
      db,
      versie.id,
      alleStates({ ACCOUNTANT: { vorigJaarBedrag: new Decimal("7550.3256789"), verwachteVerhogingPercentage: new Decimal("2.125") } }),
    );

    const ruweRij = db
      .prepare(
        `SELECT vorig_jaar_bedrag, typeof(vorig_jaar_bedrag) AS bedrag_type FROM begroting_algemene_kosten_categorie_state WHERE begroting_versie_id = ? AND categorie = 'ACCOUNTANT'`,
      )
      .get(versie.id) as { vorig_jaar_bedrag: string; bedrag_type: string };
    expect(ruweRij.bedrag_type).toBe("text");
    expect(ruweRij.vorig_jaar_bedrag).toBe("7550.3256789");

    const gelezen = leesAlgemeneKostenCategorieState(db, versie.id);
    expect(gelezen.ACCOUNTANT.vorigJaarBedrag?.toString()).toBe("7550.3256789");
    expect(gelezen.ACCOUNTANT.verwachteVerhogingPercentage?.toString()).toBe("2.125");
  });

  it("4. null versus expliciet Decimal(0) blijven onderscheiden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenCategorieState(
      db,
      versie.id,
      alleStates({
        ACCOUNTANT: { vorigJaarBedrag: new Decimal(0), verwachteVerhogingPercentage: null },
        BANKKOSTEN: { vorigJaarBedrag: null, verwachteVerhogingPercentage: new Decimal(0) },
      }),
    );
    const gelezen = leesAlgemeneKostenCategorieState(db, versie.id);
    expect(gelezen.ACCOUNTANT.vorigJaarBedrag?.toString()).toBe("0");
    expect(gelezen.ACCOUNTANT.verwachteVerhogingPercentage).toBeNull();
    expect(gelezen.BANKKOSTEN.vorigJaarBedrag).toBeNull();
    expect(gelezen.BANKKOSTEN.verwachteVerhogingPercentage?.toString()).toBe("0");
  });

  it("5. tweede write vervangt de eerste volledig, geen gedeeltelijke patch", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenCategorieState(db, versie.id, alleStates({ ACCOUNTANT: { vorigJaarBedrag: new Decimal(1000) } }));
    schrijfAlgemeneKostenCategorieState(db, versie.id, alleStates({ ACCOUNTANT: { vorigJaarBedrag: null } }));
    expect(leesAlgemeneKostenCategorieState(db, versie.id).ACCOUNTANT.vorigJaarBedrag).toBeNull();
  });

  it("6. andere begrotingsversie blijft onaangetast", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenCategorieState(db, versieA.id, alleStates({ ACCOUNTANT: { beoordeeld: true } }));
    expect(leesAlgemeneKostenCategorieState(db, versieB.id).ACCOUNTANT.beoordeeld).toBe(false);
  });

  it("7. schrijven op een VASTGESTELDE versie wordt via de API geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfAlgemeneKostenCategorieState(db, versie.id, alleStates())).toThrow(/VASTGESTELD/);
  });

  it("8. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenCategorieState(db, versie.id, alleStates());
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_algemene_kosten_categorie_state (begroting_versie_id, categorie, beoordeeld) VALUES (?, 'ACCOUNTANT', 1)`)
        .run("een-andere-versie-id"),
    ).toThrow(/immutable|FOREIGN KEY/);
    expect(() =>
      db.prepare(`UPDATE begroting_algemene_kosten_categorie_state SET beoordeeld = 0 WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_algemene_kosten_categorie_state WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
  });

  it("9. CHECK weigert een onbekende categoriewaarde via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_algemene_kosten_categorie_state (begroting_versie_id, categorie, beoordeeld) VALUES (?, 'ONBEKEND', 1)`)
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });
});
