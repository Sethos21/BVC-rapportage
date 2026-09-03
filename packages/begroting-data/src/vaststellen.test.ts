import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BgContractFeiten } from "@bvc/reporting";
import {
  leesBegrotingsversie,
  maakBegrotingsversie,
  verwijderConceptVersie,
  wijzigConceptNaamNotitie,
  type NieuweBegrotingsversieInput,
} from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenBegrotingsresultaat, schrijfFrozenBegrotingsresultaat } from "./frozenResultaat.js";
import { herberekenBegroting } from "./herberekenen.js";
import { leesModule1Aannames, schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Overrides } from "./module1Overrides.js";
import { leesModule1Snapshot, schrijfModule1Snapshot } from "./module1Snapshot.js";
import { schrijfModule2Config } from "./module2Config.js";
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
    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.module1.contracten).toEqual([]);
  });

  it("5. lege overrides zijn toegestaan (geen override geschreven)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    expect(() => stelBegrotingVast(db, versie.id)).not.toThrow();
  });

  it("6. lege Module-2-config is toegestaan (geen config geschreven)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    const resultaat = stelBegrotingVast(db, versie.id);
    expect(resultaat.module2.complexen).toEqual([]);
  });
});

describe("stelBegrotingVast — recomputatie tegen huidige input, niet tegen oude frozen output", () => {
  it("7+8+10. huidige persisted inputs worden gebruikt; bestaande tijdelijke (afwijkende) frozen output wordt volledig vervangen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });

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

    const timestamp = new Date("2026-12-20T10:15:30.123Z");
    const resultaat = stelBegrotingVast(db, versie.id, timestamp);

    expect(resultaat.versie.status).toBe("VASTGESTELD");
    expect(resultaat.versie.vastgesteldAt).toEqual(timestamp);

    const ruweRij = db.prepare(`SELECT vastgesteld_at FROM begrotingsversies WHERE id = ?`).get(versie.id) as { vastgesteld_at: string };
    expect(ruweRij.vastgesteld_at).toBe("2026-12-20T10:15:30.123Z");

    const reread = leesBegrotingsversie(db, versie.id)!;
    expect(reread.vastgesteldAt).toEqual(timestamp);
  });

  it("12. leesFrozenBegrotingsresultaat na afloop is inhoudelijk exact gelijk aan de teruggegeven module1/module2", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);

    const resultaat = stelBegrotingVast(db, versie.id, new Date("2026-12-20T10:15:30.123Z"));
    const gelezen = leesFrozenBegrotingsresultaat(db, versie.id)!;

    expect(normaliseer(gelezen.module1)).toEqual(normaliseer(resultaat.module1));
    expect(normaliseer(gelezen.module2)).toEqual(normaliseer(resultaat.module2));
  });

  it("13. inputtabellen (snapshot, aannames, overrides, config) blijven volledig ongewijzigd na succesvolle vaststelling", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);

    const dump = () => ({
      snapshot: db.prepare(`SELECT * FROM begroting_contract_snapshot`).all(),
      rentroll: db.prepare(`SELECT * FROM begroting_contract_rentroll_component`).all(),
      korting: db.prepare(`SELECT * FROM begroting_contract_kortingswijziging`).all(),
      aannames: db.prepare(`SELECT * FROM begroting_aannames`).all(),
      overrides: db.prepare(`SELECT * FROM begroting_contract_override`).all(),
      configs: db.prepare(`SELECT * FROM begroting_complex_config`).all(),
    });

    const voor = dump();
    stelBegrotingVast(db, versie.id);
    const na = dump();

    expect(na).toEqual(voor);
  });
});

describe("stelBegrotingVast — immutability na vaststellen (alle publieke write-API's)", () => {
  it("14+15. wijzigConceptNaamNotitie, verwijderConceptVersie, alle schrijf-API's, schrijfFrozenBegrotingsresultaat en een tweede stelBegrotingVast falen allemaal", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    zet070InputNeer(versie.id);
    const resultaat = stelBegrotingVast(db, versie.id);

    expect(() => wijzigConceptNaamNotitie(db, versie.id, { naam: "mag niet" })).toThrow();
    expect(() => verwijderConceptVersie(db, versie.id)).toThrow();
    expect(() => schrijfModule1Snapshot(db, versie.id, [maakContract("0000000001")])).toThrow();
    expect(() => schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(9) })).toThrow();
    expect(() => schrijfModule1Overrides(db, versie.id, [])).toThrow();
    expect(() => schrijfModule2Config(db, versie.id, [])).toThrow();
    expect(() => schrijfFrozenBegrotingsresultaat(db, versie.id, resultaat)).toThrow();
    expect(() => stelBegrotingVast(db, versie.id)).toThrow();
  });
});

describe("stelBegrotingVast — atomiciteit / rollback", () => {
  it("16. een échte pure Module-1-hard-error (meerdere bedrijfsnr's) laat volledige rollback zien: CONCEPT, vastgesteld_at null, oude frozen output en inputs onaangetast", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { bedrijfsnr: "070" })]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });

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

    expect(() => schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(1) })).toThrow();
    expect(leesModule1Snapshot(db, versie.id).map((c) => c.contractnummer)).toEqual(["0000000049"]); // ongewijzigd
  });
});
