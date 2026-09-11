import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import {
  leesAlgemeneKostenRegels,
  schrijfAlgemeneKostenRegels,
  type AlgemeneKostenRegel,
  type AlgemeneKostenRegelInvoer,
} from "./algemeneKostenRegels.js";
import { openOrCreateDatabase } from "./database.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-algemene-kosten-regels-"));
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

function regelInvoer(overrides: Partial<AlgemeneKostenRegelInvoer> = {}): AlgemeneKostenRegelInvoer {
  return {
    id: null,
    categorie: "JURIDISCHE_KOSTEN",
    ogbKostensoortCode: null,
    omschrijving: "Huurgeschil",
    complexnummer: null,
    jaarbedrag: new Decimal(5000),
    ...overrides,
  };
}

function naarInvoer(r: AlgemeneKostenRegel): AlgemeneKostenRegelInvoer {
  return { ...r };
}

describe("schrijfAlgemeneKostenRegels / leesAlgemeneKostenRegels", () => {
  it("1. nul regels lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesAlgemeneKostenRegels(db, versie.id)).toEqual([]);
  });

  it("2. één regel schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer()]);
    const gelezen = leesAlgemeneKostenRegels(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]).toMatchObject({ categorie: "JURIDISCHE_KOSTEN", omschrijving: "Huurgeschil" });
    expect(gelezen[0]?.jaarbedrag?.toString()).toBe("5000");
  });

  it("3. meerdere regels binnen dezelfde categorie én verspreid over meerdere categorieën", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenRegels(db, versie.id, [
      regelInvoer({ categorie: "JURIDISCHE_KOSTEN", omschrijving: "Huurgeschil" }),
      regelInvoer({ categorie: "JURIDISCHE_KOSTEN", omschrijving: "Contractadvies" }),
      regelInvoer({ categorie: "MAKELAARSKOSTEN", omschrijving: "Taxatie" }),
    ]);
    const gelezen = leesAlgemeneKostenRegels(db, versie.id);
    expect(gelezen).toHaveLength(3);
    expect(gelezen.filter((r) => r.categorie === "JURIDISCHE_KOSTEN")).toHaveLength(2);
    expect(gelezen.filter((r) => r.categorie === "MAKELAARSKOSTEN")).toHaveLength(1);
  });

  it("4. Decimal TEXT round-trip zonder number-conversie (meer precisie dan 2 decimalen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer({ jaarbedrag: new Decimal("1234.5678") })]);

    const ruweRij = db
      .prepare(`SELECT jaarbedrag, typeof(jaarbedrag) AS bedrag_type FROM begroting_algemene_kosten_regel WHERE begroting_versie_id = ?`)
      .get(versie.id) as { jaarbedrag: string; bedrag_type: string };
    expect(ruweRij.bedrag_type).toBe("text");
    expect(ruweRij.jaarbedrag).toBe("1234.5678");

    expect(leesAlgemeneKostenRegels(db, versie.id)[0]?.jaarbedrag?.toString()).toBe("1234.5678");
  });

  it("5. ogbKostensoortCode null is geldig (Accountant/Juridisch zonder bewezen mapping)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer({ categorie: "ACCOUNTANT", ogbKostensoortCode: null })]);
    expect(leesAlgemeneKostenRegels(db, versie.id)[0]?.ogbKostensoortCode).toBeNull();
  });

  it("6. ogbKostensoortCode round-trip exact wanneer aanwezig", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer({ categorie: "MAKELAARSKOSTEN", ogbKostensoortCode: "4992" })]);
    expect(leesAlgemeneKostenRegels(db, versie.id)[0]?.ogbKostensoortCode).toBe("4992");
  });

  it("7. complexnummer null en jaarbedrag null round-trippen als null, nooit stilzwijgend een default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer({ complexnummer: null, jaarbedrag: null })]);
    const gelezen = leesAlgemeneKostenRegels(db, versie.id)[0]!;
    expect(gelezen.complexnummer).toBeNull();
    expect(gelezen.jaarbedrag).toBeNull();
  });

  it("8. jaarbedrag null vs. bewuste €0 blijven onderscheiden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenRegels(db, versie.id, [
      regelInvoer({ omschrijving: "Zonder bedrag", jaarbedrag: null }),
      regelInvoer({ omschrijving: "Expliciete nul", jaarbedrag: new Decimal(0) }),
    ]);
    const gelezen = leesAlgemeneKostenRegels(db, versie.id);
    expect(gelezen.find((r) => r.omschrijving === "Zonder bedrag")?.jaarbedrag).toBeNull();
    expect(gelezen.find((r) => r.omschrijving === "Expliciete nul")?.jaarbedrag?.toString()).toBe("0");
  });

  it("9. nieuwe regel krijgt persistente ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer(), regelInvoer({ categorie: "BANKKOSTEN" })]);
    expect(resultaat).toHaveLength(2);
    expect(typeof resultaat[0]?.id).toBe("number");
    expect(resultaat[0]?.id).not.toBe(resultaat[1]?.id);
  });

  it("10. bestaande regel update behoudt ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer({ omschrijving: "Origineel" })]);
    const bijgewerkt = schrijfAlgemeneKostenRegels(db, versie.id, [{ ...naarInvoer(origineel!), omschrijving: "Bijgewerkt" }]);
    expect(bijgewerkt[0]?.id).toBe(origineel!.id);
    expect(bijgewerkt[0]?.omschrijving).toBe("Bijgewerkt");
  });

  it("10b. de onderliggende UPDATE is zelf id+begroting_versie_id-gebonden (SQL-mechanica, onafhankelijk van de vooraf-check)", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelA] = schrijfAlgemeneKostenRegels(db, versieA.id, [regelInvoer({ omschrijving: "A" })]);

    const info = db
      .prepare(`UPDATE begroting_algemene_kosten_regel SET omschrijving = 'Gekaapt' WHERE id = ? AND begroting_versie_id = ?`)
      .run(regelA!.id, versieB.id);
    expect(Number(info.changes)).toBe(0);
    expect(leesAlgemeneKostenRegels(db, versieA.id)[0]?.omschrijving).toBe("A");
  });

  it("11. verwijderen via complete-list save verwijdert juiste regel", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [a, b] = schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer({ omschrijving: "A" }), regelInvoer({ omschrijving: "B" })]);
    const resultaat = schrijfAlgemeneKostenRegels(db, versie.id, [naarInvoer(a!)]);
    expect(resultaat).toHaveLength(1);
    expect(leesAlgemeneKostenRegels(db, versie.id).some((x) => x.id === b!.id)).toBe(false);
  });

  it("12. volgorde lezen deterministisch ORDER BY id", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geschreven = schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer({ omschrijving: "A" }), regelInvoer({ omschrijving: "B" })]);
    const ids = geschreven.map((r) => r.id);
    schrijfAlgemeneKostenRegels(db, versie.id, [naarInvoer(geschreven[1]!), naarInvoer(geschreven[0]!)]);
    expect(leesAlgemeneKostenRegels(db, versie.id).map((r) => r.id)).toEqual(ids);
  });

  it("13. ID van andere begrotingsversie -> fail-fast + rollback", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelA] = schrijfAlgemeneKostenRegels(db, versieA.id, [regelInvoer({ omschrijving: "A-origineel" })]);
    const [regelB] = schrijfAlgemeneKostenRegels(db, versieB.id, [regelInvoer()]);

    expect(() =>
      schrijfAlgemeneKostenRegels(db, versieA.id, [
        { ...naarInvoer(regelA!), omschrijving: "A-zou-bijgewerkt-worden" },
        { ...naarInvoer(regelB!), omschrijving: "Gekaapt" },
      ]),
    ).toThrow(/behoort bij begrotingsversie/);

    expect(leesAlgemeneKostenRegels(db, versieA.id)[0]?.omschrijving).toBe("A-origineel");
  });

  it("14. onbekende bestaande ID -> fail-fast + rollback", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [bestaand] = schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer({ omschrijving: "Bestaat al" })]);
    expect(() =>
      schrijfAlgemeneKostenRegels(db, versie.id, [
        { ...naarInvoer(bestaand!), omschrijving: "Zou-bijgewerkt-worden" },
        regelInvoer({ id: 999999, omschrijving: "Bestaat niet" }),
      ]),
    ).toThrow(/bestaat niet/);
    expect(leesAlgemeneKostenRegels(db, versie.id)[0]?.omschrijving).toBe("Bestaat al");
  });

  it("15. duplicate bestaande ID in input -> fail-fast + rollback", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer({ omschrijving: "Origineel" })]);
    expect(() =>
      schrijfAlgemeneKostenRegels(db, versie.id, [
        { ...naarInvoer(origineel!), omschrijving: "Versie 1" },
        { ...naarInvoer(origineel!), omschrijving: "Versie 2" },
      ]),
    ).toThrow(/meerdere keren voor in één save/);
    expect(leesAlgemeneKostenRegels(db, versie.id)[0]?.omschrijving).toBe("Origineel");
  });

  it("16. save versie A wijzigt nooit versie B", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenRegels(db, versieA.id, [regelInvoer({ omschrijving: "A1" })]);
    schrijfAlgemeneKostenRegels(db, versieB.id, [regelInvoer({ omschrijving: "B1" })]);
    schrijfAlgemeneKostenRegels(db, versieA.id, [regelInvoer({ omschrijving: "A1-gewijzigd" })]);
    expect(leesAlgemeneKostenRegels(db, versieB.id)[0]?.omschrijving).toBe("B1");
  });

  it("17. INSERT via de API wordt geweigerd op een VASTGESTELDE versie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer()])).toThrow(/VASTGESTELD/);
  });

  it("18. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_algemene_kosten_regel (begroting_versie_id, categorie, omschrijving) VALUES (?, 'BANKKOSTEN', 'x')`)
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE begroting_algemene_kosten_regel SET omschrijving = 'gewijzigd' WHERE id = ?`).run(regel!.id)).toThrow(
      /immutable/,
    );
    expect(() => db.prepare(`DELETE FROM begroting_algemene_kosten_regel WHERE id = ?`).run(regel!.id)).toThrow(/immutable/);
  });

  it("19. CHECK weigert een onbekende categoriewaarde via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db.prepare(`INSERT INTO begroting_algemene_kosten_regel (begroting_versie_id, categorie, omschrijving) VALUES (?, 'ONBEKEND', 'x')`).run(
        versie.id,
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it("20. fout halverwege write -> transactie rollback, oorspronkelijke lijst blijft intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfAlgemeneKostenRegels(db, versie.id, [regelInvoer({ omschrijving: "A" })]);

    db.exec(
      `CREATE TRIGGER trg_test_forceer_fout_algemene_kosten
       BEFORE INSERT ON begroting_algemene_kosten_regel
       FOR EACH ROW
       WHEN NEW.omschrijving = 'FOUT'
       BEGIN
         SELECT RAISE(ABORT, 'geforceerde testfout');
       END`,
    );

    try {
      expect(() =>
        schrijfAlgemeneKostenRegels(db, versie.id, [{ ...naarInvoer(origineel!), omschrijving: "B" }, regelInvoer({ omschrijving: "FOUT" })]),
      ).toThrow(/geforceerde testfout/);
    } finally {
      db.exec(`DROP TRIGGER trg_test_forceer_fout_algemene_kosten`);
    }

    const huidig = leesAlgemeneKostenRegels(db, versie.id);
    expect(huidig).toHaveLength(1);
    expect(huidig[0]?.omschrijving).toBe("A");
  });
});
