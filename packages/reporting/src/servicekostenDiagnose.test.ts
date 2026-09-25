import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { diagnoseerServicekosten, type ServicekostenDiagnoseBoekingRegel, type ServicekostenDiagnoseRegel } from "./servicekostenDiagnose.js";

function regel(overrides: Partial<ServicekostenDiagnoseRegel> = {}): ServicekostenDiagnoseRegel {
  return {
    bedrijfsnr: "070",
    boekjaar: 2026,
    boekperiode: "01",
    dagboeknummer: "50",
    boekstuknummer: "000001",
    volgnummer: "000001",
    complexnummer: "001",
    unitnummer: "0001",
    contractnummer: "C1",
    huurdernummer: "H1",
    kostensoort: "4300",
    kostensoortOmschrijving: "Onderhoud",
    omschrijving: "Onderhoud dak",
    bedragDebet: new Decimal("100"),
    bedragCredit: new Decimal("0"),
    saldo: new Decimal("100"),
    doorbelasten: "Nee",
    uitsluitingsstatus: "GEEN",
    ...overrides,
  };
}

function boeking(overrides: Partial<ServicekostenDiagnoseBoekingRegel> = {}): ServicekostenDiagnoseBoekingRegel {
  return {
    dagboeknr: "50",
    boekstuknr: "000001",
    volgnr: "000001",
    grootboeknr: "1712",
    bedragDebet: new Decimal("100"),
    bedragCredit: new Decimal("0"),
    ...overrides,
  };
}

