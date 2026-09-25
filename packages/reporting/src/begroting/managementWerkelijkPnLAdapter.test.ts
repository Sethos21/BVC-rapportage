import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { managementWerkelijkNaarPnLBovenEbitdaRegels } from "./managementWerkelijkPnLAdapter.js";
import { beheerWerkelijkNaarPnLBovenEbitdaRegels } from "./beheerWerkelijkPnLAdapter.js";
import { berekenWerkelijkManagement, type WerkelijkManagementBoekingRegel } from "./werkelijkManagement.js";
import { berekenWerkelijkBeheer, type WerkelijkBeheerBoekingRegel } from "./werkelijkBeheer.js";
import { berekenPnLBoom, type PnLDekkingReden } from "../pnlEngine.js";

/**
 * FASE GAT-002D (2026-09-16) — bewijs dat Werkelijk Management, via
 * `managementWerkelijkPnLAdapter.ts`, correct aansluit op de Pure P&L
 * Engine: plaatsing in MANAGEMENT_EN_BEHEER (boven EBITDA, AFZONDERLIJK van
 * Beheer), tekensemantiek, completeness-propagatie, en het H1-2026-EBITDA-
 * effect op de echte 023-bronreconciliatiecijfers.
 */

function boeking(overrides: Partial<WerkelijkManagementBoekingRegel> = {}): WerkelijkManagementBoekingRegel {
  return { economischeCategorie: "MANAGEMENTVERGOEDING", saldo: new Decimal(0), ...overrides };
}

describe("managementWerkelijkNaarPnLBovenEbitdaRegels — plaatsing en tekensemantiek", () => {
  it("plaatst Management als KOSTEN in de groep MANAGEMENT_EN_BEHEER, boven EBITDA", () => {
    const resultaat = berekenWerkelijkManagement([boeking({ saldo: new Decimal(171831.48) })]);
    const [regel] = managementWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);

    expect(regel!.boomPositie).toBe("BOVEN_EBITDA");
    expect(regel!.groep).toBe("MANAGEMENT_EN_BEHEER");
    expect(regel!.contributieAard).toBe("KOSTEN");
    expect(regel!.regelSleutel).toBe("MANAGEMENTVERGOEDING");
  });

  it("geen tekenomkering nodig: het ruwe, positieve bronsaldo (inclusief de indexatie-correctieboeking) komt ongewijzigd door als BEKEND bedrag", () => {
    const resultaat = berekenWerkelijkManagement([boeking({ saldo: new Decimal(171831.48) })]);
    const [regel] = managementWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);
    expect((regel!.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("171831.48");
  });
});

describe("managementWerkelijkNaarPnLBovenEbitdaRegels — completeness", () => {
  it("niet-gemapte bedragen verdwijnen niet: nietGeclassificeerdTotaal != 0 -> een tweede ONBEKEND/NIET_GEMAPT-regel, MANAGEMENTVERGOEDING blijft zelf BEKEND", () => {
    const resultaat = berekenWerkelijkManagement([boeking({ saldo: new Decimal(171831.48) }), boeking({ economischeCategorie: null, saldo: new Decimal(500) })]);
    const regels = managementWerkelijkNaarPnLBovenEbitdaRegels(resultaat, true);

    expect(regels).toHaveLength(2);
    const managementvergoeding = regels.find((r) => r.regelSleutel === "MANAGEMENTVERGOEDING")!;
    const nietGemapt = regels.find((r) => r.regelSleutel === "MANAGEMENT_NIET_GECLASSIFICEERD")!;
    expect(managementvergoeding.waarde).toEqual({ status: "BEKEND", bedrag: new Decimal(171831.48) });
    expect(nietGemapt.waarde.status).toBe("ONBEKEND");
    expect((nietGemapt.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("NIET_GEMAPT");

    const pnl = berekenPnLBoom("WERKELIJK", regels);
    expect(pnl.managementEnBeheer.volledigheid.status).toBe("ONVOLLEDIG");
    expect(pnl.managementEnBeheer.besteWetenSom.toString()).toBe("171831.48"); // bekende deelsom blijft beschikbaar
  });

  it("nietGeclassificeerdTotaal === 0, maar dekking NIET bevestigd -> MANAGEMENTVERGOEDING blijft ONBEKEND", () => {
    const resultaat = berekenWerkelijkManagement([boeking({ saldo: new Decimal(171831.48) })]);
    const regels = managementWerkelijkNaarPnLBovenEbitdaRegels(resultaat, false);
    expect(regels).toHaveLength(1);
    expect(regels[0]!.waarde.status).toBe("ONBEKEND");
  });
});

describe("Management staat afzonderlijk van Beheer, geen samenvoeging, geen double count", () => {
  it("Management en Beheer blijven twee eigen P&L-regels, beide correct opgeteld in het MANAGEMENT_EN_BEHEER-subtotaal", () => {
    const managementResultaat = berekenWerkelijkManagement([boeking({ saldo: new Decimal(171831.48) })]);
    const beheerResultaat = berekenWerkelijkBeheer([{ economischeCategorie: "BEHEERKOSTEN", saldo: new Decimal(3127.58) } satisfies WerkelijkBeheerBoekingRegel]);

    const regels = [...managementWerkelijkNaarPnLBovenEbitdaRegels(managementResultaat, true), ...beheerWerkelijkNaarPnLBovenEbitdaRegels(beheerResultaat, true)];
    const pnl = berekenPnLBoom("WERKELIJK", regels);

    // Twee aparte regels, geen samenvoeging tot één "Beheer en Management"-regel.
    expect(pnl.managementEnBeheer.regels.map((r) => r.regelSleutel).sort()).toEqual(["BEHEERKOSTEN", "MANAGEMENTVERGOEDING"]);
    expect(pnl.managementEnBeheer.besteWetenSom.toString()).toBe("174959.06"); // 171831.48 + 3127.58
    expect(pnl.exploitatieLasten.besteWetenSom.toString()).toBe("0"); // geen double count in een andere groep
  });
});

describe("Pure P&L Engine — EBITDA reageert correct op de echte 023 H1-2026-bronreconciliatie", () => {
  it("de acht echte H1-2026-boekingen (Boekingen -> centrale mapping -> Werkelijk Management -> Pure P&L-adapter) verlagen EBITDA exact met €171.831,48", () => {
    const h1Resultaat = berekenWerkelijkManagement([
      boeking({ saldo: new Decimal("27533.77") }),
      boeking({ saldo: new Decimal("1104.81") }),
      boeking({ saldo: new Decimal("28638.58") }),
      boeking({ saldo: new Decimal("28638.58") }),
      boeking({ saldo: new Decimal("28638.58") }),
      boeking({ saldo: new Decimal("28638.58") }),
      boeking({ saldo: new Decimal("28638.58") }),
    ]);
    const regels = managementWerkelijkNaarPnLBovenEbitdaRegels(h1Resultaat, true);
    const opbrengstRegel = { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA" as const, groep: "OPBRENGSTEN" as const, contributieAard: "OPBRENGST" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(500000) } };

    const zonderManagement = berekenPnLBoom("WERKELIJK", [opbrengstRegel]);
    const metManagement = berekenPnLBoom("WERKELIJK", [opbrengstRegel, ...regels]);

    expect(metManagement.managementEnBeheer.besteWetenSom.toString()).toBe("171831.48");
    expect(zonderManagement.ebitda.bedrag.minus(metManagement.ebitda.bedrag).toString()).toBe("171831.48");
    expect(metManagement.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });
});
