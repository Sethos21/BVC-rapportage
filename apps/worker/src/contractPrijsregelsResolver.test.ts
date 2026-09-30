import { describe, expect, it } from "vitest";
import { parseContractPrijsregels } from "@bvc/data-contracts";
import { bepaalToekomstigeKortingswijzigingenPerContract } from "./contractPrijsregelsResolver.js";

const BEDRIJFSNR = "070";
const BRONPEILDATUM = new Date("2026-09-01T00:00:00.000Z");

function rij(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    Bedrijfsnr: BEDRIJFSNR,
    Contractnr: "0000000049",
    Prijs_regelnr: "1",
    Status: "Nieuw",
    Ingangsdatum_prijsregel: "01-07-2027",
    Bedrag_vorderingsoort_13: "0",
    ...overrides,
  };
}

function parseEnResolve(ruweRijen: Record<string, unknown>[], bronPeildatum = BRONPEILDATUM) {
  const { rijen } = parseContractPrijsregels(ruweRijen);
  return bepaalToekomstigeKortingswijzigingenPerContract(rijen, BEDRIJFSNR, bronPeildatum);
}

describe("bepaalToekomstigeKortingswijzigingenPerContract", () => {
  it("meerdere kandidaatrijen voor dezelfde toekomstige datum met UNANIEM bedrag geven één eenduidige wijziging (bewezen 070/049-patroon)", () => {
    const { perContract, issues } = parseEnResolve([
      rij({ Prijs_regelnr: "2", Ingangsdatum_prijsregel: "15-09-2024", Bedrag_vorderingsoort_13: "-500" }),
      rij({ Prijs_regelnr: "5", Ingangsdatum_prijsregel: "01-07-2027", Bedrag_vorderingsoort_13: "0" }),
      rij({ Prijs_regelnr: "7", Ingangsdatum_prijsregel: "01-01-2027", Bedrag_vorderingsoort_13: "-500" }),
      rij({ Prijs_regelnr: "9", Ingangsdatum_prijsregel: "01-07-2027", Bedrag_vorderingsoort_13: "0" }),
    ]);
    expect(issues).toHaveLength(0);
    const wijzigingen = perContract.get("0000000049")!;
    expect(wijzigingen).toHaveLength(2);
    expect(wijzigingen[0]!.ingangsdatum.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(wijzigingen[0]!.nieuweKortingPerMaand.toString()).toBe("-500");
    expect(wijzigingen[1]!.ingangsdatum.toISOString().slice(0, 10)).toBe("2027-07-01");
    expect(wijzigingen[1]!.nieuweKortingPerMaand.toString()).toBe("0");
  });

  it("verschillende bedragen voor dezelfde toekomstige datum: BRONGAT voor die datum, contract levert geen wijziging voor die datum maar andere datums van hetzelfde contract blijven meetellen", () => {
    const { perContract, issues } = parseEnResolve([
      rij({ Prijs_regelnr: "1", Ingangsdatum_prijsregel: "01-07-2027", Bedrag_vorderingsoort_13: "0" }),
      rij({ Prijs_regelnr: "2", Ingangsdatum_prijsregel: "01-07-2027", Bedrag_vorderingsoort_13: "-250" }),
      rij({ Prijs_regelnr: "3", Ingangsdatum_prijsregel: "01-01-2028", Bedrag_vorderingsoort_13: "-100" }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.ernst).toBe("BRONGAT");
    expect(issues[0]!.contractnummer).toBe("0000000049");
    expect(issues[0]!.bericht).toContain("2027-07-01");

    const wijzigingen = perContract.get("0000000049")!;
    expect(wijzigingen).toHaveLength(1);
    expect(wijzigingen[0]!.ingangsdatum.toISOString().slice(0, 10)).toBe("2028-01-01");
  });

  it("een BRONGAT op één contract beïnvloedt een ander contract niet", () => {
    const { perContract, issues } = parseEnResolve([
      rij({ Contractnr: "0000000049", Prijs_regelnr: "1", Ingangsdatum_prijsregel: "01-07-2027", Bedrag_vorderingsoort_13: "0" }),
      rij({ Contractnr: "0000000049", Prijs_regelnr: "2", Ingangsdatum_prijsregel: "01-07-2027", Bedrag_vorderingsoort_13: "-250" }),
      rij({ Contractnr: "0000000051", Prijs_regelnr: "1", Ingangsdatum_prijsregel: "01-05-2027", Bedrag_vorderingsoort_13: "-250" }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.contractnummer).toBe("0000000049");
    expect(perContract.get("0000000049")).toEqual([]);
    expect(perContract.get("0000000051")).toHaveLength(1);
    expect(perContract.get("0000000051")![0]!.nieuweKortingPerMaand.toString()).toBe("-250");
  });

  it("een contract zonder enige (toekomstige) kandidaatrij levert een lege lijst, GEEN BRONGAT", () => {
    const { perContract, issues } = parseEnResolve([rij({ Ingangsdatum_prijsregel: "01-01-2020", Bedrag_vorderingsoort_13: "-500" })]);
    expect(issues).toHaveLength(0);
    expect(perContract.get("0000000049")).toEqual([]);
  });

  it("Status wordt NOOIT als resolutiecriterium gebruikt — uniform 'Nieuw' op verleden én toekomst verandert niets aan de uitkomst", () => {
    const { perContract } = parseEnResolve([
      rij({ Prijs_regelnr: "1", Status: "Nieuw", Ingangsdatum_prijsregel: "01-01-2020", Bedrag_vorderingsoort_13: "-500" }),
      rij({ Prijs_regelnr: "2", Status: "Nieuw", Ingangsdatum_prijsregel: "01-07-2027", Bedrag_vorderingsoort_13: "0" }),
    ]);
    expect(perContract.get("0000000049")).toHaveLength(1);
  });

  it("ingangsdatum exact op bronPeildatum telt als geldig (kalenderdag-vergelijking, geen tijdstip-effecten)", () => {
    const { perContract } = parseEnResolve([rij({ Ingangsdatum_prijsregel: "01-09-2026", Bedrag_vorderingsoort_13: "-300" })], BRONPEILDATUM);
    expect(perContract.get("0000000049")).toHaveLength(1);
  });

  it("een ingangsdatum vóór bronPeildatum wordt niet als toekomstige kandidaat meegenomen (dat hoort al verwerkt te zijn in de bevroren rentroll-basis)", () => {
    const { perContract } = parseEnResolve([rij({ Ingangsdatum_prijsregel: "31-08-2026", Bedrag_vorderingsoort_13: "-300" })], BRONPEILDATUM);
    expect(perContract.get("0000000049")).toEqual([]);
  });

  it("bedrijfsnr-isolatie: rijen van een andere administratie in het gedeelde bestand tellen niet mee", () => {
    const { perContract } = parseEnResolve([rij({ Bedrijfsnr: "003", Ingangsdatum_prijsregel: "01-07-2027", Bedrag_vorderingsoort_13: "0" })]);
    expect(perContract.has("0000000049")).toBe(false);
  });

  it("een positief bedrag (buiten de bewezen tekenconventie) wordt niet als NaN afgekeurd door de resolver zelf -- dat is de verantwoordelijkheid van de pure calculator (bepaalKortingBasisPerMaand)", () => {
    // Bewuste architectuurkeuze: deze resolver dedupliceert/groepeert alleen, valideert de
    // tekenconventie niet zelf nogmaals (single point of truth blijft de pure calculator).
    const { perContract } = parseEnResolve([rij({ Ingangsdatum_prijsregel: "01-07-2027", Bedrag_vorderingsoort_13: "500" })]);
    expect(perContract.get("0000000049")).toHaveLength(1);
    expect(perContract.get("0000000049")![0]!.nieuweKortingPerMaand.toString()).toBe("500");
  });
});
