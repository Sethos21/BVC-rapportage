import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { samenstelManagementRapport, type ManagementRapportInvoer } from "./managementRapport.js";
import type { KerncijfersManagementResultaat } from "./kerncijfersManagement.js";
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

function kerncijfers(overrides: Partial<KerncijfersManagementResultaat> = {}): KerncijfersManagementResultaat {
  return {
    totaleOpbrengsten: new Decimal("100000"),
    totaleKosten: new Decimal("40000"),
    resultaatHuidigBoekjaar: BEKEND("60000"),
    bankstandEindePeriode: new Decimal("12345.67"),
    nettoKasstroom: new Decimal("2000"),
    eigenaarOnttrekkingen: new Decimal("500"),
    balansSluitBinnenTolerantie: true,
    vastgoed: vastgoed(),
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
    bankstandBegin: new Decimal("1000"),
    bankstandEind: new Decimal("12345.67"),
    ontvangsten: new Decimal("5000"),
    uitgaven: new Decimal("3000"),
    nettoKasstroom: new Decimal("2000"),
    eigenaarOnttrekkingen: new Decimal("500"),
    overigeUitgaven: new Decimal("2500"),
    perKwartaal: [],
    controleVereist: [],
    ...overrides,
  };
}

function invoer(overrides: Partial<ManagementRapportInvoer> = {}): ManagementRapportInvoer {
  return {
    administratieNaam: "Rooise Zoom",
    bedrijfsnr: "070",
    boekjaar: 2026,
    boekperiodeTotEnMet: "06",
    gegenereerdOp: new Date("2026-08-26T10:00:00.000Z"),
    kerncijfers: kerncijfers(),
    kasstroom: kasstroom(),
    huur: huur(),
    ...overrides,
  };
}

describe("samenstelManagementRapport", () => {
  it("geeft de financiële velden ongewijzigd door in managementsamenvatting", () => {
    const resultaat = samenstelManagementRapport(invoer());
    expect(resultaat.managementsamenvatting).toEqual({
      totaleOpbrengsten: new Decimal("100000"),
      totaleKosten: new Decimal("40000"),
      resultaatHuidigBoekjaar: BEKEND("60000"),
      bankstandEinde: new Decimal("12345.67"),
      nettoKasstroom: new Decimal("2000"),
      eigenaarOnttrekkingen: new Decimal("500"),
      balansSluit: true,
    });
  });

  it("geeft vastgoed/huur/kasstroom ongewijzigd (identiek object) door, geen herberekening", () => {
    const inv = invoer();
    const resultaat = samenstelManagementRapport(inv);
    expect(resultaat.vastgoed).toBe(inv.kerncijfers.vastgoed);
    expect(resultaat.huur).toBe(inv.huur);
    expect(resultaat.kasstroom).toBe(inv.kasstroom);
  });

  it("geeft topOverigeUitgaven door indien aanwezig, undefined indien niet meegegeven", () => {
    const zonder = samenstelManagementRapport(invoer());
    expect(zonder.topOverigeUitgaven).toBeUndefined();

    const top = [{ boekdatum: new Date("2026-03-01T00:00:00.000Z"), bedrag: new Decimal("5000"), omschrijving: "Grote uitgave" }];
    const met = samenstelManagementRapport(invoer({ topOverigeUitgaven: top }));
    expect(met.topOverigeUitgaven).toBe(top);
  });

  it("voegt geen controleVereist toe als alles schoon is", () => {
    const resultaat = samenstelManagementRapport(invoer());
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("meldt een onbekend resultaatHuidigBoekjaar als WAARSCHUWING in sectie Financieel", () => {
    const resultaat = samenstelManagementRapport(invoer({ kerncijfers: kerncijfers({ resultaatHuidigBoekjaar: { type: "onbekend", reden: "test-reden" } }) }));
    expect(resultaat.controleVereist).toContainEqual({ sectie: "Financieel", ernst: "WAARSCHUWING", referentie: null, bericht: "test-reden" });
  });

  it("meldt een niet-sluitende balans als KRITIEK in sectie Financieel", () => {
    const resultaat = samenstelManagementRapport(invoer({ kerncijfers: kerncijfers({ balansSluitBinnenTolerantie: false }) }));
    expect(resultaat.controleVereist).toContainEqual({ sectie: "Financieel", ernst: "KRITIEK", referentie: null, bericht: "Balans sluit niet binnen tolerantie voor deze periode." });
  });

  it("combineert vastgoed-/huur-controleVereist met de juiste sectielabel, referentie = complexnr", () => {
    const resultaat = samenstelManagementRapport(
      invoer({
        kerncijfers: kerncijfers({ vastgoed: vastgoed({ controleVereist: [{ complexnr: "002", ernst: "WAARSCHUWING", bericht: "vastgoed-afwijking" }] }) }),
        huur: huur({ controleVereist: [{ complexnr: "003", ernst: "KRITIEK", bericht: "huur-afwijking" }] }),
      }),
    );
    expect(resultaat.controleVereist).toContainEqual({ sectie: "Vastgoed", ernst: "WAARSCHUWING", referentie: "002", bericht: "vastgoed-afwijking" });
    expect(resultaat.controleVereist).toContainEqual({ sectie: "Huur", ernst: "KRITIEK", referentie: "003", bericht: "huur-afwijking" });
  });

  it("combineert kasstroom-controleVereist (grootboekrekening/saldo/reden) als WAARSCHUWING met sectie Kasstroom", () => {
    const resultaat = samenstelManagementRapport(
      invoer({ kasstroom: kasstroom({ controleVereist: [{ grootboekrekening: "9999", saldo: new Decimal("123.45"), reden: "onbekende rekening" }] }) }),
    );
    expect(resultaat.controleVereist).toContainEqual({ sectie: "Kasstroom", ernst: "WAARSCHUWING", referentie: "9999", bericht: "onbekende rekening (saldo 123.45)" });
  });
});
