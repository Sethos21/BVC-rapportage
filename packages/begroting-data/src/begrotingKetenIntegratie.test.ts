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
  berekenPnLBoom,
  berekenWerkelijkAlgemeneKosten,
  berekenWerkelijkBeheer,
  berekenWerkelijkHuur,
  berekenWerkelijkLeegstand,
  berekenWerkelijkManagement,
  berekenWerkelijkGemeentelijkeLasten,
  berekenWerkelijkOnderhoud,
  berekenWerkelijkVerzekeringen,
  vergelijkPnLResultaten,
  type BgManagementInvoer,
  type PurePnLBovenEbitdaRegel,
} from "@bvc/reporting";
import { schrijfAlgemeneKostenCategorieState } from "./algemeneKostenCategorieState.js";
import { schrijfAlgemeneKostenEstimatedVerwachting } from "./algemeneKostenEstimatedVerwachting.js";
import { schrijfAlgemeneKostenRegels } from "./algemeneKostenRegels.js";
import { leesBegrotingPnLRegels, leesEstimatedPnLRegels, type EstimatedPnLInvoer } from "./begrotingPnL.js";
import { leesBegrotingsversie, maakBegrotingsversie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { schrijfCorrectiefDagelijksOnderhoudBeoordeeld } from "./correctiefDagelijksOnderhoudBeoordeeld.js";
import { schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen } from "./correctiefDagelijksOnderhoudEstimated.js";
import { schrijfCorrectiefDagelijksOnderhoudRegels } from "./correctiefDagelijksOnderhoudRegels.js";
import { openOrCreateDatabase } from "./database.js";
import { schrijfGemeentelijkeLastenEstimatedVerwachting } from "./gemeentelijkeLastenEstimated.js";
import { schrijfGemeentelijkeLastenModule, schrijfWozSetBevestigd } from "./gemeentelijkeLastenModule.js";
import { schrijfGemeentelijkeLastenRegels } from "./gemeentelijkeLastenRegels.js";
import { neemWozVoorstelOver } from "./gemeentelijkeLastenVoorstelOvername.js";
import { schrijfGeplandeVerkoopBeoordeeld } from "./geplandeVerkoopBeoordeeld.js";
import { schrijfGeplandOnderhoudActiviteiten } from "./geplandOnderhoudActiviteiten.js";
import { schrijfGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";
import { schrijfGeplandOnderhoudEstimatedVerwachtingen } from "./geplandOnderhoudEstimated.js";
import { schrijfLeegstandCategorieState } from "./leegstandCategorieState.js";
import { schrijfLeegstandEstimatedVerwachting, type LeegstandEstimatedVerwachting } from "./leegstandEstimated.js";
import { schrijfLeegstandRegels } from "./leegstandRegels.js";
import { schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Snapshot } from "./module1Snapshot.js";
import { schrijfModule2Config } from "./module2Config.js";
import { schrijfModule3Invoer } from "./module3Invoer.js";
import { voegPnLBronmappingMutatieToe, type PnLBronmappingMutatieInvoer } from "./pnlBronmappingRepository.js";
import { schrijfRenteCategorieState } from "./renteCategorieState.js";
import { stelBegrotingVast } from "./vaststellen.js";
import { schrijfVerzekeringBeoordeeld } from "./verzekeringBeoordeeld.js";
import { schrijfWozObjecten } from "./wozObjecten.js";

/**
 * VERVOLGTRANCHE 6, DEEL C — gezamenlijke ketenintegratie: Begroting (concept én vastgesteld) en Estimated door de
 * pure P&L-engine, met de harde invarianten: GL-regelpost ≠ WOZ-voorstel, Actual exact éénmaal, onbekend nooit €0,
 * subtotalen uitsluitend afgeleid, vastgestelde Begroting immutable terwijl Estimated wijzigbaar blijft,
 * administratiegebonden mappings zonder 070-hardcoding. Bedragen zijn expliciet gemarkeerde testfixtures.
 */

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-keten-"));
  db = openOrCreateDatabase(join(dir, "begrotingen.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const D = (n: string | number) => new Decimal(n);
const MODULE3: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: D(500), eenheid: "MAAND", ingangsdatum: null };
const versieInput = (bedrijfsnr: string): NieuweBegrotingsversieInput => ({ originType: "NIEUW", bedrijfsnr, begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) });

function mapping(overrides: Partial<PnLBronmappingMutatieInvoer>): PnLBronmappingMutatieInvoer {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4710",
    grootboekOmschrijving: null,
    ogbKostensoort: null,
    ogbKostensoortOmschrijving: null,
    economischeModule: "GEMEENTELIJKE_LASTEN",
    economischeCategorie: "GEMEENTELIJKE_LASTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    type: "NIEUWE_MAPPING_VANAF_PERIODE",
    vorigeMappingId: null,
    gewijzigdOp: new Date("2026-09-14T00:00:00.000Z"),
    gebruiker: "test",
    wijzigingsreden: "testfixture",
    ...overrides,
  };
}

/** 070-achtig: twee relevante GL's. 003-achtig: één GL4701. De ketencode kent geen van beide. */
function zetMappings(): void {
  voegPnLBronmappingMutatieToe(db, mapping({ grootboekrekening: "4700", ogbKostensoort: "4701" }));
  voegPnLBronmappingMutatieToe(db, mapping({ grootboekrekening: "4710" }));
  voegPnLBronmappingMutatieToe(db, mapping({ bedrijfsnr: "003", grootboekrekening: "4701" }));
}

interface OpzetOpties {
  glRegelBedrag?: Decimal | null;
  akBeoordeeld?: boolean;
  wozBevestigd?: boolean;
  metWoz?: boolean;
}

/** Volledig vaststelbare begroting; Onderhoud met 1 activiteit + 1 correctief-regel, Algemene kosten met regels per post. */
function bouwVersie(bedrijfsnr: string, opties: OpzetOpties = {}) {
  const { glRegelBedrag = D(2000), akBeoordeeld = true, wozBevestigd = true, metWoz = true } = opties;
  const glGl = bedrijfsnr === "003" ? "4701" : "4710";
  const versie = maakBegrotingsversie(db, versieInput(bedrijfsnr));
  const id = versie.id;
  schrijfModule1Snapshot(db, id, []);
  schrijfModule1Aannames(db, id, { begrotingsjaar: 2027, indexatiePercentage: D(3) });
  schrijfModule3Invoer(db, id, MODULE3);
  const activiteit = schrijfGeplandOnderhoudActiviteiten(db, id, [
    { id: null, complexnummer: "001", omschrijving: "Dak", grootboekrekening: "4300", ogbKostensoort: null, aanleidingType: "MJOP", aanleidingToelichting: "MJOP 2027", q1: D(1000), q2: D(1000), q3: D(1000), q4: D(1000), status: "GEPLAND", leverancier: null, offertebedrag: null, notitie: null },
  ])[0]!;
  schrijfGeplandOnderhoudBeoordeeld(db, id, true);
  const correctief = schrijfCorrectiefDagelijksOnderhoudRegels(db, id, [{ id: null, omschrijving: "Klein", complexnummer: null, grootboekrekening: "4300", ogbKostensoort: null, jaarbedrag: D(500) }])[0]!;
  schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, id, true);
  schrijfVerzekeringBeoordeeld(db, id, true);
  if (metWoz) {
    schrijfWozObjecten(db, id, [{ id: null, complexnummer: "001", objectType: "GEHEEL_COMPLEX", unitnummer: null, aanslagjaar: 2026, waardepeildatum: new Date(Date.UTC(2026, 0, 1)), werkelijkeWoz: D(1000000), verwachteWozOverride: null }]);
    schrijfGemeentelijkeLastenModule(db, id, { werkelijkeGemeentelijkeLasten: D(9000), wozStijgingPercentage: D(10), lastenPercentageStijging: D(5), begrotingsPercentageOverride: null, beoordeeld: true });
    schrijfWozSetBevestigd(db, id, wozBevestigd);
  } else {
    schrijfGemeentelijkeLastenModule(db, id, { werkelijkeGemeentelijkeLasten: null, wozStijgingPercentage: null, lastenPercentageStijging: null, begrotingsPercentageOverride: null, beoordeeld: true });
  }
  schrijfGemeentelijkeLastenRegels(db, id, glRegelBedrag === null ? [] : [{ id: null, grootboekrekening: glGl, ogbKostensoort: null, jaarbedrag: glRegelBedrag }]);
  schrijfAlgemeneKostenRegels(db, id, [
    { id: null, categorie: "ACCOUNTANT", ogbKostensoortCode: null, omschrijving: "Jaarrekening", complexnummer: null, jaarbedrag: D(4000) },
    { id: null, categorie: "MAKELAARSKOSTEN", ogbKostensoortCode: null, omschrijving: "Taxatie", complexnummer: null, jaarbedrag: D(2500) },
    { id: null, categorie: "BANKKOSTEN", ogbKostensoortCode: null, omschrijving: "Bank", complexnummer: null, jaarbedrag: D(300) },
  ]);
  schrijfAlgemeneKostenCategorieState(db, id, Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, { beoordeeld: akBeoordeeld, vorigJaarBedrag: null, verwachteVerhogingPercentage: null }])) as never);
  schrijfLeegstandCategorieState(db, id, Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c) => [c, { beoordeeld: true, laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null }])) as never);
  schrijfRenteCategorieState(db, id, Object.fromEntries(RENTE_CATEGORIEEN.map((c) => [c, { beoordeeld: true }])) as never);
  schrijfGeplandeVerkoopBeoordeeld(db, id, true);
  // Leegstandskosten: bewust beoordeeld zonder regels (bewuste €0-begroting) en een bewuste resterende verwachting €0 voor Q3 en Q4.
  schrijfLeegstandEstimatedVerwachting(db, id, leegstandVerwachting({}));
  return { id, activiteitId: activiteit.id, correctiefId: correctief.id };
}

