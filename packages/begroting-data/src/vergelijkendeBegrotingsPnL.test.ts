import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALGEMENE_KOSTEN_CATEGORIEEN,
  LEEGSTAND_CATEGORIEEN,
  RENTE_CATEGORIEEN,
  berekenPnLPeriode,
  berekenWerkelijkAlgemeneKosten,
  berekenWerkelijkBeheer,
  berekenWerkelijkHuur,
  berekenWerkelijkGemeentelijkeLasten,
  berekenWerkelijkManagement,
  berekenWerkelijkNietVerrekenbareBtw,
  berekenWerkelijkOnderhoud,
  berekenWerkelijkRente,
  berekenWerkelijkVerzekeringen,
  berekenWerkelijkLeegstand,
  type BgManagementInvoer,
  type PnLBronmappingRegel,
  type PnLRuweBoekingRegel,
} from "@bvc/reporting";
import { schrijfAlgemeneKostenCategorieState } from "./algemeneKostenCategorieState.js";
import { schrijfAlgemeneKostenRegels } from "./algemeneKostenRegels.js";
import { type EstimatedPnLInvoer } from "./begrotingPnL.js";
import { maakBegrotingsversie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { schrijfCorrectiefDagelijksOnderhoudBeoordeeld } from "./correctiefDagelijksOnderhoudBeoordeeld.js";
import { schrijfCorrectiefDagelijksOnderhoudRegels } from "./correctiefDagelijksOnderhoudRegels.js";
import { openOrCreateDatabase } from "./database.js";
import { schrijfGemeentelijkeLastenEstimatedVerwachting } from "./gemeentelijkeLastenEstimated.js";
import { schrijfGemeentelijkeLastenModule, schrijfWozSetBevestigd } from "./gemeentelijkeLastenModule.js";
import { schrijfGemeentelijkeLastenRegels } from "./gemeentelijkeLastenRegels.js";
import { schrijfGeplandOnderhoudActiviteiten } from "./geplandOnderhoudActiviteiten.js";
import { schrijfGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";
import { schrijfGeplandeVerkoopBeoordeeld } from "./geplandeVerkoopBeoordeeld.js";
import { schrijfLeegstandCategorieState } from "./leegstandCategorieState.js";
import { schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Snapshot } from "./module1Snapshot.js";
import { schrijfModule3Invoer } from "./module3Invoer.js";
import { schrijfNietVerrekenbareBtwState } from "./nietVerrekenbareBtwState.js";
import { voegPnLBronmappingMutatieToe } from "./pnlBronmappingRepository.js";
import { schrijfRenteCategorieState } from "./renteCategorieState.js";
import { schrijfVerzekeringBeoordeeld } from "./verzekeringBeoordeeld.js";
import { bepaalResterendeKwartalen, bepaalResterendeMaanden, bouwEstimatedPnLInvoer, leesVergelijkendeBegrotingsPnL } from "./vergelijkendeBegrotingsPnL.js";

/**
 * TRANCHE 11 — bewijst dat de vergelijkende begrotings-P&L uitsluitend reeds bestaande,
 * geaccepteerde functies combineert: geen nieuwe financiële logica, Actual exact éénmaal,
 * "Begroting vorig jaar"/Estimated blijven expliciet onbekend zonder een bestaande
 * vorigjaarversie (nooit gereconstrueerd), en de Voorstel-kolom is alleen automatisch voor de
 * daarvoor contractueel bepaalde posten.
 */

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-vergelijkende-pnl-"));
  db = openOrCreateDatabase(join(dir, "begrotingen.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const D = (n: string | number) => new Decimal(n);
const MODULE3: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: D(500), eenheid: "MAAND", ingangsdatum: null };

/** Registreert GL4710 als relevante Gemeentelijke-Lasten-grootboek voor `bedrijfsnr` (zelfde precedent als `begrotingKetenIntegratie.test.ts`'s `zetMappings`). */
function zetGemeentelijkeLastenMapping(bedrijfsnr: string): void {
  voegPnLBronmappingMutatieToe(db, {
    bedrijfsnr,
    grootboekrekening: "4710",
    grootboekOmschrijving: null,
    ogbKostensoort: null,
    ogbKostensoortOmschrijving: null,
    economischeModule: "GEMEENTELIJKE_LASTEN",
    economischeCategorie: "GEMEENTELIJKE_LASTEN",
    geldigVanafBoekjaar: 2020,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    type: "NIEUWE_MAPPING_VANAF_PERIODE",
    vorigeMappingId: null,
    gewijzigdOp: new Date("2026-01-01T00:00:00.000Z"),
    gebruiker: "test",
    wijzigingsreden: "testfixture",
  });
}

/** Minimale, maar volledige CONCEPT-begroting — genoeg voor `leesBegrotingPnLRegels`/`leesEstimatedPnLRegels`, hoeft niet vaststelbaar te zijn. */
function bouwVersie(bedrijfsnr: string, begrotingsjaar: number, gemeentelijkeLastenBedrag: Decimal): string {
  const input: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr, begrotingsjaar, bronPeildatum: new Date(Date.UTC(begrotingsjaar - 1, 6, 31)) };
  const id = maakBegrotingsversie(db, input).id;
  schrijfModule1Snapshot(db, id, []);
  schrijfModule1Aannames(db, id, { begrotingsjaar, indexatiePercentage: D(3) });
  schrijfModule3Invoer(db, id, MODULE3);
  schrijfGeplandOnderhoudActiviteiten(db, id, []);
  schrijfGeplandOnderhoudBeoordeeld(db, id, true);
  schrijfCorrectiefDagelijksOnderhoudRegels(db, id, []);
  schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, id, true);
  schrijfVerzekeringBeoordeeld(db, id, true);
  schrijfGemeentelijkeLastenModule(db, id, { werkelijkeGemeentelijkeLasten: null, wozStijgingPercentage: null, lastenPercentageStijging: null, begrotingsPercentageOverride: null, beoordeeld: true });
  schrijfWozSetBevestigd(db, id, true);
  schrijfGemeentelijkeLastenRegels(db, id, [{ id: null, grootboekrekening: "4710", ogbKostensoort: null, jaarbedrag: gemeentelijkeLastenBedrag }]);
  schrijfGemeentelijkeLastenEstimatedVerwachting(db, id, D(0));
  schrijfAlgemeneKostenRegels(db, id, []);
  schrijfAlgemeneKostenCategorieState(db, id, Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, { beoordeeld: true, vorigJaarBedrag: null, verwachteVerhogingPercentage: null }])) as never);
  schrijfLeegstandCategorieState(db, id, Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c) => [c, { beoordeeld: true, laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null }])) as never);
  schrijfRenteCategorieState(db, id, Object.fromEntries(RENTE_CATEGORIEEN.map((c) => [c, { beoordeeld: true }])) as never);
  schrijfGeplandeVerkoopBeoordeeld(db, id, true);
  schrijfNietVerrekenbareBtwState(db, id, { beoordeeld: true, vorigJaarWerkelijk: null });
  return id;
}

