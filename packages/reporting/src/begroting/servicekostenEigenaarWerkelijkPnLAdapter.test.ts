import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenWerkelijkServicekostenEigenaar, type WerkelijkServicekostenEigenaarBoekingRegel } from "./werkelijkServicekostenEigenaar.js";
import { servicekostenEigenaarCategorieBijdrage, servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels } from "./servicekostenEigenaarWerkelijkPnLAdapter.js";

/** Servicekosten Eigenaar → P&L (Vervolgtranche 9, §8.10): `categorieenElders` sluit een categorie hier uit zodra een bewezen P&L-presentatiemapping haar elders presenteert. */

const D = (n: string | number) => new Decimal(n);

function resultaat(overrides: Partial<Record<"REGULIER" | "LEEGSTAND", number>> = {}): ReturnType<typeof berekenWerkelijkServicekostenEigenaar> {
  const boekingen: WerkelijkServicekostenEigenaarBoekingRegel[] = [];
  if (overrides.REGULIER !== undefined) boekingen.push({ economischeCategorie: "SERVICEKOSTEN_EIGENAAR_REGULIER", complexnummer: "001", saldo: D(overrides.REGULIER) });
  if (overrides.LEEGSTAND !== undefined) boekingen.push({ economischeCategorie: "SERVICEKOSTEN_LEEGSTAND", complexnummer: "003", saldo: D(overrides.LEEGSTAND) });
  return berekenWerkelijkServicekostenEigenaar(boekingen);
}

describe("servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels — categorieenElders (Vervolgtranche 9)", () => {
  it("zonder categorieenElders: bestaand gedrag ongewijzigd, beide categorieën als eigen regel", () => {
    const regels = servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels(resultaat({ REGULIER: 100, LEEGSTAND: 199.08 }), true);
    expect(regels.map((r) => r.regelSleutel)).toEqual(["SERVICEKOSTEN_EIGENAAR_REGULIER", "SERVICEKOSTEN_LEEGSTAND"]);
  });

  it("3/4/8. SERVICEKOSTEN_LEEGSTAND in categorieenElders: verdwijnt hier volledig (geen dubbeltelling) — REGULIER blijft onaangeroerd (geen volledige GL-herclassificatie)", () => {
    const regels = servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels(resultaat({ REGULIER: 100, LEEGSTAND: 199.08 }), true, new Set(["SERVICEKOSTEN_LEEGSTAND"]));
    expect(regels.map((r) => r.regelSleutel)).toEqual(["SERVICEKOSTEN_EIGENAAR_REGULIER"]);
    expect(regels[0]!.waarde).toEqual({ status: "BEKEND", bedrag: D(100) });
  });

  it("servicekostenEigenaarCategorieBijdrage levert dezelfde waarde als de hoofdfunctie voor die categorie zou hebben geleverd — geen bedrag wordt geschat/verdeeld bij het elders presenteren", () => {
    const r = resultaat({ LEEGSTAND: 199.08 });
    expect(servicekostenEigenaarCategorieBijdrage(r, "SERVICEKOSTEN_LEEGSTAND", true)).toEqual({ status: "BEKEND", bedrag: D(199.08) });
  });

  it("onbevestigde dekking blijft ONBEKEND, ook via de losse helper", () => {
    const r = resultaat({ LEEGSTAND: 199.08 });
    expect(servicekostenEigenaarCategorieBijdrage(r, "SERVICEKOSTEN_LEEGSTAND", false).status).toBe("ONBEKEND");
  });
});
