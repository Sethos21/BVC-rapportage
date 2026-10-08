import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenBegroteManagementvergoeding, type BgManagementInvoer, type BgManagementResultaat } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { schrijfFrozenBegrotingsresultaat } from "./frozenResultaat.js";
import { leesFrozenModule3Resultaat, schrijfFrozenModule3Resultaat } from "./frozenModule3Resultaat.js";
import { herberekenBegroting } from "./herberekenen.js";
import { schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Snapshot } from "./module1Snapshot.js";
import { leesModule3Invoer, schrijfModule3Invoer } from "./module3Invoer.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-frozen-module3-"));
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

/** Normaliseert Decimal → string en Date blijft Date, voor exacte, leesbare `toEqual`-vergelijkingen. */
function normaliseer<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, val) => (val instanceof Decimal ? { __decimal__: val.toString() } : val)));
}

const INDEXEER: BgManagementInvoer = {
  wijze: "INDEXEER_BESTAAND",
  bestaandBedrag: new Decimal(1000),
  eenheid: "MAAND",
  indexatiePercentage: new Decimal(3),
  indexatiedatum: new Date(Date.UTC(2027, 6, 1)),
};

const WIJZIG: BgManagementInvoer = {
  wijze: "WIJZIG_BESTAAND_BEDRAG",
  bestaandBedrag: new Decimal(1000),
  bestaandEenheid: "MAAND",
  nieuwBedrag: new Decimal(1200),
  nieuweEenheid: "MAAND",
  ingangsdatum: new Date(Date.UTC(2027, 6, 1)),
};

const NIEUWE_VERGOEDING: BgManagementInvoer = {
  wijze: "NIEUWE_VERGOEDING",
  bedrag: new Decimal(1200),
  eenheid: "MAAND",
  ingangsdatum: new Date(Date.UTC(2027, 6, 1)),
};

function bereken(invoer: BgManagementInvoer): BgManagementResultaat {
  return berekenBegroteManagementvergoeding(invoer, { begrotingsjaar: 2027 });
}

describe("schrijfFrozenModule3Resultaat / leesFrozenModule3Resultaat — roundtrip per mechanisme", () => {
  it("1. roundtrip frozen INDEXEER_BESTAAND-resultaat", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = bereken(INDEXEER);
    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(gelezen)).toEqual(normaliseer(resultaat));
  });

  it("2. roundtrip frozen WIJZIG_BESTAAND_BEDRAG-resultaat (regressievoorbeeld, jaartotaal €13.200)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = bereken(WIJZIG);
    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(gelezen)).toEqual(normaliseer(resultaat));
    expect(gelezen.jaartotaal.bedrag.toString()).toBe("13200");
  });

  it("3. roundtrip frozen NIEUWE_VERGOEDING-resultaat (jaartotaal €7.200)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = bereken(NIEUWE_VERGOEDING);
    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(gelezen)).toEqual(normaliseer(resultaat));
    expect(gelezen.jaartotaal.bedrag.toString()).toBe("7200");
  });

  it("3b. roundtrip NIEUWE_VERGOEDING met ingangsdatum: null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const invoer: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(14400), eenheid: "JAAR", ingangsdatum: null };
    const resultaat = bereken(invoer);
    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(gelezen)).toEqual(normaliseer(resultaat));
    expect((gelezen.invoer as BgManagementInvoer & { wijze: "NIEUWE_VERGOEDING" }).ingangsdatum).toBeNull();
    expect(gelezen.effectieveIngangsdatum).toBeNull();
  });

  it("4. expliciet resultaat met jaartotaal €0 blijft een echt frozen resultaat, geen null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const invoer: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(0), eenheid: "MAAND", ingangsdatum: null };
    const resultaat = bereken(invoer);
    expect(resultaat.jaartotaal.bedrag.isZero()).toBe(true);

    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);
    const gelezen = leesFrozenModule3Resultaat(db, versie.id);

    expect(gelezen).not.toBeNull();
    expect(gelezen!.jaartotaal.bedrag.toString()).toBe("0");
    expect(gelezen!.jaartotaal.bedrag.isZero()).toBe(true);
  });
});

