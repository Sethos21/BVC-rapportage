import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenBegroteGeplandOnderhoud, type BgGeplandOnderhoudAannames, type BgGeplandOnderhoudActiviteitInvoer } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenGeplandOnderhoudResultaat, schrijfFrozenGeplandOnderhoudResultaat } from "./frozenGeplandOnderhoudResultaat.js";
import type { HerberekendGeplandOnderhoudResultaat } from "./herberekenen.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-frozen-gepland-onderhoud-"));
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

function activiteitInvoer(overrides: Partial<BgGeplandOnderhoudActiviteitInvoer> = {}): BgGeplandOnderhoudActiviteitInvoer {
  return {
    complexnummer: "003",
    omschrijving: "Vervangen dakbedekking",
    aanleidingType: "MJOP",
    aanleidingToelichting: "MJOP 2027 regel 14",
    q1: new Decimal(0),
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

const AANNAMES: BgGeplandOnderhoudAannames = { begrotingsjaar: 2027, beoordeeld: true };

/**
 * Berekent via de pure calculator en koppelt (net als GO-P2) persistentie-ids
 * uitsluitend positioneel — hier bewust NIET-sequentiële, willekeurige ids
 * (bv. 10/25/99), zodat geen enkele test per ongeluk op "id = arrayindex" zou
 * kunnen leunen.
 */
function berekenMetIds(
  activiteiten: readonly BgGeplandOnderhoudActiviteitInvoer[],
  ids: readonly number[],
  aannames: BgGeplandOnderhoudAannames = AANNAMES,
): HerberekendGeplandOnderhoudResultaat {
  const resultaat = berekenBegroteGeplandOnderhoud(activiteiten, aannames);
  return {
    ...resultaat,
    activiteiten: resultaat.activiteiten.map((a, i) => ({ persistentieId: ids[i]!, activiteit: a })),
  };
}

describe("schrijfFrozenGeplandOnderhoudResultaat / leesFrozenGeplandOnderhoudResultaat — roundtrip", () => {
  it("1. roundtrip 0 activiteiten (REVIEWED_ZERO_ACTIVITIES)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([], []);
    expect(resultaat.reviewStatus).toBe("REVIEWED_ZERO_ACTIVITIES");
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.reviewStatus).toBe("REVIEWED_ZERO_ACTIVITIES");
    expect(gelezen.totaalJaar.toString()).toBe("0");
    expect(gelezen.activiteiten).toEqual([]);
    expect(gelezen.perComplex).toEqual([]);
  });

  it("2. roundtrip meerdere activiteiten, Decimal-precisie exact (meer dan 2 decimalen, negatief bedrag)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [
        activiteitInvoer({ q1: new Decimal("12345.6789"), q2: new Decimal("-500.5") }),
        activiteitInvoer({ complexnummer: "004", q3: new Decimal(750) }),
      ],
      [25, 10],
    );
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat);

    const ruweRij = db
      .prepare(`SELECT q1, typeof(q1) AS q1_type, q2, typeof(q2) AS q2_type FROM begroting_frozen_gepland_onderhoud_activiteit WHERE begroting_versie_id = ? AND activiteit_id = 25`)
      .get(versie.id) as { q1: string; q1_type: string; q2: string; q2_type: string };
    expect(ruweRij.q1_type).toBe("text");
    expect(ruweRij.q1).toBe("12345.6789");
    expect(ruweRij.q2).toBe("-500.5");

    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    expect(normaliseer(gelezen.kwartaalTotalen)).toEqual(normaliseer(resultaat.kwartaalTotalen));
    expect(gelezen.totaalJaar.toString()).toBe(resultaat.totaalJaar.toString());
  });

  it("3. optionele velden null blijven null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([activiteitInvoer({ leverancier: null, offertebedrag: null, notitie: null })], [7]);
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    const invoer = gelezen.activiteiten[0]!.activiteit.invoer;
    expect(invoer.leverancier).toBeNull();
    expect(invoer.offertebedrag).toBeNull();
    expect(invoer.notitie).toBeNull();
  });

  it("4. optionele velden gevuld blijven exact behouden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [activiteitInvoer({ leverancier: "Weerts van de Zanden", offertebedrag: new Decimal("24500.00"), notitie: "offerte ontvangen" })],
      [7],
    );
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    const invoer = gelezen.activiteiten[0]!.activiteit.invoer;
    expect(invoer.leverancier).toBe("Weerts van de Zanden");
    expect(invoer.offertebedrag?.toString()).toBe("24500");
    expect(invoer.notitie).toBe("offerte ontvangen");
  });

  it("5. meerdere activiteiten zelfde complex worden correct opgeteld in perComplex", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [
        activiteitInvoer({ complexnummer: "001", q1: new Decimal(1000) }),
        activiteitInvoer({ complexnummer: "001", q2: new Decimal(500) }),
      ],
      [10, 20],
    );
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.perComplex).toHaveLength(1);
    expect(gelezen.perComplex[0]).toMatchObject({ complexnummer: "001", aantalActiviteiten: 2 });
    expect(gelezen.perComplex[0]?.jaartotaal.toString()).toBe("1500");
  });

  it("6. perComplex exact gelijk aan het oorspronkelijke resultaat, meerdere complexen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [
        activiteitInvoer({ complexnummer: "001", q1: new Decimal(1000) }),
        activiteitInvoer({ complexnummer: "004", q3: new Decimal(750) }),
      ],
      [10, 20],
    );
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    expect(normaliseer(gelezen.perComplex)).toEqual(normaliseer(resultaat.perComplex));
  });

  it("7. controls exact behouden, activiteitIndex correct vertaald naar/van persistentieId", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Negatief kwartaalbedrag op de TWEEDE activiteit -> WAARSCHUWING met activiteitIndex = 1 -> persistentieId 20.
    const resultaat = berekenMetIds(
      [activiteitInvoer({ complexnummer: "001" }), activiteitInvoer({ complexnummer: "004", q1: new Decimal(-500) })],
      [10, 20],
    );
    const relevanteControl = resultaat.controleVereist.find((c) => c.ernst === "WAARSCHUWING")!;
    expect(relevanteControl.activiteitIndex).toBe(1);

    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat);

    const ruweControlRij = db
      .prepare(`SELECT activiteit_id FROM begroting_frozen_gepland_onderhoud_control WHERE begroting_versie_id = ? AND ernst = 'WAARSCHUWING'`)
      .get(versie.id) as { activiteit_id: number };
    expect(ruweControlRij.activiteit_id).toBe(20); // persistentieId van activiteit-index 1, NIET de index zelf

    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    const teruggelezenControl = gelezen.controleVereist.find((c) => c.ernst === "WAARSCHUWING")!;
    expect(teruggelezenControl.activiteitIndex).toBe(1); // correct terugvertaald naar de leespositie van persistentieId 20
    expect(teruggelezenControl.bericht).toBe(relevanteControl.bericht);
  });

  it("8. control zonder activiteitIndex (module-breed) round-tript met activiteit_id = NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([activiteitInvoer()], [10]);
    // Handmatig een module-brede control toegevoegd — de huidige pure calculator produceert er zelf nog
    // geen, maar de persistence-laag moet dit correct kunnen opslaan/teruglezen (activiteitIndex: null).
    const resultaat: HerberekendGeplandOnderhoudResultaat = {
      ...basis,
      controleVereist: [...basis.controleVereist, { activiteitIndex: null, ernst: "INFORMATIEF", bericht: "module-brede test-control" }],
    };
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat);

    const ruweRij = db
      .prepare(`SELECT activiteit_id FROM begroting_frozen_gepland_onderhoud_control WHERE begroting_versie_id = ? AND bericht = ?`)
      .get(versie.id, "module-brede test-control") as { activiteit_id: number | null };
    expect(ruweRij.activiteit_id).toBeNull();

    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    const teruggelezen = gelezen.controleVereist.find((c) => c.bericht === "module-brede test-control")!;
    expect(teruggelezen.activiteitIndex).toBeNull();
  });

  it("9. structurele gelijkheid: read-back is volledig gelijk aan het oorspronkelijke resultaat", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [
        activiteitInvoer({ complexnummer: "001", q1: new Decimal(1000) }),
        activiteitInvoer({ complexnummer: "004", q3: new Decimal(750), leverancier: "Test BV", offertebedrag: new Decimal(500), notitie: "n" }),
      ],
      [10, 20],
    );
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat);
    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;

    // `index` op elke activiteit-uitkomst heeft geen businessbetekenis (zie moduledoc) — vergelijk de rest wel exact.
    const zonderIndex = (r: HerberekendGeplandOnderhoudResultaat) => ({
      ...r,
      activiteiten: r.activiteiten.map((a) => ({ persistentieId: a.persistentieId, activiteit: { ...a.activiteit, index: undefined } })),
    });
    expect(normaliseer(zonderIndex(gelezen))).toEqual(normaliseer(zonderIndex(resultaat)));
  });
});

