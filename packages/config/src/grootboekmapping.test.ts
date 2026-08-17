import { describe, expect, it } from "vitest";
import { parseGrootboekMapping, type GrootboekMappingRegel } from "./grootboekmapping.js";

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

function mapping(regels: unknown[]) {
  return { versie: "0.1", administratieId: "070_rooisezoom", regels };
}

describe("parseGrootboekMapping", () => {
  it("accepteert een geldige mapping en rondt zonder verlies (round-trip)", () => {
    const ruw = mapping([regel()]);
    expect(parseGrootboekMapping(ruw)).toEqual(ruw);
  });

  it("accepteert tekenconventie ZOALS_BRON en OMGEKEERD", () => {
    const ruw = mapping([regel({ grootboekrekening: "8800", tekenconventie: "OMGEKEERD" })]);
    const geparsed = parseGrootboekMapping(ruw);
    expect(geparsed.regels[0]?.tekenconventie).toBe("OMGEKEERD");
  });

  it("accepteert een expliciet onbevestigde tekenconventie (null), verzint er geen", () => {
    const ruw = mapping([regel({ tekenconventie: null })]);
    expect(parseGrootboekMapping(ruw).regels[0]?.tekenconventie).toBeNull();
  });

  it("wijst een inactieve regel niet af — actief/inactief is een geldige, aparte status", () => {
    const ruw = mapping([regel({ actief: false })]);
    expect(parseGrootboekMapping(ruw).regels[0]?.actief).toBe(false);
  });

  it("wijst een ongeldige tekenconventie-waarde af (Controle vereist, geen stilzwijgende correctie)", () => {
    expect(() => parseGrootboekMapping(mapping([{ ...regel(), tekenconventie: "OMGEKEERDE_WAARDE" }]))).toThrow();
  });

  it("wijst status GOEDGEKEURD niet af op schemaniveau — de repository-regel (nooit GOEDGEKEURD door AI) is een procesregel, geen schemabeperking", () => {
    const ruw = mapping([regel({ status: "GOEDGEKEURD" })]);
    expect(parseGrootboekMapping(ruw).regels[0]?.status).toBe("GOEDGEKEURD");
  });

  it("wijst een ontbrekend verplicht veld af", () => {
    expect(() => parseGrootboekMapping(mapping([{ grootboekrekening: "4000" }]))).toThrow();
  });

  it("wijst dubbele grootboekrekeningnummers af (ambigue mapping)", () => {
    const ruw = mapping([regel({ grootboekrekening: "4000" }), regel({ grootboekrekening: "4000", rapportagepost: "Iets anders" })]);
    expect(() => parseGrootboekMapping(ruw)).toThrow(/dubbele grootboekrekening/);
  });

  it("staat meerdere verschillende rekeningen toe", () => {
    const ruw = mapping([regel({ grootboekrekening: "4000" }), regel({ grootboekrekening: "4130", rapportagepost: "Verzekeringen" })]);
    expect(parseGrootboekMapping(ruw).regels).toHaveLength(2);
  });
});
