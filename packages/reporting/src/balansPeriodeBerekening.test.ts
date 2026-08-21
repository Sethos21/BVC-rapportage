import type { BalansRegel, GrootboekMappingRegel, ResultaatRegel } from "@bvc/config";
import type { Balansstand, Boekingsregel, OnbekendOf } from "@bvc/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBalansPeriode } from "./balansPeriodeBerekening.js";

function balansRegel(overrides: Partial<BalansRegel> = {}): BalansRegel {
  return {
    grootboekrekening: "1010",
    soort: "BALANS",
    balanszijde: "ACTIVA",
    tekenconventie: "ZOALS_BRON",
    actief: true,
    status: "GOEDGEKEURD",
    ...overrides,
  };
}

function resultaatRegel(overrides: Partial<ResultaatRegel> = {}): ResultaatRegel {
  return {
    grootboekrekening: "4000",
    soort: "RESULTAAT",
    rapportagepost: "Beheerkosten",
    rapportagecategorie: "Kosten",
    tekenconventie: "ZOALS_BRON",
    actief: true,
    status: "GOEDGEKEURD",
    ...overrides,
  };
}

function stand(overrides: Partial<Balansstand> = {}): Balansstand {
  return {
    bedrijfsnr: "070",
    jaar: 2026,
    grootboekrekeningnr: "1010",
    saldoDebet: new Decimal(0),
    saldoCredit: new Decimal(0),
    eindsaldo: new Decimal(0),
    beginbalansDebet: new Decimal(0),
    beginbalansCredit: new Decimal(0),
    rekeningOmschrijving: "Bank",
    ...overrides,
  };
}

function boeking(overrides: Partial<Boekingsregel> = {}): Boekingsregel {
  return {
    bedrijfsnr: "070",
    boekjaar: 2026,
    dagboeknr: "20",
    boekstuknr: "024001",
    volgnr: "000001",
    boekstukSleutel: "0704020024001",
    grootboeknr: "1010",
    boekdatum: new Date("2026-03-15"),
    omschrijving: "test",
    bedragDebet: new Decimal(0),
    bedragCredit: new Decimal(0),
    ...overrides,
  };
}

function bekendResultaat(waarde: string): OnbekendOf<Decimal> {
  return { type: "bekend", waarde: new Decimal(waarde) };
}

const onbekendResultaat: OnbekendOf<Decimal> = { type: "onbekend", reden: "test: nog geen P&L-resultaat aangeleverd" };

/** Gemakshelper: roept berekenBalansPeriode aan met een lege master (regels als override — de gebruikelijke testopstelling). */
function berekenMetOverride(
  balansstanden: readonly Balansstand[],
  boekingen: readonly Boekingsregel[],
  override: readonly (BalansRegel | ResultaatRegel)[],
  resultaatHuidigBoekjaar: OnbekendOf<Decimal>,
) {
  return berekenBalansPeriode(balansstanden, boekingen, [], override, resultaatHuidigBoekjaar);
}

