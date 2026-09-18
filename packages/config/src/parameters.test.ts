import { describe, expect, it } from "vitest";
import { parseBeheerparameters, STANDAARD_PARAMETERS } from "./parameters.js";

describe("STANDAARD_PARAMETERS", () => {
  it("reproduceert het vroegere hardcoded gedrag (kostensoort 9600 uitgesloten)", () => {
    expect(STANDAARD_PARAMETERS.servicekosten.uitgeslotenKostensoorten).toEqual(["9600"]);
  });

  it("is zelf geldig volgens het schema (round-trip)", () => {
    expect(parseBeheerparameters(STANDAARD_PARAMETERS)).toEqual(STANDAARD_PARAMETERS);
  });
});

describe("parseBeheerparameters", () => {
  it("accepteert een aangepaste, uitgebreide uitsluitingslijst zonder codewijziging", () => {
    const aangepast = parseBeheerparameters({
      versie: "0.2",
      servicekosten: { uitgeslotenKostensoorten: ["9600", "9700"], serviceafrekeningVarianten: ["afrekening"] },
    });
    expect(aangepast.servicekosten.uitgeslotenKostensoorten).toEqual(["9600", "9700"]);
  });

  it("wijst een ongeldig parameterbestand af (Controle vereist, geen stilzwijgende fallback)", () => {
    expect(() => parseBeheerparameters({ versie: "0.1", servicekosten: { uitgeslotenKostensoorten: "9600" } })).toThrow();
  });
});
