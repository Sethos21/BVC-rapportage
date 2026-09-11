import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenBegroteGeplandeVerkoop, type BgGeplandeVerkoopAannames, type BgGeplandeVerkoopRegelInvoer } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenGeplandeVerkoopResultaat, schrijfFrozenGeplandeVerkoopResultaat } from "./frozenGeplandeVerkoopResultaat.js";
import type { HerberekendGeplandeVerkoopResultaat } from "./herberekenen.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-frozen-geplande-verkoop-"));
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

function normaliseer<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, val) => (val instanceof Decimal ? { __decimal__: val.toString() } : val instanceof Date ? { __date__: val.toISOString() } : val)));
}

function regelInvoer(overrides: Partial<BgGeplandeVerkoopRegelInvoer> = {}): BgGeplandeVerkoopRegelInvoer {
  return {
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

const AANNAMES: BgGeplandeVerkoopAannames = { begrotingsjaar: 2027, beoordeeld: true };

/** Berekent via de pure calculator en koppelt persistentie-ids uitsluitend positioneel — bewust NIET-sequentiële ids. */
function berekenMetIds(
  regels: readonly BgGeplandeVerkoopRegelInvoer[],
  ids: readonly number[],
  aannames: BgGeplandeVerkoopAannames = AANNAMES,
): HerberekendGeplandeVerkoopResultaat {
  const resultaat = berekenBegroteGeplandeVerkoop(regels, aannames);
  return { ...resultaat, regels: resultaat.regels.map((r, i) => ({ persistentieId: ids[i]!, regel: r })) };
}

const zonderIndex = (r: HerberekendGeplandeVerkoopResultaat) => ({
  ...r,
  regels: r.regels.map((x) => ({ persistentieId: x.persistentieId, regel: { ...x.regel, index: undefined } })),
});

describe("schrijfFrozenGeplandeVerkoopResultaat / leesFrozenGeplandeVerkoopResultaat — roundtrip", () => {
  it("1. roundtrip 0 regels (REVIEWED_ZERO_RULES)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([], []);
    expect(resultaat.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenGeplandeVerkoopResultaat(db, versie.id)!;
    expect(gelezen.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    expect(gelezen.beoordeeld).toBe(true);
    expect(gelezen.regels).toEqual([]);
    expect((gelezen as unknown as { totaal?: unknown }).totaal).toBeUndefined();
  });

  it("2. roundtrip meerdere regels, Decimal-precisie exact (meer dan 2 decimalen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [regelInvoer({ verwachteVerkoopopbrengst: new Decimal("785000.1234") }), regelInvoer({ objectreferentie: "Driebergen", verwachteVerkoopopbrengst: null })],
      [25, 10],
    );
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, resultaat);

    const ruweRij = db
      .prepare(`SELECT verwachte_verkoopopbrengst, typeof(verwachte_verkoopopbrengst) AS bedrag_type FROM begroting_frozen_geplande_verkoop_regel WHERE begroting_versie_id = ? AND regel_id = 25`)
      .get(versie.id) as { verwachte_verkoopopbrengst: string; bedrag_type: string };
    expect(ruweRij.bedrag_type).toBe("text");
    expect(ruweRij.verwachte_verkoopopbrengst).toBe("785000.1234");

    const gelezen = leesFrozenGeplandeVerkoopResultaat(db, versie.id)!;
    expect(gelezen.regels.find((r) => r.persistentieId === 25)!.regel.verwachtVerkoopresultaat?.toString()).toBe("170000.1234");
    expect(gelezen.regels.find((r) => r.persistentieId === 10)!.regel.verwachtVerkoopresultaat).toBeNull();
  });

  it("3. verwachtVerkoopresultaat=null (onbekend) round-trip blijft null, NOOIT stilzwijgend 0", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ verwachteBoekwaarde: null })], [7]);
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, resultaat);

    const ruweRij = db.prepare(`SELECT verwacht_verkoopresultaat FROM begroting_frozen_geplande_verkoop_regel WHERE begroting_versie_id = ?`).get(versie.id) as {
      verwacht_verkoopresultaat: string | null;
    };
    expect(ruweRij.verwacht_verkoopresultaat).toBeNull();

    const gelezen = leesFrozenGeplandeVerkoopResultaat(db, versie.id)!;
    expect(gelezen.regels[0]!.regel.verwachtVerkoopresultaat).toBeNull();
  });

  it("4. geplandeVerkoopdatum/verwachteEinddatumHuurExploitatie round-tripen als Date, null blijft null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ verwachteEinddatumHuurExploitatie: new Date("2027-05-01T00:00:00.000Z") })], [10]);
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenGeplandeVerkoopResultaat(db, versie.id)!;
    expect(gelezen.regels[0]!.regel.invoer.geplandeVerkoopdatum).toEqual(new Date("2027-06-01T00:00:00.000Z"));
    expect(gelezen.regels[0]!.regel.invoer.verwachteEinddatumHuurExploitatie).toEqual(new Date("2027-05-01T00:00:00.000Z"));
  });

  it("5. toelichting gevuld en null round-tripen correct", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ toelichting: "Nog in onderhandeling" }), regelInvoer({ objectreferentie: "Driebergen", toelichting: null })], [10, 20]);
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenGeplandeVerkoopResultaat(db, versie.id)!;
    expect(gelezen.regels.find((r) => r.persistentieId === 10)!.regel.invoer.toelichting).toBe("Nog in onderhandeling");
    expect(gelezen.regels.find((r) => r.persistentieId === 20)!.regel.invoer.toelichting).toBeNull();
  });

  it("6. controls exact behouden, regelIndex correct vertaald naar/van persistentieId", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Lege omschrijving op de TWEEDE regel -> KRITIEK met regelIndex = 1 -> persistentieId 20.
    const resultaat = berekenMetIds([regelInvoer(), regelInvoer({ omschrijving: "" })], [10, 20]);
    const relevanteControl = resultaat.controleVereist.find((c) => c.ernst === "KRITIEK")!;
    expect(relevanteControl.regelIndex).toBe(1);

    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, resultaat);

    const ruweControlRij = db.prepare(`SELECT regel_id FROM begroting_frozen_geplande_verkoop_control WHERE begroting_versie_id = ? AND ernst = 'KRITIEK'`).get(versie.id) as { regel_id: number };
    expect(ruweControlRij.regel_id).toBe(20);

    const gelezen = leesFrozenGeplandeVerkoopResultaat(db, versie.id)!;
    const teruggelezenControl = gelezen.controleVereist.find((c) => c.ernst === "KRITIEK")!;
    expect(teruggelezenControl.regelIndex).toBe(1);
  });

  it("7. structurele gelijkheid: read-back is volledig gelijk aan het oorspronkelijke resultaat", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ objectreferentie: "Hoofdstraat 103" }), regelInvoer({ objectreferentie: "Driebergen", verwachteVerkoopopbrengst: null })], [10, 20]);
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, resultaat);
    const gelezen = leesFrozenGeplandeVerkoopResultaat(db, versie.id)!;

    expect(normaliseer(zonderIndex(gelezen))).toEqual(normaliseer(zonderIndex(resultaat)));
  });
});

