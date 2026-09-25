import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { leesGemeentelijkeLastenModule, schrijfWozSetBevestigd } from "./gemeentelijkeLastenModule.js";
import { leesWozHistorieCsv } from "./wozHistorieExport.js";
import { openOrCreateDatabase } from "./database.js";
import { leesWozObjecten, schrijfWozObjecten, type WozObject, type WozObjectInvoer } from "./wozObjecten.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-woz-object-"));
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

function objectInvoer(overrides: Partial<WozObjectInvoer> = {}): WozObjectInvoer {
  return {
    id: null,
    complexnummer: "001",
    objectType: "UNIT",
    unitnummer: "Kerkstraat 1, Schijndel",
    aanslagjaar: 2026,
    waardepeildatum: new Date(Date.UTC(2025, 0, 1)),
    werkelijkeWoz: new Decimal(1_000_000),
    verwachteWozOverride: null,
    ...overrides,
  };
}

/** Zet een gelezen WOZ-object terug om naar invoervorm (id behouden) — hulpfunctie uitsluitend voor deze tests. */
function naarInvoer(o: WozObject): WozObjectInvoer {
  return { ...o };
}

describe("schrijfWozObjecten / leesWozObjecten", () => {
  it("1. nul objecten lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesWozObjecten(db, versie.id)).toEqual([]);
  });

  it("2. één object schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfWozObjecten(db, versie.id, [objectInvoer()]);
    const gelezen = leesWozObjecten(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]).toMatchObject({ complexnummer: "001", unitnummer: "Kerkstraat 1, Schijndel", aanslagjaar: 2026 });
    expect(gelezen[0]?.werkelijkeWoz?.toString()).toBe("1000000");
    expect(gelezen[0]?.waardepeildatum).toEqual(new Date(Date.UTC(2025, 0, 1)));
  });

  it("3. meerdere objecten binnen hetzelfde complex schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfWozObjecten(db, versie.id, [
      objectInvoer({ unitnummer: "Kerkstraat 1" }),
      objectInvoer({ unitnummer: "Kerkstraat 3" }),
    ]);
    const gelezen = leesWozObjecten(db, versie.id);
    expect(gelezen).toHaveLength(2);
    expect(gelezen.map((o) => o.unitnummer)).toEqual(["Kerkstraat 1", "Kerkstraat 3"]);
    expect(gelezen.every((o) => o.complexnummer === "001")).toBe(true);
  });

  it("4. objecten verspreid over meerdere complexen schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfWozObjecten(db, versie.id, [objectInvoer({ complexnummer: "001" }), objectInvoer({ complexnummer: "002" })]);
    const gelezen = leesWozObjecten(db, versie.id);
    expect(gelezen.map((o) => o.complexnummer)).toEqual(["001", "002"]);
  });

  it("5. Decimal TEXT round-trip zonder number-conversie (meer precisie dan 2 decimalen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfWozObjecten(db, versie.id, [
      objectInvoer({ werkelijkeWoz: new Decimal("987654.321"), verwachteWozOverride: new Decimal("1000000.005") }),
    ]);

    const ruweRij = db
      .prepare(
        `SELECT werkelijke_woz, typeof(werkelijke_woz) AS woz_type, verwachte_woz_override FROM begroting_woz_object WHERE begroting_versie_id = ?`,
      )
      .get(versie.id) as { werkelijke_woz: string; woz_type: string; verwachte_woz_override: string };
    expect(ruweRij.woz_type).toBe("text");
    expect(ruweRij.werkelijke_woz).toBe("987654.321");
    expect(ruweRij.verwachte_woz_override).toBe("1000000.005");

    const gelezen = leesWozObjecten(db, versie.id);
    expect(gelezen[0]?.werkelijkeWoz?.toString()).toBe("987654.321");
    expect(gelezen[0]?.verwachteWozOverride?.toString()).toBe("1000000.005");
  });

  it("6. waardepeildatum round-trip als YYYY-MM-DD, geen tijdzone-drift", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfWozObjecten(db, versie.id, [objectInvoer({ waardepeildatum: new Date(Date.UTC(2026, 0, 31)) })]);

    const ruweRij = db.prepare(`SELECT waardepeildatum FROM begroting_woz_object WHERE begroting_versie_id = ?`).get(versie.id) as {
      waardepeildatum: string;
    };
    expect(ruweRij.waardepeildatum).toBe("2026-01-31");
    expect(leesWozObjecten(db, versie.id)[0]?.waardepeildatum).toEqual(new Date(Date.UTC(2026, 0, 31)));
  });

  it("7. aanslagjaar round-trip exact als integer", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfWozObjecten(db, versie.id, [objectInvoer({ aanslagjaar: 2019 })]);

    const ruweRij = db.prepare(`SELECT aanslagjaar, typeof(aanslagjaar) AS aanslagjaar_type FROM begroting_woz_object WHERE begroting_versie_id = ?`).get(
      versie.id,
    ) as { aanslagjaar: number; aanslagjaar_type: string };
    expect(ruweRij.aanslagjaar_type).toBe("integer");
    expect(ruweRij.aanslagjaar).toBe(2019);
    expect(leesWozObjecten(db, versie.id)[0]?.aanslagjaar).toBe(2019);
  });

  it("8. alle zes velden null round-trippen als null (functioneel onvolledig object blijft opslaanbaar, OB033-003/004)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfWozObjecten(db, versie.id, [
      objectInvoer({
        complexnummer: null,
        objectType: null,
        unitnummer: null,
        aanslagjaar: null,
        waardepeildatum: null,
        werkelijkeWoz: null,
        verwachteWozOverride: null,
      }),
    ]);
    const gelezen = leesWozObjecten(db, versie.id)[0]!;
    expect(gelezen.complexnummer).toBeNull();
    expect(gelezen.unitnummer).toBeNull();
    expect(gelezen.aanslagjaar).toBeNull();
    expect(gelezen.waardepeildatum).toBeNull();
    expect(gelezen.werkelijkeWoz).toBeNull();
    expect(gelezen.verwachteWozOverride).toBeNull();
  });

  it("9. verwachteWozOverride null vs. bewuste €0 blijven onderscheiden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfWozObjecten(db, versie.id, [
      objectInvoer({ complexnummer: "001", verwachteWozOverride: null }),
      objectInvoer({ complexnummer: "002", verwachteWozOverride: new Decimal(0) }),
    ]);
    const gelezen = leesWozObjecten(db, versie.id);
    expect(gelezen.find((o) => o.complexnummer === "001")?.verwachteWozOverride).toBeNull();
    expect(gelezen.find((o) => o.complexnummer === "002")?.verwachteWozOverride?.toString()).toBe("0");
  });

  it("10. nieuw object krijgt persistente ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = schrijfWozObjecten(db, versie.id, [objectInvoer(), objectInvoer({ complexnummer: "002" })]);
    expect(resultaat).toHaveLength(2);
    expect(typeof resultaat[0]?.id).toBe("number");
    expect(typeof resultaat[1]?.id).toBe("number");
    expect(resultaat[0]?.id).not.toBe(resultaat[1]?.id);
  });

  it("11. bestaand object update behoudt ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfWozObjecten(db, versie.id, [objectInvoer({ unitnummer: "Origineel" })]);

    const bijgewerkt = schrijfWozObjecten(db, versie.id, [{ ...naarInvoer(origineel!), unitnummer: "Bijgewerkt" }]);

    expect(bijgewerkt).toHaveLength(1);
    expect(bijgewerkt[0]?.id).toBe(origineel!.id);
    expect(bijgewerkt[0]?.unitnummer).toBe("Bijgewerkt");
  });

  it("11b. de onderliggende UPDATE is zelf id+begroting_versie_id-gebonden (SQL-mechanica, onafhankelijk van de vooraf-check)", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [objectA] = schrijfWozObjecten(db, versieA.id, [objectInvoer({ unitnummer: "A" })]);

    const info = db
      .prepare(`UPDATE begroting_woz_object SET unitnummer = 'Gekaapt' WHERE id = ? AND begroting_versie_id = ?`)
      .run(objectA!.id, versieB.id);
    expect(Number(info.changes)).toBe(0);
    expect(leesWozObjecten(db, versieA.id)[0]?.unitnummer).toBe("A");
  });

  it("12. verwijderen via complete-list save verwijdert juiste object", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [a, b] = schrijfWozObjecten(db, versie.id, [objectInvoer({ complexnummer: "001" }), objectInvoer({ complexnummer: "002" })]);

    const resultaat = schrijfWozObjecten(db, versie.id, [naarInvoer(a!)]);

    expect(resultaat).toHaveLength(1);
    expect(resultaat[0]?.id).toBe(a!.id);
    expect(leesWozObjecten(db, versie.id).some((x) => x.id === b!.id)).toBe(false);
  });

  it("13. volgorde lezen deterministisch ORDER BY id", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geschreven = schrijfWozObjecten(db, versie.id, [
      objectInvoer({ complexnummer: "001" }),
      objectInvoer({ complexnummer: "002" }),
      objectInvoer({ complexnummer: "003" }),
    ]);
    const ids = geschreven.map((o) => o.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));

    schrijfWozObjecten(db, versie.id, [naarInvoer(geschreven[2]!), naarInvoer(geschreven[0]!), naarInvoer(geschreven[1]!)]);
    expect(leesWozObjecten(db, versie.id).map((o) => o.id)).toEqual(ids);
  });

  it("14. ID van andere begrotingsversie -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [objectA] = schrijfWozObjecten(db, versieA.id, [objectInvoer({ unitnummer: "A-origineel" })]);
    const [objectB] = schrijfWozObjecten(db, versieB.id, [objectInvoer()]);

    expect(() =>
      schrijfWozObjecten(db, versieA.id, [
        { ...naarInvoer(objectA!), unitnummer: "A-zou-bijgewerkt-worden" },
        objectInvoer({ complexnummer: "999", unitnummer: "Zou-nieuw-worden" }),
        { ...naarInvoer(objectB!), unitnummer: "Gekaapt" },
      ]),
    ).toThrow(/behoort bij begrotingsversie/);

    const huidigA = leesWozObjecten(db, versieA.id);
    expect(huidigA).toHaveLength(1);
    expect(huidigA[0]?.unitnummer).toBe("A-origineel");
    expect(leesWozObjecten(db, versieB.id)[0]?.unitnummer).toBe(objectB!.unitnummer);
  });

  it("15. onbekende bestaande ID -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [bestaand] = schrijfWozObjecten(db, versie.id, [objectInvoer({ unitnummer: "Bestaat al" })]);

    expect(() =>
      schrijfWozObjecten(db, versie.id, [
        { ...naarInvoer(bestaand!), unitnummer: "Zou-bijgewerkt-worden" },
        objectInvoer({ id: 999999, unitnummer: "Bestaat niet" }),
      ]),
    ).toThrow(/bestaat niet/);

    expect(leesWozObjecten(db, versie.id)).toHaveLength(1);
    expect(leesWozObjecten(db, versie.id)[0]?.unitnummer).toBe("Bestaat al");
  });

  it("16. duplicate bestaande ID in input -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfWozObjecten(db, versie.id, [objectInvoer({ unitnummer: "Origineel" })]);

    expect(() =>
      schrijfWozObjecten(db, versie.id, [
        { ...naarInvoer(origineel!), unitnummer: "Versie 1" },
        { ...naarInvoer(origineel!), unitnummer: "Versie 2" },
        objectInvoer({ complexnummer: "999", unitnummer: "Zou-nieuw-worden" }),
      ]),
    ).toThrow(/meerdere keren voor in één save/);

    expect(leesWozObjecten(db, versie.id)).toHaveLength(1);
    expect(leesWozObjecten(db, versie.id)[0]?.unitnummer).toBe("Origineel");
  });

  it("17. save versie A wijzigt nooit versie B", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfWozObjecten(db, versieA.id, [objectInvoer({ unitnummer: "A1" })]);
    schrijfWozObjecten(db, versieB.id, [objectInvoer({ unitnummer: "B1" })]);

    schrijfWozObjecten(db, versieA.id, [objectInvoer({ unitnummer: "A1-gewijzigd" }), objectInvoer({ unitnummer: "A2-nieuw" })]);

    expect(leesWozObjecten(db, versieB.id)).toHaveLength(1);
    expect(leesWozObjecten(db, versieB.id)[0]?.unitnummer).toBe("B1");
  });

  it("18. INSERT via de API wordt geweigerd op een VASTGESTELDE versie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfWozObjecten(db, versie.id, [objectInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfWozObjecten(db, versie.id, [objectInvoer()])).toThrow(/VASTGESTELD/);
  });

  it("19. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [object] = schrijfWozObjecten(db, versie.id, [objectInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => db.prepare(`INSERT INTO begroting_woz_object (begroting_versie_id, complexnummer) VALUES (?, '001')`).run(versie.id)).toThrow(
      /immutable/,
    );
    expect(() => db.prepare(`UPDATE begroting_woz_object SET unitnummer = 'gewijzigd' WHERE id = ?`).run(object!.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_woz_object WHERE id = ?`).run(object!.id)).toThrow(/immutable/);
  });

  it("20. fout halverwege write -> transactie rollback, oorspronkelijke lijst blijft intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfWozObjecten(db, versie.id, [objectInvoer({ complexnummer: "001" })]);

    db.exec(
      `CREATE TRIGGER trg_test_forceer_fout_woz
       BEFORE INSERT ON begroting_woz_object
       FOR EACH ROW
       WHEN NEW.complexnummer = 'FOUT'
       BEGIN
         SELECT RAISE(ABORT, 'geforceerde testfout');
       END`,
    );

    try {
      expect(() =>
        schrijfWozObjecten(db, versie.id, [{ ...naarInvoer(origineel!), complexnummer: "002" }, objectInvoer({ complexnummer: "FOUT" })]),
      ).toThrow(/geforceerde testfout/);
    } finally {
      db.exec(`DROP TRIGGER trg_test_forceer_fout_woz`);
    }

    const huidig = leesWozObjecten(db, versie.id);
    expect(huidig).toHaveLength(1);
    expect(huidig[0]?.complexnummer).toBe("001");
  });
});
describe("WOZ-objecten — objectkeuze complex + geheel complex/unit (Master Contract §6.8)", () => {
  it("geheel complex (zonder unitnummer), unit (met unitnummer) en nog-niet-gekozen (NULL) round-trippen exact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const gelezen = schrijfWozObjecten(db, versie.id, [
      objectInvoer({ objectType: "GEHEEL_COMPLEX", unitnummer: null }),
      objectInvoer({ objectType: "UNIT", unitnummer: "A-12" }),
      objectInvoer({ objectType: null, unitnummer: null }),
    ]);
    expect(gelezen.map((o) => [o.objectType, o.unitnummer])).toEqual([
      ["GEHEEL_COMPLEX", null],
      ["UNIT", "A-12"],
      [null, null],
    ]);
  });

  it("een ongeldige objectType-waarde (bv. een vrij adres) wordt door de enum-CHECK geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() => schrijfWozObjecten(db, versie.id, [objectInvoer({ objectType: "Kerkstraat 1" })])).toThrow(/CHECK constraint failed/);
    expect(leesWozObjecten(db, versie.id)).toEqual([]);
  });

  it("stabiele id: dezelfde unit-sleutel blijft aan dezelfde rij hangen na herschrijven in andere volgorde", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [a, b] = schrijfWozObjecten(db, versie.id, [objectInvoer({ objectType: "UNIT", unitnummer: "A" }), objectInvoer({ objectType: "UNIT", unitnummer: "B" })]);
    const na = schrijfWozObjecten(db, versie.id, [
      { ...naarInvoer(b!), werkelijkeWoz: new Decimal(2) },
      { ...naarInvoer(a!), werkelijkeWoz: new Decimal(1) },
    ]);
    const perId = new Map(na.map((o) => [o.id, [o.unitnummer, o.werkelijkeWoz!.toString()]]));
    expect(perId.get(a!.id)).toEqual(["A", "1"]);
    expect(perId.get(b!.id)).toEqual(["B", "2"]);
  });
});

describe("WOZ-objecten — bevestiging 'WOZ-set compleet' vervalt bij elke wijziging (besluit 2026-09-25)", () => {
  function bevestigdeSet() {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [a, b] = schrijfWozObjecten(db, versie.id, [objectInvoer({ objectType: "UNIT", unitnummer: "A" }), objectInvoer({ objectType: "UNIT", unitnummer: "B" })]);
    schrijfWozSetBevestigd(db, versie.id, true);
    expect(leesGemeentelijkeLastenModule(db, versie.id).wozSetBevestigd).toBe(true);
    return { versieId: versie.id, a: a!, b: b! };
  }
  const bevestigd = (versieId: string) => leesGemeentelijkeLastenModule(db, versieId).wozSetBevestigd;

  it("toevoegen van een WOZ-record zet de bevestiging terug", () => {
    const { versieId, a, b } = bevestigdeSet();
    schrijfWozObjecten(db, versieId, [naarInvoer(a), naarInvoer(b), objectInvoer({ objectType: "UNIT", unitnummer: "C" })]);
    expect(bevestigd(versieId)).toBe(false);
  });

  it("wijzigen van een WOZ-record zet de bevestiging terug", () => {
    const { versieId, a, b } = bevestigdeSet();
    schrijfWozObjecten(db, versieId, [{ ...naarInvoer(a), werkelijkeWoz: new Decimal(123) }, naarInvoer(b)]);
    expect(bevestigd(versieId)).toBe(false);
  });

  it("verwijderen van een WOZ-record zet de bevestiging terug", () => {
    const { versieId, a } = bevestigdeSet();
    schrijfWozObjecten(db, versieId, [naarInvoer(a)]);
    expect(bevestigd(versieId)).toBe(false);
  });

  it("een save zonder inhoudelijke wijziging (identieke lijst) laat de bevestiging staan", () => {
    const { versieId, a, b } = bevestigdeSet();
    schrijfWozObjecten(db, versieId, [naarInvoer(a), naarInvoer(b)]);
    expect(bevestigd(versieId)).toBe(true);
  });

  it("een wijziging in een ANDERE begrotingsversie raakt de bevestiging van deze versie niet", () => {
    const { versieId } = bevestigdeSet();
    const andere = maakBegrotingsversie(db, { ...NIEUWE_VERSIE_INPUT, begrotingsjaar: 2028 });
    schrijfWozObjecten(db, andere.id, [objectInvoer()]);
    expect(bevestigd(versieId)).toBe(true);
  });

  it("zonder bestaande module-rij levert een WOZ-wijziging geen fout of nieuwe rij op", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfWozObjecten(db, versie.id, [objectInvoer()]);
    expect(bevestigd(versie.id)).toBe(false);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM begroting_gemeentelijke_lasten_module`).get()).toEqual({ n: 0 });
  });
});