describe("berekenBalansPeriode", () => {
  it("telt beginbalans + mutaties op tot het rauwe saldo en toont dat ongewijzigd bij tekenconventie ZOALS_BRON", () => {
    const resultaat = berekenMetOverride(
      [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("1000"), beginbalansCredit: new Decimal(0) })],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("500"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([
      {
        grootboekrekening: "1010",
        omschrijving: "Bank",
        rapportagecategorie: "ACTIVA",
        ruwSaldo: new Decimal("1500"),
        tekenconventie: "ZOALS_BRON",
        saldo: new Decimal("1500"),
        herkomst: "ADMINISTRATIE_OVERRIDE",
      },
    ]);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("keert het teken om bij OMGEKEERD, bv. een credit-normale Passiva-rekening die als positief schuldbedrag getoond moet worden", () => {
    const resultaat = berekenMetOverride(
      [stand({ grootboekrekeningnr: "1600", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("2000"), rekeningOmschrijving: "Crediteuren" })],
      [],
      [balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" })],
      onbekendResultaat,
    );
    // Rauw saldo is -2000 (credit-heavy); met OMGEKEERD getoond als +2000 (schuldbedrag).
    expect(resultaat.posten[0]?.ruwSaldo.toString()).toBe("-2000");
    expect(resultaat.posten[0]?.saldo.toString()).toBe("2000");
  });

  it("voert GEEN generieke tekenomkering per balanszijde uit: twee PASSIVA-rekeningen met verschillende tekenconventie tonen verschillend", () => {
    const resultaat = berekenMetOverride(
      [
        stand({ grootboekrekeningnr: "1600", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("2000"), rekeningOmschrijving: "Crediteuren" }),
        stand({ grootboekrekeningnr: "0840", beginbalansDebet: new Decimal("500"), beginbalansCredit: new Decimal(0), rekeningOmschrijving: "Onttrekkingen - Uitkeringen" }),
      ],
      [],
      [
        balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
        balansRegel({ grootboekrekening: "0840", balanszijde: "PASSIVA", tekenconventie: "ZOALS_BRON" }),
      ],
      onbekendResultaat,
    );
    const crediteuren = resultaat.posten.find((p) => p.grootboekrekening === "1600");
    const onttrekkingen = resultaat.posten.find((p) => p.grootboekrekening === "0840");
    // Verschillende tekenconventie per rekening, geen categorie-brede regel.
    expect(crediteuren?.saldo.toString()).toBe("2000");
    expect(onttrekkingen?.saldo.toString()).toBe("500");
  });

  it("houdt een PASSIVA-rekening op Passiva ook als het GETOONDE saldo positief is (geen classificatie op saldoteken)", () => {
    const resultaat = berekenMetOverride(
      [stand({ grootboekrekeningnr: "1600", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("300"), rekeningOmschrijving: "Crediteuren" })],
      [],
      [balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" })],
      onbekendResultaat,
    );
    expect(resultaat.posten[0]?.rapportagecategorie).toBe("PASSIVA");
    expect(resultaat.posten[0]?.saldo.toString()).toBe("300");
  });

  it("houdt een ACTIVA-rekening op Activa ook als het saldo negatief is (bv. een vooruitbetalende debiteur)", () => {
    const resultaat = berekenMetOverride(
      [stand({ grootboekrekeningnr: "1310", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("10000"), rekeningOmschrijving: "Huurdebiteuren" })],
      [],
      [balansRegel({ grootboekrekening: "1310", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" })],
      onbekendResultaat,
    );
    expect(resultaat.posten[0]?.rapportagecategorie).toBe("ACTIVA");
    expect(resultaat.posten[0]?.saldo.toString()).toBe("-10000");
  });

  it("markeert een BALANS-rekening met een nog niet bevestigde balanszijde (null) als controleVereist, verzint geen kant op basis van het saldoteken", () => {
    const resultaat = berekenMetOverride(
      [stand({ grootboekrekeningnr: "1506", beginbalansDebet: new Decimal("100"), beginbalansCredit: new Decimal(0), rekeningOmschrijving: "Afdrachten BTW" })],
      [],
      [balansRegel({ grootboekrekening: "1506", balanszijde: null, tekenconventie: null })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([
      { grootboekrekening: "1506", saldo: new Decimal("100"), reden: expect.any(String), herkomst: "ADMINISTRATIE_OVERRIDE" },
    ]);
    expect(resultaat.controleVereist[0]?.reden).toMatch(/[Bb]alanszijde/);
  });

  it("markeert een BALANS-rekening met bevestigde balanszijde maar onbevestigde tekenconventie als controleVereist", () => {
    const resultaat = berekenMetOverride(
      [stand({ grootboekrekeningnr: "1711", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("300"), rekeningOmschrijving: "Tussenrekening servicekst" })],
      [],
      [balansRegel({ grootboekrekening: "1711", balanszijde: "PASSIVA", tekenconventie: null })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([
      { grootboekrekening: "1711", saldo: new Decimal("-300"), reden: expect.any(String), herkomst: "ADMINISTRATIE_OVERRIDE" },
    ]);
    expect(resultaat.controleVereist[0]?.reden).toMatch(/[Tt]ekenconventie/);
  });

  it("laat een BALANS-rekening met onbevestigde balanszijde weg uit controleVereist als het saldo nul is", () => {
    const resultaat = berekenMetOverride(
      [stand({ grootboekrekeningnr: "1506", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal(0) })],
      [],
      [balansRegel({ grootboekrekening: "1506", balanszijde: null, tekenconventie: null })],
      onbekendResultaat,
    );
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("markeert een onbekende grootboekrekening met niet-nul mutatie als controleVereist, nooit stilzwijgend genegeerd", () => {
    const resultaat = berekenMetOverride(
      [],
      [boeking({ grootboeknr: "9999", bedragDebet: new Decimal("50"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010" })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([
      { grootboekrekening: "9999", saldo: new Decimal("50"), reden: expect.any(String), herkomst: "ONBEKEND" },
    ]);
  });

  it("laat een niet-gemapte rekening weg uit controleVereist als de mutatie in de periode per saldo nul is", () => {
    const resultaat = berekenMetOverride(
      [],
      [
        boeking({ grootboeknr: "9999", bedragDebet: new Decimal("50"), bedragCredit: new Decimal(0) }),
        boeking({ grootboeknr: "9999", bedragDebet: new Decimal(0), bedragCredit: new Decimal("50") }),
      ],
      [balansRegel({ grootboekrekening: "1010" })],
      onbekendResultaat,
    );
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("markeert een volledig ongemapte rekening met een stilstaande maar niet-nul BEGINBALANS als controleVereist, ook zonder mutatie deze periode (bugfix: was stilzwijgend onzichtbaar)", () => {
    const resultaat = berekenMetOverride(
      [stand({ grootboekrekeningnr: "9999", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("2329272"), rekeningOmschrijving: "Resultaat vorig boekjaar" })],
      [],
      [balansRegel({ grootboekrekening: "1010" })],
      onbekendResultaat,
    );
    expect(resultaat.controleVereist).toEqual([
      { grootboekrekening: "9999", saldo: new Decimal("-2329272"), reden: expect.any(String), herkomst: "ONBEKEND" },
    ]);
  });

  it("laat een volledig ongemapte rekening weg uit controleVereist als er noch een balansstand-rij noch een mutatie is", () => {
    const resultaat = berekenMetOverride([], [], [balansRegel({ grootboekrekening: "1010" })], onbekendResultaat);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("markeert een BALANS-rekening zonder balansstand-rij (geen beginbalans bekend) met mutatie als controleVereist, nooit als 0 aangenomen", () => {
    const resultaat = berekenMetOverride(
      [],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("100"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010" })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toHaveLength(1);
    expect(resultaat.controleVereist[0]?.reden).toMatch(/Geen balansstand/);
  });

  it("markeert een BALANS-rekening waarvan beide beginbalanskanten ontbreken (null) als controleVereist", () => {
    const resultaat = berekenMetOverride(
      [stand({ grootboekrekeningnr: "1010", beginbalansDebet: null, beginbalansCredit: null })],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("100"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010" })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toHaveLength(1);
    expect(resultaat.controleVereist[0]?.reden).toMatch(/Beginbalans/);
  });

  it("behandelt een eenzijdig ontbrekende beginbalanskant (andere kant wél aangeleverd) als 0, geen datagat", () => {
    const resultaat = berekenMetOverride(
      [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("300"), beginbalansCredit: null })],
      [],
      [balansRegel({ grootboekrekening: "1010" })],
      onbekendResultaat,
    );
    expect(resultaat.posten[0]?.saldo.toString()).toBe("300");
  });

  it("markeert een inactieve BALANS-mapping met mutatie alsnog als controleVereist", () => {
    const resultaat = berekenMetOverride(
      [stand({ grootboekrekeningnr: "1010" })],
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("50"), bedragCredit: new Decimal(0) })],
      [balansRegel({ grootboekrekening: "1010", actief: false })],
      onbekendResultaat,
    );
    expect(resultaat.controleVereist).toHaveLength(1);
  });

  it("negeert een RESULTAAT-rekening volledig in posten/controleVereist (die hoort in de P&L, niet hier)", () => {
    const resultaat = berekenMetOverride(
      [],
      [boeking({ grootboeknr: "4000", bedragDebet: new Decimal("75"), bedragCredit: new Decimal(0) })],
      [resultaatRegel({ grootboekrekening: "4000" })],
      onbekendResultaat,
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("groepeert posten per categorie in categorieTotalen (Activa en Passiva apart, geen abs())", () => {
    const resultaat = berekenMetOverride(
      [
        stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("1000"), beginbalansCredit: new Decimal(0) }),
        stand({ grootboekrekeningnr: "1711", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("400") }),
      ],
      [],
      [
        balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" }),
        balansRegel({ grootboekrekening: "1711", balanszijde: "PASSIVA", tekenconventie: "ZOALS_BRON" }),
      ],
      onbekendResultaat,
    );
    const activa = resultaat.categorieTotalen.find((c) => c.rapportagecategorie === "ACTIVA");
    const passiva = resultaat.categorieTotalen.find((c) => c.rapportagecategorie === "PASSIVA");
    expect(activa?.bedrag.toString()).toBe("1000");
    expect(passiva?.bedrag.toString()).toBe("-400");
  });

  describe("herkomst (master vs. administratie-override)", () => {
    it("markeert een rekening die alleen in de master staat als herkomst MASTER", () => {
      const resultaat = berekenBalansPeriode(
        [stand({ grootboekrekeningnr: "1400", beginbalansDebet: new Decimal("100"), beginbalansCredit: new Decimal(0) })],
        [],
        [balansRegel({ grootboekrekening: "1400", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" })],
        [],
        onbekendResultaat,
      );
      expect(resultaat.posten[0]?.herkomst).toBe("MASTER");
    });

    it("laat de administratie-override winnen (herkomst ADMINISTRATIE_OVERRIDE) voor een rekening die in beide voorkomt", () => {
      const resultaat = berekenBalansPeriode(
        [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("100"), beginbalansCredit: new Decimal(0) })],
        [],
        [balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA", tekenconventie: "OMGEKEERD" })],
        [balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" })],
        onbekendResultaat,
      );
      expect(resultaat.posten[0]?.herkomst).toBe("ADMINISTRATIE_OVERRIDE");
      expect(resultaat.posten[0]?.tekenconventie).toBe("ZOALS_BRON");
    });
  });

  describe("aansluitingscontrole (activaTotaal - passivaTotaal - resultaatHuidigBoekjaar)", () => {
    it("sluit wanneer activa, passiva (getoond) en het aangeleverde resultaat aan elkaar gelijk zijn", () => {
      const resultaat = berekenMetOverride(
        [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("500"), beginbalansCredit: new Decimal(0) })],
        [],
        [balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" })],
        bekendResultaat("500"),
      );
      expect(resultaat.aansluiting.verschil).toEqual({ type: "bekend", waarde: new Decimal("0") });
      expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(true);
    });

    it("toont een echt verschil wanneer activa/passiva niet overeenkomen met het resultaat", () => {
      const resultaat = berekenMetOverride(
        [stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("500"), beginbalansCredit: new Decimal(0) })],
        [],
        [balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" })],
        bekendResultaat("470"),
      );
      expect(resultaat.aansluiting.verschil).toEqual({ type: "bekend", waarde: new Decimal("30") });
      expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(false);
    });

    it("is onbekend (nooit stilzwijgend sluitend) als het resultaat huidig boekjaar zelf onbekend is", () => {
      const resultaat = berekenMetOverride([], [], [balansRegel()], onbekendResultaat);
      expect(resultaat.aansluiting.verschil.type).toBe("onbekend");
      expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(false);
    });
  });

  it("geeft een leeg resultaat voor lege invoer (sluit bij resultaat 0)", () => {
    const resultaat = berekenMetOverride([], [], [balansRegel()], bekendResultaat("0"));
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toEqual([]);
    expect(resultaat.aansluiting.verschil).toEqual({ type: "bekend", waarde: new Decimal("0") });
    expect(resultaat.aansluiting.sluitBinnenTolerantie).toBe(true);
  });
});

/**
 * Regressiereferentie: de echte productie-run van `bvc-worker.exe
 * balans-periode 070_Rooise_Zoom --boekjaar 2026 --periodeTotEnMet 06`
 * (2026-08-21), nadat alle 14 bevestigde BALANS-rekeningen (master +
 * 070-override, exact zoals in `<BVC_DATA_ROOT>/config/`) waren toegepast.
 * De echte bron-boekingen/balansstanden blijven buiten git (CLAUDE.md §5)
 * — deze test herbouwt daarom dezelfde beginbalans-per-rekening (géén
 * mutaties nodig: alleen het resulterende `ruwSaldo` is relevant) en de
 * exacte master/override-classificatie, en vergelijkt tegen de door de
 * gebruiker geverifieerde productie-output. Doel: een toekomstige,
 * onbedoelde wijziging aan `berekenBalansPeriode` (of aan de
 * `resolveerGrootboekMapping`/`presentatiefactorVoorRegel`/
 * `balanszijdeVoorRegel`-keten eronder) breekt deze test zodra de al
 * bewezen 070-aansluiting niet langer op €0,00 uitkomt — niet pas wanneer
 * dat in productie ontdekt wordt. Rekeningen 1505/1506 en de dormant-
 * rekeningen (bv. 1501/1940) horen hier bewust NIET bij: die blijven
 * `controleVereist` in productie (geen classificatie geraden) en vallen
 * dus buiten de scope van "de balans sluit".
 */
describe("regressie: 070_Rooise_Zoom, boekjaar 2026 t/m periode 06 (echte productie-run, 2026-08-21)", () => {
  const master: GrootboekMappingRegel[] = [
    balansRegel({ grootboekrekening: "1400", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" }),
    balansRegel({ grootboekrekening: "1410", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" }),
    balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: null }),
    balansRegel({ grootboekrekening: "1700", balanszijde: "PASSIVA", tekenconventie: null }),
    balansRegel({ grootboekrekening: "1712", balanszijde: "ACTIVA", tekenconventie: null }),
  ];
  const override: GrootboekMappingRegel[] = [
    balansRegel({ grootboekrekening: "0840", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
    balansRegel({ grootboekrekening: "0850", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
    balansRegel({ grootboekrekening: "0901", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
    balansRegel({ grootboekrekening: "0902", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
    balansRegel({ grootboekrekening: "0903", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
    balansRegel({ grootboekrekening: "1010", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" }),
    balansRegel({ grootboekrekening: "1310", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" }),
    balansRegel({ grootboekrekening: "1600", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
    balansRegel({ grootboekrekening: "1700", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
    balansRegel({ grootboekrekening: "1711", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
    balansRegel({ grootboekrekening: "1712", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON" }),
    balansRegel({ grootboekrekening: "1790", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD" }),
  ];
  // Rauwe saldi (ruwSaldo) exact zoals de echte productie-run rapporteerde — als beginbalans
  // gemodelleerd (geen boekingen nodig): berekenBalansPeriode telt beginbalans + mutatie op,
  // dus beginbalans = ruwSaldo + 0 mutatie levert hetzelfde ruwSaldo op.
  const balansstanden: Balansstand[] = [
    stand({ grootboekrekeningnr: "0840", beginbalansDebet: new Decimal("2703646.45"), beginbalansCredit: new Decimal(0) }),
    stand({ grootboekrekeningnr: "0850", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("2329272.01") }),
    stand({ grootboekrekeningnr: "0901", beginbalansDebet: new Decimal("4577.18"), beginbalansCredit: new Decimal(0) }),
    stand({ grootboekrekeningnr: "0902", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("22019.21") }),
    stand({ grootboekrekeningnr: "0903", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("3939.55") }),
    stand({ grootboekrekeningnr: "1010", beginbalansDebet: new Decimal("73038.37"), beginbalansCredit: new Decimal(0) }),
    stand({ grootboekrekeningnr: "1310", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("26645.71") }),
    stand({ grootboekrekeningnr: "1400", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("300") }),
    stand({ grootboekrekeningnr: "1410", beginbalansDebet: new Decimal("6745.98"), beginbalansCredit: new Decimal(0) }),
    stand({ grootboekrekeningnr: "1600", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("27754.56") }),
    stand({ grootboekrekeningnr: "1700", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("3321.96") }),
    stand({ grootboekrekeningnr: "1711", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("114530") }),
    stand({ grootboekrekeningnr: "1712", beginbalansDebet: new Decimal("91177.91"), beginbalansCredit: new Decimal(0) }),
    stand({ grootboekrekeningnr: "1790", beginbalansDebet: new Decimal(0), beginbalansCredit: new Decimal("40223.23") }),
  ];

  it("reproduceert de bevestigde productie-aansluiting exact: Activa 144.016,55 / Passiva -167.163,11 / verschil 0,00", () => {
    const resultaat = berekenBalansPeriode(balansstanden, [], master, override, bekendResultaat("311179.66"));

    expect(resultaat.posten).toHaveLength(14);
    expect(resultaat.controleVereist).toEqual([]);
    expect(resultaat.categorieTotalen).toEqual([
      { rapportagecategorie: "ACTIVA", bedrag: new Decimal("144016.55") },
      { rapportagecategorie: "PASSIVA", bedrag: new Decimal("-167163.11") },
    ]);
    expect(resultaat.aansluiting).toEqual({
      activaTotaal: new Decimal("144016.55"),
      passivaTotaal: new Decimal("-167163.11"),
      resultaatHuidigBoekjaar: { type: "bekend", waarde: new Decimal("311179.66") },
      verschil: { type: "bekend", waarde: new Decimal("0") },
      sluitBinnenTolerantie: true,
    });
  });

  it("kent elke bevestigde 070-rekening het juiste GETOONDE saldo toe (locked per rekening, niet alleen het totaal)", () => {
    const resultaat = berekenBalansPeriode(balansstanden, [], master, override, bekendResultaat("311179.66"));
    const saldoPerRekening = new Map(resultaat.posten.map((p) => [p.grootboekrekening, p.saldo.toString()]));

    expect(Object.fromEntries(saldoPerRekening)).toEqual({
      "0840": "-2703646.45",
      "0850": "2329272.01",
      "0901": "-4577.18",
      "0902": "22019.21",
      "0903": "3939.55",
      "1010": "73038.37",
      "1310": "-26645.71",
      "1400": "-300",
      "1410": "6745.98",
      "1600": "27754.56",
      "1700": "3321.96",
      "1711": "114530",
      "1712": "91177.91",
      "1790": "40223.23",
    });
  });
});