describe("maandregels, Decimal-precisie, datums (5, 6, 7)", () => {
  it("5. alle 12 maandregels komen exact terug: maand, basisBedrag, effect, bedrag", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = bereken(WIJZIG);
    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(gelezen.regels).toHaveLength(12);
    for (let i = 0; i < 12; i += 1) {
      expect(gelezen.regels[i]!.maand).toBe(resultaat.regels[i]!.maand);
      expect(gelezen.regels[i]!.basisBedrag.toString()).toBe(resultaat.regels[i]!.basisBedrag.toString());
      expect(gelezen.regels[i]!.effect.toString()).toBe(resultaat.regels[i]!.effect.toString());
      expect(gelezen.regels[i]!.bedrag.toString()).toBe(resultaat.regels[i]!.bedrag.toString());
    }
  });

  it("6. Decimal-precisie blijft exact (meer dan 2 decimalen, negatief indexatiepercentage) — SQLite TEXT, geen REAL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const invoer: BgManagementInvoer = {
      wijze: "INDEXEER_BESTAAND",
      bestaandBedrag: new Decimal("833.333333"),
      eenheid: "MAAND",
      indexatiePercentage: new Decimal(-1.5),
      indexatiedatum: new Date(Date.UTC(2027, 6, 1)),
    };
    const resultaat = bereken(invoer);
    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);

    const ruweRij = db
      .prepare(
        `SELECT invoer_bestaand_bedrag, typeof(invoer_bestaand_bedrag) AS type1, jaartotaal_bedrag, typeof(jaartotaal_bedrag) AS type2
         FROM begroting_frozen_module3_resultaat WHERE begroting_versie_id = ?`,
      )
      .get(versie.id) as { invoer_bestaand_bedrag: string; type1: string; jaartotaal_bedrag: string; type2: string };
    expect(ruweRij.type1).toBe("text");
    expect(ruweRij.invoer_bestaand_bedrag).toBe("833.333333");
    expect(ruweRij.type2).toBe("text");
    expect(ruweRij.jaartotaal_bedrag).toBe(resultaat.jaartotaal.bedrag.toString());

    const maandregelRij = db
      .prepare(`SELECT effect, typeof(effect) AS type FROM begroting_frozen_module3_maandregel WHERE begroting_versie_id = ? AND maand = 7`)
      .get(versie.id) as { effect: string; type: string };
    expect(maandregelRij.type).toBe("text");
    expect(maandregelRij.effect).toBe(resultaat.regels.find((r) => r.maand === 7)!.effect.toString());

    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect((gelezen.invoer as BgManagementInvoer & { wijze: "INDEXEER_BESTAAND" }).bestaandBedrag.toString()).toBe("833.333333");
    expect((gelezen.invoer as BgManagementInvoer & { wijze: "INDEXEER_BESTAAND" }).indexatiePercentage.toString()).toBe("-1.5");
  });

  it("7. nullable/effectieve datums blijven exact — effectieveIndexatiedatum null wanneer indexatiedatum buiten begrotingsjaar valt", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const invoer: BgManagementInvoer = {
      wijze: "INDEXEER_BESTAAND",
      bestaandBedrag: new Decimal(1000),
      eenheid: "MAAND",
      indexatiePercentage: new Decimal(3),
      indexatiedatum: new Date(Date.UTC(2028, 0, 1)), // buiten begrotingsjaar 2027
    };
    const resultaat = bereken(invoer);
    expect(resultaat.effectieveIndexatiedatum).toBeNull(); // pure-laag-bevestiging

    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);
    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;

    expect(gelezen.effectieveIndexatiedatum).toBeNull();
    // De RUWE invoerdatum blijft wél exact behouden, ondanks dat hij niet is toegepast.
    expect((gelezen.invoer as BgManagementInvoer & { wijze: "INDEXEER_BESTAAND" }).indexatiedatum).toEqual(new Date(Date.UTC(2028, 0, 1)));
  });
});

