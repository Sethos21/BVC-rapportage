import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BgManagementInvoer } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesModule3Invoer, schrijfModule3Invoer } from "./module3Invoer.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-module3-"));
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

const INDEXEER: BgManagementInvoer = {
  wijze: "INDEXEER_BESTAAND",
  bestaandBedrag: new Decimal(1000),
  eenheid: "MAAND",
  indexatiePercentage: new Decimal(3),
  indexatiedatum: new Date(Date.UTC(2027, 6, 1)),
};

const WIJZIG: BgManagementInvoer = {
  wijze: "WIJZIG_BESTAAND_BEDRAG",
  bestaandBedrag: new Decimal(1000),
  bestaandEenheid: "MAAND",
  nieuwBedrag: new Decimal(1200),
  nieuweEenheid: "MAAND",
  ingangsdatum: new Date(Date.UTC(2027, 6, 1)),
};

const NIEUWE_VERGOEDING_MET_DATUM: BgManagementInvoer = {
  wijze: "NIEUWE_VERGOEDING",
  bedrag: new Decimal(1200),
  eenheid: "MAAND",
  ingangsdatum: new Date(Date.UTC(2027, 6, 1)),
};

const NIEUWE_VERGOEDING_ZONDER_DATUM: BgManagementInvoer = {
  wijze: "NIEUWE_VERGOEDING",
  bedrag: new Decimal(14400),
  eenheid: "JAAR",
  ingangsdatum: null,
};

