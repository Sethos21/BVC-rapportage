import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBron, resolveAlleBronnen } from "./sourceResolver.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-resolver-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  const config = nieuweAdministratieConfig("002", "Fergagne bv");
  mkdirSync(administratieDir(root, "002_fergagne"), { recursive: true });
  schrijfAdministratieConfig(root, "002_fergagne", config);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveBron", () => {
  it("resolveert naar bron_gedeeld/ voor een brontype op 'gedeeld' (standaard)", () => {
    const resolutie = resolveBron(root, "002_fergagne", "boekingen");
    expect(resolutie.locatie).toBe("gedeeld");
    expect(resolutie.pad).toContain("bron_gedeeld");
  });

  it("meldt 'Bron ontbreekt' (bestaat: false) i.p.v. uit te wijken naar de andere locatie", () => {
    const resolutie = resolveBron(root, "002_fergagne", "boekingen");
    expect(resolutie.bestaat).toBe(false);
  });

  it("resolveert naar de eigen bronmap voor begroting (standaard 'eigen')", () => {
    const resolutie = resolveBron(root, "002_fergagne", "begroting");
    expect(resolutie.locatie).toBe("eigen");
    expect(resolutie.pad).toContain(join("002_fergagne", "bron"));
  });

  it("negeert een gedeeld bestand van hetzelfde brontype wanneer de administratie op 'eigen' staat, en omgekeerd", () => {
    // Zet een boekingen.xlsx zowel gedeeld als (per ongeluk) eigen neer.
    writeFileSync(join(bronGedeeldDir(root), "boekingen.xlsx"), "gedeeld-inhoud");
    const config = nieuweAdministratieConfig("002", "Fergagne bv");
    config.bronlocaties.boekingen = "eigen";
    schrijfAdministratieConfig(root, "002_fergagne", config);
    mkdirSync(join(administratieDir(root, "002_fergagne"), "bron"), { recursive: true });
    writeFileSync(join(administratieDir(root, "002_fergagne"), "bron", "boekingen.xlsx"), "eigen-inhoud");

    const resolutie = resolveBron(root, "002_fergagne", "boekingen");
    expect(resolutie.locatie).toBe("eigen");
    expect(resolutie.pad).toContain(join("002_fergagne", "bron"));
    // Nooit allebei combineren — er is precies één resolutie, geen samenvoeging.
  });

  it("resolveAlleBronnen geeft voor elk canoniek brontype precies één resolutie", () => {
    const resoluties = resolveAlleBronnen(root, "002_fergagne");
    const bronTypes = resoluties.map((r) => r.bronType);
    expect(new Set(bronTypes).size).toBe(bronTypes.length);
  });
});
