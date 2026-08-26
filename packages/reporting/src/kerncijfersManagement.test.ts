import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { samenstelKerncijfersManagement } from "./kerncijfersManagement.js";
import type { PlPeriodeResultaat } from "./plPeriodeBerekening.js";
import type { KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";

function plResultaat(categorieTotalen: PlPeriodeResultaat["categorieTotalen"]): PlPeriodeResultaat {
  return { posten: [], categorieTotalen, controleVereist: [] };
}

function kasstroomResultaat(overrides: Partial<KasstroomManagementoverzichtResultaat> = {}): KasstroomManagementoverzichtResultaat {
  return {
    bankstandBegin: new Decimal(0),
    bankstandEind: new Decimal("12345.67"),
    ontvangsten: new Decimal(0),
    uitgaven: new Decimal(0),
    nettoKasstroom: new Decimal("2000"),
    eigenaarOnttrekkingen: new Decimal("500"),
    overigeUitgaven: new Decimal(0),
    perKwartaal: [],
    controleVereist: [],
    ...overrides,
  };
}

describe("samenstelKerncijfersManagement", () => {
  it("licht totale opbrengsten/kosten uit categorieTotalen en neemt bankstand/kasstroom/onttrekkingen ongewijzigd over", () => {
    const pl = plResultaat([
      { rapportagecategorie: "Opbrengsten", bedrag: new Decimal("100000") },
      { rapportagecategorie: "Kosten", bedrag: new Decimal("40000") },
    ]);
    const resultaat = samenstelKerncijfersManagement(pl, { type: "bekend", waarde: new Decimal("60000") }, kasstroomResultaat(), true);

    expect(resultaat).toEqual({
      totaleOpbrengsten: new Decimal("100000"),
      totaleKosten: new Decimal("40000"),
      resultaatHuidigBoekjaar: { type: "bekend", waarde: new Decimal("60000") },
      bankstandEindePeriode: new Decimal("12345.67"),
      nettoKasstroom: new Decimal("2000"),
      eigenaarOnttrekkingen: new Decimal("500"),
      balansSluitBinnenTolerantie: true,
    });
  });

  it("geeft €0 voor een categorie die niet voorkomt in een geldige periode (geen datagat)", () => {
    const pl = plResultaat([{ rapportagecategorie: "Opbrengsten", bedrag: new Decimal("100000") }]);
    const resultaat = samenstelKerncijfersManagement(pl, { type: "bekend", waarde: new Decimal("100000") }, kasstroomResultaat(), true);

    expect(resultaat.totaleKosten.toString()).toBe("0");
  });

  it("geeft resultaatHuidigBoekjaar onveranderd door als onbekend (geen aanname)", () => {
    const pl = plResultaat([]);
    const resultaat = samenstelKerncijfersManagement(pl, { type: "onbekend", reden: "test" }, kasstroomResultaat(), false);

    expect(resultaat.resultaatHuidigBoekjaar).toEqual({ type: "onbekend", reden: "test" });
    expect(resultaat.balansSluitBinnenTolerantie).toBe(false);
  });
});
