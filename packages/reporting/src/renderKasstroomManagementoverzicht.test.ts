import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderKasstroomManagementoverzichtHtml } from "./renderKasstroomManagementoverzicht.js";
import type { KasstroomManagementoverzichtInvoer } from "./types.js";
import type { KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";

function resultaat(overrides: Partial<KasstroomManagementoverzichtResultaat> = {}): KasstroomManagementoverzichtResultaat {
  return {
    bankstandBegin: new Decimal("2000"),
    bankstandEind: new Decimal("2200"),
    ontvangsten: new Decimal("1000"),
    uitgaven: new Decimal("800"),
    nettoKasstroom: new Decimal("200"),
    eigenaarOnttrekkingen: new Decimal("500"),
    overigeUitgaven: new Decimal("300"),
    perKwartaal: [
      { kwartaal: 1, ontvangsten: new Decimal("1000"), uitgaven: new Decimal("300"), eigenaarOnttrekkingen: new Decimal("0"), nettoKasstroom: new Decimal("700") },
      { kwartaal: 2, ontvangsten: new Decimal("0"), uitgaven: new Decimal("500"), eigenaarOnttrekkingen: new Decimal("500"), nettoKasstroom: new Decimal("-500") },
      { kwartaal: 3, ontvangsten: new Decimal("0"), uitgaven: new Decimal("0"), eigenaarOnttrekkingen: new Decimal("0"), nettoKasstroom: new Decimal("0") },
      { kwartaal: 4, ontvangsten: new Decimal("0"), uitgaven: new Decimal("0"), eigenaarOnttrekkingen: new Decimal("0"), nettoKasstroom: new Decimal("0") },
    ],
    controleVereist: [],
    ...overrides,
  };
}

function invoer(overrides: Partial<KasstroomManagementoverzichtInvoer> = {}): KasstroomManagementoverzichtInvoer {
  return {
    administratieNaam: "Rooise Zoom",
    bedrijfsnr: "070",
    boekjaar: 2026,
    boekperiodeTotEnMet: "06",
    gegenereerdOp: new Date("2026-08-24T12:00:00Z"),
    resultaat: resultaat(),
    ...overrides,
  };
}

describe("renderKasstroomManagementoverzichtHtml", () => {
  it("bevat de coverpage met administratienaam, Bedrijfsnr en peildatum", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer());
    expect(html).toContain("Kasstroom");
    expect(html).toContain("Rooise Zoom");
    expect(html).toContain("Bedrijfsnr 070");
    expect(html).toContain("t/m periode 06");
  });

  it("toont de vijf hoofd-KPI's", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer());
    expect(html).toContain("Bankstand begin");
    expect(html).toContain("Totale ontvangsten");
    expect(html).toContain("Totale uitgaven");
    expect(html).toContain("Netto kasstroom");
    expect(html).toContain("Bankstand eind");
  });

  it("toont de uitsplitsing eigenaaronttrekkingen/overige uitgaven binnen uitgaven", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer());
    expect(html).toContain("Waarvan eigenaaronttrekkingen");
    expect(html).toContain("Waarvan overige uitgaven");
    expect(html).toContain("Totaal uitgaven");
  });

  it("toont een kwartaaltabel met ontvangsten, uitgaven, eigenaaronttrekkingen en netto kasstroom per kwartaal", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer());
    expect(html).toContain("Q1");
    expect(html).toContain("Q2");
    expect(html).toContain("Q3");
    expect(html).toContain("Q4");
  });

  it("toont controleVereist-regels altijd zichtbaar, nooit stilzwijgend weggelaten", () => {
    const html = renderKasstroomManagementoverzichtHtml(
      invoer({ resultaat: resultaat({ controleVereist: [{ grootboekrekening: "1010", saldo: new Decimal("20"), reden: "Liquiditeitsclassificatie nog niet bevestigd." }] }) }),
    );
    expect(html).toContain("Controle vereist");
    expect(html).toContain("1010");
    expect(html).toContain("Liquiditeitsclassificatie nog niet bevestigd.");
  });

  it("meldt duidelijk dat er geen controle vereist is als de lijst leeg is", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer());
    expect(html).toContain("Controle vereist:</strong> geen");
  });

  it("escaped HTML-gevoelige tekens", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer({ administratieNaam: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is geldige, gesloten HTML", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer());
    expect(html.trim().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
  });

  it("toont de top overige uitgaven als die zijn meegegeven", () => {
    const html = renderKasstroomManagementoverzichtHtml(
      invoer({ topOverigeUitgaven: [{ boekdatum: new Date("2026-03-01"), bedrag: new Decimal("1234.56"), omschrijving: "Onderhoud dak" }] }),
    );
    expect(html).toContain("Top 1 grootste overige uitgaven");
    expect(html).toContain("Onderhoud dak");
    expect(html).toContain("2026-03-01");
  });

  it("laat de top-overige-uitgaven-sectie weg als er geen regels zijn meegegeven", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer());
    expect(html).not.toContain("grootste overige uitgaven");
  });
});
