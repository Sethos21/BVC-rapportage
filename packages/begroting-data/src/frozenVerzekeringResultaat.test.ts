import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenBegroteVerzekeringen, type BgVerzekeringAannames, type BgVerzekeringRegelInvoer } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenVerzekeringResultaat, schrijfFrozenVerzekeringResultaat } from "./frozenVerzekeringResultaat.js";
import type { HerberekendVerzekeringResultaat } from "./herberekenen.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-frozen-verzekering-"));
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
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (val instanceof Decimal) return { __decimal__: val.toString() };
      if (val instanceof Date) return { __date__: val.toISOString() };
      return val;
    }),
  );
}

function regelInvoer(overrides: Partial<BgVerzekeringRegelInvoer> = {}): BgVerzekeringRegelInvoer {
  return {
    complexnummer: "001",
    verzekeraar: "Assuradeuren Gilde B.V.",
    ingangsdatum: new Date(Date.UTC(2020, 6, 1)),
    looptijdMaanden: 12,
    bedrag: new Decimal(12000),
    indexPercentage: new Decimal(3),
    handmatigBegrootOverride: null,
    ...overrides,
  };
}

const AANNAMES: BgVerzekeringAannames = { begrotingsjaar: 2027, beoordeeld: true };

/**
 * Berekent via de pure calculator en koppelt (net als CD-P2) persistentie-ids
 * uitsluitend positioneel — hier bewust NIET-sequentiële, willekeurige ids
 * (bv. 10/25/99), zodat geen enkele test per ongeluk op "id = arrayindex" zou
 * kunnen leunen.
 */
function berekenMetIds(
  regels: readonly BgVerzekeringRegelInvoer[],
  ids: readonly number[],
  aannames: BgVerzekeringAannames = AANNAMES,
): HerberekendVerzekeringResultaat {
  const resultaat = berekenBegroteVerzekeringen(regels, aannames);
  return {
    ...resultaat,
    regels: resultaat.regels.map((r, i) => ({ persistentieId: ids[i]!, regel: r })),
  };
}

