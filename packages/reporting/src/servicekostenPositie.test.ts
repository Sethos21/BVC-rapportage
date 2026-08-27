import Decimal from "decimal.js";
import { STANDAARD_PARAMETERS } from "@bvc/config";
import { describe, expect, it } from "vitest";
import {
  bepaalServicekostenStroom,
  samenstelServicekostenPositie,
  type Servicekostenregel,
  type ServicekostenBoekingRegel,
  type ServicekostenPositieInvoer,
} from "./servicekostenPositie.js";

function regel(overrides: Partial<Servicekostenregel> = {}): Servicekostenregel {
  return {
    bedrijfsnr: "070",
    boekjaar: 2026,
    boekperiode: "01",
    dagboeknummer: "50",
    boekstuknummer: "1",
    volgnummer: "1",
    complexnummer: "001",
    unitnummer: "0001",
    contractnummer: "C1",
    huurdernummer: "H1",
    kostensoort: "0101",
    bedragDebet: new Decimal("100"),
    bedragCredit: new Decimal("0"),
    saldo: new Decimal("100"),
    kostensoortSoort: "Kosten",
    jaarSvAfrekening: null,
    ...overrides,
  };
}

function boeking(overrides: Partial<ServicekostenBoekingRegel> = {}): ServicekostenBoekingRegel {
  return {
    boekjaar: 2026,
    boekperiode: "01",
    dagboeknr: "50",
    boekstuknr: "1",
    volgnr: "1",
    grootboeknr: "1712",
    bedragDebet: new Decimal("100"),
    bedragCredit: new Decimal("0"),
    saldo: new Decimal("100"),
    ...overrides,
  };
}

function invoer(overrides: Partial<ServicekostenPositieInvoer> = {}): ServicekostenPositieInvoer {
  return {
    administratieNaam: "Rooise Zoom",
    bedrijfsnr: "070",
    boekjaar: 2026,
    boekperiodeVan: "01",
    boekperiodeTotEnMet: "06",
    gegenereerdOp: new Date("2026-08-27T00:00:00.000Z"),
    servicekosten: [],
    boekingen: [],
    doelrekeningen: ["1711", "1712"],
    servicekostenParams: STANDAARD_PARAMETERS.servicekosten,
    ...overrides,
  };
}

describe("bepaalServicekostenStroom (dubbele classificatie/vangrail)", () => {
  it("classificeert Kosten/Voorschotten via Kostensoort_Soort als de kostensoort niet is uitgesloten", () => {
    expect(bepaalServicekostenStroom({ kostensoort: "0101", kostensoortSoort: "Kosten" }, STANDAARD_PARAMETERS.servicekosten)).toEqual({ stroom: "WERKELIJKE_KOSTEN", controleBericht: null });
    expect(bepaalServicekostenStroom({ kostensoort: "2000", kostensoortSoort: "Voorschotten" }, STANDAARD_PARAMETERS.servicekosten)).toEqual({ stroom: "VOORSCHOT", controleBericht: null });
  });

  it("classificeert een uitgesloten kostensoort (9600) als AFREKENING_VOORGAAND_JAAR wanneer Kostensoort_Soort 'Nvt' bevestigt", () => {
    const resultaat = bepaalServicekostenStroom({ kostensoort: "9600", kostensoortSoort: "Nvt" }, STANDAARD_PARAMETERS.servicekosten);
    expect(resultaat).toEqual({ stroom: "AFREKENING_VOORGAAND_JAAR", controleBericht: null });
  });

  it("VANGRAIL: een uitgesloten kostensoort met een andere Kostensoort_Soort dan 'Nvt' krijgt een controlebericht, maar blijft AFREKENING_VOORGAAND_JAAR", () => {
    const resultaat = bepaalServicekostenStroom({ kostensoort: "9600", kostensoortSoort: "Kosten" }, STANDAARD_PARAMETERS.servicekosten);
    expect(resultaat.stroom).toBe("AFREKENING_VOORGAAND_JAAR");
    expect(resultaat.controleBericht).toContain("i.p.v. het verwachte");
  });

  it("VANGRAIL: 'Nvt' bij een NIET-uitgesloten kostensoort wordt ONBEKEND, niet stilzwijgend als afrekening behandeld", () => {
    const resultaat = bepaalServicekostenStroom({ kostensoort: "0101", kostensoortSoort: "Nvt" }, STANDAARD_PARAMETERS.servicekosten);
    expect(resultaat.stroom).toBe("ONBEKEND");
    expect(resultaat.controleBericht).toContain("classificatie onbekend");
  });

  it("VANGRAIL: een onbekende of ontbrekende Kostensoort_Soort-waarde bij een niet-uitgesloten kostensoort wordt ONBEKEND", () => {
    expect(bepaalServicekostenStroom({ kostensoort: "0101", kostensoortSoort: null }, STANDAARD_PARAMETERS.servicekosten).stroom).toBe("ONBEKEND");
    expect(bepaalServicekostenStroom({ kostensoort: "0101", kostensoortSoort: "Iets anders" }, STANDAARD_PARAMETERS.servicekosten).stroom).toBe("ONBEKEND");
  });
});

