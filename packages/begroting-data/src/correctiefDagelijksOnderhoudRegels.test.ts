import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import {
  leesCorrectiefDagelijksOnderhoudBeoordeeld,
  schrijfCorrectiefDagelijksOnderhoudBeoordeeld,
} from "./correctiefDagelijksOnderhoudBeoordeeld.js";
import {
  leesCorrectiefDagelijksOnderhoudRegels,
  schrijfCorrectiefDagelijksOnderhoudRegels,
  type CorrectiefDagelijksOnderhoudRegel,
  type CorrectiefDagelijksOnderhoudRegelInvoer,
} from "./correctiefDagelijksOnderhoudRegels.js";
import { openOrCreateDatabase } from "./database.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-correctief-dagelijks-onderhoud-"));
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
  return {
    id: null,
    omschrijving: "Reparatie CV-installatie",
    complexnummer: "003",
    jaarbedrag: new Decimal(1200),
    ...overrides,
  };
}

/** Zet een gelezen regel terug om naar invoervorm (id behouden) — hulpfunctie uitsluitend voor deze tests. */
function naarInvoer(r: CorrectiefDagelijksOnderhoudRegel): CorrectiefDagelijksOnderhoudRegelInvoer {
  return { ...r };
}

describe("schrijfCorrectiefDagelijksOnderhoudRegels / leesCorrectiefDagelijksOnderhoudRegels", () => {
  it("1. nul regels lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versie.id)).toEqual([]);
  });

  it("2. één regel schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    const gelezen = leesCorrectiefDagelijksOnderhoudRegels(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]).toMatchObject({ omschrijving: "Reparatie CV-installatie", complexnummer: "003" });
    expect(gelezen[0]?.jaarbedrag?.toString()).toBe("1200");
  });

  it("3. meerdere regels schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [
      regelInvoer({ omschrijving: "A" }),
      regelInvoer({ omschrijving: "B" }),
    ]);
    const gelezen = leesCorrectiefDagelijksOnderhoudRegels(db, versie.id);
    expect(gelezen).toHaveLength(2);
    expect(gelezen.map((r) => r.omschrijving)).toEqual(["A", "B"]);
  });

  it("4. Decimal TEXT round-trip zonder number-conversie (meer precisie dan 2 decimalen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ jaarbedrag: new Decimal("1234.5678") })]);

    const ruweRij = db
      .prepare(
        `SELECT jaarbedrag, typeof(jaarbedrag) AS jaarbedrag_type FROM begroting_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = ?`,
      )
      .get(versie.id) as { jaarbedrag: string; jaarbedrag_type: string };
    expect(ruweRij.jaarbedrag_type).toBe("text");
    expect(ruweRij.jaarbedrag).toBe("1234.5678");

    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versie.id)[0]?.jaarbedrag?.toString()).toBe("1234.5678");
  });

  it("5. jaarbedrag=null round-trip -> blijft null, NOOIT stilzwijgend Decimal(0)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ jaarbedrag: null })]);

    const ruweRij = db
      .prepare(`SELECT jaarbedrag FROM begroting_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = ?`)
      .get(versie.id) as { jaarbedrag: string | null };
    expect(ruweRij.jaarbedrag).toBeNull();

    const gelezen = leesCorrectiefDagelijksOnderhoudRegels(db, versie.id)[0]!;
    expect(gelezen.jaarbedrag).toBeNull();
  });

  it("6. jaarbedrag bewust €0 round-trip -> blijft Decimal(0), niet null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ jaarbedrag: new Decimal(0) })]);
    const gelezen = leesCorrectiefDagelijksOnderhoudRegels(db, versie.id)[0]!;
    expect(gelezen.jaarbedrag).not.toBeNull();
    expect(gelezen.jaarbedrag?.toString()).toBe("0");
  });

  it("7. complexnummer=null (NTB) round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ complexnummer: null })]);
    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versie.id)[0]?.complexnummer).toBeNull();
  });

  it("8. nieuwe regel krijgt persistente ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer(), regelInvoer({ omschrijving: "Tweede" })]);
    expect(resultaat).toHaveLength(2);
    expect(typeof resultaat[0]?.id).toBe("number");
    expect(typeof resultaat[1]?.id).toBe("number");
    expect(resultaat[0]?.id).not.toBe(resultaat[1]?.id);
  });

  it("9. bestaande regel update behoudt ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ omschrijving: "Origineel" })]);

    const bijgewerkt = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [
      { ...naarInvoer(origineel!), omschrijving: "Bijgewerkt" },
    ]);

    expect(bijgewerkt).toHaveLength(1);
    expect(bijgewerkt[0]?.id).toBe(origineel!.id);
    expect(bijgewerkt[0]?.omschrijving).toBe("Bijgewerkt");
  });

  it("9b. de onderliggende UPDATE is zelf id+begroting_versie_id-gebonden (SQL-mechanica, onafhankelijk van de vooraf-check)", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelA] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versieA.id, [regelInvoer({ omschrijving: "A" })]);

    const info = db
      .prepare(`UPDATE begroting_correctief_dagelijks_onderhoud_regel SET omschrijving = 'Gekaapt' WHERE id = ? AND begroting_versie_id = ?`)
      .run(regelA!.id, versieB.id);
    expect(Number(info.changes)).toBe(0);
    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versieA.id)[0]?.omschrijving).toBe("A");
  });

  it("10. verwijderen via complete-list save verwijdert juiste regel", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [a, b] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [
      regelInvoer({ omschrijving: "Blijft" }),
      regelInvoer({ omschrijving: "Verdwijnt" }),
    ]);

    const resultaat = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [naarInvoer(a!)]);

    expect(resultaat).toHaveLength(1);
    expect(resultaat[0]?.id).toBe(a!.id);
    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versie.id).some((x) => x.id === b!.id)).toBe(false);
  });

  it("11. volgorde lezen deterministisch ORDER BY id", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geschreven = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [
      regelInvoer({ omschrijving: "Eerste" }),
      regelInvoer({ omschrijving: "Tweede" }),
      regelInvoer({ omschrijving: "Derde" }),
    ]);
    const ids = geschreven.map((r) => r.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));

    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [naarInvoer(geschreven[2]!), naarInvoer(geschreven[0]!), naarInvoer(geschreven[1]!)]);
    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versie.id).map((r) => r.id)).toEqual(ids);
  });

  it("12. ID van andere begrotingsversie -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelA] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versieA.id, [regelInvoer({ omschrijving: "A-origineel" })]);
    const [regelB] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versieB.id, [regelInvoer()]);

    expect(() =>
      schrijfCorrectiefDagelijksOnderhoudRegels(db, versieA.id, [
        { ...naarInvoer(regelA!), omschrijving: "A-zou-bijgewerkt-worden" },
        regelInvoer({ omschrijving: "Zou-nieuw-worden" }),
        { ...naarInvoer(regelB!), omschrijving: "Gekaapt" },
      ]),
    ).toThrow(/behoort bij begrotingsversie/);

    const huidigA = leesCorrectiefDagelijksOnderhoudRegels(db, versieA.id);
    expect(huidigA).toHaveLength(1);
    expect(huidigA[0]?.omschrijving).toBe("A-origineel");
    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versieB.id)[0]?.omschrijving).toBe(regelB!.omschrijving);
  });

  it("13. onbekende bestaande ID -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [bestaand] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ omschrijving: "Bestaat al" })]);

    expect(() =>
      schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [
        { ...naarInvoer(bestaand!), omschrijving: "Zou-bijgewerkt-worden" },
        regelInvoer({ id: 999999, omschrijving: "Bestaat niet" }),
      ]),
    ).toThrow(/bestaat niet/);

    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versie.id)).toHaveLength(1);
    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versie.id)[0]?.omschrijving).toBe("Bestaat al");
  });

  it("14. duplicate bestaande ID in input -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ omschrijving: "Origineel" })]);

    expect(() =>
      schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [
        { ...naarInvoer(origineel!), omschrijving: "Versie 1" },
        { ...naarInvoer(origineel!), omschrijving: "Versie 2" },
        regelInvoer({ omschrijving: "Zou-nieuw-worden" }),
      ]),
    ).toThrow(/meerdere keren voor in één save/);

    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versie.id)).toHaveLength(1);
    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versie.id)[0]?.omschrijving).toBe("Origineel");
  });

  it("15. save versie A wijzigt nooit versie B", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versieA.id, [regelInvoer({ omschrijving: "A1" })]);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versieB.id, [regelInvoer({ omschrijving: "B1" })]);

    schrijfCorrectiefDagelijksOnderhoudRegels(db, versieA.id, [
      regelInvoer({ omschrijving: "A1-gewijzigd" }),
      regelInvoer({ omschrijving: "A2-nieuw" }),
    ]);

    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versieB.id)).toHaveLength(1);
    expect(leesCorrectiefDagelijksOnderhoudRegels(db, versieB.id)[0]?.omschrijving).toBe("B1");
  });

  it("16. INSERT via de API wordt geweigerd op een VASTGESTELDE versie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()])).toThrow(/VASTGESTELD/);
  });

  it("17. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_correctief_dagelijks_onderhoud_regel (begroting_versie_id, omschrijving, complexnummer, jaarbedrag)
           VALUES (?, 'test', '001', '0')`,
        )
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`UPDATE begroting_correctief_dagelijks_onderhoud_regel SET omschrijving = 'gewijzigd' WHERE id = ?`).run(regel!.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_correctief_dagelijks_onderhoud_regel WHERE id = ?`).run(regel!.id)).toThrow(/immutable/);
  });

  it("18. fout halverwege write -> transactie rollback, oorspronkelijke lijst blijft intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ complexnummer: "001" })]);

    db.exec(
      `CREATE TRIGGER trg_test_forceer_fout
       BEFORE INSERT ON begroting_correctief_dagelijks_onderhoud_regel
       FOR EACH ROW
       WHEN NEW.complexnummer = 'FOUT'
       BEGIN
         SELECT RAISE(ABORT, 'geforceerde testfout');
       END`,
    );

    try {
      expect(() =>
        schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [
          { ...naarInvoer(origineel!), complexnummer: "002" },
          regelInvoer({ complexnummer: "FOUT" }),
        ]),
      ).toThrow(/geforceerde testfout/);
    } finally {
      db.exec(`DROP TRIGGER trg_test_forceer_fout`);
    }

    const huidig = leesCorrectiefDagelijksOnderhoudRegels(db, versie.id);
    expect(huidig).toHaveLength(1);
    expect(huidig[0]?.complexnummer).toBe("001");
  });

  describe("beoordeeld blijft onaangetast door regel-writes", () => {
    it("19. regel toevoegen verandert beoordeeld niet", () => {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
      schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
      expect(leesCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id)).toBe(true);
    });

    it("20. regel wijzigen verandert beoordeeld niet", () => {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      const [r] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
      schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
      schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [{ ...naarInvoer(r!), omschrijving: "gewijzigd" }]);
      expect(leesCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id)).toBe(true);
    });

    it("21. regel verwijderen verandert beoordeeld niet", () => {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
      schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
      schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, []);
      expect(leesCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id)).toBe(true);
    });
  });
});
