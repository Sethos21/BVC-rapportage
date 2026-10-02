import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenWerkelijkVerzekeringen } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { schrijfFrozenVerzekeringResultaat } from "./frozenVerzekeringResultaat.js";
import { berekenVerzekeringUitInvoer } from "./herberekenen.js";
import { combineerVerzekeringEstimated, leesVerzekeringEstimatedResultaat } from "./verzekeringEstimated.js";
import { leesVerzekeringEstimatedPolissen, schrijfVerzekeringEstimatedPolissen } from "./verzekeringEstimatedPolissen.js";
import { leesVerzekeringBeoordeeld, schrijfVerzekeringBeoordeeld } from "./verzekeringBeoordeeld.js";
import { leesVerzekeringRegels, schrijfVerzekeringRegels, type VerzekeringRegelInvoer } from "./verzekeringRegels.js";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-verzekering-estimated-"));
  db = openOrCreateDatabase(join(dir, "begrotingen.sqlite"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const VERSIE_INPUT: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };
const H2 = [7, 8, 9, 10, 11, 12];

function polis(overrides: Partial<VerzekeringRegelInvoer> = {}): VerzekeringRegelInvoer {
  return {
    id: null,
    complexnummer: "001",
    verzekeraar: "Gilde",
    grootboekrekening: "4130",
    ogbKostensoort: null,
    ingangsdatum: new Date(Date.UTC(2020, 6, 1)),
    looptijdMaanden: 12,
    bedrag: new Decimal(12000),
    indexPercentage: new Decimal(3),
    handmatigBegrootOverride: null,
    ...overrides,
  };
}
const werkelijk = (bedrag: number) => berekenWerkelijkVerzekeringen([{ economischeCategorie: "BRAND_OPSTALVERZEKERING", complexnummer: "001", saldo: new Decimal(bedrag) }]);

describe("Verzekering-Estimated per polis — persistentie", () => {
  it("1. schrijven/lezen: expliciet €0, negatief en decimalen round-trippen exact; geen rij = geen aanpassing", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    const [a, b, c] = schrijfVerzekeringRegels(db, versie.id, [polis({ complexnummer: "A" }), polis({ complexnummer: "B" }), polis({ complexnummer: "C" })]);
    const gelezen = schrijfVerzekeringEstimatedPolissen(db, versie.id, [
      { regelId: a!.id, handmatigeResterendeVerwachting: new Decimal(0) },
      { regelId: b!.id, handmatigeResterendeVerwachting: new Decimal("-125.5") },
    ]);
    expect(gelezen.map((p) => [p.regelId, p.handmatigeResterendeVerwachting.toString()])).toEqual([[a!.id, "0"], [b!.id, "-125.5"]]);
    expect(gelezen.find((p) => p.regelId === c!.id)).toBeUndefined();
  });

  it("2. UPSERT vervangt; een weggelaten polis verliest haar aanpassing", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    const [a, b] = schrijfVerzekeringRegels(db, versie.id, [polis({ complexnummer: "A" }), polis({ complexnummer: "B" })]);
    schrijfVerzekeringEstimatedPolissen(db, versie.id, [{ regelId: a!.id, handmatigeResterendeVerwachting: new Decimal(1) }, { regelId: b!.id, handmatigeResterendeVerwachting: new Decimal(2) }]);
    const na = schrijfVerzekeringEstimatedPolissen(db, versie.id, [{ regelId: a!.id, handmatigeResterendeVerwachting: new Decimal(9) }]);
    expect(na.map((p) => [p.regelId, p.handmatigeResterendeVerwachting.toString()])).toEqual([[a!.id, "9"]]);
  });

  it("3. onbekende id, id van een andere versie, dubbele id en NaN worden geweigerd zonder mutatie", () => {
    const versieA = maakBegrotingsversie(db, VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, { ...VERSIE_INPUT, begrotingsjaar: 2028 });
    const [regelA] = schrijfVerzekeringRegels(db, versieA.id, [polis()]);
    expect(() => schrijfVerzekeringEstimatedPolissen(db, versieA.id, [{ regelId: 999999, handmatigeResterendeVerwachting: new Decimal(1) }])).toThrow(/bestaat niet/);
    expect(() => schrijfVerzekeringEstimatedPolissen(db, versieB.id, [{ regelId: regelA!.id, handmatigeResterendeVerwachting: new Decimal(1) }])).toThrow(/behoort bij begrotingsversie/);
    expect(() =>
      schrijfVerzekeringEstimatedPolissen(db, versieA.id, [
        { regelId: regelA!.id, handmatigeResterendeVerwachting: new Decimal(1) },
        { regelId: regelA!.id, handmatigeResterendeVerwachting: new Decimal(2) },
      ]),
    ).toThrow(/meerdere keren/);
    expect(() => schrijfVerzekeringEstimatedPolissen(db, versieA.id, [{ regelId: regelA!.id, handmatigeResterendeVerwachting: new Decimal(NaN) }])).toThrow(/NaN/);
    expect(leesVerzekeringEstimatedPolissen(db, versieA.id)).toEqual([]);
  });

  it("4. blijft schrijfbaar NA vaststellen (geen CONCEPT-check) en muteert de Begroting-regels niet", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    const [regel] = schrijfVerzekeringRegels(db, versie.id, [polis({ handmatigBegrootOverride: new Decimal(777) })]);
    const voor = JSON.stringify(leesVerzekeringRegels(db, versie.id));
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => schrijfVerzekeringEstimatedPolissen(db, versie.id, [{ regelId: regel!.id, handmatigeResterendeVerwachting: new Decimal(5) }])).not.toThrow();
    expect(JSON.stringify(leesVerzekeringRegels(db, versie.id))).toBe(voor);
  });

  it("5. het verwijderen van de polisregel cascadeert de aanpassing weg", () => {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    const [regel] = schrijfVerzekeringRegels(db, versie.id, [polis()]);
    schrijfVerzekeringEstimatedPolissen(db, versie.id, [{ regelId: regel!.id, handmatigeResterendeVerwachting: new Decimal(5) }]);
    schrijfVerzekeringRegels(db, versie.id, []);
    expect(leesVerzekeringEstimatedPolissen(db, versie.id)).toEqual([]);
  });
});

