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
  algemeneKostenEstimatedNaarPnLBovenEbitdaRegels,
  berekenWerkelijkAlgemeneKosten,
  type BgAlgemeneKostenCategorie,
  type BgManagementInvoer,
} from "@bvc/reporting";
import { schrijfAlgemeneKostenCategorieState } from "./algemeneKostenCategorieState.js";
import { leesAlgemeneKostenEstimatedResultaat } from "./algemeneKostenEstimated.js";
import { leesAlgemeneKostenEstimatedVerwachting, schrijfAlgemeneKostenEstimatedVerwachting, type AlgemeneKostenEstimatedVerwachting } from "./algemeneKostenEstimatedVerwachting.js";
import { schrijfAlgemeneKostenRegels } from "./algemeneKostenRegels.js";
import { leesBegrotingsversie, maakBegrotingsversie, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { schrijfCorrectiefDagelijksOnderhoudBeoordeeld } from "./correctiefDagelijksOnderhoudBeoordeeld.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenAlgemeneKostenResultaat } from "./frozenAlgemeneKostenResultaat.js";
import { schrijfGemeentelijkeLastenModule } from "./gemeentelijkeLastenModule.js";
import { schrijfGeplandeVerkoopBeoordeeld } from "./geplandeVerkoopBeoordeeld.js";
import { schrijfGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";
import { schrijfLeegstandCategorieState } from "./leegstandCategorieState.js";
import { schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Snapshot } from "./module1Snapshot.js";
import { schrijfModule3Invoer } from "./module3Invoer.js";
import { schrijfRenteCategorieState } from "./renteCategorieState.js";
import { stelBegrotingVast } from "./vaststellen.js";
import { schrijfVerzekeringBeoordeeld } from "./verzekeringBeoordeeld.js";

/**
 * Estimated Algemene kosten (Vervolgtranche 5, FO OB-030/035/036): handmatige resterende verwachting per post,
 * gekoppeld aan Begroting (concept of bevroren) en aangeleverd Werkelijk. Werkelijk-bedragen zijn expliciet
 * gemarkeerde testfixtures; de classificatie zelf is al door de bestaande Werkelijk-keten bewezen.
 */

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-algemene-kosten-estimated-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const VERSIE: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "070", begrotingsjaar: 2027, bronPeildatum: new Date(Date.UTC(2026, 6, 31)) };
const MODULE3: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(500), eenheid: "MAAND", ingangsdatum: null };
const D = (n: string | number) => new Decimal(n);

function verwachting(overrides: Partial<AlgemeneKostenEstimatedVerwachting> = {}): AlgemeneKostenEstimatedVerwachting {
  return { ACCOUNTANT: null, ALGEMENE_KOSTEN: null, JURIDISCHE_KOSTEN: null, MAKELAARSKOSTEN: null, BANKKOSTEN: null, ...overrides };
}

function alleVijf(waarde: number): AlgemeneKostenEstimatedVerwachting {
  return { ACCOUNTANT: D(waarde), ALGEMENE_KOSTEN: D(waarde), JURIDISCHE_KOSTEN: D(waarde), MAKELAARSKOSTEN: D(waarde), BANKKOSTEN: D(waarde) };
}

/** Basis waarin alles beoordeeld is; Algemene kosten met een paar regels zodat Begroting-totalen per post verschillen. */
function zetBasisNeer(versieId: string): void {
  const jaar = leesBegrotingsversie(db, versieId)!.begrotingsjaar;
  schrijfModule1Snapshot(db, versieId, []);
  schrijfModule1Aannames(db, versieId, { begrotingsjaar: jaar, indexatiePercentage: D(3) });
  schrijfModule3Invoer(db, versieId, MODULE3);
  schrijfGeplandOnderhoudBeoordeeld(db, versieId, true);
  schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versieId, true);
  schrijfVerzekeringBeoordeeld(db, versieId, true);
  schrijfGemeentelijkeLastenModule(db, versieId, { werkelijkeGemeentelijkeLasten: null, wozStijgingPercentage: null, lastenPercentageStijging: null, begrotingsPercentageOverride: null, beoordeeld: true });
  schrijfAlgemeneKostenRegels(db, versieId, [
    { id: null, categorie: "ACCOUNTANT", ogbKostensoortCode: null, omschrijving: "Jaarrekening", complexnummer: null, jaarbedrag: D(4000) },
    { id: null, categorie: "JURIDISCHE_KOSTEN", ogbKostensoortCode: null, omschrijving: "Advies", complexnummer: null, jaarbedrag: D(1500) },
    { id: null, categorie: "MAKELAARSKOSTEN", ogbKostensoortCode: null, omschrijving: "Taxatie", complexnummer: null, jaarbedrag: D(2500) },
    { id: null, categorie: "BANKKOSTEN", ogbKostensoortCode: null, omschrijving: "Bank", complexnummer: null, jaarbedrag: D(300) },
  ]);
  schrijfAlgemeneKostenCategorieState(
    db,
    versieId,
    Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c) => [c, { beoordeeld: true, vorigJaarBedrag: null, verwachteVerhogingPercentage: null }])) as never,
  );
  schrijfLeegstandCategorieState(
    db,
    versieId,
    Object.fromEntries(
      LEEGSTAND_CATEGORIEEN.map((c) => [c, { beoordeeld: true, laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null }]),
    ) as never,
  );
  schrijfRenteCategorieState(db, versieId, Object.fromEntries(RENTE_CATEGORIEEN.map((c) => [c, { beoordeeld: true }])) as never);
  schrijfGeplandeVerkoopBeoordeeld(db, versieId, true);
}

