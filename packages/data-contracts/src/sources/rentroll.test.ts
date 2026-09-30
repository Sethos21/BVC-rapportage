import { describe, expect, it } from "vitest";
import { parseRentroll, rentrollregelNatuurlijkeSleutel } from "./rentroll.js";

/**
 * Bron: "RentRoll" — let op de afwijkende sleutelnaam "Bedrijfsnummer" (lange vorm, niet
 * "Bedrijfsnr" zoals de overige bronnen; geverifieerd tegen het echte bronbestand, zie
 * rentroll.ts's moduledoc).
 */
const basisRij = {
  Bedrijfsnummer: "070",
  Contractnummer: "0000000043",
  Vorderingsoort: "01",
  Unitnummer: "0001",
  Complexnummer: "001",
};

describe("parseRentroll", () => {
  it("valideert een minimale, geldige regel en berekent de natuurlijke sleutel uit Bedrijfsnummer+Contractnummer+Vorderingsoort+Unitnummer", () => {
    const { rijen, issues } = parseRentroll([{ ...basisRij, Prolongatie_bedrag_jaar: "12000.00" }]);
    expect(issues.filter((i) => i.ernst === "KRITIEK")).toHaveLength(0);
    expect(rijen[0]?.prolongatieBedragJaar?.toString()).toBe("12000");
    expect(rentrollregelNatuurlijkeSleutel(rijen[0]!)).toBe("070::0000000043::01::0001");
  });

  it("Tranche 12: geeft BTW_Y_N door als btwYn, geen classificatie op dit niveau", () => {
    const { rijen } = parseRentroll([{ ...basisRij, BTW_Y_N: "Y" }]);
    expect(rijen[0]?.btwYn).toBe("Y");
  });

  it("laat btwYn null als het veld ontbreekt, nooit een default zoals 'N'", () => {
    const { rijen } = parseRentroll([basisRij]);
    expect(rijen[0]?.btwYn).toBeNull();
  });

  it("meerdere regels per contract (één per vorderingsoort) blijven allemaal geldig, geen dubbele-sleutel-melding", () => {
    const { rijen, duplicaatIssues } = parseRentroll([
      { ...basisRij, Vorderingsoort: "01", Prolongatie_bedrag_jaar: "12000" },
      { ...basisRij, Vorderingsoort: "13", Korting_bedrag_jaar: "-500" },
    ]);
    expect(rijen).toHaveLength(2);
    expect(duplicaatIssues).toHaveLength(0);
  });
});
