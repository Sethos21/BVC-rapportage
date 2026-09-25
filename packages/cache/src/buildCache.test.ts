import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCache } from "./buildCache.js";
import { openCacheReadonly } from "./openCache.js";
import { EMPTY_CACHE_DATA, type CacheData } from "./rows.js";

let dir: string;
let cachePad: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-cache-pkg-"));
  cachePad = join(dir, "cache.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("buildCache + openCacheReadonly", () => {
  it("bouwt een cache-bestand op en levert de ingevoerde rijen terug", () => {
    const data: CacheData = {
      ...EMPTY_CACHE_DATA,
      boekingen: [
        {
          bedrijfsnr: "002", boekjaar: 2024, boekperiode: "01", dagboeknr: "20", boekstuknr: "024001", volgnr: "000001",
          boekstuk_sleutel: "0024001", boekdatum: "2024-01-01T00:00:00.000Z", grootboeknr: "1010", kostenplaatsnr: null,
          complexnr: null, unitnr: null, contractnr: null, huurdernr: null, bedrag_debet: "100.00", bedrag_credit: "0",
          saldo: "100.00", omschrijving: "test", grootboek_a: "1010", grootboek_b: "1010",
        },
      ],
    };

    const resultaat = buildCache(cachePad, data);
    expect(resultaat.rowCounts.boekingen).toBe(1);

    const db = openCacheReadonly(cachePad);
    const rijen = db.prepare("SELECT bedrijfsnr, bedrag_debet, saldo FROM boekingen").all();
    db.close();
    expect(rijen).toEqual([{ bedrijfsnr: "002", bedrag_debet: "100.00", saldo: "100.00" }]);
  });

  it("vervangt een bestaande cache atomisch — nooit een half-geschreven bestand zichtbaar", () => {
    buildCache(cachePad, EMPTY_CACHE_DATA);
    const tweedeData: CacheData = {
      ...EMPTY_CACHE_DATA,
      units: [
        { bedrijfsnr: "002", complexnummer: "001", unitnummer: "0001", unit_non_actief: null, unitomschrijving: "test", unitsoort: null, unit_vvo: null, unit_bvo: null, unit_adres: null, unit_postcode: null, unit_plaats: null },
      ],
    };
    buildCache(cachePad, tweedeData);

    const db = openCacheReadonly(cachePad);
    const rijen = db.prepare("SELECT unitnummer FROM units").all();
    db.close();
    expect(rijen).toEqual([{ unitnummer: "0001" }]);
  });

  it("gooit een duidelijke fout bij het openen van een niet-bestaande cache i.p.v. stil leeg te lijken", () => {
    expect(() => openCacheReadonly(join(dir, "bestaat-niet.sqlite"))).toThrow(/Cache ontbreekt/);
  });
});
