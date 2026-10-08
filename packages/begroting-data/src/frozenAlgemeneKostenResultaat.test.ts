import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALGEMENE_KOSTEN_CATEGORIEEN,
  berekenBegroteAlgemeneKosten,
  type BgAlgemeneKostenCategorie,
  type BgAlgemeneKostenCategorieAannames,
  type BgAlgemeneKostenClassificatieRegel,
  type BgAlgemeneKostenRegelInvoer,
} from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import {
  leesFrozenAlgemeneKostenResultaat,
  schrijfFrozenAlgemeneKostenResultaat,
  type FrozenAlgemeneKostenResultaat,
} from "./frozenAlgemeneKostenResultaat.js";
import type { HerberekendAlgemeneKostenResultaat } from "./herberekenen.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-frozen-algemene-kosten-"));
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

function regelInvoer(overrides: Partial<BgAlgemeneKostenRegelInvoer> = {}): BgAlgemeneKostenRegelInvoer {
  return {
    categorie: "JURIDISCHE_KOSTEN",
    ogbKostensoortCode: null,
    omschrijving: "Huurgeschil",
    complexnummer: null,
    jaarbedrag: new Decimal(5000),
    ...overrides,
  };
}

function alleAannames(
  overrides: Partial<Record<BgAlgemeneKostenCategorie, Partial<BgAlgemeneKostenCategorieAannames>>> = {},
): Record<BgAlgemeneKostenCategorie, BgAlgemeneKostenCategorieAannames> {
  return Object.fromEntries(
    ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie) => [
      categorie,
      { beoordeeld: true, vorigJaarBedrag: null, verwachteVerhogingPercentage: null, ...overrides[categorie] },
    ]),
  ) as Record<BgAlgemeneKostenCategorie, BgAlgemeneKostenCategorieAannames>;
}

const KLASSIFICATIE_070: BgAlgemeneKostenClassificatieRegel[] = [
  { ogbKostensoort: "4990", ogbKostensoortOmschrijving: "Diverse alg kosten", categorie: "ALGEMENE_KOSTEN" },
  { ogbKostensoort: "4992", ogbKostensoortOmschrijving: "makelaarskosten", categorie: "MAKELAARSKOSTEN" },
  { ogbKostensoort: "4995", ogbKostensoortOmschrijving: "Bankkosten", categorie: "BANKKOSTEN" },
];

/**
 * Berekent via de pure calculator en koppelt (net als eerdere modules)
 * persistentie-ids uitsluitend positioneel PER CATEGORIE — bewust NIET-
 * sequentiële, willekeurige ids, zodat geen enkele test per ongeluk op
 * "id = arrayindex" zou kunnen leunen.
 */
