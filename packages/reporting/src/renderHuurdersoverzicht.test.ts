import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderHuurdersoverzichtHtml } from "./renderHuurdersoverzicht.js";
import { berekenHuurdersoverzicht, type HoContractRegel, type HoRentrollRegel, type HoVerhogingRegel } from "./huurdersoverzicht.js";
import type { OpSaldoHuurderRegel, OpVorderingRegel } from "./openstaandePosten.js";

const PEILDATUM = new Date("2026-07-31T00:00:00.000Z");

function contract(overrides: Partial<HoContractRegel> = {}): HoContractRegel {
  return {
    bedrijfsnr: "070",
    contractnummer: "C1",
    huurdernummer: "H1",
    huurderNaam: "Test Huurder BV",
    complexnummer: "001",
    complexomschrijving: "Villa I",
    unitnummer: "0001",
    ingangsdatum: new Date("2020-01-01T00:00:00.000Z"),
    afloopdatum: null,
    checkLopendContract: "Ja",
    expiratieExpiratiedatum: new Date("2029-12-31T00:00:00.000Z"),
    expiratieOpzegdatum: new Date("2028-12-31T00:00:00.000Z"),
    waarborgsom: new Decimal(0),
    verhogingDatum: new Date("2027-07-01T00:00:00.000Z"),
    verhogingJaarVlgd: "2027",
    verhogingPeriodeVlgd: "07",
    verhogingPercentage: new Decimal(0),
    verhogingMethode: "Prijsindex",
    omschrijvingIndextabel: "CPI 2025 = 100",
    ...overrides,
  };
}

function rentrollRegel(overrides: Partial<HoRentrollRegel> = {}): HoRentrollRegel {
  return {
    contractnummer: "C1",
    vorderingsoort: "01",
    complexnummer: "001",
    unitnummer: "0001",
    prolongatieBedragJaar: new Decimal(37318.8),
    gehuurdOppervlak: new Decimal(320),
    serviceVoorschotJaar: new Decimal(21600),
    rapportageDatum: PEILDATUM,
    contractExpiratiedatum: new Date("2029-12-31T00:00:00.000Z"),
    contractOpzegdatum: new Date("2028-12-31T00:00:00.000Z"),
    ...overrides,
  };
}

function verhogingRegel(overrides: Partial<HoVerhogingRegel> = {}): HoVerhogingRegel {
  return {
    contractnummer: "C1",
    jaar: "2026",
    periode: "07",
    status: "Verwerkt",
    toekomstigeVerhoging: "Nee",
    bedragOudVs01: new Decimal(3028.6),
    bedragNieuwVs01: new Decimal(3109.9),
    ...overrides,
  };
}