describe("Verzekering-Estimated per polis — koppeling via stabiele regel-id", () => {
  function begrotingVoor(regels: VerzekeringRegelInvoer[], versieId = "v-x") {
    const gelezen = regels.map((r, i) => ({ ...r, id: 100 + i }) as unknown as Parameters<typeof berekenVerzekeringUitInvoer>[2][number]);
    return berekenVerzekeringUitInvoer(versieId, 2027, gelezen, true);
  }

  it("6. de handmatige aanpassing hoort bij de juiste polis, ook bij omgekeerde volgorde van Begroting én aanpassingen, en bij identieke polisgegevens", () => {
    const identiek = { verzekeraar: "Gelijk", grootboekrekening: "4130", bedrag: new Decimal(6000), indexPercentage: new Decimal(0) };
    const voor = combineerVerzekeringEstimated({
      versieId: "v-x",
      begroting: begrotingVoor([polis(identiek), polis(identiek)]),
      handmatig: [
        { regelId: 100, handmatigeResterendeVerwachting: new Decimal(111) },
        { regelId: 101, handmatigeResterendeVerwachting: new Decimal(999) },
      ],
      werkelijk: werkelijk(0),
      werkelijkDekkingBevestigd: true,
      resterendeMaanden: H2,
    });
    const b = begrotingVoor([polis(identiek), polis(identiek)]);
    const achter = combineerVerzekeringEstimated({
      versieId: "v-x",
      begroting: { ...b, regels: [...b.regels].reverse() },
      handmatig: [
        { regelId: 101, handmatigeResterendeVerwachting: new Decimal(999) },
        { regelId: 100, handmatigeResterendeVerwachting: new Decimal(111) },
      ],
      werkelijk: werkelijk(0),
      werkelijkDekkingBevestigd: true,
      resterendeMaanden: H2,
    });
    const perId = (r: typeof voor) => new Map(r.polissen.map((p) => [p.regelId, p.effectieveResterendeVerwachting!.toString()]));
    expect(perId(voor).get(100)).toBe("111");
    expect(perId(voor).get(101)).toBe("999");
    expect(perId(achter)).toEqual(perId(voor));
    expect(achter.estimated.moduleEstimatedTotaal!.toString()).toBe(voor.estimated.moduleEstimatedTotaal!.toString());
  });

  it("7. ontbrekende aanpassing wordt niet aan een andere polis gekoppeld; orphan en dubbele aanpassing falen hard", () => {
    const basis = { versieId: "v-x", begroting: begrotingVoor([polis(), polis({ complexnummer: "002" })]), werkelijk: werkelijk(0), werkelijkDekkingBevestigd: true, resterendeMaanden: H2 };
    const r = combineerVerzekeringEstimated({ ...basis, handmatig: [{ regelId: 101, handmatigeResterendeVerwachting: new Decimal(50) }] });
    expect(r.polissen.find((p) => p.regelId === 100)!.handmatigeResterendeVerwachting).toBeNull();
    expect(r.polissen.find((p) => p.regelId === 101)!.handmatigeResterendeVerwachting!.toString()).toBe("50");
    expect(() => combineerVerzekeringEstimated({ ...basis, handmatig: [{ regelId: 999, handmatigeResterendeVerwachting: new Decimal(1) }] })).toThrow(/orphan/);
    expect(() =>
      combineerVerzekeringEstimated({ ...basis, handmatig: [{ regelId: 100, handmatigeResterendeVerwachting: new Decimal(1) }, { regelId: 100, handmatigeResterendeVerwachting: new Decimal(2) }] }),
    ).toThrow(/meerdere keren/);
  });

  it("8. controls worden naar de stabiele regel-id vertaald", () => {
    const r = combineerVerzekeringEstimated({
      versieId: "v-x",
      begroting: begrotingVoor([polis(), polis({ complexnummer: "002" })]),
      handmatig: [{ regelId: 101, handmatigeResterendeVerwachting: new Decimal(-5) }],
      werkelijk: werkelijk(0),
      werkelijkDekkingBevestigd: true,
      resterendeMaanden: H2,
    });
    expect(r.controleVereist).toEqual([expect.objectContaining({ regelId: 101, ernst: "WAARSCHUWING" })]);
  });
});

