import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenBegroteGemeentelijkeLasten, type BgGemeentelijkeLastenAannames, type BgWozObjectInvoer } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import {
  leesFrozenGemeentelijkeLastenResultaat,
  schrijfFrozenGemeentelijkeLastenResultaat,
  type FrozenGemeentelijkeLastenResultaat,
} from "./frozenGemeentelijkeLastenResultaat.js";
import type { HerberekendGemeentelijkeLastenResultaat } from "./herberekenen.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-frozen-gemeentelijke-lasten-"));
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

function wozObject(overrides: Partial<BgWozObjectInvoer> = {}): BgWozObjectInvoer {
  return {
    complexnummer: "001",
    wozObjectAdres: "Prins Willem-Alexander Sportpark 2",
    aanslagjaar: 2026,
    waardepeildatum: new Date(Date.UTC(2026, 0, 1)),
    werkelijkeWoz: new Decimal(1000000),
    verwachteWozOverride: null,
    ...overrides,
  };
}

const AANNAMES: BgGemeentelijkeLastenAannames = {
  begrotingsjaar: 2027,
  werkelijkeGemeentelijkeLasten: new Decimal(9000),
  wozStijgingPercentage: new Decimal(10),
  lastenPercentageStijging: new Decimal(5),
  begrotingsPercentageOverride: null,
  beoordeeld: true,
};

/**
 * Berekent via de pure calculator en koppelt (net als bij Verzekeringen)
 * persistentie-ids uitsluitend positioneel — hier bewust NIET-sequentiële,
 * willekeurige ids (bv. 10/25/99), zodat geen enkele test per ongeluk op
 * "id = arrayindex" zou kunnen leunen.
 */
function berekenMetIds(
  wozObjecten: readonly BgWozObjectInvoer[],
  ids: readonly number[],
  aannames: BgGemeentelijkeLastenAannames = AANNAMES,
): HerberekendGemeentelijkeLastenResultaat {
  const resultaat = berekenBegroteGemeentelijkeLasten(wozObjecten, aannames);
  return {
    ...resultaat,
    wozObjecten: resultaat.wozObjecten.map((o, i) => ({ persistentieId: ids[i]!, wozObject: o })),
  };
}

/** Zelfde principe als `berekenMetIds`, maar bewaart ook de bevroren `werkelijkeGemeentelijkeLasten`-parameter apart, exact zoals `vaststellen.ts` die doorgeeft. */
function schrijf(versieId: string, resultaat: HerberekendGemeentelijkeLastenResultaat, werkelijkeGemeentelijkeLasten: Decimal | null = AANNAMES.werkelijkeGemeentelijkeLasten) {
  schrijfFrozenGemeentelijkeLastenResultaat(db, versieId, resultaat, werkelijkeGemeentelijkeLasten);
}

const zonderIndex = (r: FrozenGemeentelijkeLastenResultaat) => ({
  ...r,
  wozObjecten: r.wozObjecten.map((x) => ({ persistentieId: x.persistentieId, wozObject: { ...x.wozObject, index: undefined } })),
});

