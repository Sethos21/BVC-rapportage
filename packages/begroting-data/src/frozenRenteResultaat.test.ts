import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RENTE_CATEGORIEEN, berekenBegroteRente, type BgRenteCategorie, type BgRenteCategorieAannames, type BgRenteRegelInvoer } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenRenteResultaat, schrijfFrozenRenteResultaat, type FrozenRenteResultaat } from "./frozenRenteResultaat.js";
import type { HerberekendRenteResultaat } from "./herberekenen.js";
import { schrijfRenteClassificatie } from "./renteClassificatie.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-frozen-rente-"));
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
  return JSON.parse(JSON.stringify(value, (_key, val) => (val instanceof Decimal ? { __decimal__: val.toString() } : val)));
}

function regelInvoer(overrides: Partial<BgRenteRegelInvoer> = {}): BgRenteRegelInvoer {
  return {
    categorie: "RENTEKOSTEN",
    omschrijving: "Lening 747",
    complexnummer: null,
    ogbReferentie: null,
    laatstBekendSaldo: null,
    rentepercentage: null,
    begrotingsbedrag: new Decimal(1000),
    ...overrides,
  };
}

function alleAannames(overrides: Partial<Record<BgRenteCategorie, Partial<BgRenteCategorieAannames>>> = {}): Record<BgRenteCategorie, BgRenteCategorieAannames> {
  return Object.fromEntries(RENTE_CATEGORIEEN.map((categorie) => [categorie, { beoordeeld: true, ...overrides[categorie] }])) as Record<BgRenteCategorie, BgRenteCategorieAannames>;
}

