import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenBegroteBeheersvergoeding, berekenBegroteHuuropbrengsten, type BgBeheerComplexConfig } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesModule1Aannames, schrijfModule1Aannames } from "./module1Aannames.js";
import { leesModule1Snapshot, schrijfModule1Snapshot } from "./module1Snapshot.js";
import { leesModule2Config, schrijfModule2Config } from "./module2Config.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-m2config-"));
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

const VOLLEDIGE_CONFIG: BgBeheerComplexConfig = {
  complexnummer: "001",
  vastBedragJaar: new Decimal("1200.50"),
  vastIndexatiePercentage: new Decimal("2.5"),
  vastIndexatiedatum: new Date(Date.UTC(2027, 0, 1)),
  variabelPercentage: new Decimal("6"),
};

describe("schrijfModule2Config / leesModule2Config", () => {
  it("23. lege array: round-trip naar een lege array", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule2Config(db, versie.id, []);
    expect(leesModule2Config(db, versie.id)).toEqual([]);
  });

  it("24. één volledige config: exact round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule2Config(db, versie.id, [VOLLEDIGE_CONFIG]);
    expect(leesModule2Config(db, versie.id)).toEqual([VOLLEDIGE_CONFIG]);
  });

  it("25. alle nullable velden: exact NULL round-trip (null blijft null, niet 0)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const legeConfig: BgBeheerComplexConfig = {
      complexnummer: "002",
      vastBedragJaar: null,
      vastIndexatiePercentage: null,
      vastIndexatiedatum: null,
      variabelPercentage: null,
    };
    schrijfModule2Config(db, versie.id, [legeConfig]);

    const gelezen = leesModule2Config(db, versie.id)[0]!;
    expect(gelezen.vastBedragJaar).toBeNull();
    expect(gelezen.vastIndexatiePercentage).toBeNull();
    expect(gelezen.vastIndexatiedatum).toBeNull();
    expect(gelezen.variabelPercentage).toBeNull();
  });

  it("26. vastIndexatiedatum: exacte UTC-kalenderdag round-trip, kale YYYY-MM-DD in de database", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule2Config(db, versie.id, [{ ...VOLLEDIGE_CONFIG, vastIndexatiedatum: new Date(Date.UTC(2027, 6, 1, 13, 45)) }]);

    const ruweRij = db.prepare(`SELECT vast_indexatiedatum FROM begroting_complex_config WHERE begroting_versie_id = ?`).get(versie.id) as {
      vast_indexatiedatum: string;
    };
    expect(ruweRij.vast_indexatiedatum).toBe("2027-07-01"); // kaal, geen tijdstip

    const gelezen = leesModule2Config(db, versie.id)[0]!.vastIndexatiedatum!;
    expect(gelezen).toEqual(new Date(Date.UTC(2027, 6, 1)));
  });

  it("27. Decimal TEXT voor alle Decimal-velden, geen number-conversie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule2Config(db, versie.id, [
      { ...VOLLEDIGE_CONFIG, vastBedragJaar: new Decimal("12345.6789"), variabelPercentage: new Decimal("6.123456") },
    ]);

    const ruweRij = db
      .prepare(
        `SELECT vast_bedrag_jaar, typeof(vast_bedrag_jaar) AS type_bedrag, variabel_percentage, typeof(variabel_percentage) AS type_variabel
         FROM begroting_complex_config WHERE begroting_versie_id = ?`,
      )
      .get(versie.id) as { vast_bedrag_jaar: string; type_bedrag: string; variabel_percentage: string; type_variabel: string };
    expect(ruweRij.type_bedrag).toBe("text");
    expect(ruweRij.type_variabel).toBe("text");
    expect(ruweRij.vast_bedrag_jaar).toBe("12345.6789");
    expect(ruweRij.variabel_percentage).toBe("6.123456");
  });

  it("28. meerdere configs voor hetzelfde complex worden ALLEMAAL bewaard (geen DB-uniciteitsdwang)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule2Config(db, versie.id, [
      { ...VOLLEDIGE_CONFIG, complexnummer: "001", variabelPercentage: new Decimal(2) },
      { ...VOLLEDIGE_CONFIG, complexnummer: "001", variabelPercentage: new Decimal(6) }, // zelfde complex, tweede (conflicterende) config
    ]);

    const gelezen = leesModule2Config(db, versie.id);
    expect(gelezen).toHaveLength(2);
    expect(gelezen.every((c) => c.complexnummer === "001")).toBe(true);
    expect(gelezen.map((c) => c.variabelPercentage!.toString()).sort()).toEqual(["2", "6"]);
  });

  it("29. replace verwijdert de oude set volledig", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule2Config(db, versie.id, [{ ...VOLLEDIGE_CONFIG, complexnummer: "001" }]);
    schrijfModule2Config(db, versie.id, [{ ...VOLLEDIGE_CONFIG, complexnummer: "999" }]);

    const gelezen = leesModule2Config(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]!.complexnummer).toBe("999");
  });

  it("30. fout midden in replace: volledige rollback naar de vorige set", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule2Config(db, versie.id, [{ ...VOLLEDIGE_CONFIG, complexnummer: "001" }]);

    // Bewust corrupt: complexnummer=null omzeilt de TS-typing, forceert een échte NOT NULL-fout
    // MIDDEN in de INSERT-lus (ná een eerder geslaagde INSERT binnen dezelfde poging).
    const kapotteConfig = { ...VOLLEDIGE_CONFIG, complexnummer: null as unknown as string };

    expect(() => schrijfModule2Config(db, versie.id, [{ ...VOLLEDIGE_CONFIG, complexnummer: "999" }, kapotteConfig])).toThrow();

    const naMislukking = leesModule2Config(db, versie.id);
    expect(naMislukking).toHaveLength(1);
    expect(naMislukking[0]!.complexnummer).toBe("001"); // exact de vorige set, ongewijzigd
  });

  it("31. VASTGESTELD is immutable, zowel via de API als via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule2Config(db, versie.id, [VOLLEDIGE_CONFIG]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => schrijfModule2Config(db, versie.id, [{ ...VOLLEDIGE_CONFIG, complexnummer: "999" }])).toThrow(/VASTGESTELD/);

    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_complex_config (begroting_versie_id, complexnummer, vast_bedrag_jaar, vast_indexatie_percentage, vast_indexatiedatum, variabel_percentage)
           VALUES (?, '999', NULL, NULL, NULL, NULL)`,
        )
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`UPDATE begroting_complex_config SET variabel_percentage = '999' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_complex_config WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(/immutable/);
  });

  it("32. verwijderen van een CONCEPT-versie cascadeert de complexconfiguratie volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule2Config(db, versie.id, [VOLLEDIGE_CONFIG]);

    verwijderConceptVersie(db, versie.id);

    expect(db.prepare(`SELECT 1 FROM begroting_complex_config WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
  });

  it("34. gelezen Module-2-config werkt rechtstreeks als invoer van de échte berekenBegroteBeheersvergoeding, samen met een geldig Module-1-resultaat", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule2Config(db, versie.id, [VOLLEDIGE_CONFIG]);

    const module1Resultaat = berekenBegroteHuuropbrengsten(
      leesModule1Snapshot(db, versie.id),
      [],
      leesModule1Aannames(db, versie.id)!,
      versie.bronPeildatum,
    );
    const configs = leesModule2Config(db, versie.id);

    expect(() => berekenBegroteBeheersvergoeding(module1Resultaat, configs)).not.toThrow();
  });
});
