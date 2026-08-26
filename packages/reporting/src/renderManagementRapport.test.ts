import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderManagementRapportHtml } from "./renderManagementRapport.js";
import { samenstelManagementRapport, type ManagementRapportInvoer, type ManagementRapportPeriodeSectie, type ManagementRapportStandSectie } from "./managementRapport.js";
import type { HuurKerncijfersResultaat } from "./huurKerncijfers.js";
import type { KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";
import type { VastgoedKerncijfersResultaat } from "./vastgoedKerncijfers.js";

const BEKEND = (n: string) => ({ type: "bekend" as const, waarde: new Decimal(n) });

function vastgoed(overrides: Partial<VastgoedKerncijfersResultaat> = {}): VastgoedKerncijfersResultaat {
  return {
    momentopname: true,
    bronPeildatum: new Date("2026-07-31T00:00:00.000Z"),
    portefeuille: { totaalVvo: BEKEND("6773.5"), verhuurdeVvo: BEKEND("6589.5"), leegstandVvo: BEKEND("184"), bezettingsgraad: BEKEND("97.28"), leegstandspercentage: BEKEND("2.72") },
    perComplex: [{ complexnr: "002", totaalVvo: BEKEND("1138"), verhuurdeVvo: BEKEND("954"), leegstandVvo: BEKEND("184"), bezettingsgraad: BEKEND("83.83"), leegstandspercentage: BEKEND("16.17") }],
    controleVereist: [],
    ...overrides,
  };
}

function huur(overrides: Partial<HuurKerncijfersResultaat> = {}): HuurKerncijfersResultaat {
  return {
    momentopname: true,
    bronPeildatum: new Date("2026-07-31T00:00:00.000Z"),
    portefeuille: {
      brutoJaarhuur: BEKEND("687900.88"),
      huurkortingen: BEKEND("13920"),
      nettoJaarhuur: BEKEND("673980.88"),
      verhuurdeVvo: BEKEND("6589.5"),
      brutoHuurPerM2: BEKEND("104.39"),
      nettoHuurPerM2: BEKEND("102.28"),
    },
    perComplex: [
      { complexnr: "002", brutoJaarhuur: BEKEND("113637.88"), huurkortingen: BEKEND("0"), nettoJaarhuur: BEKEND("113637.88"), verhuurdeVvo: BEKEND("954"), brutoHuurPerM2: BEKEND("119.12"), nettoHuurPerM2: BEKEND("119.12") },
    ],
    controleVereist: [],
    ...overrides,
  };
}

function kasstroom(overrides: Partial<KasstroomManagementoverzichtResultaat> = {}): KasstroomManagementoverzichtResultaat {
  return {
    bankstandBegin: new Decimal("1800"),
    bankstandEind: new Decimal("2000"),
    ontvangsten: new Decimal("500"),
    uitgaven: new Decimal("300"),
    nettoKasstroom: new Decimal("200"),
    eigenaarOnttrekkingen: new Decimal("300"),
    overigeUitgaven: new Decimal("0"),
    perKwartaal: [
      { kwartaal: 1, ontvangsten: new Decimal("0"), uitgaven: new Decimal("0"), eigenaarOnttrekkingen: new Decimal("0"), nettoKasstroom: new Decimal("0") },
      { kwartaal: 2, ontvangsten: new Decimal("500"), uitgaven: new Decimal("300"), eigenaarOnttrekkingen: new Decimal("300"), nettoKasstroom: new Decimal("200") },
      { kwartaal: 3, ontvangsten: new Decimal("0"), uitgaven: new Decimal("0"), eigenaarOnttrekkingen: new Decimal("0"), nettoKasstroom: new Decimal("0") },
      { kwartaal: 4, ontvangsten: new Decimal("0"), uitgaven: new Decimal("0"), eigenaarOnttrekkingen: new Decimal("0"), nettoKasstroom: new Decimal("0") },
    ],
    controleVereist: [],
    ...overrides,
  };
}

function periode(overrides: Partial<ManagementRapportPeriodeSectie> = {}): ManagementRapportPeriodeSectie {
  return {
    boekperiodeVan: "04",
    boekperiodeTotEnMet: "06",
    totaleOpbrengsten: new Decimal("500"),
    totaleKosten: new Decimal("300"),
    resultaatPeriode: BEKEND("200"),
    kasstroom: kasstroom(),
    ...overrides,
  };
}

function stand(overrides: Partial<ManagementRapportStandSectie> = {}): ManagementRapportStandSectie {
  return {
    boekperiodeTotEnMet: "06",
    bankstandEinde: new Decimal("2000"),
    resultaatHuidigBoekjaarYtd: BEKEND("900"),
    balansSluit: true,
    ...overrides,
  };
}

function invoer(overrides: Partial<ManagementRapportInvoer> = {}): ManagementRapportInvoer {
  return {
    administratieNaam: "Rooise Zoom",
    bedrijfsnr: "070",
    boekjaar: 2026,
    gegenereerdOp: new Date("2026-08-26T12:00:00.000Z"),
    periode: periode(),
    stand: stand(),
    vastgoed: vastgoed(),
    huur: huur(),
    ...overrides,
  };
}

function html(overrides: Partial<ManagementRapportInvoer> = {}): string {
  return renderManagementRapportHtml(samenstelManagementRapport(invoer(overrides)));
}

describe("renderManagementRapportHtml", () => {
  it("bevat de coverpage met administratienaam, Bedrijfsnr en periode", () => {
    const h = html();
    expect(h).toContain("Managementrapportage");
    expect(h).toContain("Rooise Zoom");
    expect(h).toContain("Bedrijfsnr 070");
    expect(h).toContain("periode 04 t/m 06");
  });

  it("toont sectie 1 met de periode-groep EN de stand/YTD-groep, apart gelabeld", () => {
    const h = html();
    expect(h).toContain("1. Managementsamenvatting");
    expect(h).toContain("Periode 04 t/m 06");
    expect(h).toContain("Stand/YTD t/m periode 06");
    expect(h).toContain("Resultaat (periode)");
    expect(h).toContain("Resultaat huidig boekjaar (YTD)");
  });

  it("toont resultaat-periode en resultaat-YTD als twee verschillende bedragen, nooit onder hetzelfde label", () => {
    const h = html({ periode: periode({ resultaatPeriode: BEKEND("200") }), stand: stand({ resultaatHuidigBoekjaarYtd: BEKEND("900") }) });
    // 200 (periode) en 900 (YTD) moeten beide voorkomen, als aparte bedragen.
    expect(h).toContain("€ 200,00");
    expect(h).toContain("€ 900,00");
  });

  it("toont 'Controle vereist' i.p.v. een gegokt bedrag als resultaatPeriode onbekend is", () => {
    const h = html({ periode: periode({ resultaatPeriode: { type: "onbekend", reden: "test-reden" } }) });
    expect(h).toContain("Controle vereist");
  });

  it("toont sectie 2 (vastgoed) als momentopname met bronPeildatum, onafhankelijk van de periodeselectie", () => {
    const h = html();
    expect(h).toContain("2. Vastgoed");
    expect(h).toContain("Momentopname");
    expect(h).toContain("2026-07-31");
    expect(h).toContain("83,8%"); // per-complex bezettingsgraad complex 002
  });

  it("toont een onbekende bronPeildatum expliciet, ook al is er wel een periode geselecteerd", () => {
    const h = html({ vastgoed: vastgoed({ bronPeildatum: null }) });
    expect(h).toContain("Momentopname");
    expect(h).toContain("onbekend");
  });

  it("toont sectie 3 (huur) als momentopname met bruto/netto jaarhuur en huur per m²", () => {
    const h = html();
    expect(h).toContain("3. Huur");
    expect(h).toContain("Bruto jaarhuur");
    expect(h).toContain("Huurkortingen");
    expect(h).toContain("Netto jaarhuur");
  });

  it("toont sectie 4 (kasstroom) met bankstand begin/eind van de periode zelf, niet 1 januari", () => {
    const h = html();
    expect(h).toContain("4. Kasstroom");
    expect(h).toContain("Bankstand begin (periode 04)");
    expect(h).toContain("Bankstand einde (periode 06)");
    expect(h).toContain("€ 1.800,00"); // bankstandBegin van de fixture
    expect(h).toContain("Q1");
    expect(h).toContain("Q4");
  });

  it("toont de top overige uitgaven van de periode als toelichting indien meegegeven", () => {
    const h = html({ periode: periode({ topOverigeUitgaven: [{ boekdatum: new Date("2026-05-01T00:00:00.000Z"), bedrag: new Decimal("300"), omschrijving: "Grote reparatie" }] }) });
    expect(h).toContain("Top 1 grootste overige uitgaven (periode)");
    expect(h).toContain("Grote reparatie");
  });

  it("laat de top-overige-uitgaven-sectie weg als er geen regels zijn meegegeven", () => {
    const h = html();
    expect(h).not.toContain("grootste overige uitgaven");
  });

  it("toont sectie 5 met gecombineerde controleVereist uit alle modules, zichtbaar met sectielabel", () => {
    const h = html({
      vastgoed: vastgoed({ controleVereist: [{ complexnr: "004", ernst: "WAARSCHUWING", bericht: "vastgoed-afwijking-004" }] }),
      huur: huur({ controleVereist: [{ complexnr: "003", ernst: "KRITIEK", bericht: "huur-afwijking-003" }] }),
    });
    expect(h).toContain("5. Controle vereist");
    expect(h).toContain("vastgoed-afwijking-004");
    expect(h).toContain("huur-afwijking-003");
    expect(h).toContain("KRITIEK");
    expect(h).toContain("WAARSCHUWING");
  });

  it("meldt duidelijk 'geen' controle vereist als de gecombineerde lijst leeg is", () => {
    const h = html();
    expect(h).toContain("Controle vereist");
    expect(h).toMatch(/Geen<\/strong> — alle onderliggende modules/);
  });

  it("escaped HTML-gevoelige tekens", () => {
    const h = html({ administratieNaam: "<script>alert(1)</script>" });
    expect(h).not.toContain("<script>alert(1)</script>");
    expect(h).toContain("&lt;script&gt;");
  });

  it("is geldige, gesloten HTML", () => {
    const h = html();
    expect(h.trim().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(h.trim().endsWith("</html>")).toBe(true);
  });
});
