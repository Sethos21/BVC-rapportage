import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderKasstroomManagementoverzichtHtml } from "./renderKasstroomManagementoverzicht.js";
import type { KasstroomManagementoverzichtInvoer } from "./types.js";
import type { KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";

function resultaat(overrides: Partial<KasstroomManagementoverzichtResultaat> = {}): KasstroomManagementoverzichtResultaat {
  return {
    bankstandBegin: new Decimal("2000"),
    bankstandEind: new Decimal("3000"),
    nettoKasstroom: new Decimal("1000"),
    huurontvangsten: new Decimal("1000"),
    exploitatieUitgaven: new Decimal("300"),
    eigenaarOnttrekkingen: new Decimal("500"),
    overig: new Decimal("-50"),
    streefwaardeBankstand: { type: "bekend", waarde: new Decimal("50000") },
    uitbetalingsratio: { type: "bekend", waarde: new Decimal("0.5") },
    perKwartaal: [
      { kwartaal: 1, huurontvangsten: new Decimal("1000"), eigenaarOnttrekkingen: new Decimal("0"), uitbetalingsratio: { type: "bekend", waarde: new Decimal("0") } },
      { kwartaal: 2, huurontvangsten: new Decimal("0"), eigenaarOnttrekkingen: new Decimal("500"), uitbetalingsratio: { type: "onbekend", reden: "Huurontvangsten zijn nul." } },
      { kwartaal: 3, huurontvangsten: new Decimal("0"), eigenaarOnttrekkingen: new Decimal("0"), uitbetalingsratio: { type: "onbekend", reden: "Huurontvangsten zijn nul." } },
      { kwartaal: 4, huurontvangsten: new Decimal("0"), eigenaarOnttrekkingen: new Decimal("0"), uitbetalingsratio: { type: "onbekend", reden: "Huurontvangsten zijn nul." } },
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
    gegenereerdOp: new Date("2026-08-22T12:00:00Z"),
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

  it("toont alle acht KPI-kaarten", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer());
    expect(html).toContain("Bankstand begin");
    expect(html).toContain("Bankstand eind");
    expect(html).toContain("Netto kasstroom");
    expect(html).toContain("Streefwaarde bankstand");
    expect(html).toContain("Huurontvangsten");
    expect(html).toContain("Exploitatie-uitgaven");
    expect(html).toContain("Eigenaaronttrekkingen");
    expect(html).toContain("Uitbetalingsratio");
  });

  it("toont een kwartaaltabel met vier regels", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer());
    expect(html).toContain("Q1");
    expect(html).toContain("Q2");
    expect(html).toContain("Q3");
    expect(html).toContain("Q4");
    expect(html).toContain("50,0%"); // uitbetalingsratio Q1 = 0
  });

  it("toont Onbekend met reden voor een streefwaarde die niet geconfigureerd is", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer({ resultaat: resultaat({ streefwaardeBankstand: { type: "onbekend", reden: "Geen streefwaarde bankstand geconfigureerd voor deze administratie." } }) }));
    expect(html).toContain("Onbekend");
    expect(html).toContain("Geen streefwaarde bankstand geconfigureerd");
  });

  it("toont controleVereist-rekeningen altijd zichtbaar, nooit stilzwijgend weggelaten", () => {
    const html = renderKasstroomManagementoverzichtHtml(
      invoer({ resultaat: resultaat({ controleVereist: [{ grootboekrekening: "1600", saldo: new Decimal("20"), reden: "Kasstroomcategorie nog niet bevestigd." }] }) }),
    );
    expect(html).toContain("Controle vereist");
    expect(html).toContain("1600");
    expect(html).toContain("Kasstroomcategorie nog niet bevestigd.");
  });

  it("meldt duidelijk dat er geen controle vereist is als de lijst leeg is", () => {
    const html = renderKasstroomManagementoverzichtHtml(invoer());
    expect(html).toContain("geen — alle liquide-middelen-mutaties");
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
});
