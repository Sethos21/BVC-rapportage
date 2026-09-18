import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { bepaalPeriodeWeergave, berekenOpenstaandePosten, classificeerOpenstaandePosten, type OpSaldoHuurderRegel, type OpVorderingRegel } from "./openstaandePosten.js";

function vordering(overrides: Partial<OpVorderingRegel> = {}): OpVorderingRegel {
  return {
    bedrijfsnr: "070",
    contractnummer: "0000000028",
    vorderingVolgnummer: "00000093",
    huurdernummer: "00000021",
    complexnummer: "002",
    unitnummer: "0001",
    factuurnummer: "2670000108",
    datumVordering: new Date("2026-09-01T00:00:00.000Z"),
    omschrijving: "Periode september 2026",
    totaalbedrag: new Decimal(5940.98),
    bedragAfgeboekt: new Decimal(0),
    openstaand: new Decimal(5940.98),
    ...overrides,
  };
}

function saldoHuurder(overrides: Partial<OpSaldoHuurderRegel> = {}): OpSaldoHuurderRegel {
  return {
    huurdernummer: "00000021",
    achterstand: new Decimal(5940.98),
    achterstandTm30Dagen: new Decimal(5940.98),
    achterstandTm60Dagen: new Decimal(0),
    achterstandTm90Dagen: new Decimal(0),
    achterstand90PlusDagen: new Decimal(0),
    vooruitbetaling: new Decimal(0),
    saldo: new Decimal(5940.98),
    ...overrides,
  };
}

