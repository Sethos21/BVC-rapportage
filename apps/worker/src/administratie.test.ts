import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdministratieBestaatAlError, initAdministratie, leesAdministratieConfig, lijstAdministraties } from "./administratie.js";
import { administratiesDir } from "./paths.js";

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

describe("lijstAdministraties", () => {
  it("geeft een lege lijst als administraties/ nog niet bestaat", () => {
    expect(lijstAdministraties(root)).toEqual([]);
  });

  it("leest administraties dynamisch uit administraties/, gesorteerd op weergavenaam", () => {
    initAdministratie(root, "070_Rooise_Zoom", "070", "Rooise Zoom");
    initAdministratie(root, "074_Fergagne", "074", "Fergagne BV");

    const lijst = lijstAdministraties(root);
    expect(lijst).toEqual([
      { administratieId: "074_Fergagne", bedrijfsnr: "074", weergavenaam: "Fergagne BV" },
      { administratieId: "070_Rooise_Zoom", bedrijfsnr: "070", weergavenaam: "Rooise Zoom" },
    ]);
  });

  it("slaat een submap zonder geldige administratie.json over, zonder de rest te blokkeren", () => {
    initAdministratie(root, "070_Rooise_Zoom", "070", "Rooise Zoom");
    mkdirSync(join(administratiesDir(root), "leeg_zonder_config"), { recursive: true });

    expect(lijstAdministraties(root)).toEqual([{ administratieId: "070_Rooise_Zoom", bedrijfsnr: "070", weergavenaam: "Rooise Zoom" }]);
  });
});
