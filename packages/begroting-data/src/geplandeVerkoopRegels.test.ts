import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { leesGeplandeVerkoopBeoordeeld, schrijfGeplandeVerkoopBeoordeeld } from "./geplandeVerkoopBeoordeeld.js";
import { leesGeplandeVerkoopRegels, schrijfGeplandeVerkoopRegels, type GeplandeVerkoopRegel, type GeplandeVerkoopRegelInvoer } from "./geplandeVerkoopRegels.js";
import { openOrCreateDatabase } from "./database.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-geplande-verkoop-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NIEUWE_VERSIE_INPUT: NieuweBegrotingsversieInput = {
  originType: "NIEUW",
  bedrijfsnr: "023",
  begrotingsjaar: 2027,
  bronPeildatum: new Date(Date.UTC(2026, 6, 31)),
};

function regelInvoer(overrides: Partial<GeplandeVerkoopRegelInvoer> = {}): GeplandeVerkoopRegelInvoer {
  return {
    id: null,
    objectreferentie: "Hoofdstraat 103",
    omschrijving: "Verkoop pand Hoofdstraat 103",
    geplandeVerkoopdatum: new Date("2027-06-01T00:00:00.000Z"),
    verwachteVerkoopopbrengst: new Decimal(785000),
    verwachteBoekwaarde: new Decimal(600000),
    verwachteVerkoopkosten: new Decimal(15000),
    verwachteEinddatumHuurExploitatie: null,
    toelichting: null,
    ...overrides,
  };
}

function naarInvoer(r: GeplandeVerkoopRegel): GeplandeVerkoopRegelInvoer {
  return { ...r };
}

