import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { diagnoseerContractVerhogingen, type CvdContractContext, type CvdVerhogingsregel } from "./contractVerhogingenDiagnose.js";

const BRON_PEILDATUM = new Date("2026-07-31T00:00:00.000Z");

function regel(overrides: Partial<CvdVerhogingsregel> = {}): CvdVerhogingsregel {
  return {
    bedrijfsnr: "070",
    contractnummer: "C1",
    huurdernummer: "H1",
    huurderNaam: "Test Huurder BV",
    complexnummer: "001",
    unitnummer: "0001",
    jaar: "2026",
    periode: "01",
    status: "Verwerkt",
    verhogingsmethode: "Prijsindex",
    waarde: new Decimal(4),
    indexeringOud: null,
    indexeringNieuw: null,
    totaalOud: new Decimal(10000),
    totaalNieuw: new Decimal(10400),
    vsBedragen: [{ vs: "VS_01", bedragOud: new Decimal(750), bedragBerekend: null, bedragNieuw: new Decimal(780) }],
    toekomstigeVerhoging: "Nee",
    regelnummer: "1",
    aanmaakwijze: null,
    incidenteel: null,
    iahVerhogingToegepast: null,
    prijsindexOpslagToegepast: null,
    prijsindexOpslagPercentage: null,
    cbsAfrondingToegepast: null,
    tabeljaar: null,
    prijsindextabel: null,
    ...overrides,
  };
}

function contractContext(overrides: Partial<CvdContractContext> = {}): CvdContractContext {
  return {
    contractnummer: "C1",
    huurderNaam: "Test Huurder BV",
    ingangsdatum: new Date("2020-01-01T00:00:00.000Z"),
    volgendeIndexeringsdatum: new Date("2027-07-01T00:00:00.000Z"),
    brutoJaarhuur: new Decimal(9360),
    huurkorting: null,
    ...overrides,
  };
}

