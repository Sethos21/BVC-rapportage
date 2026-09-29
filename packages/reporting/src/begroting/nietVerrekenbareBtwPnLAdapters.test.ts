import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBegroteNietVerrekenbareBtw } from "./begroteNietVerrekenbareBtw.js";
import { berekenWerkelijkNietVerrekenbareBtw, type WerkelijkNietVerrekenbareBtwBoekingRegel } from "./werkelijkNietVerrekenbareBtw.js";
import {
  NIET_VERREKENBARE_BTW_PNL_SLEUTEL,
  nietVerrekenbareBtwBegrotingNaarPnLBovenEbitdaRegels,
  nietVerrekenbareBtwEstimatedNietOndersteundNaarPnLBovenEbitdaRegels,
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

describe("Estimated Niet verrekenbare BTW -> P&L: STOP (BUSINESSBESLISSING), 18/16", () => {
  it("18. blijft altijd ONBEKEND/TECHNISCH_NIET_ONDERSTEUND — geen eigen methode aangenomen", () => {
    const regels = nietVerrekenbareBtwEstimatedNietOndersteundNaarPnLBovenEbitdaRegels();
    expect(regels).toEqual([
      { regelSleutel: NIET_VERREKENBARE_BTW_PNL_SLEUTEL, boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: { status: "ONBEKEND", dekkingReden: "TECHNISCH_NIET_ONDERSTEUND", toelichting: expect.stringContaining("BUSINESSBESLISSING") } },
    ]);
  });

  it("16. maakt de Estimated-EBITDA ONVOLLEDIG (blokkeert de overige Estimated-posten niet — dit is een losse regel)", () => {
    const regels = nietVerrekenbareBtwEstimatedNietOndersteundNaarPnLBovenEbitdaRegels();
    expect(berekenPnLBoom("ESTIMATED", regels).ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });
});
