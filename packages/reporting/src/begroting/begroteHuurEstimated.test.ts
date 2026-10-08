import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBegroteHuuropbrengsten, type BgContractFeiten, type BgRentrollComponent } from "./begroteHuuropbrengsten.js";
import { berekenEstimatedHuur } from "./begroteHuurEstimated.js";
import { huurEstimatedNaarPnLBovenEbitdaRegels } from "./huurEstimatedPnLAdapter.js";
import { berekenWerkelijkHuur, type WerkelijkHuurBoekingRegel } from "./werkelijkHuur.js";
import { berekenPnLBoom } from "../pnlEngine.js";

/**
 * Estimated Huur (Vervolgtranche 7). Contractbedragen zijn expliciet gemarkeerde testfixtures. Afgesloten t/m
 * juni (resterend: 7..12). C1 belast 10.000/mnd, korting 1.000/mnd, indexatie 3% per augustus; C2 onbelast 5.000/mnd,
 * eindigt 15 september; C3 belast 3.000/mnd, start 16 november.
 */

const D = (n: string | number) => new Decimal(n);
const vs01 = (jaar: number, btw: string | null = "Y"): BgRentrollComponent => ({ vorderingsoort: "01", bedragJaar: D(jaar), btwYn: btw });
const vs13 = (jaar: number, btw: string | null = "Y"): BgRentrollComponent => ({ vorderingsoort: "13", bedragJaar: D(jaar), btwYn: btw });
const datum = (s: string) => new Date(`${s}T00:00:00.000Z`);

function contract(o: Partial<BgContractFeiten>): BgContractFeiten {
  return {
    bedrijfsnr: "003",
    contractnummer: "C1",
    huurdernummer: null,
    huurderNaam: null,
    complexnummer: "001",
    rentrollComponenten: [vs01(120000)],
    ingangsdatum: datum("2020-01-01"),
    einddatum: null,
    indexatiedatum: null,
    indexatieHerhalingMaanden: 12,
    toekomstigeKortingswijzigingen: [],
    ...o,
  };
}

const C1 = contract({ contractnummer: "C1", rentrollComponenten: [vs01(120000), vs13(-12000)], indexatiedatum: datum("2027-08-01") });
const C2 = contract({ contractnummer: "C2", rentrollComponenten: [vs01(60000, "N")], einddatum: datum("2027-09-15") });
const C3 = contract({ contractnummer: "C3", rentrollComponenten: [vs01(36000)], ingangsdatum: datum("2027-11-16") });
const BRON = datum("2026-07-31");
const begrotingVan = (contracten: BgContractFeiten[]) => berekenBegroteHuuropbrengsten(contracten, [], { begrotingsjaar: 2027, indexatiePercentage: D(3) }, BRON);

/** Werkelijk t/m juni, ruwe bronrichting: belast/onbelast negatief (credit-normaal), korting positief. */
const werkelijk = (belast = -60000, onbelast = -30000, korting = 6000, nietGeclassificeerd = 0) => {
  const boeking = (economischeCategorie: WerkelijkHuurBoekingRegel["economischeCategorie"], saldo: number): WerkelijkHuurBoekingRegel => ({ economischeCategorie, saldo: D(saldo) });
  const regels = [boeking("HUUROPBRENGST_BELAST", belast), boeking("HUUROPBRENGST_ONBELAST", onbelast), boeking("VERLEENDE_HUURKORTING", korting)];
  if (nietGeclassificeerd !== 0) regels.push(boeking(null, nietGeclassificeerd));
  return berekenWerkelijkHuur(regels);
};
const RESTEREND = [7, 8, 9, 10, 11, 12];
const cat = (r: ReturnType<typeof berekenEstimatedHuur>, c: string) => r.perCategorie.find((x) => x.categorie === c)!;