describe("controls / controleVereist (8, 9)", () => {
  it("8/9. een echte control (negatief bedrag, via de pure laag gegenereerd) blijft exact behouden, incl. ernst/bericht/volgorde", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const invoer: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(-100), eenheid: "MAAND", ingangsdatum: null };
    const resultaat = bereken(invoer);
    expect(resultaat.controleVereist.length).toBeGreaterThan(0);
    expect(resultaat.controleVereist[0]!.ernst).toBe("KRITIEK");

    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);
    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;

    expect(normaliseer(gelezen.controleVereist)).toEqual(normaliseer(resultaat.controleVereist));
  });

  it("9b. lege controleVereist round-tript naar een lege array, niet naar undefined/null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Ingangsdatum op 1 januari (vanafMaand = 1) genereert bewust GEEN INFORMATIEF-melding (die komt
    // alleen bij een ingangsmaand > 1) — dit is dus een echt controle-vrij resultaat.
    const invoer: BgManagementInvoer = { ...WIJZIG, ingangsdatum: new Date(Date.UTC(2027, 0, 1)) };
    const resultaat = bereken(invoer);
    expect(resultaat.controleVereist).toEqual([]);

    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);
    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(gelezen.controleVereist).toEqual([]);
  });
});

describe("structurele gelijkheid (10)", () => {
  it("10. read-back is structureel volledig gelijk aan het oorspronkelijke BgManagementResultaat (alle drie mechanismen)", () => {
    for (const invoer of [INDEXEER, WIJZIG, NIEUWE_VERGOEDING]) {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      const resultaat = bereken(invoer);
      schrijfFrozenModule3Resultaat(db, versie.id, resultaat);
      const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
      expect(normaliseer(gelezen)).toEqual(normaliseer(resultaat));
    }
  });
});

describe("atomiciteit / vervangen / rollback (11, 12)", () => {
  it("11. schrijven en vervangen tijdens CONCEPT is toegestaan (complete replacement, geen resten)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenModule3Resultaat(db, versie.id, bereken(INDEXEER));
    schrijfFrozenModule3Resultaat(db, versie.id, bereken(WIJZIG)); // vervangen mag

    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(gelezen.invoer.wijze).toBe("WIJZIG_BESTAAND_BEDRAG");

    const rijen = db.prepare(`SELECT COUNT(*) AS aantal FROM begroting_frozen_module3_resultaat WHERE begroting_versie_id = ?`).get(versie.id) as {
      aantal: number;
    };
    expect(rijen.aantal).toBe(1);
    // Geen resten van de oude INDEXEER_BESTAAND-invoerkolommen.
    const ruweRij = db
      .prepare(`SELECT invoer_indexatie_percentage, invoer_indexatiedatum FROM begroting_frozen_module3_resultaat WHERE begroting_versie_id = ?`)
      .get(versie.id) as { invoer_indexatie_percentage: string | null; invoer_indexatiedatum: string | null };
    expect(ruweRij.invoer_indexatie_percentage).toBeNull();
    expect(ruweRij.invoer_indexatiedatum).toBeNull();
  });

  it("12. een mislukte frozen write (CHECK-schending op maand) laat het vorige geldige resultaat exact intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geldigResultaat = bereken(WIJZIG);
    schrijfFrozenModule3Resultaat(db, versie.id, geldigResultaat);

    // Bewust corrupt: een tweede resultaat waarbij één maandregel een ongeldige `maand` krijgt —
    // de CHECK (maand BETWEEN 1 AND 12) forceert een échte fout MIDDEN in de INSERT-reeks, ná de
    // reeds succesvol ingevoegde header van dit tweede resultaat.
    const kapotResultaat: BgManagementResultaat = {
      ...geldigResultaat,
      regels: geldigResultaat.regels.map((r, i) => (i === 0 ? { ...r, maand: 99 } : r)),
    };

    expect(() => schrijfFrozenModule3Resultaat(db, versie.id, kapotResultaat)).toThrow();

    const naMislukking = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(naMislukking)).toEqual(normaliseer(geldigResultaat));
  });
});

