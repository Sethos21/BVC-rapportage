import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBegroteNietVerrekenbareBtw, berekenEstimatedNietVerrekenbareBtw } from "./begroteNietVerrekenbareBtw.js";
import { berekenWerkelijkNietVerrekenbareBtw, type WerkelijkNietVerrekenbareBtwBoekingRegel } from "./werkelijkNietVerrekenbareBtw.js";
import {
  NIET_VERREKENBARE_BTW_PNL_SLEUTEL,
  nietVerrekenbareBtwBegrotingNaarPnLBovenEbitdaRegels,
  nietVerrekenbareBtwEstimatedNaarPnLBovenEbitdaRegels,
  nietVerrekenbareBtwWerkelijkNaarPnLBovenEbitdaRegels,
} from "./nietVerrekenbareBtwPnLAdapters.js";
import { berekenPnLBoom } from "../pnlEngine.js";

const D = (n: string | number) => new Decimal(n);

describe("Begroting Niet verrekenbare BTW -> P&L (14/15/16)", () => {
  it("14/15. één P&L-regel boven EBITDA, groep EXPLOITATIE_LASTEN", () => {
    const b = berekenBegroteNietVerrekenbareBtw([{ omschrijving: "BTW", complexnummer: null, jaarbedrag: D(3000) }], { begrotingsjaar: 2027, beoordeeld: true, vorigJaarWerkelijk: null });
    const regels = nietVerrekenbareBtwBegrotingNaarPnLBovenEbitdaRegels(b);
    expect(regels).toEqual([{ regelSleutel: NIET_VERREKENBARE_BTW_PNL_SLEUTEL, boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: { status: "BEKEND", bedrag: D(3000) } }]);
    const boom = berekenPnLBoom("BEGROTING_NIEUW_JAAR", regels);
    expect(boom.exploitatieLasten.besteWetenSom.toString()).toBe("3000");
  });

  it("9. bewust €0 is BEKEND", () => {
    const b = berekenBegroteNietVerrekenbareBtw([], { begrotingsjaar: 2027, beoordeeld: true, vorigJaarWerkelijk: null });
    expect(nietVerrekenbareBtwBegrotingNaarPnLBovenEbitdaRegels(b)[0]!.waarde).toEqual({ status: "BEKEND", bedrag: D(0) });
  });

  it("niet beoordeeld -> ONBEKEND, 16. propageert naar ONVOLLEDIG", () => {
    const b = berekenBegroteNietVerrekenbareBtw([], { begrotingsjaar: 2027, beoordeeld: false, vorigJaarWerkelijk: null });
    const regels = nietVerrekenbareBtwBegrotingNaarPnLBovenEbitdaRegels(b);
    expect(regels[0]!.waarde.status).toBe("ONBEKEND");
    expect(berekenPnLBoom("BEGROTING_NIEUW_JAAR", regels).exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
  });
});

describe("Werkelijk Niet verrekenbare BTW -> P&L (11/12/16/19)", () => {
  it("11. bevestigde dekking: BEKEND, exact één regel voor de categorie", () => {
    const boekingen: WerkelijkNietVerrekenbareBtwBoekingRegel[] = [{ economischeCategorie: "NIET_VERREKENBARE_BTW", saldo: D(1200) }];
    const w = berekenWerkelijkNietVerrekenbareBtw(boekingen);
    const regels = nietVerrekenbareBtwWerkelijkNaarPnLBovenEbitdaRegels(w, true);
    expect(regels).toHaveLength(1);
    expect(regels[0]!.waarde).toEqual({ status: "BEKEND", bedrag: D(1200) });
  });

  it("12. ontbrekende mapping (dekking niet bevestigd) is ONBEKEND, nooit €0", () => {
    const w = berekenWerkelijkNietVerrekenbareBtw([]);
    expect(nietVerrekenbareBtwWerkelijkNaarPnLBovenEbitdaRegels(w, false)[0]!.waarde.status).toBe("ONBEKEND");
  });

  it("niet-geclassificeerde boekingen komen als aparte ONBEKEND-regel, nooit meegeteld in de hoofdregel", () => {
    const w = berekenWerkelijkNietVerrekenbareBtw([
      { economischeCategorie: "NIET_VERREKENBARE_BTW", saldo: D(500) },
      { economischeCategorie: null, saldo: D(77) },
    ]);
    const regels = nietVerrekenbareBtwWerkelijkNaarPnLBovenEbitdaRegels(w, true);
    expect(regels).toHaveLength(2);
    expect(regels.find((r) => r.regelSleutel === "NIET_VERREKENBARE_BTW")!.waarde).toEqual({ status: "BEKEND", bedrag: D(500) });
    expect(regels.find((r) => r.regelSleutel === "NIET_VERREKENBARE_BTW_NIET_GECLASSIFICEERD")!.waarde.status).toBe("ONBEKEND");
  });
});

describe("Estimated Niet verrekenbare BTW -> P&L: Werkelijk + handmatige resterende verwachting (Master Contract §7)", () => {
  const werkelijk = (bedrag: number | string, nietGeclassificeerd: number | string = 0) =>
    berekenWerkelijkNietVerrekenbareBtw([{ economischeCategorie: "NIET_VERREKENBARE_BTW", saldo: D(bedrag) }, ...(D(nietGeclassificeerd).isZero() ? [] : [{ economischeCategorie: null, saldo: D(nietGeclassificeerd) }])]);

  it("A. Actual bekend + resterende verwachting bekend -> Estimated bekend (4000 + 2500 = 6500)", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), true, D(2500));
    const regels = nietVerrekenbareBtwEstimatedNaarPnLBovenEbitdaRegels(e);
    expect(regels).toEqual([{ regelSleutel: NIET_VERREKENBARE_BTW_PNL_SLEUTEL, boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: { status: "BEKEND", bedrag: D(6500) } }]);
    expect(berekenPnLBoom("ESTIMATED", regels).exploitatieLasten.volledigheid.status).toBe("VOLLEDIG");
  });

  it("B. Actual bekend + resterende verwachting expliciet €0 -> Estimated = Actual (4000 + 0 = 4000)", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), true, D(0));
    expect(nietVerrekenbareBtwEstimatedNaarPnLBovenEbitdaRegels(e)[0]!.waarde).toEqual({ status: "BEKEND", bedrag: D(4000) });
  });

  it("C. Actual bekend + resterende verwachting null -> ONBEKEND, nooit €0", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), true, null);
    const regels = nietVerrekenbareBtwEstimatedNaarPnLBovenEbitdaRegels(e);
    expect(regels[0]!.waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING" });
    expect(berekenPnLBoom("ESTIMATED", regels).exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("D. Actual onbekend (dekking niet bevestigd) + resterende verwachting bekend -> geen verzonnen totaal, ONBEKEND", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), false, D(2500));
    expect(nietVerrekenbareBtwEstimatedNaarPnLBovenEbitdaRegels(e)[0]!.waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
  });

  it("E. Actual onbekend + resterende verwachting null -> ONBEKEND", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), false, null);
    expect(nietVerrekenbareBtwEstimatedNaarPnLBovenEbitdaRegels(e)[0]!.waarde.status).toBe("ONBEKEND");
  });

  it("niet-geclassificeerde Werkelijk-boekingen (nietGeclassificeerdTotaal != 0) maken Estimated onbekend, ook met een ingevulde verwachting", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000, 50), true, D(2500));
    expect(nietVerrekenbareBtwEstimatedNaarPnLBovenEbitdaRegels(e)[0]!.waarde.status).toBe("ONBEKEND");
  });

  it("negatieve resterende verwachting is toegestaan (bv. een verwachte teruggave) en telt volledig mee", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), true, D(-500));
    expect(nietVerrekenbareBtwEstimatedNaarPnLBovenEbitdaRegels(e)[0]!.waarde).toEqual({ status: "BEKEND", bedrag: D(3500) });
  });

  it("geen automatische extrapolatie/Begroting-min-Werkelijk/vorig-jaar/percentage: de verwachting is uitsluitend de aangeleverde waarde, ongewijzigd", () => {
    const e = berekenEstimatedNietVerrekenbareBtw(werkelijk(4000), true, D(2500));
    expect(e.verwachtingResterendJaar!.toString()).toBe("2500");
    expect(e.estimatedTotaal!.toString()).toBe("6500");
  });
});
