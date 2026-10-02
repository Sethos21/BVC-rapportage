import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExcelBronAdapter } from "./bronAdapter.js";
import { leesRuweRijenMetCache, wisBoekingenParseCacheVoorTests } from "./boekingenParseCache.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";
import type { BronResolutie } from "./sourceResolver.js";

/**
 * Performance-delta — bewijst de drie contractuele eigenschappen van de cache (hergebruik bij
 * ongewijzigde mtime, nieuwe parse bij gewijzigde mtime, geen vervuiling tussen cache-sleutels) en
 * de twee harde beveiligingen (bevroren resultaat, geen corrupte entry na een mislukte poging) —
 * rechtstreeks op dit module, los van de volledige P&L-productieketen (die dekking staat in
 * `genereerPnLPeriode.test.ts`).
 */

let dir: string;
let pad: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-boekingen-parse-cache-"));
  pad = join(dir, "boekingen.xlsx");
  wisBoekingenParseCacheVoorTests();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function bron(overrides: Partial<BronResolutie> = {}): BronResolutie {
  return { bronType: "boekingen", locatie: "gedeeld", pad, bestaat: true, ...overrides };
}

describe("leesRuweRijenMetCache", () => {
  it("1. eerste aanroep parsed het bestand daadwerkelijk", () => {
    schrijfXlsxFixture(pad, [{ Bedrijfsnr: "070" }]);
    const spy = vi.spyOn(ExcelBronAdapter.prototype, "leesRuweRijen");

    const rijen = leesRuweRijenMetCache("070_rooisezoom", bron());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(rijen).toEqual([{ Bedrijfsnr: "070" }]);
  });

  it("2. tweede aanroep, zelfde bestand/mtime: geen nieuwe parse, exact hetzelfde resultaat", () => {
    schrijfXlsxFixture(pad, [{ Bedrijfsnr: "070" }]);
    const spy = vi.spyOn(ExcelBronAdapter.prototype, "leesRuweRijen");

    const eerste = leesRuweRijenMetCache("070_rooisezoom", bron());
    const tweede = leesRuweRijenMetCache("070_rooisezoom", bron());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(tweede).toBe(eerste); // zelfde array-referentie, bewust hergebruikt
  });

  it("3. gewijzigde mtime: nieuwe parse met de nieuwe inhoud", () => {
    schrijfXlsxFixture(pad, [{ Bedrijfsnr: "070" }]);
    const spy = vi.spyOn(ExcelBronAdapter.prototype, "leesRuweRijen");
    leesRuweRijenMetCache("070_rooisezoom", bron());

    schrijfXlsxFixture(pad, [{ Bedrijfsnr: "070" }, { Bedrijfsnr: "070" }]);
    const toekomst = new Date(Date.now() + 5000);
    utimesSync(pad, toekomst, toekomst); // voorkomt flakiness door OS-mtime-afrondingsresolutie

    const rijen = leesRuweRijenMetCache("070_rooisezoom", bron());

    expect(spy).toHaveBeenCalledTimes(2);
    expect(rijen).toHaveLength(2);
  });

  it("4a. administratiescheiding: zelfs bij hetzelfde fysieke bestand (gedeelde bronmodus) krijgt elke administratie haar eigen cache-entry — data wordt nooit tussen administraties hergebruikt", () => {
    schrijfXlsxFixture(pad, [{ Bedrijfsnr: "070" }]);
    const spy = vi.spyOn(ExcelBronAdapter.prototype, "leesRuweRijen");

    leesRuweRijenMetCache("070_rooisezoom", bron());
    const vanAndereAdministratie = leesRuweRijenMetCache("023_malconbeheer", bron());

    expect(spy).toHaveBeenCalledTimes(2); // bewust GEEN gedeelde cache-entry over administraties heen, ook niet bij hetzelfde pad
    expect(vanAndereAdministratie).toEqual([{ Bedrijfsnr: "070" }]);
  });

  it("4b. een ander bestandspad (eigen bronmodus per administratie) krijgt een eigen cache-entry, geen vervuiling", () => {
    schrijfXlsxFixture(pad, [{ Bedrijfsnr: "070" }]);
    const andereDir = mkdtempSync(join(tmpdir(), "bvc-boekingen-parse-cache-2-"));
    const anderPad = join(andereDir, "boekingen.xlsx");
    try {
      schrijfXlsxFixture(anderPad, [{ Bedrijfsnr: "999" }]);
      const spy = vi.spyOn(ExcelBronAdapter.prototype, "leesRuweRijen");

      const regulier = leesRuweRijenMetCache("070_rooisezoom", bron());
      const andereBron = leesRuweRijenMetCache("999_andere", bron({ pad: anderPad }));

      expect(spy).toHaveBeenCalledTimes(2);
      expect(regulier).toEqual([{ Bedrijfsnr: "070" }]);
      expect(andereBron).toEqual([{ Bedrijfsnr: "999" }]);
    } finally {
      rmSync(andereDir, { recursive: true, force: true });
    }
  });

  it("6. het gecachete resultaat is bevroren: een poging tot muteren gooit en vervuilt een volgende aanroep niet", () => {
    schrijfXlsxFixture(pad, [{ Bedrijfsnr: "070" }]);
    const rijen = leesRuweRijenMetCache("070_rooisezoom", bron());

    expect(() => {
      (rijen[0] as Record<string, unknown>)["Bedrijfsnr"] = "GEMANIPULEERD";
    }).toThrow();
    expect(() => {
      (rijen as unknown[]).push({});
    }).toThrow();

    const nogmaals = leesRuweRijenMetCache("070_rooisezoom", bron());
    expect(nogmaals[0]).toEqual({ Bedrijfsnr: "070" });
    expect(nogmaals).toHaveLength(1);
  });

  it("7. een fout tijdens lezen/parsen (ontbrekend bestand) laat geen corrupte cache-entry achter — de eerstvolgende, geldige poging op hetzelfde pad parsed gewoon opnieuw", () => {
    // Bestand bestaat nog niet op `pad` -> readFileSync gooit ENOENT.
    expect(() => leesRuweRijenMetCache("070_rooisezoom", bron())).toThrow();

    schrijfXlsxFixture(pad, [{ Bedrijfsnr: "070" }]);
    const rijen = leesRuweRijenMetCache("070_rooisezoom", bron());

    expect(rijen).toEqual([{ Bedrijfsnr: "070" }]);
  });
});