const regelWaarde = (regels: readonly PurePnLBovenEbitdaRegel[], sleutel: string) => regels.find((r) => r.regelSleutel === sleutel)!.waarde;
const bedrag = (regels: readonly PurePnLBovenEbitdaRegel[], sleutel: string): string => {
  const w = regelWaarde(regels, sleutel);
  return w.status === "ONBEKEND" ? "ONBEKEND" : w.bedrag.toString();
};
const serialiseer = (regels: readonly PurePnLBovenEbitdaRegel[]) => JSON.stringify(regels.map((r) => [r.regelSleutel, r.groep, r.waarde.status, r.waarde.status === "ONBEKEND" ? r.waarde.dekkingReden : r.waarde.bedrag.toString()]));

const LEEGSTAND_NUL = { q1: null, q2: null, q3: D(0), q4: D(0) };
function leegstandVerwachting(o: Partial<Record<"NUTS_LEEGSTAND" | "SERVICEKOSTEN_LEEGSTAND" | "OVERIGE_LEEGSTANDSKOSTEN", { q1: Decimal | null; q2: Decimal | null; q3: Decimal | null; q4: Decimal | null }>>): LeegstandEstimatedVerwachting {
  return { NUTS_LEEGSTAND: LEEGSTAND_NUL, SERVICEKOSTEN_LEEGSTAND: LEEGSTAND_NUL, OVERIGE_LEEGSTANDSKOSTEN: LEEGSTAND_NUL, ...o };
}