describe("samenstelServicekostenPositie — A. Actuele positie", () => {
  it("telt kosten en voorschotten OP (nooit aftrekken) — voorschotten zijn credit/negatief", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ kostensoort: "0101", kostensoortSoort: "Kosten", saldo: new Decimal("300"), bedragDebet: new Decimal("300") }),
          regel({ boekstuknummer: "2", kostensoort: "2000", kostensoortSoort: "Voorschotten", saldo: new Decimal("-500"), bedragDebet: new Decimal("0"), bedragCredit: new Decimal("500") }),
        ],
      }),
    );
    expect(resultaat.actuelePositie.kostenSaldo.toString()).toBe("300");
    expect(resultaat.actuelePositie.voorschottenSaldo.toString()).toBe("-500");
    // 300 + (-500) = -200, NIET 300 - (-500) = 800.
    expect(resultaat.actuelePositie.actueelSaldo.toString()).toBe("-200");
    expect(resultaat.actuelePositie.status).toBe("VOORSCHOTTEN_HOGER_DAN_KOSTEN");
  });

  it("geeft KOSTEN_HOGER_DAN_VOORSCHOTTEN en IN_EVENWICHT correct terug", () => {
    const hoger = samenstelServicekostenPositie(invoer({ servicekosten: [regel({ saldo: new Decimal("100") })] }));
    expect(hoger.actuelePositie.status).toBe("KOSTEN_HOGER_DAN_VOORSCHOTTEN");

    const evenwicht = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ kostensoortSoort: "Kosten", saldo: new Decimal("100") }),
          regel({ boekstuknummer: "2", kostensoort: "2000", kostensoortSoort: "Voorschotten", saldo: new Decimal("-100") }),
        ],
      }),
    );
    expect(evenwicht.actuelePositie.status).toBe("IN_EVENWICHT");
  });

  it("groepeert per complex en telt regels zonder complexnummer/contract-huurder apart, zonder ze als fout te melden voor Kosten", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ complexnummer: "001", saldo: new Decimal("100") }),
          regel({ boekstuknummer: "2", complexnummer: null, contractnummer: null, huurdernummer: null, saldo: new Decimal("50") }),
        ],
      }),
    );
    expect(resultaat.actuelePositie.perComplex.map((c) => c.complexnummer)).toEqual([null, "001"]);
    expect(resultaat.actuelePositie.aantalKostenRegelsZonderComplexnummer).toBe(1);
    expect(resultaat.actuelePositie.aantalKostenRegelsZonderContractOfHuurder).toBe(1);
    expect(resultaat.controleVereist.some((c) => c.ernst === "INFORMATIEF" && c.bericht.includes("kosten-regel(s) hebben geen contractnummer"))).toBe(true);
    expect(resultaat.controleVereist.some((c) => c.sectie === "ActuelePositie" && c.ernst === "WAARSCHUWING")).toBe(false);
  });

  it("rapporteert voorschotten per contract/huurder volledig, en signaleert WAARSCHUWING als een voorschot geen koppeling heeft", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ kostensoort: "2000", kostensoortSoort: "Voorschotten", contractnummer: "C1", huurdernummer: "H1", saldo: new Decimal("-100") }),
          regel({ boekstuknummer: "2", kostensoort: "2000", kostensoortSoort: "Voorschotten", contractnummer: null, huurdernummer: null, saldo: new Decimal("-50") }),
        ],
      }),
    );
    expect(resultaat.actuelePositie.voorschottenPerContractHuurder).toEqual([
      { complexnummer: "001", unitnummer: "0001", contractnummer: "C1", huurdernummer: "H1", saldo: new Decimal("-100") },
    ]);
    expect(resultaat.actuelePositie.aantalVoorschottenRegelsZonderContractOfHuurder).toBe(1);
    expect(resultaat.controleVereist.some((c) => c.sectie === "ActuelePositie" && c.ernst === "WAARSCHUWING" && c.bericht.includes("voorschotten-regel"))).toBe(true);
  });

  it("toont het rechtstreeks gekoppelde kostensaldo als aggregaat, zonder per-huurder uitsplitsing (geen kostenallocatie)", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ contractnummer: "C1", huurdernummer: "H1", saldo: new Decimal("40") }),
          regel({ boekstuknummer: "2", contractnummer: null, huurdernummer: null, saldo: new Decimal("60") }),
        ],
      }),
    );
    expect(resultaat.actuelePositie.kostenRechtstreeksGekoppeldTotaal).toEqual({ aantalRegels: 1, saldo: new Decimal("40") });
    expect((resultaat.actuelePositie as unknown as Record<string, unknown>)["kostenPerContractHuurder"]).toBeUndefined();
  });
});

