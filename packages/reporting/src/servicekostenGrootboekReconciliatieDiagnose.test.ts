import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  diagnoseerServicekostenGrootboekReconciliatie,
  type ServicekostenGrootboekReconciliatieBoekingRegel,
} from "./servicekostenGrootboekReconciliatieDiagnose.js";
import type { ServicekostenAfrekeningDiagnoseRegel } from "./servicekostenAfrekeningDiagnose.js";

function regel(overrides: Partial<ServicekostenAfrekeningDiagnoseRegel> = {}): ServicekostenAfrekeningDiagnoseRegel {
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

function boeking(overrides: Partial<ServicekostenGrootboekReconciliatieBoekingRegel> = {}): ServicekostenGrootboekReconciliatieBoekingRegel {
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

describe("diagnoseerServicekostenGrootboekReconciliatie", () => {
  it("koppelt Kosten aan 1712 en Voorschotten aan 1711 op (boekjaar, dagboek, boekstuk, volgnr) — sluitend als de bedragen gelijk zijn", () => {
    const servicekosten = [
      regel({ kostensoortSoort: "Kosten", kostensoort: "0101", boekstuknummer: "1", saldo: new Decimal("100"), bedragDebet: new Decimal("100") }),
      regel({ kostensoortSoort: "Voorschotten", kostensoort: "2000", boekstuknummer: "2", saldo: new Decimal("-50"), bedragDebet: new Decimal("0"), bedragCredit: new Decimal("50") }),
    ];
    const boekingen = [
      boeking({ boekstuknr: "1", grootboeknr: "1712", saldo: new Decimal("100"), bedragDebet: new Decimal("100") }),
      boeking({ boekstuknr: "2", grootboeknr: "1711", saldo: new Decimal("-50"), bedragDebet: new Decimal("0"), bedragCredit: new Decimal("50") }),
    ];

    const resultaat = diagnoseerServicekostenGrootboekReconciliatie(servicekosten, boekingen, ["1711", "1712"]);

    const rek1712 = resultaat.rekeningVergelijking.find((r) => r.grootboekrekening === "1712")!;
    expect(rek1712.grootboekSaldo.toString()).toBe("100");
    expect(rek1712.servicekostenGekoppeldSaldoTotaal.toString()).toBe("100");
    expect(rek1712.verschil.toString()).toBe("0");
    expect(rek1712.servicekostenGekoppeldPerStroom).toEqual([{ kostensoortSoortWaarde: "Kosten", aantalRegels: 1, saldo: new Decimal("100") }]);

    const rek1711 = resultaat.rekeningVergelijking.find((r) => r.grootboekrekening === "1711")!;
    expect(rek1711.grootboekSaldo.toString()).toBe("-50");
    expect(rek1711.servicekostenGekoppeldSaldoTotaal.toString()).toBe("-50");
    expect(rek1711.verschil.toString()).toBe("0");

    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(false);
  });

  it("toont een verschil als het grootboek meer/minder bevat dan wat servicekosten koppelt, zonder het te verklaren", () => {
    const servicekosten = [regel({ kostensoortSoort: "Kosten", boekstuknummer: "1", saldo: new Decimal("100") })];
    const boekingen = [
      boeking({ boekstuknr: "1", grootboeknr: "1712", saldo: new Decimal("100") }),
      // Extra boeking op 1712 zonder servicekosten-tegenhanger — bv. een rechtstreekse crediteurenboeking.
      boeking({ boekstuknr: "9", grootboeknr: "1712", saldo: new Decimal("30") }),
    ];

    const resultaat = diagnoseerServicekostenGrootboekReconciliatie(servicekosten, boekingen, ["1712"]);

    const rek1712 = resultaat.rekeningVergelijking[0]!;
    expect(rek1712.grootboekSaldo.toString()).toBe("130");
    expect(rek1712.servicekostenGekoppeldSaldoTotaal.toString()).toBe("100");
    expect(rek1712.verschil.toString()).toBe("30");
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("verschil 30"))).toBe(true);
  });

  it("signaleert wanneer een stroom op een onverwachte (niet-doel) grootboekrekening koppelt", () => {
    const servicekosten = [regel({ kostensoortSoort: "Kosten", boekstuknummer: "1" })];
    const boekingen = [boeking({ boekstuknr: "1", grootboeknr: "1600" })]; // niet 1712
    const resultaat = diagnoseerServicekostenGrootboekReconciliatie(servicekosten, boekingen, ["1711", "1712"]);

    const kosten = resultaat.perStroom.find((s) => s.kostensoortSoortWaarde === "Kosten")!;
    expect(kosten.perGrootboekrekening).toEqual([{ grootboekrekening: "1600", aantalRegels: 1, debet: new Decimal("100"), credit: new Decimal("0"), saldo: new Decimal("100") }]);
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes('grootboekrekening "1600"'))).toBe(true);
  });

  it("houdt kostensoort 9600 in een eigen sectie, gescheiden van Kosten/Voorschotten, ongeacht Kostensoort_Soort", () => {
    const servicekosten = [
      regel({ kostensoortSoort: "Kosten", boekstuknummer: "1" }),
      regel({ kostensoort: "9600", kostensoortSoort: "Nvt", boekstuknummer: "2", saldo: new Decimal("-200"), bedragDebet: new Decimal("0"), bedragCredit: new Decimal("200") }),
    ];
    const boekingen = [
      boeking({ boekstuknr: "1", grootboeknr: "1712" }),
      boeking({ boekstuknr: "2", grootboeknr: "1712", saldo: new Decimal("-200"), bedragDebet: new Decimal("0"), bedragCredit: new Decimal("200") }),
    ];
    const resultaat = diagnoseerServicekostenGrootboekReconciliatie(servicekosten, boekingen, ["1711", "1712"]);

    expect(resultaat.kostensoort9600.aantalRegelsTotaal).toBe(1);
    expect(resultaat.kostensoort9600.saldoTotaal.toString()).toBe("-200");
    expect(resultaat.perStroom.some((s) => s.kostensoortSoortWaarde === "Nvt")).toBe(true);

    const rek1712 = resultaat.rekeningVergelijking.find((r) => r.grootboekrekening === "1712")!;
    const nvtBijdrage = rek1712.servicekostenGekoppeldPerStroom.find((b) => b.kostensoortSoortWaarde === "Nvt");
    expect(nvtBijdrage?.saldo.toString()).toBe("-200");
  });

  it("gebruikt uitsluitend de natuurlijke sleutel (boekjaar+dagboek+boekstuk+volgnr) — geen bedrag-matching, ook niet bij toevallig gelijke bedragen op een andere sleutel", () => {
    const servicekosten = [regel({ kostensoortSoort: "Kosten", boekstuknummer: "1", saldo: new Decimal("100") })];
    const boekingen = [boeking({ boekstuknr: "999", grootboeknr: "1712", saldo: new Decimal("100") })]; // toevallig zelfde bedrag, andere sleutel
    const resultaat = diagnoseerServicekostenGrootboekReconciliatie(servicekosten, boekingen, ["1712"]);

    const kosten = resultaat.perStroom.find((s) => s.kostensoortSoortWaarde === "Kosten")!;
    expect(kosten.aantalGekoppeld).toBe(0);
    expect(kosten.aantalNietGekoppeld).toBe(1);
    expect(resultaat.rekeningVergelijking[0]?.servicekostenGekoppeldSaldoTotaal.toString()).toBe("0");
  });

  it("splitst de reconciliatie per boekperiode voor elke doelrekening", () => {
    const servicekosten = [
      regel({ kostensoortSoort: "Kosten", boekperiode: "01", boekstuknummer: "1", saldo: new Decimal("100") }),
      regel({ kostensoortSoort: "Kosten", boekperiode: "02", boekstuknummer: "2", saldo: new Decimal("50") }),
    ];
    const boekingen = [
      boeking({ boekperiode: "01", boekstuknr: "1", grootboeknr: "1712", saldo: new Decimal("100") }),
      boeking({ boekperiode: "02", boekstuknr: "2", grootboeknr: "1712", saldo: new Decimal("70") }), // afwijking in periode 02
    ];
    const resultaat = diagnoseerServicekostenGrootboekReconciliatie(servicekosten, boekingen, ["1712"]);

    const periode01 = resultaat.periodeVergelijking.find((p) => p.boekperiode === "01")!;
    expect(periode01.verschil.toString()).toBe("0");
    const periode02 = resultaat.periodeVergelijking.find((p) => p.boekperiode === "02")!;
    expect(periode02.verschil.toString()).toBe("20");
    expect(resultaat.controleVereist.some((c) => c.bericht.includes("periode/grootboekrekening-combinaties"))).toBe(true);
  });
});
