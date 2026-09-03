import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { samenstelKerncijfersManagement } from "./kerncijfersManagement.js";
import type { PlPeriodeResultaat } from "./plPeriodeBerekening.js";
import type { KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";
import type { VastgoedKerncijfersResultaat } from "./vastgoedKerncijfers.js";

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

function vastgoedResultaat(overrides: Partial<VastgoedKerncijfersResultaat> = {}): VastgoedKerncijfersResultaat {
  const bekend = { type: "bekend" as const, waarde: new Decimal("100") };
  return {
    momentopname: true,
    bronPeildatum: new Date("2026-07-31T00:00:00.000Z"),
    portefeuille: { totaalVvo: bekend, verhuurdeVvo: bekend, leegstandVvo: bekend, bezettingsgraad: bekend, leegstandspercentage: bekend },
    perComplex: [],
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
    const vastgoed = vastgoedResultaat();
    const resultaat = samenstelKerncijfersManagement(pl, { type: "bekend", waarde: new Decimal("60000") }, kasstroomResultaat(), true, vastgoed);

    expect(resultaat).toEqual({
      totaleOpbrengsten: new Decimal("100000"),
      totaleKosten: new Decimal("40000"),
      resultaatHuidigBoekjaar: { type: "bekend", waarde: new Decimal("60000") },
      bankstandEindePeriode: new Decimal("12345.67"),
      nettoKasstroom: new Decimal("2000"),
      eigenaarOnttrekkingen: new Decimal("500"),
      balansSluitBinnenTolerantie: true,
      vastgoed,
    });
  });

  it("geeft €0 voor een categorie die niet voorkomt in een geldige periode (geen datagat)", () => {
    const pl = plResultaat([{ rapportagecategorie: "Opbrengsten", bedrag: new Decimal("100000") }]);
    const resultaat = samenstelKerncijfersManagement(pl, { type: "bekend", waarde: new Decimal("100000") }, kasstroomResultaat(), true, vastgoedResultaat());

    expect(resultaat.totaleKosten.toString()).toBe("0");
  });

  it("geeft resultaatHuidigBoekjaar onveranderd door als onbekend (geen aanname)", () => {
    const pl = plResultaat([]);
    const resultaat = samenstelKerncijfersManagement(pl, { type: "onbekend", reden: "test" }, kasstroomResultaat(), false, vastgoedResultaat());

    expect(resultaat.resultaatHuidigBoekjaar).toEqual({ type: "onbekend", reden: "test" });
    expect(resultaat.balansSluitBinnenTolerantie).toBe(false);
  });

  it("geeft de vastgoedsectie ongewijzigd door, los van de financiële velden (geen vermenging)", () => {
    const pl = plResultaat([{ rapportagecategorie: "Opbrengsten", bedrag: new Decimal("100000") }, { rapportagecategorie: "Kosten", bedrag: new Decimal("40000") }]);
    const vastgoed = vastgoedResultaat({
      bronPeildatum: null,
      controleVereist: [{ complexnr: "002", ernst: "WAARSCHUWING", bericht: "test-afwijking" }],
    });
    const resultaat = samenstelKerncijfersManagement(pl, { type: "bekend", waarde: new Decimal("60000") }, kasstroomResultaat(), true, vastgoed);

    expect(resultaat.vastgoed).toBe(vastgoed);
    expect(resultaat.vastgoed.momentopname).toBe(true);
    expect(resultaat.vastgoed.bronPeildatum).toBeNull();
    expect(resultaat.vastgoed.controleVereist).toEqual([{ complexnr: "002", ernst: "WAARSCHUWING", bericht: "test-afwijking" }]);
    // De financiële velden blijven exact wat berekenPlPeriode/berekenNettoResultaat/kasstroomResultaat opleveren, ongeacht de vastgoedinhoud.
    expect(resultaat.totaleOpbrengsten.toString()).toBe("100000");
    expect(resultaat.totaleKosten.toString()).toBe("40000");
  });
});
