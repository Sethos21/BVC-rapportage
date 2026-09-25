import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderRapportPeriodeHtml } from "./renderRapportPeriode.js";
import type { RapportPeriodeInvoer } from "./types.js";

function invoer(overrides: Partial<RapportPeriodeInvoer> = {}): RapportPeriodeInvoer {
  return {
    administratieNaam: "Rooise Zoom",
    bedrijfsnr: "070",
    boekjaar: 2026,
    boekperiodeTotEnMet: "06",
    gegenereerdOp: new Date("2026-08-21T12:00:00Z"),
    plResultaat: {
      posten: [{ rapportagepost: "Huuropbrengsten belast", rapportagecategorie: "Opbrengsten", bedrag: new Decimal("900") }],
      categorieTotalen: [{ rapportagecategorie: "Opbrengsten", bedrag: new Decimal("900") }],
      controleVereist: [],
    },
    balansResultaat: {
      posten: [{ grootboekrekening: "1010", omschrijving: "Bank", rapportagecategorie: "ACTIVA", ruwSaldo: new Decimal("700"), tekenconventie: "ZOALS_BRON", saldo: new Decimal("700"), herkomst: "ADMINISTRATIE_OVERRIDE" }],
      categorieTotalen: [{ rapportagecategorie: "ACTIVA", bedrag: new Decimal("700") }],
      controleVereist: [],
      aansluiting: {
        activaTotaal: new Decimal("700"),
        passivaTotaal: new Decimal("0"),
        resultaatHuidigBoekjaar: { type: "bekend", waarde: new Decimal("700") },
        verschil: { type: "bekend", waarde: new Decimal("0") },
        sluitBinnenTolerantie: true,
      },
    },
    ...overrides,
  };
}

describe("renderRapportPeriodeHtml", () => {
  it("bevat één coverpage voor het gecombineerde rapport, met administratienaam, Bedrijfsnr en peildatum", () => {
    const html = renderRapportPeriodeHtml(invoer());
    expect(html).toContain("Financiële rapportage");
    expect(html).toContain("Rooise Zoom");
    expect(html).toContain("Bedrijfsnr 070");
    expect(html).toContain("t/m periode 06");
  });

  it("toont beide secties in één document: eerst Resultatenrekening, dan Balans", () => {
    const html = renderRapportPeriodeHtml(invoer());
    expect(html).toContain("Resultatenrekening");
    expect(html).toContain("Balans");
    expect(html.indexOf("Resultatenrekening")).toBeLessThan(html.indexOf("Balans"));
  });

  it("toont de P&L-posten en de balansposten allebei, zonder een eigen berekening te doen", () => {
    const html = renderRapportPeriodeHtml(invoer());
    expect(html).toContain("Huuropbrengsten belast");
    expect(html).toContain("1010");
    expect(html).toContain("Bank");
  });

  it("toont de aansluitingscontrole van de balans binnen het gecombineerde document", () => {
    const html = renderRapportPeriodeHtml(invoer());
    expect(html).toContain("Aansluitingscontrole");
    expect(html).toContain("Sluit</strong>");
  });

  it("is één geldig, gesloten HTML-document (niet twee losse documenten aan elkaar geplakt)", () => {
    const html = renderRapportPeriodeHtml(invoer());
    expect(html.trim().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
    expect(html.match(/<!DOCTYPE html>/g)).toHaveLength(1);
    expect(html.match(/<\/html>/g)).toHaveLength(1);
  });

  it("escaped HTML-gevoelige tekens", () => {
    const html = renderRapportPeriodeHtml(invoer({ administratieNaam: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