describe("schrijfGeplandeVerkoopRegels / leesGeplandeVerkoopRegels", () => {
  it("1. nul regels lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesGeplandeVerkoopRegels(db, versie.id)).toEqual([]);
  });

  it("2. één regel schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer()]);
    const gelezen = leesGeplandeVerkoopRegels(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]).toMatchObject({ objectreferentie: "Hoofdstraat 103", omschrijving: "Verkoop pand Hoofdstraat 103" });
    expect(gelezen[0]?.verwachteVerkoopopbrengst?.toString()).toBe("785000");
    expect(gelezen[0]?.geplandeVerkoopdatum).toEqual(new Date("2027-06-01T00:00:00.000Z"));
  });

  it("3. alle optionele velden null round-trip -> blijven null, NOOIT stilzwijgend een default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopRegels(db, versie.id, [
      regelInvoer({ verwachteVerkoopopbrengst: null, verwachteBoekwaarde: null, verwachteVerkoopkosten: null, verwachteEinddatumHuurExploitatie: null, toelichting: null }),
    ]);
    const gelezen = leesGeplandeVerkoopRegels(db, versie.id)[0]!;
    expect(gelezen.verwachteVerkoopopbrengst).toBeNull();
    expect(gelezen.verwachteBoekwaarde).toBeNull();
    expect(gelezen.verwachteVerkoopkosten).toBeNull();
    expect(gelezen.verwachteEinddatumHuurExploitatie).toBeNull();
    expect(gelezen.toelichting).toBeNull();
  });

  it("4. geplandeVerkoopdatum=null round-trip -> blijft null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer({ geplandeVerkoopdatum: null })]);
    expect(leesGeplandeVerkoopRegels(db, versie.id)[0]?.geplandeVerkoopdatum).toBeNull();
  });

  it("5. Decimal TEXT round-trip zonder number-conversie (meer precisie dan 2 decimalen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer({ verwachteVerkoopopbrengst: new Decimal("785000.1234") })]);

    const ruweRij = db
      .prepare(`SELECT verwachte_verkoopopbrengst, typeof(verwachte_verkoopopbrengst) AS bedrag_type FROM begroting_geplande_verkoop_regel WHERE begroting_versie_id = ?`)
      .get(versie.id) as { verwachte_verkoopopbrengst: string; bedrag_type: string };
    expect(ruweRij.bedrag_type).toBe("text");
    expect(ruweRij.verwachte_verkoopopbrengst).toBe("785000.1234");
    expect(leesGeplandeVerkoopRegels(db, versie.id)[0]?.verwachteVerkoopopbrengst?.toString()).toBe("785000.1234");
  });

  it("6. bewust €0 round-trip -> blijft Decimal(0), niet null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer({ verwachteVerkoopkosten: new Decimal(0) })]);
    const gelezen = leesGeplandeVerkoopRegels(db, versie.id)[0]!;
    expect(gelezen.verwachteVerkoopkosten).not.toBeNull();
    expect(gelezen.verwachteVerkoopkosten?.toString()).toBe("0");
  });

  it("7. toelichting round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer({ toelichting: "Nog in onderhandeling" })]);
    expect(leesGeplandeVerkoopRegels(db, versie.id)[0]?.toelichting).toBe("Nog in onderhandeling");
  });

  it("8. nieuwe regel krijgt persistente ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer(), regelInvoer({ objectreferentie: "Driebergen" })]);
    expect(resultaat).toHaveLength(2);
    expect(typeof resultaat[0]?.id).toBe("number");
    expect(resultaat[0]?.id).not.toBe(resultaat[1]?.id);
  });

  it("9. bestaande regel update behoudt ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer({ omschrijving: "Origineel" })]);
    const bijgewerkt = schrijfGeplandeVerkoopRegels(db, versie.id, [{ ...naarInvoer(origineel!), omschrijving: "Bijgewerkt" }]);
    expect(bijgewerkt[0]?.id).toBe(origineel!.id);
    expect(bijgewerkt[0]?.omschrijving).toBe("Bijgewerkt");
  });

  it("10. verwijderen via complete-list save verwijdert juiste regel", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [a, b] = schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer({ objectreferentie: "Blijft" }), regelInvoer({ objectreferentie: "Verdwijnt" })]);
    const resultaat = schrijfGeplandeVerkoopRegels(db, versie.id, [naarInvoer(a!)]);
    expect(resultaat).toHaveLength(1);
    expect(leesGeplandeVerkoopRegels(db, versie.id).some((x) => x.id === b!.id)).toBe(false);
  });

  it("11. ID van andere begrotingsversie -> fail-fast + rollback", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelB] = schrijfGeplandeVerkoopRegels(db, versieB.id, [regelInvoer()]);

    expect(() => schrijfGeplandeVerkoopRegels(db, versieA.id, [{ ...naarInvoer(regelB!), omschrijving: "Gekaapt" }])).toThrow(/behoort bij begrotingsversie/);
    expect(leesGeplandeVerkoopRegels(db, versieA.id)).toHaveLength(0);
  });

  it("12. onbekende bestaande ID -> fail-fast + rollback", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() => schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer({ id: 999999 })])).toThrow(/bestaat niet/);
  });

  it("13. duplicate bestaande ID in input -> fail-fast + rollback", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer({ omschrijving: "Origineel" })]);
    expect(() =>
      schrijfGeplandeVerkoopRegels(db, versie.id, [
        { ...naarInvoer(origineel!), omschrijving: "Versie 1" },
        { ...naarInvoer(origineel!), omschrijving: "Versie 2" },
      ]),
    ).toThrow(/meerdere keren voor in één save/);
    expect(leesGeplandeVerkoopRegels(db, versie.id)[0]?.omschrijving).toBe("Origineel");
  });

  it("14. save versie A wijzigt nooit versie B", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopRegels(db, versieA.id, [regelInvoer({ objectreferentie: "A1" })]);
    schrijfGeplandeVerkoopRegels(db, versieB.id, [regelInvoer({ objectreferentie: "B1" })]);
    schrijfGeplandeVerkoopRegels(db, versieA.id, [regelInvoer({ objectreferentie: "A1-gewijzigd" })]);
    expect(leesGeplandeVerkoopRegels(db, versieB.id)[0]?.objectreferentie).toBe("B1");
  });

  it("15. INSERT via de API wordt geweigerd op een VASTGESTELDE versie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer()])).toThrow(/VASTGESTELD/);
  });

  it("16. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => db.prepare(`INSERT INTO begroting_geplande_verkoop_regel (begroting_versie_id, objectreferentie, omschrijving) VALUES (?, 'x', 'y')`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE begroting_geplande_verkoop_regel SET omschrijving = 'gewijzigd' WHERE id = ?`).run(regel!.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_geplande_verkoop_regel WHERE id = ?`).run(regel!.id)).toThrow(/immutable/);
  });

  it("17. fout halverwege write -> transactie rollback, oorspronkelijke lijst blijft intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer({ objectreferentie: "001" })]);

    db.exec(
      `CREATE TRIGGER trg_test_forceer_fout_geplande_verkoop
       BEFORE INSERT ON begroting_geplande_verkoop_regel
       FOR EACH ROW
       WHEN NEW.objectreferentie = 'FOUT'
       BEGIN
         SELECT RAISE(ABORT, 'geforceerde testfout');
       END`,
    );

    try {
      expect(() => schrijfGeplandeVerkoopRegels(db, versie.id, [{ ...naarInvoer(origineel!), objectreferentie: "002" }, regelInvoer({ objectreferentie: "FOUT" })])).toThrow(/geforceerde testfout/);
    } finally {
      db.exec(`DROP TRIGGER trg_test_forceer_fout_geplande_verkoop`);
    }

    const huidig = leesGeplandeVerkoopRegels(db, versie.id);
    expect(huidig).toHaveLength(1);
    expect(huidig[0]?.objectreferentie).toBe("001");
  });

  describe("beoordeeld blijft onaangetast door regel-writes", () => {
    it("18. regel toevoegen verandert beoordeeld niet", () => {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      schrijfGeplandeVerkoopBeoordeeld(db, versie.id, true);
      schrijfGeplandeVerkoopRegels(db, versie.id, [regelInvoer()]);
      expect(leesGeplandeVerkoopBeoordeeld(db, versie.id)).toBe(true);
    });
  });
});
