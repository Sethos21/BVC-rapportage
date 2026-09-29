import { describe, expect, it } from "vitest";
import { vindPnLPresentatieRouting, type PnLPresentatieMappingRegel } from "./pnlPresentatiemapping.js";

/** P&L-presentatiemapping (Vervolgtranche 9, §8.10) — pure resolutie, geen GL/OGB/omschrijving hier. */

const REGEL: PnLPresentatieMappingRegel = {
  bedrijfsnr: "070",
  bronHoofddomein: "SERVICEKOSTEN_EIGENAAR",
  bronCategorie: "SERVICEKOSTEN_LEEGSTAND",
  doelHoofddomein: "LEEGSTAND",
  doelCategorie: "SERVICEKOSTEN_LEEGSTAND",
};

describe("vindPnLPresentatieRouting", () => {
  it("6. administratiegebonden: vindt de regel exact op (bedrijfsnr, bronHoofddomein, bronCategorie)", () => {
    expect(vindPnLPresentatieRouting([REGEL], "070", "SERVICEKOSTEN_EIGENAAR", "SERVICEKOSTEN_LEEGSTAND")).toEqual(REGEL);
  });

  it("6. andere administratie erft de regel niet automatisch — geen routing", () => {
    expect(vindPnLPresentatieRouting([REGEL], "071", "SERVICEKOSTEN_EIGENAAR", "SERVICEKOSTEN_LEEGSTAND")).toBeNull();
  });

  it("2. andere bronCategorie binnen hetzelfde hoofddomein (bv. REGULIER) wordt niet geroerd", () => {
    expect(vindPnLPresentatieRouting([REGEL], "070", "SERVICEKOSTEN_EIGENAAR", "SERVICEKOSTEN_EIGENAAR_REGULIER")).toBeNull();
  });

  it("een ander bronHoofddomein met dezelfde categorienaam matcht niet — geen fuzzy match op categorienaam alleen", () => {
    expect(vindPnLPresentatieRouting([REGEL], "070", "LEEGSTAND", "SERVICEKOSTEN_LEEGSTAND")).toBeNull();
  });

  it("een lege regelset routeert nooit iets", () => {
    expect(vindPnLPresentatieRouting([], "070", "SERVICEKOSTEN_EIGENAAR", "SERVICEKOSTEN_LEEGSTAND")).toBeNull();
  });
});