function berekenMetIds(
  regels: readonly { invoer: BgAlgemeneKostenRegelInvoer; id: number }[],
  aannames: Record<BgAlgemeneKostenCategorie, BgAlgemeneKostenCategorieAannames> = alleAannames(),
  classificatie: readonly BgAlgemeneKostenClassificatieRegel[] = [],
): HerberekendAlgemeneKostenResultaat {
  const resultaat = berekenBegroteAlgemeneKosten(
    regels.map((r) => r.invoer),
    aannames,
    classificatie,
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

const zonderIndex = (r: FrozenAlgemeneKostenResultaat) => ({
  ...r,
  perCategorie: r.perCategorie.map((c) => ({
    ...c,
    regels: c.regels.map((x) => ({ persistentieId: x.persistentieId, regel: { ...x.regel, index: undefined } })),
  })),
});

describe("schrijfFrozenAlgemeneKostenResultaat / leesFrozenAlgemeneKostenResultaat — roundtrip", () => {
  it("1. roundtrip 0 regels in alle categorieën (REVIEWED_ZERO_RULES), lege classificatie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([]);
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, []);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    for (const c of gelezen.perCategorie) {
      expect(c.reviewStatus).toBe("REVIEWED_ZERO_RULES");
      expect(c.categorieTotaal.toString()).toBe("0");
      expect(c.regels).toEqual([]);
    }
    expect(gelezen.moduleTotaal.toString()).toBe("0");
    expect(gelezen.classificatie).toEqual([]);
  });

  it("2. de volledige resolved classificatie wordt bevroren, ook OGB-codes die in geen enkele regel zijn gebruikt", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [{ invoer: regelInvoer({ categorie: "BANKKOSTEN", ogbKostensoortCode: "4995" }), id: 10 }],
      alleAannames(),
      KLASSIFICATIE_070,
    );
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, KLASSIFICATIE_070);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    expect(gelezen.classificatie).toEqual(KLASSIFICATIE_070); // incl. 4990/4992, ongebruikt in deze begroting
  });

  it("3. Decimal-precisie exact (meer dan 2 decimalen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer({ jaarbedrag: new Decimal("1234.5678") }), id: 25 }]);
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, []);

    const ruweRij = db
      .prepare(`SELECT jaarbedrag, typeof(jaarbedrag) AS bedrag_type FROM begroting_frozen_algemene_kosten_regel WHERE begroting_versie_id = ? AND regel_id = 25`)
      .get(versie.id) as { jaarbedrag: string; bedrag_type: string };
    expect(ruweRij.bedrag_type).toBe("text");
    expect(ruweRij.jaarbedrag).toBe("1234.5678");

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    expect(gelezen.juridischeKosten.toString()).toBe("1234.5678");
  });

  it("4. meerdere categorieën, meerdere regels: persistentie-ID per categorie correct behouden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "JURIDISCHE_KOSTEN", omschrijving: "Huurgeschil" }), id: 7 },
      { invoer: regelInvoer({ categorie: "JURIDISCHE_KOSTEN", omschrijving: "Contractadvies" }), id: 99 },
      { invoer: regelInvoer({ categorie: "MAKELAARSKOSTEN", omschrijving: "Taxatie" }), id: 3 },
    ]);
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, []);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    const juridisch = gelezen.perCategorie.find((c) => c.categorie === "JURIDISCHE_KOSTEN")!;
    const makelaar = gelezen.perCategorie.find((c) => c.categorie === "MAKELAARSKOSTEN")!;
    expect(juridisch.regels.map((r) => r.persistentieId)).toEqual([7, 99]);
    expect(makelaar.regels.map((r) => r.persistentieId)).toEqual([3]);
  });

  it("5. ogbKostensoortCode null blijft null na frozen roundtrip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer({ categorie: "ACCOUNTANT", ogbKostensoortCode: null }), id: 10 }]);
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, []);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    const accountant = gelezen.perCategorie.find((c) => c.categorie === "ACCOUNTANT")!;
    expect(accountant.regels[0]?.regel.invoer.ogbKostensoortCode).toBeNull();
    expect(accountant.regels[0]?.regel.ogbKostensoortOmschrijving).toBeNull();
  });

  it("6. geldige OGB-koppeling blijft frozen met resolved omschrijving", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [{ invoer: regelInvoer({ categorie: "MAKELAARSKOSTEN", ogbKostensoortCode: "4992" }), id: 10 }],
      alleAannames(),
      KLASSIFICATIE_070,
    );
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, KLASSIFICATIE_070);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    const makelaar = gelezen.perCategorie.find((c) => c.categorie === "MAKELAARSKOSTEN")!;
    expect(makelaar.regels[0]?.regel.ogbKostensoortOmschrijving).toBe("makelaarskosten");
  });

  it("7. Accountant/Bank-rekenhulp (vorigJaarBedrag/verwachteVerhogingPercentage/berekendVoorstel) exact bevroren", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [],
      alleAannames({ ACCOUNTANT: { vorigJaarBedrag: new Decimal(7550), verwachteVerhogingPercentage: new Decimal(5) } }),
    );
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, []);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    const accountant = gelezen.perCategorie.find((c) => c.categorie === "ACCOUNTANT")!;
    expect(accountant.vorigJaarBedrag?.toString()).toBe("7550");
    expect(accountant.verwachteVerhogingPercentage?.toString()).toBe("5");
    expect(accountant.berekendVoorstel?.toString()).toBe("7927.5");
  });

  it("8. controls exact behouden, regelIndex correct vertaald naar/van persistentieId BINNEN categorie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "MAKELAARSKOSTEN", jaarbedrag: new Decimal(100) }), id: 1 },
      { invoer: regelInvoer({ categorie: "MAKELAARSKOSTEN", jaarbedrag: new Decimal(-500) }), id: 20 },
    ]);
    const relevanteControl = resultaat.perCategorie
      .find((c) => c.categorie === "MAKELAARSKOSTEN")!
      .regels.map((r) => r.regel).find((_r, i) => i === 1); // 2e regel, id 20
    expect(relevanteControl).toBeDefined();
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, []);

    const ruweControlRij = db
      .prepare(`SELECT regel_id FROM begroting_frozen_algemene_kosten_control WHERE begroting_versie_id = ? AND ernst = 'WAARSCHUWING'`)
      .get(versie.id) as { regel_id: number };
    expect(ruweControlRij.regel_id).toBe(20);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    const teruggelezenControl = gelezen.controleVereist.find((c) => c.ernst === "WAARSCHUWING")!;
    expect(teruggelezenControl.categorie).toBe("MAKELAARSKOSTEN");
    expect(teruggelezenControl.regelIndex).toBe(1);
  });

  it("9. control zonder regelIndex (categoriebreed, rekenhulp) round-tript met regel_id = NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([], alleAannames({ BANKKOSTEN: { verwachteVerhogingPercentage: new Decimal(-5) } }));
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, []);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    const control = gelezen.controleVereist.find((c) => c.categorie === "BANKKOSTEN" && c.ernst === "WAARSCHUWING")!;
    expect(control.regelIndex).toBeNull();
  });

  it("10. moduleTotaal en de vijf categorietotalen exact bevroren", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "ACCOUNTANT", jaarbedrag: new Decimal(4000) }), id: 1 },
      { invoer: regelInvoer({ categorie: "BANKKOSTEN", jaarbedrag: new Decimal(50) }), id: 2 },
    ]);
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, []);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    expect(gelezen.accountantskosten.toString()).toBe("4000");
    expect(gelezen.bankkosten.toString()).toBe("50");
    expect(gelezen.moduleTotaal.toString()).toBe("4050");
  });

  it("11. structurele gelijkheid: read-back is volledig gelijk aan het oorspronkelijke resultaat + classificatie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds(
      [
        { invoer: regelInvoer({ categorie: "JURIDISCHE_KOSTEN" }), id: 10 },
        { invoer: regelInvoer({ categorie: "MAKELAARSKOSTEN", ogbKostensoortCode: "4992" }), id: 20 },
      ],
      alleAannames(),
      KLASSIFICATIE_070,
    );
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, KLASSIFICATIE_070);
    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;

    const verwacht: FrozenAlgemeneKostenResultaat = { ...resultaat, classificatie: KLASSIFICATIE_070 };
    expect(normaliseer(zonderIndex(gelezen))).toEqual(normaliseer(zonderIndex(verwacht)));
  });
});

