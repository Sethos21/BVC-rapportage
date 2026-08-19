import type { BalansRegel, ResultaatRegel } from "@bvc/config";
import { describe, expect, it } from "vitest";
import { balanszijdeVoorRegel, presentatiefactorVoorRegel, resolveerGrootboekMapping, zoekMappingRegel } from "./grootboekmapping.js";

function regel(overrides: Partial<ResultaatRegel> = {}): ResultaatRegel {
  return {
    grootboekrekening: "4000",
    soort: "RESULTAAT",
    rapportagepost: "Beheerkosten",
    rapportagecategorie: "Kosten",
    tekenconventie: null,
    actief: true,
    status: "VOORGESTELD",
    ...overrides,
  };
}

function balansRegel(overrides: Partial<BalansRegel> = {}): BalansRegel {
  return {
    grootboekrekening: "1010",
    soort: "BALANS",
    balanszijde: "ACTIVA",
    actief: true,
    status: "VOORGESTELD",
    ...overrides,
  };
}

describe("zoekMappingRegel", () => {
  it("vindt een actieve RESULTAAT-regel op grootboekrekening", () => {
    const resultaat = zoekMappingRegel([regel()], "4000");
    expect(resultaat.type).toBe("bekend");
    if (resultaat.type === "bekend" && resultaat.waarde.soort === "RESULTAAT") {
      expect(resultaat.waarde.rapportagepost).toBe("Beheerkosten");
    }
  });

  it("vindt een actieve BALANS-regel op grootboekrekening", () => {
    const resultaat = zoekMappingRegel([balansRegel()], "1010");
    expect(resultaat.type).toBe("bekend");
    if (resultaat.type === "bekend") {
      expect(resultaat.waarde.soort).toBe("BALANS");
    }
  });

  it("is onbekend voor een niet-gemapte grootboekrekening (nooit een default aannemen)", () => {
    const resultaat = zoekMappingRegel([regel()], "9999");
    expect(resultaat.type).toBe("onbekend");
    if (resultaat.type === "onbekend") {
      expect(resultaat.reden).toContain("9999");
    }
  });

  it("is onbekend voor een inactieve RESULTAAT-mapping, ook al bestaat de regel", () => {
    const resultaat = zoekMappingRegel([regel({ actief: false })], "4000");
    expect(resultaat.type).toBe("onbekend");
    if (resultaat.type === "onbekend") {
      expect(resultaat.reden).toContain("inactieve mapping");
    }
  });

  it("is onbekend voor een inactieve BALANS-mapping", () => {
    const resultaat = zoekMappingRegel([balansRegel({ actief: false })], "1010");
    expect(resultaat.type).toBe("onbekend");
    if (resultaat.type === "onbekend") {
      expect(resultaat.reden).toContain("inactieve mapping");
    }
  });
});

describe("resolveerGrootboekMapping", () => {
  it("gebruikt de master-regel als er geen override voor die rekening is", () => {
    const resultaat = resolveerGrootboekMapping([regel({ grootboekrekening: "4130", rapportagepost: "Verzekeringen" })], []);
    expect(resultaat).toHaveLength(1);
    expect(resultaat[0]).toMatchObject({ grootboekrekening: "4130", rapportagepost: "Verzekeringen" });
  });

  it("laat de override winnen voor een rekening die in beide voorkomt", () => {
    const resultaat = resolveerGrootboekMapping(
      [regel({ grootboekrekening: "4000", rapportagepost: "Master-versie" })],
      [regel({ grootboekrekening: "4000", rapportagepost: "Override-versie" })],
    );
    expect(resultaat).toHaveLength(1);
    expect(resultaat[0]).toMatchObject({ rapportagepost: "Override-versie" });
  });

  it("voegt een override-only rekening toe die niet in de master staat", () => {
    const resultaat = resolveerGrootboekMapping([], [balansRegel({ grootboekrekening: "0840" })]);
    expect(resultaat).toHaveLength(1);
    expect(resultaat[0]).toMatchObject({ grootboekrekening: "0840", soort: "BALANS" });
  });

  it("combineert master- en override-only rekeningen zonder overlap", () => {
    const resultaat = resolveerGrootboekMapping(
      [regel({ grootboekrekening: "4130" })],
      [balansRegel({ grootboekrekening: "1010" })],
    );
    expect(resultaat.map((r) => r.grootboekrekening).sort()).toEqual(["1010", "4130"]);
  });

  it("geeft de master ongewijzigd terug bij een lege override (administratie leunt volledig op de master)", () => {
    const master = [regel({ grootboekrekening: "4130" }), balansRegel({ grootboekrekening: "1600" })];
    expect(resolveerGrootboekMapping(master, [])).toEqual(master);
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

describe("balanszijdeVoorRegel", () => {
  it("geeft ACTIVA/PASSIVA door zoals vastgelegd in de mapping", () => {
    expect(balanszijdeVoorRegel({ balanszijde: "ACTIVA" })).toEqual({ type: "bekend", waarde: "ACTIVA" });
    expect(balanszijdeVoorRegel({ balanszijde: "PASSIVA" })).toEqual({ type: "bekend", waarde: "PASSIVA" });
  });

  it("is onbekend bij een nog niet bevestigde balanszijde (null), verzint geen kant op basis van het saldoteken", () => {
    const resultaat = balanszijdeVoorRegel({ balanszijde: null });
    expect(resultaat.type).toBe("onbekend");
  });
});
