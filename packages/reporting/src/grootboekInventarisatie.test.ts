import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { inventariseerGrootboekrekeningen, type GrootboekBalansOmschrijving, type GrootboekBoekingActiviteit } from "./grootboekInventarisatie.js";

function boeking(overrides: Partial<GrootboekBoekingActiviteit> = {}): GrootboekBoekingActiviteit {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4000",
    bedragDebet: new Decimal("100"),
    bedragCredit: new Decimal("0"),
    ...overrides,
  };
}

function balans(overrides: Partial<GrootboekBalansOmschrijving> = {}): GrootboekBalansOmschrijving {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4000",
    jaar: 2026,
    omschrijving: "Beheerkosten",
    balansVw: "V&W",
    ...overrides,
  };
}

describe("inventariseerGrootboekrekeningen", () => {
  it("groepeert boekingen en omschrijving per bedrijfsnr + grootboekrekening", () => {
    const resultaat = inventariseerGrootboekrekeningen(
      [boeking({ bedragDebet: new Decimal("60") }), boeking({ bedragDebet: new Decimal("40") })],
      [balans()],
    );
    expect(resultaat.totaalUniekeRekeningen).toBe(1);
    const regel = resultaat.rekeningen[0]!;
    expect(regel.grootboekrekening).toBe("4000");
    expect(regel.bedrijven).toHaveLength(1);
    expect(regel.bedrijven[0]).toMatchObject({ bedrijfsnr: "070", omschrijving: "Beheerkosten", balansVw: "V&W", aantalBoekingen: 2 });
    expect(regel.bedrijven[0]?.saldoTotaal.toString()).toBe("100");
  });

  it("markeert een rekening als consistent als omschrijving/balansVw gelijk zijn over administraties", () => {
    const resultaat = inventariseerGrootboekrekeningen(
      [boeking({ bedrijfsnr: "070" }), boeking({ bedrijfsnr: "074" })],
      [balans({ bedrijfsnr: "070" }), balans({ bedrijfsnr: "074" })],
    );
    const regel = resultaat.rekeningen.find((r) => r.grootboekrekening === "4000")!;
    expect(regel.consistent).toBe(true);
    expect(resultaat.aantalConsistent).toBe(1);
    expect(resultaat.aantalInconsistent).toBe(0);
  });

  it("markeert een rekening als inconsistent bij afwijkende omschrijving tussen administraties", () => {
    const resultaat = inventariseerGrootboekrekeningen(
      [boeking({ bedrijfsnr: "070" }), boeking({ bedrijfsnr: "074" })],
      [balans({ bedrijfsnr: "070", omschrijving: "Beheerkosten" }), balans({ bedrijfsnr: "074", omschrijving: "Administratiekosten" })],
    );
    const regel = resultaat.rekeningen.find((r) => r.grootboekrekening === "4000")!;
    expect(regel.consistent).toBe(false);
    expect(resultaat.aantalInconsistent).toBe(1);
  });

  it("markeert een rekening als inconsistent bij afwijkende balansVw tussen administraties, ook met gelijke omschrijving", () => {
    const resultaat = inventariseerGrootboekrekeningen(
      [boeking({ bedrijfsnr: "070" }), boeking({ bedrijfsnr: "074" })],
      [balans({ bedrijfsnr: "070", balansVw: "V&W" }), balans({ bedrijfsnr: "074", balansVw: "Bal" })],
    );
    const regel = resultaat.rekeningen.find((r) => r.grootboekrekening === "4000")!;
    expect(regel.consistent).toBe(false);
  });

  it("gebruikt de omschrijving van het meest recente boekjaar bij meerdere jaren voor hetzelfde bedrijfsnr+rekening", () => {
    const resultaat = inventariseerGrootboekrekeningen(
      [],
      [
        balans({ jaar: 2024, omschrijving: "Oude naam" }),
        balans({ jaar: 2026, omschrijving: "Nieuwe naam" }),
        balans({ jaar: 2025, omschrijving: "Tussenjaar" }),
      ],
    );
    expect(resultaat.rekeningen[0]?.bedrijven[0]?.omschrijving).toBe("Nieuwe naam");
  });

  it("neemt een rekening op die alleen in boekingen voorkomt, zonder balans-omschrijving (omschrijving/balansVw null)", () => {
    const resultaat = inventariseerGrootboekrekeningen([boeking({ grootboekrekening: "9999" })], []);
    const regel = resultaat.rekeningen.find((r) => r.grootboekrekening === "9999")!;
    expect(regel.bedrijven[0]).toMatchObject({ omschrijving: null, balansVw: null, aantalBoekingen: 1 });
  });

  it("neemt een rekening op die alleen in de balans-bron voorkomt, zonder boekingen (aantalBoekingen 0)", () => {
    const resultaat = inventariseerGrootboekrekeningen([], [balans({ grootboekrekening: "1300" })]);
    const regel = resultaat.rekeningen.find((r) => r.grootboekrekening === "1300")!;
    expect(regel.bedrijven[0]).toMatchObject({ aantalBoekingen: 0 });
    expect(regel.bedrijven[0]?.saldoTotaal.toString()).toBe("0");
  });

  it("geeft een leeg resultaat voor lege invoer", () => {
    const resultaat = inventariseerGrootboekrekeningen([], []);
    expect(resultaat.totaalUniekeRekeningen).toBe(0);
    expect(resultaat.rekeningen).toEqual([]);
  });
});