describe("atomiciteit / vervangen / rollback", () => {
  it("12. schrijven en vervangen tijdens CONCEPT is toegestaan (complete replacement, geen resten)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ categorie: "ACCOUNTANT" }), id: 10 }]), []);
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ categorie: "BANKKOSTEN" }), id: 99 }]), []);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    expect(gelezen.perCategorie.find((c) => c.categorie === "ACCOUNTANT")!.regels).toEqual([]);
    expect(gelezen.perCategorie.find((c) => c.categorie === "BANKKOSTEN")!.regels[0]?.persistentieId).toBe(99);
    expect(db.prepare(`SELECT 1 FROM begroting_frozen_algemene_kosten_regel WHERE regel_id = 10`).get()).toBeUndefined();
  });

  it("13. een mislukte frozen write (CHECK-schending op review_status) laat het vorige geldige resultaat exact intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const geldigResultaat = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, geldigResultaat, []);

    const kapotResultaat: HerberekendAlgemeneKostenResultaat = {
      ...geldigResultaat,
      perCategorie: geldigResultaat.perCategorie.map((c) => (c.categorie === "JURIDISCHE_KOSTEN" ? { ...c, reviewStatus: "NOT_REVIEWED" as never } : c)),
    };

    expect(() => schrijfFrozenAlgemeneKostenResultaat(db, versie.id, kapotResultaat, [])).toThrow(/CHECK constraint failed/);

    const naMislukking = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    const verwacht: FrozenAlgemeneKostenResultaat = { ...geldigResultaat, classificatie: [] };
    expect(normaliseer(zonderIndex(naMislukking))).toEqual(normaliseer(zonderIndex(verwacht)));
  });

  it("14. defensieve bounds-check: een control met een regelIndex buiten bereik faalt fail-fast, geen stille NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const basis = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    const kapotResultaat: HerberekendAlgemeneKostenResultaat = {
      ...basis,
      controleVereist: [{ categorie: "JURIDISCHE_KOSTEN", regelIndex: 99, ernst: "INFORMATIEF", bericht: "verwijst naar niet-bestaande regel" }],
    };

    expect(() => schrijfFrozenAlgemeneKostenResultaat(db, versie.id, kapotResultaat, [])).toThrow(/correlatie geschonden/);
    expect(leesFrozenAlgemeneKostenResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen read gebruikt geen pure calculator en geen conceptdata/actuele config", () => {
  it("15. een kunstmatig gemanipuleerd bevroren moduleTotaal komt ONGEWIJZIGD terug — geen herberekening bij lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, berekenMetIds([{ invoer: regelInvoer({ jaarbedrag: new Decimal(1000) }), id: 10 }]), []);

    // Versie is hier bewust nog CONCEPT — de immutability-triggers blokkeren pas na VASTGESTELD.
    db.prepare(`UPDATE begroting_frozen_algemene_kosten_categorie SET module_totaal = '999999' WHERE begroting_versie_id = ?`).run(versie.id);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    expect(gelezen.moduleTotaal.toString()).toBe("999999"); // gemanipuleerd, NIET herberekend uit de categorietotalen
  });

  it("16. wijziging van de actuele (levende) classificatie raakt een reeds bevroren snapshot niet", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenAlgemeneKostenResultaat(
      db,
      versie.id,
      berekenMetIds([{ invoer: regelInvoer({ categorie: "MAKELAARSKOSTEN", ogbKostensoortCode: "4992" }), id: 10 }], alleAannames(), KLASSIFICATIE_070),
      KLASSIFICATIE_070,
    );

    // Rechtstreekse SQL-simulatie van "de levende classificatie is later gewijzigd" — de frozen tabel
    // heeft geen enkele koppeling naar de levende tabel, dus deze mutatie kan de bevroren kopie niet raken.
    db.exec(`DELETE FROM begroting_algemene_kosten_classificatie`);

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    expect(gelezen.classificatie).toEqual(KLASSIFICATIE_070);
  });
});

