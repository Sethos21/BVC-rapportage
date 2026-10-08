import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBegroteRente, berekenEstimatedRente, berekenWerkelijkRente, type BgRenteRegelInvoer } from "./begroteRente.js";
import { renteBegrotingNaarPnLOnderEbitdaRegels, renteEstimatedNaarPnLOnderEbitdaRegels, renteWerkelijkNaarPnLOnderEbitdaRegels } from "./rentePnLAdapters.js";
import { berekenPnLBoom } from "../pnlEngine.js";

/** Rente -> P&L (Tranche 10): onder EBITDA, twee onafhankelijke posten (RENTEKOSTEN/RENTE_OPBRENGSTEN). */

const D = (n: string | number) => new Decimal(n);
const regel = (o: Partial<BgRenteRegelInvoer> = {}): BgRenteRegelInvoer => ({
  categorie: "RENTEKOSTEN",
  omschrijving: "Lening",
  complexnummer: null,
  ogbReferentie: null,
  laatstBekendSaldo: null,
  rentepercentage: null,
  begrotingsbedrag: D(1000),
  ...o,
});
const vind = (regels: ReturnType<typeof renteBegrotingNaarPnLOnderEbitdaRegels>, sleutel: string) => regels.find((r) => r.regelSleutel === sleutel)!;

describe("Begroting Rente -> P&L (onder EBITDA, twee onafhankelijke posten)", () => {
  it("beide categorieën BEKEND, boomPositie ONDER_EBITDA, correcte contributieAard, geen renteberekening (rekenhulp genegeerd)", () => {
    const b = berekenBegroteRente(
      [regel({ categorie: "RENTEKOSTEN", begrotingsbedrag: D(5000), laatstBekendSaldo: D(999999), rentepercentage: D(50) }), regel({ categorie: "RENTE_OPBRENGSTEN", begrotingsbedrag: D(300) })],
      { RENTEKOSTEN: { beoordeeld: true }, RENTE_OPBRENGSTEN: { beoordeeld: true } },
      { begrotingsjaar: 2027 },
    );
    const regels = renteBegrotingNaarPnLOnderEbitdaRegels(b);
    expect(regels).toHaveLength(2);
    const kosten = vind(regels, "RENTEKOSTEN");
    expect(kosten).toMatchObject({ boomPositie: "ONDER_EBITDA", contributieAard: "KOSTEN", waarde: { status: "BEKEND", bedrag: D(5000) } }); // NIET 999999*0.5
    expect(vind(regels, "RENTE_OPBRENGSTEN")).toMatchObject({ contributieAard: "OPBRENGST", waarde: { status: "BEKEND", bedrag: D(300) } });
  });

  it("bewust €0 (beoordeeld, 0 regels) is BEKEND €0; niet beoordeeld is ONBEKEND", () => {
    const beoordeeld = berekenBegroteRente([], { RENTEKOSTEN: { beoordeeld: true }, RENTE_OPBRENGSTEN: { beoordeeld: true } }, { begrotingsjaar: 2027 });
    const regels = renteBegrotingNaarPnLOnderEbitdaRegels(beoordeeld);
    expect(vind(regels, "RENTEKOSTEN").waarde).toEqual({ status: "BEKEND", bedrag: D(0) });

    const nietBeoordeeld = berekenBegroteRente([], { RENTEKOSTEN: { beoordeeld: false }, RENTE_OPBRENGSTEN: { beoordeeld: true } }, { begrotingsjaar: 2027 });
    const regels2 = renteBegrotingNaarPnLOnderEbitdaRegels(nietBeoordeeld);
    expect(vind(regels2, "RENTEKOSTEN").waarde.status).toBe("ONBEKEND");
    expect(vind(regels2, "RENTE_OPBRENGSTEN").waarde.status).toBe("BEKEND"); // categorieën onafhankelijk
  });

  it("geen gecombineerd rentesaldo: elke categorie blijft haar eigen, losse P&L-regel", () => {
    const b = berekenBegroteRente(
      [regel({ categorie: "RENTEKOSTEN", begrotingsbedrag: D(5000) }), regel({ categorie: "RENTE_OPBRENGSTEN", begrotingsbedrag: D(300) })],
      { RENTEKOSTEN: { beoordeeld: true }, RENTE_OPBRENGSTEN: { beoordeeld: true } },
      { begrotingsjaar: 2027 },
    );
    const boom = berekenPnLBoom("BEGROTING_NIEUW_JAAR", renteBegrotingNaarPnLOnderEbitdaRegels(b));
    expect(boom.onderEbitda).toHaveLength(2);
    expect(boom.ebitda.bedrag.toString()).toBe("0"); // onder-EBITDA regels raken EBITDA nooit
  });
});

