import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { vergelijkKasstroomManagementoverzichtMetVerwacht, type KasstroomManagementoverzichtVerwacht } from "./kasstroomManagementoverzichtVergelijking.js";
import type { KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";

function resultaat(overrides: Partial<KasstroomManagementoverzichtResultaat> = {}): KasstroomManagementoverzichtResultaat {
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
      { kwartaal: 3, ontvangsten: new Decimal(0), uitgaven: new Decimal(0), eigenaarOnttrekkingen: new Decimal(0), nettoKasstroom: new Decimal(0) },
      { kwartaal: 4, ontvangsten: new Decimal(0), uitgaven: new Decimal(0), eigenaarOnttrekkingen: new Decimal(0), nettoKasstroom: new Decimal(0) },
    ],
    controleVereist: [],
    ...overrides,
  };
}

function verwacht(overrides: Partial<KasstroomManagementoverzichtVerwacht> = {}): KasstroomManagementoverzichtVerwacht {
  const basis = resultaat();
  return {
    bankstandBegin: basis.bankstandBegin,
    bankstandEind: basis.bankstandEind,
    ontvangsten: basis.ontvangsten,
    uitgaven: basis.uitgaven,
    nettoKasstroom: basis.nettoKasstroom,
    eigenaarOnttrekkingen: basis.eigenaarOnttrekkingen,
    overigeUitgaven: basis.overigeUitgaven,
    perKwartaal: basis.perKwartaal,
    ...overrides,
  };
}

describe("vergelijkKasstroomManagementoverzichtMetVerwacht", () => {
  it("sluit volledig als berekend exact gelijk is aan verwacht (070_Rooise_Zoom-regressiepunt)", () => {
    const vergelijking = vergelijkKasstroomManagementoverzichtMetVerwacht(resultaat(), verwacht(), new Decimal("0.01"));
    expect(vergelijking.alleSluitenBinnenTolerantie).toBe(true);
    expect(vergelijking.regels).toHaveLength(7 + 4 * 4);
    expect(vergelijking.regels.every((r) => r.sluitBinnenTolerantie)).toBe(true);
  });

  it("signaleert een afwijking buiten tolerantie op een hoofd-KPI", () => {
    const vergelijking = vergelijkKasstroomManagementoverzichtMetVerwacht(resultaat({ eigenaarOnttrekkingen: new Decimal("252000") }), verwacht(), new Decimal("0.01"));
    expect(vergelijking.alleSluitenBinnenTolerantie).toBe(false);
    const regel = vergelijking.regels.find((r) => r.label === "Eigenaaronttrekkingen")!;
    expect(regel.sluitBinnenTolerantie).toBe(false);
    expect(regel.verschil.toString()).toBe("-1000");
  });

  it("signaleert een afwijking op een kwartaalregel", () => {
    const afwijkend = resultaat();
    afwijkend.perKwartaal[0]!.ontvangsten = new Decimal("300000");
    const vergelijking = vergelijkKasstroomManagementoverzichtMetVerwacht(afwijkend, verwacht(), new Decimal("0.01"));
    const regel = vergelijking.regels.find((r) => r.label === "Q1 ontvangsten")!;
    expect(regel.sluitBinnenTolerantie).toBe(false);
    expect(vergelijking.alleSluitenBinnenTolerantie).toBe(false);
  });

  it("blijft binnen tolerantie bij een verwaarloosbaar centenverschil", () => {
    const vergelijking = vergelijkKasstroomManagementoverzichtMetVerwacht(resultaat({ ontvangsten: new Decimal("552498.77") }), verwacht(), new Decimal("0.01"));
    expect(vergelijking.alleSluitenBinnenTolerantie).toBe(true);
  });
});