describe("atomiciteit / vervangen / rollback", () => {
  it("10. schrijven en vervangen tijdens CONCEPT is toegestaan (complete replacement, geen resten)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, berekenMetIds([activiteitInvoer({ complexnummer: "001" })], [10]));
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, berekenMetIds([activiteitInvoer({ complexnummer: "004" })], [99])); // vervangen

    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.activiteiten).toHaveLength(1);
    expect(gelezen.activiteiten[0]?.persistentieId).toBe(99);
    expect(gelezen.activiteiten[0]?.activiteit.invoer.complexnummer).toBe("004");

    // Geen resten van de vorige activiteit (id 10).
    expect(db.prepare(`SELECT 1 FROM begroting_frozen_gepland_onderhoud_activiteit WHERE activiteit_id = 10`).get()).toBeUndefined();
  });

  it("11. een mislukte frozen write (CHECK-schending op status) laat het vorige geldige resultaat exact intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geldigResultaat = berekenMetIds([activiteitInvoer()], [10]);
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, geldigResultaat);

    // Bewust corrupt: de pure `status`-waarde vervangen door iets dat de frozen CHECK niet toestaat —
    // een échte DB-fout MIDDEN in de INSERT-reeks van dit tweede resultaat.
    const kapotResultaat: HerberekendGeplandOnderhoudResultaat = {
      ...geldigResultaat,
      activiteiten: geldigResultaat.activiteiten.map((a) => ({
        ...a,
        activiteit: { ...a.activiteit, invoer: { ...a.activiteit.invoer, status: "NIET_BESTAAND" as never } },
      })),
    };

    expect(() => schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, kapotResultaat)).toThrow(/CHECK constraint failed/);

    const naMislukking = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    const zonderIndex = (r: HerberekendGeplandOnderhoudResultaat) => ({
      ...r,
      activiteiten: r.activiteiten.map((a) => ({ persistentieId: a.persistentieId, activiteit: { ...a.activiteit, index: undefined } })),
    });
    expect(normaliseer(zonderIndex(naMislukking))).toEqual(normaliseer(zonderIndex(geldigResultaat)));
  });

  it("12. defensieve bounds-check: een control met een activiteitIndex buiten bereik faalt fail-fast, geen stille NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([activiteitInvoer()], [10]);
    const kapotResultaat: HerberekendGeplandOnderhoudResultaat = {
      ...basis,
      controleVereist: [{ activiteitIndex: 99, ernst: "INFORMATIEF", bericht: "verwijst naar niet-bestaande activiteit" }],
    };

    expect(() => schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, kapotResultaat)).toThrow(/correlatie geschonden/);
    expect(leesFrozenGeplandOnderhoudResultaat(db, versie.id)).toBeNull(); // geen enkele partiële frozen output achtergebleven
  });
});

