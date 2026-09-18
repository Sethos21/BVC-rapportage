import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { controleerTotaalAansluiting, formatEUR, formatPercentage, telOpMetAfronding, valideerNumeriek } from "./money.js";

describe("formatEUR", () => {
  it("formatteert met punt als duizendtal en komma als decimaal", () => {
    expect(formatEUR(new Decimal("1250.75"))).toBe("€ 1.250,75");
  });

  it("formatteert negatief met minteken (standaardstijl)", () => {
    expect(formatEUR(new Decimal("-1250.75"))).toBe("€ -1.250,75");
  });

  it("formatteert negatief met haakjes wanneer expliciet gevraagd", () => {
    expect(formatEUR(new Decimal("-1250.75"), "haakjes")).toBe("(€ 1.250,75)");
  });

  it("toont nul als een gewoon bedrag, niet als leeg", () => {
    expect(formatEUR(new Decimal(0))).toBe("€ 0,00");
  });

  it("rondt af naar centen", () => {
    expect(formatEUR(new Decimal("10.005"))).toBe("€ 10,01");
  });
});

describe("formatPercentage", () => {
  it("gebruikt komma als decimaal, geen spatie voor het procentteken", () => {
    expect(formatPercentage(new Decimal("12.5"))).toBe("12,5%");
  });
});

describe("rondAfNaarCenten / telOpMetAfronding", () => {
  it("rondt elke tussenstap af i.p.v. pas aan het eind (geen drijvende-kommafouten)", () => {
    const totaal = telOpMetAfronding([new Decimal("0.1"), new Decimal("0.2")]);
    expect(totaal.toString()).toBe("0.3");
  });

  it("negatieve nettoresultaten zijn toegestaan, geen validatiefout", () => {
    const totaal = telOpMetAfronding([new Decimal("100"), new Decimal("-150")]);
    expect(totaal.toString()).toBe("-50");
  });
});

describe("valideerNumeriek", () => {
  it("accepteert nul als geldige waarde", () => {
    expect(valideerNumeriek(0, "testveld").toString()).toBe("0");
  });

  it("wijst ontbrekende invoer af met een duidelijke foutmelding", () => {
    expect(() => valideerNumeriek(null, "testveld")).toThrow(/testveld/);
    expect(() => valideerNumeriek(undefined, "testveld")).toThrow(/testveld/);
  });

  it("wijst niet-numerieke invoer af", () => {
    expect(() => valideerNumeriek("abc", "testveld")).toThrow();
  });
});

describe("controleerTotaalAansluiting", () => {
  it("bevestigt aansluiting binnen tolerantie", () => {
    const resultaat = controleerTotaalAansluiting([new Decimal("100"), new Decimal("50")], new Decimal("150"));
    expect(resultaat.sluit).toBe(true);
  });

  it("signaleert een afwijkend totaal (dubbele controle vóór oplevering)", () => {
    const resultaat = controleerTotaalAansluiting([new Decimal("100"), new Decimal("50")], new Decimal("140"));
    expect(resultaat.sluit).toBe(false);
    expect(resultaat.verschil.toString()).toBe("10");
  });
});