describe("samenstelServicekostenPositie — B. Afrekening voorgaand jaar", () => {
  it("houdt 9600-regels volledig buiten de actuele positie", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ kostensoortSoort: "Kosten", saldo: new Decimal("100") }),
          regel({ boekstuknummer: "2", kostensoort: "9600", kostensoortSoort: "Nvt", saldo: new Decimal("-300") }),
        ],
      }),
    );
    expect(resultaat.actuelePositie.kostenSaldo.toString()).toBe("100");
    expect(resultaat.afrekeningVoorgaandJaar.totaalSaldo.toString()).toBe("-300");
    expect(resultaat.afrekeningVoorgaandJaar.aantalRegels).toBe(1);
  });

  it("geeft afrekenjaar als OnbekendOf<string> — bekend wanneer aanwezig, onbekend wanneer het veld ontbreekt", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ kostensoort: "9600", kostensoortSoort: "Nvt", contractnummer: "C1", huurdernummer: "H1", jaarSvAfrekening: "2025", saldo: new Decimal("-100") }),
          regel({ boekstuknummer: "2", kostensoort: "9600", kostensoortSoort: "Nvt", contractnummer: "C2", huurdernummer: "H2", jaarSvAfrekening: null, saldo: new Decimal("-50") }),
        ],
      }),
    );
    const met = resultaat.afrekeningVoorgaandJaar.perContractHuurderAfrekenjaar.find((r) => r.huurdernummer === "H1")!;
    expect(met.afrekenjaar).toEqual({ type: "bekend", waarde: "2025" });
    const zonder = resultaat.afrekeningVoorgaandJaar.perContractHuurderAfrekenjaar.find((r) => r.huurdernummer === "H2")!;
    expect(zonder.afrekenjaar.type).toBe("onbekend");
  });

  it("houdt complexbrede 9600-regels (zonder contract/huurder) apart van de per-huurder uitsplitsing", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ kostensoort: "9600", kostensoortSoort: "Nvt", complexnummer: "001", contractnummer: null, huurdernummer: null, saldo: new Decimal("-200") }),
        ],
      }),
    );
    expect(resultaat.afrekeningVoorgaandJaar.perContractHuurderAfrekenjaar).toHaveLength(0);
    expect(resultaat.afrekeningVoorgaandJaar.complexbredeRegels).toEqual([{ complexnummer: "001", aantalRegels: 1, saldo: new Decimal("-200") }]);
  });
});