describe("schrijfFrozenGemeentelijkeLastenResultaat / leesFrozenGemeentelijkeLastenResultaat — roundtrip", () => {
  it("1. roundtrip 0 objecten + alle module-aannames null (REVIEWED_ZERO_OBJECTS, scenario M)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([], [], {
      begrotingsjaar: 2027,
      werkelijkeGemeentelijkeLasten: null,
      wozStijgingPercentage: null,
      lastenPercentageStijging: null,
      begrotingsPercentageOverride: null,
      beoordeeld: true,
    });
    expect(resultaat.reviewStatus).toBe("REVIEWED_ZERO_OBJECTS");
    expect(resultaat.controleVereist.some((c) => c.ernst === "KRITIEK")).toBe(false);
    schrijf(versie.id, resultaat, null);

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(gelezen.reviewStatus).toBe("REVIEWED_ZERO_OBJECTS");
    expect(gelezen.beoordeeld).toBe(true);
    expect(gelezen.werkelijkeGemeentelijkeLasten).toBeNull();
    expect(gelezen.wozStijgingPercentage).toBeNull();
    expect(gelezen.lastenPercentageStijging).toBeNull();
    expect(gelezen.begrotingsPercentageOverride).toBeNull();
    expect(gelezen.begroteGemeentelijkeLasten.toString()).toBe("0");
    expect(gelezen.wozObjecten).toEqual([]);
    expect(gelezen.perComplex).toEqual([]);
  });

  it("2. roundtrip meerdere objecten, Decimal-precisie exact (meer dan 2 decimalen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [
        wozObject({ werkelijkeWoz: new Decimal("123456.789") }),
        wozObject({ complexnummer: "002", werkelijkeWoz: new Decimal("500.5") }),
      ],
      [25, 10],
    );
    schrijf(versie.id, resultaat);

    const ruweRij = db
      .prepare(`SELECT werkelijke_woz, typeof(werkelijke_woz) AS woz_type FROM begroting_frozen_woz_object WHERE begroting_versie_id = ? AND woz_object_id = 25`)
      .get(versie.id) as { werkelijke_woz: string; woz_type: string };
    expect(ruweRij.woz_type).toBe("text");
    expect(ruweRij.werkelijke_woz).toBe("123456.789");

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(gelezen.begroteGemeentelijkeLasten.toString()).toBe(resultaat.begroteGemeentelijkeLasten.toString());
  });

  it("3. complexnummer/wozObjectAdres/aanslagjaar/waardepeildatum round-trip exact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [wozObject({ complexnummer: "010", wozObjectAdres: "Kerkstraat 5", aanslagjaar: 2019, waardepeildatum: new Date(Date.UTC(2019, 0, 1)) })],
      [7],
    );
    schrijf(versie.id, resultaat);

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    const invoer = gelezen.wozObjecten[0]!.wozObject.invoer;
    expect(invoer.complexnummer).toBe("010");
    expect(invoer.wozObjectAdres).toBe("Kerkstraat 5");
    expect(invoer.aanslagjaar).toBe(2019);
    expect(invoer.waardepeildatum).toEqual(new Date(Date.UTC(2019, 0, 1)));
  });

  it("4. verwachteWozOverride null vs. bewuste €0 blijven onderscheiden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [wozObject({ complexnummer: "001", verwachteWozOverride: null }), wozObject({ complexnummer: "002", verwachteWozOverride: new Decimal(0) })],
      [10, 20],
    );
    schrijf(versie.id, resultaat);

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(gelezen.wozObjecten.find((o) => o.persistentieId === 10)!.wozObject.invoer.verwachteWozOverride).toBeNull();
    expect(gelezen.wozObjecten.find((o) => o.persistentieId === 20)!.wozObject.invoer.verwachteWozOverride?.toString()).toBe("0");
    expect(gelezen.wozObjecten.find((o) => o.persistentieId === 20)!.wozObject.effectiefVerwachteWoz.toString()).toBe("0");
  });

  it("5. automatischVerwachteWoz/effectiefVerwachteWoz round-trip exact bij een actieve override", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([wozObject({ werkelijkeWoz: new Decimal(1000000), verwachteWozOverride: new Decimal(500000) })], [10]);
    expect(resultaat.wozObjecten[0]!.wozObject.automatischVerwachteWoz.toString()).toBe("1100000");
    schrijf(versie.id, resultaat);

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(gelezen.wozObjecten[0]!.wozObject.automatischVerwachteWoz.toString()).toBe("1100000");
    expect(gelezen.wozObjecten[0]!.wozObject.effectiefVerwachteWoz.toString()).toBe("500000");
  });

  it("6. begrotingsPercentageOverride round-trip exact (effectiefBegrotingsPercentage gebruikt de override)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([wozObject()], [10], { ...AANNAMES, begrotingsPercentageOverride: new Decimal("0.40") });
    schrijf(versie.id, resultaat);

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(gelezen.begrotingsPercentageOverride?.toString()).toBe("0.4");
    expect(gelezen.effectiefBegrotingsPercentage.toString()).toBe("0.4");
    expect(gelezen.automatischBegrotingsPercentage.toString()).toBe(resultaat.automatischBegrotingsPercentage.toString());
  });

  it("7. perComplex exact frozen en teruggelezen, NIET herberekend, meerdere complexen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [
        wozObject({ complexnummer: "001", werkelijkeWoz: new Decimal(1000000) }),
        wozObject({ complexnummer: "001", werkelijkeWoz: new Decimal(500000) }),
        wozObject({ complexnummer: "002", werkelijkeWoz: new Decimal(2000000) }),
      ],
      [1, 2, 3],
    );
    expect(resultaat.perComplex).toHaveLength(2);
    schrijf(versie.id, resultaat);

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(gelezen.perComplex).toHaveLength(2);
    const complex001 = gelezen.perComplex.find((c) => c.complexnummer === "001")!;
    expect(complex001.effectiefVerwachteWoz.toString()).toBe("1650000");
    const somPerComplex = gelezen.perComplex.reduce((t, c) => t.plus(c.begroteGemeentelijkeLasten), new Decimal(0));
    expect(somPerComplex.toString()).toBe(gelezen.begroteGemeentelijkeLasten.toString());
  });

  it("8. controls exact behouden, objectIndex correct vertaald naar/van persistentieId", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Negatieve WOZ op het TWEEDE object -> WAARSCHUWING met objectIndex = 1 -> persistentieId 20.
    const resultaat = berekenMetIds([wozObject({ complexnummer: "001" }), wozObject({ complexnummer: "002", werkelijkeWoz: new Decimal(-500000) })], [10, 20]);
    const relevanteControl = resultaat.controleVereist.find((c) => c.ernst === "WAARSCHUWING")!;
    expect(relevanteControl.objectIndex).toBe(1);

    schrijf(versie.id, resultaat);

    const ruweControlRij = db
      .prepare(`SELECT woz_object_id FROM begroting_frozen_gemeentelijke_lasten_control WHERE begroting_versie_id = ? AND ernst = 'WAARSCHUWING'`)
      .get(versie.id) as { woz_object_id: number };
    expect(ruweControlRij.woz_object_id).toBe(20);

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    const teruggelezenControl = gelezen.controleVereist.find((c) => c.ernst === "WAARSCHUWING")!;
    expect(teruggelezenControl.objectIndex).toBe(1);
    expect(teruggelezenControl.bericht).toBe(relevanteControl.bericht);
  });

  it("9. control zonder objectIndex (module-breed) round-tript met woz_object_id = NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([wozObject()], [10]);
    const resultaat: HerberekendGemeentelijkeLastenResultaat = {
      ...basis,
      controleVereist: [...basis.controleVereist, { objectIndex: null, ernst: "INFORMATIEF", bericht: "module-brede test-control" }],
    };
    schrijf(versie.id, resultaat);

    const ruweRij = db
      .prepare(`SELECT woz_object_id FROM begroting_frozen_gemeentelijke_lasten_control WHERE begroting_versie_id = ? AND bericht = ?`)
      .get(versie.id, "module-brede test-control") as { woz_object_id: number | null };
    expect(ruweRij.woz_object_id).toBeNull();

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    const teruggelezen = gelezen.controleVereist.find((c) => c.bericht === "module-brede test-control")!;
    expect(teruggelezen.objectIndex).toBeNull();
  });

  it("10. structurele gelijkheid: read-back is volledig gelijk aan het oorspronkelijke resultaat + werkelijkeGemeentelijkeLasten", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [wozObject({ complexnummer: "001" }), wozObject({ complexnummer: "002", werkelijkeWoz: new Decimal(750000) })],
      [10, 20],
    );
    schrijf(versie.id, resultaat, new Decimal(9000));
    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;

    const verwacht: FrozenGemeentelijkeLastenResultaat = { ...resultaat, werkelijkeGemeentelijkeLasten: new Decimal(9000) };
    expect(normaliseer(zonderIndex(gelezen))).toEqual(normaliseer(zonderIndex(verwacht)));
  });

  it("11. persistentie-ID per WOZ-object behouden (niet-sequentiële ids)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([wozObject({ complexnummer: "001" }), wozObject({ complexnummer: "002" })], [77, 3]);
    schrijf(versie.id, resultaat);

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(gelezen.wozObjecten.map((o) => o.persistentieId).sort((a, b) => a - b)).toEqual([3, 77]);
  });
});

