import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  berekenBegroteCorrectiefDagelijksOnderhoud,
  berekenBegroteGeplandOnderhoud,
  type BgBeheerComplexConfig,
  type BgContractFeiten,
  type BgContractOverride,
  type BgCorrectiefDagelijksRegelInvoer,
  type BgGeplandOnderhoudActiviteitInvoer,
  type BgHuurAannames,
  type BgManagementInvoer,
} from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { schrijfCorrectiefDagelijksOnderhoudBeoordeeld } from "./correctiefDagelijksOnderhoudBeoordeeld.js";
import {
  schrijfCorrectiefDagelijksOnderhoudRegels,
  type CorrectiefDagelijksOnderhoudRegelInvoer,
} from "./correctiefDagelijksOnderhoudRegels.js";
import { openOrCreateDatabase } from "./database.js";
import { schrijfGeplandOnderhoudActiviteiten, type GeplandOnderhoudActiviteitInvoer } from "./geplandOnderhoudActiviteiten.js";
import { schrijfGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";
import { herberekenBegroting } from "./herberekenen.js";
import { schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Overrides } from "./module1Overrides.js";
import { schrijfModule1Snapshot } from "./module1Snapshot.js";
import { schrijfModule2Config } from "./module2Config.js";
import { schrijfModule3Invoer } from "./module3Invoer.js";

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

describe("herberekenBegroting — Module 3 (Managementvergoeding, fase 2C.3)", () => {
  const WIJZIG_REGRESSIE: BgManagementInvoer = {
    wijze: "WIJZIG_BESTAAND_BEDRAG",
    bestaandBedrag: new Decimal(1000),
    bestaandEenheid: "MAAND",
    nieuwBedrag: new Decimal(1200),
    nieuweEenheid: "MAAND",
    ingangsdatum: new Date(Date.UTC(2027, 6, 1)),
  };

  it("21. CONCEPT zonder Module-3-invoer: herberekenen slaagt, module3 is null, Module 1/2 blijven correct", () => {
    const versieId = (() => {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { complexnummer: "001" })]);
      schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
      schrijfModule2Config(db, versie.id, [
        { complexnummer: "001", vastBedragJaar: new Decimal(1000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: new Decimal(6) },
      ]);
      return versie.id;
    })();

    const resultaat = herberekenBegroting(db, versieId);

    expect(resultaat.module3).toBeNull();
    expect(resultaat.module1.contracten).toHaveLength(1);
    expect(resultaat.module2.complexen.find((c) => c.complexnummer === "001")?.vastToegepast).toBe(true);
  });

  it("22. CONCEPT met INDEXEER_BESTAAND: persistente invoer wordt gelezen en correct berekend, resultaat niet null", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const invoer: BgManagementInvoer = {
      wijze: "INDEXEER_BESTAAND",
      bestaandBedrag: new Decimal(1000),
      eenheid: "MAAND",
      indexatiePercentage: new Decimal(3),
      indexatiedatum: new Date(Date.UTC(2027, 6, 1)),
    };
    schrijfModule3Invoer(db, versie.id, invoer);

    const resultaat = herberekenBegroting(db, versie.id);

    expect(resultaat.module3).not.toBeNull();
    expect(resultaat.module3!.invoer).toEqual(invoer);
    for (let i = 0; i < 6; i += 1) expect(resultaat.module3!.regels[i]!.bedrag.toString()).toBe("1000");
    for (let i = 6; i < 12; i += 1) expect(resultaat.module3!.regels[i]!.bedrag.toString()).toBe("1030");
    expect(resultaat.module3!.jaartotaal.bedrag.toString()).toBe("12180");
  });

  it("23. CONCEPT met WIJZIG_BESTAAND_BEDRAG: volledige persistence → rekenlaag-keten (regressievoorbeeld, jaartotaal €13.200)", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfModule3Invoer(db, versie.id, WIJZIG_REGRESSIE);

    const resultaat = herberekenBegroting(db, versie.id);

    expect(resultaat.module3).not.toBeNull();
    for (let i = 0; i < 6; i += 1) expect(resultaat.module3!.regels[i]!.bedrag.toString()).toBe("1000");
    for (let i = 6; i < 12; i += 1) expect(resultaat.module3!.regels[i]!.bedrag.toString()).toBe("1200");
    expect(resultaat.module3!.jaartotaal.bedrag.toString()).toBe("13200");
  });

  it("24. CONCEPT met NIEUWE_VERGOEDING: €1.200/mnd vanaf 1 juli, jaartotaal €7.200", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const invoer: BgManagementInvoer = {
      wijze: "NIEUWE_VERGOEDING",
      bedrag: new Decimal(1200),
      eenheid: "MAAND",
      ingangsdatum: new Date(Date.UTC(2027, 6, 1)),
    };
    schrijfModule3Invoer(db, versie.id, invoer);

    const resultaat = herberekenBegroting(db, versie.id);

    expect(resultaat.module3).not.toBeNull();
    for (let i = 0; i < 6; i += 1) expect(resultaat.module3!.regels[i]!.bedrag.toString()).toBe("0");
    for (let i = 6; i < 12; i += 1) expect(resultaat.module3!.regels[i]!.bedrag.toString()).toBe("1200");
    expect(resultaat.module3!.jaartotaal.bedrag.toString()).toBe("7200");
  });

  it("25. expliciete €0-invoer: module3 is NIET null en jaartotaal is exact €0 — bewijst INGEVULD €0 ≠ NIET INGEVULD", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const invoer: BgManagementInvoer = { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(0), eenheid: "MAAND", ingangsdatum: null };
    schrijfModule3Invoer(db, versie.id, invoer);

    const resultaat = herberekenBegroting(db, versie.id);

    expect(resultaat.module3).not.toBeNull();
    expect(resultaat.module3!.jaartotaal.bedrag.toString()).toBe("0");
    expect(resultaat.module3!.jaartotaal.bedrag.isZero()).toBe(true);

    // Contrast: een andere, volledig lege versie (geen Module-3-invoer geschreven) blijft null —
    // een ingevulde €0 en een niet-ingevulde versie zijn nooit hetzelfde resultaat.
    const legeVersie = maakMinimaalGeldigeConceptVersie();
    expect(herberekenBegroting(db, legeVersie.id).module3).toBeNull();
  });

  it("26. herberekenen heeft geen schrijfeffect, ook niet op begroting_management_invoer", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfModule3Invoer(db, versie.id, WIJZIG_REGRESSIE);

    const dump = () => ({
      versies: db.prepare(`SELECT * FROM begrotingsversies`).all(),
      module3: db.prepare(`SELECT * FROM begroting_management_invoer`).all(),
    });

    const voor = dump();
    herberekenBegroting(db, versie.id);
    const na = dump();

    expect(na).toEqual(voor);
  });

  it("27. Module-1/2-regressie: resultaten blijven byte-identiek, ongeacht of Module-3-invoer aanwezig is", () => {
    function maakVersieMetModule1En2(): string {
      const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
      schrijfModule1Snapshot(db, versie.id, [
        maakContract("0000000049", {
          complexnummer: "001",
          rentrollComponenten: [
            { vorderingsoort: "01", bedragJaar: new Decimal(12777.36), btwYn: "Y" },
            { vorderingsoort: "13", bedragJaar: new Decimal(-6000), btwYn: "Y" },
          ],
        }),
      ]);
      schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
      schrijfModule2Config(db, versie.id, [
        { complexnummer: "001", vastBedragJaar: new Decimal(12000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: new Decimal(6) },
      ]);
      return versie.id;
    }

    const zonderModule3 = maakVersieMetModule1En2();
    const metModule3 = maakVersieMetModule1En2();
    schrijfModule3Invoer(db, metModule3, WIJZIG_REGRESSIE);

    const resultaatZonder = herberekenBegroting(db, zonderModule3);
    const resultaatMet = herberekenBegroting(db, metModule3);

    const normaliseer = (waarde: unknown) => JSON.stringify(waarde, (_key, v) => (v instanceof Decimal ? v.toString() : v));

    expect(normaliseer(resultaatZonder.module1)).toBe(normaliseer(resultaatMet.module1));
    expect(normaliseer(resultaatZonder.module2)).toBe(normaliseer(resultaatMet.module2));
    expect(resultaatZonder.module3).toBeNull();
    expect(resultaatMet.module3).not.toBeNull();
  });
});

