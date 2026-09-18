import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEEGSTAND_CATEGORIEEN, berekenBegroteLeegstand, type BgLeegstandCategorie, type BgLeegstandCategorieAannames, type BgLeegstandRegelInvoer } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenLeegstandResultaat, schrijfFrozenLeegstandResultaat, type FrozenLeegstandResultaat } from "./frozenLeegstandResultaat.js";
import type { HerberekendLeegstandResultaat } from "./herberekenen.js";
import { schrijfLeegstandClassificatie } from "./leegstandClassificatie.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-frozen-leegstand-"));
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

function regelInvoer(overrides: Partial<BgLeegstandRegelInvoer> = {}): BgLeegstandRegelInvoer {
  return {
    categorie: "OVERIGE_LEEGSTANDSKOSTEN",
    complexnummer: null,
    complexomschrijving: null,
    omschrijving: "Beveiliging leegstand",
    q1: new Decimal(1000),
    q2: new Decimal(1000),
    q3: new Decimal(1000),
    q4: new Decimal(1000),
    ...overrides,
  };
}

function alleAannames(
  overrides: Partial<Record<BgLeegstandCategorie, Partial<BgLeegstandCategorieAannames>>> = {},
): Record<BgLeegstandCategorie, BgLeegstandCategorieAannames> {
  return Object.fromEntries(
    LEEGSTAND_CATEGORIEEN.map((categorie) => [
      categorie,
      { beoordeeld: true, laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null, ...overrides[categorie] },
    ]),
  ) as Record<BgLeegstandCategorie, BgLeegstandCategorieAannames>;
}

/** Berekent via de pure calculator en koppelt persistentie-ids uitsluitend positioneel PER CATEGORIE — bewust NIET-sequentiële ids. */
function berekenMetIds(
  regels: readonly { invoer: BgLeegstandRegelInvoer; id: number }[],
  aannames: Record<BgLeegstandCategorie, BgLeegstandCategorieAannames> = alleAannames(),
): HerberekendLeegstandResultaat {
  const resultaat = berekenBegroteLeegstand(
    regels.map((r) => r.invoer),
    aannames,
    { begrotingsjaar: 2027 },
  );
  const perCategorie = resultaat.perCategorie.map((categorieResultaat) => {
    const idsVoorCategorie = regels.filter((r) => r.invoer.categorie === categorieResultaat.categorie).map((r) => r.id);
    return {
      ...categorieResultaat,
      regels: categorieResultaat.regels.map((regelUitkomst, i) => ({ persistentieId: idsVoorCategorie[i]!, regel: regelUitkomst })),
    };
  });
  return { ...resultaat, perCategorie };
}

const zonderIndex = (r: FrozenLeegstandResultaat) => ({
  ...r,
  perCategorie: r.perCategorie.map((c) => ({
    ...c,
    regels: c.regels.map((x) => ({ persistentieId: x.persistentieId, regel: { ...x.regel, index: undefined } })),
  })),
});

