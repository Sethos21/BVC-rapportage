import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesLeegstandRegels, schrijfLeegstandRegels, type LeegstandRegel, type LeegstandRegelInvoer } from "./leegstandRegels.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-leegstand-regels-"));
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

function regelInvoer(overrides: Partial<LeegstandRegelInvoer> = {}): LeegstandRegelInvoer {
  return {
    id: null,
    categorie: "SERVICEKOSTEN_LEEGSTAND",
    complexnummer: "003",
    complexomschrijving: "Rooise Zoom III",
    omschrijving: "Servicekosten leegstand unit 0002",
    q1: new Decimal(1000),
    q2: new Decimal(1000),
    q3: new Decimal(1000),
    q4: new Decimal(1000),
    ...overrides,
  };
}

function naarInvoer(r: LeegstandRegel): LeegstandRegelInvoer {
  return { ...r };
}

describe("schrijfLeegstandRegels / leesLeegstandRegels", () => {
  it("1. nul regels lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesLeegstandRegels(db, versie.id)).toEqual([]);
  });

  it("2. één regel schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandRegels(db, versie.id, [regelInvoer()]);
    const gelezen = leesLeegstandRegels(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]).toMatchObject({ categorie: "SERVICEKOSTEN_LEEGSTAND", complexnummer: "003", complexomschrijving: "Rooise Zoom III" });
    expect(gelezen[0]?.q1?.toString()).toBe("1000");
  });

  it("3. meerdere regels binnen dezelfde categorie én verspreid over meerdere categorieën", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandRegels(db, versie.id, [
      regelInvoer({ categorie: "NUTS_LEEGSTAND", omschrijving: "Gas" }),
      regelInvoer({ categorie: "NUTS_LEEGSTAND", omschrijving: "Elektra" }),
      regelInvoer({ categorie: "OVERIGE_LEEGSTANDSKOSTEN", omschrijving: "Beveiliging" }),
    ]);
    const gelezen = leesLeegstandRegels(db, versie.id);
    expect(gelezen).toHaveLength(3);
    expect(gelezen.filter((r) => r.categorie === "NUTS_LEEGSTAND")).toHaveLength(2);
    expect(gelezen.filter((r) => r.categorie === "OVERIGE_LEEGSTANDSKOSTEN")).toHaveLength(1);
  });

  it("4. Decimal TEXT round-trip zonder number-conversie (meer precisie dan 2 decimalen) voor alle vier kwartalen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandRegels(db, versie.id, [regelInvoer({ q1: new Decimal("1234.5678"), q2: new Decimal("1"), q3: new Decimal("2"), q4: new Decimal("3") })]);

    const ruweRij = db.prepare(`SELECT q1, typeof(q1) AS q1_type FROM begroting_leegstand_regel WHERE begroting_versie_id = ?`).get(versie.id) as {
      q1: string;
      q1_type: string;
    };
    expect(ruweRij.q1_type).toBe("text");
    expect(ruweRij.q1).toBe("1234.5678");

    expect(leesLeegstandRegels(db, versie.id)[0]?.q1?.toString()).toBe("1234.5678");
  });

  it("5. complexnummer/complexomschrijving null is geldig (NTB)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandRegels(db, versie.id, [regelInvoer({ complexnummer: null, complexomschrijving: null })]);
    const gelezen = leesLeegstandRegels(db, versie.id)[0]!;
    expect(gelezen.complexnummer).toBeNull();
    expect(gelezen.complexomschrijving).toBeNull();
  });

  it("6. complexomschrijving round-trip exact wanneer aanwezig, puur presentatie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandRegels(db, versie.id, [regelInvoer({ complexnummer: "001", complexomschrijving: "Rooise Zoom I" })]);
    const gelezen = leesLeegstandRegels(db, versie.id)[0]!;
    expect(gelezen.complexnummer).toBe("001");
    expect(gelezen.complexomschrijving).toBe("Rooise Zoom I");
  });

  it("7. elk van Q1-Q4 null round-trippen als null, nooit stilzwijgend een default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandRegels(db, versie.id, [regelInvoer({ q1: null, q2: null, q3: null, q4: null })]);
    const gelezen = leesLeegstandRegels(db, versie.id)[0]!;
    expect(gelezen.q1).toBeNull();
    expect(gelezen.q2).toBeNull();
    expect(gelezen.q3).toBeNull();
    expect(gelezen.q4).toBeNull();
  });

  it("8. q1 null vs. bewuste €0 blijven onderscheiden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandRegels(db, versie.id, [
      regelInvoer({ omschrijving: "Zonder bedrag", q1: null }),
      regelInvoer({ omschrijving: "Expliciete nul", q1: new Decimal(0) }),
    ]);
    const gelezen = leesLeegstandRegels(db, versie.id);
    expect(gelezen.find((r) => r.omschrijving === "Zonder bedrag")?.q1).toBeNull();
    expect(gelezen.find((r) => r.omschrijving === "Expliciete nul")?.q1?.toString()).toBe("0");
  });

  it("9. nieuwe regel krijgt persistente ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = schrijfLeegstandRegels(db, versie.id, [regelInvoer(), regelInvoer({ categorie: "NUTS_LEEGSTAND" })]);
    expect(resultaat).toHaveLength(2);
    expect(typeof resultaat[0]?.id).toBe("number");
    expect(resultaat[0]?.id).not.toBe(resultaat[1]?.id);
  });

  it("10. bestaande regel update behoudt ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfLeegstandRegels(db, versie.id, [regelInvoer({ omschrijving: "Origineel" })]);
    const bijgewerkt = schrijfLeegstandRegels(db, versie.id, [{ ...naarInvoer(origineel!), omschrijving: "Bijgewerkt" }]);
    expect(bijgewerkt[0]?.id).toBe(origineel!.id);
    expect(bijgewerkt[0]?.omschrijving).toBe("Bijgewerkt");
  });

  it("10b. de onderliggende UPDATE is zelf id+begroting_versie_id-gebonden (SQL-mechanica, onafhankelijk van de vooraf-check)", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelA] = schrijfLeegstandRegels(db, versieA.id, [regelInvoer({ omschrijving: "A" })]);

    const info = db.prepare(`UPDATE begroting_leegstand_regel SET omschrijving = 'Gekaapt' WHERE id = ? AND begroting_versie_id = ?`).run(regelA!.id, versieB.id);
    expect(Number(info.changes)).toBe(0);
    expect(leesLeegstandRegels(db, versieA.id)[0]?.omschrijving).toBe("A");
  });

  it("11. verwijderen via complete-list save verwijdert juiste regel", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [a, b] = schrijfLeegstandRegels(db, versie.id, [regelInvoer({ omschrijving: "A" }), regelInvoer({ omschrijving: "B" })]);
    const resultaat = schrijfLeegstandRegels(db, versie.id, [naarInvoer(a!)]);
    expect(resultaat).toHaveLength(1);
    expect(leesLeegstandRegels(db, versie.id).some((x) => x.id === b!.id)).toBe(false);
  });

  it("12. volgorde lezen deterministisch ORDER BY id", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geschreven = schrijfLeegstandRegels(db, versie.id, [regelInvoer({ omschrijving: "A" }), regelInvoer({ omschrijving: "B" })]);
    const ids = geschreven.map((r) => r.id);
    schrijfLeegstandRegels(db, versie.id, [naarInvoer(geschreven[1]!), naarInvoer(geschreven[0]!)]);
    expect(leesLeegstandRegels(db, versie.id).map((r) => r.id)).toEqual(ids);
  });

  it("13. ID van andere begrotingsversie -> fail-fast + rollback", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelA] = schrijfLeegstandRegels(db, versieA.id, [regelInvoer({ omschrijving: "A-origineel" })]);
    const [regelB] = schrijfLeegstandRegels(db, versieB.id, [regelInvoer()]);

    expect(() =>
      schrijfLeegstandRegels(db, versieA.id, [
        { ...naarInvoer(regelA!), omschrijving: "A-zou-bijgewerkt-worden" },
        { ...naarInvoer(regelB!), omschrijving: "Gekaapt" },
      ]),
    ).toThrow(/behoort bij begrotingsversie/);

    expect(leesLeegstandRegels(db, versieA.id)[0]?.omschrijving).toBe("A-origineel");
  });

  it("14. onbekende bestaande ID -> fail-fast + rollback", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [bestaand] = schrijfLeegstandRegels(db, versie.id, [regelInvoer({ omschrijving: "Bestaat al" })]);
    expect(() =>
      schrijfLeegstandRegels(db, versie.id, [
        { ...naarInvoer(bestaand!), omschrijving: "Zou-bijgewerkt-worden" },
        regelInvoer({ id: 999999, omschrijving: "Bestaat niet" }),
      ]),
    ).toThrow(/bestaat niet/);
    expect(leesLeegstandRegels(db, versie.id)[0]?.omschrijving).toBe("Bestaat al");
  });

  it("15. duplicate bestaande ID in input -> fail-fast + rollback", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfLeegstandRegels(db, versie.id, [regelInvoer({ omschrijving: "Origineel" })]);
    expect(() =>
      schrijfLeegstandRegels(db, versie.id, [
        { ...naarInvoer(origineel!), omschrijving: "Versie 1" },
        { ...naarInvoer(origineel!), omschrijving: "Versie 2" },
      ]),
    ).toThrow(/meerdere keren voor in één save/);
    expect(leesLeegstandRegels(db, versie.id)[0]?.omschrijving).toBe("Origineel");
  });

  it("16. save versie A wijzigt nooit versie B", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandRegels(db, versieA.id, [regelInvoer({ omschrijving: "A1" })]);
    schrijfLeegstandRegels(db, versieB.id, [regelInvoer({ omschrijving: "B1" })]);
    schrijfLeegstandRegels(db, versieA.id, [regelInvoer({ omschrijving: "A1-gewijzigd" })]);
    expect(leesLeegstandRegels(db, versieB.id)[0]?.omschrijving).toBe("B1");
  });

  it("17. INSERT via de API wordt geweigerd op een VASTGESTELDE versie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfLeegstandRegels(db, versie.id, [regelInvoer()])).toThrow(/VASTGESTELD/);
  });

  it("18. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfLeegstandRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db.prepare(`INSERT INTO begroting_leegstand_regel (begroting_versie_id, categorie, omschrijving) VALUES (?, 'NUTS_LEEGSTAND', 'x')`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE begroting_leegstand_regel SET omschrijving = 'gewijzigd' WHERE id = ?`).run(regel!.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_leegstand_regel WHERE id = ?`).run(regel!.id)).toThrow(/immutable/);
  });

  it("19. CHECK weigert een onbekende categoriewaarde via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db.prepare(`INSERT INTO begroting_leegstand_regel (begroting_versie_id, categorie, omschrijving) VALUES (?, 'ONBEKEND', 'x')`).run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("20. fout halverwege write -> transactie rollback, oorspronkelijke lijst blijft intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfLeegstandRegels(db, versie.id, [regelInvoer({ omschrijving: "A" })]);

    db.exec(
      `CREATE TRIGGER trg_test_forceer_fout_leegstand
       BEFORE INSERT ON begroting_leegstand_regel
       FOR EACH ROW
       WHEN NEW.omschrijving = 'FOUT'
       BEGIN
         SELECT RAISE(ABORT, 'geforceerde testfout');
       END`,
    );

    try {
      expect(() => schrijfLeegstandRegels(db, versie.id, [{ ...naarInvoer(origineel!), omschrijving: "B" }, regelInvoer({ omschrijving: "FOUT" })])).toThrow(
        /geforceerde testfout/,
      );
    } finally {
      db.exec(`DROP TRIGGER trg_test_forceer_fout_leegstand`);
    }

    const huidig = leesLeegstandRegels(db, versie.id);
    expect(huidig).toHaveLength(1);
    expect(huidig[0]?.omschrijving).toBe("A");
  });
});
