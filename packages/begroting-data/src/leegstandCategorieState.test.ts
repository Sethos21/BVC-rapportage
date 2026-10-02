import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEEGSTAND_CATEGORIEEN, type BgLeegstandCategorie } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesLeegstandCategorieState, schrijfLeegstandCategorieState, type LeegstandCategorieStateInvoer } from "./leegstandCategorieState.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-leegstand-categorie-state-"));
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

function state(overrides: Partial<LeegstandCategorieStateInvoer> = {}): LeegstandCategorieStateInvoer {
  return {
    beoordeeld: true,
    laatstBekendServicekostenvoorschotJaar: null,
    laatstBekendServicekostenvoorschotJaarHerkomst: null,
    verwachteLeegstandsperiodeMaanden: null,
    ...overrides,
  };
}

function alleStates(
  overrides: Partial<Record<BgLeegstandCategorie, Partial<LeegstandCategorieStateInvoer>>> = {},
): Record<BgLeegstandCategorie, LeegstandCategorieStateInvoer> {
  return Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c) => [c, state(overrides[c])])) as Record<BgLeegstandCategorie, LeegstandCategorieStateInvoer>;
}

describe("schrijfLeegstandCategorieState / leesLeegstandCategorieState", () => {
  it("1. geen rij geschreven -> alle drie categorieën beoordeeld=false, rekenhulp null (geen aparte derde toestand)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const gelezen = leesLeegstandCategorieState(db, versie.id);
    for (const categorie of LEEGSTAND_CATEGORIEEN) {
      expect(gelezen[categorie]).toEqual({
        beoordeeld: false,
        laatstBekendServicekostenvoorschotJaar: null,
        laatstBekendServicekostenvoorschotJaarHerkomst: null,
        verwachteLeegstandsperiodeMaanden: null,
      });
    }
  });

  it("2. review onafhankelijk per categorie: Servicekosten leegstand beoordeeld, Nuts leegstand niet", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandCategorieState(db, versie.id, alleStates({ SERVICEKOSTEN_LEEGSTAND: { beoordeeld: true }, NUTS_LEEGSTAND: { beoordeeld: false } }));
    const gelezen = leesLeegstandCategorieState(db, versie.id);
    expect(gelezen.SERVICEKOSTEN_LEEGSTAND.beoordeeld).toBe(true);
    expect(gelezen.NUTS_LEEGSTAND.beoordeeld).toBe(false);
  });

  it("3. rekenhulp round-trip exact (Decimal-precisie, geen floating-point conversie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandCategorieState(
      db,
      versie.id,
      alleStates({ SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal("21600.3256789"), verwachteLeegstandsperiodeMaanden: new Decimal("4.5") } }),
    );

    const ruweRij = db
      .prepare(
        `SELECT laatst_bekend_servicekostenvoorschot_jaar, typeof(laatst_bekend_servicekostenvoorschot_jaar) AS bedrag_type FROM begroting_leegstand_categorie_state WHERE begroting_versie_id = ? AND categorie = 'SERVICEKOSTEN_LEEGSTAND'`,
      )
      .get(versie.id) as { laatst_bekend_servicekostenvoorschot_jaar: string; bedrag_type: string };
    expect(ruweRij.bedrag_type).toBe("text");
    expect(ruweRij.laatst_bekend_servicekostenvoorschot_jaar).toBe("21600.3256789");

    const gelezen = leesLeegstandCategorieState(db, versie.id);
    expect(gelezen.SERVICEKOSTEN_LEEGSTAND.laatstBekendServicekostenvoorschotJaar?.toString()).toBe("21600.3256789");
    expect(gelezen.SERVICEKOSTEN_LEEGSTAND.verwachteLeegstandsperiodeMaanden?.toString()).toBe("4.5");
  });

  it("3b. herkomst BRON versus HANDMATIG round-trippen exact, null blijft null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandCategorieState(
      db,
      versie.id,
      alleStates({
        SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(21600), laatstBekendServicekostenvoorschotJaarHerkomst: "BRON" },
        NUTS_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(500), laatstBekendServicekostenvoorschotJaarHerkomst: "HANDMATIG" },
      }),
    );
    const gelezen = leesLeegstandCategorieState(db, versie.id);
    expect(gelezen.SERVICEKOSTEN_LEEGSTAND.laatstBekendServicekostenvoorschotJaarHerkomst).toBe("BRON");
    expect(gelezen.NUTS_LEEGSTAND.laatstBekendServicekostenvoorschotJaarHerkomst).toBe("HANDMATIG");
    expect(gelezen.OVERIGE_LEEGSTANDSKOSTEN.laatstBekendServicekostenvoorschotJaarHerkomst).toBeNull();
  });

  it("4. null versus expliciet Decimal(0) blijven onderscheiden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandCategorieState(
      db,
      versie.id,
      alleStates({
        SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(0), verwachteLeegstandsperiodeMaanden: null },
        NUTS_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: null, verwachteLeegstandsperiodeMaanden: new Decimal(0) },
      }),
    );
    const gelezen = leesLeegstandCategorieState(db, versie.id);
    expect(gelezen.SERVICEKOSTEN_LEEGSTAND.laatstBekendServicekostenvoorschotJaar?.toString()).toBe("0");
    expect(gelezen.SERVICEKOSTEN_LEEGSTAND.verwachteLeegstandsperiodeMaanden).toBeNull();
    expect(gelezen.NUTS_LEEGSTAND.laatstBekendServicekostenvoorschotJaar).toBeNull();
    expect(gelezen.NUTS_LEEGSTAND.verwachteLeegstandsperiodeMaanden?.toString()).toBe("0");
  });

  it("5. tweede write vervangt de eerste volledig, geen gedeeltelijke patch", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandCategorieState(db, versie.id, alleStates({ SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(1000) } }));
    schrijfLeegstandCategorieState(db, versie.id, alleStates({ SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: null } }));
    expect(leesLeegstandCategorieState(db, versie.id).SERVICEKOSTEN_LEEGSTAND.laatstBekendServicekostenvoorschotJaar).toBeNull();
  });

  it("6. andere begrotingsversie blijft onaangetast", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandCategorieState(db, versieA.id, alleStates({ SERVICEKOSTEN_LEEGSTAND: { beoordeeld: true } }));
    expect(leesLeegstandCategorieState(db, versieB.id).SERVICEKOSTEN_LEEGSTAND.beoordeeld).toBe(false);
  });

  it("7. schrijven op een VASTGESTELDE versie wordt via de API geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfLeegstandCategorieState(db, versie.id, alleStates())).toThrow(/VASTGESTELD/);
  });

  it("8. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandCategorieState(db, versie.id, alleStates());
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_leegstand_categorie_state (begroting_versie_id, categorie, beoordeeld) VALUES (?, 'SERVICEKOSTEN_LEEGSTAND', 1)`)
        .run("een-andere-versie-id"),
    ).toThrow(/immutable|FOREIGN KEY/);
    expect(() => db.prepare(`UPDATE begroting_leegstand_categorie_state SET beoordeeld = 0 WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_leegstand_categorie_state WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
  });

  it("9. CHECK weigert een onbekende categoriewaarde via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db.prepare(`INSERT INTO begroting_leegstand_categorie_state (begroting_versie_id, categorie, beoordeeld) VALUES (?, 'ONBEKEND', 1)`).run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("10. CHECK weigert een onbekende herkomstwaarde via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_leegstand_categorie_state (begroting_versie_id, categorie, beoordeeld, laatst_bekend_servicekostenvoorschot_jaar_herkomst) VALUES (?, 'SERVICEKOSTEN_LEEGSTAND', 1, 'GERAADEN')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });
});
