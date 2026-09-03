import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenVastgoedKerncijfers,
  type VastgoedComplexTotaalRegel,
  type VastgoedRentrollRegel,
  type VastgoedUnitRegel,
} from "./vastgoedKerncijfers.js";

function unit(complexnr: string, unitnr: string, vvo: string | null): VastgoedUnitRegel {
  return { complexnr, unitnr, vvo: vvo === null ? null : new Decimal(vvo) };
}

function rentrollRegel(
  contractnummer: string,
  complexnr: string | null,
  gehuurdOppervlak: string | null,
  prolongatieBedragJaar: string | null = null,
  rapportageDatum: Date | null = null,
): VastgoedRentrollRegel {
  return {
    contractnummer,
    complexnr,
    gehuurdOppervlak: gehuurdOppervlak === null ? null : new Decimal(gehuurdOppervlak),
    prolongatieBedragJaar: prolongatieBedragJaar === null ? null : new Decimal(prolongatieBedragJaar),
    rapportageDatum,
  };
}

function complexTotaal(complexnr: string, totaalOppervlakte: string | null, totaalVerhuurd: string | null, totaalLeegstand: string | null): VastgoedComplexTotaalRegel {
  return {
    complexnr,
    totaalOppervlakte: totaalOppervlakte === null ? null : new Decimal(totaalOppervlakte),
    totaalVerhuurd: totaalVerhuurd === null ? null : new Decimal(totaalVerhuurd),
    totaalLeegstand: totaalLeegstand === null ? null : new Decimal(totaalLeegstand),
  };
}

/** Echte 070_Rooise_Zoom-brondata (controlerapport 2026-08-26) — het bottom-up-onderzoek dat aan v1 voorafging. */
function fixture070() {
  const units: VastgoedUnitRegel[] = [
    unit("001", "0001", "430"),
    unit("001", "0002", "320"),
    unit("001", "0003", "320"),
    unit("001", "0004", "320"),
    unit("001", "0005", "0"),
    unit("002", "0001", "320"),
    unit("002", "0002", "139"),
    unit("002", "0003", "495"),
    unit("002", "0004", "184"),
    unit("003", "0001", "255"),
    unit("003", "0002", "335"),
    unit("003", "0003", "202"),
    unit("003", "0004", "120"),
    unit("004", "0001", "1633.5"),
    unit("004", "0002", "1700"),
  ];
  const rentroll: VastgoedRentrollRegel[] = [
    rentrollRegel("0000000028", "002", "320", "37318.80"),
    rentrollRegel("0000000029", "002", "139", "14686.56"),
    rentrollRegel("0000000031", "003", "255", "29383.80"),
    rentrollRegel("0000000038", "001", "320", "37617.12"),
    rentrollRegel("0000000043", "001", "750", "92875.92"),
    rentrollRegel("0000000044", "003", "202", "23150.40"),
    rentrollRegel("0000000045", "004", "1633.5", "136150.08"),
    rentrollRegel("0000000046", "004", "1700", "170092.32"),
    rentrollRegel("0000000048", "001", "320", "38137.44"),
    rentrollRegel("0000000049", "003", "120", "12777.36"),
    rentrollRegel("0000000049", "003", "0", "-6000.00"),
    rentrollRegel("0000000051", "003", "335", "34078.56"),
    rentrollRegel("0000000051", "003", "0", "-7920.00"),
    rentrollRegel("0000000052", "002", "495", "61632.52"),
  ];
  const complexTotalen: VastgoedComplexTotaalRegel[] = [
    complexTotaal("001", "1390", "1390", "0"),
    complexTotaal("002", "1138", "954", "0"),
    complexTotaal("003", "912", "912", "0"),
    complexTotaal("004", "0", "3333.5", "0"),
  ];
  return { units, rentroll, complexTotalen };
}