describe("frozen read — defensieve integriteit bij een dangling activiteit_id", () => {
  it("13b. een control die verwijst naar een niet-bestaand activiteit_id faalt fail-fast bij lezen (geen stille null, geen genegeerde activiteit)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Normale, consistente schrijfweg — daarna een corrupte control-rij rechtstreeks via SQL toegevoegd,
    // buiten de schrijf-API om (die kan deze inconsistentie zelf niet produceren, zie test 12 hierboven).
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, berekenMetIds([activiteitInvoer()], [10]));
    db.prepare(
      `INSERT INTO begroting_frozen_gepland_onderhoud_control (begroting_versie_id, volgnr, activiteit_id, ernst, bericht)
       VALUES (?, 99, 999, 'INFORMATIEF', 'verwijst naar een activiteit_id dat niet bestaat')`,
    ).run(versie.id);

    expect(() => leesFrozenGeplandOnderhoudResultaat(db, versie.id)).toThrow(/inconsistente frozen data/);
  });
});

describe("immutability", () => {
  it("13. directe SQL INSERT/UPDATE/DELETE op VASTGESTELD worden geweigerd (alle vier tabellen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, berekenMetIds([activiteitInvoer()], [10]));
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_gepland_onderhoud_resultaat
             (begroting_versie_id, totaal_q1, totaal_q2, totaal_q3, totaal_q4, totaal_jaar, totaal_zonder_geldig_complex, beoordeeld, review_status)
           VALUES (?, '0','0','0','0','0','0', 1, 'REVIEWED_ZERO_ACTIVITIES')`,
        )
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE begroting_frozen_gepland_onderhoud_resultaat SET totaal_jaar = '999' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
    expect(() => db.prepare(`DELETE FROM begroting_frozen_gepland_onderhoud_resultaat WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );

    expect(() => db.prepare(`UPDATE begroting_frozen_gepland_onderhoud_activiteit SET omschrijving = 'x' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
    expect(() => db.prepare(`DELETE FROM begroting_frozen_gepland_onderhoud_activiteit WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );

    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_gepland_onderhoud_complex (begroting_versie_id, complexnummer, volgnr, aantal_activiteiten, q1, q2, q3, q4, jaartotaal)
           VALUES (?, '999', 99, 0, '0','0','0','0','0')`,
        )
        .run(versie.id),
    ).toThrow(/immutable/);

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_gepland_onderhoud_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 99, 'INFORMATIEF', 'x')`)
        .run(versie.id),
    ).toThrow(/immutable/);
  });

  it("14. schrijven via de API op een VASTGESTELDE versie wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([activiteitInvoer()], [10]);
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat)).toThrow(/VASTGESTELD/);
  });

  it("lezen blijft na VASTGESTELD gewoon toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([activiteitInvoer()], [10]);
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.totaalJaar.toString()).toBe(resultaat.totaalJaar.toString());
  });
});

