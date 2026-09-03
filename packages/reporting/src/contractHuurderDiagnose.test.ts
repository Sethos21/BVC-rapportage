import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  diagnoseerContractHuurder,
  ruweContractSleutel,
  type ChdContractRegel,
  type ChdOuderdomsanalyseRegel,
  type ChdRentrollRegel,
  type ChdRuweContractnummerBotsing,
  type ChdRuweContractvelden,
  type ChdServicekostenVoorschotRegel,
} from "./contractHuurderDiagnose.js";

const contract1: ChdContractRegel = {
  bedrijfsnr: "070",
  contractnummer: "C1",
  complexnummer: "001",
  unitnummer: "0001",
  huurdernummer: "H1",
  ingangsdatum: new Date("2020-01-01T00:00:00.000Z"),
  afloopdatum: null,
  checkLopendContract: "Ja",
  expiratieExpiratiedatum: new Date("2027-12-31T00:00:00.000Z"),
  expiratieOpzegdatum: new Date("2027-09-30T00:00:00.000Z"),
};

const contract2: ChdContractRegel = {
  bedrijfsnr: "070",
  contractnummer: "C2",
  complexnummer: "002",
  unitnummer: null,
  huurdernummer: null,
  ingangsdatum: new Date("2021-01-01T00:00:00.000Z"),
  afloopdatum: null,
  checkLopendContract: "Ja",
  expiratieExpiratiedatum: null,
  expiratieOpzegdatum: null,
};

