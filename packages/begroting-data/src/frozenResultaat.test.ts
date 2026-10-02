import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BgBeheerComplexUitkomst, BgBeheerResultaat, BgContractFeiten, BgContractUitkomst, BgHuurResultaat } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesFrozenBegrotingsresultaat, schrijfFrozenBegrotingsresultaat, type FrozenBegrotingsresultaat } from "./frozenResultaat.js";
import { herberekenBegroting } from "./herberekenen.js";
import { schrijfModule1Aannames } from "./module1Aannames.js";
import { schrijfModule1Overrides } from "./module1Overrides.js";
import { schrijfModule1Snapshot } from "./module1Snapshot.js";
import { schrijfModule2Config } from "./module2Config.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-frozen-"));
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

/** Normaliseert Decimal → string en Date blijft Date (structuredClone-achtige diepe vergelijking) voor exacte, leesbare `toEqual`-vergelijkingen. */
function normaliseer<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, val) => (val instanceof Decimal ? { __decimal__: val.toString() } : val)));
}

/** Minimaal geldig `BgHuurMaandRegel[]` (12 lege maanden) — uitsluitend voor handmatig samengestelde volgordetests, geen rekenkunde. */
function legeMaandregels12() {
  return Array.from({ length: 12 }, (_, i) => ({
    maand: i + 1,
    brutoHuurZonderIndexatie: new Decimal(0),
    indexatieEffect: new Decimal(0),
    brutoHuurMetIndexatie: new Decimal(0),
    huurkorting: new Decimal(0),
    nettoHuur: new Decimal(0),
    kortingswijzigingToegepast: null,
  }));
}

function legeJaartotaal1() {
  return {
    brutoHuurZonderIndexatie: new Decimal(0),
    indexatieEffect: new Decimal(0),
    brutoHuurMetIndexatie: new Decimal(0),
    huurkorting: new Decimal(0),
    nettoHuur: new Decimal(0),
  };
}

function minimaalContract(contractnummer: string): BgContractUitkomst {
  return {
    contractnummer,
    huurdernummer: null,
    huurderNaam: null,
    complexnummer: null,
    belastOnbelast: "ONBEKEND",
    indexatiePercentageGebruikt: new Decimal(0),
    indexatiePercentageBron: "ALGEMEEN",
    overrideToegepast: null,
    effectieveIndexatiedatum: null,
    regels: legeMaandregels12(),
    jaartotaal: legeJaartotaal1(),
  };
}

function minimaalModule1Resultaat(versieBegrotingsjaar: number, bronPeildatum: Date, contracten: BgContractUitkomst[]): BgHuurResultaat {
  return {
    begrotingsjaar: versieBegrotingsjaar,
    bronPeildatum,
    indexatiePercentageAlgemeen: new Decimal(3),
    contracten,
    portefeuilleTotalen: { ...legeJaartotaal1(), nettoHuurBelast: new Decimal(0), nettoHuurOnbelast: new Decimal(0), nettoHuurOnbekendeBtw: new Decimal(0) },
    controleVereist: [],
  };
}

function legeMaandregels12Module2() {
  return Array.from({ length: 12 }, (_, i) => ({
    maand: i + 1,
    vastVoorIndexatie: new Decimal(0),
    vastIndexatieEffect: new Decimal(0),
    vastNaIndexatie: new Decimal(0),
    variabeleVergoeding: new Decimal(0),
    totaleVergoeding: new Decimal(0),
  }));
}

function legeJaartotaal2() {
  return {
    nettoHuurGrondslag: new Decimal(0),
    vastVoorIndexatie: new Decimal(0),
    vastIndexatieEffect: new Decimal(0),
    vastNaIndexatie: new Decimal(0),
    variabeleVergoeding: new Decimal(0),
    totaleVergoeding: new Decimal(0),
  };
}

function minimaalComplex(complexnummer: string): BgBeheerComplexUitkomst {
  return {
    complexnummer,
    vastToegepast: false,
    variabelToegepast: false,
    variabelPercentageGebruikt: null,
    regels: legeMaandregels12Module2(),
    jaartotaal: legeJaartotaal2(),
  };
}

