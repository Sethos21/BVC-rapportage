import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenBegroteCorrectiefDagelijksOnderhoud, type BgCorrectiefDagelijksAannames, type BgCorrectiefDagelijksRegelInvoer } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import {
  leesFrozenCorrectiefDagelijksOnderhoudResultaat,
  schrijfFrozenCorrectiefDagelijksOnderhoudResultaat,
} from "./frozenCorrectiefDagelijksOnderhoudResultaat.js";
import type { HerberekendCorrectiefDagelijksResultaat } from "./herberekenen.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-frozen-correctief-dagelijks-onderhoud-"));
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

function normaliseer<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, val) => (val instanceof Decimal ? { __decimal__: val.toString() } : val)));
}

function regelInvoer(overrides: Partial<BgCorrectiefDagelijksRegelInvoer> = {}): BgCorrectiefDagelijksRegelInvoer {
  return {
    omschrijving: "Reparatie CV-installatie",
    complexnummer: "003",
    jaarbedrag: new Decimal(0),
    ...overrides,
  };
}

const AANNAMES: BgCorrectiefDagelijksAannames = { begrotingsjaar: 2027, beoordeeld: true };

/**
 * Berekent via de pure calculator en koppelt (net als CD-P2) persistentie-ids
 * uitsluitend positioneel — hier bewust NIET-sequentiële, willekeurige ids
 * (bv. 10/25/99), zodat geen enkele test per ongeluk op "id = arrayindex" zou
 * kunnen leunen.
 */
function berekenMetIds(
  regels: readonly BgCorrectiefDagelijksRegelInvoer[],
  ids: readonly number[],
  aannames: BgCorrectiefDagelijksAannames = AANNAMES,
): HerberekendCorrectiefDagelijksResultaat {
  const resultaat = berekenBegroteCorrectiefDagelijksOnderhoud(regels, aannames);
  return {
    ...resultaat,
    regels: resultaat.regels.map((r, i) => ({ persistentieId: ids[i]!, regel: r })),
  };
}

describe("schrijfFrozenCorrectiefDagelijksOnderhoudResultaat / leesFrozenCorrectiefDagelijksOnderhoudResultaat — roundtrip", () => {
  it("1. roundtrip 0 regels (REVIEWED_ZERO_RULES)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([], []);
    expect(resultaat.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    expect(gelezen.beoordeeld).toBe(true);
    expect(gelezen.totaalJaar.toString()).toBe("0");
    expect(gelezen.regels).toEqual([]);
  });

  it("2. roundtrip meerdere regels, Decimal-precisie exact (meer dan 2 decimalen, negatief bedrag)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [regelInvoer({ jaarbedrag: new Decimal("12345.6789") }), regelInvoer({ complexnummer: "004", jaarbedrag: new Decimal("-500.5") })],
      [25, 10],
    );
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat);

    const ruweRij = db
      .prepare(
        `SELECT jaarbedrag, typeof(jaarbedrag) AS jaarbedrag_type FROM begroting_frozen_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = ? AND regel_id = 25`,
      )
      .get(versie.id) as { jaarbedrag: string; jaarbedrag_type: string };
    expect(ruweRij.jaarbedrag_type).toBe("text");
    expect(ruweRij.jaarbedrag).toBe("12345.6789");

    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.totaalJaar.toString()).toBe(resultaat.totaalJaar.toString());
  });

  it("3. complexnummer=null (NTB) blijft null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ complexnummer: null })], [7]);
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.regels[0]!.regel.invoer.complexnummer).toBeNull();
  });

  it("4. complexnummer gevuld blijft exact behouden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ complexnummer: "010" })], [7]);
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.regels[0]!.regel.invoer.complexnummer).toBe("010");
  });

  it("5. bewust €0 jaarbedrag round-trip blijft exact 0", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ jaarbedrag: new Decimal(0) })], [10]);
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.regels[0]!.regel.jaarbedrag.toString()).toBe("0");
  });

  it("6. negatief jaarbedrag blijft exact negatief, totaalJaar inclusief negatief bedrag", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [regelInvoer({ jaarbedrag: new Decimal(-300) }), regelInvoer({ jaarbedrag: new Decimal(1000) })],
      [10, 20],
    );
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.regels.find((r) => r.persistentieId === 10)!.regel.jaarbedrag.toString()).toBe("-300");
    expect(gelezen.totaalJaar.toString()).toBe("700");
  });

  it("7. controls exact behouden, regelIndex correct vertaald naar/van persistentieId", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Negatief jaarbedrag op de TWEEDE regel -> WAARSCHUWING met regelIndex = 1 -> persistentieId 20.
    const resultaat = berekenMetIds([regelInvoer({ complexnummer: "001" }), regelInvoer({ jaarbedrag: new Decimal(-500) })], [10, 20]);
    const relevanteControl = resultaat.controleVereist.find((c) => c.ernst === "WAARSCHUWING")!;
    expect(relevanteControl.regelIndex).toBe(1);

    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat);

    const ruweControlRij = db
      .prepare(`SELECT regel_id FROM begroting_frozen_correctief_dagelijks_onderhoud_control WHERE begroting_versie_id = ? AND ernst = 'WAARSCHUWING'`)
      .get(versie.id) as { regel_id: number };
    expect(ruweControlRij.regel_id).toBe(20); // persistentieId van regel-index 1, NIET de index zelf

    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    const teruggelezenControl = gelezen.controleVereist.find((c) => c.ernst === "WAARSCHUWING")!;
    expect(teruggelezenControl.regelIndex).toBe(1); // correct terugvertaald naar de leespositie van persistentieId 20
    expect(teruggelezenControl.bericht).toBe(relevanteControl.bericht);
  });

  it("8. control zonder regelIndex (module-breed) round-tript met regel_id = NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([regelInvoer()], [10]);
    // Handmatig een module-brede control toegevoegd — de huidige pure calculator produceert er zelf nog
    // geen, maar de persistence-laag moet dit correct kunnen opslaan/teruglezen (regelIndex: null).
    const resultaat: HerberekendCorrectiefDagelijksResultaat = {
      ...basis,
      controleVereist: [...basis.controleVereist, { regelIndex: null, ernst: "INFORMATIEF", bericht: "module-brede test-control" }],
    };
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat);

    const ruweRij = db
      .prepare(`SELECT regel_id FROM begroting_frozen_correctief_dagelijks_onderhoud_control WHERE begroting_versie_id = ? AND bericht = ?`)
      .get(versie.id, "module-brede test-control") as { regel_id: number | null };
    expect(ruweRij.regel_id).toBeNull();

    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    const teruggelezen = gelezen.controleVereist.find((c) => c.bericht === "module-brede test-control")!;
    expect(teruggelezen.regelIndex).toBeNull();
  });

  it("9. structurele gelijkheid: read-back is volledig gelijk aan het oorspronkelijke resultaat", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [regelInvoer({ complexnummer: "001", jaarbedrag: new Decimal(1000) }), regelInvoer({ complexnummer: "004", jaarbedrag: new Decimal(750) })],
      [10, 20],
    );
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat);
    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;

    // `index` op elke regel-uitkomst heeft geen businessbetekenis (zie moduledoc) — vergelijk de rest wel exact.
    const zonderIndex = (r: HerberekendCorrectiefDagelijksResultaat) => ({
      ...r,
      regels: r.regels.map((x) => ({ persistentieId: x.persistentieId, regel: { ...x.regel, index: undefined } })),
    });
    expect(normaliseer(zonderIndex(gelezen))).toEqual(normaliseer(zonderIndex(resultaat)));
  });
});

