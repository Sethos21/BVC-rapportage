import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBegroteBeheersvergoeding, type BgBeheerComplexConfig } from "./begroteBeheersvergoeding.js";
import { berekenBegroteHuuropbrengsten, type BgContractFeiten, type BgRentrollComponent } from "./begroteHuuropbrengsten.js";
import { beheerEstimatedNaarPnLBovenEbitdaRegels, berekenEstimatedBeheer } from "./begroteBeheerEstimated.js";
import { berekenEstimatedHuur } from "./begroteHuurEstimated.js";
import { berekenWerkelijkBeheer } from "./werkelijkBeheer.js";
import { berekenWerkelijkHuur } from "./werkelijkHuur.js";
import { berekenPnLBoom } from "../pnlEngine.js";

/** Estimated Beheersvergoeding (Vervolgtranche 7). Afgesloten t/m juni; resterend 7..12. Bedragen zijn testfixtures. */

const D = (n: string | number) => new Decimal(n);
const vs01 = (jaar: number): BgRentrollComponent => ({ vorderingsoort: "01", bedragJaar: D(jaar), btwYn: "Y" });
const vs13 = (jaar: number): BgRentrollComponent => ({ vorderingsoort: "13", bedragJaar: D(jaar), btwYn: "Y" });
const datum = (s: string) => new Date(`${s}T00:00:00.000Z`);
const contract = (o: Partial<BgContractFeiten>): BgContractFeiten => ({
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
});
const C1 = contract({ contractnummer: "C1", rentrollComponenten: [vs01(120000), vs13(-12000)], indexatiedatum: datum("2027-08-01") });
const C4 = contract({ contractnummer: "C4", complexnummer: "002", rentrollComponenten: [vs01(60000)] }); // complex zonder beheerconfiguratie
const huur = (contracten: BgContractFeiten[]) => berekenBegroteHuuropbrengsten(contracten, [], { begrotingsjaar: 2027, indexatiePercentage: D(3) }, datum("2026-07-31"));
const config = (o: Partial<BgBeheerComplexConfig> = {}): BgBeheerComplexConfig => ({
  complexnummer: "001",
  vastBedragJaar: D(12000),
  vastIndexatiePercentage: D(5),
  vastIndexatiedatum: datum("2027-08-01"),
  variabelPercentage: D(6),
  ...o,
});
const werkelijk = (saldo = 5000, nietGeclassificeerd = 0) =>
  berekenWerkelijkBeheer([{ economischeCategorie: "BEHEERKOSTEN", saldo: D(saldo) }, ...(nietGeclassificeerd !== 0 ? [{ economischeCategorie: null, saldo: D(nietGeclassificeerd) }] : [])]);
const RESTEREND = [7, 8, 9, 10, 11, 12];

function opbouw(contracten = [C1], configs = [config()]) {
  const h = huur(contracten);
  return { h, b: berekenBegroteBeheersvergoeding(h, configs) };
}

