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
import { leesFrozenCorrectiefDagelijksOnderhoudResultaat } from "./frozenCorrectiefDagelijksOnderhoudResultaat.js";
import { leesFrozenGeplandOnderhoudResultaat } from "./frozenGeplandOnderhoudResultaat.js";
import { leesFrozenModule3Resultaat, schrijfFrozenModule3Resultaat } from "./frozenModule3Resultaat.js";
import { leesFrozenBegrotingsresultaat, schrijfFrozenBegrotingsresultaat } from "./frozenResultaat.js";
import { herberekenBegroting } from "./herberekenen.js";
import { leesModule1Aannames, schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Overrides } from "./module1Overrides.js";
import { leesModule1Snapshot, schrijfModule1Snapshot } from "./module1Snapshot.js";
import { schrijfModule2Config } from "./module2Config.js";
import { leesModule3Invoer, schrijfModule3Invoer } from "./module3Invoer.js";
import { schrijfCorrectiefDagelijksOnderhoudBeoordeeld } from "./correctiefDagelijksOnderhoudBeoordeeld.js";
import {
  schrijfCorrectiefDagelijksOnderhoudRegels,
  type CorrectiefDagelijksOnderhoudRegelInvoer,
} from "./correctiefDagelijksOnderhoudRegels.js";
import { schrijfGeplandOnderhoudActiviteiten, type GeplandOnderhoudActiviteitInvoer } from "./geplandOnderhoudActiviteiten.js";
import { schrijfGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";
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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.module1.contracten).toEqual([]);
  });

  it("5. lege overrides zijn toegestaan (geen override geschreven)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
    expect(() => stelBegrotingVast(db, versie.id)).not.toThrow();
  });

  it("6. lege Module-2-config is toegestaan (geen config geschreven)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

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
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
    const eersteResultaat = stelBegrotingVast(db, versie.id);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow();

    const frozenModule3Na = leesFrozenModule3Resultaat(db, versie.id)!;
    expect(normaliseer(frozenModule3Na)).toEqual(normaliseer(eersteResultaat.module3));
  });
});

