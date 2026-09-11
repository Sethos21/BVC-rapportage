import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderPlPeriodeHtml } from "./renderPlPeriode.js";
import type { PlPeriodeInvoer } from "./types.js";
import type { PlPeriodeResultaat } from "./plPeriodeBerekening.js";

function resultaat(overrides: Partial<PlPeriodeResultaat> = {}): PlPeriodeResultaat {
  return {
    posten: [
      { rapportagepost: "Beheerkosten", rapportagecategorie: "Kosten", bedrag: new Decimal("-400") },
      { rapportagepost: "Huuropbrengsten belast", rapportagecategorie: "Opbrengsten", bedrag: new Decimal("900") },
    ],
    categorieTotalen: [
      { rapportagecategorie: "Kosten", bedrag: new Decimal("-400") },
      { rapportagecategorie: "Opbrengsten", bedrag: new Decimal("900") },
    ],
    controleVereist: [],
    ...overrides,
  };
}

function invoer(overrides: Partial<PlPeriodeInvoer> = {}): PlPeriodeInvoer {
  return {
    administratieNaam: "Rooise Zoom",
    bedrijfsnr: "070",
    boekjaar: 2026,
    boekperiodeTotEnMet: "06",
    gegenereerdOp: new Date("2026-08-21T12:00:00Z"),
    resultaat: resultaat(),
    ...overrides,
  };
}

describe("renderPlPeriodeHtml", () => {
  it("bevat de coverpage met administratienaam, Bedrijfsnr en peildatum", () => {
    const html = renderPlPeriodeHtml(invoer());
    expect(html).toContain("Rooise Zoom");
    expect(html).toContain("Bedrijfsnr 070");
    expect(html).toContain("t/m periode 06");
  });

  it("toont één tabel per rapportagecategorie, in de aangeleverde volgorde, met posten en subtotaal", () => {
    const html = renderPlPeriodeHtml(invoer());
    expect(html).toContain("Kosten");
    expect(html).toContain("Beheerkosten");
    expect(html).toContain("Opbrengsten");
    expect(html).toContain("Huuropbrengsten belast");
    expect(html.indexOf("Kosten")).toBeLessThan(html.indexOf("Opbrengsten"));
  });

  it("gokt geen vaste Kosten/Opbrengsten-indeling: een willekeurige rapportagecategorie wordt gewoon getoond", () => {
    const html = renderPlPeriodeHtml(
      invoer({
        resultaat: resultaat({
          posten: [{ rapportagepost: "Zonnestroom", rapportagecategorie: "Duurzaamheid", bedrag: new Decimal("120") }],
          categorieTotalen: [{ rapportagecategorie: "Duurzaamheid", bedrag: new Decimal("120") }],
        }),
      }),
    );
    expect(html).toContain("Duurzaamheid");
    expect(html).toContain("Zonnestroom");
  });

  it("toont controleVereist-rekeningen altijd zichtbaar, nooit stilzwijgend weggelaten", () => {
    const html = renderPlPeriodeHtml(
      invoer({ resultaat: resultaat({ controleVereist: [{ grootboekrekening: "9999", saldo: new Decimal("30"), reden: "Onbekende grootboekrekening 9999." }] }) }),
    );
    expect(html).toContain("Controle vereist");
    expect(html).toContain("9999");
    expect(html).toContain("Onbekende grootboekrekening 9999.");
  });

  it("meldt duidelijk dat er geen controle vereist is als de lijst leeg is", () => {
    const html = renderPlPeriodeHtml(invoer());
    expect(html).toContain("geen — alle rekeningen");
  });

  it("toont een duidelijke melding bij geen resultaatposten i.p.v. een lege pagina", () => {
    const html = renderPlPeriodeHtml(invoer({ resultaat: resultaat({ posten: [], categorieTotalen: [] }) }));
    expect(html).toContain("Geen resultaatposten in deze periode.");
  });

  it("escaped HTML-gevoelige tekens", () => {
    const html = renderPlPeriodeHtml(invoer({ administratieNaam: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is geldige, gesloten HTML", () => {
    const html = renderPlPeriodeHtml(invoer());
    expect(html.trim().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
  });
});
