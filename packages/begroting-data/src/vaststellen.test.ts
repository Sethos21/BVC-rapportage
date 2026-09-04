import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BgContractFeiten, BgManagementInvoer } from "@bvc/reporting";
import {
  leesBegrotingsversie,
  maakBegrotingsversie,
  verwijderConceptVersie,
  wijzigConceptNaamNotitie,
  type NieuweBegrotingsversieInput,
} from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenModule3Resultaat, schrijfFrozenModule3Resultaat } from "./frozenModule3Resultaat.js";
import { leesFrozenBegrotingsresultaat, schrijfFrozenBegrotingsresultaat } from "./frozenResultaat.js";
import { herberekenBegroting } from "./herberekenen.js";
import { leesModule1Aannames, schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Overrides } from "./module1Overrides.js";
import { leesModule1Snapshot, schrijfModule1Snapshot } from "./module1Snapshot.js";
import { schrijfModule2Config } from "./module2Config.js";
import { leesModule3Invoer, schrijfModule3Invoer } from "./module3Invoer.js";
import { stelBegrotingVast } from "./vaststellen.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-vaststellen-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NIEUWE_VERSIE_INPUT: NieuweBegrotingsversieInput = {
  originType: "NIEUW",
  bedrijfsnr: "070",
  begrotingsjaar: 2027,
  bronPeildatum: new Date(Date.UTC(2026, 6, 31)),
};

function maakContract(contractnummer: string, overrides: Partial<BgContractFeiten> = {}): BgContractFeiten {
  return {
    bedrijfsnr: "070",
    contractnummer,
    huurdernummer: "H1",
    huurderNaam: "Test Huurder BV",
    complexnummer: "001",
    rentrollComponenten: [{ vorderingsoort: "01", bedragJaar: new Decimal(120000), btwYn: "Y" }],
    ingangsdatum: new Date(Date.UTC(2020, 0, 1)),
    einddatum: null,
    indexatiedatum: null,
    indexatieHerhalingMaanden: null,
    toekomstigeKortingswijzigingen: [],
    ...overrides,
  };
}

function normaliseer<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, val) => (val instanceof Decimal ? { __decimal__: val.toString() } : val)));
}

/**
 * Minimale, geldige Module-3-invoer — uitsluitend gebruikt om aan de nieuwe
 * vaststel-verplichting te voldoen in tests die zelf niets specifieks over
 * Module 3 beweren (Module-1/2-gerichte tests). Tests die Module 3 zelf
 * inhoudelijk toetsen (mechanisme-specifieke tests) gebruiken hun eigen,
 * expliciete invoer.
 */
const MODULE3_STANDAARD: BgManagementInvoer = {
  wijze: "NIEUWE_VERGOEDING",
  bedrag: new Decimal(500),
  eenheid: "MAAND",
  ingangsdatum: null,
};

/** Zet de echte 070-contract-049-keten neer (identiek aan 1D.5/1D.6a) via uitsluitend publieke schrijf-API's. */
function zet070InputNeer(versieId: string): void {
  schrijfModule1Snapshot(db, versieId, [
    maakContract("0000000049", {
      complexnummer: "001",
      rentrollComponenten: [
        { vorderingsoort: "01", bedragJaar: new Decimal(12777.36), btwYn: "Y" },
        { vorderingsoort: "13", bedragJaar: new Decimal(-6000), btwYn: "Y" },
      ],
      indexatiedatum: new Date(Date.UTC(2027, 6, 1)),
      indexatieHerhalingMaanden: 12,
      toekomstigeKortingswijzigingen: [{ ingangsdatum: new Date(Date.UTC(2027, 6, 1)), nieuweKortingPerMaand: new Decimal(0) }],
    }),
  ]);
  schrijfModule1Aannames(db, versieId, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
  schrijfModule1Overrides(db, versieId, [{ contractnummer: "0000000049", indexatiePercentage: new Decimal(5), scope: "VERSIE", reden: "Onderhandeld" }]);
  schrijfModule2Config(db, versieId, [
    { complexnummer: "001", vastBedragJaar: new Decimal(12000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: new Decimal(6) },
  ]);
}

describe("stelBegrotingVast — status- en invoersemantiek", () => {
  it("1. een niet-bestaande versie geeft een duidelijke fout", () => {
    expect(() => stelBegrotingVast(db, "bestaat-niet")).toThrow(/bestaat niet/);
  });

  it("2. een VASTGESTELDE versie wordt geweigerd (geen idempotent nogmaals vaststellen)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    stelBegrotingVast(db, versie.id, new Date());

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/CONCEPT/);
  });

  it("3. ontbrekende Module-1-aannames geven een duidelijke fout, versie blijft CONCEPT", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/aannames/i);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
  });

  it("4. lege snapshot is toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.module1.contracten).toEqual([]);
  });

  it("5. lege overrides zijn toegestaan (geen override geschreven)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    expect(() => stelBegrotingVast(db, versie.id)).not.toThrow();
  });

  it("6. lege Module-2-config is toegestaan (geen config geschreven)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.module2.complexen).toEqual([]);
  });
});