/** Werkelijk t/m afgesloten periode (testfixture): Onderhoud 3000 (Gebouwen), Verzekeringen 700, Gemeentelijke lasten 4000, Accountant 1000. */
function estimatedInvoer(overrides: Partial<EstimatedPnLInvoer> = {}): EstimatedPnLInvoer {
  return {
    resterendeMaanden: [7, 8, 9, 10, 11, 12],
    huur: { werkelijk: berekenWerkelijkHuur([{ economischeCategorie: "HUUROPBRENGST_BELAST", saldo: D(-1000) }]), dekkingBevestigd: true },
    beheer: { werkelijk: berekenWerkelijkBeheer([{ economischeCategorie: "BEHEERKOSTEN", saldo: D(100) }]), dekkingBevestigd: true },
    management: { werkelijk: berekenWerkelijkManagement([{ economischeCategorie: "MANAGEMENTVERGOEDING", saldo: D(3000) }]), dekkingBevestigd: true },
    onderhoud: { werkelijk: berekenWerkelijkOnderhoud([{ economischeCategorie: "ONDERHOUD_GEBOUWEN", complexnummer: "001", saldo: D(3000) }]), dekkingBevestigd: true, resterendeKwartalen: ["Q3", "Q4"] },
    verzekeringen: { werkelijk: berekenWerkelijkVerzekeringen([{ economischeCategorie: "BRAND_OPSTALVERZEKERING", complexnummer: "001", saldo: D(700) }]), dekkingBevestigd: true, resterendeMaanden: [7, 8, 9, 10, 11, 12] },
    gemeentelijkeLasten: { werkelijk: berekenWerkelijkGemeentelijkeLasten([{ economischeCategorie: "GEMEENTELIJKE_LASTEN", complexnummer: "001", saldo: D(4000) }]), dekkingBevestigd: true },
    algemeneKosten: { werkelijk: berekenWerkelijkAlgemeneKosten([{ economischeCategorie: "ACCOUNTANT", saldo: D(1000) }]), dekkingBevestigd: true },
    leegstand: {
      werkelijk: berekenWerkelijkLeegstand([{ ogbKostensoort: "N1", complexnummer: "001", saldo: D(60) }], [{ ogbKostensoort: "N1", ogbKostensoortOmschrijving: "Nuts", categorie: "NUTS_LEEGSTAND" }]),
      dekkingBevestigd: true,
      gemapteCategorieen: new Set(["NUTS_LEEGSTAND", "SERVICEKOSTEN_LEEGSTAND", "OVERIGE_LEEGSTANDSKOSTEN"]),
      resterendeKwartalen: ["Q3", "Q4"],
    },
    ...overrides,
  };
}

describe("Begroting → P&L: Gemeentelijke lasten gebruikt de GL-regelpost, niet het WOZ-voorstel", () => {
  it("1. WOZ-voorstel (10.395) is NIET de P&L-begrotingspost: de P&L toont de som van de GL-regels (2.000)", () => {
    zetMappings();
    const { id } = bouwVersie("070", { glRegelBedrag: D(2000) });
    const regels = leesBegrotingPnLRegels(db, id);
    expect(bedrag(regels, "GEMEENTELIJKE_LASTEN")).toBe("2000");
  });

  it("2. één relevante GL: 'Voorstel overnemen' zet het volledige voorstel op die GL en de P&L volgt (10.395); daarvoor was de post 0 of eigen invoer", () => {
    zetMappings();
    const { id } = bouwVersie("003", { glRegelBedrag: null });
    expect(bedrag(leesBegrotingPnLRegels(db, id), "GEMEENTELIJKE_LASTEN")).toBe("0"); // bewust beoordeeld, geen regels → bekende €0 (geen voorstel gebruikt)
    neemWozVoorstelOver(db, id);
    expect(bedrag(leesBegrotingPnLRegels(db, id), "GEMEENTELIJKE_LASTEN")).toBe("10395");
  });

  it("3. meerdere relevante GL's: geen automatische verdeling; de P&L-post blijft wat de gebruiker per GL invulde", () => {
    zetMappings();
    const { id } = bouwVersie("070", { glRegelBedrag: null });
    expect(() => neemWozVoorstelOver(db, id)).toThrow(/MEERDERE_RELEVANTE_GLS/);
    schrijfGemeentelijkeLastenRegels(db, id, [
      { id: null, grootboekrekening: "4700", ogbKostensoort: "4701", jaarbedrag: D(8000) },
      { id: null, grootboekrekening: "4710", ogbKostensoort: null, jaarbedrag: D(1500) },
    ]);
    expect(bedrag(leesBegrotingPnLRegels(db, id), "GEMEENTELIJKE_LASTEN")).toBe("9500");
  });

  it("4. het verschil met het voorstel is een waarschuwing en blokkeert vaststellen niet; de bevroren P&L-post blijft de GL-regelpost", () => {
    zetMappings();
    const { id } = bouwVersie("070", { glRegelBedrag: D(2000) });
    expect(() => stelBegrotingVast(db, id, new Date(Date.UTC(2026, 8, 25)))).not.toThrow();
    expect(bedrag(leesBegrotingPnLRegels(db, id), "GEMEENTELIJKE_LASTEN")).toBe("2000");
  });

  it("5. onbevestigde WOZ-set blijft vaststellen blokkeren én de post is in de concept-P&L ONBEKEND (kritiek), niet €0", () => {
    zetMappings();
    const { id } = bouwVersie("070", { wozBevestigd: false });
    expect(() => stelBegrotingVast(db, id)).toThrow(/KRITIEKE controls/);
    expect(bedrag(leesBegrotingPnLRegels(db, id), "GEMEENTELIJKE_LASTEN")).toBe("ONBEKEND");
  });

  it("6. administraties zonder WOZ-objecten: bestaand bewuste-€0-pad — vaststelbaar en een bekende post", () => {
    zetMappings();
    const { id } = bouwVersie("003", { metWoz: false, glRegelBedrag: D(1234) });
    stelBegrotingVast(db, id, new Date(Date.UTC(2026, 8, 25)));
    expect(bedrag(leesBegrotingPnLRegels(db, id), "GEMEENTELIJKE_LASTEN")).toBe("1234");
  });
});

