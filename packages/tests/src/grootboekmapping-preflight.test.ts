import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGrootboekMapping } from "@bvc/config";
import { presentatiefactorVoorRegel, zoekMappingRegel } from "@bvc/domain";
import { grootboekmappingPad, grootboekmappingenDir, leesGrootboekMapping } from "@bvc/worker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rooiseZoomGrootboekMapping } from "./fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-grootboekmapping-preflight-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("de bevestigde 070_Rooise_Zoom-grootboekmapping (representatieve fixture)", () => {
  it("is zelf geldig volgens het schema (round-trip via JSON, zoals een echt bestand in de data root)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const viaJson: unknown = JSON.parse(JSON.stringify(mapping));
    expect(parseGrootboekMapping(viaJson)).toEqual(mapping);
  });

  it("bevat 14 RESULTAAT- en 15 BALANS-rekeningen, allemaal actief", () => {
    const mapping = rooiseZoomGrootboekMapping();
    expect(mapping.regels).toHaveLength(29);
    expect(mapping.regels.filter((r) => r.soort === "RESULTAAT")).toHaveLength(14);
    expect(mapping.regels.filter((r) => r.soort === "BALANS")).toHaveLength(15);
    expect(mapping.regels.every((r) => r.actief)).toBe(true);
  });

  it("heeft 14 van de 15 BALANS-regels met een bevestigde balanszijde (alleen 1506 Afdrachten BTW nog niet)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const balansRegels = mapping.regels.filter((r) => r.soort === "BALANS");
    const metBalanszijde = balansRegels.filter((r) => r.soort === "BALANS" && r.balanszijde !== null);
    const zonderBalanszijde = balansRegels.filter((r) => r.soort === "BALANS" && r.balanszijde === null);
    expect(metBalanszijde).toHaveLength(14);
    expect(zonderBalanszijde.map((r) => r.grootboekrekening)).toEqual(["1506"]);
  });

  it("heeft 14 van de 15 BALANS-regels met een bevestigde tekenconventie (alleen 1506 Afdrachten BTW nog niet — bewust geen aanname)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const metTekenconventie = mapping.regels.filter((r) => r.soort === "BALANS" && r.tekenconventie !== null);
    const zonderTekenconventie = mapping.regels.filter((r) => r.soort === "BALANS" && r.tekenconventie === null);
    expect(metTekenconventie.map((r) => r.grootboekrekening).sort()).toEqual([
      "0840", "0850", "0901", "0902", "0903", "1010", "1310", "1400", "1410", "1600", "1700", "1711", "1712", "1790",
    ]);
    expect(zonderTekenconventie.map((r) => r.grootboekrekening).sort()).toEqual(["1506"]);
  });

  it("is GOEDGEKEURD voor alle RESULTAAT-regels; voor BALANS-regels alleen als ZOWEL balanszijde als tekenconventie bevestigd zijn", () => {
    const mapping = rooiseZoomGrootboekMapping();
    expect(mapping.regels.filter((r) => r.soort === "RESULTAAT").every((r) => r.status === "GOEDGEKEURD")).toBe(true);
    const balansRegels = mapping.regels.filter((r) => r.soort === "BALANS");
    for (const regel of balansRegels) {
      if (regel.soort !== "BALANS") continue;
      const volledigBevestigd = regel.balanszijde !== null && regel.tekenconventie !== null;
      expect(regel.status).toBe(volledigBevestigd ? "GOEDGEKEURD" : "VOORGESTELD");
    }
  });

  it("kan volledig geladen worden via de echte Worker-loader nadat het bestand in de data root is geplaatst", () => {
    mkdirSync(grootboekmappingenDir(root), { recursive: true });
    writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify(rooiseZoomGrootboekMapping()), "utf-8");

    const geladen = leesGrootboekMapping(root, "070_rooisezoom");
    expect(geladen.regels).toHaveLength(29);
  });

  it("levert een bekende RESULTAAT-regel op voor een bevestigde rekening (bv. 8800 Huuropbrengsten belast)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const resultaat = zoekMappingRegel(mapping.regels, "8800");
    expect(resultaat.type).toBe("bekend");
    if (resultaat.type === "bekend" && resultaat.waarde.soort === "RESULTAAT") {
      expect(resultaat.waarde.rapportagepost).toBe("Huuropbrengsten belast");
    }
  });

  it("levert een bekende BALANS-regel op voor een bevestigde balansrekening (bv. 1010 Bank)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const resultaat = zoekMappingRegel(mapping.regels, "1010");
    expect(resultaat.type).toBe("bekend");
    if (resultaat.type === "bekend") {
      expect(resultaat.waarde.soort).toBe("BALANS");
    }
  });

  it("levert onbekend op voor een rekening die niet in de bevestigde mapping voorkomt (bv. 1300 Debiteuren — nog niet gemapt)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const resultaat = zoekMappingRegel(mapping.regels, "1300");
    expect(resultaat.type).toBe("onbekend");
  });

  it("geeft factor 1 (ZOALS_BRON) voor de kostenrekeningen (4xxx)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const kostenregels = mapping.regels.filter((r) => r.soort === "RESULTAAT" && r.rapportagecategorie === "Kosten");
    expect(kostenregels).toHaveLength(10);
    for (const regel of kostenregels) {
      if (regel.soort !== "RESULTAAT") continue;
      expect(presentatiefactorVoorRegel(regel)).toEqual({ type: "bekend", waarde: 1 });
    }
  });

  it("geeft factor -1 (OMGEKEERD) voor de opbrengstrekeningen (8xxx)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const opbrengstregels = mapping.regels.filter((r) => r.soort === "RESULTAAT" && r.rapportagecategorie === "Opbrengsten");
    expect(opbrengstregels).toHaveLength(4);
    for (const regel of opbrengstregels) {
      if (regel.soort !== "RESULTAAT") continue;
      expect(presentatiefactorVoorRegel(regel)).toEqual({ type: "bekend", waarde: -1 });
    }
  });
});
