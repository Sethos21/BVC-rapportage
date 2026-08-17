import type { GrootboekMappingRegel } from "@bvc/config";
import { describe, expect, it } from "vitest";
import { presentatiefactorVoorRegel, zoekMappingRegel } from "./grootboekmapping.js";

function regel(overrides: Partial<GrootboekMappingRegel> = {}): GrootboekMappingRegel {
  return {
    grootboekrekening: "4000",
    rapportagepost: "Beheerkosten",
    rapportagecategorie: "Kosten",
    tekenconventie: null,
    actief: true,
    status: "VOORGESTELD",
    ...overrides,
  };
}

describe("zoekMappingRegel", () => {
  it("vindt een actieve regel op grootboekrekening", () => {
    const resultaat = zoekMappingRegel([regel()], "4000");
    expect(resultaat.type).toBe("bekend");
    if (resultaat.type === "bekend") {
      expect(resultaat.waarde.rapportagepost).toBe("Beheerkosten");
    }
  });

  it("is onbekend voor een niet-gemapte grootboekrekening (nooit een default aannemen)", () => {
    const resultaat = zoekMappingRegel([regel()], "9999");
    expect(resultaat.type).toBe("onbekend");
    if (resultaat.type === "onbekend") {
      expect(resultaat.reden).toContain("9999");
    }
  });

  it("is onbekend voor een inactieve mapping, ook al bestaat de regel", () => {
    const resultaat = zoekMappingRegel([regel({ actief: false })], "4000");
    expect(resultaat.type).toBe("onbekend");
    if (resultaat.type === "onbekend") {
      expect(resultaat.reden).toContain("inactieve mapping");
    }
  });
});

describe("presentatiefactorVoorRegel", () => {
  it("geeft 1 voor ZOALS_BRON", () => {
    const resultaat = presentatiefactorVoorRegel({ tekenconventie: "ZOALS_BRON" });
    expect(resultaat).toEqual({ type: "bekend", waarde: 1 });
  });

  it("geeft -1 voor OMGEKEERD", () => {
    const resultaat = presentatiefactorVoorRegel({ tekenconventie: "OMGEKEERD" });
    expect(resultaat).toEqual({ type: "bekend", waarde: -1 });
  });

  it("is onbekend bij een nog niet bevestigde tekenconventie (null), verzint geen factor", () => {
    const resultaat = presentatiefactorVoorRegel({ tekenconventie: null });
    expect(resultaat.type).toBe("onbekend");
  });
});