describe("schrijfFrozenVerzekeringResultaat / leesFrozenVerzekeringResultaat — roundtrip", () => {
  it("1. roundtrip 0 regels (REVIEWED_ZERO_POLICIES)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([], []);
    expect(resultaat.reviewStatus).toBe("REVIEWED_ZERO_POLICIES");
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    expect(gelezen.reviewStatus).toBe("REVIEWED_ZERO_POLICIES");
    expect(gelezen.beoordeeld).toBe(true);
    expect(gelezen.totaalBerekendBegroot.toString()).toBe("0");
    expect(gelezen.totaalEffectiefBegroot.toString()).toBe("0");
    expect(gelezen.regels).toEqual([]);
  });

  it("2. roundtrip meerdere regels, Decimal-precisie exact (meer dan 2 decimalen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [
        regelInvoer({ bedrag: new Decimal("12345.6789"), indexPercentage: new Decimal("2.5") }),
        regelInvoer({ complexnummer: "004", bedrag: new Decimal("500.5") }),
      ],
      [25, 10],
    );
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);

    const ruweRij = db
      .prepare(`SELECT bedrag, typeof(bedrag) AS bedrag_type FROM begroting_frozen_verzekering_regel WHERE begroting_versie_id = ? AND regel_id = 25`)
      .get(versie.id) as { bedrag: string; bedrag_type: string };
    expect(ruweRij.bedrag_type).toBe("text");
    expect(ruweRij.bedrag).toBe("12345.6789");

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    expect(gelezen.totaalBerekendBegroot.toString()).toBe(resultaat.totaalBerekendBegroot.toString());
  });

  it("3. complexnummer/verzekeraar/ingangsdatum/looptijdMaanden round-trip exact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ complexnummer: "010", verzekeraar: "Interpolis", ingangsdatum: new Date(Date.UTC(2019, 0, 15)), looptijdMaanden: 24 })], [7]);
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    const invoer = gelezen.regels[0]!.regel.invoer;
    expect(invoer.complexnummer).toBe("010");
    expect(invoer.verzekeraar).toBe("Interpolis");
    expect(invoer.ingangsdatum).toEqual(new Date(Date.UTC(2019, 0, 15)));
    expect(invoer.looptijdMaanden).toBe(24);
  });

  it("4. handmatigBegrootOverride null vs. bewuste €0 blijven onderscheiden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [regelInvoer({ complexnummer: "001", handmatigBegrootOverride: null }), regelInvoer({ complexnummer: "002", handmatigBegrootOverride: new Decimal(0) })],
      [10, 20],
    );
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    expect(gelezen.regels.find((r) => r.persistentieId === 10)!.regel.invoer.handmatigBegrootOverride).toBeNull();
    expect(gelezen.regels.find((r) => r.persistentieId === 20)!.regel.invoer.handmatigBegrootOverride?.toString()).toBe("0");
    expect(gelezen.regels.find((r) => r.persistentieId === 20)!.regel.effectiefBegroot.toString()).toBe("0");
  });

  it("5. eersteRelevanteVerlengmoment en het exacte aantalRelevanteVerlengmomenten (1 verlengmoment) round-trippen exact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ ingangsdatum: new Date(Date.UTC(2020, 6, 1)), looptijdMaanden: 12 })], [10]);
    expect(resultaat.regels[0]!.regel.eersteRelevanteVerlengmoment).toEqual(new Date(Date.UTC(2027, 6, 1)));
    expect(resultaat.regels[0]!.regel.aantalRelevanteVerlengmomenten).toBe(1);
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    expect(gelezen.regels[0]!.regel.eersteRelevanteVerlengmoment).toEqual(new Date(Date.UTC(2027, 6, 1)));
    expect(gelezen.regels[0]!.regel.relevanteVerlengmomenten).toEqual([new Date(Date.UTC(2027, 6, 1))]);
    expect(gelezen.regels[0]!.regel.aantalRelevanteVerlengmomenten).toBe(1);
  });

  it("6. geen verlengmoment dit jaar -> eersteRelevanteVerlengmoment blijft null, aantalRelevanteVerlengmomenten blijft exact 0 na round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ ingangsdatum: new Date(Date.UTC(2026, 6, 1)), looptijdMaanden: 24 })], [10]);
    expect(resultaat.regels[0]!.regel.aantalRelevanteVerlengmomenten).toBe(0);
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    expect(gelezen.regels[0]!.regel.eersteRelevanteVerlengmoment).toBeNull();
    expect(gelezen.regels[0]!.regel.relevanteVerlengmomenten).toEqual([]);
    expect(gelezen.regels[0]!.regel.aantalRelevanteVerlengmomenten).toBe(0);
  });

  it("6b (code-review-correctie). meerdere verlengmomenten binnen hetzelfde jaar: het EXACTE aantal blijft na frozen round-trip behouden, ook al bevat de teruggelezen datumlijst alleen het eerste moment", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // looptijd 6 maanden vanaf 01-01-2026 -> twee verlengmomenten binnen begrotingsjaar 2027 (01-01 en 01-07).
    const resultaat = berekenMetIds([regelInvoer({ ingangsdatum: new Date(Date.UTC(2026, 0, 1)), looptijdMaanden: 6 })], [10]);
    expect(resultaat.regels[0]!.regel.relevanteVerlengmomenten).toHaveLength(2);
    expect(resultaat.regels[0]!.regel.aantalRelevanteVerlengmomenten).toBe(2);
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);

    const ruweRij = db
      .prepare(`SELECT aantal_relevante_verlengmomenten FROM begroting_frozen_verzekering_regel WHERE begroting_versie_id = ?`)
      .get(versie.id) as { aantal_relevante_verlengmomenten: number };
    expect(ruweRij.aantal_relevante_verlengmomenten).toBe(2);

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    // Bewust NIET gelijk aan de oorspronkelijke lijst-lengte (2) — de teruggelezen datumlijst bevat
    // hooguit het eerste moment (zie moduledoc, bewuste vereenvoudiging). Het EXACTE aantal blijft
    // wél apart, correct, behouden via het eigen veld.
    expect(gelezen.regels[0]!.regel.relevanteVerlengmomenten).toHaveLength(1);
    expect(gelezen.regels[0]!.regel.aantalRelevanteVerlengmomenten).toBe(2);
  });

  it("6c (code-review-correctie). frozen read reconstrueert het aantal NOOIT opnieuw via businesslogica — een bewust inconsistent bevroren aantal blijft ongewijzigd teruggelezen", () => {
    // Bewijst dat leesFrozenVerzekeringResultaat de pure calculator niet opnieuw aanroept: een frozen rij
    // met een aantal dat NIET overeenkomt met wat een live herberekening van dezelfde ingangsdatum/
    // looptijd/begrotingsjaar zou opleveren, komt ONGEWIJZIGD terug — zou dit wél herberekend worden, dan
    // zou hier het correcte aantal (1) terugkomen in plaats van het kunstmatig afwijkende bevroren aantal.
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ ingangsdatum: new Date(Date.UTC(2020, 6, 1)), looptijdMaanden: 12 })], [10]);
    expect(resultaat.regels[0]!.regel.aantalRelevanteVerlengmomenten).toBe(1); // werkelijke, correcte waarde
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);

    // De versie is hier bewust nog CONCEPT (geen `markeerVastgesteld` aangeroepen) — de
    // immutability-triggers blokkeren pas na VASTGESTELD, dus deze directe SQL-mutatie is hier
    // toegestaan en dient uitsluitend om een kunstmatig inconsistent bevroren aantal te simuleren.
    db.prepare(`UPDATE begroting_frozen_verzekering_regel SET aantal_relevante_verlengmomenten = 7 WHERE begroting_versie_id = ?`).run(versie.id);

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    expect(gelezen.regels[0]!.regel.aantalRelevanteVerlengmomenten).toBe(7); // het kunstmatig gemanipuleerde bevroren aantal, NIET herberekend naar 1
  });

  it("7. controls exact behouden, regelIndex correct vertaald naar/van persistentieId", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Negatief bedrag op de TWEEDE regel -> WAARSCHUWING met regelIndex = 1 -> persistentieId 20.
    const resultaat = berekenMetIds([regelInvoer({ complexnummer: "001" }), regelInvoer({ bedrag: new Decimal(-500) })], [10, 20]);
    const relevanteControl = resultaat.controleVereist.find((c) => c.ernst === "WAARSCHUWING")!;
    expect(relevanteControl.regelIndex).toBe(1);

    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);

    const ruweControlRij = db
      .prepare(`SELECT regel_id FROM begroting_frozen_verzekering_control WHERE begroting_versie_id = ? AND ernst = 'WAARSCHUWING'`)
      .get(versie.id) as { regel_id: number };
    expect(ruweControlRij.regel_id).toBe(20);

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    const teruggelezenControl = gelezen.controleVereist.find((c) => c.ernst === "WAARSCHUWING")!;
    expect(teruggelezenControl.regelIndex).toBe(1);
    expect(teruggelezenControl.bericht).toBe(relevanteControl.bericht);
  });

  it("8. control zonder regelIndex (module-breed) round-tript met regel_id = NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([regelInvoer()], [10]);
    const resultaat: HerberekendVerzekeringResultaat = {
      ...basis,
      controleVereist: [...basis.controleVereist, { regelIndex: null, ernst: "INFORMATIEF", bericht: "module-brede test-control" }],
    };
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);

    const ruweRij = db
      .prepare(`SELECT regel_id FROM begroting_frozen_verzekering_control WHERE begroting_versie_id = ? AND bericht = ?`)
      .get(versie.id, "module-brede test-control") as { regel_id: number | null };
    expect(ruweRij.regel_id).toBeNull();

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    const teruggelezen = gelezen.controleVereist.find((c) => c.bericht === "module-brede test-control")!;
    expect(teruggelezen.regelIndex).toBeNull();
  });

  it("9. structurele gelijkheid: read-back is volledig gelijk aan het oorspronkelijke resultaat", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [regelInvoer({ complexnummer: "001" }), regelInvoer({ complexnummer: "004", verzekeraar: "Interpolis", bedrag: new Decimal(750) })],
      [10, 20],
    );
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);
    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;

    // `index` op elke regel-uitkomst heeft geen businessbetekenis — vergelijk de rest wel exact.
    const zonderIndex = (r: HerberekendVerzekeringResultaat) => ({
      ...r,
      regels: r.regels.map((x) => ({ persistentieId: x.persistentieId, regel: { ...x.regel, index: undefined } })),
    });
    expect(normaliseer(zonderIndex(gelezen))).toEqual(normaliseer(zonderIndex(resultaat)));
  });
});