describe("atomiciteit / vervangen / rollback", () => {
  it("12. schrijven en vervangen tijdens CONCEPT is toegestaan (complete replacement, geen resten)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijf(versie.id, berekenMetIds([wozObject({ complexnummer: "001" })], [10]));
    schrijf(versie.id, berekenMetIds([wozObject({ complexnummer: "004" })], [99]));

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(gelezen.wozObjecten).toHaveLength(1);
    expect(gelezen.wozObjecten[0]?.persistentieId).toBe(99);
    expect(gelezen.wozObjecten[0]?.wozObject.invoer.complexnummer).toBe("004");

    expect(db.prepare(`SELECT 1 FROM begroting_frozen_woz_object WHERE woz_object_id = 10`).get()).toBeUndefined();
  });

  it("13. een mislukte frozen write (CHECK-schending op review_status) laat het vorige geldige resultaat exact intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geldigResultaat = berekenMetIds([wozObject()], [10]);
    schrijf(versie.id, geldigResultaat);

    const kapotResultaat: HerberekendGemeentelijkeLastenResultaat = { ...geldigResultaat, reviewStatus: "NOT_REVIEWED" as never };

    expect(() => schrijf(versie.id, kapotResultaat)).toThrow(/CHECK constraint failed/);

    const naMislukking = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    const verwacht: FrozenGemeentelijkeLastenResultaat = { ...geldigResultaat, werkelijkeGemeentelijkeLasten: AANNAMES.werkelijkeGemeentelijkeLasten };
    expect(normaliseer(zonderIndex(naMislukking))).toEqual(normaliseer(zonderIndex(verwacht)));
  });

  it("14. defensieve bounds-check: een control met een objectIndex buiten bereik faalt fail-fast, geen stille NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([wozObject()], [10]);
    const kapotResultaat: HerberekendGemeentelijkeLastenResultaat = {
      ...basis,
      controleVereist: [{ objectIndex: 99, ernst: "INFORMATIEF", bericht: "verwijst naar niet-bestaand object" }],
    };

    expect(() => schrijf(versie.id, kapotResultaat)).toThrow(/correlatie geschonden/);
    expect(leesFrozenGemeentelijkeLastenResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen read — defensieve integriteit bij een dangling woz_object_id", () => {
  it("15. een control die verwijst naar een niet-bestaand woz_object_id faalt fail-fast bij lezen (geen stille null, geen genegeerd object)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijf(versie.id, berekenMetIds([wozObject()], [10]));
    db.prepare(
      `INSERT INTO begroting_frozen_gemeentelijke_lasten_control (begroting_versie_id, volgnr, woz_object_id, ernst, bericht)
       VALUES (?, 99, 999, 'INFORMATIEF', 'verwijst naar een woz_object_id dat niet bestaat')`,
    ).run(versie.id);

    expect(() => leesFrozenGemeentelijkeLastenResultaat(db, versie.id)).toThrow(/inconsistente frozen data/);
  });
});

