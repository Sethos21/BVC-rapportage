import { describe, expect, it } from "vitest";
import { parseGrootboekMapping, parseGrootboekMappingMaster, type BalansRegel, type ResultaatRegel } from "./grootboekmapping.js";

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
    actief: true,
    status: "VOORGESTELD",
    ...overrides,
  };
}

function mapping(regels: unknown[]) {
  return { versie: "0.1", administratieId: "070_rooisezoom", regels };
}

describe("parseGrootboekMapping — RESULTAAT-regels", () => {
  it("accepteert een geldige mapping en rondt zonder verlies (round-trip)", () => {
    const ruw = mapping([regel()]);
    expect(parseGrootboekMapping(ruw)).toEqual(ruw);
  });

  it("accepteert tekenconventie ZOALS_BRON en OMGEKEERD", () => {
    const ruw = mapping([regel({ grootboekrekening: "8800", tekenconventie: "OMGEKEERD" })]);
    const geparsed = parseGrootboekMapping(ruw);
    expect(geparsed.regels[0]).toMatchObject({ tekenconventie: "OMGEKEERD" });
  });

  it("accepteert een expliciet onbevestigde tekenconventie (null), verzint er geen", () => {
    const ruw = mapping([regel({ tekenconventie: null })]);
    expect(parseGrootboekMapping(ruw).regels[0]).toMatchObject({ tekenconventie: null });
  });

  it("wijst een inactieve regel niet af — actief/inactief is een geldige, aparte status", () => {
    const ruw = mapping([regel({ actief: false })]);
    expect(parseGrootboekMapping(ruw).regels[0]).toMatchObject({ actief: false });
  });

  it("wijst een ongeldige tekenconventie-waarde af (Controle vereist, geen stilzwijgende correctie)", () => {
    expect(() => parseGrootboekMapping(mapping([{ ...regel(), tekenconventie: "OMGEKEERDE_WAARDE" }]))).toThrow();
  });

  it("wijst status GOEDGEKEURD niet af op schemaniveau — de repository-regel (nooit GOEDGEKEURD door AI) is een procesregel, geen schemabeperking", () => {
    const ruw = mapping([regel({ status: "GOEDGEKEURD" })]);
    expect(parseGrootboekMapping(ruw).regels[0]).toMatchObject({ status: "GOEDGEKEURD" });
  });

  it("wijst een ontbrekend verplicht veld af", () => {
    expect(() => parseGrootboekMapping(mapping([{ grootboekrekening: "4000", soort: "RESULTAAT" }]))).toThrow();
  });

  it("wijst een RESULTAAT-regel met een onbekend extra veld af (strict schema)", () => {
    expect(() => parseGrootboekMapping(mapping([{ ...regel(), onbekendVeld: "x" }]))).toThrow();
  });
});

describe("parseGrootboekMapping — BALANS-regels", () => {
  it("accepteert een BALANS-regel zonder rapportagepost/-categorie/tekenconventie (die zijn niet van toepassing)", () => {
    const ruw = mapping([balansRegel()]);
    expect(parseGrootboekMapping(ruw)).toEqual(ruw);
  });

  it("wijst een BALANS-regel met een rapportagepost-veld af (strict schema, hoort niet bij BALANS)", () => {
    expect(() => parseGrootboekMapping(mapping([{ ...balansRegel(), rapportagepost: "Iets" }]))).toThrow();
  });

  it("staat RESULTAAT- en BALANS-regels naast elkaar toe in dezelfde mapping", () => {
    const ruw = mapping([regel({ grootboekrekening: "4000" }), balansRegel({ grootboekrekening: "1010" })]);
    const geparsed = parseGrootboekMapping(ruw);
    expect(geparsed.regels).toHaveLength(2);
    expect(geparsed.regels.map((r) => r.soort).sort()).toEqual(["BALANS", "RESULTAAT"]);
  });
});

describe("parseGrootboekMapping — algemeen", () => {
  it("wijst dubbele grootboekrekeningnummers af, ook tussen soorten heen (ambigue mapping)", () => {
    const ruw = mapping([regel({ grootboekrekening: "4000" }), balansRegel({ grootboekrekening: "4000" })]);
    expect(() => parseGrootboekMapping(ruw)).toThrow(/dubbele grootboekrekening/);
  });

  it("staat meerdere verschillende rekeningen toe", () => {
    const ruw = mapping([regel({ grootboekrekening: "4000" }), regel({ grootboekrekening: "4130", rapportagepost: "Verzekeringen" })]);
    expect(parseGrootboekMapping(ruw).regels).toHaveLength(2);
  });

  it("accepteert een lege regels-lijst (override die volledig op de master leunt)", () => {
    const ruw = mapping([]);
    expect(parseGrootboekMapping(ruw).regels).toEqual([]);
  });
});

describe("parseGrootboekMappingMaster", () => {
  it("accepteert een geldige master-mapping zonder administratieId", () => {
    const ruw = { versie: "0.1", regels: [regel({ grootboekrekening: "4130" }), balansRegel({ grootboekrekening: "1600" })] };
    expect(parseGrootboekMappingMaster(ruw)).toEqual(ruw);
  });

  it("wijst dubbele grootboekrekeningnummers in de master af", () => {
    const ruw = { versie: "0.1", regels: [regel({ grootboekrekening: "4130" }), regel({ grootboekrekening: "4130" })] };
    expect(() => parseGrootboekMappingMaster(ruw)).toThrow(/dubbele grootboekrekening/);
  });

  it("wijst een ongeldige structuur af", () => {
    expect(() => parseGrootboekMappingMaster({ versie: "0.1" })).toThrow();
  });
});
