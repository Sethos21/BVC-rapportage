import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STANDAARD_PARAMETERS } from "@bvc/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { laadBeheerparameters } from "./parameters.js";
import { parametersPad } from "./paths.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-parameters-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("laadBeheerparameters", () => {
  it("valt terug op STANDAARD_PARAMETERS als er geen parameters.json in de data root staat", () => {
    expect(laadBeheerparameters(root)).toEqual(STANDAARD_PARAMETERS);
  });

  it("leest en valideert een aangepast parameterbestand — nieuwe uitzonderingen zonder codewijziging", () => {
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(
      parametersPad(root),
      JSON.stringify({
        versie: "0.2",
        servicekosten: { uitgeslotenKostensoorten: ["9600", "9601"], serviceafrekeningVarianten: ["afrekening"] },
      }),
    );
    const parameters = laadBeheerparameters(root);
    expect(parameters.servicekosten.uitgeslotenKostensoorten).toEqual(["9600", "9601"]);
  });

  it("faalt hard op een ongeldig parameterbestand (Controle vereist, geen stille fallback)", () => {
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(parametersPad(root), JSON.stringify({ versie: "0.2" }));
    expect(() => laadBeheerparameters(root)).toThrow();
  });
});