function minimaalModule2Resultaat(versieBegrotingsjaar: number, complexen: BgBeheerComplexUitkomst[]): BgBeheerResultaat {
  return {
    begrotingsjaar: versieBegrotingsjaar,
    complexen,
    portefeuilleTotalen: legeJaartotaal2(),
    controleVereist: [],
  };
}

/** Bouwt een echt, realistisch 070-resultaat (contract 049-stijl, hergebruikt uit 1D.5) via de bestaande pure/herbereken-laag. Geen handmatige rekenkunde. */
function maakRealistisch070Resultaat(): { versieId: string; resultaat: FrozenBegrotingsresultaat } {
  const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
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
  schrijfModule1Overrides(db, versie.id, [{ contractnummer: "0000000049", indexatiePercentage: new Decimal(5), scope: "VERSIE", reden: "Onderhandeld" }]);
  schrijfModule2Config(db, versie.id, [
    { complexnummer: "001", vastBedragJaar: new Decimal(12000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: new Decimal(6) },
  ]);

  const { module1, module2 } = herberekenBegroting(db, versie.id);
  return { versieId: versie.id, resultaat: { module1, module2 } };
}

describe("schrijfFrozenBegrotingsresultaat / leesFrozenBegrotingsresultaat — volledige roundtrip (T, C, D, E, F, G, H, I, J, K, L)", () => {
  it("T. echte 070-fixture: geschreven en gelezen Module-1 én Module-2 zijn inhoudelijk exact gelijk aan het berekende resultaat", () => {
    const { versieId, resultaat } = maakRealistisch070Resultaat();

    schrijfFrozenBegrotingsresultaat(db, versieId, resultaat);
    const gelezen = leesFrozenBegrotingsresultaat(db, versieId)!;

    expect(gelezen).not.toBeNull();
    expect(normaliseer(gelezen.module1)).toEqual(normaliseer(resultaat.module1));
    expect(normaliseer(gelezen.module2)).toEqual(normaliseer(resultaat.module2));
  });

  it("H. tracefields (indexatiePercentageGebruikt/-Bron, overrideToegepast, effectieveIndexatiedatum, kortingswijzigingToegepast) blijven exact behouden", () => {
    const { versieId, resultaat } = maakRealistisch070Resultaat();
    schrijfFrozenBegrotingsresultaat(db, versieId, resultaat);
    const gelezen = leesFrozenBegrotingsresultaat(db, versieId)!;

    const contract = gelezen.module1.contracten.find((c) => c.contractnummer === "0000000049")!;
    expect(contract.indexatiePercentageGebruikt.toString()).toBe("5");
    expect(contract.indexatiePercentageBron).toBe("OVERRIDE");
    expect(contract.overrideToegepast).toEqual({ scope: "VERSIE", reden: "Onderhandeld" });
    expect(contract.effectieveIndexatiedatum).toEqual(new Date(Date.UTC(2027, 6, 1)));

    const juli = contract.regels.find((r) => r.maand === 7)!;
    expect(juli.kortingswijzigingToegepast).toEqual(new Date(Date.UTC(2027, 6, 1)));

    const complex = gelezen.module2.complexen.find((c) => c.complexnummer === "001")!;
    expect(complex.variabelPercentageGebruikt!.toString()).toBe("6");
    expect(complex.vastToegepast).toBe(true);
    expect(complex.variabelToegepast).toBe(true);
  });
});

describe("frozen output bewaart de FEITELIJKE arrayvolgorde — persistence sorteert zelf niet opnieuw", () => {
  it("Module 1: contracten in niet-alfabetische volgorde ([049, 028]) komen exact in díe volgorde terug, niet automatisch alfabetisch gesorteerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const module1 = minimaalModule1Resultaat(versie.begrotingsjaar, versie.bronPeildatum, [
      minimaalContract("0000000049"),
      minimaalContract("0000000028"),
    ]);
    const module2 = minimaalModule2Resultaat(versie.begrotingsjaar, []);

    schrijfFrozenBegrotingsresultaat(db, versie.id, { module1, module2 });
    const gelezen = leesFrozenBegrotingsresultaat(db, versie.id)!;

    expect(gelezen.module1.contracten.map((c) => c.contractnummer)).toEqual(["0000000049", "0000000028"]);
  });

  it("Module 2: complexen in niet-alfabetische volgorde ([004, 001]) komen exact in díe volgorde terug, niet automatisch alfabetisch gesorteerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const module1 = minimaalModule1Resultaat(versie.begrotingsjaar, versie.bronPeildatum, []);
    const module2 = minimaalModule2Resultaat(versie.begrotingsjaar, [minimaalComplex("004"), minimaalComplex("001")]);

    schrijfFrozenBegrotingsresultaat(db, versie.id, { module1, module2 });
    const gelezen = leesFrozenBegrotingsresultaat(db, versie.id)!;

    expect(gelezen.module2.complexen.map((c) => c.complexnummer)).toEqual(["004", "001"]);
  });
});

