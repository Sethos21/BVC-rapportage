import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEEGSTAND_CATEGORIEEN, berekenWerkelijkLeegstand, type BgLeegstandCategorie } from "@bvc/reporting";
import { maakBegrotingsversie, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesLeegstandEstimatedResultaat, leesLeegstandEstimatedVerwachting, schrijfLeegstandEstimatedVerwachting, type LeegstandEstimatedVerwachting } from "./leegstandEstimated.js";
import { schrijfLeegstandCategorieState } from "./leegstandCategorieState.js";
import { schrijfLeegstandRegels } from "./leegstandRegels.js";

/** Estimated Leegstandskosten (Vervolgtranche 8): persistentie op kwartaalstructuur en koppeling met Begroting/Werkelijk. */

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-leegstand-estimated-"));
  db = openOrCreateDatabase(join(dir, "begrotingen.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const D = (n: number) => new Decimal(n);
const VERSIE: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "003", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };
const leeg = () => ({ q1: null, q2: null, q3: null, q4: null });
const verwachting = (o: Partial<Record<BgLeegstandCategorie, { q1?: number | null; q2?: number | null; q3?: number | null; q4?: number | null }>> = {}): LeegstandEstimatedVerwachting =>
  Object.fromEntries(
    LEEGSTAND_CATEGORIEEN.map((c) => {
      const v = o[c] ?? {};
      const bedrag = (x: number | null | undefined) => (x === undefined || x === null ? null : D(x));
      return [c, { q1: bedrag(v.q1), q2: bedrag(v.q2), q3: bedrag(v.q3), q4: bedrag(v.q4) }];
    }),
  ) as LeegstandEstimatedVerwachting;
const werkelijk = (saldo: number) =>
  berekenWerkelijkLeegstand([{ ogbKostensoort: "N1", complexnummer: "001", saldo: D(saldo) }], [{ ogbKostensoort: "N1", ogbKostensoortOmschrijving: "Nuts", categorie: "NUTS_LEEGSTAND" }]);

function maakVersie(): string {
  const id = maakBegrotingsversie(db, VERSIE).id;
  schrijfLeegstandRegels(db, id, [
    { id: null, categorie: "NUTS_LEEGSTAND", complexnummer: "001", complexomschrijving: "Pand A", omschrijving: "Nuts", q1: D(100), q2: D(100), q3: D(100), q4: D(100) },
    { id: null, categorie: "SERVICEKOSTEN_LEEGSTAND", complexnummer: null, complexomschrijving: null, omschrijving: "Service (NTB)", q1: D(50), q2: D(50), q3: D(50), q4: D(50) },
  ]);
  schrijfLeegstandCategorieState(
    db,
    id,
    Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c) => [c, { beoordeeld: true, laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null }])) as never,
  );
  return id;
}