describe("schrijfFrozenLeegstandResultaat / leesFrozenLeegstandResultaat — roundtrip", () => {
  it("1. roundtrip 0 regels in alle categorieën (REVIEWED_ZERO_RULES)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([]);
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    for (const c of gelezen.perCategorie) {
      expect(c.reviewStatus).toBe("REVIEWED_ZERO_RULES");
      expect(c.categorieTotaal.toString()).toBe("0");
      expect(c.regels).toEqual([]);
    }
    expect(gelezen.moduleTotaal.toString()).toBe("0");
  });

  it("2. Decimal-precisie exact (meer dan 2 decimalen) op q1", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer({ q1: new Decimal("1234.5678"), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) }), id: 25 }]);
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);

    const ruweRij = db
      .prepare(`SELECT q1, typeof(q1) AS bedrag_type FROM begroting_frozen_leegstand_regel WHERE begroting_versie_id = ? AND regel_id = 25`)
      .get(versie.id) as { q1: string; bedrag_type: string };
    expect(ruweRij.bedrag_type).toBe("text");
    expect(ruweRij.q1).toBe("1234.5678");

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    expect(gelezen.overigeLeegstandskosten.toString()).toBe("1234.5678");
  });

  it("3. meerdere categorieën, meerdere regels: persistentie-ID per categorie correct behouden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "NUTS_LEEGSTAND", omschrijving: "Gas" }), id: 7 },
      { invoer: regelInvoer({ categorie: "NUTS_LEEGSTAND", omschrijving: "Elektra" }), id: 99 },
      { invoer: regelInvoer({ categorie: "SERVICEKOSTEN_LEEGSTAND", omschrijving: "Voorschot" }), id: 3 },
    ]);
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    const nuts = gelezen.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!;
    const servicekosten = gelezen.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(nuts.regels.map((r) => r.persistentieId)).toEqual([7, 99]);
    expect(servicekosten.regels.map((r) => r.persistentieId)).toEqual([3]);
  });

  it("4. complexnummer/complexomschrijving null blijft null na frozen roundtrip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer({ complexnummer: null, complexomschrijving: null }), id: 10 }]);
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    const categorie = gelezen.perCategorie.find((c) => c.categorie === "OVERIGE_LEEGSTANDSKOSTEN")!;
    expect(categorie.regels[0]?.regel.invoer.complexnummer).toBeNull();
    expect(categorie.regels[0]?.regel.invoer.complexomschrijving).toBeNull();
  });

  it("5. complexnummer/complexomschrijving blijven frozen wanneer aanwezig, puur presentatie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer({ categorie: "SERVICEKOSTEN_LEEGSTAND", complexnummer: "003", complexomschrijving: "Rooise Zoom III" }), id: 10 }]);
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    const servicekosten = gelezen.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(servicekosten.regels[0]?.regel.invoer.complexnummer).toBe("003");
    expect(servicekosten.regels[0]?.regel.invoer.complexomschrijving).toBe("Rooise Zoom III");
  });

  it("6. Servicekosten-leegstand-rekenhulp exact bevroren", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([], alleAannames({ SERVICEKOSTEN_LEEGSTAND: { laatstBekendServicekostenvoorschotJaar: new Decimal(12000), verwachteLeegstandsperiodeMaanden: new Decimal(6) } }));
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    const servicekosten = gelezen.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!;
    expect(servicekosten.laatstBekendServicekostenvoorschotJaar?.toString()).toBe("12000");
    expect(servicekosten.verwachteLeegstandsperiodeMaanden?.toString()).toBe("6");
    expect(servicekosten.berekendVoorstel?.toString()).toBe("6000");
  });

  it("7. controls exact behouden, regelIndex correct vertaald naar/van persistentieId BINNEN categorie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "NUTS_LEEGSTAND", q1: new Decimal(100), q2: new Decimal(100), q3: new Decimal(100), q4: new Decimal(100) }), id: 1 },
      { invoer: regelInvoer({ categorie: "NUTS_LEEGSTAND", q1: new Decimal(-500), q2: new Decimal(100), q3: new Decimal(100), q4: new Decimal(100) }), id: 20 },
    ]);
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);

    const ruweControlRij = db
      .prepare(`SELECT regel_id FROM begroting_frozen_leegstand_control WHERE begroting_versie_id = ? AND ernst = 'WAARSCHUWING'`)
      .get(versie.id) as { regel_id: number };
    expect(ruweControlRij.regel_id).toBe(20);

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    const teruggelezenControl = gelezen.controleVereist.find((c) => c.ernst === "WAARSCHUWING")!;
    expect(teruggelezenControl.categorie).toBe("NUTS_LEEGSTAND");
    expect(teruggelezenControl.regelIndex).toBe(1);
  });

  it("8. control zonder regelIndex (categoriebreed, rekenhulp) round-tript met regel_id = NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([], alleAannames({ SERVICEKOSTEN_LEEGSTAND: { verwachteLeegstandsperiodeMaanden: new Decimal(-5) } }));
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    const control = gelezen.controleVereist.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND" && c.ernst === "WAARSCHUWING")!;
    expect(control.regelIndex).toBeNull();
  });

  it("9. moduleTotaal en de drie categorietotalen exact bevroren", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "NUTS_LEEGSTAND", q1: new Decimal(400), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) }), id: 1 },
      { invoer: regelInvoer({ categorie: "SERVICEKOSTEN_LEEGSTAND", q1: new Decimal(1000), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) }), id: 2 },
    ]);
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    expect(gelezen.nutsLeegstand.toString()).toBe("400");
    expect(gelezen.servicekostenLeegstand.toString()).toBe("1000");
    expect(gelezen.moduleTotaal.toString()).toBe("1400");
  });

  it("10. structurele gelijkheid: read-back is volledig gelijk aan het oorspronkelijke resultaat", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "NUTS_LEEGSTAND" }), id: 10 },
      { invoer: regelInvoer({ categorie: "SERVICEKOSTEN_LEEGSTAND", complexnummer: "003" }), id: 20 },
    ]);
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);
    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;

    expect(normaliseer(zonderIndex(gelezen))).toEqual(normaliseer(zonderIndex(resultaat)));
  });
});