describe("nullable/optionele velden (M)", () => {
  it("overrideToegepast=null, effectieveIndexatiedatum=null, kortingswijzigingToegepast=null, variabelPercentageGebruikt=null blijven exact null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]); // geen indexatiedatum, geen override, geen korting
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "001", vastBedragJaar: null, vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
    ]);

    const { module1, module2 } = herberekenBegroting(db, versie.id);
    schrijfFrozenBegrotingsresultaat(db, versie.id, { module1, module2 });
    const gelezen = leesFrozenBegrotingsresultaat(db, versie.id)!;

    const contract = gelezen.module1.contracten[0]!;
    expect(contract.overrideToegepast).toBeNull();
    expect(contract.effectieveIndexatiedatum).toBeNull();
    expect(contract.regels.every((r) => r.kortingswijzigingToegepast === null)).toBe(true);

    const complex = gelezen.module2.complexen[0]!;
    expect(complex.variabelPercentageGebruikt).toBeNull();
    expect(complex.vastToegepast).toBe(false);
    expect(complex.variabelToegepast).toBe(false);
  });

  it("override ZONDER reden (optioneel veld weggelaten op input) komt terug als reden: null in de output (BgContractUitkomst.overrideToegepast.reden is string|null, geen optioneel veld)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule1Overrides(db, versie.id, [{ contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "VERSIE" }]); // GEEN reden

    const { module1, module2 } = herberekenBegroting(db, versie.id);
    expect(module1.contracten[0]!.overrideToegepast).toEqual({ scope: "VERSIE", reden: null }); // bevestig eerst de pure-laag-semantiek zelf

    schrijfFrozenBegrotingsresultaat(db, versie.id, { module1, module2 });
    const gelezen = leesFrozenBegrotingsresultaat(db, versie.id)!;
    expect(gelezen.module1.contracten[0]!.overrideToegepast).toEqual({ scope: "VERSIE", reden: null });
  });
});

