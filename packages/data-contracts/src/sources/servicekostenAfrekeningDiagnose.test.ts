import { describe, expect, it } from "vitest";
import { parseServicekostenAfrekeningDiagnose } from "./servicekostenAfrekeningDiagnose.js";

const basisRij = {
  Bedrijfsnr: "070",
  Service_BK_Boekjaar: "2026",
  Service_BK_Boekperiode: "01",
  Service_BK_Dagboeknummer: "50",
  Service_BK_Boekstuknummer: "1",
  Service_BK_Volgnummer: "1",
  Service_BK_Kostensoort: "0014",
  Service_BK_Bedrag_debet: "100",
  Service_BK_Bedrag_credit: "0",
  Kostensoort_Soort: "Kosten",
};

describe("parseServicekostenAfrekeningDiagnose", () => {
  it("geeft de nieuwe diagnosevelden door zonder ze te classificeren", () => {
    const { rijen, issues } = parseServicekostenAfrekeningDiagnose([
      { ...basisRij, Service_BK_Jaar_Afrekening: "2025", Service_BK_SV_Afrekening_Soort: "X", Service_Boeking_Saldo: "100" },
    ]);
    expect(issues.filter((i) => i.ernst === "KRITIEK")).toHaveLength(0);
    expect(rijen[0]?.kostensoortSoort).toBe("Kosten");
    expect(rijen[0]?.jaarAfrekening).toBe("2025");
    expect(rijen[0]?.svAfrekeningSoort).toBe("X");
    expect(rijen[0]?.bronBoekingSaldo?.toString()).toBe("100");
  });

  it("geeft een onverwachte Kostensoort_Soort-waarde ongewijzigd door (geen enum-validatie die de rij zou laten verdwijnen)", () => {
    const { rijen, issues } = parseServicekostenAfrekeningDiagnose([{ ...basisRij, Kostensoort_Soort: "Onbekende status" }]);
    expect(issues.filter((i) => i.ernst === "KRITIEK")).toHaveLength(0);
    expect(rijen[0]?.kostensoortSoort).toBe("Onbekende status");
  });

  it("laat een leeg diagnoseveld als null zien, niet als leeg-string of 0", () => {
    const { rijen } = parseServicekostenAfrekeningDiagnose([{ ...basisRij, Kostensoort_Soort: null, Service_Boeking_Saldo: null }]);
    expect(rijen[0]?.kostensoortSoort).toBeNull();
    expect(rijen[0]?.bronBoekingSaldo).toBeNull();
  });

  it("meldt een rij die niet aan het schema voldoet als KRITIEK issue, zonder de andere rijen te raken (geen stilzwijgend verdwijnen)", () => {
    const { rijen, issues } = parseServicekostenAfrekeningDiagnose([
      { ...basisRij, Service_BK_Kostensoort: undefined }, // verplicht veld ontbreekt
      basisRij,
    ]);
    expect(rijen).toHaveLength(1);
    expect(issues.filter((i) => i.ernst === "KRITIEK")).toHaveLength(1);
    expect(issues[0]?.rowIndex).toBe(0);
  });

  it("berekent saldo als debet - credit, onafhankelijk van het bron-Service_Boeking_Saldo-veld", () => {
    const { rijen } = parseServicekostenAfrekeningDiagnose([{ ...basisRij, Service_BK_Bedrag_debet: "150", Service_BK_Bedrag_credit: "50", Service_Boeking_Saldo: "999" }]);
    expect(rijen[0]?.saldo.toString()).toBe("100");
    expect(rijen[0]?.bronBoekingSaldo?.toString()).toBe("999");
  });
});
