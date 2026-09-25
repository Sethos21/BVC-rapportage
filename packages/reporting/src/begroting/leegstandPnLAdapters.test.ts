import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  LEEGSTAND_CATEGORIEEN,
  berekenBegroteLeegstand,
  berekenEstimatedLeegstand,
  berekenWerkelijkLeegstand,
  type BgLeegstandCategorie,
  type BgLeegstandCategorieAannames,
  type BgLeegstandRegelInvoer,
} from "./begroteLeegstand.js";
import {
  LEEGSTANDSKOSTEN_NIET_GECLASSIFICEERD_SLEUTEL,
  LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL_SLEUTEL,
  LEEGSTANDSKOSTEN_PNL_SLEUTEL,
  leegstandBegrotingNaarPnLBovenEbitdaRegels,
  leegstandEstimatedNaarPnLBovenEbitdaRegels,
  leegstandWerkelijkNaarPnLBovenEbitdaRegels,
} from "./leegstandPnLAdapters.js";
import { berekenPnLBoom } from "../pnlEngine.js";

/** Leegstandskosten → P&L (Vervolgtranche 8). Bedragen zijn expliciet gemarkeerde testfixtures. */

const D = (n: string | number) => new Decimal(n);
const regel = (categorie: BgLeegstandCategorie, q: [number | null, number | null, number | null, number | null], o: Partial<BgLeegstandRegelInvoer> = {}): BgLeegstandRegelInvoer => ({
  categorie,
  complexnummer: null,
  complexomschrijving: null,
  omschrijving: "Leegstand",
  q1: q[0] === null ? null : D(q[0]),
  q2: q[1] === null ? null : D(q[1]),
  q3: q[2] === null ? null : D(q[2]),
  q4: q[3] === null ? null : D(q[3]),
  ...o,
});
const aannames = (beoordeeld: Record<BgLeegstandCategorie, boolean>): Record<BgLeegstandCategorie, BgLeegstandCategorieAannames> =>
  Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c) => [c, { beoordeeld: beoordeeld[c], laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null }])) as never;
const ALLES = { NUTS_LEEGSTAND: true, SERVICEKOSTEN_LEEGSTAND: true, OVERIGE_LEEGSTANDSKOSTEN: true };
const begroot = (regels: BgLeegstandRegelInvoer[], beoordeeld = ALLES) => berekenBegroteLeegstand(regels, aannames(beoordeeld), { begrotingsjaar: 2027 });
const hoofd = (regels: ReturnType<typeof leegstandBegrotingNaarPnLBovenEbitdaRegels>) => regels.find((r) => r.regelSleutel === LEEGSTANDSKOSTEN_PNL_SLEUTEL)!;
const werkelijk = (saldos: Partial<Record<BgLeegstandCategorie, number>> = {}, nietGeclassificeerd = 0) => {
  const ogb: Record<BgLeegstandCategorie, string> = { NUTS_LEEGSTAND: "N1", SERVICEKOSTEN_LEEGSTAND: "S1", OVERIGE_LEEGSTANDSKOSTEN: "O1" };
  const boekingen: { ogbKostensoort: string | null; complexnummer: string | null; saldo: Decimal }[] = (Object.entries(saldos) as [BgLeegstandCategorie, number][]).map(([c, s]) => ({ ogbKostensoort: ogb[c], complexnummer: "003", saldo: D(s) }));
  if (nietGeclassificeerd !== 0) boekingen.push({ ogbKostensoort: "ONBEKEND", complexnummer: null, saldo: D(nietGeclassificeerd) });
  return berekenWerkelijkLeegstand(boekingen, LEEGSTAND_CATEGORIEEN.map((c) => ({ ogbKostensoort: ogb[c], ogbKostensoortOmschrijving: c, categorie: c })));
};