describe("frozen Module 1/2 blijven onaangetast (13)", () => {
  it("13. schrijven/vervangen van frozen Module 3 raakt frozen Module 1/2 van dezelfde versie niet", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    const { module1, module2 } = herberekenBegroting(db, versie.id);
    schrijfFrozenBegrotingsresultaat(db, versie.id, { module1, module2 });

    const module1RijVoor = db.prepare(`SELECT * FROM begroting_frozen_module1_resultaat WHERE begroting_versie_id = ?`).get(versie.id);
    const module2RijVoor = db.prepare(`SELECT * FROM begroting_frozen_module2_resultaat WHERE begroting_versie_id = ?`).get(versie.id);

    schrijfFrozenModule3Resultaat(db, versie.id, bereken(WIJZIG));
    schrijfFrozenModule3Resultaat(db, versie.id, bereken(NIEUWE_VERGOEDING)); // vervangen

    const module1RijNa = db.prepare(`SELECT * FROM begroting_frozen_module1_resultaat WHERE begroting_versie_id = ?`).get(versie.id);
    const module2RijNa = db.prepare(`SELECT * FROM begroting_frozen_module2_resultaat WHERE begroting_versie_id = ?`).get(versie.id);

    expect(module1RijNa).toEqual(module1RijVoor);
    expect(module2RijNa).toEqual(module2RijVoor);
  });
});

describe("immutability (14, 15)", () => {
  it("14. directe SQL INSERT/UPDATE/DELETE op VASTGESTELD worden alle drie geweigerd (header, maandregel, control)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = bereken(WIJZIG);
    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    // De trigger vuurt vóór de PK-constraint zou vuren — het specifieke /immutable/-bericht bewijst dat
    // dít de immutability-trigger is die de poging tegenhoudt, niet slechts een toevallige PK-botsing.
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_module3_resultaat
             (begroting_versie_id, wijze, jaartotaal_basis_bedrag, jaartotaal_effect, jaartotaal_bedrag)
           VALUES (?, 'NIEUWE_VERGOEDING', '0', '0', '0')`,
        )
        .run(versie.id),
    ).toThrow(/immutable/);

    expect(() =>
      db.prepare(`UPDATE begroting_frozen_module3_resultaat SET jaartotaal_bedrag = '999' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_module3_resultaat WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);

    expect(() =>
      db.prepare(`UPDATE begroting_frozen_module3_maandregel SET bedrag = '999' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_module3_maandregel WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_module3_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 99, 'INFORMATIEF', 'test')`)
        .run(versie.id),
    ).toThrow(/immutable/);
  });

  it("15. schrijven via de API op een VASTGESTELDE versie wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = bereken(WIJZIG);
    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfFrozenModule3Resultaat(db, versie.id, resultaat)).toThrow(/VASTGESTELD/);
  });

  it("lezen blijft na VASTGESTELD gewoon toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = bereken(WIJZIG);
    schrijfFrozenModule3Resultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(gelezen)).toEqual(normaliseer(resultaat));
  });
});

