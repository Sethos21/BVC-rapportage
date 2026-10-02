import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase } from "./database.js";
import { maakBegrotingsversie, markeerVastgesteld } from "./begrotingsversies.js";
import { leesNietVerrekenbareBtwRegels, schrijfNietVerrekenbareBtwRegels } from "./nietVerrekenbareBtwRegels.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-btw-regels-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function nieuweVersie(): string {
  return maakBegrotingsversie(db, { bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date("2026-07-31"), originType: "NIEUW" }).id;
}

describe("nietVerrekenbareBtwRegels — complete-list save", () => {
  it("8. schrijft en leest regels terug, met toegekend id voor nieuwe regels", () => {
    const versieId = nieuweVersie();
    const regels = schrijfNietVerrekenbareBtwRegels(db, versieId, [{ id: null, omschrijving: "BTW jaarafrekening", complexnummer: null, jaarbedrag: new Decimal("2500") }]);
    expect(regels).toHaveLength(1);
    expect(regels[0]!.id).toBeGreaterThan(0);
    expect(leesNietVerrekenbareBtwRegels(db, versieId)).toEqual(regels);
  });

  it("complete-list save: een tweede save zonder een eerder id verwijdert die regel", () => {
    const versieId = nieuweVersie();
    const [eerste] = schrijfNietVerrekenbareBtwRegels(db, versieId, [{ id: null, omschrijving: "A", complexnummer: null, jaarbedrag: new Decimal("100") }]);
    schrijfNietVerrekenbareBtwRegels(db, versieId, [{ id: eerste!.id, omschrijving: "A", complexnummer: null, jaarbedrag: new Decimal("100") }, { id: null, omschrijving: "B", complexnummer: null, jaarbedrag: new Decimal("50") }]);
    const derdeRonde = schrijfNietVerrekenbareBtwRegels(db, versieId, [{ id: null, omschrijving: "C", complexnummer: null, jaarbedrag: new Decimal("1") }]);
    expect(derdeRonde.map((r) => r.omschrijving)).toEqual(["C"]);
  });

  it("17. mag uitsluitend op CONCEPT worden geschreven", () => {
    const versieId = nieuweVersie();
    markeerVastgesteld(db, versieId, new Date("2026-09-29T00:00:00.000Z"));
    expect(() => schrijfNietVerrekenbareBtwRegels(db, versieId, [{ id: null, omschrijving: "A", complexnummer: null, jaarbedrag: new Decimal("1") }])).toThrow(/VASTGESTELD/);
  });

  it("faalt op een dubbele bestaande id in dezelfde save (geen 'laatste wint')", () => {
    const versieId = nieuweVersie();
    const [regel] = schrijfNietVerrekenbareBtwRegels(db, versieId, [{ id: null, omschrijving: "A", complexnummer: null, jaarbedrag: new Decimal("1") }]);
    expect(() =>
      schrijfNietVerrekenbareBtwRegels(db, versieId, [
        { id: regel!.id, omschrijving: "A", complexnummer: null, jaarbedrag: new Decimal("1") },
        { id: regel!.id, omschrijving: "A2", complexnummer: null, jaarbedrag: new Decimal("2") },
      ]),
    ).toThrow(/meerdere keren/);
  });

  it("faalt op een id die bij een andere begrotingsversie hoort (versie-isolatie)", () => {
    const versieA = nieuweVersie();
    const versieB = nieuweVersie();
    const [regelA] = schrijfNietVerrekenbareBtwRegels(db, versieA, [{ id: null, omschrijving: "A", complexnummer: null, jaarbedrag: new Decimal("1") }]);
    expect(() => schrijfNietVerrekenbareBtwRegels(db, versieB, [{ id: regelA!.id, omschrijving: "A", complexnummer: null, jaarbedrag: new Decimal("1") }])).toThrow(/behoort bij begrotingsversie/);
    // Geen enkele mutatie: versie A's regel blijft ongewijzigd.
    expect(leesNietVerrekenbareBtwRegels(db, versieA)).toHaveLength(1);
  });
});
