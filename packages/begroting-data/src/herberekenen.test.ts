import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BgBeheerComplexConfig, BgContractFeiten, BgContractOverride, BgHuurAannames } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { herberekenBegroting } from "./herberekenen.js";
import { schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Overrides } from "./module1Overrides.js";
import { schrijfModule1Snapshot } from "./module1Snapshot.js";
import { schrijfModule2Config } from "./module2Config.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-herberekenen-"));
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

const STANDAARD_AANNAMES: BgHuurAannames = { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) };

/** Zet een minimaal geldige CONCEPT-versie neer: lege snapshot + aannames — voldoende om herberekenBegroting te laten slagen. */
function maakMinimaalGeldigeConceptVersie() {
  const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
  schrijfModule1Snapshot(db, versie.id, []);
  schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
  return versie;
}

describe("herberekenBegroting — status/bestaan/verplichte input", () => {
  it("1. een niet-bestaande versie geeft een duidelijke fout", () => {
    expect(() => herberekenBegroting(db, "bestaat-niet")).toThrow(/bestaat niet/);
  });

  it("2. een VASTGESTELDE versie wordt geweigerd", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    markeerVastgesteld(db, versie.id, new Date());
    expect(() => herberekenBegroting(db, versie.id)).toThrow(/VASTGESTELD/);
  });

  it("3. ontbrekende Module-1-aannames geven een duidelijke fout", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []); // wel een snapshot, bewust GEEN aannames
    expect(() => herberekenBegroting(db, versie.id)).toThrow(/aannames/i);
  });

  it("4. lege overrides zijn toegestaan (geen override geschreven)", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    expect(() => herberekenBegroting(db, versie.id)).not.toThrow();
  });

  it("5. lege Module-2-config is toegestaan (geen config geschreven)", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.module2.complexen).toEqual([]);
  });
});

describe("herberekenBegroting — autoritatieve velden", () => {
  it("6. de bevroren snapshot wordt daadwerkelijk gebruikt", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.module1.contracten.map((c) => c.contractnummer)).toEqual(["0000000028"]);
  });

  it("7. bronPeildatum in het Module-1-resultaat komt exact uit de versie", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.module1.bronPeildatum).toEqual(versie.bronPeildatum);
    expect(resultaat.module1.bronPeildatum).toEqual(NIEUWE_VERSIE_INPUT.bronPeildatum);
  });

  it("8. begrotingsjaar in het Module-1-resultaat komt exact uit de versie/aannames", () => {
    const versie = maakMinimaalGeldigeConceptVersie(); // begrotingsjaar 2027
    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.module1.begrotingsjaar).toBe(2027);
    expect(resultaat.versie.begrotingsjaar).toBe(2027);
  });
});

describe("herberekenBegroting — override/kortingswijziging bereiken de pure berekening", () => {
  it("9. een Module-1-override bereikt de pure berekening (indexatiePercentageBron wordt OVERRIDE)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES); // algemeen 3%
    const override: BgContractOverride = { contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "VERSIE" };
    schrijfModule1Overrides(db, versie.id, [override]);

    const resultaat = herberekenBegroting(db, versie.id);
    const contract = resultaat.module1.contracten.find((c) => c.contractnummer === "0000000028")!;
    expect(contract.indexatiePercentageBron).toBe("OVERRIDE");
    expect(contract.indexatiePercentageGebruikt.toString()).toBe("5");
  });

  it("10. een toekomstige VS13-kortingswijziging uit de frozen snapshot bereikt de pure berekening", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [
      maakContract("0000000049", {
        rentrollComponenten: [
          { vorderingsoort: "01", bedragJaar: new Decimal(12777.36), btwYn: "Y" },
          { vorderingsoort: "13", bedragJaar: new Decimal(-6000), btwYn: "Y" },
        ],
        toekomstigeKortingswijzigingen: [{ ingangsdatum: new Date(Date.UTC(2027, 6, 1)), nieuweKortingPerMaand: new Decimal(0) }],
      }),
    ]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);

    const resultaat = herberekenBegroting(db, versie.id);
    const contract = resultaat.module1.contracten.find((c) => c.contractnummer === "0000000049")!;
    const juni = contract.regels.find((r) => r.maand === 6)!;
    const juli = contract.regels.find((r) => r.maand === 7)!;
    expect(juni.huurkorting.toString()).toBe("500");
    expect(juli.huurkorting.toString()).toBe("0");
    expect(juli.kortingswijzigingToegepast).toEqual(new Date(Date.UTC(2027, 6, 1)));
  });
});