describe("berekenVastgoedKerncijfers — regressie 070_Rooise_Zoom", () => {
  it("berekent de portefeuille-KPI's bottom-up uit units + rentroll, exact zoals het onderzoek", () => {
    const { units, rentroll, complexTotalen } = fixture070();
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, complexTotalen);

    expect(resultaat.momentopname).toBe(true);
    expect(resultaat.portefeuille.totaalVvo).toEqual({ type: "bekend", waarde: new Decimal("6773.5") });
    expect(resultaat.portefeuille.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("6589.5") });
    expect(resultaat.portefeuille.leegstandVvo).toEqual({ type: "bekend", waarde: new Decimal("184") });
    const verwachteBezettingsgraad = new Decimal("6589.5").dividedBy("6773.5").times(100);
    const verwachteLeegstandspercentage = new Decimal("184").dividedBy("6773.5").times(100);
    expect(resultaat.portefeuille.bezettingsgraad).toEqual({ type: "bekend", waarde: verwachteBezettingsgraad });
    expect(resultaat.portefeuille.leegstandspercentage).toEqual({ type: "bekend", waarde: verwachteLeegstandspercentage });
    expect(verwachteBezettingsgraad.toDecimalPlaces(2).toString()).toBe("97.28");
    expect(verwachteLeegstandspercentage.toDecimalPlaces(2).toString()).toBe("2.72");
  });

  it("berekent elk complex correct (001/003 sluiten 100%, 002 heeft leegstand, 004 is volledig verhuurd)", () => {
    const { units, rentroll, complexTotalen } = fixture070();
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, complexTotalen);
    const perComplex = Object.fromEntries(resultaat.perComplex.map((c) => [c.complexnr, c]));

    expect(perComplex["001"]?.totaalVvo).toEqual({ type: "bekend", waarde: new Decimal("1390") });
    expect(perComplex["001"]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("1390") });
    expect(perComplex["001"]?.leegstandVvo).toEqual({ type: "bekend", waarde: new Decimal("0") });

    expect(perComplex["002"]?.totaalVvo).toEqual({ type: "bekend", waarde: new Decimal("1138") });
    expect(perComplex["002"]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("954") });
    expect(perComplex["002"]?.leegstandVvo).toEqual({ type: "bekend", waarde: new Decimal("184") });
    expect(perComplex["002"]?.bezettingsgraad.type).toBe("bekend");
    if (perComplex["002"]?.bezettingsgraad.type === "bekend") {
      expect(perComplex["002"].bezettingsgraad.waarde.toDecimalPlaces(2).toString()).toBe("83.83");
    }

    expect(perComplex["003"]?.totaalVvo).toEqual({ type: "bekend", waarde: new Decimal("912") });
    expect(perComplex["003"]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("912") });

    expect(perComplex["004"]?.totaalVvo).toEqual({ type: "bekend", waarde: new Decimal("3333.5") });
    expect(perComplex["004"]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("3333.5") });
    expect(perComplex["004"]?.leegstandVvo).toEqual({ type: "bekend", waarde: new Decimal("0") });
  });

  it("signaleert de bekende afwijkingen in complex_totalen voor 002 en 004 als controleVereist, ook al is de KPI zelf betrouwbaar", () => {
    const { units, rentroll, complexTotalen } = fixture070();
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, complexTotalen);

    const item002 = resultaat.controleVereist.find((i) => i.complexnr === "002" && i.ernst === "WAARSCHUWING" && i.bericht.includes("Totaal_Leegstand"));
    expect(item002).toBeDefined();

    const item004 = resultaat.controleVereist.find((i) => i.complexnr === "004" && i.ernst === "WAARSCHUWING" && i.bericht.includes("Totaal_Oppervlakte"));
    expect(item004).toBeDefined();

    // Complex 001 en 003 hebben geen KRITIEK/WAARSCHUWING (alleen mogelijk INFORMATIEF, bv. de 0 m²-unit/kortingsregels).
    const problemen001of003 = resultaat.controleVereist.filter((i) => (i.complexnr === "001" || i.complexnr === "003") && i.ernst !== "INFORMATIEF");
    expect(problemen001of003).toEqual([]);
  });

  it("markeert de 0 m²-unit (001/0005) en de 0 m²-rentrollregels (kortingen op 003) als INFORMATIEF, niet als probleem", () => {
    const { units, rentroll, complexTotalen } = fixture070();
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, complexTotalen);

    expect(resultaat.controleVereist.some((i) => i.complexnr === "001" && i.ernst === "INFORMATIEF" && i.bericht.includes("0005"))).toBe(true);
    expect(resultaat.controleVereist.filter((i) => i.complexnr === "003" && i.ernst === "INFORMATIEF" && i.bericht.includes("correctie-/kortingsregel"))).toHaveLength(2);
  });
});

