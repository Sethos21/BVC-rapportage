import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { huurWerkelijkNaarPnLBovenEbitdaRegels } from "./huurWerkelijkPnLAdapter.js";
import { berekenWerkelijkHuur, type WerkelijkHuurBoekingRegel } from "./werkelijkHuur.js";
import { berekenPnLBoom, type PnLDekkingReden, type PurePnLOnderEbitdaRegel } from "../pnlEngine.js";

/**
 * FASE GAT-002B (2026-09-16) — bewijs dat Werkelijk Huur, via
 * `huurWerkelijkPnLAdapter.ts`, correct aansluit op de Pure P&L Engine
 * (`pnlEngine.ts`, commit d25783e): tekennormalisatie (netto operationele
 * opbrengst), completeness-propagatie (NIET_GEMAPT/brondekking), en
 * boven-EBITDA-plaatsing (geen effect op onder-EBITDA-posten).
 */

function boeking(overrides: Partial<WerkelijkHuurBoekingRegel> = {}): WerkelijkHuurBoekingRegel {
  return { economischeCategorie: "HUUROPBRENGST_BELAST", saldo: new Decimal(0), ...overrides };
}

describe("huurWerkelijkNaarPnLBovenEbitdaRegels — D/G. tekennormalisatie en netto operationele opbrengst", () => {
  it("D. Totaal opbrengsten = Belast + Onbelast − Korting (adapter normaliseert eenmalig, engine sommeert ongewijzigd)", () => {
    const resultaat = berekenWerkelijkHuur([
      boeking({ economischeCategorie: "HUUROPBRENGST_BELAST", saldo: new Decimal(-200000) }),
      boeking({ economischeCategorie: "HUUROPBRENGST_ONBELAST", saldo: new Decimal(-50000) }),
      boeking({ economischeCategorie: "VERLEENDE_HUURKORTING", saldo: new Decimal(3000) }),
    ]);
    const regels = huurWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    const pnl = berekenPnLBoom("WERKELIJK", regels);

    expect(pnl.totaalOpbrengsten.besteWetenSom.toString()).toBe("247000"); // 200000 + 50000 - 3000
    expect(pnl.totaalOpbrengsten.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("G. €0 in een categorie, maar volledig gedekt -> BEKEND (niet ONVOLLEDIG)", () => {
    const resultaat = berekenWerkelijkHuur([boeking({ economischeCategorie: "HUUROPBRENGST_BELAST", saldo: new Decimal(-100000) })]); // geen korting deze periode
    const regels = huurWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    const kortingRegel = regels.find((r) => r.regelSleutel === "VERLEENDE_HUURKORTING")!;

    expect(kortingRegel.waarde.status).toBe("BEKEND");
    expect((kortingRegel.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.isZero()).toBe(true);
    const pnl = berekenPnLBoom("WERKELIJK", regels);
    expect(pnl.totaalOpbrengsten.volledigheid).toEqual({ status: "VOLLEDIG" });
    expect(pnl.totaalOpbrengsten.besteWetenSom.toString()).toBe("100000");
  });

  it("H. correctieboekingen (ruw positief op een opbrengst-GL) verlagen na normalisatie correct de opbrengst", () => {
    const resultaat = berekenWerkelijkHuur([
      boeking({ economischeCategorie: "HUUROPBRENGST_BELAST", saldo: new Decimal(-200000) }),
      boeking({ economischeCategorie: "HUUROPBRENGST_BELAST", saldo: new Decimal(1500) }), // correctie
    ]);
    const regels = huurWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    const belastRegel = regels.find((r) => r.regelSleutel === "HUUROPBRENGST_BELAST")!;
    expect((belastRegel.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("198500"); // -(-198500)
  });
});

describe("huurWerkelijkNaarPnLBovenEbitdaRegels — F. completeness: NIET_GEMAPT en dekkingsbevestiging", () => {
  it("F. nietGeclassificeerdTotaal != 0 -> een vierde ONBEKEND/NIET_GEMAPT-regel maakt de OPBRENGSTEN-groep ONVOLLEDIG, de drie bekende categorieën blijven zelf gewoon BEKEND", () => {
    const resultaat = berekenWerkelijkHuur([
      boeking({ economischeCategorie: "HUUROPBRENGST_BELAST", saldo: new Decimal(-200000) }),
      boeking({ economischeCategorie: null, saldo: new Decimal(-750) }), // niet-geclassificeerd
    ]);
    expect(resultaat.nietGeclassificeerdTotaal.toString()).toBe("-750");

    const regels = huurWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    const nietGemapt = regels.find((r) => r.regelSleutel === "HUUR_NIET_GECLASSIFICEERD")!;
    expect(nietGemapt.waarde.status).toBe("ONBEKEND");
    expect((nietGemapt.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("NIET_GEMAPT");

    const belastRegel = regels.find((r) => r.regelSleutel === "HUUROPBRENGST_BELAST")!;
    expect(belastRegel.waarde).toEqual({ status: "BEKEND", bedrag: new Decimal(200000) }); // onaangetast door het niet-gemapte bedrag

    const pnl = berekenPnLBoom("WERKELIJK", regels);
    expect(pnl.totaalOpbrengsten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(pnl.totaalOpbrengsten.besteWetenSom.toString()).toBe("200000"); // bekende deelsom blijft beschikbaar (Unknown != zero)
    expect(pnl.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("nietGeclassificeerdTotaal === 0 (geen gat) -> geen vierde regel toegevoegd, groep blijft VOLLEDIG", () => {
    const resultaat = berekenWerkelijkHuur([boeking({ economischeCategorie: "HUUROPBRENGST_BELAST", saldo: new Decimal(-200000) })]);
    const regels = huurWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    expect(regels.find((r) => r.regelSleutel === "HUUR_NIET_GECLASSIFICEERD")).toBeUndefined();
    expect(regels).toHaveLength(3);
  });

  it("nietGeclassificeerdTotaal === 0, maar dekking NIET bevestigd door de aanroepende laag -> alle drie categorieën blijven ONBEKEND (GAT-001B §5: noodzakelijk, niet voldoende)", () => {
    const resultaat = berekenWerkelijkHuur([boeking({ economischeCategorie: "HUUROPBRENGST_BELAST", saldo: new Decimal(-200000) })]);
    expect(resultaat.nietGeclassificeerdTotaal.toString()).toBe("0");

    const regels = huurWerkelijkNaarPnLBovenEbitdaRegels(resultaat, false);
    expect(regels.every((r) => r.waarde.status === "ONBEKEND")).toBe(true);
    expect(regels.map((r) => (r.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden)).toEqual(["GEEN_BEOORDELING", "GEEN_BEOORDELING", "GEEN_BEOORDELING"]);

    const pnl = berekenPnLBoom("WERKELIJK", regels);
    expect(pnl.totaalOpbrengsten.volledigheid.status).toBe("ONVOLLEDIG");
  });
});

describe("Pure P&L Engine — L/M. EBITDA reageert correct op Huur Werkelijk, geen onder-EBITDA-effect", () => {
  it("L. EBITDA daalt/stijgt exact mee met de netto Huur-opbrengst wanneer er verder geen kosten zijn", () => {
    const resultaat = berekenWerkelijkHuur([
      boeking({ economischeCategorie: "HUUROPBRENGST_BELAST", saldo: new Decimal(-200000) }),
      boeking({ economischeCategorie: "HUUROPBRENGST_ONBELAST", saldo: new Decimal(-50000) }),
      boeking({ economischeCategorie: "VERLEENDE_HUURKORTING", saldo: new Decimal(3000) }),
    ]);
    const pnl = berekenPnLBoom("WERKELIJK", huurWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true));
    expect(pnl.ebitda.bedrag.toString()).toBe("247000"); // geen kosten aangeleverd: EBITDA = Totaal opbrengsten
    expect(pnl.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("M. Huur Werkelijk introduceert zelf geen onder-EBITDA-regels — alle drie categorieën (en het niet-gemapte gat) staan uitsluitend boven EBITDA", () => {
    const resultaat = berekenWerkelijkHuur([
      boeking({ economischeCategorie: "HUUROPBRENGST_BELAST", saldo: new Decimal(-200000) }),
      boeking({ economischeCategorie: null, saldo: new Decimal(-100) }),
    ]);
    const regels = huurWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    expect(regels.every((r) => r.boomPositie === "BOVEN_EBITDA")).toBe(true);

    const pnl = berekenPnLBoom("WERKELIJK", regels);
    expect(pnl.onderEbitda).toEqual<readonly PurePnLOnderEbitdaRegel[]>([]);

    // Toevoegen van een echte onder-EBITDA-post (Rentekosten) mag de Huur-gedreven Totaal
    // opbrengsten/volledigheid niet raken — bewijst de structurele scheiding nogmaals op deze keten.
    const metRente = berekenPnLBoom("WERKELIJK", [...regels, { regelSleutel: "RENTEKOSTEN", boomPositie: "ONDER_EBITDA", contributieAard: "KOSTEN", waarde: { status: "BEKEND", bedrag: new Decimal(50000) } }]);
    expect(metRente.totaalOpbrengsten.besteWetenSom.toString()).toBe(pnl.totaalOpbrengsten.besteWetenSom.toString());
    expect(metRente.ebitda.bedrag.toString()).toBe(pnl.ebitda.bedrag.toString());
  });
});