describe("diagnoseerContractHuurder", () => {
  it("koppelt rentroll/ouderdomsanalyse/ruwe velden/servicekostenvoorschot per contract, zonder te kiezen bij meerdere regels", () => {
    const rentroll: ChdRentrollRegel[] = [
      {
        contractnummer: "C1",
        vorderingsoort: "01",
        complexnummer: "001",
        unitnummer: "0001",
        prolongatieBedragJaar: new Decimal(10000),
        kortingBedragJaar: null,
        serviceVoorschotJaar: new Decimal(1200),
        gehuurdOppervlak: new Decimal(100),
        rapportageDatum: new Date("2026-07-31T00:00:00.000Z"),
        contractExpiratiedatum: new Date("2027-12-31T00:00:00.000Z"),
        contractOpzegdatum: new Date("2027-09-30T00:00:00.000Z"),
      },
      {
        contractnummer: "C1",
        vorderingsoort: "13",
        complexnummer: "001",
        unitnummer: null,
        prolongatieBedragJaar: new Decimal(-500),
        kortingBedragJaar: new Decimal(-500),
        serviceVoorschotJaar: null,
        gehuurdOppervlak: new Decimal(0),
        rapportageDatum: new Date("2026-07-31T00:00:00.000Z"),
        contractExpiratiedatum: null,
        contractOpzegdatum: null,
      },
      {
        // Geen match in contracten — moet in aantalRentrollRegelsZonderContractmatch tellen.
        contractnummer: "C-onbekend",
        vorderingsoort: "01",
        complexnummer: "003",
        unitnummer: null,
        prolongatieBedragJaar: new Decimal(1000),
        kortingBedragJaar: null,
        serviceVoorschotJaar: null,
        gehuurdOppervlak: new Decimal(10),
        rapportageDatum: null,
        contractExpiratiedatum: null,
        contractOpzegdatum: null,
      },
    ];

    const ouderdomsanalyse: ChdOuderdomsanalyseRegel[] = [
      {
        huurdernr: "H1",
        boekjaar: 2026,
        boekperiode: "06",
        peildatum: new Date("2026-06-30T00:00:00.000Z"),
        achterstand: new Decimal(500),
        vooruitbetaling: new Decimal(0),
        saldo: new Decimal(500),
      },
      {
        // Geen contract heeft dit huurdernummer — moet in aantalOuderdomsanalyseRegelsZonderHuurdermatch tellen.
        huurdernr: "H-onbekend",
        boekjaar: 2026,
        boekperiode: "06",
        peildatum: new Date("2026-06-30T00:00:00.000Z"),
        achterstand: new Decimal(0),
        vooruitbetaling: new Decimal(0),
        saldo: new Decimal(0),
      },
    ];

    const ruwContract1: ChdRuweContractvelden = {
      waarborgsom: "4513.29",
      waarborgNietGeprolongeerd: "0",
      waarborgbeheer: "Eigenaar",
      complexomschrijving: "Pater van den Elsenlaan",
      huurderNaam1: "Test Huurder BV",
      datumLaatstGeprolongeerd: new Date("2026-08-01T00:00:00.000Z"),
      jaarLaatstGeprolongeerd: "2026",
      periodeLaatstGeprolongeerd: "08",
      verhogingDatum: new Date("2027-07-01T00:00:00.000Z"),
      verhogingJaarVolgend: "2027",
      verhogingPeriodeVolgend: "07",
      verhogingPercentage: "4.4",
      verhogingMethode: "Prijsindex",
      omschrijvingIndextabel: "CPI 2025 = 100",
    };
    const ruweContractvelden = new Map([[ruweContractSleutel("070", "C1"), ruwContract1]]);
    const alleRuweRijenPerContractnummer = new Map<string, ChdRuweContractnummerBotsing[]>([
      ["C1", [{ bedrijfsnr: "070", huurderNaam1: "Test Huurder BV", complexomschrijving: "Pater van den Elsenlaan", waarborgsom: "4513.29" }]],
    ]);

    const voorschotten: ChdServicekostenVoorschotRegel[] = [
      { complexnummer: "001", unitnummer: "0001", contractnummer: "C1", huurdernummer: "H1", saldo: new Decimal(-1200) },
    ];

    const resultaat = diagnoseerContractHuurder(
      [contract1, contract2],
      rentroll,
      ouderdomsanalyse,
      ruweContractvelden,
      alleRuweRijenPerContractnummer,
      voorschotten,
      { boekjaar: 2026, boekperiodeVan: "01", boekperiodeTotEnMet: "06" },
    );

    expect(resultaat.contracten).toHaveLength(2);

    const c1 = resultaat.contracten.find((r) => r.contractnummer === "C1")!;
    expect(c1.rentrollRegels).toHaveLength(2);
    expect(c1.ruweContractvelden).toEqual(ruwContract1);
    expect(c1.ouderdomsanalyse).toEqual([ouderdomsanalyse[0]]);
    expect(c1.servicekostenVoorschot).toEqual([voorschotten[0]]);

    const c2 = resultaat.contracten.find((r) => r.contractnummer === "C2")!;
    expect(c2.rentrollRegels).toEqual([]);
    expect(c2.ruweContractvelden).toBeNull();
    expect(c2.ouderdomsanalyse).toEqual([]); // huurdernummer null → nooit een gok welke ouderdomsanalyse-regel hoort erbij.
    expect(c2.servicekostenVoorschot).toEqual([]);

    expect(resultaat.aantalRentrollRegelsZonderContractmatch).toBe(1);
    expect(resultaat.aantalOuderdomsanalyseRegelsZonderHuurdermatch).toBe(1);
    expect(resultaat.aantalContractenZonderRuweMatch).toBe(1);
    expect(resultaat.servicekostenPeriode).toEqual({ boekjaar: 2026, boekperiodeVan: "01", boekperiodeTotEnMet: "06" });
  });

  it("laat servicekostenPeriode/voorschotten leeg als geen periode is opgegeven", () => {
    const resultaat = diagnoseerContractHuurder([contract1], [], [], new Map(), new Map(), [], null);
    expect(resultaat.servicekostenPeriode).toBeNull();
    expect(resultaat.contracten[0]!.servicekostenVoorschot).toEqual([]);
  });

  it("BUGFIX: koppelt ruwe contractvelden op bedrijfsnr+contractnummer, niet op contractnummer alleen — voorkomt een botsing met een andere administratie", () => {
    // Zelfde contractnummer "C1" komt voor bij bedrijfsnr 070 (het contract dat we onderzoeken) EN bij
    // een andere administratie (002) in het gedeelde contracten_huidig-bestand — precies het patroon dat
    // bij 070-contracten 0000000048/0000000051/0000000052 de oude (contractnummer-only) koppeling liet
    // falen: die had stilzwijgend de verkeerde (002-)rij gepakt.
    const ruwContract070: ChdRuweContractvelden = {
      waarborgsom: "0", waarborgNietGeprolongeerd: "0", waarborgbeheer: null, complexomschrijving: "Villa I",
      huurderNaam1: "De Juiste 070-Huurder", datumLaatstGeprolongeerd: null, jaarLaatstGeprolongeerd: null,
      periodeLaatstGeprolongeerd: null, verhogingDatum: null, verhogingJaarVolgend: null, verhogingPeriodeVolgend: null,
      verhogingPercentage: null, verhogingMethode: null, omschrijvingIndextabel: null,
    };
    const ruwContract002: ChdRuweContractvelden = { ...ruwContract070, huurderNaam1: "Verkeerde 002-Huurder", complexomschrijving: "Andere Administratie" };

    const ruweContractvelden = new Map([
      [ruweContractSleutel("070", "C1"), ruwContract070],
      [ruweContractSleutel("002", "C1"), ruwContract002],
    ]);
    const alleRuweRijenPerContractnummer = new Map<string, ChdRuweContractnummerBotsing[]>([
      ["C1", [
        { bedrijfsnr: "070", huurderNaam1: "De Juiste 070-Huurder", complexomschrijving: "Villa I", waarborgsom: "0" },
        { bedrijfsnr: "002", huurderNaam1: "Verkeerde 002-Huurder", complexomschrijving: "Andere Administratie", waarborgsom: "0" },
      ]],
    ]);

    const resultaat = diagnoseerContractHuurder([contract1], [], [], ruweContractvelden, alleRuweRijenPerContractnummer, [], null);

    const c1 = resultaat.contracten[0]!;
    expect(c1.ruweContractvelden?.huurderNaam1).toBe("De Juiste 070-Huurder");
    expect(c1.alleRuweRijenMetDitContractnummer).toHaveLength(2);
    expect(c1.alleRuweRijenMetDitContractnummer.map((r) => r.bedrijfsnr).sort()).toEqual(["002", "070"]);
  });
});