function estimatedInvoer(overrides: Partial<EstimatedPnLInvoer> = {}): EstimatedPnLInvoer {
  return {
    resterendeMaanden: [7, 8, 9, 10, 11, 12],
    huur: { werkelijk: berekenWerkelijkHuur([{ economischeCategorie: "HUUROPBRENGST_BELAST", saldo: D(-1000) }]), dekkingBevestigd: true },
    beheer: { werkelijk: berekenWerkelijkBeheer([{ economischeCategorie: "BEHEERKOSTEN", saldo: D(100) }]), dekkingBevestigd: true },
    management: { werkelijk: berekenWerkelijkManagement([{ economischeCategorie: "MANAGEMENTVERGOEDING", saldo: D(3000) }]), dekkingBevestigd: true },
    onderhoud: { werkelijk: berekenWerkelijkOnderhoud([]), dekkingBevestigd: true, resterendeKwartalen: ["Q3", "Q4"] },
    verzekeringen: { werkelijk: berekenWerkelijkVerzekeringen([]), dekkingBevestigd: true, resterendeMaanden: [7, 8, 9, 10, 11, 12] },
    gemeentelijkeLasten: { werkelijk: berekenWerkelijkGemeentelijkeLasten([{ economischeCategorie: "GEMEENTELIJKE_LASTEN", complexnummer: "001", saldo: D(4000) }]), dekkingBevestigd: true },
    algemeneKosten: { werkelijk: berekenWerkelijkAlgemeneKosten([]), dekkingBevestigd: true },
    leegstand: { werkelijk: berekenWerkelijkLeegstand([], []), dekkingBevestigd: true, gemapteCategorieen: new Set(), resterendeKwartalen: ["Q3", "Q4"] },
    nietVerrekenbareBtw: { werkelijk: berekenWerkelijkNietVerrekenbareBtw([]), dekkingBevestigd: true },
    rente: {
      werkelijk: berekenWerkelijkRente([{ ogbKostensoort: "R1", saldo: D(4000) }], [{ ogbKostensoort: "R1", ogbKostensoortOmschrijving: "Rente lening", categorie: "RENTEKOSTEN" }]),
      dekkingBevestigd: true,
      gemapteCategorieen: new Set(["RENTEKOSTEN", "RENTE_OPBRENGSTEN"]),
    },
    ...overrides,
  };
}