describe("atomiciteit / vervangen / rollback", () => {
  it("11. schrijven en vervangen tijdens CONCEPT is toegestaan (complete replacement, geen resten)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenLeegstandResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ categorie: "NUTS_LEEGSTAND" }), id: 10 }]));
    schrijfFrozenLeegstandResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ categorie: "SERVICEKOSTEN_LEEGSTAND" }), id: 99 }]));

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    expect(gelezen.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!.regels).toEqual([]);
    expect(gelezen.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.regels[0]?.persistentieId).toBe(99);
    expect(db.prepare(`SELECT 1 FROM begroting_frozen_leegstand_regel WHERE regel_id = 10`).get()).toBeUndefined();
  });

  it("12. een mislukte frozen write (CHECK-schending op review_status) laat het vorige geldige resultaat exact intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geldigResultaat = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    schrijfFrozenLeegstandResultaat(db, versie.id, geldigResultaat);

    const kapotResultaat: HerberekendLeegstandResultaat = {
      ...geldigResultaat,
      perCategorie: geldigResultaat.perCategorie.map((c) => (c.categorie === "SERVICEKOSTEN_LEEGSTAND" ? { ...c, reviewStatus: "NOT_REVIEWED" as never } : c)),
    };

    expect(() => schrijfFrozenLeegstandResultaat(db, versie.id, kapotResultaat)).toThrow(/CHECK constraint failed/);

    const naMislukking = leesFrozenLeegstandResultaat(db, versie.id)!;
    expect(normaliseer(zonderIndex(naMislukking))).toEqual(normaliseer(zonderIndex(geldigResultaat)));
  });

  it("13. defensieve bounds-check: een control met een regelIndex buiten bereik faalt fail-fast, geen stille NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    const kapotResultaat: HerberekendLeegstandResultaat = {
      ...basis,
      controleVereist: [{ categorie: "OVERIGE_LEEGSTANDSKOSTEN", regelIndex: 99, ernst: "INFORMATIEF", bericht: "verwijst naar niet-bestaande regel" }],
    };

    expect(() => schrijfFrozenLeegstandResultaat(db, versie.id, kapotResultaat)).toThrow(/correlatie geschonden/);
    expect(leesFrozenLeegstandResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen read gebruikt geen pure calculator en geen conceptdata", () => {
  it("14. een kunstmatig gemanipuleerd bevroren moduleTotaal komt ONGEWIJZIGD terug — geen herberekening bij lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenLeegstandResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ q1: new Decimal(1000) }), id: 10 }]));

    // Versie is hier bewust nog CONCEPT — de immutability-triggers blokkeren pas na VASTGESTELD.
    db.prepare(`UPDATE begroting_frozen_leegstand_categorie SET module_totaal = '999999' WHERE begroting_versie_id = ?`).run(versie.id);

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    expect(gelezen.moduleTotaal.toString()).toBe("999999"); // gemanipuleerd, NIET herberekend uit de categorietotalen
  });

  it("wijziging van de levende leegstand-classificatie raakt een reeds bevroren Begroting-snapshot niet — de tabel wordt door de frozen read zelfs nooit geraadpleegd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfLeegstandClassificatie(db, "070", [{ ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", categorie: "SERVICEKOSTEN_LEEGSTAND" }]);
    schrijfFrozenLeegstandResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ categorie: "SERVICEKOSTEN_LEEGSTAND", complexnummer: "003" }), id: 10 }]));
    const voor = leesFrozenLeegstandResultaat(db, versie.id)!;

    // Rechtstreekse SQL-simulatie van "de levende classificatie is later gewijzigd/verwijderd" — de frozen
    // Leegstand-tabellen hebben (anders dan bij Algemene Kosten) NOOIT een classificatie-kolom bevat, dus
    // deze mutatie kan de bevroren Begroting-kopie per constructie niet raken (zie moduledoc).
    db.exec(`DELETE FROM begroting_leegstand_classificatie`);
    schrijfLeegstandClassificatie(db, "070", [{ ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Andere naam", categorie: "OVERIGE_LEEGSTANDSKOSTEN" }]);

    const na = leesFrozenLeegstandResultaat(db, versie.id)!;
    expect(normaliseer(zonderIndex(na))).toEqual(normaliseer(zonderIndex(voor)));
  });
});

