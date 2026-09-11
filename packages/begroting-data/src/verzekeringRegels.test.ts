import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesVerzekeringBeoordeeld, schrijfVerzekeringBeoordeeld } from "./verzekeringBeoordeeld.js";
import {
  leesVerzekeringRegels,
  schrijfVerzekeringRegels,
  type VerzekeringRegel,
  type VerzekeringRegelInvoer,
} from "./verzekeringRegels.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-verzekering-"));
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

function regelInvoer(overrides: Partial<VerzekeringRegelInvoer> = {}): VerzekeringRegelInvoer {
  return {
    id: null,
    complexnummer: "001",
    verzekeraar: "Assuradeuren Gilde B.V.",
    ingangsdatum: new Date(Date.UTC(2020, 6, 1)),
    looptijdMaanden: 12,
    bedrag: new Decimal(1200),
    indexPercentage: new Decimal(3),
    handmatigBegrootOverride: null,
    ...overrides,
  };
}

/** Zet een gelezen regel terug om naar invoervorm (id behouden) — hulpfunctie uitsluitend voor deze tests. */
function naarInvoer(r: VerzekeringRegel): VerzekeringRegelInvoer {
  return { ...r };
}

describe("schrijfVerzekeringRegels / leesVerzekeringRegels", () => {
  it("1. nul regels lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesVerzekeringRegels(db, versie.id)).toEqual([]);
  });

  it("2. één regel schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfVerzekeringRegels(db, versie.id, [regelInvoer()]);
    const gelezen = leesVerzekeringRegels(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]).toMatchObject({ complexnummer: "001", verzekeraar: "Assuradeuren Gilde B.V.", looptijdMaanden: 12 });
    expect(gelezen[0]?.bedrag?.toString()).toBe("1200");
    expect(gelezen[0]?.indexPercentage?.toString()).toBe("3");
    expect(gelezen[0]?.ingangsdatum).toEqual(new Date(Date.UTC(2020, 6, 1)));
  });

  it("3. meerdere regels schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfVerzekeringRegels(db, versie.id, [regelInvoer({ complexnummer: "001" }), regelInvoer({ complexnummer: "002" })]);
    const gelezen = leesVerzekeringRegels(db, versie.id);
    expect(gelezen).toHaveLength(2);
    expect(gelezen.map((r) => r.complexnummer)).toEqual(["001", "002"]);
  });

  it("4. Decimal TEXT round-trip zonder number-conversie (meer precisie dan 2 decimalen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfVerzekeringRegels(db, versie.id, [regelInvoer({ bedrag: new Decimal("1234.5678"), indexPercentage: new Decimal("2.125") })]);

    const ruweRij = db
      .prepare(`SELECT bedrag, typeof(bedrag) AS bedrag_type, index_percentage FROM begroting_verzekering_regel WHERE begroting_versie_id = ?`)
      .get(versie.id) as { bedrag: string; bedrag_type: string; index_percentage: string };
    expect(ruweRij.bedrag_type).toBe("text");
    expect(ruweRij.bedrag).toBe("1234.5678");
    expect(ruweRij.index_percentage).toBe("2.125");

    const gelezen = leesVerzekeringRegels(db, versie.id);
    expect(gelezen[0]?.bedrag?.toString()).toBe("1234.5678");
  });

  it("5. ingangsdatum round-trip als YYYY-MM-DD, geen tijdzone-drift", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfVerzekeringRegels(db, versie.id, [regelInvoer({ ingangsdatum: new Date(Date.UTC(2026, 0, 31)) })]);

    const ruweRij = db.prepare(`SELECT ingangsdatum FROM begroting_verzekering_regel WHERE begroting_versie_id = ?`).get(versie.id) as {
      ingangsdatum: string;
    };
    expect(ruweRij.ingangsdatum).toBe("2026-01-31");

    expect(leesVerzekeringRegels(db, versie.id)[0]?.ingangsdatum).toEqual(new Date(Date.UTC(2026, 0, 31)));
  });

  it("6. alle vier rekenkritische velden null round-trippen als null, NOOIT stilzwijgend een default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfVerzekeringRegels(db, versie.id, [
      regelInvoer({ ingangsdatum: null, looptijdMaanden: null, bedrag: null, indexPercentage: null }),
    ]);
    const gelezen = leesVerzekeringRegels(db, versie.id)[0]!;
    expect(gelezen.ingangsdatum).toBeNull();
    expect(gelezen.looptijdMaanden).toBeNull();
    expect(gelezen.bedrag).toBeNull();
    expect(gelezen.indexPercentage).toBeNull();
  });

  it("7. complexnummer=null en verzekeraar=null (tijdelijk concept-onvolledig) round-trippen als null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfVerzekeringRegels(db, versie.id, [regelInvoer({ complexnummer: null, verzekeraar: null })]);
    const gelezen = leesVerzekeringRegels(db, versie.id)[0]!;
    expect(gelezen.complexnummer).toBeNull();
    expect(gelezen.verzekeraar).toBeNull();
  });

  it("8. handmatigBegrootOverride null vs. bewuste €0 blijven onderscheiden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfVerzekeringRegels(db, versie.id, [
      regelInvoer({ complexnummer: "001", handmatigBegrootOverride: null }),
      regelInvoer({ complexnummer: "002", handmatigBegrootOverride: new Decimal(0) }),
    ]);
    const gelezen = leesVerzekeringRegels(db, versie.id);
    expect(gelezen.find((r) => r.complexnummer === "001")?.handmatigBegrootOverride).toBeNull();
    expect(gelezen.find((r) => r.complexnummer === "002")?.handmatigBegrootOverride?.toString()).toBe("0");
  });

  it("9. nieuwe regel krijgt persistente ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = schrijfVerzekeringRegels(db, versie.id, [regelInvoer(), regelInvoer({ complexnummer: "002" })]);
    expect(resultaat).toHaveLength(2);
    expect(typeof resultaat[0]?.id).toBe("number");
    expect(typeof resultaat[1]?.id).toBe("number");
    expect(resultaat[0]?.id).not.toBe(resultaat[1]?.id);
  });

  it("10. bestaande regel update behoudt ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfVerzekeringRegels(db, versie.id, [regelInvoer({ verzekeraar: "Origineel" })]);

    const bijgewerkt = schrijfVerzekeringRegels(db, versie.id, [{ ...naarInvoer(origineel!), verzekeraar: "Bijgewerkt" }]);

    expect(bijgewerkt).toHaveLength(1);
    expect(bijgewerkt[0]?.id).toBe(origineel!.id);
    expect(bijgewerkt[0]?.verzekeraar).toBe("Bijgewerkt");
  });

  it("10b. de onderliggende UPDATE is zelf id+begroting_versie_id-gebonden (SQL-mechanica, onafhankelijk van de vooraf-check)", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelA] = schrijfVerzekeringRegels(db, versieA.id, [regelInvoer({ verzekeraar: "A" })]);

    const info = db
      .prepare(`UPDATE begroting_verzekering_regel SET verzekeraar = 'Gekaapt' WHERE id = ? AND begroting_versie_id = ?`)
      .run(regelA!.id, versieB.id);
    expect(Number(info.changes)).toBe(0);
    expect(leesVerzekeringRegels(db, versieA.id)[0]?.verzekeraar).toBe("A");
  });

  it("11. verwijderen via complete-list save verwijdert juiste regel", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [a, b] = schrijfVerzekeringRegels(db, versie.id, [regelInvoer({ complexnummer: "001" }), regelInvoer({ complexnummer: "002" })]);

    const resultaat = schrijfVerzekeringRegels(db, versie.id, [naarInvoer(a!)]);

    expect(resultaat).toHaveLength(1);
    expect(resultaat[0]?.id).toBe(a!.id);
    expect(leesVerzekeringRegels(db, versie.id).some((x) => x.id === b!.id)).toBe(false);
  });

  it("12. volgorde lezen deterministisch ORDER BY id", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geschreven = schrijfVerzekeringRegels(db, versie.id, [
      regelInvoer({ complexnummer: "001" }),
      regelInvoer({ complexnummer: "002" }),
      regelInvoer({ complexnummer: "003" }),
    ]);
    const ids = geschreven.map((r) => r.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));

    schrijfVerzekeringRegels(db, versie.id, [naarInvoer(geschreven[2]!), naarInvoer(geschreven[0]!), naarInvoer(geschreven[1]!)]);
    expect(leesVerzekeringRegels(db, versie.id).map((r) => r.id)).toEqual(ids);
  });

  it("13. ID van andere begrotingsversie -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelA] = schrijfVerzekeringRegels(db, versieA.id, [regelInvoer({ verzekeraar: "A-origineel" })]);
    const [regelB] = schrijfVerzekeringRegels(db, versieB.id, [regelInvoer()]);

    expect(() =>
      schrijfVerzekeringRegels(db, versieA.id, [
        { ...naarInvoer(regelA!), verzekeraar: "A-zou-bijgewerkt-worden" },
        regelInvoer({ complexnummer: "999", verzekeraar: "Zou-nieuw-worden" }),
        { ...naarInvoer(regelB!), verzekeraar: "Gekaapt" },
      ]),
    ).toThrow(/behoort bij begrotingsversie/);

    const huidigA = leesVerzekeringRegels(db, versieA.id);
    expect(huidigA).toHaveLength(1);
    expect(huidigA[0]?.verzekeraar).toBe("A-origineel");
    expect(leesVerzekeringRegels(db, versieB.id)[0]?.verzekeraar).toBe(regelB!.verzekeraar);
  });

  it("14. onbekende bestaande ID -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [bestaand] = schrijfVerzekeringRegels(db, versie.id, [regelInvoer({ verzekeraar: "Bestaat al" })]);

    expect(() =>
      schrijfVerzekeringRegels(db, versie.id, [
        { ...naarInvoer(bestaand!), verzekeraar: "Zou-bijgewerkt-worden" },
        regelInvoer({ id: 999999, verzekeraar: "Bestaat niet" }),
      ]),
    ).toThrow(/bestaat niet/);

    expect(leesVerzekeringRegels(db, versie.id)).toHaveLength(1);
    expect(leesVerzekeringRegels(db, versie.id)[0]?.verzekeraar).toBe("Bestaat al");
  });

  it("15. duplicate bestaande ID in input -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfVerzekeringRegels(db, versie.id, [regelInvoer({ verzekeraar: "Origineel" })]);

    expect(() =>
      schrijfVerzekeringRegels(db, versie.id, [
        { ...naarInvoer(origineel!), verzekeraar: "Versie 1" },
        { ...naarInvoer(origineel!), verzekeraar: "Versie 2" },
        regelInvoer({ complexnummer: "999", verzekeraar: "Zou-nieuw-worden" }),
      ]),
    ).toThrow(/meerdere keren voor in één save/);

    expect(leesVerzekeringRegels(db, versie.id)).toHaveLength(1);
    expect(leesVerzekeringRegels(db, versie.id)[0]?.verzekeraar).toBe("Origineel");
  });

  it("16. save versie A wijzigt nooit versie B", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfVerzekeringRegels(db, versieA.id, [regelInvoer({ verzekeraar: "A1" })]);
    schrijfVerzekeringRegels(db, versieB.id, [regelInvoer({ verzekeraar: "B1" })]);

    schrijfVerzekeringRegels(db, versieA.id, [regelInvoer({ verzekeraar: "A1-gewijzigd" }), regelInvoer({ verzekeraar: "A2-nieuw" })]);

    expect(leesVerzekeringRegels(db, versieB.id)).toHaveLength(1);
    expect(leesVerzekeringRegels(db, versieB.id)[0]?.verzekeraar).toBe("B1");
  });

  it("17. INSERT via de API wordt geweigerd op een VASTGESTELDE versie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfVerzekeringRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfVerzekeringRegels(db, versie.id, [regelInvoer()])).toThrow(/VASTGESTELD/);
  });

  it("18. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfVerzekeringRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_verzekering_regel (begroting_versie_id, complexnummer) VALUES (?, '001')`)
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE begroting_verzekering_regel SET verzekeraar = 'gewijzigd' WHERE id = ?`).run(regel!.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_verzekering_regel WHERE id = ?`).run(regel!.id)).toThrow(/immutable/);
  });

  it("19. fout halverwege write -> transactie rollback, oorspronkelijke lijst blijft intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfVerzekeringRegels(db, versie.id, [regelInvoer({ complexnummer: "001" })]);

    db.exec(
      `CREATE TRIGGER trg_test_forceer_fout
       BEFORE INSERT ON begroting_verzekering_regel
       FOR EACH ROW
       WHEN NEW.complexnummer = 'FOUT'
       BEGIN
         SELECT RAISE(ABORT, 'geforceerde testfout');
       END`,
    );

    try {
      expect(() =>
        schrijfVerzekeringRegels(db, versie.id, [{ ...naarInvoer(origineel!), complexnummer: "002" }, regelInvoer({ complexnummer: "FOUT" })]),
      ).toThrow(/geforceerde testfout/);
    } finally {
      db.exec(`DROP TRIGGER trg_test_forceer_fout`);
    }

    const huidig = leesVerzekeringRegels(db, versie.id);
    expect(huidig).toHaveLength(1);
    expect(huidig[0]?.complexnummer).toBe("001");
  });

  describe("beoordeeld blijft onaangetast door regel-writes", () => {
    it("20. regel toevoegen verandert beoordeeld niet", () => {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      schrijfVerzekeringBeoordeeld(db, versie.id, true);
      schrijfVerzekeringRegels(db, versie.id, [regelInvoer()]);
      expect(leesVerzekeringBeoordeeld(db, versie.id)).toBe(true);
    });

    it("21. regel wijzigen verandert beoordeeld niet", () => {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      const [r] = schrijfVerzekeringRegels(db, versie.id, [regelInvoer()]);
      schrijfVerzekeringBeoordeeld(db, versie.id, true);
      schrijfVerzekeringRegels(db, versie.id, [{ ...naarInvoer(r!), verzekeraar: "gewijzigd" }]);
      expect(leesVerzekeringBeoordeeld(db, versie.id)).toBe(true);
    });

    it("22. regel verwijderen verandert beoordeeld niet", () => {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      schrijfVerzekeringRegels(db, versie.id, [regelInvoer()]);
      schrijfVerzekeringBeoordeeld(db, versie.id, true);
      schrijfVerzekeringRegels(db, versie.id, []);
      expect(leesVerzekeringBeoordeeld(db, versie.id)).toBe(true);
    });
  });
});
