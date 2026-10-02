import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { beheerWerkelijkNaarPnLBovenEbitdaRegels } from "./beheerWerkelijkPnLAdapter.js";
import { berekenWerkelijkBeheer, type WerkelijkBeheerBoekingRegel } from "./werkelijkBeheer.js";
import { berekenPnLBoom, type PnLDekkingReden } from "../pnlEngine.js";

/**
 * FASE GAT-002C (2026-09-16) — bewijs dat Werkelijk Beheer, via
 * `beheerWerkelijkPnLAdapter.ts`, correct aansluit op de Pure P&L Engine:
 * plaatsing in MANAGEMENT_EN_BEHEER (boven EBITDA), tekensemantiek (geen
 * flip nodig, kosten komen al positief door), completeness-propagatie, en
 * P&L-/EBITDA-effect op de echte 070-bronreconciliatiecijfers.
 */

function boeking(overrides: Partial<WerkelijkBeheerBoekingRegel> = {}): WerkelijkBeheerBoekingRegel {
  return { economischeCategorie: "BEHEERKOSTEN", saldo: new Decimal(0), ...overrides };
}

describe("beheerWerkelijkNaarPnLBovenEbitdaRegels — plaatsing en tekensemantiek", () => {
  it("plaatst Beheer als KOSTEN in de groep MANAGEMENT_EN_BEHEER, boven EBITDA", () => {
    const resultaat = berekenWerkelijkBeheer([boeking({ saldo: new Decimal(3127.58) })]);
    const [regel] = beheerWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);

    expect(regel!.boomPositie).toBe("BOVEN_EBITDA");
    expect(regel!.groep).toBe("MANAGEMENT_EN_BEHEER");
    expect(regel!.contributieAard).toBe("KOSTEN");
  });

  it("geen tekenomkering nodig: het ruwe, positieve bronsaldo komt ongewijzigd door als BEKEND bedrag", () => {
    const resultaat = berekenWerkelijkBeheer([boeking({ saldo: new Decimal(3127.58) })]);
    const [regel] = beheerWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    expect((regel!.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("3127.58");
  });
});

describe("beheerWerkelijkNaarPnLBovenEbitdaRegels — completeness", () => {
  it("niet-gemapte bedragen verdwijnen niet: nietGeclassificeerdTotaal != 0 -> een tweede ONBEKEND/NIET_GEMAPT-regel, BEHEERKOSTEN blijft zelf BEKEND", () => {
    const resultaat = berekenWerkelijkBeheer([boeking({ saldo: new Decimal(3127.58) }), boeking({ economischeCategorie: null, saldo: new Decimal(500) })]);
    const regels = beheerWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);

    expect(regels).toHaveLength(2);
    const beheerkosten = regels.find((r) => r.regelSleutel === "BEHEERKOSTEN")!;
    const nietGemapt = regels.find((r) => r.regelSleutel === "BEHEER_NIET_GECLASSIFICEERD")!;
    expect(beheerkosten.waarde).toEqual({ status: "BEKEND", bedrag: new Decimal(3127.58) });
    expect(nietGemapt.waarde.status).toBe("ONBEKEND");
    expect((nietGemapt.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("NIET_GEMAPT");

    const pnl = berekenPnLBoom("WERKELIJK", regels);
    expect(pnl.managementEnBeheer.volledigheid.status).toBe("ONVOLLEDIG");
    expect(pnl.managementEnBeheer.besteWetenSom.toString()).toBe("3127.58"); // bekende deelsom blijft beschikbaar
  });

  it("geen niet-gemapt bedrag -> geen tweede regel, groep blijft VOLLEDIG", () => {
    const resultaat = berekenWerkelijkBeheer([boeking({ saldo: new Decimal(3127.58) })]);
    const regels = beheerWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    expect(regels).toHaveLength(1);
    const pnl = berekenPnLBoom("WERKELIJK", regels);
    expect(pnl.managementEnBeheer.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("nietGeclassificeerdTotaal === 0, maar dekking NIET bevestigd -> BEHEERKOSTEN blijft ONBEKEND (noodzakelijk, niet voldoende)", () => {
    const resultaat = berekenWerkelijkBeheer([boeking({ saldo: new Decimal(3127.58) })]);
    const regels = beheerWerkelijkNaarPnLBovenEbitdaRegels(resultaat, false);
    expect(regels).toHaveLength(1);
    expect(regels[0]!.waarde.status).toBe("ONBEKEND");
    const pnl = berekenPnLBoom("WERKELIJK", regels);
    expect(pnl.managementEnBeheer.volledigheid.status).toBe("ONVOLLEDIG");
  });
});

describe("Pure P&L Engine — EBITDA-effect en 070 H1-2026-reconciliatie", () => {
  it("P&L-bijdrage en EBITDA zijn correct: Beheer verlaagt EBITDA met exact haar eigen bedrag, geen double count met andere groepen", () => {
    const resultaat = berekenWerkelijkBeheer([boeking({ saldo: new Decimal(3127.58) })]);
    const beheerRegels = beheerWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    const opbrengstRegel = { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA" as const, groep: "OPBRENGSTEN" as const, contributieAard: "OPBRENGST" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(100000) } };

    const zonderBeheer = berekenPnLBoom("WERKELIJK", [opbrengstRegel]);
    const metBeheer = berekenPnLBoom("WERKELIJK", [opbrengstRegel, ...beheerRegels]);

    expect(metBeheer.managementEnBeheer.besteWetenSom.toString()).toBe("3127.58");
    expect(metBeheer.exploitatieLasten.besteWetenSom.toString()).toBe("0"); // geen double count in een andere groep
    expect(zonderBeheer.ebitda.bedrag.minus(metBeheer.ebitda.bedrag).toString()).toBe("3127.58");
  });

  it("070 H1-2026 reconcilieert op €6.446 (afgerond) via de volledige keten: Boekingen -> centrale mapping -> Werkelijk Beheer -> Pure P&L-adapter -> EBITDA-effect", () => {
    // De vier echte boekingen uit rekeningactiviteit-4000-070-2026.json (bronproef, zie moduledoc beheerCentraleMapping.test.ts).
    const h1Resultaat = berekenWerkelijkBeheer([
      boeking({ saldo: new Decimal("1979.17") }),
      boeking({ saldo: new Decimal("1148.41") }),
      boeking({ saldo: new Decimal("1148.41") }),
      boeking({ saldo: new Decimal("2169.65") }),
    ]);
    const regels = beheerWerkelijkNaarPnLBovenEbitdaRegels(h1Resultaat, true);
    const pnl = berekenPnLBoom("WERKELIJK", regels);

    expect(pnl.managementEnBeheer.besteWetenSom.toDecimalPlaces(0).toString()).toBe("6446");
    expect(pnl.managementEnBeheer.besteWetenSom.toString()).toBe("6445.64");
    expect(pnl.totaalKosten.besteWetenSom.toString()).toBe("6445.64");
    expect(pnl.ebitda.bedrag.toString()).toBe("-6445.64"); // geen opbrengsten aangeleverd in deze bewijsketen
    expect(pnl.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });
});