describe("stelBegrotingVast — recomputatie tegen huidige input, niet tegen oude frozen output", () => {
  it("7+8+10. huidige persisted inputs worden gebruikt; bestaande tijdelijke (afwijkende) frozen output wordt volledig vervangen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);

    // Bewust afwijkende, tijdelijke frozen output neerzetten (een eerdere, inmiddels-stale CONCEPT-poging).
    const stale = herberekenBegroting(db, versie.id);
    schrijfFrozenBegrotingsresultaat(db, versie.id, stale);

    // Input wijzigt daarna — dit moet het uiteindelijke vastgestelde resultaat bepalen, niet de stale frozen data.
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000099")]);

    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.module1.contracten.map((c) => c.contractnummer)).toEqual(["0000000099"]);

    const frozen = leesFrozenBegrotingsresultaat(db, versie.id)!;
    expect(frozen.module1.contracten.map((c) => c.contractnummer)).toEqual(["0000000099"]);
    expect(frozen.module1.contracten.map((c) => c.contractnummer)).not.toEqual(["0000000028"]);
  });
});

describe("stelBegrotingVast — controls blokkeren niet", () => {
  it("9. Module-1/2-controls (dubbele override/config) blokkeren vaststellen niet, blijven wel zichtbaar in het frozen resultaat", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { complexnummer: "001" })]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule1Overrides(db, versie.id, [
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(3), scope: "VERSIE" },
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "VERSIE" },
    ]);
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "001", vastBedragJaar: new Decimal(1000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
      { complexnummer: "001", vastBedragJaar: new Decimal(2000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
    ]);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);

    const resultaat = stelBegrotingVast(db, versie.id); // mag NIET gooien ondanks de controls
    expect(resultaat.module1.controleVereist.length).toBeGreaterThan(0);
    expect(resultaat.module2.controleVereist.length).toBeGreaterThan(0);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("VASTGESTELD");
  });
});

describe("stelBegrotingVast — succesvolle vaststelling, timestamp, read-back", () => {
  it("11+19. status/timestamp exact: vastgesteld_at bevat exact de gebruikte UTC-timestamp, geretourneerde versie ook", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);

    const timestamp = new Date("2026-12-20T10:15:30.123Z");
    const resultaat = stelBegrotingVast(db, versie.id, timestamp);

    expect(resultaat.versie.status).toBe("VASTGESTELD");
    expect(resultaat.versie.vastgesteldAt).toEqual(timestamp);

    const ruweRij = db.prepare(`SELECT vastgesteld_at FROM begrotingsversies WHERE id = ?`).get(versie.id) as { vastgesteld_at: string };
    expect(ruweRij.vastgesteld_at).toBe("2026-12-20T10:15:30.123Z");

    const reread = leesBegrotingsversie(db, versie.id)!;
    expect(reread.vastgesteldAt).toEqual(timestamp);
  });

  it("12. leesFrozenBegrotingsresultaat/leesFrozenModule3Resultaat na afloop zijn inhoudelijk exact gelijk aan het teruggegeven resultaat", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);

    const resultaat = stelBegrotingVast(db, versie.id, new Date("2026-12-20T10:15:30.123Z"));
    const gelezen = leesFrozenBegrotingsresultaat(db, versie.id)!;
    const gelezenModule3 = leesFrozenModule3Resultaat(db, versie.id)!;

    expect(normaliseer(gelezen.module1)).toEqual(normaliseer(resultaat.module1));
    expect(normaliseer(gelezen.module2)).toEqual(normaliseer(resultaat.module2));
    expect(normaliseer(gelezenModule3)).toEqual(normaliseer(resultaat.module3));
  });

  it("13. inputtabellen (snapshot, aannames, overrides, config, Module-3-invoer) blijven volledig ongewijzigd na succesvolle vaststelling", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);

    const dump = () => ({
      snapshot: db.prepare(`SELECT * FROM begroting_contract_snapshot`).all(),
      rentroll: db.prepare(`SELECT * FROM begroting_contract_rentroll_component`).all(),
      korting: db.prepare(`SELECT * FROM begroting_contract_kortingswijziging`).all(),
      aannames: db.prepare(`SELECT * FROM begroting_aannames`).all(),
      overrides: db.prepare(`SELECT * FROM begroting_contract_override`).all(),
      configs: db.prepare(`SELECT * FROM begroting_complex_config`).all(),
      module3Invoer: db.prepare(`SELECT * FROM begroting_management_invoer`).all(),
    });

    const voor = dump();
    stelBegrotingVast(db, versie.id);
    const na = dump();

    expect(na).toEqual(voor);
  });
});