describe("berekenVastgoedKerncijfers — datakwaliteitsregels (synthetische gevallen)", () => {
  it("regel 3: verhuurde VVO > totale VVO is KRITIEK, geen negatieve leegstand of bezettingsgraad >100%", () => {
    const units: VastgoedUnitRegel[] = [unit("999", "0001", "100")];
    const rentroll: VastgoedRentrollRegel[] = [rentrollRegel("C1", "999", "150")];
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, []);

    const complex = resultaat.perComplex[0];
    expect(complex?.totaalVvo).toEqual({ type: "bekend", waarde: new Decimal("100") });
    expect(complex?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("150") });
    expect(complex?.leegstandVvo.type).toBe("onbekend");
    expect(complex?.bezettingsgraad.type).toBe("onbekend");
    expect(complex?.leegstandspercentage.type).toBe("onbekend");
    expect(resultaat.controleVereist.some((i) => i.complexnr === "999" && i.ernst === "KRITIEK")).toBe(true);
    // Portefeuille mag ook geen (mogelijk absurd) totaal tonen als een complex kritiek is.
    expect(resultaat.portefeuille.bezettingsgraad.type).toBe("onbekend");
  });

  it("regel 4: null VVO wordt niet stilzwijgend als 0 behandeld — totale VVO wordt onbekend", () => {
    const units: VastgoedUnitRegel[] = [unit("999", "0001", "100"), unit("999", "0002", null)];
    const resultaat = berekenVastgoedKerncijfers(units, [], []);

    expect(resultaat.perComplex[0]?.totaalVvo.type).toBe("onbekend");
    expect(resultaat.controleVereist.some((i) => i.complexnr === "999" && i.ernst === "WAARSCHUWING" && i.bericht.includes("VVO"))).toBe(true);
  });

  it("regel 4: null gehuurd_oppervlak wordt niet stilzwijgend als 0 behandeld — verhuurde VVO wordt onbekend", () => {
    const units: VastgoedUnitRegel[] = [unit("999", "0001", "100")];
    const rentroll: VastgoedRentrollRegel[] = [rentrollRegel("C1", "999", null)];
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, []);

    expect(resultaat.perComplex[0]?.verhuurdeVvo.type).toBe("onbekend");
  });

  it("regel 6: rentroll-regels met gehuurd_oppervlak = 0 tellen niet mee in de verhuurde-VVO-som, maar worden gedetecteerd", () => {
    const units: VastgoedUnitRegel[] = [unit("999", "0001", "100")];
    const rentroll: VastgoedRentrollRegel[] = [rentrollRegel("C1", "999", "60"), rentrollRegel("C2", "999", "0", "-10")];
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, []);

    expect(resultaat.perComplex[0]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("60") });
    expect(resultaat.controleVereist.some((i) => i.complexnr === "999" && i.ernst === "INFORMATIEF" && i.bericht.includes("C2"))).toBe(true);
  });

  it("regel 7: 0 m² met positieve jaarhuur is een afwijkend patroon (WAARSCHUWING, niet INFORMATIEF)", () => {
    const units: VastgoedUnitRegel[] = [unit("999", "0001", "100")];
    const rentroll: VastgoedRentrollRegel[] = [rentrollRegel("C1", "999", "0", "500")];
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, []);

    const item = resultaat.controleVereist.find((i) => i.complexnr === "999" && i.bericht.includes("C1"));
    expect(item?.ernst).toBe("WAARSCHUWING");
    expect(item?.bericht).toContain("afwijkend patroon");
  });

  it("regel 7: negatieve jaarhuur met oppervlak > 0 is een afwijkend patroon, maar het oppervlak telt wel mee", () => {
    const units: VastgoedUnitRegel[] = [unit("999", "0001", "100")];
    const rentroll: VastgoedRentrollRegel[] = [rentrollRegel("C1", "999", "60", "-500")];
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, []);

    expect(resultaat.perComplex[0]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("60") });
    const item = resultaat.controleVereist.find((i) => i.complexnr === "999" && i.bericht.includes("C1"));
    expect(item?.ernst).toBe("WAARSCHUWING");
    expect(item?.bericht).toContain("afwijkend patroon");
  });

  it("bugfix: 0 m² met jaarhuur = 0 is NIET afwijkend (decimal.js isPositive() behandelt 0 ten onrechte als positief — .greaterThan(0) hoort hier)", () => {
    const units: VastgoedUnitRegel[] = [unit("999", "0001", "100")];
    const rentroll: VastgoedRentrollRegel[] = [rentrollRegel("C1", "999", "0", "0")];
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, []);

    const item = resultaat.controleVereist.find((i) => i.complexnr === "999" && i.bericht.includes("C1"));
    expect(item?.ernst).toBe("INFORMATIEF");
    expect(item?.bericht).not.toContain("afwijkend patroon");
  });

  it("een negatief gehuurd_oppervlak is KRITIEK en telt niet mee (geen aanname over de betekenis)", () => {
    const units: VastgoedUnitRegel[] = [unit("999", "0001", "100")];
    const rentroll: VastgoedRentrollRegel[] = [rentrollRegel("C1", "999", "60"), rentrollRegel("C2", "999", "-20")];
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, []);

    expect(resultaat.perComplex[0]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("60") });
    expect(resultaat.controleVereist.some((i) => i.complexnr === "999" && i.ernst === "KRITIEK" && i.bericht.includes("C2"))).toBe(true);
  });

  it("regel 8: een afwijking met complex_totalen wordt gemeld, maar de bottom-up waarde blijft leidend (geen auto-correctie)", () => {
    const units: VastgoedUnitRegel[] = [unit("999", "0001", "100")];
    const rentroll: VastgoedRentrollRegel[] = [rentrollRegel("C1", "999", "80")];
    const complexTotalen: VastgoedComplexTotaalRegel[] = [complexTotaal("999", "500", "80", "420")];
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, complexTotalen);

    // complex_totalen zegt 500 m², bottom-up zegt 100 m² — de KPI blijft 100, niet 500.
    expect(resultaat.perComplex[0]?.totaalVvo).toEqual({ type: "bekend", waarde: new Decimal("100") });
    expect(resultaat.controleVereist.some((i) => i.complexnr === "999" && i.bericht.includes("Totaal_Oppervlakte"))).toBe(true);
  });

  it("een rentroll-regel zonder complexnummer wordt buiten alle sommen gehouden en apart gesignaleerd", () => {
    const units: VastgoedUnitRegel[] = [unit("999", "0001", "100")];
    const rentroll: VastgoedRentrollRegel[] = [rentrollRegel("C1", "999", "60"), rentrollRegel("C2", null, "9999")];
    const resultaat = berekenVastgoedKerncijfers(units, rentroll, []);

    expect(resultaat.perComplex[0]?.verhuurdeVvo).toEqual({ type: "bekend", waarde: new Decimal("60") });
    expect(resultaat.controleVereist.some((i) => i.complexnr === null && i.ernst === "WAARSCHUWING" && i.bericht.includes("C2"))).toBe(true);
  });

  it("bronPeildatum: alleen gerapporteerd als alle niet-lege rapportage_datum-waarden identiek zijn", () => {
    const units: VastgoedUnitRegel[] = [unit("999", "0001", "100")];
    const datum = new Date("2026-08-01T00:00:00.000Z");
    const gelijk = berekenVastgoedKerncijfers(units, [rentrollRegel("C1", "999", "10", null, datum), rentrollRegel("C2", "999", "10", null, datum)], []);
    expect(gelijk.bronPeildatum).toEqual(datum);

    const afwijkend = berekenVastgoedKerncijfers(
      units,
      [rentrollRegel("C1", "999", "10", null, datum), rentrollRegel("C2", "999", "10", null, new Date("2026-07-01T00:00:00.000Z"))],
      [],
    );
    expect(afwijkend.bronPeildatum).toBeNull();

    const geen = berekenVastgoedKerncijfers(units, [rentrollRegel("C1", "999", "10")], []);
    expect(geen.bronPeildatum).toBeNull();
  });
});