describe("immutability", () => {
  it("17. directe SQL INSERT/UPDATE/DELETE op VASTGESTELD worden geweigerd (alle vier tabellen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Negatief bedrag geeft bewust een WAARSCHUWING-control zodat de control-tabel niet leeg is.
    schrijfFrozenAlgemeneKostenResultaat(
      db,
      versie.id,
      berekenMetIds([{ invoer: regelInvoer({ jaarbedrag: new Decimal(-500) }), id: 10 }], alleAannames(), KLASSIFICATIE_070),
      KLASSIFICATIE_070,
    );
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_algemene_kosten_classificatie (begroting_versie_id, volgnr, ogb_kostensoort, ogb_kostensoort_omschrijving, categorie) VALUES (?, 99, 'x', 'x', 'BANKKOSTEN')`)
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`DELETE FROM begroting_frozen_algemene_kosten_classificatie WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);

    expect(() =>
      db.prepare(`UPDATE begroting_frozen_algemene_kosten_categorie SET categorie_totaal = '999' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_algemene_kosten_categorie WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );

    expect(() => db.prepare(`UPDATE begroting_frozen_algemene_kosten_regel SET omschrijving = 'x' WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
    expect(() => db.prepare(`DELETE FROM begroting_frozen_algemene_kosten_regel WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_algemene_kosten_control (begroting_versie_id, volgnr, categorie, ernst, bericht) VALUES (?, 99, 'BANKKOSTEN', 'INFORMATIEF', 'x')`)
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_algemene_kosten_control WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
  });

  it("18. schrijven via de API op een VASTGESTELDE versie wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, []);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, [])).toThrow(/VASTGESTELD/);
  });

  it("lezen blijft na VASTGESTELD gewoon toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([{ invoer: regelInvoer(), id: 10 }]);
    schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, []);
    markeerVastgesteld(db, versie.id, new Date());

    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    expect(gelezen.moduleTotaal.toString()).toBe(resultaat.moduleTotaal.toString());
  });
});

