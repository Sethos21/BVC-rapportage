import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { coerceBegrotingsBedrag, coerceDecimal } from "./coerce.js";

describe("coerceDecimal", () => {
  it("parseert gewone bedragen met punt-decimaal (boekingen/balans/servicekosten-notatie)", () => {
    expect(coerceDecimal("1665.54")?.toString()).toBe("1665.54");
    expect(coerceDecimal(1665.54)?.toString()).toBe("1665.54");
  });

  it("parseert bedragen met komma-decimaal (rentroll/complex-totalen/ouderdomsanalyse-notatie)", () => {
    expect(coerceDecimal("1665,54")?.toString()).toBe("1665.54");
  });

  it("behoudt legitiem negatieve saldi (bv. Eindsaldo in balans)", () => {
    expect(coerceDecimal("-1487022.79")?.toString()).toBe("-1487022.79");
  });

  it("geeft null voor lege waarden, geen crash", () => {
    expect(coerceDecimal("")).toBeNull();
    expect(coerceDecimal(null)).toBeNull();
    expect(coerceDecimal("-")).toBeNull();
  });

  it("geeft null (nooit een ongevangen crash) bij een Excel-foutwaarde — bevestigd aanwezig in echte Boeking_Saldo-cellen (#REF!)", () => {
    expect(() => coerceDecimal("#REF!")).not.toThrow();
    expect(coerceDecimal("#REF!")).toBeNull();
    expect(coerceDecimal("#VALUE!")).toBeNull();
    expect(coerceDecimal("#N/A")).toBeNull();
  });
});

describe("coerceBegrotingsBedrag", () => {
  it("interpreteert komma als duizendtalscheider zonder decimalen (echte begroting-notatie, bv. Huuropbrengst belast)", () => {
    expect(coerceBegrotingsBedrag("139,152")?.toString()).toBe("139152");
    expect(coerceBegrotingsBedrag("42,616")?.toString()).toBe("42616");
  });

  it("interpreteert haakjes als negatief bedrag (echte begroting-notatie, bv. Verleende huurkorting)", () => {
    expect(coerceBegrotingsBedrag("(7,086)")?.toString()).toBe("-7086");
    expect(coerceBegrotingsBedrag("(12,409)")?.toString()).toBe("-12409");
  });

  it("behandelt een kleine waarde zonder duizendtal-komma correct", () => {
    expect(coerceBegrotingsBedrag("757")?.toString()).toBe("757");
    expect(coerceBegrotingsBedrag("(757)")?.toString()).toBe("-757");
  });

  it("geeft null voor een losse '-' (leeg/nul in accounting-notatie)", () => {
    expect(coerceBegrotingsBedrag("-")).toBeNull();
    expect(coerceBegrotingsBedrag("")).toBeNull();
  });

  it("geeft null (nooit een ongevangen crash) bij een Excel-foutwaarde — bevestigd aanwezig in echte begroting-bronbestanden (#VALUE!)", () => {
    expect(() => coerceBegrotingsBedrag("#VALUE!")).not.toThrow();
    expect(coerceBegrotingsBedrag("#VALUE!")).toBeNull();
  });

  it("accepteert al-numerieke waarden (Decimal/number) ongewijzigd", () => {
    expect(coerceBegrotingsBedrag(1234)?.toString()).toBe("1234");
    expect(coerceBegrotingsBedrag(new Decimal("500"))?.toString()).toBe("500");
  });
});