describe("renderHuurdersoverzichtHtml", () => {
  it("toont de compacte 'pp-jjjj · +x,xx%'-weergave voor laatste indexatie in de Contractinformatie-tabel", () => {
    const resultaat = berekenHuurdersoverzicht([contract()], [rentrollRegel()], [verhogingRegel()]);
    const html = renderHuurdersoverzichtHtml("070 Rooise Zoom", resultaat);
    expect(html).toContain("07-2026 · +2,68%");
    expect(html).toContain("Contractinformatie");
    expect(html).not.toContain("Contractdetails");
  });

  it("toont 'niet beschikbaar' als geen betrouwbare historische indexatie voor dit contract bestaat", () => {
    const resultaat = berekenHuurdersoverzicht([contract({ contractnummer: "0000000052" })], [rentrollRegel({ contractnummer: "0000000052" })], []);
    const html = renderHuurdersoverzichtHtml("070 Rooise Zoom", resultaat);
    expect(html).toContain("niet beschikbaar");
  });


  it("rendert huurder, complexnummer+aanduiding, bruto/netto/korting, servicekostenvoorschot, status en totalen", () => {
    const resultaat = berekenHuurdersoverzicht([contract()], [rentrollRegel()]);
    const html = renderHuurdersoverzichtHtml("070 Rooise Zoom", resultaat);

    expect(html).toContain("Test Huurder BV");
    expect(html).toContain(">001<");
    expect(html).toContain("Villa I");
    expect(html).toContain("€ 37.318,80");
    expect(html).toContain("€ 21.600,00");
    expect(html).toContain("Geen urgentie");
    expect(html).toContain("badge-status-geen-urgentie");
    // Geen korting -> gedempt streepje, geen "netto"-subregel bij €/m².
    expect(html).not.toContain("netto €");
  });

  it("toont een netto €/m²-subregel alleen als de huurkorting > 0 is", () => {
    const resultaat = berekenHuurdersoverzicht(
      [contract()],
      [rentrollRegel(), rentrollRegel({ vorderingsoort: "13", prolongatieBedragJaar: new Decimal(-6000), gehuurdOppervlak: new Decimal(0) })],
    );
    const html = renderHuurdersoverzichtHtml("070 Rooise Zoom", resultaat);
    expect(html).toContain("netto €");
  });

  it("toont contract 0000000043 zonder unitnummer als 'niet geregistreerd', nooit verzonnen", () => {
    const resultaat = berekenHuurdersoverzicht(
      [contract({ contractnummer: "0000000043", unitnummer: null })],
      [rentrollRegel({ contractnummer: "0000000043", unitnummer: null, prolongatieBedragJaar: new Decimal(92875.92), gehuurdOppervlak: new Decimal(750), serviceVoorschotJaar: new Decimal(59700) })],
    );
    const html = renderHuurdersoverzichtHtml("070 Rooise Zoom", resultaat);
    expect(html).toContain("niet geregistreerd");
    expect(html).toContain("controle-vereist"); // huurdernaam-cel krijgt de controleVereist-markering.
  });

  it("rendert alle vier de overige ContracteindeStatus-badges/-stijlen correct", () => {
    const bijnaVerlopen = berekenHuurdersoverzicht([contract({ expiratieExpiratiedatum: new Date("2026-08-01T00:00:00.000Z") })], [rentrollRegel({ contractExpiratiedatum: new Date("2026-08-01T00:00:00.000Z") })]);
    expect(renderHuurdersoverzichtHtml("x", bijnaVerlopen)).toContain("badge-status-verloopt-binnenkort");

    const aandacht = berekenHuurdersoverzicht([contract({ expiratieExpiratiedatum: new Date("2028-06-01T00:00:00.000Z") })], [rentrollRegel({ contractExpiratiedatum: new Date("2028-06-01T00:00:00.000Z") })]);
    expect(renderHuurdersoverzichtHtml("x", aandacht)).toContain("badge-status-aandacht");

    const gepasseerd = berekenHuurdersoverzicht([contract({ expiratieExpiratiedatum: new Date("2026-01-01T00:00:00.000Z") })], [rentrollRegel({ contractExpiratiedatum: new Date("2026-01-01T00:00:00.000Z") })]);
    const gepasseerdHtml = renderHuurdersoverzichtHtml("x", gepasseerd);
    expect(gepasseerdHtml).toContain("Expiratiedatum gepasseerd");
    expect(gepasseerdHtml).not.toContain('class="badge badge-status'); // bewust GEEN effen badge, zie ontwerp.

    const onbekend = berekenHuurdersoverzicht([contract({ expiratieExpiratiedatum: null })], [rentrollRegel({ contractExpiratiedatum: null })]);
    expect(renderHuurdersoverzichtHtml("x", onbekend)).toContain("Onbekend");
  });

  it("regressie: 070-portefeuilletotalen verschijnen exact zoals bevestigd, geen nieuwe optelling", () => {
    const echte070 = [
      { c: "0000000028", complex: "002", bruto: "37318.8", m2: "320" },
      { c: "0000000029", complex: "002", bruto: "14686.56", m2: "139" },
      { c: "0000000031", complex: "003", bruto: "29383.8", m2: "255" },
      { c: "0000000038", complex: "001", bruto: "37617.12", m2: "320" },
      { c: "0000000043", complex: "001", bruto: "92875.92", m2: "750" },
      { c: "0000000044", complex: "003", bruto: "23150.4", m2: "202" },
      { c: "0000000045", complex: "004", bruto: "136150.08", m2: "1633.5" },
      { c: "0000000046", complex: "004", bruto: "170092.32", m2: "1700" },
      { c: "0000000048", complex: "001", bruto: "38137.44", m2: "320" },
      { c: "0000000049", complex: "003", bruto: "12777.36", m2: "120", korting: "-6000" },
      { c: "0000000051", complex: "003", bruto: "34078.56", m2: "335", korting: "-7920" },
      { c: "0000000052", complex: "002", bruto: "61632.52", m2: "495" },
    ];
    const contracten = echte070.map((c) => contract({ contractnummer: c.c, complexnummer: c.complex, unitnummer: c.c === "0000000043" ? null : "0001" }));
    const rentroll = echte070.flatMap((c) => {
      const regels = [rentrollRegel({ contractnummer: c.c, complexnummer: c.complex, unitnummer: c.c === "0000000043" ? null : "0001", prolongatieBedragJaar: new Decimal(c.bruto), gehuurdOppervlak: new Decimal(c.m2) })];
      if (c.korting) regels.push(rentrollRegel({ contractnummer: c.c, complexnummer: c.complex, vorderingsoort: "13", prolongatieBedragJaar: new Decimal(c.korting), gehuurdOppervlak: new Decimal(0) }));
      return regels;
    });

    const resultaat = berekenHuurdersoverzicht(contracten, rentroll);
    const html = renderHuurdersoverzichtHtml("070 Rooise Zoom", resultaat);

    expect(html).toContain("€ 687.900,88");
    expect(html).toContain("€ 13.920,00");
    expect(html).toContain("€ 673.980,88");
    expect(html).toContain("6.589,5 m²");
    expect(html).toContain("12 contracten");
  });

  it("toont de Openstaand-kolom met het bedrag als er openstaande posten zijn", () => {
    const vordering: OpVorderingRegel = {
      bedrijfsnr: "070", contractnummer: "C1", vorderingVolgnummer: "1", huurdernummer: "H1",
      complexnummer: "001", unitnummer: "0001", factuurnummer: "F1",
      datumVordering: new Date("2026-09-01T00:00:00.000Z"), omschrijving: "Periode september 2026",
      totaalbedrag: new Decimal(5940.98), bedragAfgeboekt: new Decimal(0), openstaand: new Decimal(5940.98),
    };
    const saldoHuurder: OpSaldoHuurderRegel = {
      huurdernummer: "H1", achterstand: new Decimal(5940.98), achterstandTm30Dagen: new Decimal(5940.98),
      achterstandTm60Dagen: new Decimal(0), achterstandTm90Dagen: new Decimal(0), achterstand90PlusDagen: new Decimal(0),
      vooruitbetaling: new Decimal(0), saldo: new Decimal(5940.98),
    };
    const resultaat = berekenHuurdersoverzicht([contract()], [rentrollRegel()], [], [vordering], [saldoHuurder], true);
    const html = renderHuurdersoverzichtHtml("070 Rooise Zoom", resultaat);
    expect(html).toContain("Openstaand");
    expect(html).toContain("€ 5.940,98");
  });

  it("toont een rustige '—' in de Openstaand-kolom als er geen openstaande posten zijn", () => {
    const resultaat = berekenHuurdersoverzicht([contract()], [rentrollRegel()]);
    const html = renderHuurdersoverzichtHtml("070 Rooise Zoom", resultaat);
    expect(html).toContain("Openstaand");
    expect(html).toContain(`<span class="subtekst">—</span>`);
  });

  describe("Vervallen posten / Openstaande credits", () => {
    const VERVALLEN_PEILDATUM = new Date("2026-09-01T00:00:00.000Z");

    it("zonder vervallen posten: toont 'Geen vervallen posten.', geen lege tabel", () => {
      const resultaat = berekenHuurdersoverzicht([contract()], [rentrollRegel()], [], [], [], "onbekend", VERVALLEN_PEILDATUM, 0);
      const html = renderHuurdersoverzichtHtml("070 Rooise Zoom", resultaat);
      expect(html).toContain("Vervallen posten");
      expect(html).toContain("Geen vervallen posten.");
      expect(html).toContain("Peildatum vervallen-classificatie: 2026-09-01");
    });

    it("met meerdere vervallen posten: rendert huurder/factuur/periode/datum/dagen/bedrag, meeste dagen eerst", () => {
      const vordering1: OpVorderingRegel = {
        bedrijfsnr: "070", contractnummer: "C1", vorderingVolgnummer: "1", huurdernummer: "H1",
        complexnummer: "001", unitnummer: "0001", factuurnummer: "F1",
        datumVordering: new Date("2026-08-01T00:00:00.000Z"), omschrijving: "Periode augustus 2026",
        totaalbedrag: new Decimal(100), bedragAfgeboekt: new Decimal(0), openstaand: new Decimal(100),
      };
      const vordering2: OpVorderingRegel = {
        bedrijfsnr: "070", contractnummer: "C1", vorderingVolgnummer: "2", huurdernummer: "H1",
        complexnummer: "001", unitnummer: "0001", factuurnummer: "F2",
        datumVordering: new Date("2026-07-01T00:00:00.000Z"), omschrijving: "Periode juli 2026",
        totaalbedrag: new Decimal(200), bedragAfgeboekt: new Decimal(0), openstaand: new Decimal(200),
      };
      const saldoHuurder: OpSaldoHuurderRegel = {
        huurdernummer: "H1", achterstand: new Decimal(300), achterstandTm30Dagen: new Decimal(300),
        achterstandTm60Dagen: new Decimal(0), achterstandTm90Dagen: new Decimal(0), achterstand90PlusDagen: new Decimal(0),
        vooruitbetaling: new Decimal(0), saldo: new Decimal(300),
      };
      const resultaat = berekenHuurdersoverzicht([contract()], [rentrollRegel()], [], [vordering1, vordering2], [saldoHuurder], true, VERVALLEN_PEILDATUM, 0);
      const html = renderHuurdersoverzichtHtml("070 Rooise Zoom", resultaat);
      expect(html).toContain("Juli 2026");
      expect(html).toContain("Augustus 2026");
      expect(html).toContain("€ 100,00");
      expect(html).toContain("€ 200,00");
      expect(html).not.toContain("Geen vervallen posten.");
      // Meeste dagen vervallen (juli, 62 dagen) staat vóór augustus (31 dagen) in de HTML.
      expect(html.indexOf("Juli 2026")).toBeLessThan(html.indexOf("Augustus 2026"));
    });

    it("Openstaande credits verschijnt uitsluitend als er daadwerkelijk credits zijn", () => {
      const zonderCredits = berekenHuurdersoverzicht([contract()], [rentrollRegel()], [], [], [], "onbekend", VERVALLEN_PEILDATUM, 0);
      expect(renderHuurdersoverzichtHtml("x", zonderCredits)).not.toContain("Openstaande credits");

      const creditVordering: OpVorderingRegel = {
        bedrijfsnr: "070", contractnummer: "C1", vorderingVolgnummer: "1", huurdernummer: "H1",
        complexnummer: "001", unitnummer: "0001", factuurnummer: "F1",
        datumVordering: new Date("2026-04-15T00:00:00.000Z"), omschrijving: "Service-afrekening 0004",
        totaalbedrag: new Decimal(-146.9), bedragAfgeboekt: new Decimal(0), openstaand: new Decimal(-146.9),
      };
      const saldoHuurder: OpSaldoHuurderRegel = {
        huurdernummer: "H1", achterstand: new Decimal(-146.9), achterstandTm30Dagen: new Decimal(0),
        achterstandTm60Dagen: new Decimal(0), achterstandTm90Dagen: new Decimal(0), achterstand90PlusDagen: new Decimal(-146.9),
        vooruitbetaling: new Decimal(0), saldo: new Decimal(-146.9),
      };
      const metCredits = berekenHuurdersoverzicht([contract()], [rentrollRegel()], [], [creditVordering], [saldoHuurder], true, VERVALLEN_PEILDATUM, 0);
      const html = renderHuurdersoverzichtHtml("x", metCredits);
      expect(html).toContain("Openstaande credits");
      expect(html).toContain("class=\"negatief\"");
      expect(html).toContain("146,90");
    });
  });
});
