import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import {
  leesGeplandOnderhoudEstimatedOnlyActiviteiten,
  leesGeplandOnderhoudEstimatedVerwachtingen,
  schrijfGeplandOnderhoudEstimatedOnlyActiviteiten,
  schrijfGeplandOnderhoudEstimatedVerwachtingen,
  type GeplandOnderhoudEstimatedOnlyActiviteitInvoer,
  type GeplandOnderhoudEstimatedVerwachtingInvoer,
} from "./geplandOnderhoudEstimated.js";
import { leesGeplandOnderhoudActiviteiten, schrijfGeplandOnderhoudActiviteiten, type GeplandOnderhoudActiviteitInvoer } from "./geplandOnderhoudActiviteiten.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-gepland-onderhoud-estimated-"));
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

function activiteitInvoer(overrides: Partial<GeplandOnderhoudActiviteitInvoer> = {}): GeplandOnderhoudActiviteitInvoer {
  return {
    id: null,
    complexnummer: "003",
    omschrijving: "Vervangen dakbedekking",
    grootboekrekening: "4300",
    ogbKostensoort: null,
    aanleidingType: "MJOP",
    aanleidingToelichting: "MJOP 2027 regel 14",
    q1: new Decimal(25000),
    q2: new Decimal(0),
    q3: new Decimal(0),
    q4: new Decimal(0),
    status: "GEPLAND",
    leverancier: null,
    offertebedrag: null,
    notitie: null,
    ...overrides,
  };
}

function verwachtingInvoer(overrides: Partial<GeplandOnderhoudEstimatedVerwachtingInvoer> & Pick<GeplandOnderhoudEstimatedVerwachtingInvoer, "activiteitId">): GeplandOnderhoudEstimatedVerwachtingInvoer {
  return { q1: new Decimal(0), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0), ...overrides };
}

function estimatedOnlyInvoer(overrides: Partial<GeplandOnderhoudEstimatedOnlyActiviteitInvoer> = {}): GeplandOnderhoudEstimatedOnlyActiviteitInvoer {
  return {
    id: null,
    complexnummer: "003",
    omschrijving: "Onvoorziene dakreparatie",
    grootboekrekening: "4300",
    ogbKostensoort: null,
    q1: new Decimal(0),
    q2: new Decimal(0),
    q3: new Decimal(0),
    q4: new Decimal(0),
    ...overrides,
  };
}

describe("Resterende verwachting — round-trip", () => {
  it("1. schrijven en teruglezen van een resterende kwartaalverwachting voor een bestaande activiteit", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [activiteit] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ activiteitId: activiteit!.id, q2: new Decimal(5000) })]);

    const gelezen = leesGeplandOnderhoudEstimatedVerwachtingen(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]!.activiteitId).toBe(activiteit!.id);
    expect(gelezen[0]!.q2.toString()).toBe("5000");
  });

  it("2. €0 round-trip blijft geldig", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [activiteit] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ activiteitId: activiteit!.id })]);
    const gelezen = leesGeplandOnderhoudEstimatedVerwachtingen(db, versie.id);
    expect(gelezen[0]!.q1.toString()).toBe("0");
  });

  it("3. negatieve waarde round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [activiteit] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ activiteitId: activiteit!.id, q3: new Decimal(-1250.5) })]);
    const gelezen = leesGeplandOnderhoudEstimatedVerwachtingen(db, versie.id);
    expect(gelezen[0]!.q3.toString()).toBe("-1250.5");
  });

  it("4. UPSERT: nogmaals schrijven voor dezelfde activiteit werkt bij, geen dubbele rij", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [activiteit] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ activiteitId: activiteit!.id, q1: new Decimal(100) })]);
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ activiteitId: activiteit!.id, q1: new Decimal(999) })]);
    const gelezen = leesGeplandOnderhoudEstimatedVerwachtingen(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]!.q1.toString()).toBe("999");
  });

  it("5. een activiteit-id die niet bestaat wordt geweigerd, geen enkele mutatie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() => schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ activiteitId: 999999 })])).toThrow(/bestaat niet/);
    expect(leesGeplandOnderhoudEstimatedVerwachtingen(db, versie.id)).toEqual([]);
  });

  it("6. een activiteit-id van een ANDERE begrotingsversie wordt geweigerd", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, { ...NIEUWE_VERSIE_INPUT, begrotingsjaar: 2028 });
    const [activiteitA] = schrijfGeplandOnderhoudActiviteiten(db, versieA.id, [activiteitInvoer()]);
    expect(() => schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versieB.id, [verwachtingInvoer({ activiteitId: activiteitA!.id })])).toThrow(/behoort bij begrotingsversie/);
  });

  it("7. blijft schrijfbaar NA vaststellen van de Begroting (Estimated is geen CONCEPT-gebonden data)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [activiteit] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ activiteitId: activiteit!.id, q4: new Decimal(42) })])).not.toThrow();
    expect(leesGeplandOnderhoudEstimatedVerwachtingen(db, versie.id)[0]!.q4.toString()).toBe("42");
  });
});

