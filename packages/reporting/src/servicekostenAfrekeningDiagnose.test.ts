import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { diagnoseerServicekostenAfrekening, type ServicekostenAfrekeningDiagnoseRegel } from "./servicekostenAfrekeningDiagnose.js";

function regel(overrides: Partial<ServicekostenAfrekeningDiagnoseRegel> = {}): ServicekostenAfrekeningDiagnoseRegel {
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
    kostensoort: "0014",
    kostensoortOmschrijving: "Onderhoud",
    omschrijving: "Onderhoud dak",
    bedragDebet: new Decimal("100"),
    bedragCredit: new Decimal("0"),
    saldo: new Decimal("100"),
    kostensoortSoort: "Kosten",
    jaarAfrekening: null,
    jaarSvAfrekening: null,
    perSvAfrekening: null,
    periodeAfrekening: null,
    svAfrekeningSoort: null,
    svAfrekeningSoortOmschrijving: null,
    svAfrekeningVlgnr: null,
    vdsrtOpbrengsten: null,
    vdsrtOmschr: null,
    bronBoekingSaldo: null,
    ...overrides,
  };
}

describe("diagnoseerServicekostenAfrekening", () => {
  it("groepeert per Kostensoort_Soort, inclusief een '(leeg)'-groep voor null", () => {
    const resultaat = diagnoseerServicekostenAfrekening([
      regel({ kostensoortSoort: "Kosten", bedragDebet: new Decimal("100"), saldo: new Decimal("100") }),
      regel({ kostensoortSoort: "Voorschotten", boekstuknummer: "2", bedragDebet: new Decimal("0"), bedragCredit: new Decimal("50"), saldo: new Decimal("-50") }),
      regel({ kostensoortSoort: null, boekstuknummer: "3" }),
    ]);
    const soorten = resultaat.perKostensoortSoort.map((s) => s.kostensoortSoortWaarde);
    expect(soorten).toEqual(["(leeg)", "Kosten", "Voorschotten"]);
    const kosten = resultaat.perKostensoortSoort.find((s) => s.kostensoortSoortWaarde === "Kosten")!;
    expect(kosten.debet.toString()).toBe("100");
  });

  it("signaleert een onverwachte Kostensoort_Soort-waarde zonder de rij te verwerpen", () => {
    const resultaat = diagnoseerServicekostenAfrekening([regel({ kostensoortSoort: "Correctie" })]);
    expect(resultaat.aantalRegelsTotaal).toBe(1);
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes('Onverwachte Kostensoort_Soort-waarde "Correctie"'))).toBe(true);
  });

  it("bouwt de voorschotten-sectie met bevat2000 en per-contract/huurder-uitsplitsing", () => {
    const resultaat = diagnoseerServicekostenAfrekening([
      regel({ kostensoortSoort: "Voorschotten", kostensoort: "2000", contractnummer: "C1", huurdernummer: "H1", bedragCredit: new Decimal("500"), bedragDebet: new Decimal("0"), saldo: new Decimal("-500") }),
      regel({ kostensoortSoort: "Voorschotten", kostensoort: "2000", boekstuknummer: "2", contractnummer: null, huurdernummer: null }),
    ]);
    expect(resultaat.voorschotten.bevat2000).toBe(true);
    expect(resultaat.voorschotten.aantalRegels).toBe(2);
    expect(resultaat.voorschotten.aantalRegelsZonderContractOfHuurder).toBe(1);
    expect(resultaat.voorschotten.perContractHuurder.aantalTotaal).toBe(1);
    expect(resultaat.kosten.aantalRegels).toBe(0);
  });

  it("meldt informatief als de kosten- of voorschotten-sectie leeg blijft terwijl er wel andere Kostensoort_Soort-waarden voorkomen", () => {
    const resultaat = diagnoseerServicekostenAfrekening([regel({ kostensoortSoort: "Nvt" })]);
    expect(resultaat.voorschotten.aantalRegels).toBe(0);
    expect(resultaat.kosten.aantalRegels).toBe(0);
    expect(resultaat.controleVereist.some((c) => c.bericht.includes('Kostensoort_Soort exact "Voorschotten"'))).toBe(true);
    expect(resultaat.controleVereist.some((c) => c.bericht.includes('Kostensoort_Soort exact "Kosten"'))).toBe(true);
  });

  it("bouwt de kostensoort9600-sectie met per-huurder-totalen en afrekeningsvelden, ongeacht Kostensoort_Soort", () => {
    const resultaat = diagnoseerServicekostenAfrekening([
      regel({
        kostensoort: "9600", kostensoortSoort: "Nvt", huurdernummer: "H1", contractnummer: "C1",
        bedragCredit: new Decimal("300"), bedragDebet: new Decimal("0"), saldo: new Decimal("-300"),
        jaarAfrekening: "2025", svAfrekeningSoort: "AFR",
      }),
      regel({ kostensoort: "0014", kostensoortSoort: "Kosten", boekstuknummer: "2" }), // moet NIET meetellen
    ]);
    expect(resultaat.kostensoort9600.aantalRegels).toBe(1);
    expect(resultaat.kostensoort9600.saldo.toString()).toBe("-300");
    expect(resultaat.kostensoort9600.kostensoortSoortWaardenGezien).toEqual(["Nvt"]);
    expect(resultaat.kostensoort9600.perHuurder.voorbeeld[0]?.huurdernummer).toBe("H1");
    expect(resultaat.kostensoort9600.regelsMetAfrekeningsvelden.voorbeeld[0]).toMatchObject({ jaarAfrekening: "2025", svAfrekeningSoort: "AFR" });
  });

  it("analyseert een afrekeningsveld: aantalNietLeeg, distincte waarden, en of het bij 9600 en/of andere kostensoorten voorkomt", () => {
    const resultaat = diagnoseerServicekostenAfrekening([
      regel({ kostensoort: "9600", jaarAfrekening: "2025" }),
      regel({ kostensoort: "0014", boekstuknummer: "2", jaarAfrekening: null }),
    ]);
    const veld = resultaat.afrekeningsveldenAnalyse.find((v) => v.veld === "Service_BK_Jaar_Afrekening")!;
    expect(veld.aantalNietLeeg).toBe(1);
    expect(veld.aantalDistinct).toBe(1);
    expect(veld.distincteWaardenVoorbeeld).toEqual(["2025"]);
    expect(veld.aantalRegelsPerWaarde).toEqual({ "2025": 1 });
    expect(veld.komtVoorBijKostensoort9600).toBe(true);
    expect(veld.komtVoorBijAndereKostensoorten).toBe(false);
  });

  it("begrenst het aantal omschrijvingen per kostensoort, met het werkelijke totaal apart gerapporteerd (regressie: 700+ omschrijvingen bij 070 mochten niet allemaal in de JSON belanden)", () => {
    const regels = Array.from({ length: 15 }, (_, i) => regel({ boekstuknummer: String(i), omschrijving: `Prol ${i}` }));
    const resultaat = diagnoseerServicekostenAfrekening(regels);
    const kostensoort = resultaat.kosten.perKostensoort.voorbeeld.find((k) => k.kostensoort === "0014")!;
    expect(kostensoort.omschrijvingen.aantalTotaal).toBe(15);
    expect(kostensoort.omschrijvingen.voorbeeld).toHaveLength(10);
  });

  it("begrenst distincte waarden op 30 met het werkelijke totaal apart gerapporteerd", () => {
    const regels = Array.from({ length: 45 }, (_, i) => regel({ boekstuknummer: String(i), jaarAfrekening: `20${String(i).padStart(2, "0")}` }));
    const resultaat = diagnoseerServicekostenAfrekening(regels);
    const veld = resultaat.afrekeningsveldenAnalyse.find((v) => v.veld === "Service_BK_Jaar_Afrekening")!;
    expect(veld.aantalDistinct).toBe(45);
    expect(veld.distincteWaardenVoorbeeld).toHaveLength(30);
  });

  it("bepaalt het tekenpatroon per Kostensoort_Soort en signaleert regels met debet én credit niet-nul", () => {
    const resultaat = diagnoseerServicekostenAfrekening([
      regel({ kostensoortSoort: "Kosten", bedragDebet: new Decimal("100"), bedragCredit: new Decimal("0") }),
      regel({ kostensoortSoort: "Kosten", boekstuknummer: "2", bedragDebet: new Decimal("0"), bedragCredit: new Decimal("50") }),
      regel({ kostensoortSoort: "Kosten", boekstuknummer: "3", bedragDebet: new Decimal("10"), bedragCredit: new Decimal("5") }),
    ]);
    const patroon = resultaat.tekenpatroon.find((p) => p.kostensoortSoortWaarde === "Kosten")!;
    expect(patroon.aantalAlleenDebet).toBe(1);
    expect(patroon.aantalAlleenCredit).toBe(1);
    expect(patroon.aantalBeideNietNul).toBe(1);
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("debet als credit niet-nul"))).toBe(true);
  });

  it("vergelijkt Service_Boeking_Saldo met het herberekende saldo via Decimal.equals, ongevoelig voor notatieverschillen", () => {
    const resultaat = diagnoseerServicekostenAfrekening([
      regel({ bedragDebet: new Decimal("100.00"), bedragCredit: new Decimal("0"), saldo: new Decimal("100"), bronBoekingSaldo: new Decimal("100") }),
      regel({ boekstuknummer: "2", bedragDebet: new Decimal("100"), bedragCredit: new Decimal("0"), saldo: new Decimal("100"), bronBoekingSaldo: new Decimal("999") }),
      regel({ boekstuknummer: "3", bronBoekingSaldo: null }), // niet meegeteld
    ]);
    expect(resultaat.bronSaldoVsHerberekend.aantalVergeleken).toBe(2);
    expect(resultaat.bronSaldoVsHerberekend.aantalGelijk).toBe(1);
    expect(resultaat.bronSaldoVsHerberekend.aantalAfwijkend).toBe(1);
    expect(resultaat.bronSaldoVsHerberekend.voorbeeldenAfwijkend.voorbeeld[0]?.bronSaldo.toString()).toBe("999");
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("Service_Boeking_Saldo"))).toBe(true);
  });

  it("meldt kostensoort 9600 informatief zodra er regels voor zijn, als expliciet onderzoeksfilter", () => {
    const resultaat = diagnoseerServicekostenAfrekening([regel({ kostensoort: "9600", kostensoortSoort: "Nvt" })]);
    expect(resultaat.controleVereist.some((c) => c.ernst === "INFORMATIEF" && c.bericht.startsWith("Kostensoort 9600:"))).toBe(true);
  });
});
