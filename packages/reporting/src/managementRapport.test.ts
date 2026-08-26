import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { samenstelManagementRapport, type ManagementRapportInvoer, type ManagementRapportPeriodeSectie, type ManagementRapportStandSectie } from "./managementRapport.js";
import type { HuurKerncijfersResultaat } from "./huurKerncijfers.js";
import type { KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";
import type { VastgoedKerncijfersResultaat } from "./vastgoedKerncijfers.js";

const BEKEND = (n: string) => ({ type: "bekend" as const, waarde: new Decimal(n) });

function vastgoed(overrides: Partial<VastgoedKerncijfersResultaat> = {}): VastgoedKerncijfersResultaat {
  return {
    momentopname: true,
    bronPeildatum: new Date("2026-07-31T00:00:00.000Z"),
    portefeuille: { totaalVvo: BEKEND("100"), verhuurdeVvo: BEKEND("80"), leegstandVvo: BEKEND("20"), bezettingsgraad: BEKEND("80"), leegstandspercentage: BEKEND("20") },
    perComplex: [],
    controleVereist: [],
    ...overrides,
  };
}

function huur(overrides: Partial<HuurKerncijfersResultaat> = {}): HuurKerncijfersResultaat {
  return {
    momentopname: true,
    bronPeildatum: new Date("2026-07-31T00:00:00.000Z"),
    portefeuille: { brutoJaarhuur: BEKEND("10000"), huurkortingen: BEKEND("1000"), nettoJaarhuur: BEKEND("9000"), verhuurdeVvo: BEKEND("80"), brutoHuurPerM2: BEKEND("125"), nettoHuurPerM2: BEKEND("112.5") },
    perComplex: [],
    controleVereist: [],
    ...overrides,
  };
}

function kasstroom(overrides: Partial<KasstroomManagementoverzichtResultaat> = {}): KasstroomManagementoverzichtResultaat {
  return {
    bankstandBegin: new Decimal("1800"),
    bankstandEind: new Decimal("2000"),
    ontvangsten: new Decimal("500"),
    uitgaven: new Decimal("300"),
    nettoKasstroom: new Decimal("200"),
    eigenaarOnttrekkingen: new Decimal("300"),
    overigeUitgaven: new Decimal("0"),
    perKwartaal: [],
    controleVereist: [],
    ...overrides,
  };
}

function periode(overrides: Partial<ManagementRapportPeriodeSectie> = {}): ManagementRapportPeriodeSectie {
  return {
    boekperiodeVan: "04",
    boekperiodeTotEnMet: "06",
    totaleOpbrengsten: new Decimal("500"),
    totaleKosten: new Decimal("300"),
    resultaatPeriode: BEKEND("200"),
    kasstroom: kasstroom(),
    ...overrides,
  };
}

function stand(overrides: Partial<ManagementRapportStandSectie> = {}): ManagementRapportStandSectie {
  return {
    boekperiodeTotEnMet: "06",
    bankstandEinde: new Decimal("2000"),
    resultaatHuidigBoekjaarYtd: BEKEND("900"),
    balansSluit: true,
    ...overrides,
  };
}

function invoer(overrides: Partial<ManagementRapportInvoer> = {}): ManagementRapportInvoer {
  return {
    administratieNaam: "Rooise Zoom",
    bedrijfsnr: "070",
    boekjaar: 2026,
    gegenereerdOp: new Date("2026-08-26T10:00:00.000Z"),
    periode: periode(),
    stand: stand(),
    vastgoed: vastgoed(),
    huur: huur(),
    ...overrides,
  };
}

describe("samenstelManagementRapport", () => {
  it("houdt periode- en standcijfers strikt gescheiden — 'resultaat periode' en 'resultaat huidig boekjaar YTD' zijn twee losse velden", () => {
    const resultaat = samenstelManagementRapport(invoer());
    expect(resultaat.periode.resultaatPeriode).toEqual(BEKEND("200"));
    expect(resultaat.stand.resultaatHuidigBoekjaarYtd).toEqual(BEKEND("900"));
    expect(resultaat.periode.boekperiodeVan).toBe("04");
    expect(resultaat.periode.boekperiodeTotEnMet).toBe("06");
    expect(resultaat.stand.boekperiodeTotEnMet).toBe("06");
  });

  it("geeft vastgoed/huur/kasstroom ongewijzigd (identiek object) door, geen herberekening", () => {
    const inv = invoer();
    const resultaat = samenstelManagementRapport(inv);
    expect(resultaat.vastgoed).toBe(inv.vastgoed);
    expect(resultaat.huur).toBe(inv.huur);
    expect(resultaat.periode.kasstroom).toBe(inv.periode.kasstroom);
  });

  it("voegt geen controleVereist toe als alles schoon is", () => {
    const resultaat = samenstelManagementRapport(invoer());
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("meldt een onbekend resultaatPeriode én resultaatHuidigBoekjaarYtd apart als WAARSCHUWING", () => {
    const resultaat = samenstelManagementRapport(
      invoer({
        periode: periode({ resultaatPeriode: { type: "onbekend", reden: "periode-reden" } }),
        stand: stand({ resultaatHuidigBoekjaarYtd: { type: "onbekend", reden: "ytd-reden" } }),
      }),
    );
    expect(resultaat.controleVereist).toContainEqual({ sectie: "Financieel", ernst: "WAARSCHUWING", referentie: null, bericht: "periode-reden" });
    expect(resultaat.controleVereist).toContainEqual({ sectie: "Financieel", ernst: "WAARSCHUWING", referentie: null, bericht: "ytd-reden" });
  });

  it("meldt een niet-sluitende balans als KRITIEK", () => {
    const resultaat = samenstelManagementRapport(invoer({ stand: stand({ balansSluit: false }) }));
    expect(resultaat.controleVereist).toContainEqual({ sectie: "Financieel", ernst: "KRITIEK", referentie: null, bericht: "Balans sluit niet binnen tolerantie voor deze periode." });
  });

  it("combineert vastgoed-/huur-/kasstroom-controleVereist met de juiste sectielabel", () => {
    const resultaat = samenstelManagementRapport(
      invoer({
        vastgoed: vastgoed({ controleVereist: [{ complexnr: "002", ernst: "WAARSCHUWING", bericht: "vastgoed-afwijking" }] }),
        huur: huur({ controleVereist: [{ complexnr: "003", ernst: "KRITIEK", bericht: "huur-afwijking" }] }),
        periode: periode({ kasstroom: kasstroom({ controleVereist: [{ grootboekrekening: "9999", saldo: new Decimal("50"), reden: "onbekende rekening" }] }) }),
      }),
    );
    expect(resultaat.controleVereist).toContainEqual({ sectie: "Vastgoed", ernst: "WAARSCHUWING", referentie: "002", bericht: "vastgoed-afwijking" });
    expect(resultaat.controleVereist).toContainEqual({ sectie: "Huur", ernst: "KRITIEK", referentie: "003", bericht: "huur-afwijking" });
    expect(resultaat.controleVereist).toContainEqual({ sectie: "Kasstroom", ernst: "WAARSCHUWING", referentie: "9999", bericht: "onbekende rekening (saldo 50)" });
  });
});