const vind = (resultaat: ReturnType<typeof leesVergelijkendeBegrotingsPnL>, sleutel: string) => resultaat.regels.find((r) => r.regelSleutel === sleutel)!;

describe("leesVergelijkendeBegrotingsPnL — geen bestaande vorigjaarversie: Begroting vorig jaar en Estimated blijven expliciet onbekend (nooit gereconstrueerd)", () => {
  it("begrotingVorigJaar en estimated zijn null op resultaat- en regelniveau; Werkelijk en Jouw begroting blijven wel gevuld", () => {
    zetGemeentelijkeLastenMapping("070");
    const nieuweId = bouwVersie("070", 2027, D(2000));
    const werkelijk = berekenPnLPeriode({ bedrijfsnr: "070", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() }, [], []).resultaat;
    const resultaat = leesVergelijkendeBegrotingsPnL(db, { nieuweVersieId: nieuweId, vorigJaarVersieId: null }, werkelijk, estimatedInvoer());

    expect(resultaat.begrotingVorigJaar).toBeNull();
    expect(resultaat.estimated).toBeNull();
    expect(resultaat.werkelijk.waardesoort).toBe("WERKELIJK");
    expect(resultaat.jouwBegroting.waardesoort).toBe("BEGROTING_NIEUW_JAAR");

    const gl = vind(resultaat, "GEMEENTELIJKE_LASTEN");
    expect(gl.begrotingVorigJaar).toBeNull();
    expect(gl.estimated).toBeNull();
    expect(gl.jouwBegroting).toEqual({ status: "BEKEND", bedrag: D(2000) });
  });
});

describe("leesVergelijkendeBegrotingsPnL — met bestaande vorigjaarversie: alle vier kolommen gevuld, Actual exact éénmaal", () => {
  it("Gemeentelijke lasten: begrotingVorigJaar=1800 (vorig jaar), estimated=4000+0=4000 (Werkelijk uit estimatedInvoer, geen resterende verwachting geschreven -> 0 default gemeentelijkeLastenEstimated), jouwBegroting=2500 (nieuw concept)", () => {
    zetGemeentelijkeLastenMapping("070");
    const vorigId = bouwVersie("070", 2026, D(1800));
    const nieuweId = bouwVersie("070", 2027, D(2500));
    const werkelijk = berekenPnLPeriode({ bedrijfsnr: "070", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() }, [], []).resultaat;
    const resultaat = leesVergelijkendeBegrotingsPnL(db, { nieuweVersieId: nieuweId, vorigJaarVersieId: vorigId }, werkelijk, estimatedInvoer());

    const gl = vind(resultaat, "GEMEENTELIJKE_LASTEN");
    expect(gl.begrotingVorigJaar).toEqual({ status: "BEKEND", bedrag: D(1800) });
    expect(gl.jouwBegroting).toEqual({ status: "BEKEND", bedrag: D(2500) });
    expect(gl.estimated).not.toBeNull();
    expect(gl.estimated!.status).toBe("BEKEND");
    if (gl.estimated!.status === "BEKEND") expect(gl.estimated!.bedrag.toString()).toBe("4000"); // Werkelijk (4000) + geen resterende verwachting geschreven (0 default)
  });

  it("Rentekosten: Werkelijk komt via de bewezen bronproef-vorm (OGB-classificatie) exact éénmaal door, ongewijzigd tussen Werkelijk- en Estimated-kolom", () => {
    zetGemeentelijkeLastenMapping("070");
    const vorigId = bouwVersie("070", 2026, D(1800));
    const nieuweId = bouwVersie("070", 2027, D(2500));
    const werkelijk = berekenPnLPeriode({ bedrijfsnr: "070", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() }, [], []).resultaat;
    const resultaat = leesVergelijkendeBegrotingsPnL(db, { nieuweVersieId: nieuweId, vorigJaarVersieId: vorigId }, werkelijk, estimatedInvoer());

    const rente = vind(resultaat, "RENTEKOSTEN");
    expect(rente.werkelijk?.status).toBe("ONBEKEND"); // werkelijkResultaat hier is een lege periode zonder boekingen/mapping -> nooit €0
    expect(rente.estimated).not.toBeNull();
    if (rente.estimated!.status === "BEKEND") expect(rente.estimated!.bedrag.toString()).toBe("4000"); // uit estimatedInvoer().rente (los aangeleverd Werkelijk voor Estimated), geen resterende verwachting geschreven
  });

  it("Voorstel: automatisch voor Beheer/Verzekeringen/Gemeentelijke lasten (= de berekende Jouw-begroting-waarde); 'Handmatig opgebouwd' voor Rente en Onderhoud", () => {
    zetGemeentelijkeLastenMapping("070");
    const vorigId = bouwVersie("070", 2026, D(1800));
    const nieuweId = bouwVersie("070", 2027, D(2500));
    const werkelijk = berekenPnLPeriode({ bedrijfsnr: "070", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() }, [], []).resultaat;
    const resultaat = leesVergelijkendeBegrotingsPnL(db, { nieuweVersieId: nieuweId, vorigJaarVersieId: vorigId }, werkelijk, estimatedInvoer());

    expect(vind(resultaat, "GEMEENTELIJKE_LASTEN").voorstel).toEqual({ type: "BEDRAG", bedrag: D(2500) });
    expect(vind(resultaat, "BEHEERKOSTEN").voorstel).toEqual({ type: "BEDRAG", bedrag: D(0) });
    expect(vind(resultaat, "RENTEKOSTEN").voorstel).toEqual({ type: "HANDMATIG" });
    expect(vind(resultaat, "ONDERHOUD").voorstel).toEqual({ type: "HANDMATIG" });
  });
});

