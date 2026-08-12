import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { toJsonSafe } from "./jsonSafe.js";

describe("toJsonSafe", () => {
  it("zet Decimal om naar string zonder de waarde te wijzigen", () => {
    expect(toJsonSafe({ bedrag: new Decimal("1665.54") })).toEqual({ bedrag: "1665.54" });
  });

  it("zet Date om naar ISO-string", () => {
    const datum = new Date("2024-01-01T00:00:00.000Z");
    expect(toJsonSafe({ boekdatum: datum })).toEqual({ boekdatum: "2024-01-01T00:00:00.000Z" });
  });

  it("laat null en gewone waarden ongemoeid", () => {
    expect(toJsonSafe({ omschrijving: null, bedrijfsnr: "002" })).toEqual({ omschrijving: null, bedrijfsnr: "002" });
  });
});