describe("atomiciteit / vervangen / rollback", () => {
  it("10. schrijven en vervangen tijdens CONCEPT is toegestaan (complete replacement, geen resten)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenVerzekeringResultaat(db, versie.id, berekenMetIds([regelInvoer({ complexnummer: "001" })], [10]));
    schrijfFrozenVerzekeringResultaat(db, versie.id, berekenMetIds([regelInvoer({ complexnummer: "004" })], [99]));

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    expect(gelezen.regels).toHaveLength(1);
    expect(gelezen.regels[0]?.persistentieId).toBe(99);
    expect(gelezen.regels[0]?.regel.invoer.complexnummer).toBe("004");

    expect(db.prepare(`SELECT 1 FROM begroting_frozen_verzekering_regel WHERE regel_id = 10`).get()).toBeUndefined();
  });

  it("11. een mislukte frozen write (CHECK-schending op review_status) laat het vorige geldige resultaat exact intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geldigResultaat = berekenMetIds([regelInvoer()], [10]);
    schrijfFrozenVerzekeringResultaat(db, versie.id, geldigResultaat);

    const kapotResultaat: HerberekendVerzekeringResultaat = { ...geldigResultaat, reviewStatus: "NOT_REVIEWED" as never };

    expect(() => schrijfFrozenVerzekeringResultaat(db, versie.id, kapotResultaat)).toThrow(/CHECK constraint failed/);

    const naMislukking = leesFrozenVerzekeringResultaat(db, versie.id)!;
    const zonderIndex = (r: HerberekendVerzekeringResultaat) => ({
      ...r,
      regels: r.regels.map((x) => ({ persistentieId: x.persistentieId, regel: { ...x.regel, index: undefined } })),
    });
    expect(normaliseer(zonderIndex(naMislukking))).toEqual(normaliseer(zonderIndex(geldigResultaat)));
  });

  it("12. defensieve bounds-check: een control met een regelIndex buiten bereik faalt fail-fast, geen stille NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([regelInvoer()], [10]);
    const kapotResultaat: HerberekendVerzekeringResultaat = {
      ...basis,
      controleVereist: [{ regelIndex: 99, ernst: "INFORMATIEF", bericht: "verwijst naar niet-bestaande regel" }],
    };

    expect(() => schrijfFrozenVerzekeringResultaat(db, versie.id, kapotResultaat)).toThrow(/correlatie geschonden/);
    expect(leesFrozenVerzekeringResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen read — defensieve integriteit bij een dangling regel_id", () => {
  it("13b. een control die verwijst naar een niet-bestaand regel_id faalt fail-fast bij lezen (geen stille null, geen genegeerde regel)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenVerzekeringResultaat(db, versie.id, berekenMetIds([regelInvoer()], [10]));
    db.prepare(
      `INSERT INTO begroting_frozen_verzekering_control (begroting_versie_id, volgnr, regel_id, ernst, bericht)
       VALUES (?, 99, 999, 'INFORMATIEF', 'verwijst naar een regel_id dat niet bestaat')`,
    ).run(versie.id);

    expect(() => leesFrozenVerzekeringResultaat(db, versie.id)).toThrow(/inconsistente frozen data/);
  });
});

