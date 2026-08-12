import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderKerncijfersHtml } from "./renderKerncijfers.js";
import type { KerncijfersInvoer } from "./types.js";

const fergagne: KerncijfersInvoer = {
  portefeuilleNaam: "Fergagne BV",
  periodeLabel: "H1 2026",
  kpis: {
    huurinkomen: { waarde: new Decimal("310000"), vorig: new Decimal("295000") },
    ebitda: { waarde: new Decimal("180000"), vorig: new Decimal("190000") },
    uitbetalingsratio: { waarde: new Decimal("0.92"), norm: new Decimal("0.85") },
    bankstand: { waarde: new Decimal("62000"), streefwaarde: new Decimal("50000") },
    debiteuren: { waarde: new Decimal("18000"), vorig: new Decimal("22000") },
    servicekostenSaldo: new Decimal("-1500"),
  },
  huurPerKwartaal: [
    { jaar: 2025, label: "Q2 2025", waarde: new Decimal("145000") },
    { jaar: 2026, label: "Q1 2026", waarde: new Decimal("152000") },
    { jaar: 2026, label: "Q2 2026", waarde: new Decimal("158000") },
  ],
  huurPerComplex: [
    { naam: "Complex 1", waarde: new Decimal("180000"), vorig: new Decimal("170000") },
    { naam: "Complex 2", waarde: new Decimal("130000"), vorig: new Decimal("125000") },
  ],
  bezettingPerComplex: [
    { complex: "Complex 1", verhuurdM2: new Decimal("4800"), totaalM2: new Decimal("5000") },
    { complex: "Complex 2", verhuurdM2: new Decimal("3000"), totaalM2: new Decimal("3000") },
  ],
};

describe("renderKerncijfersHtml", () => {
  const html = renderKerncijfersHtml(fergagne);

  it("bevat de coverpage met portefeuillenaam en periode", () => {
    expect(html).toContain("Fergagne BV");
    expect(html).toContain("H1 2026");
  });

  it("bevat de sectiekop conform legacy-indeling (01 — Kerncijfers · Overzicht)", () => {
    expect(html).toContain("01 — Kerncijfers");
    expect(html).toContain("Overzicht");
  });

  it("bevat alle zes KPI-kaarten", () => {
    for (const label of ["Huurinkomen", "EBITDA", "Uitbetalingsratio", "Bankstand einde periode", "Huurdebiteuren", "Servicekosten-saldo"]) {
      expect(html).toContain(label);
    }
  });

  it("toont een hoge uitbetalingsratio (boven de norm) als aandachtspunt, niet als gezond", () => {
    const kaartIndex = html.indexOf("Uitbetalingsratio");
    const fragment = html.slice(kaartIndex, kaartIndex + 400);
    expect(fragment).toContain("hoog");
    expect(fragment).not.toContain("gezond");
  });

  it("bevat de kwartaalbalken en huur-per-complextabel", () => {
    expect(html).toContain("Huurinkomen per kwartaal");
    expect(html).toContain("Huurinkomen naar complex");
    expect(html).toContain("Complex 1");
    expect(html).toContain("Complex 2");
  });

  it("bevat de bezettingsgraadkaart met portefeuille- en complexcijfers", () => {
    expect(html).toContain("Bezettingsgraad");
    expect(html).toContain("Portefeuille");
  });

  it("laat de bezettingsgraadkaart weg als er geen data is (optioneel veld)", () => {
    const zonderBezetting = renderKerncijfersHtml({ ...fergagne, bezettingPerComplex: undefined });
    expect(zonderBezetting).not.toContain("Bezettingsgraad");
  });

  it("escaped HTML-gevoelige tekens in de portefeuillenaam", () => {
    const kwaadaardig = renderKerncijfersHtml({ ...fergagne, portefeuilleNaam: "<script>alert(1)</script>" });
    expect(kwaadaardig).not.toContain("<script>alert(1)</script>");
    expect(kwaadaardig).toContain("&lt;script&gt;");
  });

  it("is geldige, gesloten HTML", () => {
    expect(html.trim().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
  });
});