describe("berekenOpenstaandePosten", () => {
  it("volledig afgeboekte posten (openstaand = 0) tellen niet mee als openstaande post", () => {
    const resultaat = berekenOpenstaandePosten(
      [vordering({ openstaand: new Decimal(0), bedragAfgeboekt: new Decimal(5940.98) })],
      [saldoHuurder({ achterstand: new Decimal(0), achterstandTm30Dagen: new Decimal(0), saldo: new Decimal(0) })],
      true,
    );
    expect(resultaat.huurders[0]?.openstaandePosten).toHaveLength(0);
    expect(resultaat.huurders[0]?.detailtotaal.toString()).toBe("0");
  });

  it("gedeeltelijk openstaande post: detailtotaal = openstaand-bedrag, geen volledig totaalbedrag", () => {
    const resultaat = berekenOpenstaandePosten(
      [vordering({ totaalbedrag: new Decimal(1000), bedragAfgeboekt: new Decimal(400), openstaand: new Decimal(600) })],
      [saldoHuurder({ achterstand: new Decimal(600), achterstandTm30Dagen: new Decimal(600), saldo: new Decimal(600) })],
      true,
    );
    expect(resultaat.huurders[0]?.detailtotaal.toString()).toBe("600");
  });

  it("negatieve openstaande post (credit) blijft exact negatief — nooit Math.abs()", () => {
    const resultaat = berekenOpenstaandePosten(
      [vordering({ huurdernummer: "00000033", omschrijving: "Service-afrekening 0004", totaalbedrag: new Decimal(-146.9), openstaand: new Decimal(-146.9) })],
      [saldoHuurder({ huurdernummer: "00000033", achterstand: new Decimal(-146.9), achterstandTm30Dagen: new Decimal(0), achterstand90PlusDagen: new Decimal(-146.9), saldo: new Decimal(-146.9) })],
      true,
    );
    const huurder = resultaat.huurders.find((h) => h.huurdernummer === "00000033");
    expect(huurder?.detailtotaal.toString()).toBe("-146.9");
    expect(huurder?.detailtotaal.isNegative()).toBe(true);
    expect(huurder?.verschilMetSaldo?.toString()).toBe("0");
  });

  it("iTapToo: twee contracten (044/049) onder dezelfde huurder blijven apart in de postenlijst, samen op het huurdertotaal", () => {
    const resultaat = berekenOpenstaandePosten(
      [
        vordering({ huurdernummer: "00000030", contractnummer: "0000000044", vorderingVolgnummer: "00000061", totaalbedrag: new Decimal(3544.33), openstaand: new Decimal(3544.33) }),
        vordering({ huurdernummer: "00000030", contractnummer: "0000000049", vorderingVolgnummer: "00000030", totaalbedrag: new Decimal(1409.38), openstaand: new Decimal(1409.38) }),
      ],
      [saldoHuurder({ huurdernummer: "00000030", achterstand: new Decimal(4953.71), achterstandTm30Dagen: new Decimal(4953.71), saldo: new Decimal(4953.71) })],
      true,
    );
    const huurder = resultaat.huurders.find((h) => h.huurdernummer === "00000030");
    expect(huurder?.openstaandePosten).toHaveLength(2);
    expect(huurder?.openstaandePosten.map((p) => p.contractnummer).sort()).toEqual(["0000000044", "0000000049"]);
    expect(huurder?.detailtotaal.toString()).toBe("4953.71");
    expect(huurder?.saldoHuurders?.toString()).toBe("4953.71");
    expect(huurder?.verschilMetSaldo?.toString()).toBe("0");
  });

  it("ontbrekende unit (Destiny-contract 0000000043) wordt ongewijzigd als null doorgegeven, geen crash", () => {
    const resultaat = berekenOpenstaandePosten(
      [vordering({ huurdernummer: "00000028", contractnummer: "0000000043", unitnummer: null })],
      [saldoHuurder({ huurdernummer: "00000028" })],
      true,
    );
    expect(resultaat.huurders[0]?.openstaandePosten[0]?.unitnummer).toBeNull();
  });

  it("070-reconciliatie: 14/14 huurders MATCH levert geen enkele WAARSCHUWING op (debiteurenbeheer=true)", () => {
    const huurders070 = [
      { h: "00000021", bedrag: 5940.98 }, { h: "00000022", bedrag: 2388.39 }, { h: "00000024", bedrag: 4814.17 },
      { h: "00000028", bedrag: 15384.74 }, { h: "00000031", bedrag: 13970.47 }, { h: "00000032", bedrag: 14174.36 },
      { h: "00000034", bedrag: 4331.65 },
    ];
    const vorderingen070 = huurders070.map((x) => vordering({ huurdernummer: x.h, totaalbedrag: new Decimal(x.bedrag), openstaand: new Decimal(x.bedrag) }));
    const saldo070 = huurders070.map((x) => saldoHuurder({ huurdernummer: x.h, achterstand: new Decimal(x.bedrag), achterstandTm30Dagen: new Decimal(x.bedrag), saldo: new Decimal(x.bedrag) }));

    const resultaat = berekenOpenstaandePosten(vorderingen070, saldo070, true);
    expect(resultaat.controleVereist).toHaveLength(0);
    expect(resultaat.totaalOpenstaandDetail.toString()).toBe("61004.76");
    expect(resultaat.totaalSaldoHuurders.toString()).toBe("61004.76");
  });

  it("debiteurenbeheer=true met een echt verschil: WAARSCHUWING per huurder, nooit stilzwijgend genegeerd", () => {
    const resultaat = berekenOpenstaandePosten(
      [vordering({ openstaand: new Decimal(1000) })],
      [saldoHuurder({ saldo: new Decimal(1500) })],
      true,
    );
    expect(resultaat.controleVereist).toHaveLength(1);
    expect(resultaat.controleVereist[0]?.ernst).toBe("WAARSCHUWING");
    expect(resultaat.controleVereist[0]?.huurdernummer).toBe("00000021");
  });

  it("debiteurenbeheer=false: hetzelfde verschil levert GEEN WAARSCHUWING op, wel één structurele INFORMATIEF-melding", () => {
    const resultaat = berekenOpenstaandePosten(
      [vordering({ openstaand: new Decimal(1000) })],
      [saldoHuurder({ saldo: new Decimal(1500) })],
      false,
    );
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" || c.ernst === "KRITIEK")).toBe(false);
    expect(resultaat.controleVereist).toHaveLength(1);
    expect(resultaat.controleVereist[0]?.ernst).toBe("INFORMATIEF");
    expect(resultaat.controleVereist[0]?.huurdernummer).toBeNull();
    expect(resultaat.controleVereist[0]?.bericht).toContain("niet door ons bijgehouden");
    // De cijfers zelf blijven gewoon beschikbaar — alleen de presentatie-ernst verandert.
    expect(resultaat.huurders[0]?.detailtotaal.toString()).toBe("1000");
    expect(resultaat.huurders[0]?.verschilMetSaldo?.toString()).toBe("-500");
  });

  it('debiteurenbeheer="onbekend": neutrale WAARSCHUWING-melding, geen automatische true-aanname', () => {
    const resultaat = berekenOpenstaandePosten([vordering()], [saldoHuurder()], "onbekend");
    expect(resultaat.controleVereist).toHaveLength(1);
    expect(resultaat.controleVereist[0]?.ernst).toBe("WAARSCHUWING");
    expect(resultaat.controleVereist[0]?.bericht).toContain("nog niet geclassificeerd");
    // Zelfs bij een exacte match wordt de "onbekend"-melding niet stilzwijgend weggelaten.
    expect(resultaat.debiteurenbeheer).toBe("onbekend");
  });

  it("saldo_huurders-buckets worden ongewijzigd doorgegeven, nooit zelfberekend", () => {
    const resultaat = berekenOpenstaandePosten(
      [vordering()],
      [saldoHuurder({ achterstandTm30Dagen: new Decimal(1000), achterstandTm60Dagen: new Decimal(2000), achterstandTm90Dagen: new Decimal(3000), achterstand90PlusDagen: new Decimal(4000), vooruitbetaling: new Decimal(-50) })],
      true,
    );
    expect(resultaat.huurders[0]?.buckets).toEqual({
      tm30: new Decimal(1000), tm60: new Decimal(2000), tm90: new Decimal(3000), negentigPlus: new Decimal(4000), vooruitbetaling: new Decimal(-50),
    });
  });

  it("huurder zonder saldo_huurders-rij: buckets/saldoHuurders/verschilMetSaldo zijn null, geen crash of gegokte 0", () => {
    const resultaat = berekenOpenstaandePosten([vordering({ huurdernummer: "99999999" })], [], true);
    const huurder = resultaat.huurders.find((h) => h.huurdernummer === "99999999");
    expect(huurder?.saldoHuurders).toBeNull();
    expect(huurder?.verschilMetSaldo).toBeNull();
    expect(huurder?.buckets).toBeNull();
    expect(resultaat.controleVereist.some((c) => c.bericht.includes("geen saldo_huurders-rij gevonden"))).toBe(true);
  });

  it("Decimal-precisie: geen drijvendekommafouten bij optelling van veel kleine bedragen", () => {
    const posten = Array.from({ length: 10 }, (_, i) => vordering({ vorderingVolgnummer: String(i), totaalbedrag: new Decimal("0.1"), openstaand: new Decimal("0.1") }));
    const resultaat = berekenOpenstaandePosten(posten, [saldoHuurder({ saldo: new Decimal("1.0") })], true);
    expect(resultaat.huurders[0]?.detailtotaal.toString()).toBe("1");
    expect(resultaat.controleVereist).toHaveLength(0);
  });
});

