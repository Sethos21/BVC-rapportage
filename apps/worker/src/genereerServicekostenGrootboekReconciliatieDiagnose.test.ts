import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerServicekostenGrootboekReconciliatieDiagnose } from "./genereerServicekostenGrootboekReconciliatieDiagnose.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

function boekingRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "070",
    Boekstuk_Sleutel: "0705000001",
    Boeking_Dagboeknr: "50",
    Boeking_Boekjaar: 2026,
    Boeking_Boekperiode: "01",
    Boeking_Boekstuknr: "100",
    Boeking_Volgnr: "1",
    Boeking_Boekdatum: "01-01-2026",
    Boeking_Grootboeknr: "1712",
    Boeking_Bedrag_Debet: 0,
    Boeking_Bedrag_Credit: 0,
    Boeking_Omschrijving: "test",
    Boeking_Saldo: "0",
    ...overrides,
  };
}

function servicekostenRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "070", Service_BK_Boekjaar: "2026", Service_BK_Boekperiode: "01", Service_BK_Dagboeknummer: "50",
    Service_BK_Boekstuknummer: "100", Service_BK_Volgnummer: "1", Service_BK_Kostensoort: "0101",
    Service_BK_Bedrag_debet: "100", Service_BK_Bedrag_credit: "0", Kostensoort_Soort: "Kosten",
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-servicekosten-reconciliatie-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function schrijfBasisBronnen(boekingen: Record<string, unknown>[], servicekosten: Record<string, unknown>[]): void {
  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), boekingen);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), servicekosten);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);
  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
}

describe("genereerServicekostenGrootboekReconciliatieDiagnose", () => {
  it("reconcilieert Kosten<->1712 en Voorschotten<->1711 sluitend, over dezelfde boekjaar/periode-selectie", () => {
    schrijfBasisBronnen(
      [
        boekingRij({ Boeking_Boekstuknr: "100", Boeking_Grootboeknr: "1712", Boeking_Bedrag_Debet: 100 }),
        boekingRij({ Boekstuk_Sleutel: "0705000002", Boeking_Boekstuknr: "101", Boeking_Grootboeknr: "1711", Boeking_Bedrag_Credit: 50 }),
      ],
      [
        servicekostenRij({ Service_BK_Boekstuknummer: "100", Service_BK_Kostensoort: "0101", Kostensoort_Soort: "Kosten", Service_BK_Bedrag_debet: "100" }),
        servicekostenRij({ Service_BK_Boekstuknummer: "101", Service_BK_Kostensoort: "2000", Kostensoort_Soort: "Voorschotten", Service_BK_Bedrag_debet: "0", Service_BK_Bedrag_credit: "50" }),
      ],
    );

    const resultaat = genereerServicekostenGrootboekReconciliatieDiagnose(root, "070_rooisezoom", {
      boekjaar: 2026,
      boekperiodeTotEnMet: "01",
      doelrekeningen: ["1711", "1712"],
    });

    expect(resultaat.metadata.aantalServicekostenRijenInPeriode).toBe(2);
    expect(resultaat.metadata.doelrekeningen).toEqual(["1711", "1712"]);

    const rek1712 = resultaat.analyse.rekeningVergelijking.find((r) => r.grootboekrekening === "1712")!;
    expect(rek1712.grootboekSaldo.toString()).toBe("100");
    expect(rek1712.servicekostenGekoppeldSaldoTotaal.toString()).toBe("100");
    expect(rek1712.verschil.toString()).toBe("0");

    const rek1711 = resultaat.analyse.rekeningVergelijking.find((r) => r.grootboekrekening === "1711")!;
    expect(rek1711.grootboekSaldo.toString()).toBe("-50");
    expect(rek1711.servicekostenGekoppeldSaldoTotaal.toString()).toBe("-50");
    expect(rek1711.verschil.toString()).toBe("0");
  });

  it("toont een verschil als het grootboek meer bevat dan de gekoppelde servicekosten, en meldt dit als WAARSCHUWING", () => {
    schrijfBasisBronnen(
      [
        boekingRij({ Boeking_Boekstuknr: "100", Boeking_Grootboeknr: "1712", Boeking_Bedrag_Debet: 100 }),
        boekingRij({ Boekstuk_Sleutel: "0705000002", Boeking_Boekstuknr: "999", Boeking_Grootboeknr: "1712", Boeking_Bedrag_Debet: 30 }),
      ],
      [servicekostenRij({ Service_BK_Boekstuknummer: "100", Service_BK_Bedrag_debet: "100" })],
    );

    const resultaat = genereerServicekostenGrootboekReconciliatieDiagnose(root, "070_rooisezoom", {
      boekjaar: 2026,
      boekperiodeTotEnMet: "01",
      doelrekeningen: ["1712"],
    });

    const rek1712 = resultaat.analyse.rekeningVergelijking[0]!;
    expect(rek1712.grootboekSaldo.toString()).toBe("130");
    expect(rek1712.servicekostenGekoppeldSaldoTotaal.toString()).toBe("100");
    expect(rek1712.verschil.toString()).toBe("30");
    expect(resultaat.analyse.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("verschil 30"))).toBe(true);
  });

  it("houdt kostensoort 9600 apart zichtbaar en beperkt de reconciliatie tot de opgegeven periode", () => {
    schrijfBasisBronnen(
      [
        boekingRij({ Boeking_Boekstuknr: "100", Boeking_Grootboeknr: "1712", Boeking_Bedrag_Debet: 100 }),
        boekingRij({ Boekstuk_Sleutel: "0705000002", Boeking_Boekperiode: "02", Boeking_Boekstuknr: "200", Boeking_Grootboeknr: "1712", Boeking_Bedrag_Debet: 999 }),
      ],
      [
        servicekostenRij({ Service_BK_Boekstuknummer: "100", Service_BK_Bedrag_debet: "100" }),
        servicekostenRij({ Service_BK_Boekperiode: "02", Service_BK_Boekstuknummer: "200", Service_BK_Kostensoort: "9600", Kostensoort_Soort: "Nvt", Service_BK_Bedrag_debet: "999" }),
      ],
    );

    // Beperk tot periode 01 — de periode-02-regels (incl. 9600) mogen niet meetellen.
    const resultaat = genereerServicekostenGrootboekReconciliatieDiagnose(root, "070_rooisezoom", {
      boekjaar: 2026,
      boekperiodeTotEnMet: "01",
      doelrekeningen: ["1712"],
    });

    expect(resultaat.metadata.aantalServicekostenRijenInPeriode).toBe(1);
    expect(resultaat.analyse.kostensoort9600.aantalRegelsTotaal).toBe(0);
    expect(resultaat.analyse.rekeningVergelijking[0]?.grootboekSaldo.toString()).toBe("100");
  });

  it("gooit een duidelijke fout als het servicekosten-bronbestand ontbreekt", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), []);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), []);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), []);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);
    expect(() =>
      genereerServicekostenGrootboekReconciliatieDiagnose(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "01", doelrekeningen: ["1712"] }),
    ).toThrow(/niet gevonden/);
  });
});