/** Werkelijk t/m afgesloten periode: per post een boeking (fixture), plus optioneel een niet-geclassificeerde. */
function werkelijk(bedragen: Partial<Record<BgAlgemeneKostenCategorie, number>>, nietGeclassificeerd = 0) {
  const boekingen = (Object.entries(bedragen) as [BgAlgemeneKostenCategorie, number][]).map(([economischeCategorie, saldo]) => ({ economischeCategorie, saldo: D(saldo) }));
  if (nietGeclassificeerd !== 0) boekingen.push({ economischeCategorie: null as never, saldo: D(nietGeclassificeerd) });
  return berekenWerkelijkAlgemeneKosten(boekingen);
}

const per = (r: ReturnType<typeof leesAlgemeneKostenEstimatedResultaat>, c: BgAlgemeneKostenCategorie) => r.perCategorie.find((x) => x.categorie === c)!;

describe("schrijf/leesAlgemeneKostenEstimatedVerwachting — persistence", () => {
  it("1. geen rijen = alle vijf posten null (niet ingevuld), nooit stil €0", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    expect(leesAlgemeneKostenEstimatedVerwachting(db, versie.id)).toEqual(verwachting());
  });

  it("2. round-trip per post; Decimal als TEXT zonder precisieverlies; null en bewust €0 blijven onderscheiden", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, verwachting({ ACCOUNTANT: D("1234.5678"), BANKKOSTEN: D(0) }));
    const gelezen = leesAlgemeneKostenEstimatedVerwachting(db, versie.id);
    expect(gelezen.ACCOUNTANT?.toString()).toBe("1234.5678");
    expect(gelezen.BANKKOSTEN?.toString()).toBe("0");
    expect(gelezen.JURIDISCHE_KOSTEN).toBeNull();
    const ruw = db.prepare(`SELECT typeof(resterend_bedrag) AS t FROM begroting_algemene_kosten_estimated_verwachting WHERE begroting_versie_id = ?`).all(versie.id) as { t: string }[];
    expect(ruw.map((r) => r.t)).toEqual(["text", "text"]);
  });

  it("3. complete-state save: een post op null verwijdert haar verwachting; overige posten blijven", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, alleVijf(100));
    const na = schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, { ...alleVijf(100), JURIDISCHE_KOSTEN: null });
    expect(na.JURIDISCHE_KOSTEN).toBeNull();
    expect(na.ACCOUNTANT?.toString()).toBe("100");
  });

  it("4. negatieve verwachting (correctie/creditnota) is opslaanbaar; NaN en een onbekende versie worden geweigerd zonder mutatie", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, verwachting({ ACCOUNTANT: D(-50) }));
    expect(leesAlgemeneKostenEstimatedVerwachting(db, versie.id).ACCOUNTANT?.toString()).toBe("-50");
    expect(() => schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, verwachting({ ACCOUNTANT: D(NaN) }))).toThrow(/NaN/);
    expect(() => schrijfAlgemeneKostenEstimatedVerwachting(db, "bestaat-niet", alleVijf(1))).toThrow(/bestaat niet/);
    expect(leesAlgemeneKostenEstimatedVerwachting(db, versie.id).ACCOUNTANT?.toString()).toBe("-50");
  });

  it("5. admin-/versiegebonden: de verwachting van de ene versie lekt niet naar een andere; verwijderen van een CONCEPT-versie cascadeert", () => {
    const v1 = maakBegrotingsversie(db, VERSIE);
    const v2 = maakBegrotingsversie(db, { ...VERSIE, bedrijfsnr: "003" });
    schrijfAlgemeneKostenEstimatedVerwachting(db, v1.id, alleVijf(10));
    expect(leesAlgemeneKostenEstimatedVerwachting(db, v2.id)).toEqual(verwachting());
    verwijderConceptVersie(db, v1.id);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM begroting_algemene_kosten_estimated_verwachting`).get() as { n: number }).n).toBe(0);
  });

  it("6. structurele CHECK: een onbekende categorie kan niet worden geschreven", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    expect(() => db.prepare(`INSERT INTO begroting_algemene_kosten_estimated_verwachting (begroting_versie_id, categorie, resterend_bedrag) VALUES (?, 'RENTE', '1')`).run(versie.id)).toThrow();
  });
});

describe("leesAlgemeneKostenEstimatedResultaat — Estimated = Werkelijk + handmatige resterende verwachting", () => {
  it("7. per post: estimated = werkelijk t/m afgesloten periode + resterende verwachting; afwijking t.o.v. de ongewijzigde Begroting", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    zetBasisNeer(versie.id);
    schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, {
      ACCOUNTANT: D(1000),
      ALGEMENE_KOSTEN: D(0),
      JURIDISCHE_KOSTEN: D(200),
      MAKELAARSKOSTEN: D(0),
      BANKKOSTEN: D(75),
    });
    const r = leesAlgemeneKostenEstimatedResultaat(db, versie.id, werkelijk({ ACCOUNTANT: 3000, JURIDISCHE_KOSTEN: 1200, MAKELAARSKOSTEN: 2600, BANKKOSTEN: 250, ALGEMENE_KOSTEN: 400 }), true);

    expect(per(r, "ACCOUNTANT")).toMatchObject({ begrotingTotaal: D(4000), werkelijkTotaal: D(3000), verwachtingResterendJaar: D(1000) });
    expect(per(r, "ACCOUNTANT").estimatedTotaal?.toString()).toBe("4000");
    expect(per(r, "ACCOUNTANT").afwijking?.toString()).toBe("0");
    expect(per(r, "JURIDISCHE_KOSTEN").estimatedTotaal?.toString()).toBe("1400");
    expect(per(r, "JURIDISCHE_KOSTEN").afwijking?.toString()).toBe("-100");
    expect(per(r, "MAKELAARSKOSTEN").estimatedTotaal?.toString()).toBe("2600"); // bewust €0 verwachting: Estimated = Werkelijk
    expect(per(r, "MAKELAARSKOSTEN").afwijking?.toString()).toBe("100");
    expect(per(r, "BANKKOSTEN").estimatedTotaal?.toString()).toBe("325");
    expect(per(r, "ALGEMENE_KOSTEN").estimatedTotaal?.toString()).toBe("400");
    expect(r.moduleEstimatedTotaal?.toString()).toBe("8725");
    expect(r.moduleBegrotingTotaal.toString()).toBe("8300");
  });

  it("8. niet ingevulde verwachting (null) geeft een onbekende Estimated voor die post — nooit stil €0 — en dus een onbekend moduletotaal", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    zetBasisNeer(versie.id);
    schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, verwachting({ ACCOUNTANT: D(0) }));
    const r = leesAlgemeneKostenEstimatedResultaat(db, versie.id, werkelijk({ ACCOUNTANT: 3000 }), true);
    expect(per(r, "ACCOUNTANT").estimatedTotaal?.toString()).toBe("3000");
    expect(per(r, "BANKKOSTEN").estimatedTotaal).toBeNull();
    expect(per(r, "BANKKOSTEN").afwijking).toBeNull();
    expect(r.moduleEstimatedTotaal).toBeNull();
  });

  it("9. Werkelijk-dekking niet bevestigd, of niet-geclassificeerde boekingen: Estimated blijft onbekend voor alle posten (geen gok)", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    zetBasisNeer(versie.id);
    schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, alleVijf(0));
    const onbevestigd = leesAlgemeneKostenEstimatedResultaat(db, versie.id, werkelijk({ ACCOUNTANT: 1 }), false);
    expect(onbevestigd.perCategorie.every((c) => c.estimatedTotaal === null && c.werkelijkVoldoendeBekend === false)).toBe(true);
    const nietGemapt = leesAlgemeneKostenEstimatedResultaat(db, versie.id, werkelijk({ ACCOUNTANT: 1 }, 99), true);
    expect(nietGemapt.perCategorie.every((c) => c.estimatedTotaal === null)).toBe(true);
    expect(nietGemapt.moduleEstimatedTotaal).toBeNull();
  });

  it("10. Actual wordt niet dubbel geteld: moduleWerkelijk is de som van de posten, en Estimated telt Werkelijk precies één keer", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    zetBasisNeer(versie.id);
    schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, alleVijf(10));
    const r = leesAlgemeneKostenEstimatedResultaat(db, versie.id, werkelijk({ ACCOUNTANT: 100, BANKKOSTEN: 50 }), true);
    expect(r.moduleWerkelijkTotaal.toString()).toBe("150");
    expect(r.moduleEstimatedTotaal?.toString()).toBe("200"); // 150 + 5 × 10
  });

  it("11. de Begroting blijft onveranderd door Estimated: schrijven van de verwachting raakt de concept-regels en het Begroting-totaal niet", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    zetBasisNeer(versie.id);
    const voor = leesAlgemeneKostenEstimatedResultaat(db, versie.id, werkelijk({}), true).moduleBegrotingTotaal.toString();
    schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, alleVijf(9999));
    const na = leesAlgemeneKostenEstimatedResultaat(db, versie.id, werkelijk({}), true).moduleBegrotingTotaal.toString();
    expect(na).toBe(voor);
    expect(voor).toBe("8300");
  });

  it("12. na VASTGESTELD leest Estimated de bevroren Begroting; de verwachting blijft wijzigbaar en muteert de bevroren Begroting niet", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    zetBasisNeer(versie.id);
    stelBegrotingVast(db, versie.id, new Date(Date.UTC(2026, 8, 25)));
    const bevroren = leesFrozenAlgemeneKostenResultaat(db, versie.id)!;

    schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, alleVijf(100));
    const r1 = leesAlgemeneKostenEstimatedResultaat(db, versie.id, werkelijk({ ACCOUNTANT: 3000 }), true);
    expect(per(r1, "ACCOUNTANT").begrotingTotaal.toString()).toBe("4000");
    expect(per(r1, "ACCOUNTANT").estimatedTotaal?.toString()).toBe("3100");

    schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, alleVijf(200));
    const r2 = leesAlgemeneKostenEstimatedResultaat(db, versie.id, werkelijk({ ACCOUNTANT: 3000 }), true);
    expect(per(r2, "ACCOUNTANT").estimatedTotaal?.toString()).toBe("3200");
    expect(leesFrozenAlgemeneKostenResultaat(db, versie.id)!.moduleTotaal.toString()).toBe(bevroren.moduleTotaal.toString());
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("VASTGESTELD");
  });

  it("13. P&L: de vijf posten komen als afzonderlijke boven-EBITDA-regels met bekende Estimated; onbekend blijft ONBEKEND (geen €0)", () => {
    const versie = maakBegrotingsversie(db, VERSIE);
    zetBasisNeer(versie.id);
    schrijfAlgemeneKostenEstimatedVerwachting(db, versie.id, verwachting({ ACCOUNTANT: D(10), ALGEMENE_KOSTEN: D(0), JURIDISCHE_KOSTEN: D(0), MAKELAARSKOSTEN: D(0) }));
    const r = leesAlgemeneKostenEstimatedResultaat(db, versie.id, werkelijk({ ACCOUNTANT: 90 }), true);
    const regels = algemeneKostenEstimatedNaarPnLBovenEbitdaRegels(r);
    expect(regels.map((x) => x.regelSleutel)).toEqual([...ALGEMENE_KOSTEN_CATEGORIEEN]);
    const acc = regels.find((x) => x.regelSleutel === "ACCOUNTANT")!;
    expect(acc.waarde).toMatchObject({ status: "BEKEND" });
    expect((acc.waarde as { bedrag: Decimal }).bedrag.toString()).toBe("100");
    expect(regels.find((x) => x.regelSleutel === "BANKKOSTEN")!.waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING" });
  });

  it("14. een niet-bestaande versie faalt; Estimated schrijft nooit (geen rijen zonder expliciete save)", () => {
    expect(() => leesAlgemeneKostenEstimatedResultaat(db, "bestaat-niet", werkelijk({}), true)).toThrow(/bestaat niet/);
    const versie = maakBegrotingsversie(db, VERSIE);
    zetBasisNeer(versie.id);
    leesAlgemeneKostenEstimatedResultaat(db, versie.id, werkelijk({}), true);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM begroting_algemene_kosten_estimated_verwachting`).get() as { n: number }).n).toBe(0);
  });
});
