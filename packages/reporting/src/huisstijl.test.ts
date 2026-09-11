import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { formatM2Html, formatOnbekendOfHtml, formatPercentageHtml } from "./huisstijl.js";

describe("formatPercentageHtml", () => {
  it("formatteert een positief percentage zonder negatief-styling", () => {
    expect(formatPercentageHtml(new Decimal("83.831282952548330404"))).toBe("83,8%");
  });

  it("wikkelt een negatief percentage in de negatief-span", () => {
    expect(formatPercentageHtml(new Decimal("-5"))).toBe('<span class="negatief">-5,0%</span>');
  });
});

describe("formatM2Html", () => {
  it("formatteert een heel getal zonder decimalen", () => {
    expect(formatM2Html(new Decimal("1390"))).toBe("1.390 m²");
  });

  it("formatteert een half getal met 1 decimaal", () => {
    expect(formatM2Html(new Decimal("3333.5"))).toBe("3.333,5 m²");
  });
});

describe("formatOnbekendOfHtml", () => {
  it("geeft de geformatteerde waarde terug bij 'bekend'", () => {
    const resultaat = formatOnbekendOfHtml({ type: "bekend", waarde: new Decimal("100") }, (d) => `${d.toString()}x`);
    expect(resultaat).toBe("100x");
  });

  it("geeft 'Controle vereist' met de reden als tooltip bij 'onbekend', nooit een gok", () => {
    const resultaat = formatOnbekendOfHtml({ type: "onbekend", reden: "test-reden" }, (d: Decimal) => d.toString());
    expect(resultaat).toContain("Controle vereist");
    expect(resultaat).toContain("test-reden");
  });
});