/** Berekent via de pure calculator en koppelt persistentie-ids uitsluitend positioneel PER CATEGORIE — bewust NIET-sequentiële ids. */
function berekenMetIds(
  regels: readonly { invoer: BgRenteRegelInvoer; id: number }[],
  aannames: Record<BgRenteCategorie, BgRenteCategorieAannames> = alleAannames(),
): HerberekendRenteResultaat {
  const resultaat = berekenBegroteRente(
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

const zonderIndex = (r: FrozenRenteResultaat) => ({
  ...r,
  perCategorie: r.perCategorie.map((c) => ({
    ...c,
    regels: c.regels.map((x) => ({ persistentieId: x.persistentieId, regel: { ...x.regel, index: undefined } })),
  })),
});

describe("schrijfFrozenRenteResultaat / leesFrozenRenteResultaat — roundtrip", () => {
  it("1. roundtrip 0 regels in beide categorieën (REVIEWED_ZERO_RULES)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    for (const c of gelezen.perCategorie) {
      expect(c.reviewStatus).toBe("REVIEWED_ZERO_RULES");
      expect(c.categorieTotaal.toString()).toBe("0");
      expect(c.regels).toEqual([]);
    }
    expect(gelezen.rentekosten.toString()).toBe("0");
    expect(gelezen.renteOpbrengsten.toString()).toBe("0");
    expect((gelezen as unknown as { moduleTotaal?: unknown }).moduleTotaal).toBeUndefined();
  });

  it("2. Decimal-precisie exact (meer dan 2 decimalen) op begrotingsbedrag en laatstBekendSaldo/rentepercentage", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ begrotingsbedrag: new Decimal("1234.5678"), laatstBekendSaldo: new Decimal("7700000.1234"), rentepercentage: new Decimal("5.75") }), id: 25 },
    ]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);

    const ruweRij = db
      .prepare(`SELECT begrotingsbedrag, typeof(begrotingsbedrag) AS bedrag_type FROM begroting_frozen_rente_regel WHERE begroting_versie_id = ? AND regel_id = 25`)
      .get(versie.id) as { begrotingsbedrag: string; bedrag_type: string };
    expect(ruweRij.bedrag_type).toBe("text");
    expect(ruweRij.begrotingsbedrag).toBe("1234.5678");

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    expect(gelezen.rentekosten.toString()).toBe("1234.5678");
    const regel = gelezen.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.regels[0]!;
    expect(regel.regel.invoer.laatstBekendSaldo?.toString()).toBe("7700000.1234");
    expect(regel.regel.berekendVoorstel?.toString()).toBe("442750.0070955");
  });

  it("3. meerdere categorieën, meerdere regels: persistentie-ID per categorie correct behouden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "RENTEKOSTEN", omschrijving: "Lening 747" }), id: 7 },
      { invoer: regelInvoer({ categorie: "RENTEKOSTEN", omschrijving: "Lening .962" }), id: 99 },
      { invoer: regelInvoer({ categorie: "RENTE_OPBRENGSTEN", omschrijving: "Spaarrekening" }), id: 3 },
    ]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    const rentekosten = gelezen.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!;
    const renteOpbrengsten = gelezen.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!;
    expect(rentekosten.regels.map((r) => r.persistentieId)).toEqual([7, 99]);
    expect(renteOpbrengsten.regels.map((r) => r.persistentieId)).toEqual([3]);
  });

  it("4. complexnummer/ogbReferentie/laatstBekendSaldo/rentepercentage null blijft null na frozen roundtrip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer({ complexnummer: null, ogbReferentie: null, laatstBekendSaldo: null, rentepercentage: null }), id: 10 }]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    const regel = gelezen.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.regels[0]!;
    expect(regel.regel.invoer.complexnummer).toBeNull();
    expect(regel.regel.invoer.ogbReferentie).toBeNull();
    expect(regel.regel.invoer.laatstBekendSaldo).toBeNull();
    expect(regel.regel.invoer.rentepercentage).toBeNull();
    expect(regel.regel.berekendVoorstel).toBeNull();
  });

  it("5. complexnummer/ogbReferentie blijven frozen wanneer aanwezig, puur informatief", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer({ complexnummer: "001", ogbReferentie: "OGB 4606 — lening 747" }), id: 10 }]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    const regel = gelezen.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.regels[0]!;
    expect(regel.regel.invoer.complexnummer).toBe("001");
    expect(regel.regel.invoer.ogbReferentie).toBe("OGB 4606 — lening 747");
  });

  it("6. rekenhulp-voorstel per regel exact bevroren, wijzigt begrotingsbedrag niet", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ laatstBekendSaldo: new Decimal(7700000), rentepercentage: new Decimal(6), begrotingsbedrag: new Decimal(357441) }), id: 10 },
    ]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    const regel = gelezen.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.regels[0]!;
    expect(regel.regel.berekendVoorstel?.toString()).toBe("462000");
    expect(gelezen.rentekosten.toString()).toBe("357441");
  });

  it("7. controls exact behouden, regelIndex correct vertaald naar/van persistentieId BINNEN categorie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ begrotingsbedrag: new Decimal(100) }), id: 1 },
      { invoer: regelInvoer({ begrotingsbedrag: new Decimal(-500) }), id: 20 },
    ]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);

    const ruweControlRij = db
      .prepare(`SELECT regel_id FROM begroting_frozen_rente_control WHERE begroting_versie_id = ? AND ernst = 'WAARSCHUWING'`)
      .get(versie.id) as { regel_id: number };
    expect(ruweControlRij.regel_id).toBe(20);

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    const teruggelezenControl = gelezen.controleVereist.find((c) => c.ernst === "WAARSCHUWING")!;
    expect(teruggelezenControl.categorie).toBe("RENTEKOSTEN");
    expect(teruggelezenControl.regelIndex).toBe(1);
  });

  it("8. control zonder regelIndex bestaat niet voor Rente — elke control is altijd aan een regel of algemene meldingslijn gekoppeld", () => {
    // Anders dan Leegstand (categoriebrede rekenhulp-control) heeft Rente geen categoriebrede
    // rekenhulp (die is per regel) — dit is puur een structurele bevestiging, geen aparte functionaliteit.
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer({ omschrijving: "  " }), id: 10 }]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    expect(gelezen.controleVereist).toHaveLength(1);
    expect(gelezen.controleVereist[0]!.regelIndex).toBe(0);
  });

  it("9. rentekosten en renteOpbrengsten exact bevroren, GEEN gecombineerd moduleTotaal", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "RENTEKOSTEN", begrotingsbedrag: new Decimal(400) }), id: 1 },
      { invoer: regelInvoer({ categorie: "RENTE_OPBRENGSTEN", begrotingsbedrag: new Decimal(1000) }), id: 2 },
    ]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    expect(gelezen.rentekosten.toString()).toBe("400");
    expect(gelezen.renteOpbrengsten.toString()).toBe("1000");
    expect((gelezen as unknown as { moduleTotaal?: unknown }).moduleTotaal).toBeUndefined();
  });

  it("10. structurele gelijkheid: read-back is volledig gelijk aan het oorspronkelijke resultaat", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "RENTEKOSTEN" }), id: 10 },
      { invoer: regelInvoer({ categorie: "RENTE_OPBRENGSTEN", complexnummer: "003" }), id: 20 },
    ]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);
    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;

    expect(normaliseer(zonderIndex(gelezen))).toEqual(normaliseer(zonderIndex(resultaat)));
  });
});

