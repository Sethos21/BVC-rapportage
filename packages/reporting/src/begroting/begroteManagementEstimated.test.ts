import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBegroteManagementvergoeding, type BgManagementInvoer } from "./begroteManagementvergoeding.js";
import { berekenEstimatedManagement, managementEstimatedNaarPnLBovenEbitdaRegels } from "./begroteManagementEstimated.js";
import { berekenWerkelijkManagement } from "./werkelijkManagement.js";
import { bepaalGemapteCategorieen, type PnLBronmappingRegel } from "../pnlBronmapping.js";
import { berekenPnLBoom } from "../pnlEngine.js";
import { berekenPnLPeriode } from "../pnlPeriodeOrchestratie.js";

/** Estimated Managementvergoeding (Vervolgtranche 7): generieke ondersteuning; het Werkelijk-BRONGAT (070) blijft ONBEKEND. */

const D = (n: string | number) => new Decimal(n);
const datum = (s: string) => new Date(`${s}T00:00:00.000Z`);
const begroting = (invoer: BgManagementInvoer) => berekenBegroteManagementvergoeding(invoer, { begrotingsjaar: 2027 });
const werkelijk = (saldo = 3000, nietGeclassificeerd = 0) =>
  berekenWerkelijkManagement([{ economischeCategorie: "MANAGEMENTVERGOEDING", saldo: D(saldo) }, ...(nietGeclassificeerd !== 0 ? [{ economischeCategorie: null, saldo: D(nietGeclassificeerd) }] : [])]);
const RESTEREND = [7, 8, 9, 10, 11, 12];
const NIEUW: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: D(500), eenheid: "MAAND", ingangsdatum: null };

