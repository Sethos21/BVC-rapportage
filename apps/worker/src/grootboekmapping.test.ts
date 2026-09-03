import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leesGrootboekMapping } from "./grootboekmapping.js";
import { configDir, grootboekmappingMasterPad, grootboekmappingPad, grootboekmappingenDir } from "./paths.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-grootboekmapping-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("leesGrootboekMapping", () => {
  it("gooit een duidelijke fout als er geen master en geen override is voor deze administratie", () => {
    expect(() => leesGrootboekMapping(root, "070_rooisezoom")).toThrow(/Grootboekmapping ontbreekt/);
  });

  it("laadt en valideert een override zonder master (master ontbreekt = leeg behandeld)", () => {
    mkdirSync(grootboekmappingenDir(root), { recursive: true });
    writeFileSync(
      grootboekmappingPad(root, "070_rooisezoom"),
      JSON.stringify({
        versie: "0.1",
        administratieId: "070_rooisezoom",
        regels: [
          { grootboekrekening: "4000", soort: "RESULTAAT", rapportagepost: "Beheerkosten", rapportagecategorie: "Kosten", tekenconventie: null, kasstroomCategorie: null, actief: true, status: "VOORGESTELD" },
          { grootboekrekening: "1010", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", liquideMiddelen: null, kasstroomCategorie: null, actief: true, status: "VOORGESTELD" },
        ],
      }),
      "utf-8",
    );

    const mapping = leesGrootboekMapping(root, "070_rooisezoom");
    expect(mapping.regels).toHaveLength(2);
    const resultaatRegel = mapping.regels.find((r) => r.soort === "RESULTAAT");
    expect(resultaatRegel).toMatchObject({ rapportagepost: "Beheerkosten" });
  });

  it("laadt een master zonder override (administratie leunt volledig op de master)", () => {
    mkdirSync(configDir(root), { recursive: true });
    writeFileSync(
      grootboekmappingMasterPad(root),
      JSON.stringify({
        versie: "0.1",
        regels: [{ grootboekrekening: "4130", soort: "RESULTAAT", rapportagepost: "Verzekeringen", rapportagecategorie: "Kosten", tekenconventie: "ZOALS_BRON", kasstroomCategorie: null, actief: true, status: "VOORGESTELD" }],
      }),
      "utf-8",
    );

    const mapping = leesGrootboekMapping(root, "070_rooisezoom");
    expect(mapping.regels).toHaveLength(1);
    expect(mapping.regels[0]).toMatchObject({ grootboekrekening: "4130" });
  });

  it("laat de administratie-override een master-regel overschrijven voor dezelfde rekening", () => {
    mkdirSync(configDir(root), { recursive: true });
    mkdirSync(grootboekmappingenDir(root), { recursive: true });
    writeFileSync(
      grootboekmappingMasterPad(root),
      JSON.stringify({
        versie: "0.1",
        regels: [{ grootboekrekening: "4000", soort: "RESULTAAT", rapportagepost: "Master-versie", rapportagecategorie: "Kosten", tekenconventie: null, kasstroomCategorie: null, actief: true, status: "VOORGESTELD" }],
      }),
      "utf-8",
    );
    writeFileSync(
      grootboekmappingPad(root, "070_rooisezoom"),
      JSON.stringify({
        versie: "0.1",
        administratieId: "070_rooisezoom",
        regels: [{ grootboekrekening: "4000", soort: "RESULTAAT", rapportagepost: "Override-versie", rapportagecategorie: "Kosten", tekenconventie: "ZOALS_BRON", kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" }],
      }),
      "utf-8",
    );

    const mapping = leesGrootboekMapping(root, "070_rooisezoom");
    expect(mapping.regels).toHaveLength(1);
    expect(mapping.regels[0]).toMatchObject({ rapportagepost: "Override-versie", status: "GOEDGEKEURD" });
  });

  it("combineert master- en override-regels voor verschillende rekeningen", () => {
    mkdirSync(configDir(root), { recursive: true });
    mkdirSync(grootboekmappingenDir(root), { recursive: true });
    writeFileSync(
      grootboekmappingMasterPad(root),
      JSON.stringify({
        versie: "0.1",
        regels: [{ grootboekrekening: "4130", soort: "RESULTAAT", rapportagepost: "Verzekeringen", rapportagecategorie: "Kosten", tekenconventie: "ZOALS_BRON", kasstroomCategorie: null, actief: true, status: "VOORGESTELD" }],
      }),
      "utf-8",
    );
    writeFileSync(
      grootboekmappingPad(root, "070_rooisezoom"),
      JSON.stringify({
        versie: "0.1",
        administratieId: "070_rooisezoom",
        regels: [{ grootboekrekening: "8815", soort: "RESULTAAT", rapportagepost: "Zonnestroom", rapportagecategorie: "Opbrengsten", tekenconventie: "OMGEKEERD", kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" }],
      }),
      "utf-8",
    );

    const mapping = leesGrootboekMapping(root, "070_rooisezoom");
    expect(mapping.regels.map((r) => r.grootboekrekening).sort()).toEqual(["4130", "8815"]);
  });

  it("faalt hard op een ongeldig override-bestand, geen stilzwijgende correctie", () => {
    mkdirSync(grootboekmappingenDir(root), { recursive: true });
    writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify({ versie: "0.1" }), "utf-8");

    expect(() => leesGrootboekMapping(root, "070_rooisezoom")).toThrow();
  });

  it("faalt hard op een ongeldig master-bestand, geen stilzwijgende correctie", () => {
    mkdirSync(configDir(root), { recursive: true });
    writeFileSync(grootboekmappingMasterPad(root), JSON.stringify({ versie: "0.1" }), "utf-8");

    expect(() => leesGrootboekMapping(root, "070_rooisezoom")).toThrow();
  });

  it("laadt een andere administratie nooit via de override van een andere administratie", () => {
    mkdirSync(grootboekmappingenDir(root), { recursive: true });
    writeFileSync(
      grootboekmappingPad(root, "070_rooisezoom"),
      JSON.stringify({ versie: "0.1", administratieId: "070_rooisezoom", regels: [] }),
      "utf-8",
    );

    expect(() => leesGrootboekMapping(root, "074_fergagne")).toThrow(/Grootboekmapping ontbreekt/);
  });
});