describe("cascade/FK-gedrag (16)", () => {
  it("16. verwijderen van een CONCEPT-versie cascadeert alle drie frozen-Module3-tabellen volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenModule3Resultaat(db, versie.id, bereken(WIJZIG));

    verwijderConceptVersie(db, versie.id);

    for (const tabel of ["begroting_frozen_module3_resultaat", "begroting_frozen_module3_maandregel", "begroting_frozen_module3_control"]) {
      expect(db.prepare(`SELECT 1 FROM ${tabel} WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
    }
  });

  it("geen frozen Module-3-output geschreven → leesFrozenModule3Resultaat geeft null, geen default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesFrozenModule3Resultaat(db, versie.id)).toBeNull();
  });
});

describe("strikte scheiding input (migratie 6) versus output (migratie 7) (17)", () => {
  it("17. het schrijven van frozen Module-3-output wijzigt de persistente Module-3-INVOER niet, en omgekeerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule3Invoer(db, versie.id, INDEXEER); // andere wijze dan het frozen resultaat hieronder

    const invoerVoor = leesModule3Invoer(db, versie.id);
    schrijfFrozenModule3Resultaat(db, versie.id, bereken(WIJZIG));
    const invoerNa = leesModule3Invoer(db, versie.id);

    expect(invoerNa).toEqual(invoerVoor);
    expect(invoerNa!.wijze).toBe("INDEXEER_BESTAAND"); // ongewijzigd, ondanks een ANDERE wijze in het frozen resultaat

    // En omgekeerd: het frozen resultaat leest nooit uit begroting_management_invoer terug.
    const gelezenFrozen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(gelezenFrozen.invoer.wijze).toBe("WIJZIG_BESTAAND_BEDRAG");
  });
});

describe("CHECK-constraint chk_begroting_frozen_module3_resultaat_wijze_kolommen (review-correctie)", () => {
  const KOLOMMEN = [
    "begroting_versie_id",
    "wijze",
    "invoer_bestaand_bedrag",
    "invoer_bestaand_eenheid",
    "invoer_nieuw_bedrag",
    "invoer_nieuwe_eenheid",
    "invoer_indexatie_percentage",
    "invoer_indexatiedatum",
    "invoer_ingangsdatum",
    "jaartotaal_basis_bedrag",
    "jaartotaal_effect",
    "jaartotaal_bedrag",
  ] as const;

  /** Directe SQL-insert buiten de TS-API om, met expliciete kolomwaarden (ontbrekend → NULL) — bewijst de DB-CHECK zelf, niet de TypeScript-laag. */
  function insertRuw(versieId: string, waarden: Partial<Record<(typeof KOLOMMEN)[number], string>>) {
    const values = KOLOMMEN.map((k) => (k === "begroting_versie_id" ? versieId : (waarden[k] ?? null)));
    db.prepare(`INSERT INTO begroting_frozen_module3_resultaat (${KOLOMMEN.join(", ")}) VALUES (${KOLOMMEN.map(() => "?").join(", ")})`).run(
      ...values,
    );
  }

  it("1. INDEXEER_BESTAAND met een invoer_nieuw_bedrag (niet-toegestane kolom gevuld) wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      insertRuw(versie.id, {
        wijze: "INDEXEER_BESTAAND",
        invoer_bestaand_bedrag: "1000",
        invoer_bestaand_eenheid: "MAAND",
        invoer_indexatie_percentage: "3",
        invoer_indexatiedatum: "2027-07-01",
        invoer_nieuw_bedrag: "1200", // niet toegestaan bij INDEXEER_BESTAAND
        jaartotaal_basis_bedrag: "0",
        jaartotaal_effect: "0",
        jaartotaal_bedrag: "0",
      }),
    ).toThrow(/CHECK constraint failed/);
  });

  it("2. INDEXEER_BESTAAND zonder verplichte invoer_indexatiedatum wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      insertRuw(versie.id, {
        wijze: "INDEXEER_BESTAAND",
        invoer_bestaand_bedrag: "1000",
        invoer_bestaand_eenheid: "MAAND",
        invoer_indexatie_percentage: "3",
        // invoer_indexatiedatum ontbreekt (NULL) — verplicht bij INDEXEER_BESTAAND.
        jaartotaal_basis_bedrag: "0",
        jaartotaal_effect: "0",
        jaartotaal_bedrag: "0",
      }),
    ).toThrow(/CHECK constraint failed/);
  });

  it("3. WIJZIG_BESTAAND_BEDRAG zonder invoer_bestaand_bedrag wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      insertRuw(versie.id, {
        wijze: "WIJZIG_BESTAAND_BEDRAG",
        // invoer_bestaand_bedrag/invoer_bestaand_eenheid ontbreken — verplicht bij WIJZIG_BESTAAND_BEDRAG.
        invoer_nieuw_bedrag: "1200",
        invoer_nieuwe_eenheid: "MAAND",
        invoer_ingangsdatum: "2027-07-01",
        jaartotaal_basis_bedrag: "0",
        jaartotaal_effect: "0",
        jaartotaal_bedrag: "0",
      }),
    ).toThrow(/CHECK constraint failed/);
  });

  it("4. WIJZIG_BESTAAND_BEDRAG zonder invoer_nieuw_bedrag wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      insertRuw(versie.id, {
        wijze: "WIJZIG_BESTAAND_BEDRAG",
        invoer_bestaand_bedrag: "1000",
        invoer_bestaand_eenheid: "MAAND",
        // invoer_nieuw_bedrag/invoer_nieuwe_eenheid ontbreken — verplicht bij WIJZIG_BESTAAND_BEDRAG.
        invoer_ingangsdatum: "2027-07-01",
        jaartotaal_basis_bedrag: "0",
        jaartotaal_effect: "0",
        jaartotaal_bedrag: "0",
      }),
    ).toThrow(/CHECK constraint failed/);
  });

  it("5. NIEUWE_VERGOEDING met een invoer_bestaand_bedrag (niet-toegestane kolom gevuld) wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      insertRuw(versie.id, {
        wijze: "NIEUWE_VERGOEDING",
        invoer_nieuw_bedrag: "1200",
        invoer_nieuwe_eenheid: "MAAND",
        invoer_bestaand_bedrag: "1000", // niet toegestaan bij NIEUWE_VERGOEDING
        jaartotaal_basis_bedrag: "0",
        jaartotaal_effect: "0",
        jaartotaal_bedrag: "0",
      }),
    ).toThrow(/CHECK constraint failed/);
  });

  it("6. NIEUWE_VERGOEDING zonder invoer_nieuw_bedrag wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      insertRuw(versie.id, {
        wijze: "NIEUWE_VERGOEDING",
        invoer_nieuwe_eenheid: "MAAND",
        // invoer_nieuw_bedrag ontbreekt — verplicht bij NIEUWE_VERGOEDING.
        jaartotaal_basis_bedrag: "0",
        jaartotaal_effect: "0",
        jaartotaal_bedrag: "0",
      }),
    ).toThrow(/CHECK constraint failed/);
  });

  it("NIEUWE_VERGOEDING zonder invoer_ingangsdatum is WEL toegestaan (dat veld mag NULL zijn)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      insertRuw(versie.id, {
        wijze: "NIEUWE_VERGOEDING",
        invoer_nieuw_bedrag: "1200",
        invoer_nieuwe_eenheid: "MAAND",
        // invoer_ingangsdatum bewust weggelaten (NULL) — toegestaan.
        jaartotaal_basis_bedrag: "0",
        jaartotaal_effect: "0",
        jaartotaal_bedrag: "0",
      }),
    ).not.toThrow();
  });

  it("geldige frozen resultaten voor alle drie mechanismen roundtrippen nog steeds exact, mét de nieuwe CHECK actief", () => {
    for (const invoer of [INDEXEER, WIJZIG, NIEUWE_VERGOEDING]) {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      const resultaat = bereken(invoer);
      expect(() => schrijfFrozenModule3Resultaat(db, versie.id, resultaat)).not.toThrow();
      const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
      expect(normaliseer(gelezen)).toEqual(normaliseer(resultaat));
    }
  });
});