describe("berekenEstimatedHuur — Estimated = Werkelijk t/m afgesloten periode + resterende contractverwachting", () => {
  const r = berekenEstimatedHuur(begrotingVan([C1, C2, C3]), werkelijk(), true, RESTEREND);

  it("1. per P&L-regel: Werkelijk (P&L-richting) + resterende bruto/korting; belast en onbelast blijven gescheiden", () => {
    expect(cat(r, "HUUROPBRENGST_BELAST")).toMatchObject({ werkelijkTotaal: D(60000) });
    expect(cat(r, "HUUROPBRENGST_BELAST").resterendeVerwachting!.toString()).toBe("66000"); // C1: 10.000 + 5 × 10.300; C3: 1.500 + 3.000
    expect(cat(r, "HUUROPBRENGST_BELAST").estimatedTotaal!.toString()).toBe("126000");
    expect(cat(r, "HUUROPBRENGST_ONBELAST").resterendeVerwachting!.toString()).toBe("12500"); // C2: 5.000 + 5.000 + 2.500 (15 sept), daarna geen huur
    expect(cat(r, "HUUROPBRENGST_ONBELAST").estimatedTotaal!.toString()).toBe("42500");
    expect(cat(r, "VERLEENDE_HUURKORTING").estimatedTotaal!.toString()).toBe("-12000"); // −6.000 werkelijk − 6 × 1.000
  });

  it("2. Werkelijk exact éénmaal: moduleEstimatedNetto = moduleWerkelijkNetto + resterend netto van de contracten (niet dubbel)", () => {
    expect(r.moduleWerkelijkNetto.toString()).toBe("84000");
    const resterendNetto = r.perContract.reduce((s, c) => s.plus(c.resterendNetto), D(0));
    expect(resterendNetto.toString()).toBe("72500"); // 66.000 + 12.500 − 6.000
    expect(r.moduleEstimatedNetto!.toString()).toBe("156500");
    expect(r.moduleEstimatedNetto!.minus(r.moduleWerkelijkNetto).toString()).toBe(resterendNetto.toString());
  });

  it("3. huurkorting wordt niet dubbel verwerkt: de korting staat als één aftrekregel; belast + onbelast zijn bruto; in de P&L-boom is het totaal het netto", () => {
    const boom = berekenPnLBoom("ESTIMATED", huurEstimatedNaarPnLBovenEbitdaRegels(r));
    expect(boom.totaalOpbrengsten.besteWetenSom.toString()).toBe("156500");
    expect(boom.totaalOpbrengsten.volledigheid).toEqual({ status: "VOLLEDIG" });
    expect(boom.totaalOpbrengsten.regels.map((x) => x.regelSleutel)).toEqual(["HUUROPBRENGST_BELAST", "HUUROPBRENGST_ONBELAST", "VERLEENDE_HUURKORTING"]);
  });

  it("4. contractuele indexatie geldt vanaf de juiste maand: juli nog niet, augustus wel (+3%)", () => {
    const belast = (maanden: number[]) => berekenEstimatedHuur(begrotingVan([C1]), werkelijk(), true, maanden).perContract[0]!.resterendBruto.toString();
    expect(belast([7])).toBe("10000");
    expect(belast([8])).toBe("10300");
    expect(belast([12])).toBe("10300");
  });

  it("5. eindigend contract stopt op het juiste moment: september pro rata (15/30), daarna niets", () => {
    const onbelast = (maanden: number[]) => berekenEstimatedHuur(begrotingVan([C2]), werkelijk(), true, maanden).perContract[0]!.resterendBruto.toString();
    expect(onbelast([8])).toBe("5000");
    expect(onbelast([9])).toBe("2500");
    expect(onbelast([10, 11, 12])).toBe("0");
  });

  it("6. nieuw contract begint op het juiste moment: niets vóór november, november pro rata (15/30), december volledig", () => {
    const belast = (maanden: number[]) => berekenEstimatedHuur(begrotingVan([C3]), werkelijk(), true, maanden).perContract[0]!.resterendBruto.toString();
    expect(belast([7, 8, 9, 10])).toBe("0");
    expect(belast([11])).toBe("1500");
    expect(belast([12])).toBe("3000");
  });

  it("7. onbekend is nooit €0: onbevestigde Werkelijk-dekking of niet-geclassificeerde boekingen geven Estimated null (per regel en totaal)", () => {
    const onbevestigd = berekenEstimatedHuur(begrotingVan([C1]), werkelijk(), false, RESTEREND);
    expect(onbevestigd.perCategorie.every((c) => c.estimatedTotaal === null)).toBe(true);
    expect(onbevestigd.moduleEstimatedNetto).toBeNull();
    const nietGemapt = berekenEstimatedHuur(begrotingVan([C1]), werkelijk(-60000, -30000, 6000, -123), true, RESTEREND);
    expect(nietGemapt.perCategorie.every((c) => c.estimatedTotaal === null)).toBe(true);
    const regels = huurEstimatedNaarPnLBovenEbitdaRegels(onbevestigd);
    expect(regels.every((x) => x.waarde.status === "ONBEKEND")).toBe(true);
    expect(berekenPnLBoom("ESTIMATED", regels).totaalOpbrengsten.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("8. bewust €0 is onderscheidbaar van onbekend: een volledig afgesloten jaar (geen resterende maanden) geeft Estimated = Werkelijk als bekende waarde", () => {
    const klaar = berekenEstimatedHuur(begrotingVan([C1, C2, C3]), werkelijk(), true, []);
    expect(klaar.perCategorie.map((c) => c.estimatedTotaal!.toString())).toEqual(["60000", "30000", "-6000"]);
    expect(klaar.perCategorie.every((c) => c.resterendeVerwachting!.isZero())).toBe(true);
    expect(klaar.moduleEstimatedNetto!.toString()).toBe("84000");
  });

  it("9. een kritieke controle in de Begroting-basis (bv. negatieve VS=01) maakt Estimated onbekend, niet stil lager", () => {
    const kapot = contract({ contractnummer: "C9", rentrollComponenten: [vs01(-1000)] });
    const res = berekenEstimatedHuur(begrotingVan([C1, kapot]), werkelijk(), true, RESTEREND);
    expect(res.begrotingBetrouwbaar).toBe(false);
    expect(res.perCategorie.every((c) => c.estimatedTotaal === null && c.resterendeVerwachting === null)).toBe(true);
    expect(huurEstimatedNaarPnLBovenEbitdaRegels(res).every((x) => x.waarde.status === "ONBEKEND")).toBe(true);
  });

  it("10. onbekende belast/onbelast-status wordt niet toegewezen: buiten de drie regels, apart als ONBEKEND-regel gemeld", () => {
    const onbekend = contract({ contractnummer: "C7", rentrollComponenten: [vs01(60000, null)] });
    const res = berekenEstimatedHuur(begrotingVan([C1, onbekend]), werkelijk(), true, RESTEREND);
    expect(res.resterendNettoOnbekendeBtw.toString()).toBe("30000");
    expect(cat(res, "HUUROPBRENGST_BELAST").resterendeVerwachting!.toString()).toBe("61500"); // alleen C1
    const regels = huurEstimatedNaarPnLBovenEbitdaRegels(res);
    const extra = regels.find((x) => x.regelSleutel === "HUUR_NIET_GECLASSIFICEERD")!;
    expect(extra.waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
    expect(berekenPnLBoom("ESTIMATED", regels).totaalOpbrengsten.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("11. de Begroting wordt niet gemuteerd en blijft ongewijzigd doorgegeven", () => {
    const begroting = begrotingVan([C1, C2, C3]);
    const voor = JSON.stringify(begroting.portefeuilleTotalen);
    const res = berekenEstimatedHuur(begroting, werkelijk(), true, RESTEREND);
    expect(JSON.stringify(begroting.portefeuilleTotalen)).toBe(voor);
    expect(res.moduleBegrotingNetto.toString()).toBe(begroting.portefeuilleTotalen.nettoHuur.toString());
  });

  it("12. ongeldige of dubbele resterende maanden falen hard; volgorde en dubbelen worden niet stil gecorrigeerd", () => {
    const b = begrotingVan([C1]);
    expect(() => berekenEstimatedHuur(b, werkelijk(), true, [0])).toThrow(/Ongeldige/);
    expect(() => berekenEstimatedHuur(b, werkelijk(), true, [13])).toThrow(/Ongeldige/);
    expect(() => berekenEstimatedHuur(b, werkelijk(), true, [7, 7])).toThrow(/meerdere keren/);
    expect(berekenEstimatedHuur(b, werkelijk(), true, [9, 7, 8]).resterendeMaanden).toEqual([7, 8, 9]);
  });

  it("13. traceerbaarheid: de contractstand (bronPeildatum) en de beperking dat latere mutaties onbekend zijn worden gemeld", () => {
    expect(r.bronPeildatum.toISOString().slice(0, 10)).toBe("2026-07-31");
    expect(r.controleVereist.some((c) => c.ernst === "INFORMATIEF" && c.bericht.includes("2026-07-31"))).toBe(true);
  });

  it("14. administratie-onafhankelijk: identiek resultaat voor een andere administratie (geen 070-hardcoding)", () => {
    const anders = [C1, C2, C3].map((c) => ({ ...c, bedrijfsnr: "070" }));
    const a = berekenEstimatedHuur(begrotingVan(anders), werkelijk(), true, RESTEREND);
    expect(a.moduleEstimatedNetto!.toString()).toBe(r.moduleEstimatedNetto!.toString());
  });
});