describe("frozen read gebruikt geen pure calculator en geen conceptdata", () => {
  it("16. een kunstmatig gemanipuleerd bevroren bedrag komt ONGEWIJZIGD terug — geen herberekening bij lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([wozObject()], [10]);
    schrijf(versie.id, resultaat);

    // Versie is hier bewust nog CONCEPT — de immutability-triggers blokkeren pas na VASTGESTELD, dus deze
    // directe SQL-mutatie dient uitsluitend om een kunstmatig inconsistent bevroren bedrag te simuleren.
    db.prepare(`UPDATE begroting_frozen_gemeentelijke_lasten_resultaat SET begrote_gemeentelijke_lasten = '999999' WHERE begroting_versie_id = ?`).run(
      versie.id,
    );

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(gelezen.begroteGemeentelijkeLasten.toString()).toBe("999999"); // het gemanipuleerde bevroren bedrag, NIET herberekend
  });
});

describe("immutability", () => {
  it("17. directe SQL INSERT/UPDATE/DELETE op VASTGESTELD worden geweigerd (alle vier tabellen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Negatieve werkelijkeWoz geeft bewust een WAARSCHUWING-control, zodat de control-tabel niet leeg is —
    // anders zou de DELETE-trigger hieronder nooit een matchende rij vinden om te blokkeren (0 rijen =
    // geen trigger-fire, geen throw, een vals-negatieve test).
    schrijf(versie.id, berekenMetIds([wozObject({ werkelijkeWoz: new Decimal(-500000) })], [10]));
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_gemeentelijke_lasten_resultaat
             (begroting_versie_id, beoordeeld, review_status, totale_werkelijke_woz, historisch_lasten_percentage,
              automatisch_begrotings_percentage, effectief_begrotings_percentage, totale_automatisch_verwachte_woz,
              totale_effectief_verwachte_woz, begrote_gemeentelijke_lasten)
           VALUES (?, 1, 'REVIEWED_ZERO_OBJECTS', '0', '0', '0', '0', '0', '0', '0')`,
        )
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`UPDATE begroting_frozen_gemeentelijke_lasten_resultaat SET begrote_gemeentelijke_lasten = '999' WHERE begroting_versie_id = ?`).run(
        versie.id,
      ),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_gemeentelijke_lasten_resultaat WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );

    expect(() => db.prepare(`UPDATE begroting_frozen_woz_object SET complexnummer = 'x' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
    expect(() => db.prepare(`DELETE FROM begroting_frozen_woz_object WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);

    expect(() => db.prepare(`UPDATE begroting_frozen_gemeentelijke_lasten_complex SET complexnummer = 'x' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
    expect(() => db.prepare(`DELETE FROM begroting_frozen_gemeentelijke_lasten_complex WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_gemeentelijke_lasten_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 99, 'INFORMATIEF', 'x')`)
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_gemeentelijke_lasten_control WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
  });

  it("18. schrijven via de API op een VASTGESTELDE versie wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([wozObject()], [10]);
    schrijf(versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijf(versie.id, resultaat)).toThrow(/VASTGESTELD/);
  });

  it("lezen blijft na VASTGESTELD gewoon toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([wozObject()], [10]);
    schrijf(versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(gelezen.begroteGemeentelijkeLasten.toString()).toBe(resultaat.begroteGemeentelijkeLasten.toString());
  });
});

describe("cascade/FK-gedrag", () => {
  it("19. verwijderen van een CONCEPT-versie cascadeert alle vier frozen-tabellen volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijf(versie.id, berekenMetIds([wozObject()], [10]));

    verwijderConceptVersie(db, versie.id);

    for (const tabel of [
      "begroting_frozen_gemeentelijke_lasten_resultaat",
      "begroting_frozen_woz_object",
      "begroting_frozen_gemeentelijke_lasten_complex",
      "begroting_frozen_gemeentelijke_lasten_control",
    ]) {
      expect(db.prepare(`SELECT 1 FROM ${tabel} WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
    }
  });

  it("geen frozen Gemeentelijke-Lasten-output geschreven -> leesFrozenGemeentelijkeLastenResultaat geeft null, geen default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesFrozenGemeentelijkeLastenResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen CHECKs — tweede beschermingslaag (migratie 15)", () => {
  const MINIMALE_HEADER_KOLOMMEN = `begroting_versie_id, beoordeeld, review_status, totale_werkelijke_woz, historisch_lasten_percentage,
     automatisch_begrotings_percentage, effectief_begrotings_percentage, totale_automatisch_verwachte_woz,
     totale_effectief_verwachte_woz, begrote_gemeentelijke_lasten`;

  it("beoordeeld = 0 wordt geweigerd (frozen output mag alleen ontstaan na een geslaagde vaststel-validatie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_gemeentelijke_lasten_resultaat (${MINIMALE_HEADER_KOLOMMEN})
           VALUES (?, 0, 'REVIEWED_ZERO_OBJECTS', '0', '0', '0', '0', '0', '0', '0')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("review_status = NOT_REVIEWED wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_gemeentelijke_lasten_resultaat (${MINIMALE_HEADER_KOLOMMEN})
           VALUES (?, 1, 'NOT_REVIEWED', '0', '0', '0', '0', '0', '0', '0')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("een frozen control met een niet-bestaande ernst-waarde wordt geweigerd (structurele domein-CHECK)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    db.prepare(
      `INSERT INTO begroting_frozen_gemeentelijke_lasten_resultaat (${MINIMALE_HEADER_KOLOMMEN})
       VALUES (?, 1, 'REVIEWED_ZERO_OBJECTS', '0', '0', '0', '0', '0', '0', '0')`,
    ).run(versie.id);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_gemeentelijke_lasten_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 0, 'ONGELDIG', 'x')`)
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("ernst = KRITIEK is STRUCTUREEL toegestaan in het schema — de tabel dupliceert de lifecycle-regel niet (die regel staat uitsluitend in vaststellen.ts)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    db.prepare(
      `INSERT INTO begroting_frozen_gemeentelijke_lasten_resultaat (${MINIMALE_HEADER_KOLOMMEN})
       VALUES (?, 1, 'REVIEWED_ZERO_OBJECTS', '0', '0', '0', '0', '0', '0', '0')`,
    ).run(versie.id);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_gemeentelijke_lasten_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 0, 'KRITIEK', 'x')`)
        .run(versie.id),
    ).not.toThrow();
  });

  it("geldige frozen resultaten roundtrippen nog steeds exact, mét alle CHECKs actief", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([wozObject({ complexnummer: "001" }), wozObject({ complexnummer: "004" })], [10, 20]);
    expect(() => schrijf(versie.id, resultaat)).not.toThrow();
    const gelezen = leesFrozenGemeentelijkeLastenResultaat(db, versie.id)!;
    expect(gelezen.begroteGemeentelijkeLasten.toString()).toBe(resultaat.begroteGemeentelijkeLasten.toString());
  });
});
