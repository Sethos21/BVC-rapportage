import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels } from "./algemeneKostenWerkelijkPnLAdapter.js";
import { berekenWerkelijkAlgemeneKosten, type WerkelijkAlgemeneKostenBoekingRegel } from "./werkelijkAlgemeneKosten.js";
import { berekenPnLBoom, type PnLDekkingReden } from "../pnlEngine.js";

/**
 * FASE GAT-009 (2026-09-16) — bewijs dat Werkelijk Algemene Kosten, via
 * `algemeneKostenWerkelijkPnLAdapter.ts`, correct aansluit op de Pure P&L
 * Engine: vijf afzonderlijke regels in groep ALGEMENE_KOSTEN (boven EBITDA,
 * geen dubbele telling), tekensemantiek, completeness-propagatie (F), en
 * EBITDA-/onder-EBITDA-effect (G/H) op de bewezen 070-bronreconciliatie.
 */

function boeking(overrides: Partial<WerkelijkAlgemeneKostenBoekingRegel> = {}): WerkelijkAlgemeneKostenBoekingRegel {
  return { economischeCategorie: "ALGEMENE_KOSTEN", saldo: new Decimal(0), ...overrides };
}

describe("algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels — vijf afzonderlijke regels, groep ALGEMENE_KOSTEN, geen dubbele telling", () => {
  it("elke categorie wordt een eigen regel, in groep ALGEMENE_KOSTEN, boven EBITDA, als KOSTEN", () => {
    const resultaat = berekenWerkelijkAlgemeneKosten([
      boeking({ economischeCategorie: "ALGEMENE_KOSTEN", saldo: new Decimal("572.37") }),
      boeking({ economischeCategorie: "MAKELAARSKOSTEN", saldo: new Decimal("6067.24") }),
      boeking({ economischeCategorie: "BANKKOSTEN", saldo: new Decimal("40.15") }),
    ]);
    const regels = algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);

    expect(regels).toHaveLength(5); // alle vijf bestaande categorieën, ook de twee met €0
    expect(regels.every((r) => r.boomPositie === "BOVEN_EBITDA" && r.groep === "ALGEMENE_KOSTEN" && r.contributieAard === "KOSTEN")).toBe(true);
    expect(new Set(regels.map((r) => r.regelSleutel)).size).toBe(5); // geen dubbele regelSleutel = geen dubbele telling
  });

  it("geen tekenomkering nodig: het ruwe, positieve bronsaldo komt ongewijzigd door als BEKEND bedrag", () => {
    const resultaat = berekenWerkelijkAlgemeneKosten([boeking({ economischeCategorie: "MAKELAARSKOSTEN", saldo: new Decimal("6067.24") })]);
    const regels = algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    const makelaars = regels.find((r) => r.regelSleutel === "MAKELAARSKOSTEN")!;
    expect((makelaars.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("6067.24");
  });

  it("'Taxatie/Verhuurbemiddeling' introduceert geen aparte regel — uitsluitend een presentatielabel binnen MAKELAARSKOSTEN, geen dubbele telling van hetzelfde bedrag", () => {
    const resultaat = berekenWerkelijkAlgemeneKosten([boeking({ economischeCategorie: "MAKELAARSKOSTEN", saldo: new Decimal("6067.24") })]);
    const regels = algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    expect(regels.some((r) => r.regelSleutel.toUpperCase().includes("TAXATIE"))).toBe(false);
    expect(regels.filter((r) => r.regelSleutel === "MAKELAARSKOSTEN")).toHaveLength(1);
  });
});

describe("algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels — F. completeness", () => {
  it("niet-gemapte bedragen verdwijnen niet: nietGeclassificeerdTotaal != 0 -> een zesde ONBEKEND/NIET_GEMAPT-regel, de bekende categorieën blijven zelf BEKEND", () => {
    const resultaat = berekenWerkelijkAlgemeneKosten([boeking({ economischeCategorie: "BANKKOSTEN", saldo: new Decimal("40.15") }), boeking({ economischeCategorie: null, saldo: new Decimal(500) })]);
    const regels = algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);

    expect(regels).toHaveLength(6);
    const nietGemapt = regels.find((r) => r.regelSleutel === "ALGEMENE_KOSTEN_NIET_GECLASSIFICEERD")!;
    expect(nietGemapt.waarde.status).toBe("ONBEKEND");
    expect((nietGemapt.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("NIET_GEMAPT");
    expect(regels.find((r) => r.regelSleutel === "BANKKOSTEN")!.waarde).toEqual({ status: "BEKEND", bedrag: new Decimal("40.15") });

    const pnl = berekenPnLBoom("WERKELIJK", regels);
    expect(pnl.algemeneKosten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(pnl.algemeneKosten.besteWetenSom.toString()).toBe("40.15"); // bekende deelsom blijft beschikbaar
  });

  it("F. nietGeclassificeerdTotaal === 0, maar dekking NIET bevestigd -> alle vijf categorieën blijven ONBEKEND (noodzakelijk, niet voldoende)", () => {
    const resultaat = berekenWerkelijkAlgemeneKosten([boeking({ economischeCategorie: "BANKKOSTEN", saldo: new Decimal("40.15") })]);
    expect(resultaat.nietGeclassificeerdTotaal.toString()).toBe("0");

    const regels = algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(resultaat, false);
    expect(regels).toHaveLength(5); // geen zesde regel: dekking is niet bevestigd, dus geen apart "niet-gemapt"-signaal nodig bovenop de reeds-ONBEKEND categorieën
    expect(regels.every((r) => r.waarde.status === "ONBEKEND")).toBe(true);

    const pnl = berekenPnLBoom("WERKELIJK", regels);
    expect(pnl.algemeneKosten.volledigheid.status).toBe("ONVOLLEDIG");
  });
});

describe("Pure P&L Engine — G/H. EBITDA-effect en onder-EBITDA blijft onaangetast", () => {
  it("G. Algemene Kosten verlagen EBITDA met exact het bewezen 070-totaal €6.679,76", () => {
    const resultaat = berekenWerkelijkAlgemeneKosten([
      boeking({ economischeCategorie: "ALGEMENE_KOSTEN", saldo: new Decimal("572.37") }),
      boeking({ economischeCategorie: "MAKELAARSKOSTEN", saldo: new Decimal("6067.24") }),
      boeking({ economischeCategorie: "BANKKOSTEN", saldo: new Decimal("40.15") }),
    ]);
    const regels = algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    const opbrengstRegel = { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA" as const, groep: "OPBRENGSTEN" as const, contributieAard: "OPBRENGST" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(100000) } };

    const zonder = berekenPnLBoom("WERKELIJK", [opbrengstRegel]);
    const met = berekenPnLBoom("WERKELIJK", [opbrengstRegel, ...regels]);

    expect(met.algemeneKosten.besteWetenSom.toString()).toBe("6679.76");
    expect(met.exploitatieLasten.besteWetenSom.toString()).toBe("0"); // geen double count in een andere groep
    expect(met.managementEnBeheer.besteWetenSom.toString()).toBe("0");
    expect(zonder.ebitda.bedrag.minus(met.ebitda.bedrag).toString()).toBe("6679.76");
    expect(met.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("H. onder-EBITDA-regels blijven onaangetast door Algemene Kosten", () => {
    const resultaat = berekenWerkelijkAlgemeneKosten([boeking({ economischeCategorie: "BANKKOSTEN", saldo: new Decimal("40.15") })]);
    const regels = algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    expect(regels.every((r) => r.boomPositie === "BOVEN_EBITDA")).toBe(true);

    const rentekostenRegel = { regelSleutel: "RENTEKOSTEN", boomPositie: "ONDER_EBITDA" as const, contributieAard: "KOSTEN" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(50000) } };
    const pnl = berekenPnLBoom("WERKELIJK", [...regels, rentekostenRegel]);

    expect(pnl.onderEbitda).toHaveLength(1);
    expect((pnl.onderEbitda[0]!.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("50000"); // ongewijzigd door Algemene Kosten
    expect(pnl.algemeneKosten.besteWetenSom.toString()).toBe("40.15"); // ongewijzigd door de onder-EBITDA-regel
  });
});