describe("berekenEstimatedBeheer — Werkelijk + resterende vast en variabel", () => {
  const { h, b } = opbouw();
  const r = berekenEstimatedBeheer(h, b, werkelijk(), true, RESTEREND);

  it("1. formule: Werkelijk (5.000, exact éénmaal) + resterend vast (1.000 + 5 × 1.050) + resterend variabel (6% × 55.500) = 14.580", () => {
    expect(r.werkelijkTotaal.toString()).toBe("5000");
    expect(r.resterendVast.toString()).toBe("6250");
    expect(r.resterendVariabel.toString()).toBe("3330");
    expect(r.resterendeVerwachting!.toString()).toBe("9580");
    expect(r.estimatedTotaal!.toString()).toBe("14580");
    expect(r.estimatedTotaal!.minus(r.werkelijkTotaal).toString()).toBe(r.resterendeVerwachting!.toString());
  });

  it("2. vast: bestaande indexeringsregels — juli nog niet geïndexeerd, augustus wel (+5%), niets geprojecteerd", () => {
    const maand = (m: number) => berekenEstimatedBeheer(h, b, werkelijk(), true, [m]).resterendVast.toString();
    expect(maand(7)).toBe("1000");
    expect(maand(8)).toBe("1050");
    const zonderDatum = opbouw([C1], [config({ vastIndexatiedatum: null })]);
    expect(berekenEstimatedBeheer(zonderDatum.h, zonderDatum.b, werkelijk(), true, [8]).resterendVast.toString()).toBe("1000");
  });

  it("3. variabel gebruikt de juiste netto huurgrondslag: percentage × de resterende NETTO huur van hetzelfde complex, gelijk aan Estimated Huur van dat contract", () => {
    const estHuur = berekenEstimatedHuur(h, berekenWerkelijkHuur([]), true, RESTEREND);
    const nettoC1 = estHuur.perContract.find((c) => c.contractnummer === "C1")!.resterendNetto;
    expect(r.perComplex[0]!.resterendeNettoHuurGrondslag.toString()).toBe(nettoC1.toString());
    expect(r.perComplex[0]!.resterendeNettoHuurGrondslag.toString()).toBe("55500");
    expect(r.perComplex[0]!.resterendVariabel.toString()).toBe(nettoC1.times(6).dividedBy(100).toString());
  });

  it("4. het percentage wordt niet opnieuw ingevoerd of geraden: zonder variabel percentage in de configuratie is er geen variabele vergoeding; alleen vast / alleen variabel blijven geldig", () => {
    const alleenVast = opbouw([C1], [config({ variabelPercentage: null })]);
    const rv = berekenEstimatedBeheer(alleenVast.h, alleenVast.b, werkelijk(), true, RESTEREND);
    expect(rv.resterendVariabel.toString()).toBe("0");
    expect(rv.resterendVast.toString()).toBe("6250");
    const alleenVariabel = opbouw([C1], [config({ vastBedragJaar: null })]);
    const rvar = berekenEstimatedBeheer(alleenVariabel.h, alleenVariabel.b, werkelijk(), true, RESTEREND);
    expect(rvar.resterendVast.toString()).toBe("0");
    expect(rvar.resterendVariabel.toString()).toBe("3330");
  });

  it("5. een complex met huur maar zonder beheerconfiguratie krijgt geen vergoeding (niet ingesteld ≠ 0%) en een waarschuwing; geen gemiddeld tarief", () => {
    const o = opbouw([C1, C4], [config()]);
    const res = berekenEstimatedBeheer(o.h, o.b, werkelijk(), true, RESTEREND);
    expect(res.estimatedTotaal!.toString()).toBe("14580"); // ongewijzigd: complex 002 draagt niets bij
    expect(res.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("002"))).toBe(true);
  });

  it("6. onbekend is nooit €0: onbevestigde Werkelijk-dekking, niet-geclassificeerde boekingen, kritieke configuratie of kritieke huur-basis geven null", () => {
    expect(berekenEstimatedBeheer(h, b, werkelijk(), false, RESTEREND).estimatedTotaal).toBeNull();
    expect(berekenEstimatedBeheer(h, b, werkelijk(5000, -40), true, RESTEREND).estimatedTotaal).toBeNull();
    const kritiekeConfig = opbouw([C1], [config({ vastBedragJaar: D(-1) })]);
    const k = berekenEstimatedBeheer(kritiekeConfig.h, kritiekeConfig.b, werkelijk(), true, RESTEREND);
    expect(k.estimatedTotaal).toBeNull();
    expect(k.resterendeVerwachting).toBeNull();
    const kapotteHuur = opbouw([C1, contract({ contractnummer: "C9", rentrollComponenten: [vs01(-5)] })]);
    expect(berekenEstimatedBeheer(kapotteHuur.h, kapotteHuur.b, werkelijk(), true, RESTEREND).estimatedTotaal).toBeNull();
  });

  it("7. bewust €0 is onderscheidbaar van onbekend: geen resterende maanden geeft Estimated = Werkelijk als bekende waarde", () => {
    const klaar = berekenEstimatedBeheer(h, b, werkelijk(), true, []);
    expect(klaar.estimatedTotaal!.toString()).toBe("5000");
    expect(klaar.resterendeVerwachting!.isZero()).toBe(true);
  });

  it("8. P&L: één regel BEHEERKOSTEN (Management en beheer, kosten); onbekend blijft ONBEKEND; subtotaal afgeleid door de engine", () => {
    const bekend = beheerEstimatedNaarPnLBovenEbitdaRegels(r);
    expect(bekend).toHaveLength(1);
    expect(bekend[0]).toMatchObject({ regelSleutel: "BEHEERKOSTEN", groep: "MANAGEMENT_EN_BEHEER", contributieAard: "KOSTEN", waarde: { status: "BEKEND", bedrag: D(14580) } });
    expect(berekenPnLBoom("ESTIMATED", bekend).managementEnBeheer.besteWetenSom.toString()).toBe("14580");
    const onbekend = beheerEstimatedNaarPnLBovenEbitdaRegels(berekenEstimatedBeheer(h, b, werkelijk(), false, RESTEREND));
    expect(onbekend[0]!.waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
    expect(berekenPnLBoom("ESTIMATED", onbekend).managementEnBeheer.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("9. de Begroting wordt niet gemuteerd en blijft ongewijzigd doorgegeven; ongeldige maanden falen hard", () => {
    const voor = JSON.stringify(b.portefeuilleTotalen);
    berekenEstimatedBeheer(h, b, werkelijk(), true, RESTEREND);
    expect(JSON.stringify(b.portefeuilleTotalen)).toBe(voor);
    expect(r.begrotingTotaal.toString()).toBe(b.portefeuilleTotalen.totaleVergoeding.toString());
    expect(() => berekenEstimatedBeheer(h, b, werkelijk(), true, [7, 7])).toThrow(/meerdere keren/);
  });
});
