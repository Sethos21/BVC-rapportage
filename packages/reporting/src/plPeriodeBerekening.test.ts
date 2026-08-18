import type { BalansRegel, ResultaatRegel } from "@bvc/config";
import type { Boekingsregel } from "@bvc/domain";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenPlPeriode, vergelijkMetGereconcilieerd } from "./plPeriodeBerekening.js";

function mappingRegel(overrides: Partial<ResultaatRegel> = {}): ResultaatRegel {
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

function balansRegel(overrides: Partial<BalansRegel> = {}): BalansRegel {
  return {
    grootboekrekening: "1010",
    soort: "BALANS",
    actief: true,
    status: "GOEDGEKEURD",
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
    grootboeknr: "4000",
    boekdatum: new Date("2026-03-15"),
    omschrijving: "test",
    bedragDebet: new Decimal(0),
    bedragCredit: new Decimal(0),
    ...overrides,
  };
}

describe("berekenPlPeriode", () => {
  it("berekent een rapportagepost-totaal met ZOALS_BRON (kosten blijven zoals de bron)", () => {
    const resultaat = berekenPlPeriode(
      [boeking({ grootboeknr: "4000", bedragDebet: new Decimal("100"), bedragCredit: new Decimal("0") })],
      [mappingRegel({ grootboekrekening: "4000", tekenconventie: "ZOALS_BRON" })],
    );
    expect(resultaat.posten).toEqual([{ rapportagepost: "Beheerkosten", rapportagecategorie: "Kosten", bedrag: new Decimal("100") }]);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("keert het teken om bij OMGEKEERD (bv. een credit-normale opbrengstrekening)", () => {
    const resultaat = berekenPlPeriode(
      [boeking({ grootboeknr: "8800", bedragDebet: new Decimal("0"), bedragCredit: new Decimal("1000") })],
      [mappingRegel({ grootboekrekening: "8800", rapportagepost: "Huuropbrengsten belast", rapportagecategorie: "Opbrengsten", tekenconventie: "OMGEKEERD" })],
    );
    expect(resultaat.posten[0]?.bedrag.toString()).toBe("1000");
  });

  it("telt meerdere boekingen op dezelfde rapportagepost op (rapportregelsom)", () => {
    const regels = [mappingRegel({ grootboekrekening: "4000" })];
    const resultaat = berekenPlPeriode(
      [
        boeking({ grootboeknr: "4000", bedragDebet: new Decimal("60"), bedragCredit: new Decimal("0") }),
        boeking({ grootboeknr: "4000", bedragDebet: new Decimal("40"), bedragCredit: new Decimal("0") }),
      ],
      regels,
    );
    expect(resultaat.posten[0]?.bedrag.toString()).toBe("100");
  });

  it("groepeert posten per rapportagecategorie (som binnen de categorie, geen gecombineerd nettoresultaat over categorieën)", () => {
    const regels = [
      mappingRegel({ grootboekrekening: "4000", rapportagepost: "Beheerkosten", rapportagecategorie: "Kosten", tekenconventie: "ZOALS_BRON" }),
      mappingRegel({ grootboekrekening: "4130", rapportagepost: "Verzekeringen", rapportagecategorie: "Kosten", tekenconventie: "ZOALS_BRON" }),
      mappingRegel({ grootboekrekening: "8800", rapportagepost: "Huuropbrengsten belast", rapportagecategorie: "Opbrengsten", tekenconventie: "OMGEKEERD" }),
    ];
    const resultaat = berekenPlPeriode(
      [
        boeking({ grootboeknr: "4000", bedragDebet: new Decimal("100"), bedragCredit: new Decimal("0") }),
        boeking({ grootboeknr: "4130", bedragDebet: new Decimal("25"), bedragCredit: new Decimal("0") }),
        boeking({ grootboeknr: "8800", bedragDebet: new Decimal("0"), bedragCredit: new Decimal("500") }),
      ],
      regels,
    );
    expect(resultaat.categorieTotalen).toHaveLength(2);
    const kosten = resultaat.categorieTotalen.find((c) => c.rapportagecategorie === "Kosten");
    const opbrengsten = resultaat.categorieTotalen.find((c) => c.rapportagecategorie === "Opbrengsten");
    expect(kosten?.bedrag.toString()).toBe("125");
    expect(opbrengsten?.bedrag.toString()).toBe("500");
  });

  it("markeert een onbekende grootboekrekening met niet-nul saldo als controleVereist, nooit stilzwijgend genegeerd", () => {
    const resultaat = berekenPlPeriode(
      [boeking({ grootboeknr: "9999", bedragDebet: new Decimal("50"), bedragCredit: new Decimal("0") })],
      [mappingRegel({ grootboekrekening: "4000" })],
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toHaveLength(1);
    expect(resultaat.controleVereist[0]).toMatchObject({ grootboekrekening: "9999", saldo: new Decimal("50") });
  });

  it("markeert een inactieve mapping met niet-nul saldo als controleVereist", () => {
    const resultaat = berekenPlPeriode(
      [boeking({ grootboeknr: "4000", bedragDebet: new Decimal("50"), bedragCredit: new Decimal("0") })],
      [mappingRegel({ grootboekrekening: "4000", actief: false })],
    );
    expect(resultaat.controleVereist).toHaveLength(1);
  });

  it("markeert een onbevestigde tekenconventie (null) met niet-nul saldo als controleVereist, verzint geen factor", () => {
    const resultaat = berekenPlPeriode(
      [boeking({ grootboeknr: "4000", bedragDebet: new Decimal("50"), bedragCredit: new Decimal("0") })],
      [mappingRegel({ grootboekrekening: "4000", tekenconventie: null })],
    );
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.controleVereist).toHaveLength(1);
  });

  it("laat een niet-gemapte rekening weg uit controleVereist als het saldo binnen de periode per saldo nul is", () => {
    const resultaat = berekenPlPeriode(
      [
        boeking({ grootboeknr: "9999", bedragDebet: new Decimal("50"), bedragCredit: new Decimal("0") }),
        boeking({ grootboeknr: "9999", bedragDebet: new Decimal("0"), bedragCredit: new Decimal("50") }),
      ],
      [mappingRegel({ grootboekrekening: "4000" })],
    );
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("geeft een leeg resultaat voor een lege boekingenlijst", () => {
    const resultaat = berekenPlPeriode([], [mappingRegel()]);
    expect(resultaat.posten).toEqual([]);
    expect(resultaat.categorieTotalen).toEqual([]);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("negeert een bekende BALANS-rekening met saldo stil: geen post, geen controleVereist (bv. bank/debiteuren/crediteuren)", () => {
    const resultaat = berekenPlPeriode(
      [
        boeking({ grootboeknr: "1010", bedragDebet: new Decimal("71430.87"), bedragCredit: new Decimal("0") }),
        boeking({ grootboeknr: "4000", bedragDebet: new Decimal("100"), bedragCredit: new Decimal("0") }),
      ],
      [balansRegel({ grootboekrekening: "1010" }), mappingRegel({ grootboekrekening: "4000" })],
    );
    expect(resultaat.posten).toEqual([{ rapportagepost: "Beheerkosten", rapportagecategorie: "Kosten", bedrag: new Decimal("100") }]);
    expect(resultaat.controleVereist).toEqual([]);
  });

  it("markeert een inactieve BALANS-mapping met saldo alsnog als controleVereist (inactief = niet meer bekend)", () => {
    const resultaat = berekenPlPeriode(
      [boeking({ grootboeknr: "1010", bedragDebet: new Decimal("50"), bedragCredit: new Decimal("0") })],
      [balansRegel({ grootboekrekening: "1010", actief: false })],
    );
    expect(resultaat.controleVereist).toHaveLength(1);
  });
});

describe("vergelijkMetGereconcilieerd", () => {
  function resultaatMetEenPost(bedrag: string) {
    return berekenPlPeriode(
      [boeking({ grootboeknr: "4000", bedragDebet: new Decimal(bedrag), bedragCredit: new Decimal("0") })],
      [mappingRegel({ grootboekrekening: "4000" })],
    );
  }

  it("markeert een regel binnen tolerantie als sluitend", () => {
    const resultaat = resultaatMetEenPost("100.00");
    const vergelijking = vergelijkMetGereconcilieerd(resultaat, new Map([["Beheerkosten", new Decimal("100.00")]]), new Decimal("0.01"));
    expect(vergelijking.regels).toHaveLength(1);
    expect(vergelijking.regels[0]?.sluitBinnenTolerantie).toBe(true);
    expect(vergelijking.regels[0]?.verschil.toString()).toBe("0");
  });

  it("markeert een regel buiten tolerantie als niet-sluitend, met het verschil", () => {
    const resultaat = resultaatMetEenPost("100.00");
    const vergelijking = vergelijkMetGereconcilieerd(resultaat, new Map([["Beheerkosten", new Decimal("95.87")]]), new Decimal("0.01"));
    expect(vergelijking.regels[0]?.sluitBinnenTolerantie).toBe(false);
    expect(vergelijking.regels[0]?.verschil.toString()).toBe("4.13");
  });

  it("zet een rapportagepost met een verwacht bedrag maar zonder berekend bedrag in ontbrekendInBerekening, nooit als 0 vergeleken", () => {
    const resultaat = berekenPlPeriode([], [mappingRegel()]);
    const vergelijking = vergelijkMetGereconcilieerd(resultaat, new Map([["Beheerkosten", new Decimal("100")]]), new Decimal("0.01"));
    expect(vergelijking.regels).toEqual([]);
    expect(vergelijking.ontbrekendInBerekening).toEqual(["Beheerkosten"]);
  });

  it("zet een berekende rapportagepost zonder verwacht bedrag in onverwachtInBerekening", () => {
    const resultaat = resultaatMetEenPost("100.00");
    const vergelijking = vergelijkMetGereconcilieerd(resultaat, new Map(), new Decimal("0.01"));
    expect(vergelijking.regels).toEqual([]);
    expect(vergelijking.onverwachtInBerekening).toEqual(["Beheerkosten"]);
  });
});