describe("stelBegrotingVast — Gepland Onderhoud lifecycle-blokkade (GO-P3)", () => {
  // GO-P3: Gepland Onderhoud krijgt als EERSTE en ENIGE module een lokale vaststel-blokkade
  // (beoordeeld !== true, of een KRITIEK-control) — Module 1/2/3 behouden hun bestaande, ongewijzigde
  // "controls blokkeren nooit"-semantiek (zie vaststellen.ts's moduledoc en test 9/22 hieronder).

  function activiteitInvoer(overrides: Partial<GeplandOnderhoudActiviteitInvoer> = {}): GeplandOnderhoudActiviteitInvoer {
    return {
      id: null,
      complexnummer: "003",
      omschrijving: "Vervangen dakbedekking",
      aanleidingType: "MJOP",
      aanleidingToelichting: "MJOP 2027 regel 14",
      q1: new Decimal(0),
      q2: new Decimal(0),
      q3: new Decimal(0),
      q4: new Decimal(0),
      status: "GEPLAND",
      leverancier: null,
      offertebedrag: null,
      notitie: null,
      ...overrides,
    };
  }

  /** Minimale, geldige Module-1/2-basis (lege snapshot) — deze tests bewijzen uitsluitend Gepland-Onderhoud-gedrag. */
  function zetMinimaleBasisNeer(versieId: string): void {
    schrijfModule1Snapshot(db, versieId, []);
    schrijfModule1Aannames(db, versieId, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versieId, MODULE3_STANDAARD);
  }

  it("11. beoordeeld=false blokkeert vaststellen, ondanks een verder volledig geldige activiteit", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]); // beoordeeld NOOIT geschreven -> false

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/niet beoordeeld/);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
    expect(leesFrozenGeplandOnderhoudResultaat(db, versie.id)).toBeNull();
    expect(leesFrozenBegrotingsresultaat(db, versie.id)).toBeNull(); // geen enkele frozen output, ook niet Module 1/2
  });

  it("12/20. beoordeeld=true + KRITIEK (leeg complexnummer) blokkeert vaststellen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ complexnummer: "" })]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/KRITIEKE controls/);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
    expect(leesFrozenGeplandOnderhoudResultaat(db, versie.id)).toBeNull();
  });

  it("13. beoordeeld=true + WAARSCHUWING (negatief kwartaal) mag vaststellen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ q1: new Decimal(-500) })]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    expect(() => stelBegrotingVast(db, versie.id)).not.toThrow();
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("VASTGESTELD");
  });

  it("14. beoordeeld=true + geen controls mag vaststellen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    expect(() => stelBegrotingVast(db, versie.id)).not.toThrow();
  });

  it("15/16. beoordeeld=true + 0 activiteiten mag vaststellen -> frozen REVIEWED_ZERO_ACTIVITIES, alle totalen 0, geen activiteit-/complexrijen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true); // 0 activiteiten
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true); // 0 regels

    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.geplandOnderhoud.reviewStatus).toBe("REVIEWED_ZERO_ACTIVITIES");

    const frozen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    expect(frozen.reviewStatus).toBe("REVIEWED_ZERO_ACTIVITIES");
    expect(frozen.totaalJaar.toString()).toBe("0");
    expect(frozen.kwartaalTotalen.q1.toString()).toBe("0");
    expect(frozen.totaalZonderGeldigComplex.toString()).toBe("0");
    expect(frozen.activiteiten).toEqual([]);
    expect(frozen.perComplex).toEqual([]);
  });

  it("17. ontbrekende omschrijving + geldbedrag: KRITIEK -> geblokkeerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ omschrijving: "", q1: new Decimal(10000) })]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/KRITIEKE controls/);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
  });

  it("18. ontbrekend/ongeldig aanleidingType: KRITIEK -> geblokkeerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ aanleidingType: null, q1: new Decimal(10000) })]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/KRITIEKE controls/);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
  });

  it("19. ongeldige status: KRITIEK -> geblokkeerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ status: "NIET_BESTAAND", q1: new Decimal(10000) })]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/KRITIEKE controls/);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
  });

  it("21. negatief kwartaal: WAARSCHUWING -> vaststellen toegestaan -> negatief exact frozen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ q1: new Decimal(-500), q2: new Decimal(1000) })]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.geplandOnderhoud.activiteiten[0]?.activiteit.q1.toString()).toBe("-500");

    const ruweRij = db
      .prepare(`SELECT q1 FROM begroting_frozen_gepland_onderhoud_activiteit WHERE begroting_versie_id = ?`)
      .get(versie.id) as { q1: string };
    expect(ruweRij.q1).toBe("-500");
    const frozen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    expect(frozen.activiteiten[0]?.activiteit.q1.toString()).toBe("-500");
  });

  it("22. Module-1-controls (dubbele override) blokkeren vaststellen nog steeds niet, naast een geldige Gepland-Onderhoud-toestand", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { complexnummer: "001" })]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule1Overrides(db, versie.id, [
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(3), scope: "VERSIE" },
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "VERSIE" },
    ]);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true); // 0 activiteiten, geen KRITIEK
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true); // 0 regels, geen KRITIEK

    const resultaat = stelBegrotingVast(db, versie.id); // mag NIET gooien ondanks de Module-1-controls
    expect(resultaat.module1.controleVereist.length).toBeGreaterThan(0);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("VASTGESTELD");
  });

  it("Module 1/2/3-vaststellingsresultaat blijft exact ongewijzigd naast een geldige (niet-blokkerende) Gepland-Onderhoud-toestand", () => {
    const versieZonder = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versieZonder.id);
    schrijfModule3Invoer(db, versieZonder.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudBeoordeeld(db, versieZonder.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versieZonder.id, true);
    const resultaatZonder = stelBegrotingVast(db, versieZonder.id);

    const versieMet = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versieMet.id);
    schrijfModule3Invoer(db, versieMet.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudActiviteiten(db, versieMet.id, [activiteitInvoer({ q1: new Decimal(-500) })]); // WAARSCHUWING, niet-blokkerend
    schrijfGeplandOnderhoudBeoordeeld(db, versieMet.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versieMet.id, true);
    const resultaatMet = stelBegrotingVast(db, versieMet.id);

    expect(normaliseer(resultaatZonder.module1)).toEqual(normaliseer(resultaatMet.module1));
    expect(normaliseer(resultaatZonder.module2)).toEqual(normaliseer(resultaatMet.module2));
    expect(normaliseer(resultaatZonder.module3)).toEqual(normaliseer(resultaatMet.module3));
  });
});

