import { STANDAARD_PARAMETERS } from "@bvc/config";
import { describe, expect, it } from "vitest";
import { bepaalUitsluitingsstatus, parseServicekosten } from "./servicekosten.js";

const basisRij = {
  Bedrijfsnr: "070",
  Service_BK_Boekjaar: "2026",
  Service_BK_Boekperiode: "06",
  Service_BK_Dagboeknummer: "90",
  Service_BK_Boekstuknummer: "1",
  Service_BK_Volgnummer: "1",
  Service_BK_Kostensoort: "4100",
  Service_BK_Omschrijving: "Schoonmaakkosten",
  Service_BK_Bedrag_debet: "100",
  Service_BK_Bedrag_credit: "0",
};

describe("bepaalUitsluitingsstatus (config-gestuurd, geen hardcoded kostensoorten)", () => {
  it("sluit de kostensoorten uit die in de beheerparameters staan (standaard: 9600)", () => {
    expect(bepaalUitsluitingsstatus("9600", null, STANDAARD_PARAMETERS.servicekosten)).toBe("UITGESLOTEN_AFREKENING_VORIG_JAAR");
  });

  it("respecteert een uitgebreide, aangepaste uitsluitingslijst zonder codewijziging", () => {
    const aangepast = { ...STANDAARD_PARAMETERS.servicekosten, uitgeslotenKostensoorten: ["9600", "4999"] };
    expect(bepaalUitsluitingsstatus("4999", null, aangepast)).toBe("UITGESLOTEN_AFREKENING_VORIG_JAAR");
  });

  it("signaleert (maar sluit niet automatisch uit) een omschrijving die op een serviceafrekening lijkt", () => {
    expect(bepaalUitsluitingsstatus("4100", "Service afrekening 2025", STANDAARD_PARAMETERS.servicekosten)).toBe("CONTROLE_VEREIST_MOGELIJKE_SERVICEAFREKENING");
  });

  it("geeft GEEN voor een gewone kostenboeking", () => {
    expect(bepaalUitsluitingsstatus("4100", "Schoonmaakkosten", STANDAARD_PARAMETERS.servicekosten)).toBe("GEEN");
  });
});

describe("parseServicekosten", () => {
  it("valideert rijen en berekent het boekingssaldo (debet - credit)", () => {
    const { rijen, issues } = parseServicekosten([basisRij], STANDAARD_PARAMETERS.servicekosten);
    expect(issues.filter((i) => i.ernst === "KRITIEK")).toHaveLength(0);
    expect(rijen[0]?.serviceBoekingSaldo.toString()).toBe("100");
    expect(rijen[0]?.uitsluitingsstatus).toBe("GEEN");
  });

  it("geeft Kostensoort_Soort en Service_BK_Jaar_SV_Afrekening door zonder ze te classificeren", () => {
    const { rijen } = parseServicekosten([{ ...basisRij, Kostensoort_Soort: "Kosten", Service_BK_Jaar_SV_Afrekening: "2025" }], STANDAARD_PARAMETERS.servicekosten);
    expect(rijen[0]?.kostensoortSoort).toBe("Kosten");
    expect(rijen[0]?.jaarSvAfrekening).toBe("2025");
  });

  it("laat Kostensoort_Soort/jaarSvAfrekening null als ze in de bron ontbreken, nooit een lege string of default", () => {
    const { rijen } = parseServicekosten([basisRij], STANDAARD_PARAMETERS.servicekosten);
    expect(rijen[0]?.kostensoortSoort).toBeNull();
    expect(rijen[0]?.jaarSvAfrekening).toBeNull();
  });

  it("geeft Naam_1 door als huurderNaam", () => {
    const { rijen } = parseServicekosten([{ ...basisRij, Naam_1: "Voorbeeld Huurder BV" }], STANDAARD_PARAMETERS.servicekosten);
    expect(rijen[0]?.huurderNaam).toBe("Voorbeeld Huurder BV");
  });
});
