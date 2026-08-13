import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdministratieBestaatAlError, initAdministratie, leesAdministratieConfig } from "./administratie.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-administratie-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("initAdministratie", () => {
  it("maakt administratie.json aan met de standaard bronlocaties (alles gedeeld behalve begroting)", () => {
    const config = initAdministratie(root, "070_Fergagne", "070", "Fergagne BV");
    expect(config.bedrijfsnr).toBe("070");
    expect(config.weergavenaam).toBe("Fergagne BV");
    expect(config.bronlocaties.boekingen).toBe("gedeeld");
    expect(config.bronlocaties.units).toBe("gedeeld");
    expect(config.bronlocaties.begroting).toBe("eigen");
  });

  it("is meteen leesbaar via leesAdministratieConfig — geen handmatig JSON nodig", () => {
    initAdministratie(root, "070_Fergagne", "070", "Fergagne BV");
    expect(leesAdministratieConfig(root, "070_Fergagne").bedrijfsnr).toBe("070");
  });

  it("weigert een bestaande administratie te overschrijven", () => {
    initAdministratie(root, "070_Fergagne", "070", "Fergagne BV");
    expect(() => initAdministratie(root, "070_Fergagne", "070", "Andere naam")).toThrow(AdministratieBestaatAlError);
  });
});