describe("classificeerOpenstaandePosten", () => {
  const PEILDATUM = new Date("2026-09-01T00:00:00.000Z");

  it("Datum_Vordering = peildatum (betaaltermijn 0) → NIET_VERVALLEN, de dag zelf telt nog niet mee", () => {
    const [p] = classificeerOpenstaandePosten([vordering({ datumVordering: new Date("2026-09-01T00:00:00.000Z") })], PEILDATUM, 0);
    expect(p?.classificatie).toBe("NIET_VERVALLEN");
    expect(p?.dagenVervallen).toBeNull();
  });

  it("Datum_Vordering één dag vóór peildatum → VERVALLEN, 1 dag vervallen", () => {
    const [p] = classificeerOpenstaandePosten([vordering({ datumVordering: new Date("2026-08-31T00:00:00.000Z") })], PEILDATUM, 0);
    expect(p?.classificatie).toBe("VERVALLEN");
    expect(p?.dagenVervallen).toBe(1);
  });

  it("toekomstige Datum_Vordering → NIET_VERVALLEN", () => {
    const [p] = classificeerOpenstaandePosten([vordering({ datumVordering: new Date("2026-09-15T00:00:00.000Z") })], PEILDATUM, 0);
    expect(p?.classificatie).toBe("NIET_VERVALLEN");
  });

  it("positieve vervallen post: bedrag en dagenVervallen kloppen exact", () => {
    const [p] = classificeerOpenstaandePosten(
      [vordering({ datumVordering: new Date("2026-08-01T00:00:00.000Z"), totaalbedrag: new Decimal(5940.98), openstaand: new Decimal(5940.98) })],
      PEILDATUM,
      0,
    );
    expect(p?.classificatie).toBe("VERVALLEN");
    expect(p?.dagenVervallen).toBe(31);
    expect(p?.openstaand.toString()).toBe("5940.98");
  });

  it("negatieve oude post → CREDIT, nooit VERVALLEN, ongeacht hoe oud", () => {
    const [p] = classificeerOpenstaandePosten(
      [vordering({ datumVordering: new Date("2020-01-01T00:00:00.000Z"), totaalbedrag: new Decimal(-146.9), openstaand: new Decimal(-146.9) })],
      PEILDATUM,
      0,
    );
    expect(p?.classificatie).toBe("CREDIT");
    expect(p?.dagenVervallen).toBeNull();
  });

  it("nulpost (openstaand = 0) wordt uitgesloten, niet geclassificeerd", () => {
    const resultaat = classificeerOpenstaandePosten([vordering({ openstaand: new Decimal(0) })], PEILDATUM, 0);
    expect(resultaat).toHaveLength(0);
  });

  it("betaaltermijnDagen > 0: vervaldatum schuift op, latere peildatum nodig voor VERVALLEN", () => {
    const post = vordering({ datumVordering: new Date("2026-08-25T00:00:00.000Z") });
    const metCoulance = classificeerOpenstaandePosten([post], PEILDATUM, 14);
    expect(metCoulance[0]?.classificatie).toBe("NIET_VERVALLEN"); // vervaldatum 2026-09-08, nog niet bereikt op 2026-09-01
    const zonderCoulance = classificeerOpenstaandePosten([post], PEILDATUM, 0);
    expect(zonderCoulance[0]?.classificatie).toBe("VERVALLEN");
  });
});

describe("bepaalPeriodeWeergave", () => {
  it("reguliere maand: 'Periode september 2026' → 'September 2026'", () => {
    expect(bepaalPeriodeWeergave("Periode september 2026")).toBe("September 2026");
  });

  it("meermaandsperiode blijft verbatim, wordt nooit tot één maand teruggebracht", () => {
    expect(bepaalPeriodeWeergave("Periode juni t/m september 2026")).toBe("Periode juni t/m september 2026");
  });

  it("onbekende/vrije-tekst omschrijvingen blijven 'onbekend' — geen periode verzinnen", () => {
    expect(bepaalPeriodeWeergave("Service-afrekening 0004")).toBe("onbekend");
    expect(bepaalPeriodeWeergave("Suppletie 2026")).toBe("onbekend");
    expect(bepaalPeriodeWeergave("Doorbelasting kosten")).toBe("onbekend");
    expect(bepaalPeriodeWeergave("Boete te late betaling")).toBe("onbekend");
    expect(bepaalPeriodeWeergave("Periode september 2026 correctie")).toBe("onbekend");
    expect(bepaalPeriodeWeergave(null)).toBe("onbekend");
  });
});
