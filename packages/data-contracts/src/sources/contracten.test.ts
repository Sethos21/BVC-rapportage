import { describe, expect, it } from "vitest";
import { parseContracten } from "./contracten.js";

const basisRij = {
  Bedrijfsnr: "070",
  Contract: "0000000043",
  Complexnummer: "001",
  Unitnummer: "0001",
  Huurdernummer: "00000028",
};

describe("parseContracten", () => {
  it("geeft Huurder_Naam_1 door als huurderNaam, zonder classificatie", () => {
    const { rijen, issues } = parseContracten([{ ...basisRij, Huurder_Naam_1: "Voorbeeld Huurder BV" }]);
    expect(issues.filter((i) => i.ernst === "KRITIEK")).toHaveLength(0);
    expect(rijen[0]?.huurderNaam).toBe("Voorbeeld Huurder BV");
  });

  it("laat huurderNaam null als het veld in de bron ontbreekt, nooit een lege string of default", () => {
    const { rijen } = parseContracten([basisRij]);
    expect(rijen[0]?.huurderNaam).toBeNull();
  });
});