describe("schrijfModule3Invoer / leesModule3Invoer", () => {
  it("1. roundtrip INDEXEER_BESTAAND", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule3Invoer(db, versie.id, INDEXEER);
    expect(leesModule3Invoer(db, versie.id)).toEqual(INDEXEER);
  });

  it("2. roundtrip WIJZIG_BESTAAND_BEDRAG", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule3Invoer(db, versie.id, WIJZIG);
    expect(leesModule3Invoer(db, versie.id)).toEqual(WIJZIG);
  });

  it("3. roundtrip NIEUWE_VERGOEDING met ingangsdatum", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule3Invoer(db, versie.id, NIEUWE_VERGOEDING_MET_DATUM);
    expect(leesModule3Invoer(db, versie.id)).toEqual(NIEUWE_VERGOEDING_MET_DATUM);
  });

  it("4. roundtrip NIEUWE_VERGOEDING met ingangsdatum: null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule3Invoer(db, versie.id, NIEUWE_VERGOEDING_ZONDER_DATUM);
    const gelezen = leesModule3Invoer(db, versie.id);
    expect(gelezen).toEqual(NIEUWE_VERGOEDING_ZONDER_DATUM);
    expect(gelezen && "ingangsdatum" in gelezen ? gelezen.ingangsdatum : undefined).toBeNull();
  });

  it("5. Decimal TEXT round-trip zonder number-conversie (meer precisie dan 2 decimalen, negatief indexatiepercentage toegestaan)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const invoer: BgManagementInvoer = {
      wijze: "INDEXEER_BESTAAND",
      bestaandBedrag: new Decimal("833.333333"),
      eenheid: "MAAND",
      indexatiePercentage: new Decimal(-1.5),
      indexatiedatum: new Date(Date.UTC(2027, 6, 1)),
    };
    schrijfModule3Invoer(db, versie.id, invoer);

    const ruweRij = db
      .prepare(
        `SELECT bestaand_bedrag, typeof(bestaand_bedrag) AS bestaand_bedrag_type, indexatie_percentage, typeof(indexatie_percentage) AS indexatie_percentage_type
         FROM begroting_management_invoer WHERE begroting_versie_id = ?`,
      )
      .get(versie.id) as { bestaand_bedrag: string; bestaand_bedrag_type: string; indexatie_percentage: string; indexatie_percentage_type: string };
    expect(ruweRij.bestaand_bedrag_type).toBe("text");
    expect(ruweRij.bestaand_bedrag).toBe("833.333333");
    expect(ruweRij.indexatie_percentage_type).toBe("text");
    expect(ruweRij.indexatie_percentage).toBe("-1.5");

    const gelezen = leesModule3Invoer(db, versie.id) as BgManagementInvoer & { wijze: "INDEXEER_BESTAAND" };
    expect(gelezen.bestaandBedrag.toString()).toBe("833.333333");
    expect(gelezen.indexatiePercentage.toString()).toBe("-1.5");
  });

  it("6. business-date exactheid — kale YYYY-MM-DD, geen tijdstip-component", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule3Invoer(db, versie.id, WIJZIG);

    const ruweRij = db.prepare(`SELECT ingangsdatum FROM begroting_management_invoer WHERE begroting_versie_id = ?`).get(versie.id) as {
      ingangsdatum: string;
    };
    expect(ruweRij.ingangsdatum).toBe("2027-07-01");

    const gelezen = leesModule3Invoer(db, versie.id) as BgManagementInvoer & { wijze: "WIJZIG_BESTAAND_BEDRAG" };
    expect(gelezen.ingangsdatum.toISOString()).toBe(new Date(Date.UTC(2027, 6, 1)).toISOString());
  });

  it("7. expliciet bedrag €0 blijft €0 (een echte rekenwaarde, geen KRITIEK/fout)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const nulInvoer: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(0), eenheid: "MAAND", ingangsdatum: null };
    schrijfModule3Invoer(db, versie.id, nulInvoer);

    const gelezen = leesModule3Invoer(db, versie.id) as BgManagementInvoer & { wijze: "NIEUWE_VERGOEDING" };
    expect(gelezen.bedrag.toString()).toBe("0");
    expect(gelezen.bedrag.isZero()).toBe(true);
  });

  it("8. geen rij → read retourneert expliciet null (nooit €0/een default-invoer)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesModule3Invoer(db, versie.id)).toBeNull();
  });

  it("9. vervangen van bestaande input in CONCEPT — andere wijze overschrijft volledig, oude kolommen worden NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule3Invoer(db, versie.id, INDEXEER);
    schrijfModule3Invoer(db, versie.id, NIEUWE_VERGOEDING_ZONDER_DATUM);

    expect(leesModule3Invoer(db, versie.id)).toEqual(NIEUWE_VERGOEDING_ZONDER_DATUM);

    const ruweRij = db
      .prepare(`SELECT indexatie_percentage, indexatiedatum, bestaand_bedrag, bestaand_eenheid FROM begroting_management_invoer WHERE begroting_versie_id = ?`)
      .get(versie.id) as { indexatie_percentage: string | null; indexatiedatum: string | null; bestaand_bedrag: string | null; bestaand_eenheid: string | null };
    expect(ruweRij.indexatie_percentage).toBeNull();
    expect(ruweRij.indexatiedatum).toBeNull();
    expect(ruweRij.bestaand_bedrag).toBeNull();
    expect(ruweRij.bestaand_eenheid).toBeNull();

    const rijen = db.prepare(`SELECT COUNT(*) AS aantal FROM begroting_management_invoer WHERE begroting_versie_id = ?`).get(versie.id) as {
      aantal: number;
    };
    expect(rijen.aantal).toBe(1);
  });

  it("10. schrijven op een VASTGESTELDE versie wordt via de API geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfModule3Invoer(db, versie.id, INDEXEER)).toThrow(/VASTGESTELD/);
  });

  it("11. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule3Invoer(db, versie.id, INDEXEER);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_management_invoer (begroting_versie_id, wijze, nieuw_bedrag, nieuwe_eenheid) VALUES (?, 'NIEUWE_VERGOEDING', '1', 'MAAND')`,
        )
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`UPDATE begroting_management_invoer SET bestaand_bedrag = '999' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_management_invoer WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
  });

  it("12a. CHECK weigert INDEXEER_BESTAAND met een verplichte kolom NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_management_invoer
             (begroting_versie_id, wijze, bestaand_bedrag, bestaand_eenheid, indexatie_percentage, indexatiedatum)
           VALUES (?, 'INDEXEER_BESTAAND', '1000', 'MAAND', '3', NULL)`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("12b. CHECK weigert WIJZIG_BESTAAND_BEDRAG met een niet-toegestane kolom gevuld (indexatie_percentage)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_management_invoer
             (begroting_versie_id, wijze, bestaand_bedrag, bestaand_eenheid, nieuw_bedrag, nieuwe_eenheid, ingangsdatum, indexatie_percentage)
           VALUES (?, 'WIJZIG_BESTAAND_BEDRAG', '1000', 'MAAND', '1200', 'MAAND', '2027-07-01', '3')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("12c. CHECK weigert NIEUWE_VERGOEDING met een niet-toegestane kolom gevuld (bestaand_bedrag)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_management_invoer
             (begroting_versie_id, wijze, nieuw_bedrag, nieuwe_eenheid, bestaand_bedrag)
           VALUES (?, 'NIEUWE_VERGOEDING', '1200', 'MAAND', '1000')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("12d. CHECK weigert een onbekende wijze-waarde", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_management_invoer (begroting_versie_id, wijze, nieuw_bedrag, nieuwe_eenheid) VALUES (?, 'ONBEKEND', '1', 'MAAND')`)
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("13. rollback/atomiciteit — een mislukte vervanging (CHECK-schending) laat de vorige geldige rij exact ongewijzigd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule3Invoer(db, versie.id, NIEUWE_VERGOEDING_MET_DATUM);

    // Rechtstreekse SQL, buiten de TS-API om (die kan een ongeldige combinatie niet eens construeren) —
    // een UPSERT die de CHECK-constraint schendt (nieuw_bedrag EN bestaand_bedrag tegelijk voor NIEUWE_VERGOEDING).
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_management_invoer (begroting_versie_id, wijze, nieuw_bedrag, nieuwe_eenheid, bestaand_bedrag)
           VALUES (?, 'NIEUWE_VERGOEDING', '9999', 'JAAR', '1')
           ON CONFLICT (begroting_versie_id) DO UPDATE SET
             wijze = excluded.wijze, nieuw_bedrag = excluded.nieuw_bedrag, nieuwe_eenheid = excluded.nieuwe_eenheid, bestaand_bedrag = excluded.bestaand_bedrag`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);

    // De oorspronkelijke, geldige rij is volledig ongewijzigd — geen gedeeltelijke toepassing.
    expect(leesModule3Invoer(db, versie.id)).toEqual(NIEUWE_VERGOEDING_MET_DATUM);
  });

  it("14. andere begrotingsversie blijft onaangetast", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule3Invoer(db, versieA.id, INDEXEER);
    schrijfModule3Invoer(db, versieB.id, WIJZIG);

    expect(leesModule3Invoer(db, versieA.id)).toEqual(INDEXEER);
    expect(leesModule3Invoer(db, versieB.id)).toEqual(WIJZIG);

    schrijfModule3Invoer(db, versieA.id, NIEUWE_VERGOEDING_ZONDER_DATUM);
    expect(leesModule3Invoer(db, versieA.id)).toEqual(NIEUWE_VERGOEDING_ZONDER_DATUM);
    expect(leesModule3Invoer(db, versieB.id)).toEqual(WIJZIG); // ongewijzigd
  });

  it("15. verwijderen van een CONCEPT-versie cascadeert de Module-3-invoer volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule3Invoer(db, versie.id, INDEXEER);

    verwijderConceptVersie(db, versie.id);

    expect(db.prepare(`SELECT 1 FROM begroting_management_invoer WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
  });
});