describe("diagnoseerServicekosten", () => {
  it("groepeert per kostensoort met debet/credit/saldo/aantal", () => {
    const resultaat = diagnoseerServicekosten(
      [regel({ kostensoort: "4300", bedragDebet: new Decimal("100"), saldo: new Decimal("100") }), regel({ kostensoort: "4300", boekstuknummer: "000002", bedragDebet: new Decimal("50"), saldo: new Decimal("50") })],
      [],
      { bedrijfsnr: "070", boekjaar: 2026, boekperiodeTotEnMet: "06" },
    );
    expect(resultaat.perKostensoort).toHaveLength(1);
    expect(resultaat.perKostensoort[0]?.aantalRegels).toBe(2);
    expect(resultaat.perKostensoort[0]?.saldo.toString()).toBe("150");
  });

  it("signaleert een kostensoort met meerdere verschillende omschrijvingen, zonder te classificeren", () => {
    const resultaat = diagnoseerServicekosten(
      [regel({ kostensoort: "9600", omschrijving: "Afrekening vorig jaar" }), regel({ kostensoort: "9600", boekstuknummer: "000002", omschrijving: "Serviceafrekening 2025" })],
      [],
      { bedrijfsnr: "070", boekjaar: 2026, boekperiodeTotEnMet: "06" },
    );
    expect(resultaat.perKostensoort[0]?.omschrijvingen.voorbeeld).toEqual(["Afrekening vorig jaar", "Serviceafrekening 2025"]);
    expect(resultaat.perKostensoort[0]?.omschrijvingen.aantalTotaal).toBe(2);
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("9600") && c.bericht.includes("2 verschillende omschrijvingen"))).toBe(true);
  });

  it("groepeert per complex en telt regels zonder complexnummer apart", () => {
    const resultaat = diagnoseerServicekosten(
      [regel({ complexnummer: "001" }), regel({ complexnummer: null, boekstuknummer: "000002" })],
      [],
      { bedrijfsnr: "070", boekjaar: 2026, boekperiodeTotEnMet: "06" },
    );
    expect(resultaat.perComplex.map((c) => c.complexnummer)).toEqual([null, "001"]);
    expect(resultaat.controleVereist.some((c) => c.bericht.includes("geen complexnummer"))).toBe(true);
  });

  it("groepeert per unit/contract en telt regels zonder unit én zonder contract apart", () => {
    const resultaat = diagnoseerServicekosten(
      [
        regel({ unitnummer: "0001", contractnummer: "C1" }),
        regel({ unitnummer: null, contractnummer: null, boekstuknummer: "000002" }),
      ],
      [],
      { bedrijfsnr: "070", boekjaar: 2026, boekperiodeTotEnMet: "06" },
    );
    expect(resultaat.perUnitContract).toHaveLength(1);
    expect(resultaat.aantalRegelsZonderUnitOfContract).toBe(1);
  });

  it("koppelt aan boekingen via (dagboeknummer, boekstuknummer, volgnummer) en toont kostensoort<->grootboekrekening, zonder classificatie", () => {
    const resultaat = diagnoseerServicekosten(
      [
        // kostensoort 2000, boekstuk 1 -> koppelt aan boeking op grootboek 1711 (voorschot, per gebruiker)
        regel({ kostensoort: "2000", dagboeknummer: "50", boekstuknummer: "000001", volgnummer: "000001", saldo: new Decimal("-500") }),
        // kostensoort 4300, boekstuk 2 -> koppelt aan boeking op grootboek 1712 (werkelijke kosten, per gebruiker)
        regel({ kostensoort: "4300", dagboeknummer: "50", boekstuknummer: "000002", volgnummer: "000001", saldo: new Decimal("100") }),
        // kostensoort 9600, boekstuk 3 -> geen matchende boeking
        regel({ kostensoort: "9600", dagboeknummer: "50", boekstuknummer: "000003", volgnummer: "000001", saldo: new Decimal("-50") }),
      ],
      [
        boeking({ dagboeknr: "50", boekstuknr: "000001", volgnr: "000001", grootboeknr: "1711" }),
        boeking({ dagboeknr: "50", boekstuknr: "000002", volgnr: "000001", grootboeknr: "1712" }),
      ],
      { bedrijfsnr: "070", boekjaar: 2026, boekperiodeTotEnMet: "06" },
    );

    expect(resultaat.boekingKoppeling.aantalGekoppeld).toBe(2);
    expect(resultaat.boekingKoppeling.aantalNietGekoppeld).toBe(1);
    expect(resultaat.boekingKoppeling.voorbeeldenNietGekoppeld).toHaveLength(1);
    expect(resultaat.boekingKoppeling.voorbeeldenNietGekoppeld[0]?.kostensoort).toBe("9600");

    const gekoppeld2000 = resultaat.boekingKoppeling.perKostensoortGrootboekrekening.find((r) => r.kostensoort === "2000");
    expect(gekoppeld2000?.grootboekrekening).toBe("1711");
    const gekoppeld4300 = resultaat.boekingKoppeling.perKostensoortGrootboekrekening.find((r) => r.kostensoort === "4300");
    expect(gekoppeld4300?.grootboekrekening).toBe("1712");

    // Puur signalerend: geen enkel veld classificeert 2000 als "voorschot" of 4300 als "werkelijke kosten".
    expect(JSON.stringify(resultaat)).not.toMatch(/voorschot|werkelijke kosten/i);
  });

  it("signaleert boekstukken met verschillende kostensoorten/complexen binnen hetzelfde boekstuk, zonder te corrigeren", () => {
    const resultaat = diagnoseerServicekosten(
      [
        regel({ dagboeknummer: "50", boekstuknummer: "000010", volgnummer: "000001", kostensoort: "4300", complexnummer: "001" }),
        regel({ dagboeknummer: "50", boekstuknummer: "000010", volgnummer: "000002", kostensoort: "9600", complexnummer: "001" }),
      ],
      [],
      { bedrijfsnr: "070", boekjaar: 2026, boekperiodeTotEnMet: "06" },
    );
    expect(resultaat.nietEenduidigeRegels).toHaveLength(1);
    expect(resultaat.nietEenduidigeRegels[0]?.reden).toContain("verschillende kostensoorten");
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("boekstuk"))).toBe(true);
  });

  it("verzamelt distincte doorbelasten-waarden zonder ze te interpreteren", () => {
    const resultaat = diagnoseerServicekosten(
      [regel({ doorbelasten: "Ja" }), regel({ doorbelasten: "Nee", boekstuknummer: "000002" }), regel({ doorbelasten: null, boekstuknummer: "000003" })],
      [],
      { bedrijfsnr: "070", boekjaar: 2026, boekperiodeTotEnMet: "06" },
    );
    expect(resultaat.doorbelastenWaardenGezien).toEqual(["(leeg)", "Ja", "Nee"]);
  });

  it("geeft de kostensoort<->omschrijving-combinaties als aparte, distincte rijen", () => {
    const resultaat = diagnoseerServicekosten(
      [regel({ kostensoort: "4300", omschrijving: "Onderhoud dak" }), regel({ kostensoort: "4300", omschrijving: "Onderhoud dak", boekstuknummer: "000002" }), regel({ kostensoort: "4300", omschrijving: "Onderhoud lift", boekstuknummer: "000003" })],
      [],
      { bedrijfsnr: "070", boekjaar: 2026, boekperiodeTotEnMet: "06" },
    );
    expect(resultaat.kostensoortOmschrijvingCombinaties).toEqual([
      { kostensoort: "4300", omschrijving: "Onderhoud dak", aantalRegels: 2 },
      { kostensoort: "4300", omschrijving: "Onderhoud lift", aantalRegels: 1 },
    ]);
  });

  it("meldt regels met een niet-GEEN uitsluitingsstatus als informatief, zonder ze uit te sluiten", () => {
    const resultaat = diagnoseerServicekosten(
      [regel({ kostensoort: "9600", uitsluitingsstatus: "UITGESLOTEN_AFREKENING_VORIG_JAAR" })],
      [],
      { bedrijfsnr: "070", boekjaar: 2026, boekperiodeTotEnMet: "06" },
    );
    expect(resultaat.aantalRegelsTotaal).toBe(1);
    expect(resultaat.controleVereist.some((c) => c.ernst === "INFORMATIEF" && c.bericht.includes("UITGESLOTEN_AFREKENING_VORIG_JAAR"))).toBe(true);
  });
});