describe("immutability", () => {
  it("15. directe SQL INSERT/UPDATE/DELETE op VASTGESTELD worden geweigerd (alle drie tabellen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Negatief bedrag geeft bewust een WAARSCHUWING-control zodat de control-tabel niet leeg is.
    schrijfFrozenLeegstandResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ q1: new Decimal(-500), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) }), id: 10 }]));
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db.prepare(`UPDATE begroting_frozen_leegstand_categorie SET categorie_totaal = '999' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_leegstand_categorie WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);

    expect(() => db.prepare(`UPDATE begroting_frozen_leegstand_regel SET omschrijving = 'x' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_leegstand_regel WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_leegstand_control (begroting_versie_id, volgnr, categorie, ernst, bericht) VALUES (?, 99, 'NUTS_LEEGSTAND', 'INFORMATIEF', 'x')`)
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_leegstand_control WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
  });

  it("16. schrijven via de API op een VASTGESTELDE versie wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfFrozenLeegstandResultaat(db, versie.id, resultaat)).toThrow(/VASTGESTELD/);
  });

  it("lezen blijft na VASTGESTELD gewoon toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    schrijfFrozenLeegstandResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    expect(gelezen.moduleTotaal.toString()).toBe(resultaat.moduleTotaal.toString());
  });
});

describe("cascade/FK-gedrag", () => {
  it("17. verwijderen van een CONCEPT-versie cascadeert alle drie frozen-tabellen volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenLeegstandResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ q1: new Decimal(-500), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) }), id: 10 }]));

    verwijderConceptVersie(db, versie.id);

    for (const tabel of ["begroting_frozen_leegstand_categorie", "begroting_frozen_leegstand_regel", "begroting_frozen_leegstand_control"]) {
      expect(db.prepare(`SELECT 1 FROM ${tabel} WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
    }
  });

  it("geen frozen Leegstand-output geschreven -> leesFrozenLeegstandResultaat geeft null, geen default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesFrozenLeegstandResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen CHECKs — tweede beschermingslaag (migratie 19)", () => {
  it("review_status = NOT_REVIEWED wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_leegstand_categorie
             (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal, module_totaal)
           VALUES (?, 'NUTS_LEEGSTAND', 1, 'NOT_REVIEWED', '0', '0')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("beoordeeld = 0 wordt geweigerd (frozen output mag alleen ontstaan na een geslaagde vaststel-validatie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_leegstand_categorie
             (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal, module_totaal)
           VALUES (?, 'NUTS_LEEGSTAND', 0, 'REVIEWED_ZERO_RULES', '0', '0')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("een onbekende categoriewaarde wordt geweigerd (structurele domein-CHECK)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_leegstand_categorie
             (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal, module_totaal)
           VALUES (?, 'ONBEKEND', 1, 'REVIEWED_ZERO_RULES', '0', '0')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("geldige frozen resultaten roundtrippen nog steeds exact, mét alle CHECKs actief", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "NUTS_LEEGSTAND" }), id: 10 },
      { invoer: regelInvoer({ categorie: "SERVICEKOSTEN_LEEGSTAND" }), id: 20 },
    ]);
    expect(() => schrijfFrozenLeegstandResultaat(db, versie.id, resultaat)).not.toThrow();
    const gelezen = leesFrozenLeegstandResultaat(db, versie.id)!;
    expect(gelezen.moduleTotaal.toString()).toBe(resultaat.moduleTotaal.toString());
  });
});
