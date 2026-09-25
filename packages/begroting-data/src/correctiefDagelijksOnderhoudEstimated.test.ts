import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import {
  leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels,
  leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen,
  schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels,
  schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen,
  type CorrectiefDagelijksOnderhoudEstimatedOnlyRegelInvoer,
  type CorrectiefDagelijksOnderhoudEstimatedVerwachtingInvoer,
} from "./correctiefDagelijksOnderhoudEstimated.js";
import {
  leesCorrectiefDagelijksOnderhoudRegels,
  schrijfCorrectiefDagelijksOnderhoudRegels,
  type CorrectiefDagelijksOnderhoudRegelInvoer,
} from "./correctiefDagelijksOnderhoudRegels.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-cd-onderhoud-estimated-"));
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

function regelInvoer(overrides: Partial<CorrectiefDagelijksOnderhoudRegelInvoer> = {}): CorrectiefDagelijksOnderhoudRegelInvoer {
  return { id: null, omschrijving: "Dagelijks onderhoud", complexnummer: "003", grootboekrekening: "4300", ogbKostensoort: null, jaarbedrag: new Decimal(8000), ...overrides };
}

function verwachtingInvoer(
  overrides: Partial<CorrectiefDagelijksOnderhoudEstimatedVerwachtingInvoer> & Pick<CorrectiefDagelijksOnderhoudEstimatedVerwachtingInvoer, "regelId">,
): CorrectiefDagelijksOnderhoudEstimatedVerwachtingInvoer {
  return { resterendBedrag: new Decimal(0), ...overrides };
}

function estimatedOnlyInvoer(overrides: Partial<CorrectiefDagelijksOnderhoudEstimatedOnlyRegelInvoer> = {}): CorrectiefDagelijksOnderhoudEstimatedOnlyRegelInvoer {
  return { id: null, omschrijving: "Onvoorziene lekkage", complexnummer: "003", grootboekrekening: "4300", ogbKostensoort: null, resterendBedrag: new Decimal(0), ...overrides };
}

describe("Resterende verwachting — round-trip", () => {
  it("1. schrijven en teruglezen van een resterende verwachting voor een bestaande regel", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ regelId: regel!.id, resterendBedrag: new Decimal(5000) })]);

    const gelezen = leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]!.regelId).toBe(regel!.id);
    expect(gelezen[0]!.resterendBedrag!.toString()).toBe("5000");
  });

  it("2. €0 (expliciet) round-trip blijft geldig en onderscheiden van null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ regelId: regel!.id, resterendBedrag: new Decimal(0) })]);
    const gelezen = leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id);
    expect(gelezen[0]!.resterendBedrag).not.toBeNull();
    expect(gelezen[0]!.resterendBedrag!.toString()).toBe("0");
  });

  it("3. null (nog niet ingevuld) round-trip blijft null, niet Decimal(0)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ regelId: regel!.id, resterendBedrag: null })]);
    const gelezen = leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id);
    expect(gelezen[0]!.resterendBedrag).toBeNull();
  });

  it("4. negatieve waarde round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ regelId: regel!.id, resterendBedrag: new Decimal(-321.75) })]);
    const gelezen = leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id);
    expect(gelezen[0]!.resterendBedrag!.toString()).toBe("-321.75");
  });

  it("5. UPSERT: nogmaals schrijven voor dezelfde regel werkt bij, geen dubbele rij", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ regelId: regel!.id, resterendBedrag: new Decimal(100) })]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ regelId: regel!.id, resterendBedrag: new Decimal(999) })]);
    const gelezen = leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]!.resterendBedrag!.toString()).toBe("999");
  });

  it("6. een regel-id die niet bestaat wordt geweigerd, geen enkele mutatie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() => schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ regelId: 999999 })])).toThrow(/bestaat niet/);
    expect(leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id)).toEqual([]);
  });

  it("7. een regel-id van een ANDERE begrotingsversie wordt geweigerd", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, { ...NIEUWE_VERSIE_INPUT, begrotingsjaar: 2028 });
    const [regelA] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versieA.id, [regelInvoer()]);
    expect(() => schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versieB.id, [verwachtingInvoer({ regelId: regelA!.id })])).toThrow(/behoort bij begrotingsversie/);
  });

  it("8. blijft schrijfbaar NA vaststellen van de Begroting", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ regelId: regel!.id, resterendBedrag: new Decimal(42) })])).not.toThrow();
    expect(leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id)[0]!.resterendBedrag!.toString()).toBe("42");
  });
});

describe("Estimated-only regels — round-trip", () => {
  it("9. schrijven en teruglezen van een Estimated-only regel", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id, [estimatedOnlyInvoer({ resterendBedrag: new Decimal(750) })]);
    expect(regel!.id).toEqual(expect.any(Number));

    const gelezen = leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]!.resterendBedrag!.toString()).toBe("750");
  });

  it("10. complexnummer NTB (null) round-trip blijft geldig", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id, [estimatedOnlyInvoer({ complexnummer: null })]);
    expect(leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id)[0]!.complexnummer).toBeNull();
  });

  it("11. null OGB round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id, [estimatedOnlyInvoer({ ogbKostensoort: null })]);
    expect(leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id)[0]!.ogbKostensoort).toBeNull();
  });

  it("12. gevulde OGB round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id, [estimatedOnlyInvoer({ ogbKostensoort: "OGB-42" })]);
    expect(leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id)[0]!.ogbKostensoort).toBe("OGB-42");
  });

  it("13. null resterend bedrag round-trip blijft null, niet Decimal(0)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id, [estimatedOnlyInvoer({ resterendBedrag: null })]);
    expect(leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id)[0]!.resterendBedrag).toBeNull();
  });

  it("14. bewerken van een bestaande Estimated-only regel (id: number)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id, [estimatedOnlyInvoer({ resterendBedrag: new Decimal(100) })]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id, [{ ...origineel!, resterendBedrag: new Decimal(200) }]);
    const gelezen = leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]!.resterendBedrag!.toString()).toBe("200");
  });

  it("15. blijft schrijfbaar NA vaststellen van de Begroting", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id, [estimatedOnlyInvoer()])).not.toThrow();
  });
});

describe("Backward compatibility / niet-mutatie van bestaande data", () => {
  it("16. een bestaande begroting zonder Estimated-data blijft leesbaar (lege lijsten, geen fout)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    expect(leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id)).toEqual([]);
    expect(leesCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versie.id)).toEqual([]);
  });

  it("17. Delta Build 1 grootboek/OGB van de oorspronkelijke regel blijft intact na een Estimated-schrijfactie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ grootboekrekening: "4310", ogbKostensoort: "OGB-7" })]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ regelId: regel!.id, resterendBedrag: new Decimal(123) })]);

    const regelsNa = leesCorrectiefDagelijksOnderhoudRegels(db, versie.id);
    expect(regelsNa[0]!.grootboekrekening).toBe("4310");
    expect(regelsNa[0]!.ogbKostensoort).toBe("OGB-7");
    expect(regelsNa[0]!.jaarbedrag!.toString()).toBe("8000"); // oorspronkelijke Begroting-jaarbedrag ongewijzigd
  });

  it("18. het verwijderen van een regel cascadeert de bijbehorende resterende verwachting weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ regelId: regel!.id, resterendBedrag: new Decimal(50) })]);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, []); // verwijdert de regel
    expect(leesCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id)).toEqual([]);
  });
});
