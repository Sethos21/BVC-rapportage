import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenPLJaarTotalen, berekenPLOveralTotaal, berekenPLTotalen, berekenPLTrend, berekenPostenTotaal } from "./plRapport.js";
import type { PLJaarcijfers, PLRapportInvoer } from "./types.js";

/** Testcase object 070 "Rooise Zoom" (twee jaren, representatieve subset van 2020–2026). */
function rooiseZoomJaar(jaar: number, huur: string, kosten: string): PLJaarcijfers {
  return {
    jaar,
    huurinkomstenPerEenheid: [
      { naam: "Eenheid 1", bedrag: new Decimal(huur).times(0.6) },
      { naam: "Eenheid 2", bedrag: new Decimal(huur).times(0.4) },
    ],
    kostenPerCategorie: [
      { naam: "Beheer", bedrag: new Decimal(kosten).times(0.3).negated() },
      { naam: "Onderhoud", bedrag: new Decimal(kosten).times(0.7).negated() },
    ],
  };
}

const rooiseZoom: PLRapportInvoer = {
  objectnaam: "Rooise Zoom",
  objectnummer: "070",
  jaren: [rooiseZoomJaar(2025, "100000", "40000"), rooiseZoomJaar(2026, "110000", "45000")],
};

describe("berekenPLJaarTotalen", () => {
  it("telt huurinkomsten en kosten (negatief) op tot een netto resultaat", () => {
    const totaal = berekenPLJaarTotalen(rooiseZoom.jaren[0]!);
    expect(totaal.huurTotaal.toString()).toBe("100000");
    expect(totaal.kostenTotaal.toString()).toBe("-40000");
    expect(totaal.nettoResultaat.toString()).toBe("60000");
  });

  it("laat een negatief nettoresultaat toe zonder validatiefout (rekenregel: negatieve resultaten zijn mogelijk)", () => {
    const totaal = berekenPLJaarTotalen(rooiseZoomJaar(2024, "10000", "50000"));
    expect(totaal.nettoResultaat.isNegative()).toBe(true);
  });
});

describe("berekenPLOveralTotaal", () => {
  it("telt de jaartotalen bij elkaar op", () => {
    const totalen = berekenPLTotalen(rooiseZoom);
    const overal = berekenPLOveralTotaal(totalen);
    expect(overal.huurTotaal.toString()).toBe("210000");
    expect(overal.nettoResultaat.toString()).toBe("125000");
  });
});

describe("berekenPLTrend", () => {
  it("berekent de mutatie t.o.v. het voorgaande jaar, het eerste jaar heeft geen trendpunt", () => {
    const totalen = berekenPLTotalen(rooiseZoom);
    const trend = berekenPLTrend(totalen);
    expect(trend).toHaveLength(1);
    expect(trend[0]?.jaar).toBe(2026);
    expect(trend[0]?.mutatieAbsoluut.toString()).toBe("5000");
  });
});

describe("berekenPostenTotaal", () => {
  it("rondt per stap af (geen drijvende-kommafouten bij optellen van veel posten)", () => {
    const totaal = berekenPostenTotaal([{ bedrag: new Decimal("0.1") }, { bedrag: new Decimal("0.2") }]);
    expect(totaal.toString()).toBe("0.3");
  });
});