describe("herberekenBegroting — Module 1 → Module 2 doorgifte", () => {
  function maakVersieMetComplex(): string {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [
      maakContract("0000000028", { complexnummer: "001", rentrollComponenten: [{ vorderingsoort: "01", bedragJaar: new Decimal(37318.8), btwYn: "Y" }] }),
    ]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
    return versie.id;
  }

  it("11. het Module-1-resultaat wordt daadwerkelijk aan Module 2 doorgegeven (zelfde netto-huurgrondslag)", () => {
    const versieId = maakVersieMetComplex();
    schrijfModule2Config(db, versieId, [{ complexnummer: "001", vastBedragJaar: null, vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: new Decimal(6) }]);

    const resultaat = herberekenBegroting(db, versieId);
    const module1NettoHuurComplex001 = resultaat.module1.contracten
      .filter((c) => c.complexnummer === "001")
      .reduce((som, c) => som.plus(c.jaartotaal.nettoHuur), new Decimal(0));

    const complex001 = resultaat.module2.complexen.find((c) => c.complexnummer === "001")!;
    expect(complex001.jaartotaal.nettoHuurGrondslag.toString()).toBe(module1NettoHuurComplex001.toString());
  });

  it("12. de variabele Module-2-fee is gebaseerd op de berekende NETTO Module-1-huur, niet bruto", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [
      maakContract("0000000049", {
        complexnummer: "001",
        rentrollComponenten: [
          { vorderingsoort: "01", bedragJaar: new Decimal(12777.36), btwYn: "Y" },
          { vorderingsoort: "13", bedragJaar: new Decimal(-6000), btwYn: "Y" }, // korting: netto ≠ bruto
        ],
      }),
    ]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "001", vastBedragJaar: null, vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: new Decimal(10) },
    ]);

    const resultaat = herberekenBegroting(db, versie.id);
    const module1Contract = resultaat.module1.contracten[0]!;
    const complex = resultaat.module2.complexen[0]!;
    // Variabele vergoeding maand-voor-maand = 10% × Module-1's NETTO huur van diezelfde maand (nooit bruto).
    for (let maand = 1; maand <= 12; maand += 1) {
      const module1Regel = module1Contract.regels.find((r) => r.maand === maand)!;
      const module2Regel = complex.regels.find((r) => r.maand === maand)!;
      expect(module2Regel.variabeleVergoeding.toString()).toBe(module1Regel.nettoHuur.times(10).dividedBy(100).toString());
    }
  });

  it("13. de vaste Module-2-fee werkt in dezelfde end-to-end-call", () => {
    const versieId = maakVersieMetComplex();
    schrijfModule2Config(db, versieId, [
      { complexnummer: "001", vastBedragJaar: new Decimal(12000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
    ]);

    const resultaat = herberekenBegroting(db, versieId);
    const complex = resultaat.module2.complexen.find((c) => c.complexnummer === "001")!;
    expect(complex.vastToegepast).toBe(true);
    expect(complex.jaartotaal.vastNaIndexatie.toString()).toBe("12000");
  });
});

