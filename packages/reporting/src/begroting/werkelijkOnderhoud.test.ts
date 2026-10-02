import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenWerkelijkOnderhoud, type WerkelijkOnderhoudBoekingRegel } from "./werkelijkOnderhoud.js";

/**
 * FASE M7 — eerste Werkelijk-laag voor de economische module ONDERHOUD.
 * Bewuste asset-/objecttype-uitsplitsing (GEBOUWEN/TERREIN/INSTALLATIES,
 * bewezen via GL4300/GL4330/GL4340) — GEEN gepland/correctief-dimensie, zie
 * moduledoc. Deze calculator zelf kent geen GL/OGB — bewezen apart in
 * `onderhoudCentraleMapping.test.ts`.
 */

function boeking(overrides: Partial<WerkelijkOnderhoudBoekingRegel> = {}): WerkelijkOnderhoudBoekingRegel {
  return { economischeCategorie: "ONDERHOUD_GEBOUWEN", complexnummer: "003", saldo: new Decimal(0), ...overrides };
}

describe("berekenWerkelijkOnderhoud", () => {
  it("1. classificeert boekingen per categorie, strikt gescheiden — GEBOUWEN/TERREIN/INSTALLATIES nooit samengevoegd", () => {
    const r = berekenWerkelijkOnderhoud([
      boeking({ economischeCategorie: "ONDERHOUD_GEBOUWEN", saldo: new Decimal(1000) }),
      boeking({ economischeCategorie: "ONDERHOUD_TERREIN", saldo: new Decimal(500) }),
      boeking({ economischeCategorie: "ONDERHOUD_INSTALLATIES", saldo: new Decimal(250) }),
    ]);
    expect(r.perCategorie.find((c) => c.categorie === "ONDERHOUD_GEBOUWEN")!.categorieTotaal.toString()).toBe("1000");
    expect(r.perCategorie.find((c) => c.categorie === "ONDERHOUD_TERREIN")!.categorieTotaal.toString()).toBe("500");
    expect(r.perCategorie.find((c) => c.categorie === "ONDERHOUD_INSTALLATIES")!.categorieTotaal.toString()).toBe("250");
  });

  it("2. moduleTotaal is uitsluitend de afgeleide som van de drie categorieën — GEEN vierde, apart bijgehouden totaal", () => {
    const r = berekenWerkelijkOnderhoud([
      boeking({ economischeCategorie: "ONDERHOUD_GEBOUWEN", saldo: new Decimal(1000) }),
      boeking({ economischeCategorie: "ONDERHOUD_TERREIN", saldo: new Decimal(500) }),
      boeking({ economischeCategorie: "ONDERHOUD_INSTALLATIES", saldo: new Decimal(250) }),
    ]);
    expect(r.moduleTotaal.toString()).toBe("1750");
    expect((r as unknown as { algemeenOnderhoudTotaal?: unknown }).algemeenOnderhoudTotaal).toBeUndefined();
  });

  it("3. economischeCategorie: null (NIET_GEMAPT) wordt nooit geraden — apart gehouden, telt in geen enkele categorie mee", () => {
    const r = berekenWerkelijkOnderhoud([boeking({ economischeCategorie: null, saldo: new Decimal(400) })]);
    expect(r.moduleTotaal.toString()).toBe("0");
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("400");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(1);
  });

  it("4. complexaggregatie per categorie: correct opgeteld, complexnummer null apart gegroepeerd", () => {
    const r = berekenWerkelijkOnderhoud([
      boeking({ economischeCategorie: "ONDERHOUD_GEBOUWEN", complexnummer: "001", saldo: new Decimal(300) }),
      boeking({ economischeCategorie: "ONDERHOUD_GEBOUWEN", complexnummer: "001", saldo: new Decimal(200) }),
      boeking({ economischeCategorie: "ONDERHOUD_GEBOUWEN", complexnummer: null, saldo: new Decimal(50) }),
    ]);
    const cat = r.perCategorie.find((c) => c.categorie === "ONDERHOUD_GEBOUWEN")!;
    expect(cat.perComplex.find((c) => c.complexnummer === "001")!.saldo.toString()).toBe("500");
    expect(cat.perComplex.find((c) => c.complexnummer === null)!.saldo.toString()).toBe("50");
  });

  it("5. geen dubbele telling: som(perCategorie) + nietGeclassificeerd = alle aangeleverde boekingen", () => {
    const boekingen = [
      boeking({ economischeCategorie: "ONDERHOUD_GEBOUWEN", saldo: new Decimal(1000) }),
      boeking({ economischeCategorie: "ONDERHOUD_TERREIN", saldo: new Decimal(500) }),
      boeking({ economischeCategorie: "ONDERHOUD_INSTALLATIES", saldo: new Decimal(250) }),
      boeking({ economischeCategorie: null, saldo: new Decimal(75) }),
    ];
    const r = berekenWerkelijkOnderhoud(boekingen);
    const somAlleBoekingen = boekingen.reduce((t, b) => t.plus(b.saldo), new Decimal(0));
    const somCategorieen = r.perCategorie.reduce((t, c) => t.plus(c.categorieTotaal), new Decimal(0));
    expect(somCategorieen.plus(r.nietGeclassificeerdTotaal).toString()).toBe(somAlleBoekingen.toString());
  });

  it("6. geen boekingen: alles 0, drie categorieën blijven zichtbaar", () => {
    const r = berekenWerkelijkOnderhoud([]);
    expect(r.perCategorie).toHaveLength(3);
    expect(r.moduleTotaal.toString()).toBe("0");
  });
});
