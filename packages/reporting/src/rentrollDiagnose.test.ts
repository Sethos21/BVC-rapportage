import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { diagnoseerRentroll, type RentrollDiagnoseContractRegel, type RentrollDiagnoseRentrollRegel } from "./rentrollDiagnose.js";

function rentrollRegel(overrides: Partial<RentrollDiagnoseRentrollRegel> = {}): RentrollDiagnoseRentrollRegel {
  return {
    contractnummer: "C1",
    complexnr: "001",
    unitnr: "0001",
    vorderingsoort: "01",
    prolongatieBedragJaar: new Decimal("10000"),
    kortingBedragJaar: null,
    gehuurdOppervlak: new Decimal("100"),
    rapportageDatum: null,
    ...overrides,
  };
}

function contractRegel(overrides: Partial<RentrollDiagnoseContractRegel> = {}): RentrollDiagnoseContractRegel {
  return {
    contractnummer: "C1",
    ingangsdatum: new Date("2020-01-01T00:00:00.000Z"),
    afloopdatum: null,
    expiratieExpiratiedatum: new Date("2027-12-31T00:00:00.000Z"),
    checkLopendContract: "Ja",
    ...overrides,
  };
}

describe("diagnoseerRentroll", () => {
  it("koppelt een rentroll-regel aan precies 1 contract", () => {
    const resultaat = diagnoseerRentroll([rentrollRegel()], [contractRegel()]);
    expect(resultaat.regels[0]?.contract).toEqual({
      status: "gekoppeld",
      ingangsdatum: new Date("2020-01-01T00:00:00.000Z"),
      afloopdatum: null,
      expiratieExpiratiedatum: new Date("2027-12-31T00:00:00.000Z"),
      checkLopendContract: "Ja",
    });
  });

  it("meldt 'niet_gevonden' als het contractnummer niet in contracten voorkomt, zonder te gokken", () => {
    const resultaat = diagnoseerRentroll([rentrollRegel({ contractnummer: "ONBEKEND" })], [contractRegel()]);
    expect(resultaat.regels[0]?.contract).toEqual({ status: "niet_gevonden" });
  });

  it("meldt 'niet_eenduidig' met het aantal matches als een contractnummer meerdere keren voorkomt, zonder er één te kiezen", () => {
    const resultaat = diagnoseerRentroll(
      [rentrollRegel({ contractnummer: "C1" })],
      [contractRegel({ contractnummer: "C1" }), contractRegel({ contractnummer: "C1", ingangsdatum: new Date("2021-01-01T00:00:00.000Z") })],
    );
    expect(resultaat.regels[0]?.contract).toEqual({ status: "niet_eenduidig", aantalGevonden: 2 });
  });

  it("groepeert totalen per Vorderingsoort: aantal regels, som bedrag, som oppervlak, aantal unieke contracten", () => {
    const resultaat = diagnoseerRentroll(
      [
        rentrollRegel({ contractnummer: "C1", vorderingsoort: "01", prolongatieBedragJaar: new Decimal("10000"), gehuurdOppervlak: new Decimal("100") }),
        rentrollRegel({ contractnummer: "C2", vorderingsoort: "01", prolongatieBedragJaar: new Decimal("5000"), gehuurdOppervlak: new Decimal("50") }),
        rentrollRegel({ contractnummer: "C1", vorderingsoort: "13", prolongatieBedragJaar: new Decimal("-1000"), gehuurdOppervlak: new Decimal("0") }),
      ],
      [],
    );
    const totaal01 = resultaat.totalenPerVorderingsoort.find((t) => t.vorderingsoort === "01");
    expect(totaal01).toMatchObject({ aantalRegels: 2, aantalUniekeContracten: 2 });
    expect(totaal01?.somProlongatieBedragJaar.toString()).toBe("15000");
    expect(totaal01?.somGehuurdOppervlak.toString()).toBe("150");

    const totaal13 = resultaat.totalenPerVorderingsoort.find((t) => t.vorderingsoort === "13");
    expect(totaal13).toMatchObject({ aantalRegels: 1, aantalUniekeContracten: 1 });
    expect(totaal13?.somProlongatieBedragJaar.toString()).toBe("-1000");
  });

  it("telt regels met een null prolongatie_bedrag_jaar/gehuurd_oppervlak apart, zonder ze als 0 in de som mee te nemen", () => {
    const resultaat = diagnoseerRentroll(
      [
        rentrollRegel({ prolongatieBedragJaar: new Decimal("10000"), gehuurdOppervlak: new Decimal("100") }),
        rentrollRegel({ contractnummer: "C2", prolongatieBedragJaar: null, gehuurdOppervlak: null }),
      ],
      [],
    );
    const totaal01 = resultaat.totalenPerVorderingsoort.find((t) => t.vorderingsoort === "01");
    expect(totaal01?.somProlongatieBedragJaar.toString()).toBe("10000");
    expect(totaal01?.aantalRegelsZonderProlongatieBedragJaar).toBe(1);
    expect(totaal01?.somGehuurdOppervlak.toString()).toBe("100");
    expect(totaal01?.aantalRegelsZonderGehuurdOppervlak).toBe(1);
  });

  it("signaleert Vorderingsoort-waarden buiten de bekende voorbeeldenset (01/12/13), zonder aanname over hun betekenis", () => {
    const resultaat = diagnoseerRentroll([rentrollRegel({ vorderingsoort: "01" }), rentrollRegel({ vorderingsoort: "99" })], []);
    expect(resultaat.onverwachteVorderingsoorten).toEqual(["99"]);
  });

  it("geeft een leeg resultaat bij geen rentroll-regels", () => {
    const resultaat = diagnoseerRentroll([], []);
    expect(resultaat.regels).toEqual([]);
    expect(resultaat.totalenPerVorderingsoort).toEqual([]);
    expect(resultaat.onverwachteVorderingsoorten).toEqual([]);
  });
});