describe("herberekenBegroting — determinisme en read-only-garantie", () => {
  it("14. twee identieke herberekeningen geven identieke resultaten", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [
      maakContract("0000000049", {
        rentrollComponenten: [
          { vorderingsoort: "01", bedragJaar: new Decimal(12777.36), btwYn: "Y" },
          { vorderingsoort: "13", bedragJaar: new Decimal(-6000), btwYn: "Y" },
        ],
        toekomstigeKortingswijzigingen: [{ ingangsdatum: new Date(Date.UTC(2027, 6, 1)), nieuweKortingPerMaand: new Decimal(0) }],
      }),
    ]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "001", vastBedragJaar: new Decimal(1000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: new Decimal(6) },
    ]);

    const eersteKeer = herberekenBegroting(db, versie.id);
    const tweedeKeer = herberekenBegroting(db, versie.id);

    // Genormaliseerde presentatie voor vergelijking (Decimal/Date zijn per instantie een ander object,
    // maar moeten inhoudelijk exact gelijk zijn) — verandert niets aan productie-output.
    expect(JSON.stringify(eersteKeer.module1, (_key, value) => (value instanceof Decimal ? value.toString() : value))).toBe(
      JSON.stringify(tweedeKeer.module1, (_key, value) => (value instanceof Decimal ? value.toString() : value)),
    );
    expect(JSON.stringify(eersteKeer.module2, (_key, value) => (value instanceof Decimal ? value.toString() : value))).toBe(
      JSON.stringify(tweedeKeer.module2, (_key, value) => (value instanceof Decimal ? value.toString() : value)),
    );
  });

  it("15. de database-inhoud vóór en ná herberekenen is exact onveranderd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
    schrijfModule1Overrides(db, versie.id, [{ contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "VERSIE" }]);
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "001", vastBedragJaar: new Decimal(1000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: new Decimal(6) },
    ]);

    const dump = () => ({
      versies: db.prepare(`SELECT * FROM begrotingsversies`).all(),
      snapshot: db.prepare(`SELECT * FROM begroting_contract_snapshot`).all(),
      rentroll: db.prepare(`SELECT * FROM begroting_contract_rentroll_component`).all(),
      korting: db.prepare(`SELECT * FROM begroting_contract_kortingswijziging`).all(),
      aannames: db.prepare(`SELECT * FROM begroting_aannames`).all(),
      overrides: db.prepare(`SELECT * FROM begroting_contract_override`).all(),
      configs: db.prepare(`SELECT * FROM begroting_complex_config`).all(),
    });

    const voor = dump();
    herberekenBegroting(db, versie.id);
    const na = dump();

    expect(na).toEqual(voor);
  });
});