describe("diagnoseerContractVerhogingen", () => {
  it("rapporteert koppelingsstatistieken: bekende contracten zonder historie, volledige regels zonder contractmatch", () => {
    const resultaat = diagnoseerContractVerhogingen(
      ["Bedrijfsnr", "Contract"],
      [regel({ contractnummer: "C1" }), regel({ contractnummer: "C-onbekend", huurderNaam: "Andere BV" })],
      [contractContext({ contractnummer: "C1" }), contractContext({ contractnummer: "C2" })],
      BRON_PEILDATUM,
    );

    expect(resultaat.koppeling.aantalRegels070).toBe(2);
    expect(resultaat.koppeling.aantalUniekeContracten070InBron).toBe(1);
    expect(resultaat.koppeling.contractenZonderVerhogingshistorie).toEqual(["C2"]);
    expect(resultaat.koppeling.verhogingsregelsZonderContractmatch).toHaveLength(1);
    expect(resultaat.koppeling.verhogingsregelsZonderContractmatch[0]!.huurderNaam).toBe("Andere BV");
  });

  it("sorteert de historie chronologisch op jaar+periode, ongeacht invoervolgorde, en levert een jjjj-pp-weergave zonder Date te verzinnen", () => {
    const resultaat = diagnoseerContractVerhogingen(
      [],
      [regel({ jaar: "2026", periode: "07" }), regel({ jaar: "2024", periode: "01" }), regel({ jaar: "2025", periode: "12" })],
      [contractContext()],
      BRON_PEILDATUM,
    );
    const historie = resultaat.historiePerContract[0]!.regels;
    expect(historie.map((r) => r.jaarPeriodeWeergave)).toEqual(["2024-01", "2025-12", "2026-07"]);
  });

  it("gebruikt Regelnummer als tiebreaker bij een gelijke jaar+periode-sleutel, en detecteert een inconsistente volgorde", () => {
    const consistent = diagnoseerContractVerhogingen(
      [],
      [regel({ jaar: "2026", periode: "01", regelnummer: "2" }), regel({ jaar: "2026", periode: "01", regelnummer: "1" })],
      [contractContext()],
      BRON_PEILDATUM,
    );
    expect(consistent.historiePerContract[0]!.regels.map((r) => r.regel.regelnummer)).toEqual(["1", "2"]);
    expect(consistent.historiePerContract[0]!.regelnummerVolgordeConsistent).toBe(true);

    const inconsistent = diagnoseerContractVerhogingen(
      [],
      [regel({ jaar: "2024", periode: "01", regelnummer: "5" }), regel({ jaar: "2026", periode: "01", regelnummer: "1" })],
      [contractContext()],
      BRON_PEILDATUM,
    );
    expect(inconsistent.historiePerContract[0]!.regelnummerVolgordeConsistent).toBe(false);
  });

  it("berekent mutatiePercentageTotaal met Decimal-precisie en het verschil met Waarde", () => {
    const resultaat = diagnoseerContractVerhogingen([], [regel({ totaalOud: new Decimal(10000), totaalNieuw: new Decimal(10400), waarde: new Decimal(4) })], [contractContext()], BRON_PEILDATUM);
    const analyse = resultaat.historiePerContract[0]!.regels[0]!;
    expect(analyse.mutatiePercentageTotaal?.toString()).toBe("4");
    expect(analyse.verschilWaardeMetMutatieTotaal?.toString()).toBe("0");
  });

  it("laat mutatiePercentageTotaal onbekend (null) bij Totaal_Oud = 0 — nooit delen door nul", () => {
    const resultaat = diagnoseerContractVerhogingen([], [regel({ totaalOud: new Decimal(0), totaalNieuw: new Decimal(500) })], [contractContext()], BRON_PEILDATUM);
    expect(resultaat.historiePerContract[0]!.regels[0]!.mutatiePercentageTotaal).toBeNull();
  });

  it("markeert voorOfOpBronPeildatum puur op datum (jaar+periode), niet op Status", () => {
    const resultaat = diagnoseerContractVerhogingen(
      [],
      [regel({ jaar: "2026", periode: "07", status: "Gepland" }), regel({ jaar: "2027", periode: "01", status: "Verwerkt" })],
      [contractContext()],
      BRON_PEILDATUM,
    );
    const historie = resultaat.historiePerContract[0]!.regels;
    expect(historie.find((r) => r.regel.jaar === "2026")?.voorOfOpBronPeildatum).toBe(true);
    expect(historie.find((r) => r.regel.jaar === "2027")?.voorOfOpBronPeildatum).toBe(false);
  });

  it("kiest als reconciliatiekandidaat de chronologisch laatste regel vóór/op bronPeildatum, en vergelijkt elke VS-code (ongeschaald) tegen rentroll", () => {
    const resultaat = diagnoseerContractVerhogingen(
      [],
      [
        regel({ jaar: "2025", periode: "01", vsBedragen: [{ vs: "VS_01", bedragOud: new Decimal(667), bedragBerekend: null, bedragNieuw: new Decimal(750) }] }),
        regel({ jaar: "2026", periode: "01", vsBedragen: [{ vs: "VS_01", bedragOud: new Decimal(750), bedragBerekend: null, bedragNieuw: new Decimal(780) }] }),
        regel({ jaar: "2027", periode: "01", vsBedragen: [{ vs: "VS_01", bedragOud: new Decimal(780), bedragBerekend: null, bedragNieuw: new Decimal(812) }] }), // ná bronPeildatum, mag geen kandidaat zijn.
      ],
      [contractContext({ brutoJaarhuur: new Decimal(9360), huurkorting: new Decimal(-500) })],
      BRON_PEILDATUM,
    );

    const rec = resultaat.reconciliatie[0]!;
    expect(rec.kandidaatLaatsteRegel?.regel.jaar).toBe("2026");
    expect(rec.vsVergelijking).toHaveLength(1);
    // Ongeschaald: 780 (maandbedrag) vs 9360 (jaarbedrag) — verschil blijft groot, dit is precies waarom vs01Reconciliatie apart × 12 rekent.
    expect(rec.vsVergelijking[0]!.verschilMetBrutoJaarhuur?.toString()).toBe("-8580");
  });

  it("meldt expliciet geen kandidaat als geen enkele regel vóór/op bronPeildatum valt", () => {
    const resultaat = diagnoseerContractVerhogingen([], [regel({ jaar: "2028", periode: "01" })], [contractContext()], BRON_PEILDATUM);
    const rec = resultaat.reconciliatie[0]!;
    expect(rec.kandidaatLaatsteRegel).toBeNull();
    expect(rec.redenGeenKandidaat).toContain("vóór/op bronPeildatum");
  });

  describe("punt 1: vs01Reconciliatie (× 12)", () => {
    it("berekent Bedrag_Nieuw_VS_01 × 12 en vergelijkt exact met rentroll bruto jaarhuur", () => {
      const resultaat = diagnoseerContractVerhogingen(
        [],
        [regel({ jaar: "2026", periode: "01", vsBedragen: [{ vs: "VS_01", bedragOud: new Decimal(750), bedragBerekend: null, bedragNieuw: new Decimal(780) }] })],
        [contractContext({ brutoJaarhuur: new Decimal(9360) })],
        BRON_PEILDATUM,
      );
      const r = resultaat.vs01Reconciliatie.perContract[0]!;
      expect(r.kandidaatGevonden).toBe(true);
      expect(r.bedragNieuwVs01MaalTwaalf?.toString()).toBe("9360");
      expect(r.verschilEuro?.toString()).toBe("0");
      expect(resultaat.vs01Reconciliatie.aantalExacteMatches).toBe(1);
      expect(resultaat.vs01Reconciliatie.aantalAfwijkingen).toBe(0);
    });

    it("rapporteert een afwijking zonder af te ronden of te verklaren", () => {
      const resultaat = diagnoseerContractVerhogingen(
        [],
        [regel({ jaar: "2026", periode: "01", vsBedragen: [{ vs: "VS_01", bedragOud: new Decimal(750), bedragBerekend: null, bedragNieuw: new Decimal(781.11) }] })],
        [contractContext({ brutoJaarhuur: new Decimal(9360) })],
        BRON_PEILDATUM,
      );
      const r = resultaat.vs01Reconciliatie.perContract[0]!;
      expect(r.bedragNieuwVs01MaalTwaalf?.toString()).toBe("9373.32");
      expect(r.verschilEuro?.toString()).toBe("13.32");
      expect(resultaat.vs01Reconciliatie.aantalAfwijkingen).toBe(1);
      expect(resultaat.vs01Reconciliatie.grootsteAbsoluteAfwijking?.toString()).toBe("13.32");
    });
  });

  it("punt 2: vsWijzigingStatistiek telt per VS-code hoeveel regels daadwerkelijk wijzigen", () => {
    const resultaat = diagnoseerContractVerhogingen(
      [],
      [
        regel({ vsBedragen: [{ vs: "VS_01", bedragOud: new Decimal(750), bedragBerekend: null, bedragNieuw: new Decimal(780) }] }),
        regel({ vsBedragen: [{ vs: "VS_01", bedragOud: new Decimal(780), bedragBerekend: null, bedragNieuw: new Decimal(780) }] }), // geen wijziging.
        regel({ vsBedragen: [{ vs: "VS_03", bedragOud: new Decimal(100), bedragBerekend: null, bedragNieuw: new Decimal(100) }] }),
      ],
      [contractContext()],
      BRON_PEILDATUM,
    );
    const vs01Stat = resultaat.vsWijzigingStatistiek.find((v) => v.vs === "VS_01")!;
    expect(vs01Stat).toEqual({ vs: "VS_01", aantalRegelsMetBeideBedragen: 2, aantalRegelsMetWijziging: 1, aantalRegelsZonderWijziging: 1 });
    const vs03Stat = resultaat.vsWijzigingStatistiek.find((v) => v.vs === "VS_03")!;
    expect(vs03Stat).toEqual({ vs: "VS_03", aantalRegelsMetBeideBedragen: 1, aantalRegelsMetWijziging: 0, aantalRegelsZonderWijziging: 1 });
  });

  describe("punt 3: waardeAnalyse", () => {
    it("berekent percentageVs01 en vergelijkt exact met Waarde", () => {
      const resultaat = diagnoseerContractVerhogingen(
        [],
        [regel({ waarde: new Decimal(4), vsBedragen: [{ vs: "VS_01", bedragOud: new Decimal(750), bedragBerekend: null, bedragNieuw: new Decimal(780) }] })],
        [contractContext()],
        BRON_PEILDATUM,
      );
      const w = resultaat.waardeAnalyse.regels[0]!;
      expect(w.percentageVs01?.toString()).toBe("4");
      expect(w.verschilWaardeMetPercentageVs01?.toString()).toBe("0");
      expect(resultaat.waardeAnalyse.aantalExacteMatchesMetPercentageVs01).toBe(1);
    });

    it("signaleert Waarde = 0 terwijl VS_01 wél wijzigt, zonder een oorzaak aan te nemen", () => {
      const resultaat = diagnoseerContractVerhogingen(
        [],
        [regel({ waarde: new Decimal(0), vsBedragen: [{ vs: "VS_01", bedragOud: new Decimal(750), bedragBerekend: null, bedragNieuw: new Decimal(780) }] })],
        [contractContext()],
        BRON_PEILDATUM,
      );
      expect(resultaat.waardeAnalyse.aantalWaardeNulMaarVs01Wijzigt).toBe(1);
      expect(resultaat.waardeAnalyse.regels[0]!.waardeIsNulMaarVs01Wijzigt).toBe(true);
    });

    it("negeert regels zonder positieve Bedrag_oud_VS_01 (geen deling door nul/negatief)", () => {
      const resultaat = diagnoseerContractVerhogingen(
        [],
        [regel({ vsBedragen: [{ vs: "VS_01", bedragOud: new Decimal(0), bedragBerekend: null, bedragNieuw: new Decimal(780) }] })],
        [contractContext()],
        BRON_PEILDATUM,
      );
      expect(resultaat.waardeAnalyse.aantalRegelsGeanalyseerd).toBe(0);
    });
  });

  it("punt 4: rapporteert voor een contract zonder verhogingshistorie de bekende feiten en een puur datumsignaal, geen classificatie", () => {
    const resultaat = diagnoseerContractVerhogingen(
      [],
      [regel({ contractnummer: "C-oud", jaar: "2024", periode: "06" })],
      [contractContext({ contractnummer: "C-oud" }), contractContext({ contractnummer: "C-nieuw", ingangsdatum: new Date("2026-04-01T00:00:00.000Z"), huurderNaam: "Nieuwe Huurder" })],
      BRON_PEILDATUM,
    );
    const onderzoek = resultaat.contractenZonderHistorieOnderzoek.find((c) => c.contractnummer === "C-nieuw")!;
    expect(onderzoek.huurderNaam).toBe("Nieuwe Huurder");
    expect(onderzoek.portefeuilleLaatsteVerhogingssleutel).toBe("202406");
    expect(onderzoek.ingangNaLaatstePortefeuilleVerhoging).toBe(true);
  });

  it("punt 5/algemeen: distinct Status/Toekomstige_verhoging-waarden worden geïnventariseerd, geen betekenis aangenomen", () => {
    const resultaat = diagnoseerContractVerhogingen(
      [],
      [regel({ status: "Verwerkt", toekomstigeVerhoging: "Nee" }), regel({ status: "Gepland", toekomstigeVerhoging: "Ja" })],
      [contractContext()],
      BRON_PEILDATUM,
    );
    expect(resultaat.distinctStatusWaarden).toEqual(["Gepland", "Verwerkt"]);
    expect(resultaat.distinctToekomstigeVerhogingWaarden).toEqual(["Ja", "Nee"]);
  });

  it("levert een leeg-maar-geldig resultaat (bronBestaat blijft aan de aanroeper) bij lege invoer", () => {
    const resultaat = diagnoseerContractVerhogingen([], [], [], null);
    expect(resultaat.bronBestaat).toBe(true);
    expect(resultaat.historiePerContract).toEqual([]);
    expect(resultaat.vs01Reconciliatie.perContract).toEqual([]);
  });
});