describe("cascade/FK-gedrag", () => {
  it("15. verwijderen van een CONCEPT-versie cascadeert alle vier frozen-tabellen volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, berekenMetIds([activiteitInvoer()], [10]));

    verwijderConceptVersie(db, versie.id);

    for (const tabel of [
      "begroting_frozen_gepland_onderhoud_resultaat",
      "begroting_frozen_gepland_onderhoud_activiteit",
      "begroting_frozen_gepland_onderhoud_complex",
      "begroting_frozen_gepland_onderhoud_control",
    ]) {
      expect(db.prepare(`SELECT 1 FROM ${tabel} WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
    }
  });

  it("geen frozen Gepland-Onderhoud-output geschreven -> leesFrozenGeplandOnderhoudResultaat geeft null, geen default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesFrozenGeplandOnderhoudResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen CHECKs — tweede beschermingslaag (migratie 9)", () => {
  it("beoordeeld = 0 wordt geweigerd (frozen output mag alleen ontstaan na een geslaagde vaststel-validatie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_gepland_onderhoud_resultaat
             (begroting_versie_id, totaal_q1, totaal_q2, totaal_q3, totaal_q4, totaal_jaar, totaal_zonder_geldig_complex, beoordeeld, review_status)
           VALUES (?, '0','0','0','0','0','0', 0, 'REVIEWED_ZERO_ACTIVITIES')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("review_status = NOT_REVIEWED wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_gepland_onderhoud_resultaat
             (begroting_versie_id, totaal_q1, totaal_q2, totaal_q3, totaal_q4, totaal_jaar, totaal_zonder_geldig_complex, beoordeeld, review_status)
           VALUES (?, '0','0','0','0','0','0', 1, 'NOT_REVIEWED')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("een ongeldige aanleiding_type op een frozen activiteit wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    db.prepare(
      `INSERT INTO begroting_frozen_gepland_onderhoud_resultaat
         (begroting_versie_id, totaal_q1, totaal_q2, totaal_q3, totaal_q4, totaal_jaar, totaal_zonder_geldig_complex, beoordeeld, review_status)
       VALUES (?, '0','0','0','0','0','0', 1, 'REVIEWED_WITH_ACTIVITIES')`,
    ).run(versie.id);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_gepland_onderhoud_activiteit
             (begroting_versie_id, activiteit_id, complexnummer, omschrijving, aanleiding_type, aanleiding_toelichting, q1, q2, q3, q4, jaartotaal, status)
           VALUES (?, 1, '001', 'x', 'ONGELDIG', 'x', '0','0','0','0','0', 'GEPLAND')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("een ongeldige status op een frozen activiteit wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    db.prepare(
      `INSERT INTO begroting_frozen_gepland_onderhoud_resultaat
         (begroting_versie_id, totaal_q1, totaal_q2, totaal_q3, totaal_q4, totaal_jaar, totaal_zonder_geldig_complex, beoordeeld, review_status)
       VALUES (?, '0','0','0','0','0','0', 1, 'REVIEWED_WITH_ACTIVITIES')`,
    ).run(versie.id);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_gepland_onderhoud_activiteit
             (begroting_versie_id, activiteit_id, complexnummer, omschrijving, aanleiding_type, aanleiding_toelichting, q1, q2, q3, q4, jaartotaal, status)
           VALUES (?, 1, '001', 'x', 'MJOP', 'x', '0','0','0','0','0', 'ONGELDIG')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("een frozen control met een niet-bestaande ernst-waarde wordt geweigerd (structurele domein-CHECK)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    db.prepare(
      `INSERT INTO begroting_frozen_gepland_onderhoud_resultaat
         (begroting_versie_id, totaal_q1, totaal_q2, totaal_q3, totaal_q4, totaal_jaar, totaal_zonder_geldig_complex, beoordeeld, review_status)
       VALUES (?, '0','0','0','0','0','0', 1, 'REVIEWED_ZERO_ACTIVITIES')`,
    ).run(versie.id);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_gepland_onderhoud_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 0, 'ONGELDIG', 'x')`)
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("ernst = KRITIEK is STRUCTUREEL toegestaan in het schema — de tabel dupliceert de lifecycle-regel niet (die regel staat uitsluitend in vaststellen.ts)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    db.prepare(
      `INSERT INTO begroting_frozen_gepland_onderhoud_resultaat
         (begroting_versie_id, totaal_q1, totaal_q2, totaal_q3, totaal_q4, totaal_jaar, totaal_zonder_geldig_complex, beoordeeld, review_status)
       VALUES (?, '0','0','0','0','0','0', 1, 'REVIEWED_ZERO_ACTIVITIES')`,
    ).run(versie.id);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_gepland_onderhoud_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 0, 'KRITIEK', 'x')`)
        .run(versie.id),
    ).not.toThrow();
  });

  it("geldige frozen resultaten roundtrippen nog steeds exact, mét alle CHECKs actief", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([activiteitInvoer({ complexnummer: "001" }), activiteitInvoer({ complexnummer: "004" })], [10, 20]);
    expect(() => schrijfFrozenGeplandOnderhoudResultaat(db, versie.id, resultaat)).not.toThrow();
    const gelezen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    expect(gelezen.totaalJaar.toString()).toBe(resultaat.totaalJaar.toString());
  });
});
