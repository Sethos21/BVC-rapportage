import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerServicekostenPositie } from "./genereerServicekostenPositie.js";
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
  root = mkdtempSync(join(tmpdir(), "bvc-servicekosten-positie-"));
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

describe("genereerServicekostenPositie — regressiepunt-stijl (structuur zoals bewezen bij 070)", () => {
  it("berekent A/B/C consistent uit de cache: Kosten->1712, Voorschotten->1711, 9600 raakt beide, alles reconcilieert exact", () => {
    schrijfBasisBronnen(
      [
        boekingRij({ Boeking_Boekstuknr: "100", Boeking_Grootboeknr: "1712", Boeking_Bedrag_Debet: 91177.91 }),
        boekingRij({ Boekstuk_Sleutel: "0705000002", Boeking_Boekstuknr: "101", Boeking_Grootboeknr: "1711", Boeking_Bedrag_Credit: 114530 }),
        boekingRij({ Boekstuk_Sleutel: "0705000003", Boeking_Boekstuknr: "102", Boeking_Grootboeknr: "1711", Boeking_Bedrag_Debet: 220610 }),
        boekingRij({ Boekstuk_Sleutel: "0705000004", Boeking_Boekstuknr: "103", Boeking_Grootboeknr: "1712", Boeking_Bedrag_Credit: 188683.61 }),
      ],
      [
        servicekostenRij({ Service_BK_Boekstuknummer: "100", Service_BK_Kostensoort: "0101", Kostensoort_Soort: "Kosten", Service_BK_Bedrag_debet: "91177.91" }),
        servicekostenRij({ Service_BK_Boekstuknummer: "101", Service_BK_Kostensoort: "2000", Kostensoort_Soort: "Voorschotten", Service_BK_Bedrag_debet: "0", Service_BK_Bedrag_credit: "114530" }),
        servicekostenRij({
          Service_BK_Boekstuknummer: "102", Service_BK_Kostensoort: "9600", Kostensoort_Soort: "Nvt", Service_BK_Bedrag_debet: "220610", Service_BK_Bedrag_credit: "0",
          Service_BK_Contractnummer: "C1", Huurdernummer: "H1", Service_BK_Jaar_SV_Afrekening: "2025",
        }),
        servicekostenRij({ Service_BK_Boekstuknummer: "103", Service_BK_Kostensoort: "9600", Kostensoort_Soort: "Nvt", Service_BK_Bedrag_debet: "0", Service_BK_Bedrag_credit: "188683.61" }),
      ],
    );

    const resultaat = genereerServicekostenPositie(root, "070_rooisezoom", {
      boekjaar: 2026,
      boekperiodeTotEnMet: "06",
      doelrekeningen: ["1711", "1712"],
    });

    expect(resultaat.actuelePositie.kostenSaldo.toString()).toBe("91177.91");
    expect(resultaat.actuelePositie.voorschottenSaldo.toString()).toBe("-114530");
    expect(resultaat.actuelePositie.actueelSaldo.toString()).toBe("-23352.09");
    expect(resultaat.actuelePositie.status).toBe("VOORSCHOTTEN_HOGER_DAN_KOSTEN");

    expect(resultaat.afrekeningVoorgaandJaar.aantalRegels).toBe(2);
    const perHuurder = resultaat.afrekeningVoorgaandJaar.perContractHuurderAfrekenjaar.find((r) => r.huurdernummer === "H1");
    expect(perHuurder?.afrekenjaar).toEqual({ type: "bekend", waarde: "2025" });

    const rek1711 = resultaat.reconciliatie.perRekening.find((r) => r.grootboekrekening === "1711")!;
    expect(rek1711.grootboekSaldo.toString()).toBe("106080");
    expect(rek1711.verschil.toString()).toBe("0");
    const rek1712 = resultaat.reconciliatie.perRekening.find((r) => r.grootboekrekening === "1712")!;
    expect(rek1712.grootboekSaldo.toString()).toBe("-97505.7");
    expect(rek1712.verschil.toString()).toBe("0");

    expect(resultaat.controleVereist.filter((c) => c.sectie === "Reconciliatie" && c.ernst === "WAARSCHUWING")).toHaveLength(0);
  });

  it("respecteert periodeVan/periodeTotEnMet: een regel buiten de gekozen periode telt niet mee in A, B of C", () => {
    schrijfBasisBronnen(
      [
        boekingRij({ Boeking_Boekstuknr: "100", Boeking_Grootboeknr: "1712", Boeking_Bedrag_Debet: 100 }),
        boekingRij({ Boekstuk_Sleutel: "0705000002", Boeking_Boekperiode: "07", Boeking_Boekstuknr: "200", Boeking_Grootboeknr: "1712", Boeking_Bedrag_Debet: 999 }),
      ],
      [
        servicekostenRij({ Service_BK_Boekstuknummer: "100", Service_BK_Bedrag_debet: "100" }),
        servicekostenRij({ Service_BK_Boekperiode: "07", Service_BK_Boekstuknummer: "200", Service_BK_Kostensoort: "9600", Kostensoort_Soort: "Nvt", Service_BK_Bedrag_debet: "999" }),
      ],
    );

    const resultaat = genereerServicekostenPositie(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06", doelrekeningen: ["1712"] });

    expect(resultaat.actuelePositie.kostenSaldo.toString()).toBe("100");
    expect(resultaat.afrekeningVoorgaandJaar.aantalRegels).toBe(0);
    expect(resultaat.reconciliatie.perRekening[0]?.grootboekSaldo.toString()).toBe("100");
  });
});

describe("genereerServicekostenPositie — VANGRAIL: geen stilzwijgende generalisatie van het 070-patroon", () => {
  it("behandelt een afwijkend patroon (Voorschotten koppelt aan een onverwachte rekening) als WAARSCHUWING, niet als stille 070-aanname", () => {
    schrijfBasisBronnen(
      [boekingRij({ Boeking_Boekstuknr: "100", Boeking_Grootboeknr: "1600", Boeking_Bedrag_Credit: 50 })], // niet 1711
      [servicekostenRij({ Service_BK_Boekstuknummer: "100", Service_BK_Kostensoort: "2000", Kostensoort_Soort: "Voorschotten", Service_BK_Bedrag_debet: "0", Service_BK_Bedrag_credit: "50" })],
    );

    const resultaat = genereerServicekostenPositie(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06", doelrekeningen: ["1711", "1712"] });

    expect(resultaat.controleVereist.some((c) => c.sectie === "Reconciliatie" && c.ernst === "WAARSCHUWING" && c.bericht.includes('grootboekrekening "1600"'))).toBe(true);
  });

  it("behandelt een kostensoort met Kostensoort_Soort 'Nvt' die niet in de uitsluitingslijst staat als ONBEKEND, nooit als afrekening voorgaand jaar", () => {
    schrijfBasisBronnen(
      [boekingRij({ Boeking_Boekstuknr: "100", Boeking_Grootboeknr: "1712", Boeking_Bedrag_Debet: 999 })],
      [servicekostenRij({ Service_BK_Boekstuknummer: "100", Service_BK_Kostensoort: "4321", Kostensoort_Soort: "Nvt", Service_BK_Bedrag_debet: "999" })],
    );

    const resultaat = genereerServicekostenPositie(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06", doelrekeningen: ["1712"] });

    expect(resultaat.afrekeningVoorgaandJaar.aantalRegels).toBe(0);
    expect(resultaat.actuelePositie.kostenSaldo.toString()).toBe("0");
    expect(resultaat.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("niet geclassificeerd"))).toBe(true);
  });
});