describe("stelBegrotingVast — Gepland Onderhoud: volledige pipeline en frozen read-back (GO-P3)", () => {
  function activiteitInvoer(overrides: Partial<GeplandOnderhoudActiviteitInvoer> = {}): GeplandOnderhoudActiviteitInvoer {
    return {
      id: null,
      complexnummer: "003",
      omschrijving: "Vervangen dakbedekking",
      aanleidingType: "MJOP",
      aanleidingToelichting: "MJOP 2027 regel 14",
      q1: new Decimal(0),
      q2: new Decimal(0),
      q3: new Decimal(0),
      q4: new Decimal(0),
      status: "GEPLAND",
      leverancier: null,
      offertebedrag: null,
      notitie: null,
      ...overrides,
    };
  }

  it("33-37. succesvol vaststellen met meerdere activiteiten: status VASTGESTELD, frozen module/activiteit/complex/control exact, persistentie-id behouden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    const [a, b] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      activiteitInvoer({ complexnummer: "001", q1: new Decimal(1000) }),
      activiteitInvoer({ complexnummer: "004", q3: new Decimal(750), leverancier: "Test BV", offertebedrag: new Decimal(500), notitie: "n" }),
    ]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    const resultaat = stelBegrotingVast(db, versie.id);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("VASTGESTELD");
    expect(resultaat.geplandOnderhoud.activiteiten.map((x) => x.persistentieId)).toEqual([a!.id, b!.id]);
    expect(resultaat.geplandOnderhoud.totaalJaar.toString()).toBe("1750");

    const frozen = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    expect(frozen.totaalJaar.toString()).toBe("1750");
    expect(frozen.activiteiten.map((x) => x.persistentieId)).toEqual([a!.id, b!.id]);
    expect(frozen.perComplex.map((c) => c.complexnummer)).toEqual(["001", "004"]);
    const gevondenB = frozen.activiteiten.find((x) => x.persistentieId === b!.id)!;
    expect(gevondenB.activiteit.invoer.leverancier).toBe("Test BV");
    expect(gevondenB.activiteit.invoer.offertebedrag?.toString()).toBe("500");
  });

  it("38. frozen read leest nooit opnieuw uit CONCEPT-input — concepttabellen blijven ongewijzigd, frozen output blijft stabiel over meerdere leesbeurten", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    const dump = () => ({
      activiteiten: db.prepare(`SELECT * FROM begroting_gepland_onderhoud_activiteit`).all(),
      module: db.prepare(`SELECT * FROM begroting_gepland_onderhoud_module`).all(),
    });
    const voor = dump();
    const resultaat = stelBegrotingVast(db, versie.id);
    const na = dump();
    expect(na).toEqual(voor); // concept-input volledig ongewijzigd door vaststellen

    // `leesFrozenGeplandOnderhoudResultaat` bevat (zie frozenGeplandOnderhoudResultaat.ts) geen enkele
    // aanroep van `leesGeplandOnderhoudActiviteiten`/`leesGeplandOnderhoudBeoordeeld`/
    // `berekenBegroteGeplandOnderhoud` — twee opeenvolgende leesbeurten zijn dus per definitie stabiel,
    // ongeacht wat er verder met de (nu toch al immutable) concept-tabellen zou gebeuren.
    const eersteLeesbeurt = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    const tweedeLeesbeurt = leesFrozenGeplandOnderhoudResultaat(db, versie.id)!;
    expect(normaliseer(eersteLeesbeurt)).toEqual(normaliseer(tweedeLeesbeurt));
    expect(normaliseer(eersteLeesbeurt)).toEqual(normaliseer(resultaat.geplandOnderhoud));
  });
});