describe("Estimated-only activiteiten — round-trip", () => {
  it("8. schrijven en teruglezen van een Estimated-only activiteit", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [activiteit] = schrijfGeplandOnderhoudEstimatedOnlyActiviteiten(db, versie.id, [estimatedOnlyInvoer({ q1: new Decimal(750) })]);
    expect(activiteit!.id).toEqual(expect.any(Number));

    const gelezen = leesGeplandOnderhoudEstimatedOnlyActiviteiten(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]!.q1.toString()).toBe("750");
  });

  it("9. null OGB round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudEstimatedOnlyActiviteiten(db, versie.id, [estimatedOnlyInvoer({ ogbKostensoort: null })]);
    expect(leesGeplandOnderhoudEstimatedOnlyActiviteiten(db, versie.id)[0]!.ogbKostensoort).toBeNull();
  });

  it("10. gevulde OGB round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudEstimatedOnlyActiviteiten(db, versie.id, [estimatedOnlyInvoer({ ogbKostensoort: "OGB-42" })]);
    expect(leesGeplandOnderhoudEstimatedOnlyActiviteiten(db, versie.id)[0]!.ogbKostensoort).toBe("OGB-42");
  });

  it("11. bewerken van een bestaande Estimated-only activiteit (id: number)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfGeplandOnderhoudEstimatedOnlyActiviteiten(db, versie.id, [estimatedOnlyInvoer({ q1: new Decimal(100) })]);
    schrijfGeplandOnderhoudEstimatedOnlyActiviteiten(db, versie.id, [{ ...origineel!, id: origineel!.id, q1: new Decimal(200) }]);
    const gelezen = leesGeplandOnderhoudEstimatedOnlyActiviteiten(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]!.q1.toString()).toBe("200");
  });

  it("12. blijft schrijfbaar NA vaststellen van de Begroting", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfGeplandOnderhoudEstimatedOnlyActiviteiten(db, versie.id, [estimatedOnlyInvoer()])).not.toThrow();
  });
});

describe("Backward compatibility / niet-mutatie van bestaande data", () => {
  it("13. een bestaande begroting zonder Estimated-data blijft leesbaar (lege lijsten, geen fout)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    expect(leesGeplandOnderhoudEstimatedVerwachtingen(db, versie.id)).toEqual([]);
    expect(leesGeplandOnderhoudEstimatedOnlyActiviteiten(db, versie.id)).toEqual([]);
  });

  it("14. Delta Build 1 grootboek/OGB van de oorspronkelijke activiteit blijft intact na een Estimated-schrijfactie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [activiteit] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ grootboekrekening: "4310", ogbKostensoort: "OGB-7" })]);
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ activiteitId: activiteit!.id, q1: new Decimal(123) })]);

    const activiteitenNa = leesGeplandOnderhoudActiviteiten(db, versie.id);
    expect(activiteitenNa[0]!.grootboekrekening).toBe("4310");
    expect(activiteitenNa[0]!.ogbKostensoort).toBe("OGB-7");
    expect(activiteitenNa[0]!.q1.toString()).toBe("25000"); // oorspronkelijke Begroting-Q1 ongewijzigd
  });

  it("15. het verwijderen van een activiteit cascadeert de bijbehorende resterende verwachting weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [activiteit] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versie.id, [verwachtingInvoer({ activiteitId: activiteit!.id, q1: new Decimal(50) })]);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, []); // verwijdert de activiteit
    expect(leesGeplandOnderhoudEstimatedVerwachtingen(db, versie.id)).toEqual([]);
  });
});