describe("atomiciteit / vervangen / rollback", () => {
  it("8. schrijven en vervangen tijdens CONCEPT is toegestaan (complete replacement, geen resten)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, berekenMetIds([regelInvoer({ objectreferentie: "A" })], [10]));
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, berekenMetIds([regelInvoer({ objectreferentie: "B" })], [99]));

    const gelezen = leesFrozenGeplandeVerkoopResultaat(db, versie.id)!;
    expect(gelezen.regels).toHaveLength(1);
    expect(gelezen.regels[0]?.persistentieId).toBe(99);
    expect(db.prepare(`SELECT 1 FROM begroting_frozen_geplande_verkoop_regel WHERE regel_id = 10`).get()).toBeUndefined();
  });

  it("9. een mislukte frozen write (CHECK-schending op review_status) laat het vorige geldige resultaat exact intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geldigResultaat = berekenMetIds([regelInvoer()], [10]);
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, geldigResultaat);

    const kapotResultaat: HerberekendGeplandeVerkoopResultaat = { ...geldigResultaat, reviewStatus: "NOT_REVIEWED" as never };
    expect(() => schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, kapotResultaat)).toThrow(/CHECK constraint failed/);

    const naMislukking = leesFrozenGeplandeVerkoopResultaat(db, versie.id)!;
    expect(normaliseer(zonderIndex(naMislukking))).toEqual(normaliseer(zonderIndex(geldigResultaat)));
  });

  it("10. defensieve bounds-check: een control met een regelIndex buiten bereik faalt fail-fast, geen stille NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([regelInvoer()], [10]);
    const kapotResultaat: HerberekendGeplandeVerkoopResultaat = { ...basis, controleVereist: [{ regelIndex: 99, ernst: "INFORMATIEF", bericht: "verwijst naar niet-bestaande regel" }] };

    expect(() => schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, kapotResultaat)).toThrow(/correlatie geschonden/);
    expect(leesFrozenGeplandeVerkoopResultaat(db, versie.id)).toBeNull();
  });
});