describe("stelBegrotingVast — Gepland Onderhoud atomiciteit (GO-P3)", () => {
  function activiteitInvoer(overrides: Partial<GeplandOnderhoudActiviteitInvoer> = {}): GeplandOnderhoudActiviteitInvoer {
    return {
      id: null,
      complexnummer: "003",
      omschrijving: "Vervangen dakbedekking",
      aanleidingType: "MJOP",
      aanleidingToelichting: "MJOP 2027 regel 14",
      q1: new Decimal(0),
      q2: new Decimal(0),
      q3: new Decimal(0),
      q4: new Decimal(0),
      status: "GEPLAND",
      leverancier: null,
      offertebedrag: null,
      notitie: null,
      ...overrides,
    };
  }

  it("31. geforceerde fout tijdens schrijven frozen Gepland Onderhoud laat volledige rollback zien — status blijft CONCEPT, geen enkele frozen output (Module 1/2/3/GO)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    // Test-only trigger: blokkeert ELKE INSERT op de GO-activiteit-frozen-tabel — die wordt, volgens de
    // schrijfvolgorde in vaststellen.ts, bereikt NADAT Module 1/2 EN Module 3 al succesvol binnen DEZE
    // poging zijn (her)geschreven. Geen productiecode aangepast, uitsluitend een extra, tijdelijke trigger
    // in deze ene testdatabase.
    db.exec(`
      CREATE TRIGGER test_forceer_schrijffout_go_activiteit
      BEFORE INSERT ON begroting_frozen_gepland_onderhoud_activiteit
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'test: geforceerde schrijffout tijdens Gepland-Onderhoud-frozen-write');
      END;
    `);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/geforceerde schrijffout tijdens Gepland-Onderhoud-frozen-write/);

    const naMislukking = leesBegrotingsversie(db, versie.id)!;
    expect(naMislukking.status).toBe("CONCEPT");
    expect(naMislukking.vastgesteldAt).toBeNull();
    expect(leesFrozenBegrotingsresultaat(db, versie.id)).toBeNull();
    expect(leesFrozenModule3Resultaat(db, versie.id)).toBeNull();
    expect(leesFrozenGeplandOnderhoudResultaat(db, versie.id)).toBeNull();
  });

  it("32. geforceerde fout NA geslaagde GO-frozen-writes maar vóór de statuswijziging laat volledige rollback zien (hardste bewijs)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    // Test-only trigger: blokkeert specifiek de CONCEPT→VASTGESTELD-overgang zelf. Op het moment dat deze
    // vuurt, zijn Module 1, Module 2, Module 3 ÉN Gepland Onderhoud binnen DEZE mislukte poging al
    // succesvol (her)geschreven — het hardste bewijs dat de volledige transactie, inclusief Gepland
    // Onderhoud, atomair is.
    db.exec(`
      CREATE TRIGGER test_blokkeer_statusflip_go
      BEFORE UPDATE ON begrotingsversies
      FOR EACH ROW
      WHEN NEW.status = 'VASTGESTELD' AND OLD.status = 'CONCEPT'
      BEGIN
        SELECT RAISE(ABORT, 'test: geforceerde statusflip-fout (gepland onderhoud)');
      END;
    `);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/geforceerde statusflip-fout \(gepland onderhoud\)/);

    const naMislukking = leesBegrotingsversie(db, versie.id)!;
    expect(naMislukking.status).toBe("CONCEPT");
    expect(naMislukking.vastgesteldAt).toBeNull();
    expect(leesFrozenGeplandOnderhoudResultaat(db, versie.id)).toBeNull();
    expect(leesFrozenBegrotingsresultaat(db, versie.id)).toBeNull();
    expect(leesFrozenModule3Resultaat(db, versie.id)).toBeNull();
  });
});