describe("Verzekering-Estimated per polis — lifecycle (SQLite)", () => {
  function seed(): { versieId: string; ids: number[] } {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    const regels = schrijfVerzekeringRegels(db, versie.id, [
      polis({ complexnummer: "001" }),
      polis({ complexnummer: "002", bedrag: new Decimal(6000), indexPercentage: new Decimal(0), handmatigBegrootOverride: new Decimal(1200) }),
    ]);
    schrijfVerzekeringBeoordeeld(db, versie.id, true);
    return { versieId: versie.id, ids: regels.map((r) => r.id) };
  }

  it("9. CONCEPT: automatisch voorstel (incl. Begroting-override) + handmatige aanpassing per polis; Estimated = Werkelijk (éénmaal) + som effectief", () => {
    const { versieId, ids } = seed();
    schrijfVerzekeringEstimatedPolissen(db, versieId, [{ regelId: ids[0]!, handmatigeResterendeVerwachting: new Decimal(1000) }]);
    const r = leesVerzekeringEstimatedResultaat(db, versieId, werkelijk(9000), true, H2);
    const p1 = r.polissen.find((p) => p.regelId === ids[0])!;
    const p2 = r.polissen.find((p) => p.regelId === ids[1])!;
    expect(p1.automatischResterendVoorstel!.toString()).toBe("6180");
    expect(p1.effectieveResterendeVerwachting!.toString()).toBe("1000");
    expect(p2.automatischResterendVoorstel!.toString()).toBe("600"); // override 1200 → 100/maand, 6 resterende maanden
    expect(r.resterendeVerwachtingTotaal!.toString()).toBe("1600");
    expect(r.estimated.moduleEstimatedTotaal!.toString()).toBe("10600"); // 9000 + 1600
  });

  it("10. VASTGESTELD: Begroting blijft onveranderd, Estimated blijft wijzigbaar en verandert alleen Estimated; geen frozen-Estimated-tabel", () => {
    const { versieId, ids } = seed();
    const begrotingVoorVast = leesVerzekeringEstimatedResultaat(db, versieId, werkelijk(9000), true, H2).estimated.moduleBegrotingTotaal.toString();
    schrijfFrozenVerzekeringResultaat(
      db,
      versieId,
      berekenVerzekeringUitInvoer(versieId, 2027, leesVerzekeringRegels(db, versieId), leesVerzekeringBeoordeeld(db, versieId)),
    );
    markeerVastgesteld(db, versieId, new Date());

    const vast = leesVerzekeringEstimatedResultaat(db, versieId, werkelijk(9000), true, H2);
    expect(vast.estimated.moduleBegrotingTotaal.toString()).toBe(begrotingVoorVast);
    expect(vast.estimated.moduleEstimatedTotaal!.toString()).toBe("15780"); // 9000 + 6180 + 600

    schrijfVerzekeringEstimatedPolissen(db, versieId, [{ regelId: ids[1]!, handmatigeResterendeVerwachting: new Decimal(0) }]);
    const na = leesVerzekeringEstimatedResultaat(db, versieId, werkelijk(9000), true, H2);
    expect(na.estimated.moduleBegrotingTotaal.toString()).toBe(begrotingVoorVast);
    expect(na.estimated.moduleEstimatedTotaal!.toString()).toBe("15180"); // 9000 + 6180 + 0
    expect(na.polissen.find((p) => p.regelId === ids[1])!.automatischResterendVoorstel!.toString()).toBe("600"); // voorstel blijft zichtbaar

    const frozenEstimated = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%frozen%estimated%'`).all();
    expect(frozenEstimated).toEqual([]);
  });

  it("11. lezen schrijft niets en Werkelijk-dekking niet bevestigd geeft Estimated onbekend (null)", () => {
    const { versieId } = seed();
    const voor = JSON.stringify(leesVerzekeringEstimatedPolissen(db, versieId));
    const r = leesVerzekeringEstimatedResultaat(db, versieId, werkelijk(9000), false, H2);
    expect(r.estimated.moduleEstimatedTotaal).toBeNull();
    expect(JSON.stringify(leesVerzekeringEstimatedPolissen(db, versieId))).toBe(voor);
  });
});