describe("immutability", () => {
  it("11. directe SQL INSERT/UPDATE/DELETE op VASTGESTELD worden geweigerd (alle drie tabellen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, berekenMetIds([regelInvoer({ omschrijving: "" })], [10]));
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db.prepare(`INSERT INTO begroting_frozen_geplande_verkoop_resultaat (begroting_versie_id, beoordeeld, review_status) VALUES ('een-andere-versie-id', 1, 'REVIEWED_ZERO_RULES')`).run(),
    ).toThrow(/immutable|FOREIGN KEY/);
    expect(() => db.prepare(`UPDATE begroting_frozen_geplande_verkoop_resultaat SET review_status = 'REVIEWED_ZERO_RULES' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_geplande_verkoop_resultaat WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);

    expect(() => db.prepare(`UPDATE begroting_frozen_geplande_verkoop_regel SET omschrijving = 'x' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_geplande_verkoop_regel WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);

    expect(() =>
      db.prepare(`INSERT INTO begroting_frozen_geplande_verkoop_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 99, 'INFORMATIEF', 'x')`).run(versie.id),
    ).toThrow(/immutable/);
  });

  it("12. schrijven via de API op een VASTGESTELDE versie wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer()], [10]);
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, resultaat)).toThrow(/VASTGESTELD/);
  });

  it("lezen blijft na VASTGESTELD gewoon toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer()], [10]);
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    const gelezen = leesFrozenGeplandeVerkoopResultaat(db, versie.id)!;
    expect(gelezen.regels[0]!.regel.verwachtVerkoopresultaat?.toString()).toBe(resultaat.regels[0]!.regel.verwachtVerkoopresultaat?.toString());
  });
});

describe("cascade/FK-gedrag", () => {
  it("13. verwijderen van een CONCEPT-versie cascadeert alle drie frozen-tabellen volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, berekenMetIds([regelInvoer()], [10]));

    verwijderConceptVersie(db, versie.id);

    for (const tabel of ["begroting_frozen_geplande_verkoop_resultaat", "begroting_frozen_geplande_verkoop_regel", "begroting_frozen_geplande_verkoop_control"]) {
      expect(db.prepare(`SELECT 1 FROM ${tabel} WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
    }
  });

  it("geen frozen Geplande-Verkoop-output geschreven -> leesFrozenGeplandeVerkoopResultaat geeft null, geen default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesFrozenGeplandeVerkoopResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen CHECKs — tweede beschermingslaag (migratie 23)", () => {
  it("beoordeeld = 0 wordt geweigerd (frozen output mag alleen ontstaan na een geslaagde vaststel-validatie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() => db.prepare(`INSERT INTO begroting_frozen_geplande_verkoop_resultaat (begroting_versie_id, beoordeeld, review_status) VALUES (?, 0, 'REVIEWED_ZERO_RULES')`).run(versie.id)).toThrow(
      /CHECK constraint failed/,
    );
  });

  it("review_status = NOT_REVIEWED wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() => db.prepare(`INSERT INTO begroting_frozen_geplande_verkoop_resultaat (begroting_versie_id, beoordeeld, review_status) VALUES (?, 1, 'NOT_REVIEWED')`).run(versie.id)).toThrow(
      /CHECK constraint failed/,
    );
  });

  it("geldige frozen resultaten roundtrippen nog steeds exact, mét alle CHECKs actief", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ objectreferentie: "A" }), regelInvoer({ objectreferentie: "B" })], [10, 20]);
    expect(() => schrijfFrozenGeplandeVerkoopResultaat(db, versie.id, resultaat)).not.toThrow();
    const gelezen = leesFrozenGeplandeVerkoopResultaat(db, versie.id)!;
    expect(gelezen.regels).toHaveLength(2);
  });
});