describe("herberekenBegroting — Gepland Onderhoud (GO-P2)", () => {
  function activiteitInvoer(overrides: Partial<GeplandOnderhoudActiviteitInvoer> = {}): GeplandOnderhoudActiviteitInvoer {
    return {
      id: null,
      complexnummer: "003",
      omschrijving: "Vervangen dakbedekking",
      aanleidingType: "MJOP",
      aanleidingToelichting: "MJOP 2027 regel 14",
      q1: new Decimal(25000),
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

  /** Zelfde type-boundary-conversie als de productiecode (`naarPureGeplandOnderhoudInvoer` in `herberekenen.ts`) — bewust GEEN `id` in de pure vorm. */
  function alsPureInvoer(a: GeplandOnderhoudActiviteitInvoer): BgGeplandOnderhoudActiviteitInvoer {
    return {
      complexnummer: a.complexnummer,
      omschrijving: a.omschrijving,
      aanleidingType: (a.aanleidingType ?? "") as BgGeplandOnderhoudActiviteitInvoer["aanleidingType"],
      aanleidingToelichting: a.aanleidingToelichting,
      q1: a.q1,
      q2: a.q2,
      q3: a.q3,
      q4: a.q4,
      status: a.status as BgGeplandOnderhoudActiviteitInvoer["status"],
      leverancier: a.leverancier,
      offertebedrag: a.offertebedrag,
      notitie: a.notitie,
    };
  }

  it("1. nul activiteiten + geen beoordeeld-rij: resultaat aanwezig, beoordeeld=false, NOT_REVIEWED, totalen 0", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const resultaat = herberekenBegroting(db, versie.id);

    expect(resultaat.geplandOnderhoud).toBeDefined();
    expect(resultaat.geplandOnderhoud.beoordeeld).toBe(false);
    expect(resultaat.geplandOnderhoud.reviewStatus).toBe("NOT_REVIEWED");
    expect(resultaat.geplandOnderhoud.totaalJaar.toString()).toBe("0");
    expect(resultaat.geplandOnderhoud.activiteiten).toEqual([]);
  });

  it("2. nul activiteiten + beoordeeld=true: REVIEWED_ZERO_ACTIVITIES", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.geplandOnderhoud.reviewStatus).toBe("REVIEWED_ZERO_ACTIVITIES");
  });

  it("3. één geldige activiteit: exact gelijk aan directe pure-calculator-uitkomst", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const invoer = activiteitInvoer();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [invoer]);

    const resultaat = herberekenBegroting(db, versie.id);
    const direct = berekenBegroteGeplandOnderhoud([alsPureInvoer(invoer)], { begrotingsjaar: 2027, beoordeeld: false });

    expect(resultaat.geplandOnderhoud.totaalJaar.toString()).toBe(direct.totaalJaar.toString());
    expect(resultaat.geplandOnderhoud.kwartaalTotalen).toEqual(direct.kwartaalTotalen);
    expect(resultaat.geplandOnderhoud.activiteiten[0]?.activiteit).toEqual(direct.activiteiten[0]);
  });

  it("4. meerdere activiteiten: module-/kwartaal-/complex-totalen exact gelijk aan pure calculator", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const invoerA = activiteitInvoer({ complexnummer: "001", q1: new Decimal(1000) });
    const invoerB = activiteitInvoer({ complexnummer: "001", q2: new Decimal(500) });
    const invoerC = activiteitInvoer({ complexnummer: "004", q3: new Decimal(750) });
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [invoerA, invoerB, invoerC]);

    const resultaat = herberekenBegroting(db, versie.id);
    const direct = berekenBegroteGeplandOnderhoud([invoerA, invoerB, invoerC].map(alsPureInvoer), { begrotingsjaar: 2027, beoordeeld: false });

    expect(resultaat.geplandOnderhoud.totaalJaar.toString()).toBe(direct.totaalJaar.toString());
    expect(resultaat.geplandOnderhoud.kwartaalTotalen).toEqual(direct.kwartaalTotalen);
    expect(resultaat.geplandOnderhoud.perComplex).toEqual(direct.perComplex);
    expect(resultaat.geplandOnderhoud.totaalZonderGeldigComplex.toString()).toBe(direct.totaalZonderGeldigComplex.toString());
  });

  it("5. persistentie-id wordt correct teruggekoppeld per activiteit", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const [a, b] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      activiteitInvoer({ omschrijving: "Eerste" }),
      activiteitInvoer({ omschrijving: "Tweede" }),
    ]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.geplandOnderhoud.activiteiten[0]?.persistentieId).toBe(a!.id);
    expect(resultaat.geplandOnderhoud.activiteiten[1]?.persistentieId).toBe(b!.id);
  });

  it("6. twee inhoudelijk identieke activiteiten met verschillende ids blijven correct onderscheiden (geen inhoudelijke zoekkoppeling)", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const [a, b] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer(), activiteitInvoer()]);
    expect(a!.id).not.toBe(b!.id);

    const resultaat = herberekenBegroting(db, versie.id);
    const ids = resultaat.geplandOnderhoud.activiteiten.map((x) => x.persistentieId);
    expect(ids).toEqual([a!.id, b!.id]);
    expect(new Set(ids).size).toBe(2);
  });

  it("7. Decimalwaarden blijven exact (meer precisie dan 2 decimalen, negatief bedrag)", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ q1: new Decimal("12345.6789"), q2: new Decimal("-500.5") })]);

    const resultaat = herberekenBegroting(db, versie.id);
    const activiteit = resultaat.geplandOnderhoud.activiteiten[0]!.activiteit;
    expect(activiteit.q1.toString()).toBe("12345.6789");
    expect(activiteit.q2.toString()).toBe("-500.5");
  });

  it("8. optionele velden null blijven null", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ leverancier: null, offertebedrag: null, notitie: null })]);

    const resultaat = herberekenBegroting(db, versie.id);
    const invoer = resultaat.geplandOnderhoud.activiteiten[0]!.activiteit.invoer;
    expect(invoer.leverancier).toBeNull();
    expect(invoer.offertebedrag).toBeNull();
    expect(invoer.notitie).toBeNull();
  });

  it("9. optionele velden gevuld blijven exact behouden", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      activiteitInvoer({ leverancier: "Weerts van de Zanden", offertebedrag: new Decimal("24500.00"), notitie: "offerte ontvangen" }),
    ]);

    const resultaat = herberekenBegroting(db, versie.id);
    const invoer = resultaat.geplandOnderhoud.activiteiten[0]!.activiteit.invoer;
    expect(invoer.leverancier).toBe("Weerts van de Zanden");
    expect(invoer.offertebedrag?.toString()).toBe("24500");
    expect(invoer.notitie).toBe("offerte ontvangen");
  });

  it("10. lege omschrijving: KRITIEK, financieel bedrag blijft meetellen", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ omschrijving: "", q1: new Decimal(10000) })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.geplandOnderhoud.activiteiten[0]?.activiteit.jaartotaal.toString()).toBe("10000");
    expect(resultaat.geplandOnderhoud.totaalJaar.toString()).toBe("10000");
    expect(resultaat.geplandOnderhoud.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("omschrijving"))).toBe(true);
  });

  it("11. ontbrekend/ongeldig aanleidingType: KRITIEK, berekening blijft werken", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ aanleidingType: null, q1: new Decimal(10000) })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.geplandOnderhoud.totaalJaar.toString()).toBe("10000");
    expect(resultaat.geplandOnderhoud.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("aanleidingType"))).toBe(true);
  });

  it("12. ongeldige status: KRITIEK, berekening blijft werken", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ status: "NIET_BESTAAND", q1: new Decimal(10000) })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.geplandOnderhoud.totaalJaar.toString()).toBe("10000");
    expect(resultaat.geplandOnderhoud.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("status"))).toBe(true);
  });

  it("13. leeg complexnummer: modulebreed bedrag aanwezig, niet in perComplex, totaalZonderGeldigComplex correct", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ complexnummer: "", q1: new Decimal(10000) })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.geplandOnderhoud.totaalJaar.toString()).toBe("10000");
    expect(resultaat.geplandOnderhoud.perComplex).toEqual([]);
    expect(resultaat.geplandOnderhoud.totaalZonderGeldigComplex.toString()).toBe("10000");
    expect(resultaat.geplandOnderhoud.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("complexnummer"))).toBe(true);
  });

  it("14. negatief kwartaal: WAARSCHUWING, negatief bedrag blijft meetellen", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ q1: new Decimal(-500), q2: new Decimal(1000) })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.geplandOnderhoud.activiteiten[0]?.activiteit.q1.toString()).toBe("-500");
    expect(resultaat.geplandOnderhoud.activiteiten[0]?.activiteit.jaartotaal.toString()).toBe("500");
    expect(resultaat.geplandOnderhoud.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);
  });

  it("15. beoordeeld=false met activiteiten: rekent volledig door, NOT_REVIEWED", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer({ q1: new Decimal(1000) })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.geplandOnderhoud.reviewStatus).toBe("NOT_REVIEWED");
    expect(resultaat.geplandOnderhoud.totaalJaar.toString()).toBe("1000");
  });

  it("16. beoordeeld=true met activiteiten: REVIEWED_WITH_ACTIVITIES", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.geplandOnderhoud.reviewStatus).toBe("REVIEWED_WITH_ACTIVITIES");
  });

  it("17. herberekening schrijft niets naar de Gepland-Onderhoud-concepttabellen", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);

    const dump = () => ({
      activiteiten: db.prepare(`SELECT * FROM begroting_gepland_onderhoud_activiteit`).all(),
      module: db.prepare(`SELECT * FROM begroting_gepland_onderhoud_module`).all(),
    });

    const voor = dump();
    herberekenBegroting(db, versie.id);
    const na = dump();

    expect(na).toEqual(voor);
  });

  it("18. twee opeenvolgende herberekeningen zonder writes geven inhoudelijk identiek resultaat", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      activiteitInvoer({ complexnummer: "001", q1: new Decimal(1000) }),
      activiteitInvoer({ complexnummer: "004", q4: new Decimal(2000) }),
    ]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);

    const eersteKeer = herberekenBegroting(db, versie.id);
    const tweedeKeer = herberekenBegroting(db, versie.id);
    const normaliseer = (waarde: unknown) => JSON.stringify(waarde, (_key, v) => (v instanceof Decimal ? v.toString() : v));

    expect(normaliseer(eersteKeer.geplandOnderhoud)).toBe(normaliseer(tweedeKeer.geplandOnderhoud));
  });

  it("20 (regressie). bestaande Module 1/2/3-uitkomst blijft byte-identiek naast een aanwezige Gepland-Onderhoud-activiteit", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { complexnummer: "001" })]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "001", vastBedragJaar: new Decimal(1000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: new Decimal(6) },
    ]);

    const zonderGeplandOnderhoud = herberekenBegroting(db, versie.id);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [activiteitInvoer()]);
    const metGeplandOnderhoud = herberekenBegroting(db, versie.id);

    const normaliseer = (waarde: unknown) => JSON.stringify(waarde, (_key, v) => (v instanceof Decimal ? v.toString() : v));
    expect(normaliseer(zonderGeplandOnderhoud.module1)).toBe(normaliseer(metGeplandOnderhoud.module1));
    expect(normaliseer(zonderGeplandOnderhoud.module2)).toBe(normaliseer(metGeplandOnderhoud.module2));
    expect(zonderGeplandOnderhoud.module3).toBeNull();
    expect(metGeplandOnderhoud.module3).toBeNull();
  });
});