describe("immutability", () => {
  it("13. directe SQL INSERT/UPDATE/DELETE op VASTGESTELD worden geweigerd (alle drie tabellen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenVerzekeringResultaat(db, versie.id, berekenMetIds([regelInvoer()], [10]));
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_verzekering_resultaat (begroting_versie_id, totaal_berekend_begroot, totaal_effectief_begroot, beoordeeld, review_status)
           VALUES (?, '0', '0', 1, 'REVIEWED_ZERO_POLICIES')`,
        )
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`UPDATE begroting_frozen_verzekering_resultaat SET totaal_berekend_begroot = '999' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_verzekering_resultaat WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);

    expect(() => db.prepare(`UPDATE begroting_frozen_verzekering_regel SET verzekeraar = 'x' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
    expect(() => db.prepare(`DELETE FROM begroting_frozen_verzekering_regel WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_verzekering_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 99, 'INFORMATIEF', 'x')`)
        .run(versie.id),
    ).toThrow(/immutable/);
  });

  it("14. schrijven via de API op een VASTGESTELDE versie wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer()], [10]);
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat)).toThrow(/VASTGESTELD/);
  });

  it("lezen blijft na VASTGESTELD gewoon toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer()], [10]);
    schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    expect(gelezen.totaalBerekendBegroot.toString()).toBe(resultaat.totaalBerekendBegroot.toString());
  });
});

describe("cascade/FK-gedrag", () => {
  it("15. verwijderen van een CONCEPT-versie cascadeert alle drie frozen-tabellen volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenVerzekeringResultaat(db, versie.id, berekenMetIds([regelInvoer()], [10]));

    verwijderConceptVersie(db, versie.id);

    for (const tabel of ["begroting_frozen_verzekering_resultaat", "begroting_frozen_verzekering_regel", "begroting_frozen_verzekering_control"]) {
      expect(db.prepare(`SELECT 1 FROM ${tabel} WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
    }
  });

  it("geen frozen Verzekeringen-output geschreven -> leesFrozenVerzekeringResultaat geeft null, geen default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesFrozenVerzekeringResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen CHECKs — tweede beschermingslaag (migratie 13)", () => {
  it("beoordeeld = 0 wordt geweigerd (frozen output mag alleen ontstaan na een geslaagde vaststel-validatie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_verzekering_resultaat (begroting_versie_id, totaal_berekend_begroot, totaal_effectief_begroot, beoordeeld, review_status)
           VALUES (?, '0', '0', 0, 'REVIEWED_ZERO_POLICIES')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("review_status = NOT_REVIEWED wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_verzekering_resultaat (begroting_versie_id, totaal_berekend_begroot, totaal_effectief_begroot, beoordeeld, review_status)
           VALUES (?, '0', '0', 1, 'NOT_REVIEWED')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("een frozen control met een niet-bestaande ernst-waarde wordt geweigerd (structurele domein-CHECK)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    db.prepare(
      `INSERT INTO begroting_frozen_verzekering_resultaat (begroting_versie_id, totaal_berekend_begroot, totaal_effectief_begroot, beoordeeld, review_status)
       VALUES (?, '0', '0', 1, 'REVIEWED_ZERO_POLICIES')`,
    ).run(versie.id);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_verzekering_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 0, 'ONGELDIG', 'x')`)
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("ernst = KRITIEK is STRUCTUREEL toegestaan in het schema — de tabel dupliceert de lifecycle-regel niet (die regel staat uitsluitend in vaststellen.ts)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    db.prepare(
      `INSERT INTO begroting_frozen_verzekering_resultaat (begroting_versie_id, totaal_berekend_begroot, totaal_effectief_begroot, beoordeeld, review_status)
       VALUES (?, '0', '0', 1, 'REVIEWED_ZERO_POLICIES')`,
    ).run(versie.id);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_verzekering_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 0, 'KRITIEK', 'x')`)
        .run(versie.id),
    ).not.toThrow();
  });

  it("geldige frozen resultaten roundtrippen nog steeds exact, mét alle CHECKs actief", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ complexnummer: "001" }), regelInvoer({ complexnummer: "004" })], [10, 20]);
    expect(() => schrijfFrozenVerzekeringResultaat(db, versie.id, resultaat)).not.toThrow();
    const gelezen = leesFrozenVerzekeringResultaat(db, versie.id)!;
    expect(gelezen.totaalBerekendBegroot.toString()).toBe(resultaat.totaalBerekendBegroot.toString());
  });
});
