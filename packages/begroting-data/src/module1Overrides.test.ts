import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BgContractOverride } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesModule1Overrides, schrijfModule1Overrides } from "./module1Overrides.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-overrides-"));
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

describe("schrijfModule1Overrides / leesModule1Overrides", () => {
  it("12. lege array: round-trip naar een lege array", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Overrides(db, versie.id, []);
    expect(leesModule1Overrides(db, versie.id)).toEqual([]);
  });

  it("13. één override: exact round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const override: BgContractOverride = { contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "STRUCTUREEL", reden: "Onderhandeld" };
    schrijfModule1Overrides(db, versie.id, [override]);
    expect(leesModule1Overrides(db, versie.id)).toEqual([override]);
  });

  it("14. scope VERSIE: round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const override: BgContractOverride = { contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "VERSIE" };
    schrijfModule1Overrides(db, versie.id, [override]);
    expect(leesModule1Overrides(db, versie.id)[0]!.scope).toBe("VERSIE");
  });

  it("15. scope STRUCTUREEL: round-trip", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const override: BgContractOverride = { contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "STRUCTUREEL" };
    schrijfModule1Overrides(db, versie.id, [override]);
    expect(leesModule1Overrides(db, versie.id)[0]!.scope).toBe("STRUCTUREEL");
  });

  it("16. reden: round-trip volgens de exacte HEAD-semantiek (optioneel veld, geen string|null)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Overrides(db, versie.id, [
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "VERSIE", reden: "Onderhandeld" },
      { contractnummer: "0000000029", indexatiePercentage: new Decimal(4), scope: "VERSIE" }, // reden NIET opgegeven
    ]);

    const gelezen = leesModule1Overrides(db, versie.id);
    const metReden = gelezen.find((o) => o.contractnummer === "0000000028")!;
    const zonderReden = gelezen.find((o) => o.contractnummer === "0000000029")!;

    expect(metReden.reden).toBe("Onderhandeld");
    // De sleutel `reden` mag hier NIET aanwezig zijn (niet op `undefined` gezet) — exact de
    // "weggelaten"-semantiek van het optionele `reden?: string`-veld op HEAD, niet `null`/`undefined`-als-waarde.
    expect("reden" in zonderReden).toBe(false);
  });

  it("17. Decimal-precisie blijft behouden (meer dan 2 decimalen, geen number-conversie)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const precisiePercentage = new Decimal("4.123456789");
    schrijfModule1Overrides(db, versie.id, [{ contractnummer: "0000000028", indexatiePercentage: precisiePercentage, scope: "VERSIE" }]);

    const ruweRij = db
      .prepare(`SELECT indexatie_percentage, typeof(indexatie_percentage) AS type FROM begroting_contract_override WHERE begroting_versie_id = ?`)
      .get(versie.id) as { indexatie_percentage: string; type: string };
    expect(ruweRij.type).toBe("text");
    expect(ruweRij.indexatie_percentage).toBe("4.123456789");
    expect(leesModule1Overrides(db, versie.id)[0]!.indexatiePercentage.equals(precisiePercentage)).toBe(true);
  });

  it("18. meerdere overrides voor hetzelfde contract worden ALLEMAAL bewaard (geen DB-uniciteitsdwang)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Overrides(db, versie.id, [
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(3), scope: "VERSIE" },
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "VERSIE" }, // zelfde contract, tweede (conflicterende) override
    ]);

    const gelezen = leesModule1Overrides(db, versie.id);
    expect(gelezen).toHaveLength(2);
    expect(gelezen.every((o) => o.contractnummer === "0000000028")).toBe(true);
    expect(gelezen.map((o) => o.indexatiePercentage.toString()).sort()).toEqual(["3", "5"]);
  });

  it("19. replace verwijdert de oude set volledig", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Overrides(db, versie.id, [{ contractnummer: "0000000028", indexatiePercentage: new Decimal(3), scope: "VERSIE" }]);
    schrijfModule1Overrides(db, versie.id, [{ contractnummer: "0000000099", indexatiePercentage: new Decimal(6), scope: "VERSIE" }]);

    const gelezen = leesModule1Overrides(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]!.contractnummer).toBe("0000000099");
  });

  it("20. fout midden in replace: volledige rollback naar de vorige set", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Overrides(db, versie.id, [{ contractnummer: "0000000028", indexatiePercentage: new Decimal(3), scope: "VERSIE" }]);

    // Bewust corrupt: contractnummer=null omzeilt de TS-typing, forceert een échte NOT NULL-fout
    // MIDDEN in de INSERT-lus (ná een eerder geslaagde INSERT binnen dezelfde poging).
    const kapotteOverride = { contractnummer: null as unknown as string, indexatiePercentage: new Decimal(1), scope: "VERSIE" as const };

    expect(() =>
      schrijfModule1Overrides(db, versie.id, [
        { contractnummer: "0000000099", indexatiePercentage: new Decimal(9), scope: "VERSIE" },
        kapotteOverride,
      ]),
    ).toThrow();

    const naMislukking = leesModule1Overrides(db, versie.id);
    expect(naMislukking).toHaveLength(1);
    expect(naMislukking[0]!.contractnummer).toBe("0000000028"); // exact de vorige set, ongewijzigd
  });

  it("21. VASTGESTELD is immutable, zowel via de API als via directe SQL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Overrides(db, versie.id, [{ contractnummer: "0000000028", indexatiePercentage: new Decimal(3), scope: "VERSIE" }]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() =>
      schrijfModule1Overrides(db, versie.id, [{ contractnummer: "0000000099", indexatiePercentage: new Decimal(1), scope: "VERSIE" }]),
    ).toThrow(/VASTGESTELD/);

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_contract_override (begroting_versie_id, contractnummer, indexatie_percentage, scope, reden) VALUES (?, '0000000099', '1', 'VERSIE', NULL)`)
        .run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`UPDATE begroting_contract_override SET indexatie_percentage = '999' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_contract_override WHERE begroting_versie_id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
  });

  it("22. verwijderen van een CONCEPT-versie cascadeert de overrides volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Overrides(db, versie.id, [{ contractnummer: "0000000028", indexatiePercentage: new Decimal(3), scope: "VERSIE" }]);

    verwijderConceptVersie(db, versie.id);

    expect(db.prepare(`SELECT 1 FROM begroting_contract_override WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
  });
});
