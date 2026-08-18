import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leesGrootboekMapping } from "./grootboekmapping.js";
import { grootboekmappingPad, grootboekmappingenDir } from "./paths.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-grootboekmapping-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("leesGrootboekMapping", () => {
  it("gooit een duidelijke fout als er nog geen mapping is voor deze administratie (geen stilzwijgende fallback)", () => {
    expect(() => leesGrootboekMapping(root, "070_rooisezoom")).toThrow(/Grootboekmapping ontbreekt/);
  });

  it("laadt en valideert een bestaande mapping", () => {
    mkdirSync(grootboekmappingenDir(root), { recursive: true });
    writeFileSync(
      grootboekmappingPad(root, "070_rooisezoom"),
      JSON.stringify({
        versie: "0.1",
        administratieId: "070_rooisezoom",
        regels: [
          { grootboekrekening: "4000", soort: "RESULTAAT", rapportagepost: "Beheerkosten", rapportagecategorie: "Kosten", tekenconventie: null, actief: true, status: "VOORGESTELD" },
          { grootboekrekening: "1010", soort: "BALANS", actief: true, status: "VOORGESTELD" },
        ],
      }),
      "utf-8",
    );

    const mapping = leesGrootboekMapping(root, "070_rooisezoom");
    expect(mapping.regels).toHaveLength(2);
    const resultaatRegel = mapping.regels.find((r) => r.soort === "RESULTAAT");
    expect(resultaatRegel).toMatchObject({ rapportagepost: "Beheerkosten" });
  });

  it("faalt hard op een ongeldig mappingbestand, geen stilzwijgende correctie", () => {
    mkdirSync(grootboekmappingenDir(root), { recursive: true });
    writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify({ versie: "0.1" }), "utf-8");

    expect(() => leesGrootboekMapping(root, "070_rooisezoom")).toThrow();
  });

  it("laadt een andere administratie nooit via de mapping van een andere administratie", () => {
    mkdirSync(grootboekmappingenDir(root), { recursive: true });
    writeFileSync(
      grootboekmappingPad(root, "070_rooisezoom"),
      JSON.stringify({ versie: "0.1", administratieId: "070_rooisezoom", regels: [] }),
      "utf-8",
    );

    expect(() => leesGrootboekMapping(root, "074_fergagne")).toThrow(/Grootboekmapping ontbreekt/);
  });
});