describe("stelBegrotingVast — Correctief/Dagelijks Onderhoud lifecycle-blokkade (CD-P3)", () => {
  // CD-P3: Correctief/Dagelijks Onderhoud krijgt, exact zoals Gepland Onderhoud (GO-P3) hierboven, een
  // lokale vaststel-blokkade (beoordeeld !== true, of een KRITIEK-control) — Module 1/2/3 en Gepland
  // Onderhoud behouden hun bestaande, ongewijzigde semantiek (zie vaststellen.ts's moduledoc en test 8
  // hieronder). Dit vervangt de eerdere CD-P1/CD-P2-tussenfase (waar deze blokkade nog niet bestond).

  function regelInvoer(overrides: Partial<CorrectiefDagelijksOnderhoudRegelInvoer> = {}): CorrectiefDagelijksOnderhoudRegelInvoer {
    return {
      id: null,
      omschrijving: "Reparatie CV-installatie",
      complexnummer: "003",
      jaarbedrag: new Decimal(1200),
      ...overrides,
    };
  }

  /**
   * Minimale, geldige Module-1/2/3-basis (lege snapshot) — deze tests bewijzen uitsluitend
   * Correctief/Dagelijks-gedrag. Gepland Onderhoud wordt hier bewust op `beoordeeld=true` + 0
   * activiteiten gezet — dat is Gepland Onderhoud's EIGEN, bestaande GO-P3-blokkade (zie hierboven)
   * ongewijzigd geneutraliseerd, zodat deze tests niet per ongeluk GO's blokkade bewijzen in plaats
   * van CD's eigen blokkade.
   */
  function zetMinimaleBasisNeer(versieId: string): void {
    schrijfModule1Snapshot(db, versieId, []);
    schrijfModule1Aannames(db, versieId, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versieId, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudBeoordeeld(db, versieId, true);
  }

  it("1. beoordeeld=false blokkeert vaststellen, ondanks een verder volledig geldige regel", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]); // beoordeeld NOOIT geschreven -> false

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/niet beoordeeld/);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
    expect(leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)).toBeNull();
    expect(leesFrozenBegrotingsresultaat(db, versie.id)).toBeNull(); // geen enkele frozen output, ook niet Module 1/2
  });

  it("2. beoordeeld=true + KRITIEK (lege omschrijving) blokkeert vaststellen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ omschrijving: "" })]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/KRITIEKE controls/);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
    expect(leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)).toBeNull();
  });

  it("3. beoordeeld=true + KRITIEK (jaarbedrag=null) blokkeert vaststellen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ jaarbedrag: null })]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/KRITIEKE controls/);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
    expect(leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)).toBeNull();
  });

  it("4. beoordeeld=true + KRITIEK (jaarbedrag=NaN, via de concept-persistence heen) blokkeert vaststellen", () => {
    // `Decimal(NaN).toString()` levert de string "NaN" op, die de concept-persistence (jaarbedrag TEXT
    // NULL, geen CHECK op inhoud) ongewijzigd opslaat/teruggeeft als `Decimal("NaN")` — dus praktisch
    // bereikbaar via het bestaande persistence-pad, geen kunstmatige nieuwe businessvalidatie nodig.
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ jaarbedrag: new Decimal(NaN) })]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/KRITIEKE controls/);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("CONCEPT");
  });

  it("5. beoordeeld=true + WAARSCHUWING (negatief bedrag) mag vaststellen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ jaarbedrag: new Decimal(-500) })]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    expect(() => stelBegrotingVast(db, versie.id)).not.toThrow();
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("VASTGESTELD");
  });

  it("6. beoordeeld=true + geen controls mag vaststellen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    expect(() => stelBegrotingVast(db, versie.id)).not.toThrow();
  });

  it("7. beoordeeld=true + 0 regels mag vaststellen -> frozen REVIEWED_ZERO_RULES, totaalJaar 0, geen regelrijen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true); // 0 regels

    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud.reviewStatus).toBe("REVIEWED_ZERO_RULES");

    const frozen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(frozen.reviewStatus).toBe("REVIEWED_ZERO_RULES");
    expect(frozen.beoordeeld).toBe(true);
    expect(frozen.totaalJaar.toString()).toBe("0");
    expect(frozen.regels).toEqual([]);
  });

  it("8. negatief bedrag: WAARSCHUWING -> vaststellen toegestaan -> exact negatief frozen, totaalJaar inclusief negatief bedrag", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [
      regelInvoer({ jaarbedrag: new Decimal(-300) }),
      regelInvoer({ jaarbedrag: new Decimal(1000) }),
    ]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud.totaalJaar.toString()).toBe("700");

    const ruweRijen = db
      .prepare(`SELECT jaarbedrag FROM begroting_frozen_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = ? ORDER BY regel_id`)
      .all(versie.id) as { jaarbedrag: string }[];
    expect(ruweRijen.map((r) => r.jaarbedrag)).toEqual(["-300", "1000"]);

    const frozen = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(frozen.totaalJaar.toString()).toBe("700");
  });

  it("9. Module-1-controls (dubbele override) blokkeren vaststellen nog steeds niet, naast een geldige Correctief/Dagelijks-toestand", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { complexnummer: "001" })]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule1Overrides(db, versie.id, [
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(3), scope: "VERSIE" },
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "VERSIE" },
    ]);
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true); // 0 regels, geen KRITIEK

    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.module1.controleVereist.some((c) => c.contractnummer === "0000000028" && c.bericht.includes("meerdere indexatiepercentage-overrides"))).toBe(true);
    expect(leesBegrotingsversie(db, versie.id)!.status).toBe("VASTGESTELD");
  });

  it("10. het vastgestelde resultaat bevat correctiefDagelijksOnderhoud (VastgesteldeBegroting uitgebreid, CD-P3)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetMinimaleBasisNeer(versie.id);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud).toBeDefined();
    expect(resultaat.correctiefDagelijksOnderhoud.totaalJaar.toString()).toBe("1200");
  });
});

