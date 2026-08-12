import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderPLRapportHtml } from "./renderHtml.js";
import type { PLRapportInvoer } from "./types.js";

const rooiseZoom: PLRapportInvoer = {
  objectnaam: "Rooise Zoom",
  objectnummer: "070",
  jaren: [
    {
      jaar: 2025,
      huurinkomstenPerEenheid: [{ naam: "Eenheid 1", bedrag: new Decimal("60000") }, { naam: "Eenheid 2", bedrag: new Decimal("40000") }],
      kostenPerCategorie: [{ naam: "Beheer", bedrag: new Decimal("-12000") }, { naam: "Onderhoud", bedrag: new Decimal("-28000") }],
      toelichting: "Groot onderhoud dak uitgevoerd in Q3.",
    },
    {
      jaar: 2026,
      huurinkomstenPerEenheid: [{ naam: "Eenheid 1", bedrag: new Decimal("66000") }, { naam: "Eenheid 2", bedrag: new Decimal("44000") }],
      kostenPerCategorie: [{ naam: "Beheer", bedrag: new Decimal("-13500") }, { naam: "Onderhoud", bedrag: new Decimal("-31500") }],
    },
  ],
};

describe("renderPLRapportHtml", () => {
  const html = renderPLRapportHtml(rooiseZoom);

  it("bevat de coverpage met objectnaam, objectnummer en periode", () => {
    expect(html).toContain("Rooise Zoom");
    expect(html).toContain("object 070");
    expect(html).toContain("2025–2026");
  });

  it("bevat alle vereiste rapportsecties", () => {
    for (const sectie of ["Samenvatting", "Inkomsten", "Kosten", "Netto exploitatieresultaat", "Inkomsten vs. kosten per jaar", "Toelichting"]) {
      expect(html).toContain(sectie);
    }
  });

  it("formatteert bedragen conform huisstijl (€ met duizendtalpunt en decimaalkomma)", () => {
    expect(html).toContain("€ 100.000,00");
  });

  it("toont negatieve bedragen (kosten) tussen haakjes met de negatief-klasse", () => {
    expect(html).toContain('class="negatief"');
    expect(html).toMatch(/\(€ 40\.000,00\)/);
  });

  it("bevat de vrije toelichting per jaar", () => {
    expect(html).toContain("Groot onderhoud dak uitgevoerd in Q3.");
  });

  it("escaped HTML-gevoelige tekens in objectnaam (geen ongewilde HTML-injectie)", () => {
    const kwaadaardig = renderPLRapportHtml({ ...rooiseZoom, objectnaam: "<script>alert(1)</script>" });
    expect(kwaadaardig).not.toContain("<script>alert(1)</script>");
    expect(kwaadaardig).toContain("&lt;script&gt;");
  });

  it("is geldige, gesloten HTML (begint met doctype, sluit body/html)", () => {
    expect(html.trim().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
  });
});
