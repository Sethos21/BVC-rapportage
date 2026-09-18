import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesRenteRegels, schrijfRenteRegels, type RenteRegel, type RenteRegelInvoer } from "./renteRegels.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-rente-regels-"));
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

function regelInvoer(overrides: Partial<RenteRegelInvoer> = {}): RenteRegelInvoer {
  return {
    id: null,
    categorie: "RENTEKOSTEN",
    omschrijving: "Lening 747",
    complexnummer: null,
    ogbReferentie: null,
    laatstBekendSaldo: null,
    rentepercentage: null,
    begrotingsbedrag: new Decimal(350000),
    ...overrides,
  };
}

function naarInvoer(r: RenteRegel): RenteRegelInvoer {
  return { ...r };
}

describe("schrijfRenteRegels / leesRenteRegels", () => {
  it("1. nul regels lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesRenteRegels(db, versie.id)).toEqual([]);
  });

  it("2. één regel schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteRegels(db, versie.id, [regelInvoer()]);
    const gelezen = leesRenteRegels(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]).toMatchObject({ categorie: "RENTEKOSTEN", omschrijving: "Lening 747" });
    expect(gelezen[0]?.begrotingsbedrag?.toString()).toBe("350000");
  });

  it("3. meerdere regels binnen dezelfde categorie én verspreid over meerdere categorieën", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteRegels(db, versie.id, [
      regelInvoer({ categorie: "RENTEKOSTEN", omschrijving: "Lening 747" }),
      regelInvoer({ categorie: "RENTEKOSTEN", omschrijving: "Lening .962" }),
      regelInvoer({ categorie: "RENTE_OPBRENGSTEN", omschrijving: "Spaarrekening" }),
    ]);
    const gelezen = leesRenteRegels(db, versie.id);
    expect(gelezen).toHaveLength(3);
    expect(gelezen.filter((r) => r.categorie === "RENTEKOSTEN")).toHaveLength(2);
    expect(gelezen.filter((r) => r.categorie === "RENTE_OPBRENGSTEN")).toHaveLength(1);
  });

  it("4. Decimal TEXT round-trip zonder number-conversie voor alle geldbedragvelden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteRegels(db, versie.id, [
      regelInvoer({ laatstBekendSaldo: new Decimal("7700000.1234"), rentepercentage: new Decimal("6.125"), begrotingsbedrag: new Decimal("357440.93") }),
    ]);

    const ruweRij = db.prepare(`SELECT laatst_bekend_saldo, typeof(laatst_bekend_saldo) AS saldo_type FROM begroting_rente_regel WHERE begroting_versie_id = ?`).get(versie.id) as {
      laatst_bekend_saldo: string;
      saldo_type: string;
    };
    expect(ruweRij.saldo_type).toBe("text");
    expect(ruweRij.laatst_bekend_saldo).toBe("7700000.1234");

    const gelezen = leesRenteRegels(db, versie.id)[0]!;
    expect(gelezen.laatstBekendSaldo?.toString()).toBe("7700000.1234");
    expect(gelezen.rentepercentage?.toString()).toBe("6.125");
    expect(gelezen.begrotingsbedrag?.toString()).toBe("357440.93");
  });

  it("5. complexnummer/ogbReferentie null is geldig (optioneel, puur informatief)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteRegels(db, versie.id, [regelInvoer({ complexnummer: null, ogbReferentie: null })]);
    const gelezen = leesRenteRegels(db, versie.id)[0]!;
    expect(gelezen.complexnummer).toBeNull();
    expect(gelezen.ogbReferentie).toBeNull();
  });

  it("6. complexnummer/ogbReferentie round-trip exact wanneer aanwezig, puur presentatie/informatief", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteRegels(db, versie.id, [regelInvoer({ complexnummer: "001", ogbReferentie: "OGB 4606 — lening 747" })]);
    const gelezen = leesRenteRegels(db, versie.id)[0]!;
    expect(gelezen.complexnummer).toBe("001");
    expect(gelezen.ogbReferentie).toBe("OGB 4606 — lening 747");
  });

  it("7. laatstBekendSaldo/rentepercentage/begrotingsbedrag null round-trippen als null, nooit stilzwijgend een default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteRegels(db, versie.id, [regelInvoer({ laatstBekendSaldo: null, rentepercentage: null, begrotingsbedrag: null })]);
    const gelezen = leesRenteRegels(db, versie.id)[0]!;
    expect(gelezen.laatstBekendSaldo).toBeNull();
    expect(gelezen.rentepercentage).toBeNull();
    expect(gelezen.begrotingsbedrag).toBeNull();
  });

  it("8. begrotingsbedrag null vs. bewuste €0 blijven onderscheiden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteRegels(db, versie.id, [regelInvoer({ omschrijving: "Zonder bedrag", begrotingsbedrag: null }), regelInvoer({ omschrijving: "Expliciete nul", begrotingsbedrag: new Decimal(0) })]);
    const gelezen = leesRenteRegels(db, versie.id);
    expect(gelezen.find((r) => r.omschrijving === "Zonder bedrag")?.begrotingsbedrag).toBeNull();
    expect(gelezen.find((r) => r.omschrijving === "Expliciete nul")?.begrotingsbedrag?.toString()).toBe("0");
  });

  it("9. nieuwe regel krijgt persistente ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = schrijfRenteRegels(db, versie.id, [regelInvoer(), regelInvoer({ categorie: "RENTE_OPBRENGSTEN" })]);
    expect(resultaat).toHaveLength(2);
    expect(typeof resultaat[0]?.id).toBe("number");
    expect(resultaat[0]?.id).not.toBe(resultaat[1]?.id);
  });

  it("10. bestaande regel update behoudt ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfRenteRegels(db, versie.id, [regelInvoer({ omschrijving: "Origineel" })]);
    const bijgewerkt = schrijfRenteRegels(db, versie.id, [{ ...naarInvoer(origineel!), omschrijving: "Bijgewerkt" }]);
    expect(bijgewerkt[0]?.id).toBe(origineel!.id);
    expect(bijgewerkt[0]?.omschrijving).toBe("Bijgewerkt");
  });

  it("10b. de onderliggende UPDATE is zelf id+begroting_versie_id-gebonden (SQL-mechanica, onafhankelijk van de vooraf-check)", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelA] = schrijfRenteRegels(db, versieA.id, [regelInvoer({ omschrijving: "A" })]);

    const info = db.prepare(`UPDATE begroting_rente_regel SET omschrijving = 'Gekaapt' WHERE id = ? AND begroting_versie_id = ?`).run(regelA!.id, versieB.id);
    expect(Number(info.changes)).toBe(0);
    expect(leesRenteRegels(db, versieA.id)[0]?.omschrijving).toBe("A");
  });

  it("11. verwijderen via complete-list save verwijdert juiste regel", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [a, b] = schrijfRenteRegels(db, versie.id, [regelInvoer({ omschrijving: "A" }), regelInvoer({ omschrijving: "B" })]);
    const resultaat = schrijfRenteRegels(db, versie.id, [naarInvoer(a!)]);
    expect(resultaat).toHaveLength(1);
    expect(leesRenteRegels(db, versie.id).some((x) => x.id === b!.id)).toBe(false);
  });

  it("12. volgorde lezen deterministisch ORDER BY id", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geschreven = schrijfRenteRegels(db, versie.id, [regelInvoer({ omschrijving: "A" }), regelInvoer({ omschrijving: "B" })]);
    const ids = geschreven.map((r) => r.id);
    schrijfRenteRegels(db, versie.id, [naarInvoer(geschreven[1]!), naarInvoer(geschreven[0]!)]);
    expect(leesRenteRegels(db, versie.id).map((r) => r.id)).toEqual(ids);
  });

  it("13. ID van andere begrotingsversie -> fail-fast + rollback", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelA] = schrijfRenteRegels(db, versieA.id, [regelInvoer({ omschrijving: "A-origineel" })]);
    const [regelB] = schrijfRenteRegels(db, versieB.id, [regelInvoer()]);

    expect(() =>
      schrijfRenteRegels(db, versieA.id, [
        { ...naarInvoer(regelA!), omschrijving: "A-zou-bijgewerkt-worden" },
        { ...naarInvoer(regelB!), omschrijving: "Gekaapt" },
      ]),
    ).toThrow(/behoort bij begrotingsversie/);

    expect(leesRenteRegels(db, versieA.id)[0]?.omschrijving).toBe("A-origineel");
  });

  it("14. onbekende bestaande ID -> fail-fast + rollback", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [bestaand] = schrijfRenteRegels(db, versie.id, [regelInvoer({ omschrijving: "Bestaat al" })]);
    expect(() => schrijfRenteRegels(db, versie.id, [{ ...naarInvoer(bestaand!), omschrijving: "Zou-bijgewerkt-worden" }, regelInvoer({ id: 999999, omschrijving: "Bestaat niet" })])).toThrow(
      /bestaat niet/,
    );
    expect(leesRenteRegels(db, versie.id)[0]?.omschrijving).toBe("Bestaat al");
  });

  it("15. duplicate bestaande ID in input -> fail-fast + rollback", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfRenteRegels(db, versie.id, [regelInvoer({ omschrijving: "Origineel" })]);
    expect(() =>
      schrijfRenteRegels(db, versie.id, [
        { ...naarInvoer(origineel!), omschrijving: "Versie 1" },
        { ...naarInvoer(origineel!), omschrijving: "Versie 2" },
      ]),
    ).toThrow(/meerdere keren voor in één save/);
    expect(leesRenteRegels(db, versie.id)[0]?.omschrijving).toBe("Origineel");
  });

  it("16. save versie A wijzigt nooit versie B", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteRegels(db, versieA.id, [regelInvoer({ omschrijving: "A1" })]);
    schrijfRenteRegels(db, versieB.id, [regelInvoer({ omschrijving: "B1" })]);
    schrijfRenteRegels(db, versieA.id, [regelInvoer({ omschrijving: "A1-gewijzigd" })]);
    expect(leesRenteRegels(db, versieB.id)[0]?.omschrijving).toBe("B1");
  });

  it("17. INSERT via de API wordt geweigerd op een VASTGESTELDE versie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfRenteRegels(db, versie.id, [regelInvoer()])).toThrow(/VASTGESTELD/);
  });

  it("18. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfRenteRegels(db, versie.id, [regelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => db.prepare(`INSERT INTO begroting_rente_regel (begroting_versie_id, categorie, omschrijving) VALUES (?, 'RENTEKOSTEN', 'x')`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE begroting_rente_regel SET omschrijving = 'gewijzigd' WHERE id = ?`).run(regel!.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_rente_regel WHERE id = ?`).run(regel!.id)).toThrow(/immutable/);
  });

  it("19. CHECK weigert een onbekende categoriewaarde via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() => db.prepare(`INSERT INTO begroting_rente_regel (begroting_versie_id, categorie, omschrijving) VALUES (?, 'ONBEKEND', 'x')`).run(versie.id)).toThrow(/CHECK constraint failed/);
  });

  it("20. fout halverwege write -> transactie rollback, oorspronkelijke lijst blijft intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfRenteRegels(db, versie.id, [regelInvoer({ omschrijving: "A" })]);

    db.exec(
      `CREATE TRIGGER trg_test_forceer_fout_rente
       BEFORE INSERT ON begroting_rente_regel
       FOR EACH ROW
       WHEN NEW.omschrijving = 'FOUT'
       BEGIN
         SELECT RAISE(ABORT, 'geforceerde testfout');
       END`,
    );

    try {
      expect(() => schrijfRenteRegels(db, versie.id, [{ ...naarInvoer(origineel!), omschrijving: "B" }, regelInvoer({ omschrijving: "FOUT" })])).toThrow(/geforceerde testfout/);
    } finally {
      db.exec(`DROP TRIGGER trg_test_forceer_fout_rente`);
    }

    const huidig = leesRenteRegels(db, versie.id);
    expect(huidig).toHaveLength(1);
    expect(huidig[0]?.omschrijving).toBe("A");
  });
});