describe("WOZ-historie CSV vanuit de persistentielaag (leesWozHistorieCsv)", () => {
  it("niet beschikbaar zonder bevestiging; beschikbaar na bevestiging met administratiecode; weer niet beschikbaar na een WOZ-wijziging", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [a] = schrijfWozObjecten(db, versie.id, [
      objectInvoer({ objectType: "GEHEEL_COMPLEX", unitnummer: null, aanslagjaar: 2025, werkelijkeWoz: new Decimal(1000000) }),
      objectInvoer({ objectType: "GEHEEL_COMPLEX", unitnummer: null, aanslagjaar: 2026, werkelijkeWoz: new Decimal(1050000) }),
    ]);
    expect(leesWozHistorieCsv(db, versie.id)).toEqual({ beschikbaar: false, reden: "WOZ_SET_NIET_BEVESTIGD" });

    schrijfWozSetBevestigd(db, versie.id, true);
    const r = leesWozHistorieCsv(db, versie.id);
    if (!r.beschikbaar) throw new Error("verwacht beschikbaar");
    expect(r.aantalRegels).toBe(2);
    expect(r.csv.split("\r\n")[2]).toMatch(/^070;001;Geheel complex;2026;.*;1050000;50000;5$/);
    expect(leesWozHistorieCsv(db, versie.id, { aanslagjaarVan: 2027 })).toMatchObject({ beschikbaar: true, aantalRegels: 0 });

    schrijfWozObjecten(db, versie.id, [{ ...naarInvoer(a!), werkelijkeWoz: new Decimal(1) }]);
    expect(leesWozHistorieCsv(db, versie.id)).toEqual({ beschikbaar: false, reden: "WOZ_SET_NIET_BEVESTIGD" });
  });

  it("onbekende versie wordt geweigerd; export schrijft niets", () => {
    expect(() => leesWozHistorieCsv(db, "bestaat-niet")).toThrow(/bestaat niet/);
  });
});