describe("cascade/FK-gedrag", () => {
  it("19. verwijderen van een CONCEPT-versie cascadeert alle vier frozen-tabellen volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenAlgemeneKostenResultaat(
      db,
      versie.id,
      berekenMetIds([{ invoer: regelInvoer({ jaarbedrag: new Decimal(-500) }), id: 10 }], alleAannames(), KLASSIFICATIE_070),
      KLASSIFICATIE_070,
    );

    verwijderConceptVersie(db, versie.id);

    for (const tabel of [
      "begroting_frozen_algemene_kosten_classificatie",
      "begroting_frozen_algemene_kosten_categorie",
      "begroting_frozen_algemene_kosten_regel",
      "begroting_frozen_algemene_kosten_control",
    ]) {
      expect(db.prepare(`SELECT 1 FROM ${tabel} WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
    }
  });

  it("geen frozen Algemene-Kosten-output geschreven -> leesFrozenAlgemeneKostenResultaat geeft null, geen default", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesFrozenAlgemeneKostenResultaat(db, versie.id)).toBeNull();
  });
});

describe("frozen CHECKs — tweede beschermingslaag (migratie 17)", () => {
  it("review_status = NOT_REVIEWED wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_algemene_kosten_categorie
             (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal, module_totaal)
           VALUES (?, 'ACCOUNTANT', 1, 'NOT_REVIEWED', '0', '0')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("beoordeeld = 0 wordt geweigerd (frozen output mag alleen ontstaan na een geslaagde vaststel-validatie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_algemene_kosten_categorie
             (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal, module_totaal)
           VALUES (?, 'ACCOUNTANT', 0, 'REVIEWED_ZERO_RULES', '0', '0')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("een onbekende categoriewaarde wordt geweigerd (structurele domein-CHECK)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_algemene_kosten_categorie
             (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal, module_totaal)
           VALUES (?, 'ONBEKEND', 1, 'REVIEWED_ZERO_RULES', '0', '0')`,
        )
        .run(versie.id),
    ).toThrow(/CHECK constraint failed/);
  });

  it("geldige frozen resultaten roundtrippen nog steeds exact, mét alle CHECKs actief", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([
      { invoer: regelInvoer({ categorie: "ACCOUNTANT" }), id: 10 },
      { invoer: regelInvoer({ categorie: "BANKKOSTEN" }), id: 20 },
    ]);
    expect(() => schrijfFrozenAlgemeneKostenResultaat(db, versie.id, resultaat, [])).not.toThrow();
    const gelezen = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;
    expect(gelezen.moduleTotaal.toString()).toBe(resultaat.moduleTotaal.toString());
  });
});
