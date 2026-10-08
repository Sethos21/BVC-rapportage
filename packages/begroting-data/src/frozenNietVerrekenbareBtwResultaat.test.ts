import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenBegroteNietVerrekenbareBtw, type BgNietVerrekenbareBtwAannames, type BgNietVerrekenbareBtwRegelInvoer } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenNietVerrekenbareBtwResultaat, schrijfFrozenNietVerrekenbareBtwResultaat } from "./frozenNietVerrekenbareBtwResultaat.js";
import type { HerberekendNietVerrekenbareBtwResultaat } from "./herberekenen.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-frozen-btw-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NIEUWE_VERSIE_INPUT: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };

function regelInvoer(overrides: Partial<BgNietVerrekenbareBtwRegelInvoer> = {}): BgNietVerrekenbareBtwRegelInvoer {
  return { omschrijving: "BTW jaarafrekening", complexnummer: null, jaarbedrag: new Decimal("2500"), ...overrides };
}

const AANNAMES: BgNietVerrekenbareBtwAannames = { begrotingsjaar: 2027, beoordeeld: true, vorigJaarWerkelijk: new Decimal("2100") };

/** Berekent via de pure calculator en koppelt persistentie-ids uitsluitend positioneel — bewust NIET-sequentiële ids. */
function berekenMetIds(regels: readonly BgNietVerrekenbareBtwRegelInvoer[], ids: readonly number[], aannames: BgNietVerrekenbareBtwAannames = AANNAMES): HerberekendNietVerrekenbareBtwResultaat {
  const resultaat = berekenBegroteNietVerrekenbareBtw(regels, aannames);
  return { ...resultaat, regels: resultaat.regels.map((r, i) => ({ persistentieId: ids[i]!, regel: r })) };
}

describe("schrijfFrozenNietVerrekenbareBtwResultaat / leesFrozenNietVerrekenbareBtwResultaat — roundtrip", () => {
  it("1. roundtrip 0 regels (REVIEWED_ZERO_RULES), bewuste €0", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([], [], { begrotingsjaar: 2027, beoordeeld: true, vorigJaarWerkelijk: null });
    expect(resultaat.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    schrijfFrozenNietVerrekenbareBtwResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenNietVerrekenbareBtwResultaat(db, versie.id)!;
    expect(gelezen.beoordeeld).toBe(true);
    expect(gelezen.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    expect(gelezen.moduleTotaal.toString()).toBe("0");
    expect(gelezen.vorigJaarWerkelijk).toBeNull();
    expect(gelezen.regels).toEqual([]);
  });

  it("2. roundtrip meerdere regels + vorigJaarWerkelijk, Decimal-precisie exact behouden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const resultaat = berekenMetIds([regelInvoer({ jaarbedrag: new Decimal("1234.5678") }), regelInvoer({ omschrijving: "Correctie", jaarbedrag: null })], [25, 10]);
    schrijfFrozenNietVerrekenbareBtwResultaat(db, versie.id, resultaat);

    const gelezen = leesFrozenNietVerrekenbareBtwResultaat(db, versie.id)!;
    expect(gelezen.moduleTotaal.toString()).toBe("1234.5678");
    expect(gelezen.vorigJaarWerkelijk!.toString()).toBe("2100");
    expect(gelezen.regels.map((r) => r.persistentieId)).toEqual([10, 25]); // ORDER BY regel_id
    expect(gelezen.regels.find((r) => r.persistentieId === 25)!.regel.jaarbedrag.toString()).toBe("1234.5678");
  });

  it("`null` als er nog geen frozen output is — nooit een default/leeg resultaat", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesFrozenNietVerrekenbareBtwResultaat(db, versie.id)).toBeNull();
  });

  it("17. faalt vóór elke schrijfactie als de versie geen CONCEPT is (vastgestelde Begroting blijft immutable)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    markeerVastgesteld(db, versie.id, new Date("2026-09-29T00:00:00.000Z"));
    expect(() => schrijfFrozenNietVerrekenbareBtwResultaat(db, versie.id, berekenMetIds([], []))).toThrow(/VASTGESTELD/);
  });

  it("frozen tabellen zijn na vaststellen VASTGESTELD-immutable (triggers)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfFrozenNietVerrekenbareBtwResultaat(db, versie.id, berekenMetIds([regelInvoer()], [1]));
    markeerVastgesteld(db, versie.id, new Date("2026-09-29T00:00:00.000Z"));
    expect(() => db.exec(`UPDATE begroting_frozen_niet_verrekenbare_btw_resultaat SET module_totaal = '999' WHERE begroting_versie_id = '${versie.id}'`)).toThrow(/VASTGESTELD/);
    expect(() => db.exec(`DELETE FROM begroting_frozen_niet_verrekenbare_btw_regel WHERE begroting_versie_id = '${versie.id}'`)).toThrow(/VASTGESTELD/);
  });
});
