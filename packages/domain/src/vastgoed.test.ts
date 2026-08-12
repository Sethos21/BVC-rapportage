import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { actueleJaarhuur, bepaalOppervlakte, bezettingsgraadUnits, huurprijsPerM2 } from "./vastgoed.js";

describe("bepaalOppervlakte (CAL-VG-002)", () => {
  it("geeft voorrang aan Unit_VVO boven BVO en gehuurd oppervlak", () => {
    const resultaat = bepaalOppervlakte({
      unitVvo: new Decimal("120"),
      unitBvo: new Decimal("140"),
      gehuurdOppervlak: new Decimal("100"),
    });
    expect(resultaat).toEqual({ bron: "Unit_VVO", waarde: new Decimal("120") });
  });

  it("valt terug op Unit_BVO wanneer VVO nul is", () => {
    const resultaat = bepaalOppervlakte({
      unitVvo: new Decimal("0"),
      unitBvo: new Decimal("140"),
      gehuurdOppervlak: new Decimal("100"),
    });
    expect(resultaat.bron).toBe("Unit_BVO");
  });

  it("is onbekend, niet nul, wanneer alle drie ontbreken", () => {
    const resultaat = bepaalOppervlakte({ unitVvo: null, unitBvo: null, gehuurdOppervlak: null });
    expect(resultaat.bron).toBe("onbekend");
  });
});

describe("bezettingsgraadUnits (CAL-VG-003)", () => {
  it("gooit een fout boven 100% in plaats van stil af te toppen (PAR-VG-001 publicatieblokkade)", () => {
    expect(() => bezettingsgraadUnits(11, 10)).toThrow();
  });

  it("is onbekend zonder actieve verhuurbare units", () => {
    expect(bezettingsgraadUnits(0, 0).type).toBe("onbekend");
  });
});

describe("actueleJaarhuur (CAL-CTR-001)", () => {
  it("gebruikt uitsluitend Vorderingsoort 01 en geldige contracten (FA-017)", () => {
    const totaal = actueleJaarhuur([
      { vorderingsoort: "01", prolongatieBedragJaar: new Decimal("21463.8"), contractGeldigOpPeildatum: true },
      { vorderingsoort: "12", prolongatieBedragJaar: new Decimal("1740"), contractGeldigOpPeildatum: true },
      { vorderingsoort: "01", prolongatieBedragJaar: new Decimal("5000"), contractGeldigOpPeildatum: false },
    ]);
    expect(totaal.toString()).toBe("21463.8");
  });
});

describe("huurprijsPerM2 (CAL-CTR-002)", () => {
  it("is onbekend bij oppervlakte nul, verzint geen prijs (FA-017)", () => {
    expect(huurprijsPerM2(new Decimal("1000"), new Decimal("0")).type).toBe("onbekend");
  });
});