describe("bouwEstimatedPnLInvoer — assembleert EstimatedPnLInvoer uit een echte berekenPnLPeriode-Werkelijk-ophaal, zonder Werkelijk opnieuw te berekenen", () => {
  it("de Rente-Werkelijk-waarde in de gebouwde invoer is bit-voor-bit dezelfde Decimal-instantie/waarde als in moduleWerkelijk", () => {
    const boekingen: PnLRuweBoekingRegel[] = [{ grootboekrekening: "4600", ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening", complexnummer: null, saldo: D(1200) }];
    const mapping: PnLBronmappingRegel[] = [
      {
        bedrijfsnr: "070",
        grootboekrekening: "4600",
        ogbKostensoort: "4601",
        economischeModule: "RENTE",
        economischeCategorie: "RENTEKOSTEN",
        geldigVanafBoekjaar: 2020,
        geldigVanafPeriode: "01",
        geldigTotBoekjaar: null,
        geldigTotPeriode: null,
        aangemaaktOp: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    const periode = berekenPnLPeriode({ bedrijfsnr: "070", boekjaar: 2026, boekperiode: "06", opSysteemtijdstip: new Date() }, boekingen, mapping);
    const invoer = bouwEstimatedPnLInvoer(periode.moduleWerkelijk, bepaalResterendeMaanden("06"), bepaalResterendeKwartalen("06"));

    expect(invoer.rente.werkelijk).toBe(periode.moduleWerkelijk.rente.werkelijk); // exact dezelfde referentie -> geen herberekening
    expect(invoer.rente.dekkingBevestigd).toBe(true);
    expect(invoer.rente.gemapteCategorieen?.has("RENTEKOSTEN")).toBe(true);
    expect(invoer.onderhoud.resterendeKwartalen).toEqual(["Q3", "Q4"]);
    expect(invoer.resterendeMaanden).toEqual([7, 8, 9, 10, 11, 12]);
  });
});

describe("bepaalResterendeMaanden / bepaalResterendeKwartalen", () => {
  it("augustus (08): resterende maanden 9-12, resterende kwartalen Q3/Q4 (nog niet volledig afgesloten)", () => {
    expect(bepaalResterendeMaanden("08")).toEqual([9, 10, 11, 12]);
    expect(bepaalResterendeKwartalen("08")).toEqual(["Q3", "Q4"]);
  });

  it("december (12): geen enkele maand of kwartaal resteert", () => {
    expect(bepaalResterendeMaanden("12")).toEqual([]);
    expect(bepaalResterendeKwartalen("12")).toEqual([]);
  });
});