describe("atomiciteit / vervangen / rollback", () => {
  it("10. schrijven en vervangen tijdens CONCEPT is toegestaan (complete replacement, geen resten)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, berekenMetIds([regelInvoer({ complexnummer: "001" })], [10]));
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, berekenMetIds([regelInvoer({ complexnummer: "004" })], [99])); // vervangen

    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.regels).toHaveLength(1);
    expect(gelezen.regels[0]?.persistentieId).toBe(99);
    expect(gelezen.regels[0]?.regel.invoer.complexnummer).toBe("004");

    // Geen resten van de vorige regel (id 10).
    expect(db.prepare(`SELECT 1 FROM begroting_frozen_correctief_dagelijks_onderhoud_regel WHERE regel_id = 10`).get()).toBeUndefined();
  });

  it("11. een mislukte frozen write (CHECK-schending op review_status) laat het vorige geldige resultaat exact intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geldigResultaat = berekenMetIds([regelInvoer()], [10]);
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, geldigResultaat);

    // Bewust corrupt: de pure `reviewStatus`-waarde vervangen door iets dat de frozen CHECK niet toestaat —
    // een échte DB-fout MIDDEN in de INSERT-reeks van dit tweede resultaat.
    const kapotResultaat: HerberekendCorrectiefDagelijksResultaat = {
      ...geldigResultaat,
      reviewStatus: "NOT_REVIEWED" as never,
    };

    expect(() => schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, kapotResultaat)).toThrow(/CHECK constraint failed/);

    const naMislukking = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    const zonderIndex = (r: HerberekendCorrectiefDagelijksResultaat) => ({
      ...r,
      regels: r.regels.map((x) => ({ persistentieId: x.persistentieId, regel: { ...x.regel, index: undefined } })),
    });
    expect(normaliseer(zonderIndex(naMislukking))).toEqual(normaliseer(zonderIndex(geldigResultaat)));
  });

  it("12. defensieve bounds-check: een control met een regelIndex buiten bereik faalt fail-fast, geen stille NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([regelInvoer()], [10]);
    const kapotResultaat: HerberekendCorrectiefDagelijksResultaat = {
      ...basis,
      controleVereist: [{ regelIndex: 99, ernst: "INFORMATIEF", bericht: "verwijst naar niet-bestaande regel" }],
    };

    expect(() => schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, kapotResultaat)).toThrow(/correlatie geschonden/);
    expect(leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)).toBeNull(); // geen enkele partiële frozen output achtergebleven
  });
});