describe("atomiciteit / vervangen / rollback", () => {
  it("11. schrijven en vervangen tijdens CONCEPT is toegestaan (complete replacement, geen resten)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenRenteResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ categorie: "RENTEKOSTEN" }), id: 10 }]));
    schrijfFrozenRenteResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ categorie: "RENTE_OPBRENGSTEN" }), id: 99 }]));

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    expect(gelezen.perCategorie.find((c) => c.categorie === "RENTEKOSTEN")!.regels).toEqual([]);
    expect(gelezen.perCategorie.find((c) => c.categorie === "RENTE_OPBRENGSTEN")!.regels[0]?.persistentieId).toBe(99);
    expect(db.prepare(`SELECT 1 FROM begroting_frozen_rente_regel WHERE regel_id = 10`).get()).toBeUndefined();
  });

  it("12. een mislukte frozen write (CHECK-schending op review_status) laat het vorige geldige resultaat exact intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geldigResultaat = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    schrijfFrozenRenteResultaat(db, versie.id, geldigResultaat);

    const kapotResultaat: HerberekendRenteResultaat = {
      ...geldigResultaat,
      perCategorie: geldigResultaat.perCategorie.map((c) => (c.categorie === "RENTE_OPBRENGSTEN" ? { ...c, reviewStatus: "NOT_REVIEWED" as never } : c)),
    };

    expect(() => schrijfFrozenRenteResultaat(db, versie.id, kapotResultaat)).toThrow(/CHECK constraint failed/);

    const naMislukking = leesFrozenRenteResultaat(db, versie.id)!;
    expect(normaliseer(zonderIndex(naMislukking))).toEqual(normaliseer(zonderIndex(geldigResultaat)));
  });

  it("13. defensieve bounds-check: een control met een regelIndex buiten bereik faalt fail-fast, geen stille NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    const kapotResultaat: HerberekendRenteResultaat = {
      ...basis,
      controleVereist: [{ categorie: "RENTEKOSTEN", regelIndex: 99, ernst: "INFORMATIEF", bericht: "verwijst naar niet-bestaande regel" }],
    };

    expect(() => schrijfFrozenRenteResultaat(db, versie.id, kapotResultaat)).toThrow(/correlatie geschonden/);
    expect(leesFrozenRenteResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen read gebruikt geen pure calculator en geen conceptdata", () => {
  it("14. een kunstmatig gemanipuleerd bevroren categorie_totaal komt ONGEWIJZIGD terug — geen herberekening bij lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenRenteResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ begrotingsbedrag: new Decimal(1000) }), id: 10 }]));

    // Versie is hier bewust nog CONCEPT — de immutability-triggers blokkeren pas na VASTGESTELD.
    db.prepare(`UPDATE begroting_frozen_rente_categorie SET categorie_totaal = '999999' WHERE begroting_versie_id = ? AND categorie = 'RENTEKOSTEN'`).run(versie.id);

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    expect(gelezen.rentekosten.toString()).toBe("999999"); // gemanipuleerd, NIET herberekend uit de regels
  });

  it("wijziging van de levende rente-classificatie raakt een reeds bevroren Begroting-snapshot niet — er is zelfs geen frozen-classificatiekolom om te raadplegen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfRenteClassificatie(db, "023", [{ ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente lening .500", categorie: "RENTEKOSTEN" }]);
    schrijfFrozenRenteResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ categorie: "RENTEKOSTEN", ogbReferentie: "OGB 4604" }), id: 10 }]));
    const voor = leesFrozenRenteResultaat(db, versie.id)!;

    // Rechtstreekse SQL-simulatie van "de levende classificatie is later gewijzigd" — de frozen
    // Rente-Begroting-tabellen bevatten per constructie geen classificatie-kolom (zie moduledoc),
    // dus deze mutatie kan de bevroren kopie niet raken. Bewijst tegelijk de bewezen kernclaim: dezelfde
    // OGB-code 4604 betekent bij administratie 013 RENTE_OPBRENGSTEN, niet RENTEKOSTEN.
    db.exec(`DELETE FROM begroting_rente_classificatie`);
    schrijfRenteClassificatie(db, "013", [{ ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente r/c", categorie: "RENTE_OPBRENGSTEN" }]);

    const na = leesFrozenRenteResultaat(db, versie.id)!;
    expect(normaliseer(zonderIndex(na))).toEqual(normaliseer(zonderIndex(voor)));
  });
});

