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

  it("bevat alle 14 bevestigde rekeningen, elk actief en GOEDGEKEURD", () => {
    const mapping = rooiseZoomGrootboekMapping();
    expect(mapping.regels).toHaveLength(14);
    expect(mapping.regels.every((r) => r.actief && r.status === "GOEDGEKEURD")).toBe(true);
  });

  it("kan volledig geladen worden via de echte Worker-loader nadat het bestand in de data root is geplaatst", () => {
    mkdirSync(grootboekmappingenDir(root), { recursive: true });
    writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify(rooiseZoomGrootboekMapping()), "utf-8");

    const geladen = leesGrootboekMapping(root, "070_rooisezoom");
    expect(geladen.regels).toHaveLength(14);
  });

  it("levert een bekende regel op voor een bevestigde rekening (bv. 8800 Huuropbrengsten belast)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const resultaat = zoekMappingRegel(mapping.regels, "8800");
    expect(resultaat.type).toBe("bekend");
    if (resultaat.type === "bekend") {
      expect(resultaat.waarde.rapportagepost).toBe("Huuropbrengsten belast");
    }
  });

  it("levert onbekend op voor een rekening die niet in de bevestigde mapping voorkomt (bv. 1300 Bank — een balansrekening, nog niet gemapt)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const resultaat = zoekMappingRegel(mapping.regels, "1300");
    expect(resultaat.type).toBe("onbekend");
  });

  it("geeft factor 1 (ZOALS_BRON) voor de kostenrekeningen (4xxx)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const kostenregels = mapping.regels.filter((r) => r.rapportagecategorie === "Kosten");
    expect(kostenregels).toHaveLength(10);
    for (const regel of kostenregels) {
      expect(presentatiefactorVoorRegel(regel)).toEqual({ type: "bekend", waarde: 1 });
    }
  });

  it("geeft factor -1 (OMGEKEERD) voor de opbrengstrekeningen (8xxx)", () => {
    const mapping = rooiseZoomGrootboekMapping();
    const opbrengstregels = mapping.regels.filter((r) => r.rapportagecategorie === "Opbrengsten");
    expect(opbrengstregels).toHaveLength(4);
    for (const regel of opbrengstregels) {
      expect(presentatiefactorVoorRegel(regel)).toEqual({ type: "bekend", waarde: -1 });
    }
  });
});
