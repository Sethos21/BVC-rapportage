import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import {
  leesGeplandOnderhoudActiviteiten,
  schrijfGeplandOnderhoudActiviteiten,
  type GeplandOnderhoudActiviteit,
  type GeplandOnderhoudActiviteitInvoer,
} from "./geplandOnderhoudActiviteiten.js";
import { leesGeplandOnderhoudBeoordeeld, schrijfGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-gepland-onderhoud-"));
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

/** Zet een gelezen activiteit terug om naar invoervorm (id behouden) — hulpfunctie uitsluitend voor deze tests. */
function naarInvoer(a: GeplandOnderhoudActiviteit): GeplandOnderhoudActiviteitInvoer {
  return { ...a };
}

describe("schrijfGeplandOnderhoudActiviteiten / leesGeplandOnderhoudActiviteiten", () => {
  it("1. nul activiteiten lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesGeplandOnderhoudActiviteiten(db, versie.id)).toEqual([]);
  });

  it("2. één activiteit schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    const gelezen = leesGeplandOnderhoudActiviteiten(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]).toMatchObject({ complexnummer: "003", omschrijving: "Vervangen dakbedekking", status: "GEPLAND" });
    expect(gelezen[0]?.q1.toString()).toBe("25000");
  });

  it("3. meerdere activiteiten schrijven/lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      activiteitInvoer({ complexnummer: "001", omschrijving: "A" }),
      activiteitInvoer({ complexnummer: "002", omschrijving: "B" }),
    ]);
    const gelezen = leesGeplandOnderhoudActiviteiten(db, versie.id);
    expect(gelezen).toHaveLength(2);
    expect(gelezen.map((a) => a.omschrijving)).toEqual(["A", "B"]);
  });

  it("4. meerdere activiteiten zelfde complex toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      activiteitInvoer({ complexnummer: "003", omschrijving: "A" }),
      activiteitInvoer({ complexnummer: "003", omschrijving: "B" }),
    ]);
    const gelezen = leesGeplandOnderhoudActiviteiten(db, versie.id);
    expect(gelezen).toHaveLength(2);
    expect(gelezen.every((a) => a.complexnummer === "003")).toBe(true);
  });

  it("5. Decimal TEXT round-trip zonder number-conversie (meer precisie dan 2 decimalen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ q1: new Decimal("12345.6789"), q2: new Decimal("-500.5") })]);

    const ruweRij = db
      .prepare(`SELECT q1, typeof(q1) AS q1_type, q2, typeof(q2) AS q2_type FROM begroting_gepland_onderhoud_activiteit WHERE begroting_versie_id = ?`)
      .get(versie.id) as { q1: string; q1_type: string; q2: string; q2_type: string };
    expect(ruweRij.q1_type).toBe("text");
    expect(ruweRij.q1).toBe("12345.6789");
    expect(ruweRij.q2_type).toBe("text");
    expect(ruweRij.q2).toBe("-500.5");

    const gelezen = leesGeplandOnderhoudActiviteiten(db, versie.id);
    expect(gelezen[0]?.q1.toString()).toBe("12345.6789");
    expect(gelezen[0]?.q2.toString()).toBe("-500.5");
  });

  it("6. offertebedrag null round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ offertebedrag: null })]);
    expect(leesGeplandOnderhoudActiviteiten(db, versie.id)[0]?.offertebedrag).toBeNull();
  });

  it("7. offertebedrag gevuld round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      activiteitInvoer({ offertebedrag: new Decimal("24500.00"), leverancier: "Weerts van de Zanden", notitie: "offerte ontvangen" }),
    ]);
    const gelezen = leesGeplandOnderhoudActiviteiten(db, versie.id)[0]!;
    expect(gelezen.offertebedrag?.toString()).toBe("24500");
    expect(gelezen.leverancier).toBe("Weerts van de Zanden");
    expect(gelezen.notitie).toBe("offerte ontvangen");
  });

  it("8. nieuwe activiteit krijgt persistente ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer(), activiteitInvoer({ complexnummer: "004" })]);
    expect(resultaat).toHaveLength(2);
    expect(typeof resultaat[0]?.id).toBe("number");
    expect(typeof resultaat[1]?.id).toBe("number");
    expect(resultaat[0]?.id).not.toBe(resultaat[1]?.id);
  });

  it("9. bestaande activiteit update behoudt ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ omschrijving: "Origineel" })]);

    const bijgewerkt = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      { ...naarInvoer(origineel!), omschrijving: "Bijgewerkt" },
    ]);

    expect(bijgewerkt).toHaveLength(1);
    expect(bijgewerkt[0]?.id).toBe(origineel!.id);
    expect(bijgewerkt[0]?.omschrijving).toBe("Bijgewerkt");
  });

  it("9b. de onderliggende UPDATE is zelf id+begroting_versie_id-gebonden (SQL-mechanica, onafhankelijk van de vooraf-check)", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [activiteitA] = schrijfGeplandOnderhoudActiviteiten(db, versieA.id, [activiteitInvoer({ omschrijving: "A" })]);

    // Rechtstreekse SQL, exact dezelfde WHERE-clausule als `schrijfGeplandOnderhoudActiviteiten` gebruikt:
    // een bestaand id, maar de VERKEERDE begroting_versie_id, raakt 0 rijen — de tweede beschermingslaag
    // bestaat dus ook los van de applicatie-brede vooraf-ownership-check.
    const info = db
      .prepare(`UPDATE begroting_gepland_onderhoud_activiteit SET omschrijving = 'Gekaapt' WHERE id = ? AND begroting_versie_id = ?`)
      .run(activiteitA!.id, versieB.id);
    expect(Number(info.changes)).toBe(0);
    expect(leesGeplandOnderhoudActiviteiten(db, versieA.id)[0]?.omschrijving).toBe("A");
  });

  it("10. verwijderen via complete-list save verwijdert juiste activiteit", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [a, b] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      activiteitInvoer({ omschrijving: "Blijft" }),
      activiteitInvoer({ omschrijving: "Verdwijnt" }),
    ]);

    const resultaat = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [naarInvoer(a!)]);

    expect(resultaat).toHaveLength(1);
    expect(resultaat[0]?.id).toBe(a!.id);
    expect(leesGeplandOnderhoudActiviteiten(db, versie.id).some((x) => x.id === b!.id)).toBe(false);
  });

  it("11. volgorde lezen deterministisch ORDER BY id", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geschreven = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      activiteitInvoer({ omschrijving: "Eerste" }),
      activiteitInvoer({ omschrijving: "Tweede" }),
      activiteitInvoer({ omschrijving: "Derde" }),
    ]);
    const ids = geschreven.map((a) => a.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));

    // Een save die alleen bestaande activiteiten (in willekeurige invoervolgorde) bijwerkt, verandert de leesvolgorde niet.
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [naarInvoer(geschreven[2]!), naarInvoer(geschreven[0]!), naarInvoer(geschreven[1]!)]);
    expect(leesGeplandOnderhoudActiviteiten(db, versie.id).map((a) => a.id)).toEqual(ids);
  });

  it("18. ID van andere begrotingsversie -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [activiteitA] = schrijfGeplandOnderhoudActiviteiten(db, versieA.id, [activiteitInvoer({ omschrijving: "A-origineel" })]);
    const [activiteitB] = schrijfGeplandOnderhoudActiviteiten(db, versieB.id, [activiteitInvoer()]);

    // De save bevat NAAST de foutieve, aan versie B behorende id ook een op zichzelf geldige update van
    // A's eigen activiteit én een op zichzelf geldige nieuwe activiteit — beide mogen, ondanks dat ze
    // (in aanroepvolgorde) eerder verwerkt zouden worden, niet doorwerken: de fout valt binnen dezelfde
    // transactie als alle mutaties van deze save, niet uitsluitend in een preflight ervoor.
    expect(() =>
      schrijfGeplandOnderhoudActiviteiten(db, versieA.id, [
        { ...naarInvoer(activiteitA!), omschrijving: "A-zou-bijgewerkt-worden" },
        activiteitInvoer({ omschrijving: "Zou-nieuw-worden" }),
        { ...naarInvoer(activiteitB!), omschrijving: "Gekaapt" },
      ]),
    ).toThrow(/behoort bij begrotingsversie/);

    // Geen enkele mutatie: A's activiteit is ongewijzigd, geen nieuwe activiteit toegevoegd, B blijft ongewijzigd.
    const huidigA = leesGeplandOnderhoudActiviteiten(db, versieA.id);
    expect(huidigA).toHaveLength(1);
    expect(huidigA[0]?.omschrijving).toBe("A-origineel");
    expect(leesGeplandOnderhoudActiviteiten(db, versieB.id)[0]?.omschrijving).toBe(activiteitB!.omschrijving);
  });

  it("19. onbekende bestaande ID -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [bestaand] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ omschrijving: "Bestaat al" })]);

    expect(() =>
      schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
        { ...naarInvoer(bestaand!), omschrijving: "Zou-bijgewerkt-worden" },
        activiteitInvoer({ id: 999999, omschrijving: "Bestaat niet" }),
      ]),
    ).toThrow(/bestaat niet/);

    expect(leesGeplandOnderhoudActiviteiten(db, versie.id)).toHaveLength(1);
    expect(leesGeplandOnderhoudActiviteiten(db, versie.id)[0]?.omschrijving).toBe("Bestaat al");
  });

  it("20. duplicate bestaande ID in input -> fail-fast + rollback, óók van de overige, op zichzelf geldige operaties in dezelfde save", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ omschrijving: "Origineel" })]);

    expect(() =>
      schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
        { ...naarInvoer(origineel!), omschrijving: "Versie 1" },
        { ...naarInvoer(origineel!), omschrijving: "Versie 2" },
        activiteitInvoer({ omschrijving: "Zou-nieuw-worden" }),
      ]),
    ).toThrow(/meerdere keren voor in één save/);

    expect(leesGeplandOnderhoudActiviteiten(db, versie.id)).toHaveLength(1);
    expect(leesGeplandOnderhoudActiviteiten(db, versie.id)[0]?.omschrijving).toBe("Origineel");
  });

  it("21. save versie A wijzigt nooit versie B", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudActiviteiten(db, versieA.id, [activiteitInvoer({ omschrijving: "A1" })]);
    schrijfGeplandOnderhoudActiviteiten(db, versieB.id, [activiteitInvoer({ omschrijving: "B1" })]);

    schrijfGeplandOnderhoudActiviteiten(db, versieA.id, [
      activiteitInvoer({ omschrijving: "A1-gewijzigd" }),
      activiteitInvoer({ omschrijving: "A2-nieuw" }),
    ]);

    expect(leesGeplandOnderhoudActiviteiten(db, versieB.id)).toHaveLength(1);
    expect(leesGeplandOnderhoudActiviteiten(db, versieB.id)[0]?.omschrijving).toBe("B1");
  });

  it("22/23/24. INSERT/UPDATE/DELETE via de API worden geweigerd op een VASTGESTELDE versie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()])).toThrow(/VASTGESTELD/);
  });

  it("22/23/24. directe SQL INSERT/UPDATE/DELETE op een VASTGESTELDE versie worden alle drie geweigerd door de trigger", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [activiteit] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_gepland_onderhoud_activiteit
             (begroting_versie_id, complexnummer, omschrijving, aanleiding_toelichting, q1, q2, q3, q4, status)
           VALUES (?, '001', 'test', 'test', '0', '0', '0', '0', 'GEPLAND')`,
        )
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`UPDATE begroting_gepland_onderhoud_activiteit SET omschrijving = 'gewijzigd' WHERE id = ?`).run(activiteit!.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_gepland_onderhoud_activiteit WHERE id = ?`).run(activiteit!.id)).toThrow(/immutable/);
  });

  it("26. fout halverwege write -> transactie rollback, oorspronkelijke lijst blijft intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ complexnummer: "001" })]);

    // Tijdelijke trigger die uitsluitend voor deze test een genuine DB-fout halverwege een
    // meerdere-activiteiten-save forceert — geen onderdeel van het productieschema.
    db.exec(
      `CREATE TRIGGER trg_test_forceer_fout
       BEFORE INSERT ON begroting_gepland_onderhoud_activiteit
       FOR EACH ROW
       WHEN NEW.complexnummer = 'FOUT'
       BEGIN
         SELECT RAISE(ABORT, 'geforceerde testfout');
       END`,
    );

    try {
      expect(() =>
        schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
          { ...naarInvoer(origineel!), complexnummer: "002" },
          activiteitInvoer({ complexnummer: "FOUT" }),
        ]),
      ).toThrow(/geforceerde testfout/);
    } finally {
      db.exec(`DROP TRIGGER trg_test_forceer_fout`);
    }

    const huidig = leesGeplandOnderhoudActiviteiten(db, versie.id);
    expect(huidig).toHaveLength(1);
    expect(huidig[0]?.complexnummer).toBe("001");
  });

  describe("beoordeeld blijft onaangetast door activiteiten-writes", () => {
    it("15. activiteit toevoegen verandert beoordeeld niet", () => {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
      schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
      expect(leesGeplandOnderhoudBeoordeeld(db, versie.id)).toBe(true);
    });

    it("16. activiteit wijzigen verandert beoordeeld niet", () => {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      const [a] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
      schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
      schrijfGeplandOnderhoudActiviteiten(db, versie.id, [{ ...naarInvoer(a!), omschrijving: "gewijzigd" }]);
      expect(leesGeplandOnderhoudBeoordeeld(db, versie.id)).toBe(true);
    });

    it("17. activiteit verwijderen verandert beoordeeld niet", () => {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
      schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
      schrijfGeplandOnderhoudActiviteiten(db, versie.id, []);
      expect(leesGeplandOnderhoudBeoordeeld(db, versie.id)).toBe(true);
    });
  });
});