describe("stelBegrotingVast — Correctief/Dagelijks Onderhoud atomiciteit (CD-P3)", () => {
  function regelInvoer(overrides: Partial<CorrectiefDagelijksOnderhoudRegelInvoer> = {}): CorrectiefDagelijksOnderhoudRegelInvoer {
    return {
      id: null,
      omschrijving: "Reparatie CV-installatie",
      complexnummer: "003",
      jaarbedrag: new Decimal(1200),
      ...overrides,
    };
  }

  function zetGeldigeBasisNeer(versieId: string): void {
    schrijfModule1Snapshot(db, versieId, []);
    schrijfModule1Aannames(db, versieId, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versieId, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudBeoordeeld(db, versieId, true);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versieId, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versieId, true);
  }

  it("11. geforceerde fout tijdens schrijven frozen Correctief/Dagelijks Onderhoud laat volledige rollback zien — status blijft CONCEPT, geen enkele frozen output (Module 1/2/3/GO/CD)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetGeldigeBasisNeer(versie.id);

    db.exec(
      `CREATE TRIGGER test_blokkeer_frozen_cd_insert
       BEFORE INSERT ON begroting_frozen_correctief_dagelijks_onderhoud_resultaat
       FOR EACH ROW
       BEGIN
         SELECT RAISE(ABORT, 'geforceerde schrijffout tijdens Correctief-Dagelijks-frozen-write');
       END;`,
    );

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/geforceerde schrijffout tijdens Correctief-Dagelijks-frozen-write/);

    const naMislukking = leesBegrotingsversie(db, versie.id)!;
    expect(naMislukking.status).toBe("CONCEPT");
    expect(naMislukking.vastgesteldAt).toBeNull();
    expect(leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)).toBeNull();
    expect(leesFrozenGeplandOnderhoudResultaat(db, versie.id)).toBeNull();
    expect(leesFrozenModule3Resultaat(db, versie.id)).toBeNull();
    expect(leesFrozenBegrotingsresultaat(db, versie.id)).toBeNull();
  });

  it("12. geforceerde fout NA geslaagde CD-frozen-writes maar vóór de statuswijziging laat volledige rollback zien (hardste bewijs)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zetGeldigeBasisNeer(versie.id);

    // De trigger vuurt uitsluitend op de UPDATE die de status naar VASTGESTELD zet — op het moment dat
    // hij vuurt, zijn Module 1, Module 2, Module 3, Gepland Onderhoud ÉN Correctief/Dagelijks Onderhoud
    // binnen DEZE mislukte poging al succesvol (her)geschreven — het hardste bewijs dat de volledige
    // transactie, inclusief Correctief/Dagelijks Onderhoud, atomair is.
    db.exec(`
      CREATE TRIGGER test_blokkeer_statusflip_cd
      BEFORE UPDATE ON begrotingsversies
      FOR EACH ROW
      WHEN NEW.status = 'VASTGESTELD' AND OLD.status = 'CONCEPT'
      BEGIN
        SELECT RAISE(ABORT, 'test: geforceerde statusflip-fout (correctief dagelijks)');
      END;
    `);

    expect(() => stelBegrotingVast(db, versie.id)).toThrow(/geforceerde statusflip-fout \(correctief dagelijks\)/);

    const naMislukking = leesBegrotingsversie(db, versie.id)!;
    expect(naMislukking.status).toBe("CONCEPT");
    expect(naMislukking.vastgesteldAt).toBeNull();
    expect(leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)).toBeNull();
    expect(leesFrozenGeplandOnderhoudResultaat(db, versie.id)).toBeNull();
    expect(leesFrozenBegrotingsresultaat(db, versie.id)).toBeNull();
    expect(leesFrozenModule3Resultaat(db, versie.id)).toBeNull();
  });
});