describe("Decimal-precisie (K)", () => {
  it("centbedragen, negatieve bedragen en meer dan 2 decimalen blijven exact behouden als SQLite TEXT", () => {
    const { versieId, resultaat } = maakRealistisch070Resultaat();
    schrijfFrozenBegrotingsresultaat(db, versieId, resultaat);

    // Contract 049's jaartotaal.huurkorting is exact 3000 (bekend/bewezen), en de indexatie-effect-kolom
    // heeft door het 5%-override-percentage een niet-triviaal aantal decimalen — beide rechtstreeks op
    // rijniveau gecontroleerd op `typeof(...) = 'text'`, geen REAL, geen number-afronding.
    const contractRij = db
      .prepare(
        `SELECT jaartotaal_huurkorting, typeof(jaartotaal_huurkorting) AS type_korting,
                jaartotaal_bruto_huur_met_indexatie, typeof(jaartotaal_bruto_huur_met_indexatie) AS type_bruto
         FROM begroting_frozen_module1_contract WHERE begroting_versie_id = ?`,
      )
      .get(versieId) as { jaartotaal_huurkorting: string; type_korting: string; jaartotaal_bruto_huur_met_indexatie: string; type_bruto: string };
    expect(contractRij.type_korting).toBe("text");
    expect(contractRij.jaartotaal_huurkorting).toBe("3000");
    expect(contractRij.type_bruto).toBe("text");
    expect(contractRij.jaartotaal_bruto_huur_met_indexatie).toBe(resultaat.module1.contracten[0]!.jaartotaal.brutoHuurMetIndexatie.toString());

    // Een maandregel met de volledig berekende, mogelijk veeldecimale indexatie_effect-waarde.
    const maandregelRij = db
      .prepare(`SELECT indexatie_effect, typeof(indexatie_effect) AS type FROM begroting_frozen_module1_maandregel WHERE begroting_versie_id = ? AND maand = 7`)
      .get(versieId) as { indexatie_effect: string; type: string };
    expect(maandregelRij.type).toBe("text");
    expect(maandregelRij.indexatie_effect).toBe(resultaat.module1.contracten[0]!.regels.find((r) => r.maand === 7)!.indexatieEffect.toString());
  });
});

describe("controls (I)", () => {
  it("een echte Module-1- en Module-2-control (via de pure laag gegenereerd) blijven exact behouden, incl. volgorde, geen deduplicatie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { complexnummer: "001" })]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    // Twee overrides voor hetzelfde contract → Module 1's eigen "meerdere overrides"-WAARSCHUWING.
    schrijfModule1Overrides(db, versie.id, [
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(3), scope: "VERSIE" },
      { contractnummer: "0000000028", indexatiePercentage: new Decimal(5), scope: "VERSIE" },
    ]);
    // Twee configs voor hetzelfde complex → Module 2's eigen "meerdere beheerconfiguraties"-KRITIEK.
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "001", vastBedragJaar: new Decimal(1000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
      { complexnummer: "001", vastBedragJaar: new Decimal(2000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
    ]);

    const { module1, module2 } = herberekenBegroting(db, versie.id);
    expect(module1.controleVereist.length).toBeGreaterThan(0);
    expect(module2.controleVereist.length).toBeGreaterThan(0);

    schrijfFrozenBegrotingsresultaat(db, versie.id, { module1, module2 });
    const gelezen = leesFrozenBegrotingsresultaat(db, versie.id)!;

    // Exact dezelfde controls, in exact dezelfde volgorde, geen samenvoeging/deduplicatie.
    expect(normaliseer(gelezen.module1.controleVereist)).toEqual(normaliseer(module1.controleVereist));
    expect(normaliseer(gelezen.module2.controleVereist)).toEqual(normaliseer(module2.controleVereist));
  });
});

describe("lege maar geldige result-arrays (S)", () => {
  it("een lege snapshot/config geeft lege contracten/complexen/controls — round-tript naar lege arrays", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });

    const { module1, module2 } = herberekenBegroting(db, versie.id);
    expect(module1.contracten).toEqual([]);
    expect(module2.complexen).toEqual([]);

    schrijfFrozenBegrotingsresultaat(db, versie.id, { module1, module2 });
    const gelezen = leesFrozenBegrotingsresultaat(db, versie.id)!;

    expect(gelezen.module1.contracten).toEqual([]);
    expect(gelezen.module2.complexen).toEqual([]);
    expect(gelezen.module1.controleVereist).toEqual([]);
    expect(gelezen.module2.controleVereist).toEqual([]);
  });

  it("geen frozen output geschreven → leesFrozenBegrotingsresultaat geeft null", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesFrozenBegrotingsresultaat(db, versie.id)).toBeNull();
  });
});