describe("herberekenBegroting — Correctief/Dagelijks Onderhoud (CD-P2)", () => {
  function regelInvoer(overrides: Partial<CorrectiefDagelijksOnderhoudRegelInvoer> = {}): CorrectiefDagelijksOnderhoudRegelInvoer {
    return {
      id: null,
      omschrijving: "Reparatie CV-installatie",
      complexnummer: "003",
      jaarbedrag: new Decimal(1200),
      ...overrides,
    };
  }

  /** Zelfde type-boundary-conversie als de productiecode (`naarPureCorrectiefDagelijksInvoer` in `herberekenen.ts`) — bewust GEEN `id` in de pure vorm. */
  function alsPureInvoer(r: CorrectiefDagelijksOnderhoudRegelInvoer): BgCorrectiefDagelijksRegelInvoer {
    return { omschrijving: r.omschrijving, complexnummer: r.complexnummer, jaarbedrag: r.jaarbedrag };
  }

  it("1. nul regels + geen beoordeeld-rij: resultaat aanwezig, beoordeeld=false, NOT_REVIEWED, totaal 0", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const resultaat = herberekenBegroting(db, versie.id);

    expect(resultaat.correctiefDagelijksOnderhoud).toBeDefined();
    expect(resultaat.correctiefDagelijksOnderhoud.beoordeeld).toBe(false);
    expect(resultaat.correctiefDagelijksOnderhoud.reviewStatus).toBe("NOT_REVIEWED");
    expect(resultaat.correctiefDagelijksOnderhoud.totaalJaar.toString()).toBe("0");
    expect(resultaat.correctiefDagelijksOnderhoud.regels).toEqual([]);
  });

  it("2. nul regels + beoordeeld=true: REVIEWED_ZERO_RULES", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud.reviewStatus).toBe("REVIEWED_ZERO_RULES");
  });

  it("3. één geldige regel: exact gelijk aan directe pure-calculator-uitkomst", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const invoer = regelInvoer();
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [invoer]);

    const resultaat = herberekenBegroting(db, versie.id);
    const direct = berekenBegroteCorrectiefDagelijksOnderhoud([alsPureInvoer(invoer)], { begrotingsjaar: 2027, beoordeeld: false });

    expect(resultaat.correctiefDagelijksOnderhoud.totaalJaar.toString()).toBe(direct.totaalJaar.toString());
    expect(resultaat.correctiefDagelijksOnderhoud.regels[0]?.regel).toEqual(direct.regels[0]);
  });

  it("4. meerdere regels: totaal exact gelijk aan pure calculator", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const invoerA = regelInvoer({ omschrijving: "A", jaarbedrag: new Decimal(1000) });
    const invoerB = regelInvoer({ omschrijving: "B", jaarbedrag: new Decimal(2500) });
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [invoerA, invoerB]);

    const resultaat = herberekenBegroting(db, versie.id);
    const direct = berekenBegroteCorrectiefDagelijksOnderhoud([invoerA, invoerB].map(alsPureInvoer), { begrotingsjaar: 2027, beoordeeld: false });

    expect(resultaat.correctiefDagelijksOnderhoud.totaalJaar.toString()).toBe(direct.totaalJaar.toString());
    expect(resultaat.correctiefDagelijksOnderhoud.totaalJaar.toString()).toBe("3500");
  });

  it("5. persistentie-id wordt correct teruggekoppeld per regel", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const [a, b] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [
      regelInvoer({ omschrijving: "Eerste" }),
      regelInvoer({ omschrijving: "Tweede" }),
    ]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud.regels[0]?.persistentieId).toBe(a!.id);
    expect(resultaat.correctiefDagelijksOnderhoud.regels[1]?.persistentieId).toBe(b!.id);
  });

  it("6. twee inhoudelijk identieke regels met verschillende ids blijven correct onderscheiden (geen inhoudelijke zoekkoppeling)", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    const [a, b] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer(), regelInvoer()]);
    expect(a!.id).not.toBe(b!.id);

    const resultaat = herberekenBegroting(db, versie.id);
    const ids = resultaat.correctiefDagelijksOnderhoud.regels.map((x) => x.persistentieId);
    expect(ids).toEqual([a!.id, b!.id]);
    expect(new Set(ids).size).toBe(2);
  });

  it("7. Decimalwaarden blijven exact (meer precisie dan 2 decimalen)", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ jaarbedrag: new Decimal("1234.5678") })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud.regels[0]!.regel.jaarbedrag.toString()).toBe("1234.5678");
  });

  it("8. jaarbedrag=null blijft KRITIEK en krijgt een veilige 0-bijdrage", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ jaarbedrag: null })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud.regels[0]!.regel.jaarbedrag.toString()).toBe("0");
    expect(resultaat.correctiefDagelijksOnderhoud.regels[0]!.regel.invoer.jaarbedrag).toBeNull();
    expect(resultaat.correctiefDagelijksOnderhoud.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("jaarbedrag"))).toBe(
      true,
    );
  });

  it("9. lege omschrijving: KRITIEK, financieel bedrag blijft zichtbaar/meetellen", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ omschrijving: "", jaarbedrag: new Decimal(10000) })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud.regels[0]?.regel.jaarbedrag.toString()).toBe("10000");
    expect(resultaat.correctiefDagelijksOnderhoud.totaalJaar.toString()).toBe("10000");
    expect(
      resultaat.correctiefDagelijksOnderhoud.controleVereist.some((c) => c.ernst === "KRITIEK" && c.bericht.includes("omschrijving")),
    ).toBe(true);
  });

  it("10. complexnummer=null (NTB): geen control, bedrag telt gewoon mee", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ complexnummer: null, jaarbedrag: new Decimal(500) })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud.totaalJaar.toString()).toBe("500");
    expect(resultaat.correctiefDagelijksOnderhoud.controleVereist).toHaveLength(0);
  });

  it("11. negatief jaarbedrag: WAARSCHUWING, negatief bedrag blijft meetellen", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ jaarbedrag: new Decimal(-300) })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud.regels[0]?.regel.jaarbedrag.toString()).toBe("-300");
    expect(resultaat.correctiefDagelijksOnderhoud.totaalJaar.toString()).toBe("-300");
    expect(resultaat.correctiefDagelijksOnderhoud.controleVereist.some((c) => c.ernst === "WAARSCHUWING")).toBe(true);
  });

  it("12. beoordeeld=false met regels: rekent volledig door, NOT_REVIEWED", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer({ jaarbedrag: new Decimal(1000) })]);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud.reviewStatus).toBe("NOT_REVIEWED");
    expect(resultaat.correctiefDagelijksOnderhoud.totaalJaar.toString()).toBe("1000");
  });

  it("13. beoordeeld=true met regels: REVIEWED_WITH_RULES", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    const resultaat = herberekenBegroting(db, versie.id);
    expect(resultaat.correctiefDagelijksOnderhoud.reviewStatus).toBe("REVIEWED_WITH_RULES");
  });

  it("14. herberekening schrijft niets naar de Correctief/Dagelijks-concepttabellen", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    const dump = () => ({
      regels: db.prepare(`SELECT * FROM begroting_correctief_dagelijks_onderhoud_regel`).all(),
      module: db.prepare(`SELECT * FROM begroting_correctief_dagelijks_onderhoud_module`).all(),
    });

    const voor = dump();
    herberekenBegroting(db, versie.id);
    const na = dump();

    expect(na).toEqual(voor);
  });

  it("15. twee opeenvolgende herberekeningen zonder writes geven inhoudelijk identiek resultaat", () => {
    const versie = maakMinimaalGeldigeConceptVersie();
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [
      regelInvoer({ complexnummer: "001", jaarbedrag: new Decimal(1000) }),
      regelInvoer({ complexnummer: "004", jaarbedrag: new Decimal(2000) }),
    ]);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);

    const eersteKeer = herberekenBegroting(db, versie.id);
    const tweedeKeer = herberekenBegroting(db, versie.id);
    const normaliseer = (waarde: unknown) => JSON.stringify(waarde, (_key, v) => (v instanceof Decimal ? v.toString() : v));

    expect(normaliseer(eersteKeer.correctiefDagelijksOnderhoud)).toBe(normaliseer(tweedeKeer.correctiefDagelijksOnderhoud));
  });

  it("16 (regressie). bestaande Module 1/2/3 + Gepland-Onderhoud-uitkomst blijft byte-identiek naast een aanwezige Correctief/Dagelijks-regel", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { complexnummer: "001" })]);
    schrijfModule1Aannames(db, versie.id, STANDAARD_AANNAMES);
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "001", vastBedragJaar: new Decimal(1000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: new Decimal(6) },
    ]);
    schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      {
        id: null,
        complexnummer: "003",
        omschrijving: "Vervangen dakbedekking",
        aanleidingType: "MJOP",
        aanleidingToelichting: "MJOP 2027 regel 14",
        q1: new Decimal(25000),
        q2: new Decimal(0),
        q3: new Decimal(0),
        q4: new Decimal(0),
        status: "GEPLAND",
        leverancier: null,
        offertebedrag: null,
        notitie: null,
      },
    ]);

    const zonderCorrectiefDagelijks = herberekenBegroting(db, versie.id);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [regelInvoer()]);
    const metCorrectiefDagelijks = herberekenBegroting(db, versie.id);

    const normaliseer = (waarde: unknown) => JSON.stringify(waarde, (_key, v) => (v instanceof Decimal ? v.toString() : v));
    expect(normaliseer(zonderCorrectiefDagelijks.module1)).toBe(normaliseer(metCorrectiefDagelijks.module1));
    expect(normaliseer(zonderCorrectiefDagelijks.module2)).toBe(normaliseer(metCorrectiefDagelijks.module2));
    expect(normaliseer(zonderCorrectiefDagelijks.geplandOnderhoud)).toBe(normaliseer(metCorrectiefDagelijks.geplandOnderhoud));
    expect(zonderCorrectiefDagelijks.module3).toBeNull();
    expect(metCorrectiefDagelijks.module3).toBeNull();
  });
});
