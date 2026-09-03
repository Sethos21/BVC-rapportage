import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBezettingsgraad, berekenBezettingsgraadPortefeuille, berekenHuurPerComplexTotaal, berekenKpiMutatie } from "./kerncijfers.js";

describe("berekenKpiMutatie", () => {
  it("is gunstig bij een stijging van een opbrengstachtige KPI (huurinkomen, EBITDA)", () => {
    const mutatie = berekenKpiMutatie(new Decimal("110000"), new Decimal("100000"), true);
    expect(mutatie.mutatieAbsoluut.toString()).toBe("10000");
    expect(mutatie.mutatiePct.type).toBe("bekend");
    expect(mutatie.gunstig).toBe(true);
  });

  it("is een aandachtspunt bij een daling van een opbrengstachtige KPI", () => {
    const mutatie = berekenKpiMutatie(new Decimal("90000"), new Decimal("100000"), true);
    expect(mutatie.gunstig).toBe(false);
  });

  it("is gunstig bij een daling van een lastenachtige KPI (debiteuren) — omgekeerde betekenis", () => {
    const mutatie = berekenKpiMutatie(new Decimal("8000"), new Decimal("12000"), false);
    expect(mutatie.mutatieAbsoluut.toString()).toBe("-4000");
    expect(mutatie.gunstig).toBe(true);
  });

  it("laat de mutatie onbekend als de vergelijkingswaarde nul is (geen impliciete 0%)", () => {
    const mutatie = berekenKpiMutatie(new Decimal("5000"), new Decimal("0"), true);
    expect(mutatie.mutatiePct.type).toBe("onbekend");
  });
});

describe("berekenBezettingsgraad", () => {
  it("berekent verhuurd/totaal als percentage", () => {
    const resultaat = berekenBezettingsgraad(new Decimal("950"), new Decimal("1000"));
    expect(resultaat).toEqual({ type: "bekend", waarde: new Decimal("95") });
  });

  it("geeft onbekend bij totaal m² = 0 (geen deling door nul)", () => {
    const resultaat = berekenBezettingsgraad(new Decimal("0"), new Decimal("0"));
    expect(resultaat.type).toBe("onbekend");
  });
});

describe("berekenBezettingsgraadPortefeuille", () => {
  it("telt m² van meerdere complexen op en berekent de portefeuillebezetting", () => {
    const resultaat = berekenBezettingsgraadPortefeuille([
      { complex: "Complex 1", verhuurdM2: new Decimal("900"), totaalM2: new Decimal("1000") },
      { complex: "Complex 2", verhuurdM2: new Decimal("500"), totaalM2: new Decimal("500") },
    ]);
    expect(resultaat.verhuurdM2Totaal.toString()).toBe("1400");
    expect(resultaat.totaalM2Totaal.toString()).toBe("1500");
    expect(resultaat.bezettingsgraad).toEqual({ type: "bekend", waarde: new Decimal("1400").dividedBy("1500").times(100) });
  });
});

describe("berekenHuurPerComplexTotaal", () => {
  it("telt de huur per complex en de vergelijkingswaarden apart op", () => {
    const totaal = berekenHuurPerComplexTotaal([
      { naam: "Complex 1", waarde: new Decimal("60000"), vorig: new Decimal("55000") },
      { naam: "Complex 2", waarde: new Decimal("40000"), vorig: new Decimal("38000") },
    ]);
    expect(totaal.totaal.toString()).toBe("100000");
    expect(totaal.totaalVorig.toString()).toBe("93000");
  });
});
