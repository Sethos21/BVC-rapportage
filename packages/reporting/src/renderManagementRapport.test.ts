import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderManagementRapportHtml } from "./renderManagementRapport.js";
import { samenstelManagementRapport, type ManagementRapportInvoer } from "./managementRapport.js";
import type { KerncijfersManagementResultaat } from "./kerncijfersManagement.js";
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

function kerncijfers(overrides: Partial<KerncijfersManagementResultaat> = {}): KerncijfersManagementResultaat {
  return {
    totaleOpbrengsten: new Decimal("341734.81"),
    totaleKosten: new Decimal("30555.15"),
    resultaatHuidigBoekjaar: BEKEND("311179.66"),
    bankstandEindePeriode: new Decimal("73038.37"),
    nettoKasstroom: new Decimal("71430.87"),
    eigenaarOnttrekkingen: new Decimal("253000"),
    balansSluitBinnenTolerantie: true,
    vastgoed: vastgoed(),
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
    bankstandBegin: new Decimal("1607.50"),
    bankstandEind: new Decimal("73038.37"),
    ontvangsten: new Decimal("552498.76"),
    uitgaven: new Decimal("481067.89"),
    nettoKasstroom: new Decimal("71430.87"),
    eigenaarOnttrekkingen: new Decimal("253000"),
    overigeUitgaven: new Decimal("228067.89"),
    perKwartaal: [
      { kwartaal: 1, ontvangsten: new Decimal("307782.11"), uitgaven: new Decimal("222424.47"), eigenaarOnttrekkingen: new Decimal("100000"), nettoKasstroom: new Decimal("85357.64") },
      { kwartaal: 2, ontvangsten: new Decimal("244716.65"), uitgaven: new Decimal("258643.42"), eigenaarOnttrekkingen: new Decimal("153000"), nettoKasstroom: new Decimal("-13926.77") },
      { kwartaal: 3, ontvangsten: new Decimal("0"), uitgaven: new Decimal("0"), eigenaarOnttrekkingen: new Decimal("0"), nettoKasstroom: new Decimal("0") },
      { kwartaal: 4, ontvangsten: new Decimal("0"), uitgaven: new Decimal("0"), eigenaarOnttrekkingen: new Decimal("0"), nettoKasstroom: new Decimal("0") },
    ],
    controleVereist: [],
    ...overrides,
  };
}

function invoer(overrides: Partial<ManagementRapportInvoer> = {}): ManagementRapportInvoer {
  return {
    administratieNaam: "Rooise Zoom",
    bedrijfsnr: "070",
    boekjaar: 2026,
    boekperiodeTotEnMet: "06",
    gegenereerdOp: new Date("2026-08-26T12:00:00.000Z"),
    kerncijfers: kerncijfers(),
    kasstroom: kasstroom(),
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
    expect(h).toContain("t/m periode 06");
  });

  it("toont sectie 1 met alle zeven managementsamenvatting-KPI's", () => {
    const h = html();
    expect(h).toContain("1. Managementsamenvatting");
    expect(h).toContain("Totale opbrengsten");
    expect(h).toContain("Totale kosten");
    expect(h).toContain("Resultaat huidig boekjaar");
    expect(h).toContain("Bankstand einde");
    expect(h).toContain("Netto kasstroom");
    expect(h).toContain("Eigenaaronttrekkingen");
    expect(h).toContain("Balans sluit");
  });

  it("toont 'Controle vereist' i.p.v. een gegokt bedrag als resultaatHuidigBoekjaar onbekend is", () => {
    const h = html({ kerncijfers: kerncijfers({ resultaatHuidigBoekjaar: { type: "onbekend", reden: "test-reden" } }) });
    expect(h).toContain("Controle vereist");
  });

  it("toont sectie 2 (vastgoed) als momentopname met bronPeildatum en per-complex-tabel", () => {
    const h = html();
    expect(h).toContain("2. Vastgoed");
    expect(h).toContain("Momentopname");
    expect(h).toContain("2026-07-31");
    expect(h).toContain("Totale VVO");
    expect(h).toContain("Bezettingsgraad");
    expect(h).toContain("83,8%"); // per-complex bezettingsgraad complex 002
  });

  it("toont een onbekende bronPeildatum expliciet, ook al is er wel een financiële periode geselecteerd", () => {
    const h = html({ kerncijfers: kerncijfers({ vastgoed: vastgoed({ bronPeildatum: null }) }) });
    expect(h).toContain("Momentopname");
    expect(h).toContain("onbekend");
  });

  it("toont sectie 3 (huur) als momentopname met bruto/netto jaarhuur en huur per m²", () => {
    const h = html();
    expect(h).toContain("3. Huur");
    expect(h).toContain("Bruto jaarhuur");
    expect(h).toContain("Huurkortingen");
    expect(h).toContain("Netto jaarhuur");
    expect(h).toContain("Bruto huur per m²");
    expect(h).toContain("Netto huur per m²");
  });

  it("toont sectie 4 (kasstroom) met de volledige detail inclusief kwartaaluitsplitsing", () => {
    const h = html();
    expect(h).toContain("4. Kasstroom");
    expect(h).toContain("Bankstand begin");
    expect(h).toContain("Waarvan eigenaaronttrekkingen");
    expect(h).toContain("Waarvan overige uitgaven");
    expect(h).toContain("Q1");
    expect(h).toContain("Q4");
  });

  it("toont de top overige uitgaven als toelichting indien meegegeven, zonder aparte KPI-status", () => {
    const h = html({ topOverigeUitgaven: [{ boekdatum: new Date("2026-03-01T00:00:00.000Z"), bedrag: new Decimal("5000"), omschrijving: "Grote reparatie" }] });
    expect(h).toContain("Top 1 grootste overige uitgaven");
    expect(h).toContain("Grote reparatie");
  });

  it("laat de top-overige-uitgaven-sectie weg als er geen regels zijn meegegeven", () => {
    const h = html();
    expect(h).not.toContain("grootste overige uitgaven");
  });

  it("toont sectie 5 met gecombineerde controleVereist uit alle modules, zichtbaar met sectielabel", () => {
    const h = html({
      kerncijfers: kerncijfers({ vastgoed: vastgoed({ controleVereist: [{ complexnr: "004", ernst: "WAARSCHUWING", bericht: "vastgoed-afwijking-004" }] }) }),
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