describe("Begroting Leegstandskosten → één P&L-regel", () => {
  const b = begroot([regel("NUTS_LEEGSTAND", [100, 100, 100, 100]), regel("SERVICEKOSTEN_LEEGSTAND", [50, 50, 50, 50], { complexnummer: "001" }), regel("OVERIGE_LEEGSTANDSKOSTEN", [0, 0, 25, 25])]);

  it("1. Nuts + Servicekosten + Overige = de ene post Leegstandskosten (400 + 200 + 50 = 650); Q1-Q4 telt op tot het jaarbedrag; complex en NTB blijven toegestaan", () => {
    expect(b.moduleTotaal.toString()).toBe("650");
    expect(b.perCategorie.map((c) => c.categorieTotaal.toString())).toEqual(["400", "200", "50"]);
    const regels = leegstandBegrotingNaarPnLBovenEbitdaRegels(b);
    expect(regels).toHaveLength(1);
    expect(hoofd(regels)).toMatchObject({ regelSleutel: "LEEGSTANDSKOSTEN", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: { status: "BEKEND", bedrag: D(650) } });
  });

  it("2. de drie kostensoorten zijn onderbouwing (specificaties), geen extra hoofdregels; de engine telt ze niet dubbel", () => {
    const regels = leegstandBegrotingNaarPnLBovenEbitdaRegels(b);
    expect(hoofd(regels).specificaties!.map((s) => s.label)).toEqual([...LEEGSTAND_CATEGORIEEN]);
    const boom = berekenPnLBoom("BEGROTING_NIEUW_JAAR", regels);
    expect(boom.exploitatieLasten.besteWetenSom.toString()).toBe("650");
    expect(boom.exploitatieLasten.regels).toHaveLength(1);
  });

  it("3. bewust €0 is bekend (beoordeeld zonder regels); niet beoordeeld is onbekend, geen €0", () => {
    const nul = leegstandBegrotingNaarPnLBovenEbitdaRegels(begroot([]));
    expect(hoofd(nul).waarde).toEqual({ status: "BEKEND", bedrag: D(0) });
    const geen = leegstandBegrotingNaarPnLBovenEbitdaRegels(begroot([], { NUTS_LEEGSTAND: false, SERVICEKOSTEN_LEEGSTAND: false, OVERIGE_LEEGSTANDSKOSTEN: false }));
    expect(hoofd(geen).waarde.status).toBe("ONBEKEND");
  });

  it("4. een onbekend onderdeel: de post is de som van de bekende onderdelen én een ONBEKEND-regel maakt de uitkomst ONVOLLEDIG (beste-weten-som blijft zichtbaar)", () => {
    const deels = begroot([regel("NUTS_LEEGSTAND", [10, 10, 10, 10])], { NUTS_LEEGSTAND: true, SERVICEKOSTEN_LEEGSTAND: false, OVERIGE_LEEGSTANDSKOSTEN: true });
    const regels = leegstandBegrotingNaarPnLBovenEbitdaRegels(deels);
    expect(hoofd(regels).waarde).toEqual({ status: "BEKEND", bedrag: D(40) });
    const extra = regels.find((r) => r.regelSleutel === LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL_SLEUTEL)!;
    expect(extra.waarde.status).toBe("ONBEKEND");
    expect((extra.waarde as { toelichting: string }).toelichting).toContain("SERVICEKOSTEN_LEEGSTAND");
    const boom = berekenPnLBoom("BEGROTING_NIEUW_JAAR", regels);
    expect(boom.exploitatieLasten.besteWetenSom.toString()).toBe("40");
    expect(boom.exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(boom.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("5. een kritieke controle op één kostensoort maakt alleen die kostensoort onbekend", () => {
    const kritiek = begroot([regel("NUTS_LEEGSTAND", [1, 1, 1, 1], { omschrijving: "" })]); // lege omschrijving = KRITIEK
    const regels = leegstandBegrotingNaarPnLBovenEbitdaRegels(kritiek);
    expect(regels.some((r) => r.regelSleutel === LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL_SLEUTEL)).toBe(true);
    expect((regels.find((r) => r.regelSleutel === LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL_SLEUTEL)!.waarde as { toelichting: string }).toelichting).toContain("NUTS_LEEGSTAND");
  });

  it("6. een lege kwartaalwaarde (null) is geen €0: de regel telt veilig 0 mee maar is KRITIEK, dus de kostensoort is onbekend", () => {
    const leeg = begroot([regel("NUTS_LEEGSTAND", [100, null, 100, 100])]);
    const regels = leegstandBegrotingNaarPnLBovenEbitdaRegels(leeg);
    expect(regels.some((r) => r.regelSleutel === LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL_SLEUTEL)).toBe(true);
  });
});

describe("Werkelijk Leegstandskosten → P&L: onbekend zonder bewezen mapping; Actual exact één keer", () => {
  const gemapt = new Set<string>(LEEGSTAND_CATEGORIEEN);
  it("7. met bewezen mapping voor alle kostensoorten: Werkelijk exact één keer in de post (30 + 20 + 5 = 55), geen kunstmatige verdeling", () => {
    const w = werkelijk({ NUTS_LEEGSTAND: 30, SERVICEKOSTEN_LEEGSTAND: 20, OVERIGE_LEEGSTANDSKOSTEN: 5 });
    const regels = leegstandWerkelijkNaarPnLBovenEbitdaRegels(w, true, gemapt);
    expect(regels).toHaveLength(1);
    expect(hoofd(regels).waarde).toEqual({ status: "BEKEND", bedrag: D(55) });
    expect(berekenPnLBoom("WERKELIJK", regels).exploitatieLasten.besteWetenSom.toString()).toBe("55");
  });

  it("8. zonder enige leegstand-mapping voor de administratie (geen bewezen bron): de post is ONBEKEND — nooit een bevestigde €0", () => {
    const regels = leegstandWerkelijkNaarPnLBovenEbitdaRegels(werkelijk(), true, new Set());
    expect(hoofd(regels).waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
    expect(berekenPnLBoom("WERKELIJK", regels).exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("9. per kostensoort: alleen de gemapte kostensoort is bekend; de rest onbekend en de uitkomst ONVOLLEDIG", () => {
    const regels = leegstandWerkelijkNaarPnLBovenEbitdaRegels(werkelijk({ NUTS_LEEGSTAND: 30 }), true, new Set(["NUTS_LEEGSTAND"]));
    expect(hoofd(regels).waarde).toEqual({ status: "BEKEND", bedrag: D(30) });
    expect(regels.some((r) => r.regelSleutel === LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL_SLEUTEL)).toBe(true);
  });

  it("10. niet-geclassificeerde boekingen worden niet stil genegeerd: aparte ONBEKEND-regel, en nooit over kostensoorten verdeeld", () => {
    const w = werkelijk({ NUTS_LEEGSTAND: 30 }, 77);
    const regels = leegstandWerkelijkNaarPnLBovenEbitdaRegels(w, true, gemapt);
    expect(regels.find((r) => r.regelSleutel === LEEGSTANDSKOSTEN_NIET_GECLASSIFICEERD_SLEUTEL)!.waarde.status).toBe("ONBEKEND");
    expect(hoofd(regels).waarde).toEqual({ status: "BEKEND", bedrag: D(30) });
    expect(berekenPnLBoom("WERKELIJK", regels).exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("11. onbevestigde dekking: alles onbekend, ongeacht de berekende waarde", () => {
    const regels = leegstandWerkelijkNaarPnLBovenEbitdaRegels(werkelijk({ NUTS_LEEGSTAND: 30 }), false, gemapt);
    expect(hoofd(regels).waarde.status).toBe("ONBEKEND");
  });
});

describe("Estimated Leegstandskosten → P&L", () => {
  const begroting = begroot([regel("NUTS_LEEGSTAND", [100, 100, 100, 100])]);
  const gemapt = new Set<string>(LEEGSTAND_CATEGORIEEN);
  const dekking = { werkelijkDekkingBevestigd: true, nietGeclassificeerdTotaal: D(0), gemapteCategorieen: gemapt };
  const verwachting = (o: Partial<Record<BgLeegstandCategorie, number | null>>) =>
    Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c) => [c, o[c] === undefined || o[c] === null ? null : D(o[c]!)])) as Record<BgLeegstandCategorie, Decimal | null>;

  it("12. Estimated = Werkelijk + resterende verwachting per kostensoort, samen de ene post (Nuts 30+20, Servicekosten 20+0, Overige 5+5 = 80); bewust €0 telt als ingevuld", () => {
    const e = berekenEstimatedLeegstand(begroting, werkelijk({ NUTS_LEEGSTAND: 30, SERVICEKOSTEN_LEEGSTAND: 20, OVERIGE_LEEGSTANDSKOSTEN: 5 }), verwachting({ NUTS_LEEGSTAND: 20, SERVICEKOSTEN_LEEGSTAND: 0, OVERIGE_LEEGSTANDSKOSTEN: 5 }));
    const regels = leegstandEstimatedNaarPnLBovenEbitdaRegels(e, dekking);
    expect(hoofd(regels).waarde).toEqual({ status: "BEKEND", bedrag: D(80) });
    expect(regels).toHaveLength(1);
  });

  it("13. ontbrekende resterende verwachting blijft onbekend (geen Werkelijk + 0)", () => {
    const e = berekenEstimatedLeegstand(begroting, werkelijk({ NUTS_LEEGSTAND: 30 }), verwachting({ NUTS_LEEGSTAND: 20 }));
    const regels = leegstandEstimatedNaarPnLBovenEbitdaRegels(e, dekking);
    expect(hoofd(regels).waarde).toEqual({ status: "BEKEND", bedrag: D(50) });
    expect((regels.find((r) => r.regelSleutel === LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL_SLEUTEL)!.waarde as { toelichting: string }).toelichting).toContain("SERVICEKOSTEN_LEEGSTAND");
    expect(berekenPnLBoom("ESTIMATED", regels).exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("14. ontbrekende Werkelijk-dekking of ontbrekende mapping maakt Estimated onbekend, ook met een ingevulde verwachting — het BRONGAT wordt niet gemaskeerd", () => {
    const e = berekenEstimatedLeegstand(begroting, werkelijk(), verwachting({ NUTS_LEEGSTAND: 1, SERVICEKOSTEN_LEEGSTAND: 1, OVERIGE_LEEGSTANDSKOSTEN: 1 }));
    expect(hoofd(leegstandEstimatedNaarPnLBovenEbitdaRegels(e, { ...dekking, werkelijkDekkingBevestigd: false })).waarde.status).toBe("ONBEKEND");
    expect(hoofd(leegstandEstimatedNaarPnLBovenEbitdaRegels(e, { ...dekking, gemapteCategorieen: new Set() })).waarde.status).toBe("ONBEKEND");
    expect(hoofd(leegstandEstimatedNaarPnLBovenEbitdaRegels(e, { ...dekking, nietGeclassificeerdTotaal: D(5) })).waarde.status).toBe("ONBEKEND");
  });

  it("15. de Begroting wordt niet gemuteerd door Estimated", () => {
    const voor = begroting.moduleTotaal.toString();
    berekenEstimatedLeegstand(begroting, werkelijk({ NUTS_LEEGSTAND: 30 }), verwachting({ NUTS_LEEGSTAND: 999 }));
    expect(begroting.moduleTotaal.toString()).toBe(voor);
  });
});