describe("stelBegrotingVast — immutability na vaststellen (alle publieke write-API's)", () => {
  it("14+15. wijzigConceptNaamNotitie, verwijderConceptVersie, alle schrijf-API's (incl. Module 3), frozen writes (incl. Module 3) en een tweede stelBegrotingVast falen allemaal", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    const resultaat = stelBegrotingVast(db, versie.id);

    expect(() => wijzigConceptNaamNotitie(db, versie.id, { naam: "mag niet" })).toThrow();
    expect(() => verwijderConceptVersie(db, versie.id)).toThrow();
    expect(() => schrijfModule1Snapshot(db, versie.id, [maakContract("0000000001")])).toThrow();
    expect(() => schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(9) })).toThrow();
    expect(() => schrijfModule1Overrides(db, versie.id, [])).toThrow();
    expect(() => schrijfModule2Config(db, versie.id, [])).toThrow();
    expect(() => schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD)).toThrow(/VASTGESTELD/);
    expect(() => schrijfFrozenBegrotingsresultaat(db, versie.id, resultaat)).toThrow();
    expect(() => schrijfFrozenModule3Resultaat(db, versie.id, resultaat.module3)).toThrow(/VASTGESTELD/);
    expect(() => stelBegrotingVast(db, versie.id)).toThrow();
  });
});