describe("Werkelijk Rente -> P&L: bewezen bronproef 023 (Rentekosten €1.148.524,51) / 013 (Rente opbrengsten -€1.250,09 -> €1.250,09)", () => {
  const RENTE_023 = berekenWerkelijkRente(
    [
      { ogbKostensoort: "4601", saldo: D("290448.42") },
      { ogbKostensoort: "4602", saldo: D("42.90") },
      { ogbKostensoort: "4603", saldo: D("461538.10") },
      { ogbKostensoort: "4604", saldo: D("356746.02") },
      { ogbKostensoort: "4606", saldo: D("39749.07") },
      { ogbKostensoort: "4620", saldo: D("0") },
    ],
    [
      { ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", categorie: "RENTEKOSTEN" },
      { ogbKostensoort: "4602", ogbKostensoortOmschrijving: "Rente en Provisie ING R/C", categorie: "RENTEKOSTEN" },
      { ogbKostensoort: "4603", ogbKostensoortOmschrijving: "Rente lening .586", categorie: "RENTEKOSTEN" },
      { ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente lening .500", categorie: "RENTEKOSTEN" },
      { ogbKostensoort: "4606", ogbKostensoortOmschrijving: "rente lening 747", categorie: "RENTEKOSTEN" },
      { ogbKostensoort: "4620", ogbKostensoortOmschrijving: "Overige rentes", categorie: "RENTEKOSTEN" },
    ],
  );
  const RENTE_013 = berekenWerkelijkRente(
    [{ ogbKostensoort: "4604", saldo: D("-1250.09") }],
    [
      { ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente r/c", categorie: "RENTE_OPBRENGSTEN" },
      { ogbKostensoort: "4621", ogbKostensoortOmschrijving: "Rente opbrengst telerek", categorie: "RENTE_OPBRENGSTEN" },
    ],
  );

  it("bevestigde dekking: Rentekosten en Rente opbrengsten BEKEND, correct genormaliseerd, EBITDA ongewijzigd", () => {
    const kostenRegels = renteWerkelijkNaarPnLOnderEbitdaRegels(RENTE_023, true);
    const opbrengstRegels = renteWerkelijkNaarPnLOnderEbitdaRegels(RENTE_013, true);
    expect(vind(kostenRegels, "RENTEKOSTEN").waarde).toEqual({ status: "BEKEND", bedrag: D("1148524.51") });
    expect(vind(opbrengstRegels, "RENTE_OPBRENGSTEN").waarde).toEqual({ status: "BEKEND", bedrag: D("1250.09") }); // genormaliseerd, niet -1250.09

    const boom = berekenPnLBoom("WERKELIJK", [...kostenRegels, ...opbrengstRegels]);
    expect(boom.ebitda.bedrag.toString()).toBe("0");
    expect(boom.totaalKosten.besteWetenSom.toString()).toBe("0");
    expect(boom.totaalOpbrengsten.besteWetenSom.toString()).toBe("0");
  });

  it("dekking niet bevestigd: beide categorieën ONBEKEND, ongeacht het berekende bedrag", () => {
    const regels = renteWerkelijkNaarPnLOnderEbitdaRegels(RENTE_023, false);
    expect(vind(regels, "RENTEKOSTEN").waarde.status).toBe("ONBEKEND");
  });

  it("niet-geclassificeerde boekingen maken BEIDE categorieën onbekend (module-breed, geen categorie-eigen residual)", () => {
    const metGat = berekenWerkelijkRente(
      [
        { ogbKostensoort: "4601", saldo: D("290448.42") },
        { ogbKostensoort: "9999", saldo: D("100") },
      ],
      [{ ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", categorie: "RENTEKOSTEN" }],
    );
    const regels = renteWerkelijkNaarPnLOnderEbitdaRegels(metGat, true);
    expect(vind(regels, "RENTEKOSTEN").waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
    expect(vind(regels, "RENTE_OPBRENGSTEN").waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
  });

  it("Actual exact één keer: twee aanroepen met dezelfde boekingen geven identiek resultaat", () => {
    const r1 = renteWerkelijkNaarPnLOnderEbitdaRegels(RENTE_023, true);
    const r2 = renteWerkelijkNaarPnLOnderEbitdaRegels(RENTE_023, true);
    expect(r1).toEqual(r2);
  });
});

describe("Estimated Rente -> P&L: Werkelijk + handmatige resterende verwachting", () => {
  const begroting = berekenBegroteRente([], { RENTEKOSTEN: { beoordeeld: true }, RENTE_OPBRENGSTEN: { beoordeeld: true } }, { begrotingsjaar: 2027 });
  const werkelijkKosten = (bedrag: number | string, nietGeclassificeerd: number | string = 0) =>
    berekenWerkelijkRente(
      [{ ogbKostensoort: "4601", saldo: D(bedrag) }, ...(D(nietGeclassificeerd).isZero() ? [] : [{ ogbKostensoort: "9999", saldo: D(nietGeclassificeerd) }])],
      [{ ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening", categorie: "RENTEKOSTEN" }],
    );

  it("A. Actual + verwachting bekend -> BEKEND (4000 + 2500 = 6500)", () => {
    const w = werkelijkKosten(4000);
    const e = berekenEstimatedRente(begroting, w, { RENTEKOSTEN: D(2500), RENTE_OPBRENGSTEN: null });
    const regels = renteEstimatedNaarPnLOnderEbitdaRegels(e, w, true);
    expect(vind(regels, "RENTEKOSTEN").waarde).toEqual({ status: "BEKEND", bedrag: D(6500) });
  });

  it("B. verwachting expliciet €0 -> Estimated = Actual (4000)", () => {
    const w = werkelijkKosten(4000);
    const e = berekenEstimatedRente(begroting, w, { RENTEKOSTEN: D(0), RENTE_OPBRENGSTEN: null });
    expect(vind(renteEstimatedNaarPnLOnderEbitdaRegels(e, w, true), "RENTEKOSTEN").waarde).toEqual({ status: "BEKEND", bedrag: D(4000) });
  });

  it("C. verwachting null -> ONBEKEND, nooit €0", () => {
    const w = werkelijkKosten(4000);
    const e = berekenEstimatedRente(begroting, w, { RENTEKOSTEN: null, RENTE_OPBRENGSTEN: null });
    expect(vind(renteEstimatedNaarPnLOnderEbitdaRegels(e, w, true), "RENTEKOSTEN").waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING" });
  });

  it("D. Werkelijk-dekking niet bevestigd + verwachting bekend -> geen verzonnen totaal (ONBEKEND)", () => {
    const w = werkelijkKosten(4000);
    const e = berekenEstimatedRente(begroting, w, { RENTEKOSTEN: D(2500), RENTE_OPBRENGSTEN: null });
    expect(vind(renteEstimatedNaarPnLOnderEbitdaRegels(e, w, false), "RENTEKOSTEN").waarde.status).toBe("ONBEKEND");
  });

  it("E. Werkelijk-dekking niet bevestigd + verwachting null -> nog steeds ONBEKEND", () => {
    const w = werkelijkKosten(4000);
    const e = berekenEstimatedRente(begroting, w, { RENTEKOSTEN: null, RENTE_OPBRENGSTEN: null });
    expect(vind(renteEstimatedNaarPnLOnderEbitdaRegels(e, w, false), "RENTEKOSTEN").waarde.status).toBe("ONBEKEND");
  });

  it("niet-geclassificeerde Werkelijk-boekingen maken Estimated onbekend, ook met een bevestigde dekking en ingevulde verwachting", () => {
    const w = werkelijkKosten(4000, 50);
    const e = berekenEstimatedRente(begroting, w, { RENTEKOSTEN: D(2500), RENTE_OPBRENGSTEN: null });
    expect(vind(renteEstimatedNaarPnLOnderEbitdaRegels(e, w, true), "RENTEKOSTEN").waarde.status).toBe("ONBEKEND");
  });

  it("RENTE_OPBRENGSTEN: ruwe (negatieve) verwachting -> na normalisatie een hogere verwachte opbrengst", () => {
    const werkelijkOpbrengst = berekenWerkelijkRente([{ ogbKostensoort: "4604", saldo: D("-1250.09") }], [{ ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente r/c", categorie: "RENTE_OPBRENGSTEN" }]);
    // een verwachte AANVULLENDE opbrengst van 500 wordt, in dezelfde ruwe conventie als werkelijkTotaal, als -500 aangeleverd.
    const e = berekenEstimatedRente(begroting, werkelijkOpbrengst, { RENTEKOSTEN: null, RENTE_OPBRENGSTEN: D(-500) });
    const regel = vind(renteEstimatedNaarPnLOnderEbitdaRegels(e, werkelijkOpbrengst, true), "RENTE_OPBRENGSTEN");
    expect(regel.waarde).toEqual({ status: "BEKEND", bedrag: D("1750.09") }); // meer dan de kale 1250.09
  });
});
