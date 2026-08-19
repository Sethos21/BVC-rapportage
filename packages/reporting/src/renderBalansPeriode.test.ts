import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderBalansPeriodeHtml } from "./renderBalansPeriode.js";
import type { BalansPeriodeInvoer } from "./types.js";
import type { BalansPeriodeResultaat } from "./balansPeriodeBerekening.js";

function resultaat(overrides: Partial<BalansPeriodeResultaat> = {}): BalansPeriodeResultaat {
  return {
    posten: [
      { grootboekrekening: "1010", omschrijving: "Bank", rapportagecategorie: "ACTIVA", saldo: new Decimal("700") },
      { grootboekrekening: "1711", omschrijving: "Crediteuren", rapportagecategorie: "PASSIVA", saldo: new Decimal("-230") },
    ],
    categorieTotalen: [
      { rapportagecategorie: "ACTIVA", bedrag: new Decimal("700") },
      { rapportagecategorie: "PASSIVA", bedrag: new Decimal("-230") },
    ],
    controleVereist: [],
    aansluiting: {
      activaTotaal: new Decimal("700"),
      passivaTotaal: new Decimal("-230"),
      resultaatHuidigBoekjaar: { type: "bekend", waarde: new Decimal("930") },
      verschil: { type: "bekend", waarde: new Decimal("0") },
      sluitBinnenTolerantie: true,
    },
    ...overrides,
  };
}

function invoer(overrides: Partial<BalansPeriodeInvoer> = {}): BalansPeriodeInvoer {
  return {
    administratieNaam: "Rooise Zoom",
    bedrijfsnr: "070",
    boekjaar: 2026,
    boekperiodeTotEnMet: "06",
    gegenereerdOp: new Date("2026-08-19T12:00:00Z"),
    resultaat: resultaat(),
    ...overrides,
  };
}

describe("renderBalansPeriodeHtml", () => {
  it("bevat de coverpage met administratienaam, Bedrijfsnr en peildatum", () => {
    const html = renderBalansPeriodeHtml(invoer());
    expect(html).toContain("Rooise Zoom");
    expect(html).toContain("Bedrijfsnr 070");
    expect(html).toContain("t/m periode 06");
  });

  it("toont Activa- en Passiva-posten met rekening, omschrijving en saldo", () => {
    const html = renderBalansPeriodeHtml(invoer());
    expect(html).toContain("1010");
    expect(html).toContain("Bank");
    expect(html).toContain("1711");
    expect(html).toContain("Crediteuren");
  });

  it("toont de aansluitingscontrole als sluitend wanneer het verschil binnen tolerantie is", () => {
    const html = renderBalansPeriodeHtml(invoer());
    expect(html).toContain("Aansluitingscontrole");
    expect(html).toContain("Sluit</strong>");
  });

  it("toont de aansluitingscontrole als NIET sluitend bij een verschil", () => {
    const html = renderBalansPeriodeHtml(
      invoer({
        resultaat: resultaat({
          aansluiting: {
            activaTotaal: new Decimal("700"),
            passivaTotaal: new Decimal("-230"),
            resultaatHuidigBoekjaar: { type: "bekend", waarde: new Decimal("900") },
            verschil: { type: "bekend", waarde: new Decimal("30") },
            sluitBinnenTolerantie: false,
          },
        }),
      }),
    );
    expect(html).toContain("Sluit NIET</strong>");
  });

  it("toont de aansluitingscontrole als NIET sluitend wanneer het resultaat huidig boekjaar zelf onbekend is", () => {
    const html = renderBalansPeriodeHtml(
      invoer({
        resultaat: resultaat({
          aansluiting: {
            activaTotaal: new Decimal("700"),
            passivaTotaal: new Decimal("-230"),
            resultaatHuidigBoekjaar: { type: "onbekend", reden: "Geen bevestigd teken voor categorie Opbrengsten." },
            verschil: { type: "onbekend", reden: "Resultaat huidig boekjaar onbekend: Geen bevestigd teken voor categorie Opbrengsten." },
            sluitBinnenTolerantie: false,
          },
        }),
      }),
    );
    expect(html).toContain("Sluit NIET</strong>");
    expect(html).toContain("Onbekend");
    expect(html).toContain("Geen bevestigd teken voor categorie Opbrengsten.");
  });

  it("toont controleVereist-rekeningen altijd zichtbaar, nooit stilzwijgend weggelaten", () => {
    const html = renderBalansPeriodeHtml(
      invoer({ resultaat: resultaat({ controleVereist: [{ grootboekrekening: "9999", saldo: new Decimal("30"), reden: "Onbekende grootboekrekening 9999." }] }) }),
    );
    expect(html).toContain("Controle vereist");
    expect(html).toContain("9999");
    expect(html).toContain("Onbekende grootboekrekening 9999.");
  });

  it("meldt duidelijk dat er geen controle vereist is als de lijst leeg is", () => {
    const html = renderBalansPeriodeHtml(invoer());
    expect(html).toContain("geen — alle rekeningen");
  });

  it("toont een duidelijke melding bij een lege Activa- of Passiva-lijst i.p.v. een lege tabel", () => {
    const html = renderBalansPeriodeHtml(invoer({ resultaat: resultaat({ posten: [], categorieTotalen: [] }) }));
    expect(html).toContain("Geen activa-posten op deze peildatum.");
    expect(html).toContain("Geen passiva-posten op deze peildatum.");
  });

  it("escaped HTML-gevoelige tekens", () => {
    const html = renderBalansPeriodeHtml(invoer({ administratieNaam: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is geldige, gesloten HTML", () => {
    const html = renderBalansPeriodeHtml(invoer());
    expect(html.trim().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
  });
});