describe("complete replacement (N)", () => {
  it("een tweede schrijfactie vervangt de eerste volledig — geen resten van de oude contracten/complexen/controls", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { complexnummer: "001" })]);
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "001", vastBedragJaar: new Decimal(1000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
    ]);
    const eersteResultaat = herberekenBegroting(db, versie.id);
    schrijfFrozenBegrotingsresultaat(db, versie.id, eersteResultaat);

    // Andere snapshot/config voor dezelfde versie.
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000099", { complexnummer: "002" })]);
    schrijfModule2Config(db, versie.id, [
      { complexnummer: "002", vastBedragJaar: new Decimal(2000), vastIndexatiePercentage: null, vastIndexatiedatum: null, variabelPercentage: null },
    ]);
    const tweedeResultaat = herberekenBegroting(db, versie.id);
    schrijfFrozenBegrotingsresultaat(db, versie.id, tweedeResultaat);

    const gelezen = leesFrozenBegrotingsresultaat(db, versie.id)!;
    expect(gelezen.module1.contracten.map((c) => c.contractnummer)).toEqual(["0000000099"]);
    expect(gelezen.module2.complexen.map((c) => c.complexnummer)).toEqual(["002"]);

    // Rechtstreeks op rijniveau: "028"/"001" bestaan nergens meer.
    expect(db.prepare(`SELECT 1 FROM begroting_frozen_module1_contract WHERE begroting_versie_id = ? AND contractnummer = '0000000028'`).get(versie.id)).toBeUndefined();
    expect(db.prepare(`SELECT 1 FROM begroting_frozen_module2_complex WHERE begroting_versie_id = ? AND complexnummer = '001'`).get(versie.id)).toBeUndefined();
  });
});

describe("rollback (O)", () => {
  it("een échte DB-fout midden in een complete replacement laat de vorige frozen output exact intact", () => {
    const { versieId, resultaat } = maakRealistisch070Resultaat();
    schrijfFrozenBegrotingsresultaat(db, versieId, resultaat); // geldige, complete frozen output staat er al

    // Bewust corrupt: een tweede resultaat waarbij één contract een niet-numerieke `maand` krijgt op zijn
    // eerste maandregel (via een structural cast, simuleert een aanroepersfout) — de CHECK
    // (maand BETWEEN 1 AND 12) forceert een échte fout MIDDEN in de INSERT-reeks, ná de reeds succesvol
    // ingevoegde header/contractrij voor dit tweede resultaat.
    const kapotResultaat: FrozenBegrotingsresultaat = {
      module1: {
        ...resultaat.module1,
        contracten: resultaat.module1.contracten.map((c) => ({
          ...c,
          regels: c.regels.map((r, i) => (i === 0 ? { ...r, maand: 99 } : r)),
        })),
      },
      module2: resultaat.module2,
    };

    expect(() => schrijfFrozenBegrotingsresultaat(db, versieId, kapotResultaat)).toThrow();

    const naMislukking = leesFrozenBegrotingsresultaat(db, versieId)!;
    expect(normaliseer(naMislukking.module1)).toEqual(normaliseer(resultaat.module1)); // exact de vorige, geldige output
    expect(normaliseer(naMislukking.module2)).toEqual(normaliseer(resultaat.module2));
  });
});

