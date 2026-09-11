import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderKasstroomPeriodeHtml } from "./renderKasstroomPeriode.js";
import type { KasstroomPeriodeInvoer } from "./types.js";
import type { KasstroomPeriodeResultaat } from "./kasstroomBerekening.js";

function resultaat(overrides: Partial<KasstroomPeriodeResultaat> = {}): KasstroomPeriodeResultaat {
  return {
    rekeningen: [{ grootboekrekening: "1010", omschrijving: "Bank", beginbalans: new Decimal("1000"), mutatie: new Decimal("500"), eindstand: new Decimal("1500") }],
    beginstandTotaal: new Decimal("1000"),
    mutatieTotaal: new Decimal("500"),
    eindstandTotaal: new Decimal("1500"),
    controleVereist: [],
    ...overrides,
  };
}

function invoer(overrides: Partial<KasstroomPeriodeInvoer> = {}): KasstroomPeriodeInvoer {
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

describe("renderKasstroomPeriodeHtml", () => {
  it("bevat de coverpage met administratienaam, Bedrijfsnr en peildatum", () => {
    const html = renderKasstroomPeriodeHtml(invoer());
    expect(html).toContain("Kasstroom");
    expect(html).toContain("Rooise Zoom");
    expect(html).toContain("Bedrijfsnr 070");
    expect(html).toContain("t/m periode 06");
  });

  it("toont rekening, omschrijving, beginstand, mutatie, eindstand en de totaalrij", () => {
    const html = renderKasstroomPeriodeHtml(invoer());
    expect(html).toContain("1010");
    expect(html).toContain("Bank");
    expect(html).toContain("Totaal liquide middelen");
  });

  it("toont een duidelijke melding bij geen bevestigde liquide-middelen-rekeningen", () => {
    const html = renderKasstroomPeriodeHtml(invoer({ resultaat: resultaat({ rekeningen: [] }) }));
    expect(html).toContain("Geen liquide-middelen-rekeningen bevestigd voor deze periode.");
  });

  it("toont controleVereist-rekeningen altijd zichtbaar, nooit stilzwijgend weggelaten", () => {
    const html = renderKasstroomPeriodeHtml(
      invoer({ resultaat: resultaat({ controleVereist: [{ grootboekrekening: "9999", saldo: new Decimal("30"), reden: "Onbekende grootboekrekening 9999." }] }) }),
    );
    expect(html).toContain("Controle vereist");
    expect(html).toContain("9999");
    expect(html).toContain("Onbekende grootboekrekening 9999.");
  });

  it("meldt duidelijk dat er geen controle vereist is als de lijst leeg is", () => {
    const html = renderKasstroomPeriodeHtml(invoer());
    expect(html).toContain("geen — alle rekeningen");
  });

  it("escaped HTML-gevoelige tekens", () => {
    const html = renderKasstroomPeriodeHtml(invoer({ administratieNaam: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is geldige, gesloten HTML", () => {
    const html = renderKasstroomPeriodeHtml(invoer());
    expect(html.trim().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
  });
});