describe("frozen read — defensieve integriteit bij een dangling regel_id", () => {
  it("13b. een control die verwijst naar een niet-bestaand regel_id faalt fail-fast bij lezen (geen stille null, geen genegeerde regel)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Normale, consistente schrijfweg — daarna een corrupte control-rij rechtstreeks via SQL toegevoegd,
    // buiten de schrijf-API om (die kan deze inconsistentie zelf niet produceren, zie test 12 hierboven).
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, berekenMetIds([regelInvoer()], [10]));
    db.prepare(
      `INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_control (begroting_versie_id, volgnr, regel_id, ernst, bericht)
       VALUES (?, 99, 999, 'INFORMATIEF', 'verwijst naar een regel_id dat niet bestaat')`,
    ).run(versie.id);

    expect(() => leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)).toThrow(/inconsistente frozen data/);
  });
});

describe("immutability", () => {
  it("13. directe SQL INSERT/UPDATE/DELETE op VASTGESTELD worden geweigerd (alle drie tabellen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, berekenMetIds([regelInvoer()], [10]));
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_resultaat
             (begroting_versie_id, totaal_jaar, beoordeeld, review_status)
           VALUES (?, '0', 1, 'REVIEWED_ZERO_RULES')`,
        )
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`UPDATE begroting_frozen_correctief_dagelijks_onderhoud_resultaat SET totaal_jaar = '999' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`DELETE FROM begroting_frozen_correctief_dagelijks_onderhoud_resultaat WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);

    expect(() =>
      db.prepare(`UPDATE begroting_frozen_correctief_dagelijks_onderhoud_regel SET omschrijving = 'x' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`DELETE FROM begroting_frozen_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 99, 'INFORMATIEF', 'x')`)
        .run(versie.id),
    ).toThrow(/immutable/);
  });

  it("14. schrijven via de API op een VASTGESTELDE versie wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer()], [10]);
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat)).toThrow(/VASTGESTELD/);
  });

  it("lezen blijft na VASTGESTELD gewoon toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer()], [10]);
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.totaalJaar.toString()).toBe(resultaat.totaalJaar.toString());
  });
});

describe("cascade/FK-gedrag", () => {
  it("15. verwijderen van een CONCEPT-versie cascadeert alle drie frozen-tabellen volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, berekenMetIds([regelInvoer()], [10]));

    verwijderConceptVersie(db, versie.id);

    for (const tabel of [
      "begroting_frozen_correctief_dagelijks_onderhoud_resultaat",
      "begroting_frozen_correctief_dagelijks_onderhoud_regel",
      "begroting_frozen_correctief_dagelijks_onderhoud_control",
    ]) {
      expect(db.prepare(`SELECT 1 FROM ${tabel} WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
    }
  });

  it("geen frozen Correctief/Dagelijks-Onderhoud-output geschreven -> leesFrozenCorrectiefDagelijksOnderhoudResultaat geeft null, geen default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen CHECKs — tweede beschermingslaag (migratie 11)", () => {
  it("beoordeeld = 0 wordt geweigerd (frozen output mag alleen ontstaan na een geslaagde vaststel-validatie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_resultaat
             (begroting_versie_id, totaal_jaar, beoordeeld, review_status)
           VALUES (?, '0', 0, 'REVIEWED_ZERO_RULES')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("review_status = NOT_REVIEWED wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_resultaat
             (begroting_versie_id, totaal_jaar, beoordeeld, review_status)
           VALUES (?, '0', 1, 'NOT_REVIEWED')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("een frozen control met een niet-bestaande ernst-waarde wordt geweigerd (structurele domein-CHECK)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    db.prepare(
      `INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_resultaat
         (begroting_versie_id, totaal_jaar, beoordeeld, review_status)
       VALUES (?, '0', 1, 'REVIEWED_ZERO_RULES')`,
    ).run(versie.id);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 0, 'ONGELDIG', 'x')`)
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("ernst = KRITIEK is STRUCTUREEL toegestaan in het schema — de tabel dupliceert de lifecycle-regel niet (die regel staat uitsluitend in vaststellen.ts)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    db.prepare(
      `INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_resultaat
         (begroting_versie_id, totaal_jaar, beoordeeld, review_status)
       VALUES (?, '0', 1, 'REVIEWED_ZERO_RULES')`,
    ).run(versie.id);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 0, 'KRITIEK', 'x')`)
        .run(versie.id),
    ).not.toThrow();
  });

  it("geldige frozen resultaten roundtrippen nog steeds exact, mét alle CHECKs actief", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ complexnummer: "001" }), regelInvoer({ complexnummer: "004" })], [10, 20]);
    expect(() => schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id, resultaat)).not.toThrow();
    const gelezen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.totaalJaar.toString()).toBe(resultaat.totaalJaar.toString());
  });
});
