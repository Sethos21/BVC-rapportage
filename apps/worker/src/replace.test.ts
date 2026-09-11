import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vervangBron } from "./replace.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, auditGedeeldPad, bronGedeeldDir, administratieAuditPad } from "./paths.js";
import { boekingenFixtureRijen, schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-replace-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "002_fergagne"), { recursive: true });
  schrijfAdministratieConfig(root, "002_fergagne", nieuweAdministratieConfig("002", "Fergagne bv"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("vervangBron — gedeelde bron", () => {
  it("vervangt het canonieke bestand atomisch bij een geldige import en schrijft een GESLAAGD-auditregel", () => {
    const kandidaat = join(root, "kandidaat-boekingen.xlsx");
    schrijfXlsxFixture(kandidaat, boekingenFixtureRijen());

    const resultaat = vervangBron({
      root, bronType: "boekingen", doel: { type: "gedeeld" }, kandidaatBestandspad: kandidaat, gebruiker: "test",
    });

    expect(resultaat.uitkomst).toBe("GESLAAGD");
    expect(existsSync(join(bronGedeeldDir(root), "boekingen.xlsx"))).toBe(true);

    const auditRegels = readFileSync(auditGedeeldPad(root), "utf-8").trim().split("\n").filter(Boolean);
    expect(auditRegels).toHaveLength(1);
    expect(JSON.parse(auditRegels[0]!).uitkomst).toBe("GESLAAGD");
  });

  it("laat het bestaande geldige bestand ONGEWIJZIGD bij een ongeldige import, en blokkeert", () => {
    const canoniekPad = join(bronGedeeldDir(root), "boekingen.xlsx");
    writeFileSync(canoniekPad, "oorspronkelijke-geldige-inhoud");

    const ongeldigeKandidaat = join(root, "kandidaat-ongeldig.xlsx");
    const rijen = boekingenFixtureRijen();
    delete (rijen[0] as Record<string, unknown>)["Boeking_Bedrag_Debet"];
    schrijfXlsxFixture(ongeldigeKandidaat, rijen);

    const resultaat = vervangBron({
      root, bronType: "boekingen", doel: { type: "gedeeld" }, kandidaatBestandspad: ongeldigeKandidaat, gebruiker: "test",
    });

    expect(resultaat.uitkomst).toBe("GEBLOKKEERD");
    expect(readFileSync(canoniekPad, "utf-8")).toBe("oorspronkelijke-geldige-inhoud");

    const auditRegels = readFileSync(auditGedeeldPad(root), "utf-8").trim().split("\n").filter(Boolean);
    expect(JSON.parse(auditRegels[0]!).uitkomst).toBe("GEBLOKKEERD");
  });
});

describe("vervangBron — eigen bron (administratiescheiding)", () => {
  it("weigert een import met een afwijkend Bedrijfsnr zonder het geldige bestand te vervangen", () => {
    const config = nieuweAdministratieConfig("002", "Fergagne bv");
    config.bronlocaties.boekingen = "eigen";
    schrijfAdministratieConfig(root, "002_fergagne", config);

    const kandidaat = join(root, "kandidaat-verkeerd-bedrijf.xlsx");
    schrijfXlsxFixture(kandidaat, boekingenFixtureRijen("999")); // hoort niet bij administratie 002

    const resultaat = vervangBron({
      root, bronType: "boekingen", doel: { type: "eigen", administratieId: "002_fergagne" }, kandidaatBestandspad: kandidaat, gebruiker: "test",
    });

    expect(resultaat.uitkomst).toBe("GEBLOKKEERD");
    expect(resultaat.issues.some((i) => i.bericht.includes("Bedrijfsnr"))).toBe(true);

    const auditRegels = readFileSync(administratieAuditPad(root, "002_fergagne"), "utf-8").trim().split("\n").filter(Boolean);
    expect(JSON.parse(auditRegels[0]!).uitkomst).toBe("GEBLOKKEERD");
  });

  it("accepteert een eigen import waarvan alle rijen bij het juiste Bedrijfsnr horen", () => {
    const config = nieuweAdministratieConfig("002", "Fergagne bv");
    config.bronlocaties.boekingen = "eigen";
    schrijfAdministratieConfig(root, "002_fergagne", config);

    const kandidaat = join(root, "kandidaat-goed.xlsx");
    schrijfXlsxFixture(kandidaat, boekingenFixtureRijen("002"));

    const resultaat = vervangBron({
      root, bronType: "boekingen", doel: { type: "eigen", administratieId: "002_fergagne" }, kandidaatBestandspad: kandidaat, gebruiker: "test",
    });

    expect(resultaat.uitkomst).toBe("GESLAAGD");
  });
});