describe("immutability", () => {
  it("15. directe SQL INSERT/UPDATE/DELETE op VASTGESTELD worden geweigerd (alle drie tabellen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Negatief bedrag geeft bewust een WAARSCHUWING-control zodat de control-tabel niet leeg is.
    schrijfFrozenRenteResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ begrotingsbedrag: new Decimal(-500) }), id: 10 }]));
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => db.prepare(`UPDATE begroting_frozen_rente_categorie SET categorie_totaal = '999' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_rente_categorie WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);

    expect(() => db.prepare(`UPDATE begroting_frozen_rente_regel SET omschrijving = 'x' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_rente_regel WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_rente_control (begroting_versie_id, volgnr, categorie, ernst, bericht) VALUES (?, 99, 'RENTEKOSTEN', 'INFORMATIEF', 'x')`)
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_rente_control WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
  });

  it("16. schrijven via de API op een VASTGESTELDE versie wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfFrozenRenteResultaat(db, versie.id, resultaat)).toThrow(/VASTGESTELD/);
  });

  it("lezen blijft na VASTGESTELD gewoon toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    schrijfFrozenRenteResultaat(db, versie.id, resultaat);
    markeerVastgesteld(db, versie.id, new Date());

    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    expect(gelezen.rentekosten.toString()).toBe(resultaat.rentekosten.toString());
  });
});

describe("cascade/FK-gedrag", () => {
  it("17. verwijderen van een CONCEPT-versie cascadeert alle drie frozen-tabellen volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenRenteResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ begrotingsbedrag: new Decimal(-500) }), id: 10 }]));

    verwijderConceptVersie(db, versie.id);

    for (const tabel of ["begroting_frozen_rente_categorie", "begroting_frozen_rente_regel", "begroting_frozen_rente_control"]) {
      expect(db.prepare(`SELECT 1 FROM ${tabel} WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
    }
  });

  it("geen frozen Rente-output geschreven -> leesFrozenRenteResultaat geeft null, geen default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesFrozenRenteResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen CHECKs — tweede beschermingslaag (migratie 21)", () => {
  it("review_status = NOT_REVIEWED wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_rente_categorie (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal) VALUES (?, 'RENTEKOSTEN', 1, 'NOT_REVIEWED', '0')`)
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("beoordeeld = 0 wordt geweigerd (frozen output mag alleen ontstaan na een geslaagde vaststel-validatie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_rente_categorie (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal) VALUES (?, 'RENTEKOSTEN', 0, 'REVIEWED_ZERO_RULES', '0')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("een onbekende categoriewaarde wordt geweigerd (structurele domein-CHECK)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_rente_categorie (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal) VALUES (?, 'ONBEKEND', 1, 'REVIEWED_ZERO_RULES', '0')`)
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("geldige frozen resultaten roundtrippen nog steeds exact, mét alle CHECKs actief", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "RENTEKOSTEN" }), id: 10 },
      { invoer: regelInvoer({ categorie: "RENTE_OPBRENGSTEN" }), id: 20 },
    ]);
    expect(() => schrijfFrozenRenteResultaat(db, versie.id, resultaat)).not.toThrow();
    const gelezen = leesFrozenRenteResultaat(db, versie.id)!;
    expect(gelezen.rentekosten.toString()).toBe(resultaat.rentekosten.toString());
    expect(gelezen.renteOpbrengsten.toString()).toBe(resultaat.renteOpbrengsten.toString());
  });
});