describe("berekenEstimatedManagement — Werkelijk + resterende managementvergoeding", () => {
  it("1. formule: Werkelijk (3.000, exact éénmaal) + resterend 6 × 500 = 6.000", () => {
    const r = berekenEstimatedManagement(begroting(NIEUW), werkelijk(), true, RESTEREND);
    expect(r.werkelijkTotaal.toString()).toBe("3000");
    expect(r.resterendeVerwachting!.toString()).toBe("3000");
    expect(r.estimatedTotaal!.toString()).toBe("6000");
  });

  it("2. bestaand indexeren: indexatie vanaf de juiste maand (augustus), niets geprojecteerd; wijzigen en nieuw per ingangsdatum", () => {
    const indexeer = begroting({ wijze: "INDEXEER_BESTAAND", bestaandBedrag: D(500), eenheid: "MAAND", indexatiePercentage: D(4), indexatiedatum: datum("2027-08-01") });
    const maand = (m: number) => berekenEstimatedManagement(indexeer, werkelijk(), true, [m]).resterendeVerwachting!.toString();
    expect(maand(7)).toBe("500");
    expect(maand(8)).toBe("520");
    const wijzig = begroting({ wijze: "WIJZIG_BESTAAND_BEDRAG", bestaandBedrag: D(500), bestaandEenheid: "MAAND", nieuwBedrag: D(600), nieuweEenheid: "MAAND", ingangsdatum: datum("2027-09-01") });
    expect(berekenEstimatedManagement(wijzig, werkelijk(), true, [8]).resterendeVerwachting!.toString()).toBe("500");
    expect(berekenEstimatedManagement(wijzig, werkelijk(), true, [9]).resterendeVerwachting!.toString()).toBe("600");
    const nieuw = begroting({ wijze: "NIEUWE_VERGOEDING", bedrag: D(500), eenheid: "MAAND", ingangsdatum: datum("2027-10-01") });
    expect(berekenEstimatedManagement(nieuw, werkelijk(), true, [9]).resterendeVerwachting!.toString()).toBe("0");
    expect(berekenEstimatedManagement(nieuw, werkelijk(), true, [10]).resterendeVerwachting!.toString()).toBe("500");
  });

  it("3. HET WERKELIJK-BRONGAT BLIJFT ZICHTBAAR: zonder bevestigde Werkelijk-dekking is Estimated ONBEKEND — niet €0, niet gevuld met de Begroting (6.000)", () => {
    const r = berekenEstimatedManagement(begroting(NIEUW), werkelijk(0), false, RESTEREND);
    expect(r.estimatedTotaal).toBeNull();
    expect(r.resterendeVerwachting!.toString()).toBe("3000"); // de begrote resterende verwachting bestaat, maar wordt niet als Estimated gepresenteerd
    const regels = managementEstimatedNaarPnLBovenEbitdaRegels(r);
    expect(regels[0]!.waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
    expect(r.controleVereist.some((c) => c.bericht.includes("niet als €0"))).toBe(true);
  });

  it("4. niet-geclassificeerde boekingen maken Estimated onbekend; kritieke Begroting of ontbrekende Begroting-invoer ook — nooit €0", () => {
    expect(berekenEstimatedManagement(begroting(NIEUW), werkelijk(3000, -10), true, RESTEREND).estimatedTotaal).toBeNull();
    const geenInvoer = berekenEstimatedManagement(null, werkelijk(), true, RESTEREND);
    expect(geenInvoer.estimatedTotaal).toBeNull();
    expect(managementEstimatedNaarPnLBovenEbitdaRegels(geenInvoer)[0]!.waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING" });
  });

  it("5. bewust €0 blijft bekend en onderscheidbaar: een €0-vergoeding en lege resterende maanden", () => {
    const nul = berekenEstimatedManagement(begroting({ wijze: "NIEUWE_VERGOEDING", bedrag: D(0), eenheid: "MAAND", ingangsdatum: null }), werkelijk(0), true, RESTEREND);
    expect(nul.estimatedTotaal!.toString()).toBe("0");
    expect(berekenEstimatedManagement(begroting(NIEUW), werkelijk(), true, []).estimatedTotaal!.toString()).toBe("3000");
  });

  it("6. de P&L-engine houdt Management en beheer ONVOLLEDIG zolang Management onbekend is; het bekende Beheer telt als beste-weten-som mee", () => {
    const onbekend = managementEstimatedNaarPnLBovenEbitdaRegels(berekenEstimatedManagement(begroting(NIEUW), werkelijk(0), false, RESTEREND));
    const beheer = [{ regelSleutel: "BEHEERKOSTEN", boomPositie: "BOVEN_EBITDA", groep: "MANAGEMENT_EN_BEHEER", contributieAard: "KOSTEN", waarde: { status: "BEKEND", bedrag: D(1000) } }] as const;
    const boom = berekenPnLBoom("ESTIMATED", [...beheer, ...onbekend]);
    expect(boom.managementEnBeheer.besteWetenSom.toString()).toBe("1000");
    expect(boom.managementEnBeheer.volledigheid.status).toBe("ONVOLLEDIG");
    expect(boom.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
    const bekend = managementEstimatedNaarPnLBovenEbitdaRegels(berekenEstimatedManagement(begroting(NIEUW), werkelijk(), true, RESTEREND));
    expect(berekenPnLBoom("ESTIMATED", [...beheer, ...bekend]).managementEnBeheer.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("7. administratiegebonden dekking, geen 070-hardcoding: dezelfde code geeft BEKEND met een MANAGEMENT-mapping en ONBEKEND zonder", () => {
    const mapping: PnLBronmappingRegel[] = [
      { bedrijfsnr: "003", grootboekrekening: "4100", ogbKostensoort: null, economischeModule: "MANAGEMENT", economischeCategorie: "MANAGEMENTVERGOEDING", geldigVanafBoekjaar: 2025, geldigVanafPeriode: "01", geldigTotBoekjaar: null, geldigTotPeriode: null, aangemaaktOp: datum("2026-09-15") },
    ];
    const ref = { boekjaar: 2027, boekperiode: "06", opSysteemtijdstip: datum("2026-12-01") };
    const dekking = (bedrijfsnr: string) => bepaalGemapteCategorieen(mapping, { bedrijfsnr, economischeModule: "MANAGEMENT", ...ref }).has("MANAGEMENTVERGOEDING");
    expect(berekenEstimatedManagement(begroting(NIEUW), werkelijk(), dekking("003"), RESTEREND).estimatedTotaal!.toString()).toBe("6000");
    expect(berekenEstimatedManagement(begroting(NIEUW), werkelijk(), dekking("070"), RESTEREND).estimatedTotaal).toBeNull();
  });

  it("8. consistent met de Werkelijk-P&L: zonder Management-mapping is ook Werkelijk Management ONBEKEND — beide waardesoorten spreken elkaar niet tegen", () => {
    const zonder = berekenPnLPeriode({ bedrijfsnr: "070", boekjaar: 2027, boekperiode: "06", opSysteemtijdstip: datum("2026-12-01") }, [], []);
    expect(zonder.resultaat.managementEnBeheer.regels.find((r) => r.regelSleutel === "MANAGEMENTVERGOEDING")!.waarde.status).toBe("ONBEKEND");
  });

  it("9. Begroting ongewijzigd; ongeldige maanden falen hard", () => {
    const b = begroting(NIEUW);
    const voor = JSON.stringify(b.jaartotaal);
    const r = berekenEstimatedManagement(b, werkelijk(), true, RESTEREND);
    expect(JSON.stringify(b.jaartotaal)).toBe(voor);
    expect(r.begrotingTotaal!.toString()).toBe(b.jaartotaal.bedrag.toString());
    expect(() => berekenEstimatedManagement(b, werkelijk(), true, [14])).toThrow(/Ongeldige/);
  });
});