describe("CONCEPT-write / VASTGESTELD-immutability / cascade (P, Q, R)", () => {
  it("P. schrijven en vervangen tijdens CONCEPT is toegestaan", () => {
    const { versieId, resultaat } = maakRealistisch070Resultaat();
    expect(() => schrijfFrozenBegrotingsresultaat(db, versieId, resultaat)).not.toThrow();
    expect(() => schrijfFrozenBegrotingsresultaat(db, versieId, resultaat)).not.toThrow(); // vervangen mag ook
  });

  it("Q. schrijven na markeerVastgesteld wordt via de publieke API geweigerd", () => {
    const { versieId, resultaat } = maakRealistisch070Resultaat();
    schrijfFrozenBegrotingsresultaat(db, versieId, resultaat);
    markeerVastgesteld(db, versieId, new Date());

    expect(() => schrijfFrozenBegrotingsresultaat(db, versieId, resultaat)).toThrow(/VASTGESTELD/);
  });

  it("Q. directe SQL INSERT/UPDATE/DELETE op de Module-1-header worden na VASTGESTELD geweigerd", () => {
    const { versieId, resultaat } = maakRealistisch070Resultaat();
    schrijfFrozenBegrotingsresultaat(db, versieId, resultaat);
    markeerVastgesteld(db, versieId, new Date());

    // De trigger vuurt vóór de PK-constraint zou vuren — het specifieke /immutable/-bericht bewijst dat
    // dít de immutability-trigger is die de poging tegenhoudt, niet slechts een toevallige PK-botsing.
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_frozen_module1_resultaat
             (begroting_versie_id, indexatie_percentage_algemeen, portefeuille_bruto_huur_zonder_indexatie, portefeuille_indexatie_effect,
              portefeuille_bruto_huur_met_indexatie, portefeuille_huurkorting, portefeuille_netto_huur, portefeuille_netto_huur_belast,
              portefeuille_netto_huur_onbelast, portefeuille_netto_huur_onbekende_btw)
           VALUES (?, '0', '0', '0', '0', '0', '0', '0', '0', '0')`,
        )
        .run(versieId),
    ).toThrow(/immutable/);

    expect(() =>
      db.prepare(`UPDATE begroting_frozen_module1_resultaat SET indexatie_percentage_algemeen = '999' WHERE begroting_versie_id = ?`).run(versieId),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_module1_resultaat WHERE begroting_versie_id = ?`).run(versieId)).toThrow(/immutable/);
  });

  it("Q. directe SQL UPDATE/DELETE op een Module-1-child (maandregel) en Module-2-child (complex) worden na VASTGESTELD geweigerd", () => {
    const { versieId, resultaat } = maakRealistisch070Resultaat();
    schrijfFrozenBegrotingsresultaat(db, versieId, resultaat);
    markeerVastgesteld(db, versieId, new Date());

    expect(() =>
      db.prepare(`UPDATE begroting_frozen_module1_maandregel SET netto_huur = '999' WHERE begroting_versie_id = ?`).run(versieId),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_module1_maandregel WHERE begroting_versie_id = ?`).run(versieId)).toThrow(/immutable/);

    expect(() =>
      db.prepare(`UPDATE begroting_frozen_module2_complex SET jaartotaal_totale_vergoeding = '999' WHERE begroting_versie_id = ?`).run(versieId),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_frozen_module2_complex WHERE begroting_versie_id = ?`).run(versieId)).toThrow(/immutable/);
  });

  it("Q. lezen blijft na VASTGESTELD gewoon toegestaan", () => {
    const { versieId, resultaat } = maakRealistisch070Resultaat();
    schrijfFrozenBegrotingsresultaat(db, versieId, resultaat);
    markeerVastgesteld(db, versieId, new Date());

    const gelezen = leesFrozenBegrotingsresultaat(db, versieId)!;
    expect(normaliseer(gelezen.module1)).toEqual(normaliseer(resultaat.module1));
  });

  it("R. verwijderen van een CONCEPT-versie cascadeert alle acht frozen-outputtabellen volledig weg", () => {
    const { versieId, resultaat } = maakRealistisch070Resultaat();
    schrijfFrozenBegrotingsresultaat(db, versieId, resultaat);

    verwijderConceptVersie(db, versieId);

    for (const tabel of [
      "begroting_frozen_module1_resultaat",
      "begroting_frozen_module1_contract",
      "begroting_frozen_module1_maandregel",
      "begroting_frozen_module1_control",
      "begroting_frozen_module2_resultaat",
      "begroting_frozen_module2_complex",
      "begroting_frozen_module2_maandregel",
      "begroting_frozen_module2_control",
    ]) {
      expect(db.prepare(`SELECT 1 FROM ${tabel} WHERE begroting_versie_id = ?`).get(versieId)).toBeUndefined();
    }
  });
});
