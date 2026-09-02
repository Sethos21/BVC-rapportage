import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenBegroteHuuropbrengsten, type BgHuurAannames } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesModule1Aannames, schrijfModule1Aannames } from "./module1Aannames.js";
import { leesModule1Snapshot, schrijfModule1Snapshot } from "./module1Snapshot.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-aannames-"));
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

describe("schrijfModule1Aannames / leesModule1Aannames", () => {
  it("3. aannames: exact round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const aannames: BgHuurAannames = { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) };
    schrijfModule1Aannames(db, versie.id, aannames);

    expect(leesModule1Aannames(db, versie.id)).toEqual(aannames);
  });

  it("4. begrotingsjaar wordt uit de parent-versie gereconstrueerd, niet dubbel opgeslagen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT); // begrotingsjaar 2027
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });

    // Rechtstreeks op rijniveau: geen begrotingsjaar-kolom in begroting_aannames.
    const kolommen = db.prepare(`PRAGMA table_info(begroting_aannames)`).all() as { name: string }[];
    expect(kolommen.map((k) => k.name)).not.toContain("begrotingsjaar");

    expect(leesModule1Aannames(db, versie.id)!.begrotingsjaar).toBe(2027);
  });

  it("5. mismatch tussen aannames.begrotingsjaar en de parent-versie wordt bij schrijven geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT); // begrotingsjaar 2027
    expect(() => schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2028, indexatiePercentage: new Decimal(3) })).toThrow(
      /begrotingsjaar/i,
    );
    expect(leesModule1Aannames(db, versie.id)).toBeNull();
  });

  it("6. Decimal TEXT round-trip zonder number-conversie (meer precisie dan 2 decimalen, negatief toegestaan)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const precisiePercentage = new Decimal("3.14159265");
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: precisiePercentage });

    const ruweRij = db
      .prepare(`SELECT indexatie_percentage, typeof(indexatie_percentage) AS type FROM begroting_aannames WHERE begroting_versie_id = ?`)
      .get(versie.id) as { indexatie_percentage: string; type: string };
    expect(ruweRij.type).toBe("text");
    expect(ruweRij.indexatie_percentage).toBe("3.14159265");

    // Negatief indexatiepercentage: de pure interface staat dit technisch toe (geen teken-CHECK op HEAD) —
    // persistence mag daar geen eigen businessregel over verzinnen.
    const negatieveVersie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Aannames(db, negatieveVersie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(-1.5) });
    expect(leesModule1Aannames(db, negatieveVersie.id)!.indexatiePercentage.toString()).toBe("-1.5");
  });

  it("7. aannames vervangen (opnieuw schrijven) werkt", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(4.5) });

    expect(leesModule1Aannames(db, versie.id)!.indexatiePercentage.toString()).toBe("4.5");
    // Nog steeds precies één rij (upsert, geen dubbele registratie).
    const rijen = db.prepare(`SELECT COUNT(*) AS aantal FROM begroting_aannames WHERE begroting_versie_id = ?`).get(versie.id) as {
      aantal: number;
    };
    expect(rijen.aantal).toBe(1);
  });

  it("8. een geforceerde DB-fout tijdens 'vervangen' (VASTGESTELD-trigger) behoudt de vorige waarde exact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    markeerVastgesteld(db, versie.id, new Date());

    // Rechtstreekse SQL, buiten de TS-API om — de enige échte DB-fout die voor een 1-op-1-record
    // forceerbaar is (een enkel UPSERT-statement is zelf al atomair, er is geen tussenstap om te
    // onderbreken): de VASTGESTELD-immutability-trigger.
    expect(() => db.prepare(`UPDATE begroting_aannames SET indexatie_percentage = '999' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );

    const ruweRij = db.prepare(`SELECT indexatie_percentage FROM begroting_aannames WHERE begroting_versie_id = ?`).get(versie.id) as {
      indexatie_percentage: string;
    };
    expect(ruweRij.indexatie_percentage).toBe("3"); // exact de vorige waarde, ongewijzigd
  });

  it("9. schrijven op een VASTGESTELDE versie wordt via de API geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) })).toThrow(
      /VASTGESTELD/,
    );
  });

  it("10. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    markeerVastgesteld(db, versie.id, new Date());

    // De trigger vuurt vóór de PK-constraint, dus deze INSERT-poging wordt door de immutability-trigger
    // afgevangen (niet door een "bestaat al"-conflict).
    expect(() =>
      db.prepare(`INSERT INTO begroting_aannames (begroting_versie_id, indexatie_percentage) VALUES (?, '1')`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE begroting_aannames SET indexatie_percentage = '1' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
    expect(() => db.prepare(`DELETE FROM begroting_aannames WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
  });

  it("11. verwijderen van een CONCEPT-versie cascadeert de aannames volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });

    verwijderConceptVersie(db, versie.id);

    expect(db.prepare(`SELECT 1 FROM begroting_aannames WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
  });

  it("33. gelezen aannames werken rechtstreeks als invoer van de échte berekenBegroteHuuropbrengsten, samen met een geldige snapshot", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });

    const contracten = leesModule1Snapshot(db, versie.id);
    const aannames = leesModule1Aannames(db, versie.id)!;

    expect(() => berekenBegroteHuuropbrengsten(contracten, [], aannames, versie.bronPeildatum)).not.toThrow();
  });
});