describe("Leegstand Estimated — persistence (migratie 37)", () => {
  it("1. geen rijen = alles null (niet ingevuld), nooit stil €0", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    expect(leesLeegstandEstimatedVerwachting(db, id)).toEqual(verwachting());
    expect(leesLeegstandEstimatedVerwachting(db, id).NUTS_LEEGSTAND).toEqual(leeg());
  });

  it("2. round-trip per kostensoort en kwartaal; Decimal als TEXT zonder precisieverlies; bewust €0 blijft onderscheiden van null", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    schrijfLeegstandEstimatedVerwachting(db, id, verwachting({ NUTS_LEEGSTAND: { q3: 12.3456, q4: 0 }, OVERIGE_LEEGSTANDSKOSTEN: { q4: -5 } }));
    const g = leesLeegstandEstimatedVerwachting(db, id);
    expect(g.NUTS_LEEGSTAND.q3!.toString()).toBe("12.3456");
    expect(g.NUTS_LEEGSTAND.q4!.isZero()).toBe(true);
    expect(g.NUTS_LEEGSTAND.q1).toBeNull();
    expect(g.OVERIGE_LEEGSTANDSKOSTEN.q4!.toString()).toBe("-5");
    const ruw = db.prepare(`SELECT typeof(bedrag) AS t FROM begroting_leegstand_estimated_verwachting WHERE begroting_versie_id = ?`).all(id) as { t: string }[];
    expect(ruw.every((r) => r.t === "text")).toBe(true);
  });

  it("3. complete-state save: null verwijdert een rij; NaN en onbekende versie worden geweigerd zonder mutatie; versiegebonden en cascade", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    schrijfLeegstandEstimatedVerwachting(db, id, verwachting({ NUTS_LEEGSTAND: { q3: 1, q4: 2 } }));
    schrijfLeegstandEstimatedVerwachting(db, id, verwachting({ NUTS_LEEGSTAND: { q3: 1 } }));
    expect(leesLeegstandEstimatedVerwachting(db, id).NUTS_LEEGSTAND.q4).toBeNull();
    expect(() => schrijfLeegstandEstimatedVerwachting(db, id, verwachting({ NUTS_LEEGSTAND: { q3: NaN } }))).toThrow(/NaN/);
    expect(() => schrijfLeegstandEstimatedVerwachting(db, "bestaat-niet", verwachting())).toThrow(/bestaat niet/);
    expect(leesLeegstandEstimatedVerwachting(db, id).NUTS_LEEGSTAND.q3!.toString()).toBe("1");
    const andere = maakBegrotingsversie(db, { ...VERSIE, bedrijfsnr: "070" }).id;
    expect(leesLeegstandEstimatedVerwachting(db, andere)).toEqual(verwachting());
    verwijderConceptVersie(db, id);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM begroting_leegstand_estimated_verwachting`).get() as { n: number }).n).toBe(0);
  });

  it("4. structurele CHECKs: onbekende kostensoort en kwartaal 5 kunnen niet worden geschreven", () => {
    const id = maakBegrotingsversie(db, VERSIE).id;
    expect(() => db.prepare(`INSERT INTO begroting_leegstand_estimated_verwachting (begroting_versie_id, categorie, kwartaal, bedrag) VALUES (?, 'ONDERHOUD', 1, '1')`).run(id)).toThrow();
    expect(() => db.prepare(`INSERT INTO begroting_leegstand_estimated_verwachting (begroting_versie_id, categorie, kwartaal, bedrag) VALUES (?, 'NUTS_LEEGSTAND', 5, '1')`).run(id)).toThrow();
  });
});

describe("Leegstand Estimated — Werkelijk + resterende verwachting, Begroting ongemoeid", () => {
  it("5. Estimated = Werkelijk (60, exact éénmaal) + resterende Q3+Q4 (25 + 25 = 50) = 110 voor Nuts; Begroting (400) ongewijzigd doorgegeven; afwijking −290", () => {
    const id = maakVersie();
    schrijfLeegstandEstimatedVerwachting(db, id, verwachting({ NUTS_LEEGSTAND: { q3: 25, q4: 25 }, SERVICEKOSTEN_LEEGSTAND: { q3: 0, q4: 0 }, OVERIGE_LEEGSTANDSKOSTEN: { q3: 0, q4: 0 } }));
    const r = leesLeegstandEstimatedResultaat(db, id, werkelijk(60), ["Q3", "Q4"]);
    const nuts = r.estimated.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!;
    expect(nuts.werkelijkTotaal.toString()).toBe("60");
    expect(nuts.verwachtingResterendJaar!.toString()).toBe("50");
    expect(nuts.estimatedTotaal!.toString()).toBe("110");
    expect(nuts.begrotingTotaal.toString()).toBe("400");
    expect(nuts.afwijking!.toString()).toBe("-290");
    expect(r.estimated.moduleEstimatedTotaal!.toString()).toBe("110"); // Servicekosten en Overige: werkelijk 0 + bewuste 0
  });

  it("6. ontbrekende resterende verwachting blijft onbekend (null), nooit Werkelijk + 0; een gedeeltelijk ingevuld kwartaalpaar is ook onbekend", () => {
    const id = maakVersie();
    schrijfLeegstandEstimatedVerwachting(db, id, verwachting({ NUTS_LEEGSTAND: { q3: 25 } }));
    const r = leesLeegstandEstimatedResultaat(db, id, werkelijk(60), ["Q3", "Q4"]);
    expect(r.estimated.perCategorie.every((c) => c.estimatedTotaal === null)).toBe(true);
    expect(r.estimated.moduleEstimatedTotaal).toBeNull();
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);
  });

  it("7. een bedrag voor een afgesloten kwartaal telt niet mee (geen dubbele telling met Werkelijk) en wordt gemeld", () => {
    const id = maakVersie();
    schrijfLeegstandEstimatedVerwachting(db, id, verwachting({ NUTS_LEEGSTAND: { q1: 999, q3: 25, q4: 25 }, SERVICEKOSTEN_LEEGSTAND: { q3: 0, q4: 0 }, OVERIGE_LEEGSTANDSKOSTEN: { q3: 0, q4: 0 } }));
    const r = leesLeegstandEstimatedResultaat(db, id, werkelijk(60), ["Q3", "Q4"]);
    expect(r.estimated.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!.estimatedTotaal!.toString()).toBe("110");
    expect(r.controleVereist.some((c) => c.ernst === "INFORMATIEF" && c.bericht.includes("Q1"))).toBe(true);
  });

  it("8. de Begroting wordt niet gemuteerd: schrijven van de verwachting raakt de regels en het Begroting-totaal niet; lezen schrijft niets", () => {
    const id = maakVersie();
    const voor = leesLeegstandEstimatedResultaat(db, id, werkelijk(0), ["Q3", "Q4"]).estimated.moduleBegrotingTotaal.toString();
    expect(voor).toBe("600");
    schrijfLeegstandEstimatedVerwachting(db, id, verwachting({ NUTS_LEEGSTAND: { q3: 9999, q4: 9999 } }));
    expect(leesLeegstandEstimatedResultaat(db, id, werkelijk(0), ["Q3", "Q4"]).estimated.moduleBegrotingTotaal.toString()).toBe(voor);
    const rijen = (db.prepare(`SELECT COUNT(*) AS n FROM begroting_leegstand_estimated_verwachting`).get() as { n: number }).n;
    leesLeegstandEstimatedResultaat(db, id, werkelijk(0), ["Q3", "Q4"]);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM begroting_leegstand_estimated_verwachting`).get() as { n: number }).n).toBe(rijen);
  });

  it("9. een niet-bestaande versie faalt; afgesloten jaar (geen resterende kwartalen) geeft Estimated = Werkelijk als bekende waarde", () => {
    expect(() => leesLeegstandEstimatedResultaat(db, "bestaat-niet", werkelijk(0), ["Q4"])).toThrow(/bestaat niet/);
    const id = maakVersie();
    const r = leesLeegstandEstimatedResultaat(db, id, werkelijk(60), []);
    expect(r.estimated.perCategorie.find((c) => c.categorie === "NUTS_LEEGSTAND")!.estimatedTotaal!.toString()).toBe("60");
  });
});