describe("stelBegrotingVast — atomiciteit / rollback", () => {
  it("16. een échte pure Module-1-hard-error (meerdere bedrijfsnr's) laat volledige rollback zien: CONCEPT, vastgesteld_at null, oude frozen output en inputs onaangetast", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { bedrijfsnr: "070" })]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);

    // Al een geldige, tijdelijke frozen output vóór de poging.
    const vorigeFrozen = herberekenBegroting(db, versie.id);
    schrijfFrozenBegrotingsresultaat(db, versie.id, vorigeFrozen);

    // Deze exacte foutconditie is via de normale schrijf-API/DB-triggers structureel onbereikbaar (1D.3's
    // eigen bedrijfsnr-consistentie-trigger voorkomt dit) — zelfde, bewust geïsoleerde testtechniek als in
    // 1D.5/1D.6a: de trigger tijdelijk verwijderen in DEZE ene testdatabase om de onderliggende pure
    // Module-1-fail-fast zelf ("exact één administratie per aanroep") te bereiken.
    db.exec(`DROP TRIGGER trg_begroting_contract_snapshot_bedrijfsnr_insert`);
    db.prepare(
      `INSERT INTO begroting_contract_snapshot
         (begroting_versie_id, contractnummer, bedrijfsnr, huurdernummer, huurder_naam, complexnummer, ingangsdatum, einddatum, indexatiedatum, indexatie_herhaling_maanden)
       VALUES (?, '0000000099', '010', NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
    ).run(versie.id);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/exact één administratie per aanroep/);

    const naMislukking = leesBegrotingsversie(db, versie.id)!;
    expect(naMislukking.status).toBe("CONCEPT");
    expect(naMislukking.vastgesteldAt).toBeNull();

    const frozenNaMislukking = leesFrozenBegrotingsresultaat(db, versie.id)!;
    expect(normaliseer(frozenNaMislukking.module1)).toEqual(normaliseer(vorigeFrozen.module1));

    const aannamesNaMislukking = leesModule1Aannames(db, versie.id);
    expect(aannamesNaMislukking!.indexatiePercentage.toString()).toBe("3");
  });

  it("17. een échte DB-fout tijdens de frozen-output-write (ná geslaagde berekening) laat volledige rollback zien", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);

    // Al een geldige, tijdelijke frozen output vóór de poging.
    const vorigeFrozen = herberekenBegroting(db, versie.id);
    schrijfFrozenBegrotingsresultaat(db, versie.id, vorigeFrozen);

    // Test-only trigger: blokkeert specifiek de INSERT van de junimaandregel — de échte berekening (12
    // maanden voor contract 049) bereikt deze rij gegarandeerd, ná de header- en contractrij al succesvol
    // binnen DEZE poging zijn ingevoegd. Geen productiecode aangepast, geen bestaande data verwijderd/
    // gecorrumpeerd — uitsluitend een extra, tijdelijke trigger in deze ene testdatabase.
    db.exec(`
      CREATE TRIGGER test_forceer_schrijffout_maandregel
      BEFORE INSERT ON begroting_frozen_module1_maandregel
      FOR EACH ROW
      WHEN NEW.maand = 6
      BEGIN
        SELECT RAISE(ABORT, 'test: geforceerde schrijffout tijdens frozen-output-write');
      END;
    `);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/geforceerde schrijffout/);

    const naMislukking = leesBegrotingsversie(db, versie.id)!;
    expect(naMislukking.status).toBe("CONCEPT");
    expect(naMislukking.vastgesteldAt).toBeNull();

    const frozenNaMislukking = leesFrozenBegrotingsresultaat(db, versie.id)!;
    expect(normaliseer(frozenNaMislukking.module1)).toEqual(normaliseer(vorigeFrozen.module1)); // exact de oude, vorige frozen output
    expect(normaliseer(frozenNaMislukking.module2)).toEqual(normaliseer(vorigeFrozen.module2));
  });

  it("18. een échte DB-fout tijdens de statusflip (ná geslaagde frozen-output-write binnen dezelfde poging) laat volledige rollback zien", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);

    const vorigeFrozen = herberekenBegroting(db, versie.id);
    schrijfFrozenBegrotingsresultaat(db, versie.id, vorigeFrozen);

    // Test-only trigger: blokkeert specifiek de CONCEPT→VASTGESTELD-overgang zelf (geen bestaande trigger
    // doet dit — die blokkeren pas NA VASTGESTELD). Dit is het hardste bewijs: frozen output binnen déze
    // transactie is dan al (opnieuw) succesvol weggeschreven vóórdat de statusflip alsnog faalt.
    db.exec(`
      CREATE TRIGGER test_blokkeer_statusflip
      BEFORE UPDATE ON begrotingsversies
      FOR EACH ROW
      WHEN NEW.status = 'VASTGESTELD' AND OLD.status = 'CONCEPT'
      BEGIN
        SELECT RAISE(ABORT, 'test: geforceerde statusflip-fout');
      END;
    `);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/geforceerde statusflip-fout/);

    const naMislukking = leesBegrotingsversie(db, versie.id)!;
    expect(naMislukking.status).toBe("CONCEPT");
    expect(naMislukking.vastgesteldAt).toBeNull();

    // De frozen output (die binnen DEZE mislukte poging tussentijds al herschreven was) is teruggerold
    // naar exact de oude, vorige frozen output — geen nieuwe output achtergebleven.
    const frozenNaMislukking = leesFrozenBegrotingsresultaat(db, versie.id)!;
    expect(normaliseer(frozenNaMislukking.module1)).toEqual(normaliseer(vorigeFrozen.module1));
    expect(normaliseer(frozenNaMislukking.module2)).toEqual(normaliseer(vorigeFrozen.module2));
  });
});

describe("stelBegrotingVast — concurrency (BEGIN IMMEDIATE)", () => {
  it("20. een tweede vaststelpoging op een andere connectie kan niet gelijktijdig dezelfde CONCEPT-versie muteren", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });

    // Simuleert "poging 1 is al bezig": db (eerste connectie) claimt het schrijfslot via BEGIN IMMEDIATE
    // en houdt het bewust open (geen commit/rollback), exact zoals stelBegrotingVast dat intern ook doet.
    db.exec("BEGIN IMMEDIATE");

    const dbTweede = openOrCreateDatabase(dbPad);
    dbTweede.exec("PRAGMA busy_timeout = 200"); // korte timeout, uitsluitend om deze test snel te houden

    // Poging 2 (andere connectie) moet falen: db houdt het schrijfslot vast, dbTweede's eigen BEGIN
    // IMMEDIATE binnen stelBegrotingVast kan het niet verkrijgen binnen haar (verkorte) busy_timeout.
    expect(() => stelBegrotingVast(dbTweede, versie.id)).toThrow();

    dbTweede.close();
    db.exec("ROLLBACK"); // poging 1 opruimen — versie blijft CONCEPT, geen van beide pogingen is geslaagd

    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
  });
});

describe("stelBegrotingVast — 070 end-to-end", () => {
  it("070-fixture: volledige vaststel-keten via uitsluitend publieke API's, incl. read-back en immutability", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);

    const timestamp = new Date("2026-12-20T10:15:30.123Z");
    const resultaat = stelBegrotingVast(db, versie.id, timestamp);

    expect(resultaat.versie.status).toBe("VASTGESTELD");
    expect(resultaat.versie.vastgesteldAt).toEqual(timestamp);

    const contract = resultaat.module1.contracten.find((c) => c.contractnummer === "0000000049")!;
    expect(contract.indexatiePercentageBron).toBe("OVERRIDE");
    expect(contract.jaartotaal.huurkorting.toString()).toBe("3000");

    const complex001 = resultaat.module2.complexen.find((c) => c.complexnummer === "001")!;
    expect(complex001.jaartotaal.nettoHuurGrondslag.toString()).toBe(contract.jaartotaal.nettoHuur.toString());
    expect(complex001.vastToegepast).toBe(true);
    expect(complex001.variabelToegepast).toBe(true);

    const frozen = leesFrozenBegrotingsresultaat(db, versie.id)!;
    expect(normaliseer(frozen.module1)).toEqual(normaliseer(resultaat.module1));
    expect(normaliseer(frozen.module2)).toEqual(normaliseer(resultaat.module2));

    // Module 3 is niet-nullable in VastgesteldeBegroting en sluit exact aan op de frozen read-back.
    expect(resultaat.module3.jaartotaal.bedrag.toString()).toBe("6000"); // MODULE3_STANDAARD: 500/mnd × 12
    const frozenModule3 = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(frozenModule3)).toEqual(normaliseer(resultaat.module3));

    expect(() => schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(1) })).toThrow();
    expect(leesModule1Snapshot(db, versie.id).map((c) => c.contractnummer)).toEqual(["0000000049"]); // ongewijzigd
  });
});

describe("stelBegrotingVast — Fase 2C.5: Module 3 verplicht bij vaststellen", () => {
  it("A. vaststellen zonder Module-3-invoer wordt geblokkeerd — volledige rollback, geen enkele frozen output, status blijft CONCEPT", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id); // geldige Module-1/2-input, BEWUST geen schrijfModule3Invoer

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/Module-3-invoer/);

    const naPoging = leesBegrotingsversie(db, versie.id)!;
    expect(naPoging.status).toBe("CONCEPT");
    expect(naPoging.vastgesteldAt).toBeNull();

    expect(leesFrozenBegrotingsresultaat(db, versie.id)).toBeNull(); // geen frozen Module 1/2
    expect(leesFrozenModule3Resultaat(db, versie.id)).toBeNull(); // geen frozen Module 3
    expect(leesModule3Invoer(db, versie.id)).toBeNull(); // nog steeds geen invoer — niets stilzwijgend aangemaakt
  });

  it("B. INDEXEER_BESTAAND: volledige keten persistente input → vaststellen → frozen Module 3 → read-back exact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    const invoer: BgManagementInvoer = {
      wijze: "INDEXEER_BESTAAND",
      bestaandBedrag: new Decimal(1000),
      eenheid: "MAAND",
      indexatiePercentage: new Decimal(3),
      indexatiedatum: new Date(Date.UTC(2027, 6, 1)),
    };
    schrijfModule3Invoer(db, versie.id, invoer);

    const resultaat = stelBegrotingVast(db, versie.id);

    expect(resultaat.module3.invoer).toEqual(invoer);
    for (let i = 0; i < 6; i += 1) expect(resultaat.module3.regels[i]!.bedrag.toString()).toBe("1000");
    for (let i = 6; i < 12; i += 1) expect(resultaat.module3.regels[i]!.bedrag.toString()).toBe("1030");
    expect(resultaat.module3.jaartotaal.bedrag.toString()).toBe("12180");

    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(gelezen)).toEqual(normaliseer(resultaat.module3));
  });

  it("C. WIJZIG_BESTAAND_BEDRAG: regressievoorbeeld €1.000→€1.200 per 1 juli, frozen jaartotaal exact €13.200", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    const invoer: BgManagementInvoer = {
      wijze: "WIJZIG_BESTAAND_BEDRAG",
      bestaandBedrag: new Decimal(1000),
      bestaandEenheid: "MAAND",
      nieuwBedrag: new Decimal(1200),
      nieuweEenheid: "MAAND",
      ingangsdatum: new Date(Date.UTC(2027, 6, 1)),
    };
    schrijfModule3Invoer(db, versie.id, invoer);

    const resultaat = stelBegrotingVast(db, versie.id);

    expect(resultaat.module3.jaartotaal.bedrag.toString()).toBe("13200");
    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(gelezen.jaartotaal.bedrag.toString()).toBe("13200");
    expect(normaliseer(gelezen)).toEqual(normaliseer(resultaat.module3));
  });

  it("D. NIEUWE_VERGOEDING: €1.200/mnd vanaf 1 juli, frozen jaartotaal exact €7.200", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    const invoer: BgManagementInvoer = {
      wijze: "NIEUWE_VERGOEDING",
      bedrag: new Decimal(1200),
      eenheid: "MAAND",
      ingangsdatum: new Date(Date.UTC(2027, 6, 1)),
    };
    schrijfModule3Invoer(db, versie.id, invoer);

    const resultaat = stelBegrotingVast(db, versie.id);

    expect(resultaat.module3.jaartotaal.bedrag.toString()).toBe("7200");
    const gelezen = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(gelezen.jaartotaal.bedrag.toString()).toBe("7200");
    expect(normaliseer(gelezen)).toEqual(normaliseer(resultaat.module3));
  });

  it("E. expliciet €0: geldige, bewust ingevulde Module-3-invoer met jaartotaal €0 mag vastgesteld worden — INGEVULD €0 ≠ NIET INGEVULD", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    const invoer: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(0), eenheid: "MAAND", ingangsdatum: null };
    schrijfModule3Invoer(db, versie.id, invoer);

    const resultaat = stelBegrotingVast(db, versie.id);

    expect(resultaat.versie.status).toBe("VASTGESTELD");
    expect(resultaat.module3).not.toBeNull();
    expect(resultaat.module3.jaartotaal.bedrag.toString()).toBe("0");
    expect(resultaat.module3.jaartotaal.bedrag.isZero()).toBe(true);

    const gelezen = leesFrozenModule3Resultaat(db, versie.id);
    expect(gelezen).not.toBeNull();
    expect(gelezen!.jaartotaal.bedrag.toString()).toBe("0");

    // Contrast, ter bevestiging: een andere versie zonder invoer blijft geblokkeerd bij vaststellen.
    const anderVersie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(anderVersie.id);
    expect(() => stelBegrotingVast(db, anderVersie.id)).toThrow(/Module-3-invoer/);
  });

  it("F. atomiciteit — een échte DB-fout tijdens de Module-3-frozen-write (ná geslaagde Module-1/2-frozen-write binnen dezelfde poging) laat volledige rollback zien", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);

    // Al een geldige, tijdelijke frozen output vóór de poging (Module 1/2 én Module 3).
    const vorigeFrozen = herberekenBegroting(db, versie.id);
    schrijfFrozenBegrotingsresultaat(db, versie.id, vorigeFrozen);
    schrijfFrozenModule3Resultaat(db, versie.id, vorigeFrozen.module3!);

    // Test-only trigger: blokkeert specifiek de INSERT van de junimaandregel van Module 3 — de échte
    // berekening (12 maanden) bereikt deze rij gegarandeerd, ná Module-1/2 EN de Module-3-headerrij al
    // succesvol binnen DEZE poging zijn ingevoegd. Geen productiecode aangepast, geen bestaande data
    // verwijderd/gecorrumpeerd — uitsluitend een extra, tijdelijke trigger in deze ene testdatabase.
    db.exec(`
      CREATE TRIGGER test_forceer_schrijffout_module3_maandregel
      BEFORE INSERT ON begroting_frozen_module3_maandregel
      FOR EACH ROW
      WHEN NEW.maand = 6
      BEGIN
        SELECT RAISE(ABORT, 'test: geforceerde schrijffout tijdens Module-3-frozen-write');
      END;
    `);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/geforceerde schrijffout tijdens Module-3-frozen-write/);

    const naMislukking = leesBegrotingsversie(db, versie.id)!;
    expect(naMislukking.status).toBe("CONCEPT");
    expect(naMislukking.vastgesteldAt).toBeNull();

    // Alle drie modules: exact de oude, vorige frozen output — geen gedeeltelijke Module-1/2-herschrijving
    // is achtergebleven, ook al gebeurde die WEL (en slaagde die) binnen deze mislukte poging.
    const frozenNaMislukking = leesFrozenBegrotingsresultaat(db, versie.id)!;
    expect(normaliseer(frozenNaMislukking.module1)).toEqual(normaliseer(vorigeFrozen.module1));
    expect(normaliseer(frozenNaMislukking.module2)).toEqual(normaliseer(vorigeFrozen.module2));
    const frozenModule3NaMislukking = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(frozenModule3NaMislukking)).toEqual(normaliseer(vorigeFrozen.module3));
  });

  it("G. atomiciteit — een échte DB-fout tijdens de statusflip, NA geslaagde Module-1/2/3-frozen-writes binnen dezelfde poging, laat volledige rollback zien (hardste bewijs)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);

    const vorigeFrozen = herberekenBegroting(db, versie.id);
    schrijfFrozenBegrotingsresultaat(db, versie.id, vorigeFrozen);
    schrijfFrozenModule3Resultaat(db, versie.id, vorigeFrozen.module3!);

    // Test-only trigger: blokkeert specifiek de CONCEPT→VASTGESTELD-overgang zelf. Op het moment dat deze
    // vuurt, zijn binnen DEZE mislukte poging Module 1, Module 2 ÉN Module 3 al opnieuw succesvol
    // (her)geschreven — het hardste bewijs dat de volledige transactie, inclusief Module 3, atomair is.
    db.exec(`
      CREATE TRIGGER test_blokkeer_statusflip_module3
      BEFORE UPDATE ON begrotingsversies
      FOR EACH ROW
      WHEN NEW.status = 'VASTGESTELD' AND OLD.status = 'CONCEPT'
      BEGIN
        SELECT RAISE(ABORT, 'test: geforceerde statusflip-fout (module 3)');
      END;
    `);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/geforceerde statusflip-fout \(module 3\)/);

    const naMislukking = leesBegrotingsversie(db, versie.id)!;
    expect(naMislukking.status).toBe("CONCEPT");
    expect(naMislukking.vastgesteldAt).toBeNull();

    const frozenNaMislukking = leesFrozenBegrotingsresultaat(db, versie.id)!;
    expect(normaliseer(frozenNaMislukking.module1)).toEqual(normaliseer(vorigeFrozen.module1));
    expect(normaliseer(frozenNaMislukking.module2)).toEqual(normaliseer(vorigeFrozen.module2));
    const frozenModule3NaMislukking = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(frozenModule3NaMislukking)).toEqual(normaliseer(vorigeFrozen.module3));
  });

  it("H. tweede vaststelpoging op een reeds VASTGESTELDE versie faalt, frozen Module 3 blijft exact ongewijzigd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    const eersteResultaat = stelBegrotingVast(db, versie.id);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow();

    const frozenModule3Na = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(frozenModule3Na)).toEqual(normaliseer(eersteResultaat.module3));
  });
});
