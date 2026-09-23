import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenDebiteurenAansluiting, somBalansPostenVoorRekeningen, somOuderdomsanalyseBuckets } from "./debiteurenAansluiting.js";
import type { BalansPeriodePost } from "./balansPeriodeBerekening.js";
import type { OpHuurderRegel, OpResultaat } from "./openstaandePosten.js";

function balansPost(grootboekrekening: string, saldo: string): BalansPeriodePost {
  return { grootboekrekening, omschrijving: null, rapportagecategorie: "ACTIVA", ruwSaldo: new Decimal(saldo), tekenconventie: "ZOALS_BRON", saldo: new Decimal(saldo), herkomst: "MASTER" };
}

function huurderRegel(huurdernummer: string, buckets: OpHuurderRegel["buckets"]): OpHuurderRegel {
  return { huurdernummer, openstaandePosten: [], detailtotaal: new Decimal(0), saldoHuurders: null, verschilMetSaldo: null, buckets };
}

function opResultaat(totaalSaldoHuurders: string, huurders: OpHuurderRegel[] = []): OpResultaat {
  return { debiteurenbeheer: true, huurders, totaalOpenstaandDetail: new Decimal(0), totaalSaldoHuurders: new Decimal(totaalSaldoHuurders), controleVereist: [] };
}

describe("berekenDebiteurenAansluiting — scenario A: aansluiting akkoord", () => {
  it("sluitBinnenTolerantie is true wanneer balans en ouderdomsanalyse exact gelijk zijn", () => {
    const posten = [balansPost("1310", "65811.57"), balansPost("1010", "999999")]; // 1010 mag niet meetellen (niet in debiteurenGrootboekrekeningen)
    const resultaat = berekenDebiteurenAansluiting(posten, ["1310"], opResultaat("65811.57"));

    expect(resultaat.balansBedrag.toString()).toBe("65811.57");
    expect(resultaat.ouderdomsanalyseBedrag.toString()).toBe("65811.57");
    expect(resultaat.verschil.toString()).toBe("0");
    expect(resultaat.sluitBinnenTolerantie).toBe(true);
  });

  it("blijft akkoord binnen de bestaande €0,01-tolerantie", () => {
    const resultaat = berekenDebiteurenAansluiting([balansPost("1310", "100.00")], ["1310"], opResultaat("99.99"));
    expect(resultaat.sluitBinnenTolerantie).toBe(true);
  });
});

describe("berekenDebiteurenAansluiting — scenario B: aansluiting niet akkoord", () => {
  it("sluitBinnenTolerantie is false bij een verschil groter dan de tolerantie, en het verschil is expliciet zichtbaar", () => {
    const resultaat = berekenDebiteurenAansluiting([balansPost("1310", "50000")], ["1310"], opResultaat("65811.57"));

    expect(resultaat.sluitBinnenTolerantie).toBe(false);
    expect(resultaat.balansBedrag.toString()).toBe("50000");
    expect(resultaat.ouderdomsanalyseBedrag.toString()).toBe("65811.57");
    expect(resultaat.verschil.toString()).toBe("-15811.57");
  });
});

describe("berekenDebiteurenAansluiting — scenario C: geen fictieve bedragen", () => {
  it("een lege ouderdomsanalyse (totaalSaldoHuurders 0) geeft gewoon het werkelijke verschil, nooit een verzonnen 'aansluit'-status", () => {
    const resultaat = berekenDebiteurenAansluiting([balansPost("1310", "65811.57")], ["1310"], opResultaat("0"));
    expect(resultaat.sluitBinnenTolerantie).toBe(false);
    expect(resultaat.ouderdomsanalyseBedrag.toString()).toBe("0");
  });
});

describe("somBalansPostenVoorRekeningen", () => {
  it("telt uitsluitend de opgegeven rekeningen op, negeert overige balansposten", () => {
    const posten = [balansPost("1310", "100"), balansPost("1010", "500"), balansPost("1320", "25")];
    expect(somBalansPostenVoorRekeningen(posten, ["1310", "1320"]).toString()).toBe("125");
  });

  it("levert 0 op als geen enkele post overeenkomt", () => {
    expect(somBalansPostenVoorRekeningen([balansPost("1010", "500")], ["1310"]).toString()).toBe("0");
  });
});

describe("somOuderdomsanalyseBuckets", () => {
  it("telt de reeds bewezen per-huurder buckets bij elkaar op, zonder nieuwe berekening", () => {
    const huurders = [
      huurderRegel("1", { tm30: new Decimal("100"), tm60: new Decimal("10"), tm90: new Decimal("0"), negentigPlus: new Decimal("0"), vooruitbetaling: new Decimal("0") }),
      huurderRegel("2", { tm30: new Decimal("50"), tm60: new Decimal("0"), tm90: new Decimal("20"), negentigPlus: new Decimal("5"), vooruitbetaling: new Decimal("-15") }),
    ];
    const buckets = somOuderdomsanalyseBuckets(huurders);
    expect(buckets.tm30.toString()).toBe("150");
    expect(buckets.tm60.toString()).toBe("10");
    expect(buckets.tm90.toString()).toBe("20");
    expect(buckets.negentigPlus.toString()).toBe("5");
    expect(buckets.vooruitbetaling.toString()).toBe("-15");
  });

  it("een huurder zonder saldo_huurders-rij (buckets null) telt mee als 0, blokkeert de som niet", () => {
    const huurders = [huurderRegel("1", null), huurderRegel("2", { tm30: new Decimal("10"), tm60: new Decimal("0"), tm90: new Decimal("0"), negentigPlus: new Decimal("0"), vooruitbetaling: new Decimal("0") })];
    expect(somOuderdomsanalyseBuckets(huurders).tm30.toString()).toBe("10");
  });
});
