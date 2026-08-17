import { describe, expect, it } from "vitest";
import { selecteerBalansOpBoekperiode, selecteerBalansstanden, selecteerBoekingen } from "./periodeSelectie.js";
import type { BalansstandRow, BoekingRow } from "./rows.js";

function boeking(overrides: Partial<BoekingRow> = {}): BoekingRow {
  return {
    bedrijfsnr: "070",
    boekjaar: 2026,
    boekperiode: "01",
    dagboeknr: "20",
    boekstuknr: "024001",
    volgnr: "000001",
    boekstuk_sleutel: "0704020024001",
    boekdatum: "2026-01-15",
    grootboeknr: "8800",
    kostenplaatsnr: null,
    complexnr: "01",
    unitnr: null,
    contractnr: null,
    huurdernr: null,
    bedrag_debet: "0",
    bedrag_credit: "1000",
    saldo: "-1000",
    omschrijving: "Huur",
    grootboek_a: null,
    grootboek_b: null,
    ...overrides,
  };
}

function balans(overrides: Partial<BalansstandRow> = {}): BalansstandRow {
  return {
    bedrijfsnr: "070",
    jaar: 2025,
    grootboekrekeningnr: "1300",
    beginbalans_debet: "50000",
    beginbalans_credit: "0",
    saldo_debet: "0",
    saldo_credit: "0",
    eindsaldo: "-1487022.79",
    rekening_omschrijving: "Bank",
    balans_vw: "B",
    ...overrides,
  };
}

describe("selecteerBoekingen", () => {
  const rows = [
    boeking({ boekjaar: 2026, boekperiode: "01", grootboeknr: "8800", bedrag_credit: "100" }),
    boeking({ boekjaar: 2026, boekperiode: "03", grootboeknr: "8800", bedrag_credit: "200" }),
    boeking({ boekjaar: 2026, boekperiode: "06", grootboeknr: "8800", bedrag_credit: "300" }),
    boeking({ boekjaar: 2026, boekperiode: "07", grootboeknr: "8800", bedrag_credit: "400" }),
    boeking({ boekjaar: 2025, boekperiode: "03", grootboeknr: "8800", bedrag_credit: "500" }),
    boeking({ boekjaar: 2026, boekperiode: "03", grootboeknr: "4000", bedrag_debet: "50" }),
    boeking({ bedrijfsnr: "074", boekjaar: 2026, boekperiode: "03", grootboeknr: "8800", bedrag_credit: "999" }),
  ];

  it("selecteert op boekjaar (P&L boekjaar 2026 vs 2025, opdracht-voorbeeld 1/2)", () => {
    const resultaat2026 = selecteerBoekingen(rows, { bedrijfsnr: "070", boekjaar: 2026 });
    expect(resultaat2026.every((r) => r.boekjaar === 2026)).toBe(true);
    expect(resultaat2026).toHaveLength(5);

    const resultaat2025 = selecteerBoekingen(rows, { bedrijfsnr: "070", boekjaar: 2025 });
    expect(resultaat2025).toHaveLength(1);
    expect(resultaat2025[0]?.bedrag_credit).toBe("500");
  });

  it("selecteert een inclusieve boekperiode-range (periode 1 t/m 6)", () => {
    const resultaat = selecteerBoekingen(rows, { bedrijfsnr: "070", boekjaar: 2026, boekperiodeVan: "01", boekperiodeTotEnMet: "06", grootboekrekening: "8800" });
    expect(resultaat.map((r) => r.boekperiode)).toEqual(["01", "03", "06"]);
    expect(resultaat.some((r) => r.boekperiode === "07")).toBe(false);
  });

  it("filtert op grootboekrekening", () => {
    const resultaat = selecteerBoekingen(rows, { bedrijfsnr: "070", boekjaar: 2026, grootboekrekening: "4000" });
    expect(resultaat).toHaveLength(1);
    expect(resultaat[0]?.grootboeknr).toBe("4000");
  });

  it("isoleert per administratie (bedrijfsnr) — nooit rijen van een andere administratie meenemen", () => {
    const resultaat = selecteerBoekingen(rows, { bedrijfsnr: "070", boekjaar: 2026 });
    expect(resultaat.every((r) => r.bedrijfsnr === "070")).toBe(true);

    const anderAdministratie = selecteerBoekingen(rows, { bedrijfsnr: "074", boekjaar: 2026 });
    expect(anderAdministratie).toHaveLength(1);
    expect(anderAdministratie[0]?.bedrijfsnr).toBe("074");
  });

  it("geeft alle boekperioden van het boekjaar terug zonder range-opgave (expliciete keuze, geen impliciete eerste/laatste rij)", () => {
    const resultaat = selecteerBoekingen(rows, { bedrijfsnr: "070", boekjaar: 2026, grootboekrekening: "8800" });
    expect(resultaat.map((r) => r.boekperiode)).toEqual(["01", "03", "06", "07"]);
  });
});

describe("selecteerBalansstanden", () => {
  const rows = [
    balans({ jaar: 2025, grootboekrekeningnr: "1300", eindsaldo: "-1487022.79" }),
    balans({ jaar: 2026, grootboekrekeningnr: "1300", eindsaldo: "-1500000.00" }),
    balans({ jaar: 2025, grootboekrekeningnr: "1310", eindsaldo: "1000" }),
    balans({ bedrijfsnr: "074", jaar: 2025, grootboekrekeningnr: "1300", eindsaldo: "999999" }),
  ];

  it("selecteert balans op boekjaar (opdracht-voorbeeld: balans einde periode 12 van 2025 → jaar 2025)", () => {
    const resultaat = selecteerBalansstanden(rows, { bedrijfsnr: "070", jaar: 2025, grootboekrekening: "1300" });
    expect(resultaat).toHaveLength(1);
    expect(resultaat[0]?.eindsaldo).toBe("-1487022.79");
  });

  it("laat één grootboekrekening met meerdere jaarwaarden nooit impliciet één rij kiezen zonder boekjaar-filter", () => {
    const resultaat = selecteerBalansstanden(rows, { bedrijfsnr: "070", jaar: 2026, grootboekrekening: "1300" });
    expect(resultaat).toHaveLength(1);
    expect(resultaat[0]?.jaar).toBe(2026);
  });

  it("isoleert per administratie (bedrijfsnr)", () => {
    const resultaat = selecteerBalansstanden(rows, { bedrijfsnr: "070", jaar: 2025 });
    expect(resultaat.every((r) => r.bedrijfsnr === "070")).toBe(true);
    expect(resultaat).toHaveLength(2);
  });
});

describe("selecteerBalansOpBoekperiode (bekend cache-gat)", () => {
  it("geeft altijd onbekend terug — nooit stilzwijgend het jaareindsaldo als vervanging gebruiken", () => {
    const rows = [balans({ jaar: 2026, grootboekrekeningnr: "1300" })];
    const resultaat = selecteerBalansOpBoekperiode(rows, { bedrijfsnr: "070", jaar: 2026, boekperiode: "06", grootboekrekening: "1300" });
    expect(resultaat.type).toBe("onbekend");
    if (resultaat.type === "onbekend") {
      expect(resultaat.reden).toContain("boekperiode");
    }
  });
});