describe("samenstelServicekostenPositie — classificatie ONBEKEND / cross-administratie-veiligheid", () => {
  it("telt ONBEKEND-regels nooit mee in A of B, en meldt het saldo apart in controleVereist (fixture met AFWIJKEND patroon t.o.v. 070)", () => {
    // Simuleert een andere administratie waar Kostensoort_Soort "Nvt" bevat voor een kostensoort
    // die NIET in de uitsluitingslijst staat — precies het geval dat niet stilzwijgend als 070 behandeld mag worden.
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ kostensoortSoort: "Kosten", saldo: new Decimal("100") }),
          regel({ boekstuknummer: "2", kostensoort: "4321", kostensoortSoort: "Nvt", saldo: new Decimal("999") }),
        ],
      }),
    );
    expect(resultaat.actuelePositie.kostenSaldo.toString()).toBe("100");
    expect(resultaat.afrekeningVoorgaandJaar.aantalRegels).toBe(0);
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("1 servicekostenregel(s) konden niet geclassificeerd worden (saldo 999)"))).toBe(true);
  });
});

describe("samenstelServicekostenPositie — C. Financiële reconciliatie", () => {
  it("koppelt Kosten/Voorschotten op de natuurlijke sleutel en reconcilieert exact als de bedragen gelijk zijn", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ kostensoortSoort: "Kosten", boekstuknummer: "1", saldo: new Decimal("100") }),
          regel({ boekstuknummer: "2", kostensoort: "2000", kostensoortSoort: "Voorschotten", saldo: new Decimal("-50"), bedragDebet: new Decimal("0"), bedragCredit: new Decimal("50") }),
        ],
        boekingen: [
          boeking({ boekstuknr: "1", grootboeknr: "1712", saldo: new Decimal("100") }),
          boeking({ boekstuknr: "2", grootboeknr: "1711", saldo: new Decimal("-50"), bedragDebet: new Decimal("0"), bedragCredit: new Decimal("50") }),
        ],
      }),
    );
    const rek1712 = resultaat.reconciliatie.perRekening.find((r) => r.grootboekrekening === "1712")!;
    expect(rek1712.verschil.toString()).toBe("0");
    const rek1711 = resultaat.reconciliatie.perRekening.find((r) => r.grootboekrekening === "1711")!;
    expect(rek1711.verschil.toString()).toBe("0");
    expect(resultaat.controleVereist.filter((c) => c.sectie === "Reconciliatie" && c.ernst === "WAARSCHUWING")).toHaveLength(0);
  });

  it("meldt een niet-nul verschil als WAARSCHUWING, nooit stilzwijgend", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [regel({ kostensoortSoort: "Kosten", boekstuknummer: "1", saldo: new Decimal("100") })],
        boekingen: [
          boeking({ boekstuknr: "1", grootboeknr: "1712", saldo: new Decimal("100") }),
          boeking({ boekstuknr: "9", grootboeknr: "1712", saldo: new Decimal("30") }), // extra, geen servicekosten-tegenhanger
        ],
        doelrekeningen: ["1712"],
      }),
    );
    const rek1712 = resultaat.reconciliatie.perRekening[0]!;
    expect(rek1712.grootboekSaldo.toString()).toBe("130");
    expect(rek1712.verschil.toString()).toBe("30");
    expect(resultaat.controleVereist.some((c) => c.sectie === "Reconciliatie" && c.ernst === "WAARSCHUWING" && c.bericht.includes("verschil 30"))).toBe(true);
  });

  it("VANGRAIL: signaleert wanneer een stroom op een niet-opgegeven doelrekening koppelt (verkeerde doelrekening)", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [regel({ kostensoort: "2000", kostensoortSoort: "Voorschotten", boekstuknummer: "1", saldo: new Decimal("-50") })],
        boekingen: [boeking({ boekstuknr: "1", grootboeknr: "1600", saldo: new Decimal("-50") })], // niet 1711
        doelrekeningen: ["1711", "1712"],
      }),
    );
    expect(resultaat.controleVereist.some((c) => c.sectie === "Reconciliatie" && c.ernst === "WAARSCHUWING" && c.bericht.includes('grootboekrekening "1600"'))).toBe(true);
  });

  it("splitst de reconciliatie per boekperiode, en telt ontbrekende koppeling correct", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ kostensoortSoort: "Kosten", boekperiode: "01", boekstuknummer: "1", saldo: new Decimal("100") }),
          regel({ boekstuknummer: "2", boekperiode: "02", saldo: new Decimal("999") }), // geen boeking-tegenhanger
        ],
        boekingen: [boeking({ boekperiode: "01", boekstuknr: "1", grootboeknr: "1712", saldo: new Decimal("100") })],
        doelrekeningen: ["1712"],
      }),
    );
    const periode01 = resultaat.reconciliatie.perRekeningPerPeriode.find((p) => p.boekperiode === "01")!;
    expect(periode01.verschil.toString()).toBe("0");
    expect(resultaat.reconciliatie.aantalServicekostenNietGekoppeld).toBe(1);
    expect(resultaat.controleVereist.some((c) => c.bericht.includes("1 van 2 servicekostenregels"))).toBe(true);
  });
});