describe("Begroting → P&L: onbekend is nooit €0; subtotalen zijn uitsluitend afgeleid", () => {
  it("7. Algemene kosten: een niet-beoordeelde post is ONBEKEND (concept) terwijl de overige posten bekend blijven; bewust €0 blijft een bekende €0", () => {
    zetMappings();
    const { id } = bouwVersie("070", { akBeoordeeld: false });
    schrijfAlgemeneKostenCategorieState(db, id, Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, { beoordeeld: c !== "BANKKOSTEN", vorigJaarBedrag: null, verwachteVerhogingPercentage: null }])) as never);
    const regels = leesBegrotingPnLRegels(db, id);
    expect(bedrag(regels, "BANKKOSTEN")).toBe("ONBEKEND");
    expect(bedrag(regels, "ACCOUNTANT")).toBe("4000");
    expect(bedrag(regels, "JURIDISCHE_KOSTEN")).toBe("0"); // beoordeeld zonder regels = bewuste, bekende €0
    const boom = berekenPnLBoom("BEGROTING_NIEUW_JAAR", regels);
    expect(boom.algemeneKosten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(boom.algemeneKosten.besteWetenSom.toString()).toBe("6500"); // onbekende post telt niet als 0 mee, wordt gemeld
  });

  it("8. Onderhoud Begroting = Gepland + Correctief (exact één regel, geen dubbele telling); hele boom: kosten/EBITDA uitsluitend door de engine berekend", () => {
    zetMappings();
    const { id } = bouwVersie("070");
    const regels = leesBegrotingPnLRegels(db, id);
    expect(regels.filter((r) => r.regelSleutel === "ONDERHOUD")).toHaveLength(1);
    expect(bedrag(regels, "ONDERHOUD")).toBe("4500"); // 4000 gepland + 500 correctief
    const boom = berekenPnLBoom("BEGROTING_NIEUW_JAAR", regels);
    // Exploitatie: onderhoud 4500 + verzekeringen 0 + gemeentelijke lasten 2000. Management en beheer: beheer 0 + management 6000.
    expect(boom.exploitatieLasten.besteWetenSom.toString()).toBe("6500");
    expect(boom.managementEnBeheer.besteWetenSom.toString()).toBe("6000");
    expect(boom.algemeneKosten.besteWetenSom.toString()).toBe("6800");
    expect(boom.totaalKosten.besteWetenSom.toString()).toBe("19300");
    expect(boom.ebitda.bedrag.toString()).toBe(boom.totaalOpbrengsten.besteWetenSom.minus(boom.totaalKosten.besteWetenSom).toString());
    expect(boom.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("9. levenscyclus-pariteit: de P&L-regels van het concept zijn identiek aan die van dezelfde begroting na vaststellen (bevroren gelezen)", () => {
    zetMappings();
    const { id } = bouwVersie("070");
    const voor = serialiseer(leesBegrotingPnLRegels(db, id));
    stelBegrotingVast(db, id, new Date(Date.UTC(2026, 8, 25)));
    expect(leesBegrotingsversie(db, id)!.status).toBe("VASTGESTELD");
    expect(serialiseer(leesBegrotingPnLRegels(db, id))).toBe(voor);
  });
});

describe("Estimated → P&L: Werkelijk exact éénmaal; Estimated muteert de vastgestelde Begroting niet", () => {
  function zetVerwachtingen(id: string, activiteitId: number, correctiefId: number, factor: number): void {
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, id, [{ activiteitId, q1: D(0), q2: D(0), q3: D(500 * factor), q4: D(500 * factor) }]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, id, [{ regelId: correctiefId, resterendBedrag: D(100 * factor) }]);
    schrijfGemeentelijkeLastenEstimatedVerwachting(db, id, D(0));
    schrijfAlgemeneKostenEstimatedVerwachting(db, id, { ACCOUNTANT: D(500 * factor), ALGEMENE_KOSTEN: D(0), JURIDISCHE_KOSTEN: D(0), MAKELAARSKOSTEN: D(0), BANKKOSTEN: D(0) });
  }

  it("10. Onderhoud Actual exact éénmaal: Estimated = Werkelijk moduleTotaal (3000) + resterend Gepland (1000) + resterend Correctief (100) = 4100 — Begroting (4500) wordt niet opgeteld", () => {
    zetMappings();
    const { id, activiteitId, correctiefId } = bouwVersie("070");
    zetVerwachtingen(id, activiteitId, correctiefId, 1);
    const regels = leesEstimatedPnLRegels(db, id, estimatedInvoer());
    expect(bedrag(regels, "ONDERHOUD")).toBe("4100");
  });

  it("11. Algemene kosten Estimated: Werkelijk éénmaal per post + handmatige verwachting; niet-ingevulde posten blijven ONBEKEND (nooit €0)", () => {
    zetMappings();
    const { id, activiteitId, correctiefId } = bouwVersie("070");
    zetVerwachtingen(id, activiteitId, correctiefId, 1);
    let regels = leesEstimatedPnLRegels(db, id, estimatedInvoer());
    expect(bedrag(regels, "ACCOUNTANT")).toBe("1500"); // 1000 werkelijk + 500
    expect(bedrag(regels, "BANKKOSTEN")).toBe("0"); // 0 werkelijk + bewuste 0
    schrijfAlgemeneKostenEstimatedVerwachting(db, id, { ACCOUNTANT: D(500), ALGEMENE_KOSTEN: null, JURIDISCHE_KOSTEN: null, MAKELAARSKOSTEN: null, BANKKOSTEN: null });
    regels = leesEstimatedPnLRegels(db, id, estimatedInvoer());
    expect(bedrag(regels, "ALGEMENE_KOSTEN")).toBe("ONBEKEND");
    expect(bedrag(regels, "ACCOUNTANT")).toBe("1500");
  });

  it("12. Gemeentelijke lasten Estimated: afwijking t.o.v. de GL-regelpost (2000), niet t.o.v. het WOZ-voorstel; onbevestigde Werkelijk-dekking = onbekend", () => {
    zetMappings();
    const { id, activiteitId, correctiefId } = bouwVersie("070");
    zetVerwachtingen(id, activiteitId, correctiefId, 1);
    const regels = leesEstimatedPnLRegels(db, id, estimatedInvoer());
    expect(bedrag(regels, "GEMEENTELIJKE_LASTEN")).toBe("4000"); // 4000 werkelijk + bewuste 0
    const onbevestigd = leesEstimatedPnLRegels(db, id, estimatedInvoer({ gemeentelijkeLasten: { werkelijk: berekenWerkelijkGemeentelijkeLasten([]), dekkingBevestigd: false } }));
    expect(bedrag(onbevestigd, "GEMEENTELIJKE_LASTEN")).toBe("ONBEKEND");
  });

  it("13. Onderhoud zonder vastgelegde resterende verwachting of met onbevestigde dekking: ONBEKEND, niet stil laag/€0", () => {
    zetMappings();
    const { id } = bouwVersie("070");
    expect(bedrag(leesEstimatedPnLRegels(db, id, estimatedInvoer()), "ONDERHOUD")).toBe("ONBEKEND"); // geen verwachtingen vastgelegd
    const { activiteitId, correctiefId } = { activiteitId: leesActiviteitId(id), correctiefId: leesCorrectiefId(id) };
    zetVerwachtingen(id, activiteitId, correctiefId, 1);
    const onbevestigd = leesEstimatedPnLRegels(db, id, estimatedInvoer({ onderhoud: { ...estimatedInvoer().onderhoud, dekkingBevestigd: false } }));
    expect(bedrag(onbevestigd, "ONDERHOUD")).toBe("ONBEKEND");
  });

  it("14. Huur, Beheer en Management Estimated zijn gebouwd: Werkelijk + resterende maanden uit de Begroting (Management 3.000 + 6 × 500 = 6.000; Beheer 100 + 0 = 100; Huur 1.000 + 0 = 1.000)", () => {
    zetMappings();
    const { id, activiteitId, correctiefId } = bouwVersie("070");
    zetVerwachtingen(id, activiteitId, correctiefId, 1);
    const regels = leesEstimatedPnLRegels(db, id, estimatedInvoer());
    expect(bedrag(regels, "MANAGEMENTVERGOEDING")).toBe("6000");
    expect(bedrag(regels, "BEHEERKOSTEN")).toBe("100");
    expect(bedrag(regels, "HUUROPBRENGST_BELAST")).toBe("1000");
    expect(bedrag(regels, "HUUROPBRENGST_ONBELAST")).toBe("0");
    expect(bedrag(regels, "VERLEENDE_HUURKORTING")).toBe("0");
  });

  it("14b. ontbrekende Management-Werkelijk-dekking (070-BRONGAT) houdt Management ONBEKEND en Management-en-beheer/EBITDA ONVOLLEDIG — de overige posten blijven bekend", () => {
    zetMappings();
    const { id, activiteitId, correctiefId } = bouwVersie("070");
    zetVerwachtingen(id, activiteitId, correctiefId, 1);
    const invoer = estimatedInvoer();
    const zonderManagement = leesEstimatedPnLRegels(db, id, { ...invoer, management: { ...invoer.management, dekkingBevestigd: false } });
    expect(bedrag(zonderManagement, "MANAGEMENTVERGOEDING")).toBe("ONBEKEND");
    expect(bedrag(zonderManagement, "BEHEERKOSTEN")).toBe("100");
    const boom = berekenPnLBoom("ESTIMATED", zonderManagement);
    expect(boom.managementEnBeheer.volledigheid.status).toBe("ONVOLLEDIG");
    expect(boom.managementEnBeheer.volledigheid.status === "ONVOLLEDIG" ? boom.managementEnBeheer.volledigheid.ontbrekend.map((o) => o.regelSleutel) : []).toEqual(["MANAGEMENTVERGOEDING"]);
    expect(boom.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
    // Met bevestigde dekking voor alle modules en alle verwachtingen ingevuld is Estimated-EBITDA volledig; het BRONGAT is dan de enige oorzaak geweest.
    expect(berekenPnLBoom("ESTIMATED", leesEstimatedPnLRegels(db, id, invoer)).ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("14c. Huur/Beheer/Management Estimated volgen de Begroting van de versie: na vaststellen uit de bevroren output, en muteren die niet", () => {
    zetMappings();
    const { id, activiteitId, correctiefId } = bouwVersie("070");
    zetVerwachtingen(id, activiteitId, correctiefId, 1);
    const concept = serialiseer(leesEstimatedPnLRegels(db, id, estimatedInvoer()));
    stelBegrotingVast(db, id, new Date(Date.UTC(2026, 8, 25)));
    expect(serialiseer(leesEstimatedPnLRegels(db, id, estimatedInvoer()))).toBe(concept);
  });

  it("15. Estimated muteert de vastgestelde Begroting niet: na vaststellen blijven de Begroting-P&L-regels byte-identiek terwijl Estimated meebeweegt", () => {
    zetMappings();
    const { id, activiteitId, correctiefId } = bouwVersie("070");
    stelBegrotingVast(db, id, new Date(Date.UTC(2026, 8, 25)));
    const begrotingVoor = serialiseer(leesBegrotingPnLRegels(db, id));
    zetVerwachtingen(id, activiteitId, correctiefId, 1);
    const est1 = serialiseer(leesEstimatedPnLRegels(db, id, estimatedInvoer()));
    zetVerwachtingen(id, activiteitId, correctiefId, 3); // Estimated blijft wijzigbaar na vaststellen
    const est2 = serialiseer(leesEstimatedPnLRegels(db, id, estimatedInvoer()));
    expect(est2).not.toBe(est1);
    expect(serialiseer(leesBegrotingPnLRegels(db, id))).toBe(begrotingVoor);
    expect(leesBegrotingsversie(db, id)!.status).toBe("VASTGESTELD");
  });

  it("16. Begroting en Estimated naast elkaar in de engine: verschil wordt afgeleid; volledig bij volledige dekking, onvolledig zodra één benodigde post onbekend is", () => {
    zetMappings();
    const { id, activiteitId, correctiefId } = bouwVersie("070");
    zetVerwachtingen(id, activiteitId, correctiefId, 1);
    const begroting = berekenPnLBoom("BEGROTING_NIEUW_JAAR", leesBegrotingPnLRegels(db, id));
    const estimated = berekenPnLBoom("ESTIMATED", leesEstimatedPnLRegels(db, id, estimatedInvoer()));
    const v = vergelijkPnLResultaten(estimated, begroting);
    expect(v.algemeneKosten.afwijking.toString()).toBe(begroting.algemeneKosten.besteWetenSom.minus(estimated.algemeneKosten.besteWetenSom).toString());
    expect(v.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
    const invoer = estimatedInvoer();
    const metGat = berekenPnLBoom("ESTIMATED", leesEstimatedPnLRegels(db, id, { ...invoer, management: { ...invoer.management, dekkingBevestigd: false } }));
    expect(vergelijkPnLResultaten(metGat, begroting).ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });

  function leesActiviteitId(versieId: string): number {
    return (db.prepare(`SELECT id FROM begroting_gepland_onderhoud_activiteit WHERE begroting_versie_id = ?`).get(versieId) as { id: number }).id;
  }
  function leesCorrectiefId(versieId: string): number {
    return (db.prepare(`SELECT id FROM begroting_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = ?`).get(versieId) as { id: number }).id;
  }
});

describe("Administratiegebonden: geen administratie-070-hardcoding", () => {
  it("17. dezelfde code, twee administraties met verschillende GL-sets: 003 (één GL4701) en 070 (4700+4710) geven elk hun eigen relevante-GL-uitkomst; een 070-GL bij 003 wordt ONBEKEND (kritiek)", () => {
    zetMappings();
    const a070 = bouwVersie("070", { glRegelBedrag: D(2000) });
    const a003 = bouwVersie("003", { glRegelBedrag: D(700) });
    expect(bedrag(leesBegrotingPnLRegels(db, a070.id), "GEMEENTELIJKE_LASTEN")).toBe("2000");
    expect(bedrag(leesBegrotingPnLRegels(db, a003.id), "GEMEENTELIJKE_LASTEN")).toBe("700");
    schrijfGemeentelijkeLastenRegels(db, a003.id, [{ id: null, grootboekrekening: "4710", ogbKostensoort: null, jaarbedrag: D(700) }]); // 070-GL bij 003
    expect(bedrag(leesBegrotingPnLRegels(db, a003.id), "GEMEENTELIJKE_LASTEN")).toBe("ONBEKEND");
  });

  it("18. een niet-bestaande versie faalt; niets in de keten schrijft (geen Estimated-rijen door lezen)", () => {
    expect(() => leesBegrotingPnLRegels(db, "bestaat-niet")).toThrow(/bestaat niet/);
    zetMappings();
    const { id } = bouwVersie("070");
    leesBegrotingPnLRegels(db, id);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM begroting_gemeentelijke_lasten_estimated_verwachting`).get() as { n: number }).n).toBe(0);
  });
});


describe("Estimated Algemene kosten: per-categorie mappingdekking (Accountant/Juridisch zonder bewezen mapping blijven ONBEKEND)", () => {
  it("22. met gemapteCategorieen zonder ACCOUNTANT/JURIDISCH_KOSTEN zijn die twee posten ONBEKEND ondanks een handmatige verwachting; de gemapte posten blijven bekend; zonder de parameter blijft het gedrag ongewijzigd", () => {
    zetMappings();
    const { id, activiteitId, correctiefId } = bouwVersie("070");
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, id, [{ activiteitId, q1: D(0), q2: D(0), q3: D(500), q4: D(500) }]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, id, [{ regelId: correctiefId, resterendBedrag: D(100) }]);
    schrijfGemeentelijkeLastenEstimatedVerwachting(db, id, D(0));
    schrijfAlgemeneKostenEstimatedVerwachting(db, id, { ACCOUNTANT: D(500), ALGEMENE_KOSTEN: D(0), JURIDISCHE_KOSTEN: D(0), MAKELAARSKOSTEN: D(0), BANKKOSTEN: D(0) });
    const basis = estimatedInvoer();
    const zonder = leesEstimatedPnLRegels(db, id, basis);
    expect(bedrag(zonder, "ACCOUNTANT")).toBe("1500");
    const gemapt = new Set(["ALGEMENE_KOSTEN", "MAKELAARSKOSTEN", "BANKKOSTEN"]);
    const met = leesEstimatedPnLRegels(db, id, { ...basis, algemeneKosten: { ...basis.algemeneKosten, gemapteCategorieen: gemapt } });
    expect(bedrag(met, "ACCOUNTANT")).toBe("ONBEKEND");
    expect(bedrag(met, "JURIDISCHE_KOSTEN")).toBe("ONBEKEND");
    expect(bedrag(met, "BANKKOSTEN")).toBe("0");
    expect(berekenPnLBoom("ESTIMATED", met).algemeneKosten.volledigheid.status).toBe("ONVOLLEDIG");
  });
});

describe("Estimated Huur + Beheer + Management met echte contracten door de hele keten (Vervolgtranche 7)", () => {
  const dat = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const vs = (soort: string, jaar: number, btw = "Y") => ({ vorderingsoort: soort, bedragJaar: D(jaar), btwYn: btw });
  const contractFeit = (bedrijfsnr: string, nummer: string, o: Record<string, unknown>) => ({
    bedrijfsnr, contractnummer: nummer, huurdernummer: null, huurderNaam: null, complexnummer: "001", rentrollComponenten: [vs("01", 120000)],
    ingangsdatum: dat("2020-01-01"), einddatum: null, indexatiedatum: null, indexatieHerhalingMaanden: 12, toekomstigeKortingswijzigingen: [], ...o,
  });

  /** C1 belast 10.000/mnd (korting 1.000/mnd, +3% per augustus), C2 onbelast 5.000/mnd tot 15 september; beheer complex 001: vast 12.000 (+5% aug) + 6% variabel. */
  function zetContractenNeer(id: string, bedrijfsnr: string): void {
    schrijfModule1Snapshot(db, id, [
      contractFeit(bedrijfsnr, "C1", { rentrollComponenten: [vs("01", 120000), vs("13", -12000)], indexatiedatum: dat("2027-08-01") }),
      contractFeit(bedrijfsnr, "C2", { rentrollComponenten: [vs("01", 60000, "N")], einddatum: dat("2027-09-15") }),
    ] as never);
    schrijfModule2Config(db, id, [{ complexnummer: "001", vastBedragJaar: D(12000), vastIndexatiePercentage: D(5), vastIndexatiedatum: dat("2027-08-01"), variabelPercentage: D(6) }]);
  }
  const invoerMetContracten = () => ({
    ...estimatedInvoer(),
    huur: {
      werkelijk: berekenWerkelijkHuur([
        { economischeCategorie: "HUUROPBRENGST_BELAST", saldo: D(-60000) },
        { economischeCategorie: "HUUROPBRENGST_ONBELAST", saldo: D(-30000) },
        { economischeCategorie: "VERLEENDE_HUURKORTING", saldo: D(6000) },
      ]),
      dekkingBevestigd: true,
    },
  });

  it("19. Huur Estimated per P&L-regel: belast/onbelast gescheiden bruto + korting één keer; totaal = Werkelijk (84.000) + resterend netto (68.000 = 61.500 + 12.500 − 6.000)", () => {
    zetMappings();
    const { id, activiteitId, correctiefId } = bouwVersie("070");
    zetContractenNeer(id, "070");
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, id, [{ activiteitId, q1: D(0), q2: D(0), q3: D(500), q4: D(500) }]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, id, [{ regelId: correctiefId, resterendBedrag: D(100) }]);
    const regels = leesEstimatedPnLRegels(db, id, invoerMetContracten());
    expect(bedrag(regels, "HUUROPBRENGST_BELAST")).toBe("121500");
    expect(bedrag(regels, "HUUROPBRENGST_ONBELAST")).toBe("42500");
    expect(bedrag(regels, "VERLEENDE_HUURKORTING")).toBe("-12000");
    expect(berekenPnLBoom("ESTIMATED", regels).totaalOpbrengsten.besteWetenSom.toString()).toBe("152000");
  });

  it("20. Beheer Estimated sluit aan op de Huur-grondslag: Werkelijk 100 + resterend vast 6.250 + variabel 6% × 68.000 (C1 55.500 + C2 12.500, beide complex 001) = 10.430; vast/variabel uit de bestaande configuratie", () => {
    zetMappings();
    const { id } = bouwVersie("070");
    zetContractenNeer(id, "070");
    expect(bedrag(leesEstimatedPnLRegels(db, id, invoerMetContracten()), "BEHEERKOSTEN")).toBe("10430");
  });

  it("21. het vaststellen van de Begroting verandert Estimated Huur/Beheer/Management niet en de Estimated wijzigt de vastgestelde Begroting niet; geen 070-hardcoding (003 geeft dezelfde uitkomst)", () => {
    zetMappings();
    const a070 = bouwVersie("070");
    zetContractenNeer(a070.id, "070");
    const a003 = bouwVersie("003");
    zetContractenNeer(a003.id, "003");
    const voor070 = serialiseer(leesEstimatedPnLRegels(db, a070.id, invoerMetContracten()));
    const voor003 = serialiseer(leesEstimatedPnLRegels(db, a003.id, invoerMetContracten()));
    const begrotingVoor = serialiseer(leesBegrotingPnLRegels(db, a070.id));
    stelBegrotingVast(db, a070.id, new Date(Date.UTC(2026, 8, 25)));
    expect(serialiseer(leesEstimatedPnLRegels(db, a070.id, invoerMetContracten()))).toBe(voor070);
    expect(serialiseer(leesBegrotingPnLRegels(db, a070.id))).toBe(begrotingVoor);
    const huurRegels = (r: string) => (JSON.parse(r) as string[][]).filter((x) => ["HUUROPBRENGST_BELAST", "HUUROPBRENGST_ONBELAST", "VERLEENDE_HUURKORTING", "BEHEERKOSTEN", "MANAGEMENTVERGOEDING"].includes(x[0]!));
    expect(huurRegels(voor003)).toEqual(huurRegels(voor070));
  });
});

describe("Leegstandskosten door de hele keten: één P&L-post (Vervolgtranche 8)", () => {
  const leegstandRegels = (id: string) =>
    schrijfLeegstandRegels(db, id, [
      { id: null, categorie: "NUTS_LEEGSTAND", complexnummer: "001", complexomschrijving: "Pand A", omschrijving: "Nuts", q1: D(100), q2: D(100), q3: D(100), q4: D(100) },
      { id: null, categorie: "SERVICEKOSTEN_LEEGSTAND", complexnummer: null, complexomschrijving: null, omschrijving: "Service (NTB)", q1: D(50), q2: D(50), q3: D(50), q4: D(50) },
      { id: null, categorie: "OVERIGE_LEEGSTANDSKOSTEN", complexnummer: null, complexomschrijving: null, omschrijving: "Overig", q1: D(0), q2: D(0), q3: D(25), q4: D(25) },
    ]);
  const leegstandRegelsIn = (regels: readonly PurePnLBovenEbitdaRegel[]) => regels.filter((r) => r.regelSleutel.startsWith("LEEGSTANDSKOSTEN"));

  it("23. Begroting: Nuts 400 + Servicekosten 200 + Overige 50 = één P&L-regel Leegstandskosten (650); bewust €0 zonder regels is een bekende €0; complex en NTB toegestaan", () => {
    zetMappings();
    const a = bouwVersie("070");
    expect(bedrag(leesBegrotingPnLRegels(db, a.id), "LEEGSTANDSKOSTEN")).toBe("0");
    leegstandRegels(a.id);
    const regels = leesBegrotingPnLRegels(db, a.id);
    expect(leegstandRegelsIn(regels)).toHaveLength(1);
    expect(bedrag(regels, "LEEGSTANDSKOSTEN")).toBe("650");
    expect(regels.find((r) => r.regelSleutel === "LEEGSTANDSKOSTEN")!.specificaties!.map((s) => s.label)).toEqual(["NUTS_LEEGSTAND", "SERVICEKOSTEN_LEEGSTAND", "OVERIGE_LEEGSTANDSKOSTEN"]);
  });

  it("24. levenscyclus-pariteit en immutability: dezelfde P&L-regels voor en na vaststellen; Estimated wijzigen raakt de vastgestelde Begroting niet", () => {
    zetMappings();
    const a = bouwVersie("070");
    leegstandRegels(a.id);
    const voor = serialiseer(leesBegrotingPnLRegels(db, a.id));
    stelBegrotingVast(db, a.id, new Date(Date.UTC(2026, 8, 25)));
    expect(serialiseer(leesBegrotingPnLRegels(db, a.id))).toBe(voor);
    schrijfLeegstandEstimatedVerwachting(db, a.id, leegstandVerwachting({ NUTS_LEEGSTAND: { q1: null, q2: null, q3: D(500), q4: D(500) } }));
    expect(serialiseer(leesBegrotingPnLRegels(db, a.id))).toBe(voor);
  });

  it("25. Estimated: Werkelijk (Nuts 60, exact éénmaal) + resterende verwachting Q3+Q4 → één regel; onderdelen met bewuste €0 tellen mee (Nuts 60 + 40 = 100)", () => {
    zetMappings();
    const a = bouwVersie("070");
    schrijfLeegstandEstimatedVerwachting(db, a.id, leegstandVerwachting({ NUTS_LEEGSTAND: { q1: null, q2: null, q3: D(15), q4: D(25) } }));
    const regels = leesEstimatedPnLRegels(db, a.id, estimatedInvoer());
    expect(leegstandRegelsIn(regels)).toHaveLength(1);
    expect(bedrag(regels, "LEEGSTANDSKOSTEN")).toBe("100");
  });

  it("26. ontbrekende resterende verwachting: het onderdeel is onbekend, de post is de som van het bekende en de uitkomst ONVOLLEDIG; bekende bedragen blijven als beste-weten-som", () => {
    zetMappings();
    const a = bouwVersie("070");
    schrijfLeegstandEstimatedVerwachting(db, a.id, leegstandVerwachting({ SERVICEKOSTEN_LEEGSTAND: { q1: null, q2: null, q3: null, q4: null } }));
    const regels = leesEstimatedPnLRegels(db, a.id, estimatedInvoer());
    expect(leegstandRegelsIn(regels).map((r) => r.regelSleutel)).toEqual(["LEEGSTANDSKOSTEN", "LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL"]);
    expect(bedrag(regels, "LEEGSTANDSKOSTEN")).toBe("60"); // Nuts 60 + 0, Overige 0 + 0; Servicekosten onbekend
    const boom = berekenPnLBoom("ESTIMATED", regels);
    expect(boom.exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("27. ontbrekende Leegstand-mapping/dekking (070: geen bewezen LEEGSTAND-mapping) maakt de post ONBEKEND, ook met ingevulde verwachting — niet €0 en niet met de Begroting gevuld; overige posten blijven bekend", () => {
    zetMappings();
    const a = bouwVersie("070");
    leegstandRegels(a.id);
    const basis = estimatedInvoer();
    const zonderMapping = leesEstimatedPnLRegels(db, a.id, { ...basis, leegstand: { ...basis.leegstand, gemapteCategorieen: new Set() } });
    expect(bedrag(zonderMapping, "LEEGSTANDSKOSTEN")).toBe("ONBEKEND");
    expect(bedrag(zonderMapping, "MANAGEMENTVERGOEDING")).toBe("6000"); // overige posten met bevestigde dekking blijven bekend
    const boom = berekenPnLBoom("ESTIMATED", zonderMapping);
    expect(boom.exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(boom.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("28. geen 070-hardcoding: dezelfde code, administratie 003, dezelfde uitkomst; GL4350-achtige servicekosten worden niet uit Leegstand-Werkelijk afgeleid (Werkelijk komt uitsluitend aangeleverd via de LEEGSTAND-mapping)", () => {
    zetMappings();
    const a070 = bouwVersie("070");
    const a003 = bouwVersie("003");
    schrijfLeegstandEstimatedVerwachting(db, a003.id, leegstandVerwachting({ NUTS_LEEGSTAND: { q1: null, q2: null, q3: D(15), q4: D(25) } }));
    schrijfLeegstandEstimatedVerwachting(db, a070.id, leegstandVerwachting({ NUTS_LEEGSTAND: { q1: null, q2: null, q3: D(15), q4: D(25) } }));
    expect(bedrag(leesEstimatedPnLRegels(db, a003.id, estimatedInvoer()), "LEEGSTANDSKOSTEN")).toBe(bedrag(leesEstimatedPnLRegels(db, a070.id, estimatedInvoer()), "LEEGSTANDSKOSTEN"));
  });
});