describe("herberekenBegroting — foutpropagatie", () => {
  it("16. een structurele Module-1-hard-error (meerdere bedrijfsnr's) wordt niet verborgen", () => {
    // Deze exacte foutconditie kan niet via de normale schrijf-API of via gewone directe SQL worden
    // aangemaakt: zowel `schrijfModule1Snapshot` als de DB-trigger `trg_begroting_contract_snapshot_
    // bedrijfsnr_insert` (1D.3) verbieden een afwijkend bedrijfsnr op een snapshotrij structureel — dat
    // is precies de bedoelde defensie-in-de-diepte. Om de ONDERLIGGENDE pure Module-1-fail-fast zelf
    // (niet de DB-laag ervoor) te bewijzen, wordt de trigger in DEZE ene, geïsoleerde test-database
    // bewust tijdelijk verwijderd — uitsluitend om de al bestaande, goedgekeurde pure-laag-invariant
    // ("exact één administratie per aanroep") te bereiken en te bevestigen dat herberekenBegroting die
    // fout ongewijzigd doorlaat, niet vervangt door een stille lege uitkomst.
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { bedrijfsnr: "070" })]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);

    db.exec(`DROP TRIGGER trg_begroting_contract_snapshot_bedrijfsnr_insert`);
    db.prepare(
      `INSERT INTO begroting_contract_snapshot
         (begroting_versie_id, contractnummer, bedrijfsnr, huurdernummer, huurder_naam, complexnummer, ingangsdatum, einddatum, indexatiedatum, indexatie_herhaling_maanden)
       VALUES (?, '0000000099', '010', NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
    ).run(versie.id);

    expect(() => herberekenBegroting(db, versie.id)).toThrow(/exact één administratie per aanroep/);
  });

  it("17. Module-2-validatie/controles blijven ongewijzigd zichtbaar (meervoudige config = KRITIEK, geen berekening voor dat complex)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { complexnummer: "001" })]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "001", vastBedragJaar: new Decimal(1000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
      { complexnummer: "001", vastBedragJaar: new Decimal(2000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
    ]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(
      resultaat.module2.controleVereist.some(
        (c) => c.ernst === "KRITIEK" && c.complexnummer === "001" && c.bericht.includes("beheerconfiguraties"),
      ),
    ).toBe(true);
  });
});

describe("herberekenBegroting — geen deduplicatie in de orchestratielaag zelf", () => {
  it("18. meerdere duplicate overrides voor hetzelfde contract worden niet in orchestration gededupliceerd (Module 1 ziet ze allebei)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
    schrijfModule1Overrides(db, versie.id, [
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(3), scope: "VERSIE" },
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "VERSIE" },
    ]);

    const resultaat = herberekenBegroting(db, versie.id);
    // Module 1's eigen, bestaande dubbele-override-melding moet zichtbaar zijn — bewijst dat de
    // orchestratielaag beide rijen ongewijzigd doorgeeft, zelf niets wegfiltert.
    expect(
      resultaat.module1.controleVereist.some((c) => c.contractnummer === "0000000028" && c.bericht.includes("meerdere indexatiepercentage-overrides")),
    ).toBe(true);
  });

  it("19. meerdere duplicate Module-2-configs voor hetzelfde complex worden niet in orchestration gededupliceerd (Module 2 ziet ze allebei)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { complexnummer: "001" })]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "001", vastBedragJaar: new Decimal(1000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
      { complexnummer: "001", vastBedragJaar: new Decimal(2000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
    ]);

    const resultaat = herberekenBegroting(db, versie.id);
    const complex001 = resultaat.module2.complexen.find((c) => c.complexnummer === "001")!;
    // Geen berekening voor dit complex (Module 2's bestaande gedrag bij een meervoudige config) — bewijst
    // dat beide rijen zijn doorgegeven en Module 2 zelf de dubbele-config-situatie heeft herkend.
    expect(complex001.vastToegepast).toBe(false);
    expect(complex001.variabelToegepast).toBe(false);
  });
});

describe("herberekenBegroting — 070-integratietest (echte, eerder bewezen bronwaarden)", () => {
  it("20. persistence → orchestration → pure modules: snapshot, aanname, override en toekomstige VS13-wijziging bereiken samen Module 1 én Module 2", () => {
    // Echte, in dit project al bewezen 070-waarden (contract 049): bruto jaarhuur 12.777,36, huidige
    // korting -500/mnd, bronfeit-bewezen wijziging naar 0 per 01-07-2027. bronPeildatum 31-07-2026 is de
    // eerder bewezen 070-bronpeildatum uit hetzelfde onderzoek.
    const versie = maakBegrotingsversie(db, {
      originType: "NIEUW",
      bedrijfsnr: "070",
      begrotingsjaar: 2027,
      bronPeildatum: new Date(Date.UTC(2026, 6, 31)),
    });

    schrijfModule1Snapshot(db, versie.id, [
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
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule1Overrides(db, versie.id, [{ contractnummer: "0000000049", indexatiePercentage: new Decimal(5), scope: "VERSIE" }]);
    const module2Config: BgBeheerComplexConfig = {
      complexnummer: "001",
      vastBedragJaar: new Decimal(12000),
      vastIndexatiePercentage: null,
      vastIndexatiedatum: null,
      variabelPercentage: new Decimal(6),
    };
    schrijfModule2Config(db, versie.id, [module2Config]);

    const resultaat = herberekenBegroting(db, versie.id);
    const contract = resultaat.module1.contracten.find((c) => c.contractnummer === "0000000049")!;

    // Override bereikt Module 1 (i.p.v. de algemene 3%).
    expect(contract.indexatiePercentageBron).toBe("OVERRIDE");
    expect(contract.indexatiePercentageGebruikt.toString()).toBe("5");

    // Bekende toekomstige VS13-wijziging bereikt Module 1: korting −500 t/m juni, 0 vanaf juli — jaartotaal 3.000.
    for (let maand = 1; maand <= 6; maand += 1) {
      expect(contract.regels.find((r) => r.maand === maand)!.huurkorting.toString()).toBe("500");
    }
    for (let maand = 7; maand <= 12; maand += 1) {
      expect(contract.regels.find((r) => r.maand === maand)!.huurkorting.toString()).toBe("0");
    }
    expect(contract.jaartotaal.huurkorting.toString()).toBe("3000");

    // Module 1's netto huur vormt de grondslag voor Module 2 (zelfde complex).
    const complex001 = resultaat.module2.complexen.find((c) => c.complexnummer === "001")!;
    expect(complex001.jaartotaal.nettoHuurGrondslag.toString()).toBe(contract.jaartotaal.nettoHuur.toString());

    // Module 2 berekent zowel vast als variabel, via de bestaande pure functie.
    expect(complex001.vastToegepast).toBe(true);
    expect(complex001.jaartotaal.vastNaIndexatie.toString()).toBe("12000");
    expect(complex001.variabelToegepast).toBe(true);
    expect(complex001.jaartotaal.variabeleVergoeding.toString()).toBe(contract.jaartotaal.nettoHuur.times(6).dividedBy(100).toString());
  });
});