describe("regressiepunt-stijl integratie (representatieve cijfers, structuur zoals bewezen bij 070)", () => {
  it("Kosten -> 1712, Voorschotten -> 1711, 9600 raakt beide rekeningen, alles reconcilieert exact", () => {
    const resultaat = samenstelServicekostenPositie(
      invoer({
        servicekosten: [
          regel({ kostensoortSoort: "Kosten", boekstuknummer: "1", saldo: new Decimal("91177.91"), bedragDebet: new Decimal("91177.91") }),
          regel({ boekstuknummer: "2", kostensoort: "2000", kostensoortSoort: "Voorschotten", saldo: new Decimal("-114530"), bedragDebet: new Decimal("0"), bedragCredit: new Decimal("114530") }),
          regel({ boekstuknummer: "3", kostensoort: "9600", kostensoortSoort: "Nvt", saldo: new Decimal("220610"), bedragDebet: new Decimal("220610"), bedragCredit: new Decimal("0") }),
          regel({ boekstuknummer: "4", kostensoort: "9600", kostensoortSoort: "Nvt", saldo: new Decimal("-188683.61"), bedragDebet: new Decimal("0"), bedragCredit: new Decimal("188683.61") }),
        ],
        boekingen: [
          boeking({ boekstuknr: "1", grootboeknr: "1712", saldo: new Decimal("91177.91"), bedragDebet: new Decimal("91177.91") }),
          boeking({ boekstuknr: "2", grootboeknr: "1711", saldo: new Decimal("-114530"), bedragDebet: new Decimal("0"), bedragCredit: new Decimal("114530") }),
          boeking({ boekstuknr: "3", grootboeknr: "1711", saldo: new Decimal("220610"), bedragDebet: new Decimal("220610"), bedragCredit: new Decimal("0") }),
          boeking({ boekstuknr: "4", grootboeknr: "1712", saldo: new Decimal("-188683.61"), bedragDebet: new Decimal("0"), bedragCredit: new Decimal("188683.61") }),
        ],
        doelrekeningen: ["1711", "1712"],
      }),
    );

    expect(resultaat.actuelePositie.kostenSaldo.toString()).toBe("91177.91");
    expect(resultaat.actuelePositie.voorschottenSaldo.toString()).toBe("-114530");
    expect(resultaat.actuelePositie.actueelSaldo.toString()).toBe("-23352.09");
    expect(resultaat.actuelePositie.status).toBe("VOORSCHOTTEN_HOGER_DAN_KOSTEN");
    expect(resultaat.afrekeningVoorgaandJaar.aantalRegels).toBe(2);

    const rek1711 = resultaat.reconciliatie.perRekening.find((r) => r.grootboekrekening === "1711")!;
    expect(rek1711.grootboekSaldo.toString()).toBe("106080");
    expect(rek1711.verschil.toString()).toBe("0");
    const rek1712 = resultaat.reconciliatie.perRekening.find((r) => r.grootboekrekening === "1712")!;
    expect(rek1712.grootboekSaldo.toString()).toBe("-97505.7");
    expect(rek1712.verschil.toString()).toBe("0");

    expect(resultaat.reconciliatie.perRekeningPerPeriode.every((p) => p.verschil.isZero())).toBe(true);
    expect(resultaat.controleVereist.filter((c) => c.sectie === "Reconciliatie" && c.ernst === "WAARSCHUWING")).toHaveLength(0);
  });
});