describe("stelBegrotingVast — Correctief/Dagelijks Onderhoud immutability (CD-P3)", () => {
  function regelInvoer(overrides: Partial<CorrectiefDagelijksOnderhoudRegelInvoer> = {}): CorrectiefDagelijksOnderhoudRegelInvoer {
    return {
      id: null,
      omschrijving: "Reparatie CV-installatie",
      complexnummer: "003",
      jaarbedrag: new Decimal(1200),
      ...overrides,
    };
  }

  it("13. na vaststellen zijn INSERT/UPDATE/DELETE op alle drie frozen Correctief/Dagelijks-tabellen geblokkeerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
    stelBegrotingVast(db, versie.id);

    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_resultaat
             (begroting_versie_id, totaal_jaar, beoordeeld, review_status)
           VALUES (?, '0', 1, 'REVIEWED_ZERO_RULES')`,
        )
        .run("een-andere-versie-id"),
    ).toThrow(/immutable|FOREIGN KEY/);
    expect(() =>
      db.prepare(`UPDATE begroting_frozen_correctief_dagelijks_onderhoud_resultaat SET totaal_jaar = '999' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`DELETE FROM begroting_frozen_correctief_dagelijks_onderhoud_resultaat WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);

    expect(() =>
      db.prepare(`UPDATE begroting_frozen_correctief_dagelijks_onderhoud_regel SET omschrijving = 'x' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare(`DELETE FROM begroting_frozen_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/immutable/);

    expect(() =>
      db
        .prepare(`INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, 99, 'INFORMATIEF', 'x')`)
        .run(versie.id),
    ).toThrow(/immutable/);
  });

  it("14. concept-input-immutability uit migratie 10 blijft ongewijzigd geblokkeerd na vaststellen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    const [regel] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
    stelBegrotingVast(db, versie.id);

    expect(() =>
      db.prepare(`UPDATE begroting_correctief_dagelijks_onderhoud_regel SET omschrijving = 'x' WHERE id = ?`).run(regel!.id),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_correctief_dagelijks_onderhoud_regel WHERE id = ?`).run(regel!.id)).toThrow(/immutable/);
  });
});

describe("stelBegrotingVast — Correctief/Dagelijks Onderhoud frozen-onafhankelijkheid (CD-P3)", () => {
  function regelInvoer(overrides: Partial<CorrectiefDagelijksOnderhoudRegelInvoer> = {}): CorrectiefDagelijksOnderhoudRegelInvoer {
    return {
      id: null,
      omschrijving: "Reparatie CV-installatie",
      complexnummer: "003",
      jaarbedrag: new Decimal(1200),
      ...overrides,
    };
  }

  it("15. leesFrozenCorrectiefDagelijksOnderhoudResultaat blijft na vaststellen stabiel, ook al zou concept-data ná afloop wijzigen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, versie.id, MODULE3_STANDAARD);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ jaarbedrag: new Decimal(1200) })]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
    stelBegrotingVast(db, versie.id);

    const vóórDirecteMutatie = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(vóórDirecteMutatie.totaalJaar.toString()).toBe("1200");

    // Rechtstreekse, buiten-de-API-om SQL-mutatie van de CONCEPT-regeltabel — uitsluitend om aan te tonen
    // dat de frozen read deze tabel structureel niet meer raadpleegt (de trigger zou een schrijf via de
    // normale write-API sowieso al blokkeren; deze directe SQL omzeilt uitsluitend de test-opzet, niet de
    // productielogica van de frozen read zelf).
    db.exec(`DROP TRIGGER trg_begroting_correctief_dagelijks_onderhoud_regel_vastgesteld_no_update`);
    db.prepare(`UPDATE begroting_correctief_dagelijks_onderhoud_regel SET jaarbedrag = '999999' WHERE begroting_versie_id = ?`).run(versie.id);

    const náDirecteMutatie = leesFrozenCorrectiefDagelijksOnderhoudResultaat(db, versie.id)!;
    expect(náDirecteMutatie.totaalJaar.toString()).toBe("1200"); // ongewijzigd — frozen read leest nooit de concept-tabel
  });
});
