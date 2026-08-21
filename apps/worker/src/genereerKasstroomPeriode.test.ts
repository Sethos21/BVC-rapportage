import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerKasstroomPeriode } from "./genereerKasstroomPeriode.js";
import { rebuildCache } from "./rebuildCache.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, grootboekmappingPad, grootboekmappingenDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

function boekingRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "070",
    Boekstuk_Sleutel: "0704020024001",
    Boeking_Dagboeknr: "20",
    Boeking_Boekjaar: 2026,
    Boeking_Boekperiode: "01",
    Boeking_Boekstuknr: "024001",
    Boeking_Volgnr: "000001",
    Boeking_Boekdatum: "01-01-2026",
    Boeking_Grootboeknr: "1010",
    Boeking_Bedrag_Debet: 0,
    Boeking_Bedrag_Credit: 0,
    Boeking_Omschrijving: "test",
    Boeking_Saldo: "0",
    ...overrides,
  };
}

function balansRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: "070",
    Jaar: 2026,
    Grootboekrekeningnr: "1010",
    Beginbalans_debet: 0,
    Beginbalans_credit: 0,
    Saldo_debet: 0,
    Saldo_credit: 0,
    Eindsaldo: 0,
    Rekening_omschrijving: "Bank",
    Balans_vw: "Balans",
    ...overrides,
  };
}

function basisMapping(overrides: Record<string, unknown>[] = []): Record<string, unknown> {
  const basis = [
    { grootboekrekening: "1010", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", liquideMiddelen: true, actief: true, status: "GOEDGEKEURD" },
    { grootboekrekening: "1310", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", liquideMiddelen: false, actief: true, status: "GOEDGEKEURD" },
  ];
  const overrideRekeningen = new Set(overrides.map((r) => r["grootboekrekening"]));
  return {
    versie: "0.1",
    administratieId: "070_rooisezoom",
    regels: [...basis.filter((r) => !overrideRekeningen.has(r.grootboekrekening)), ...overrides],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-kasstroom-periode-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
    boekingRij({ Boeking_Boekperiode: "01", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 500, Boeking_Bedrag_Credit: 0 }),
    // periode 07: buiten de gevraagde t/m periode 06 -- moet niet meetellen
    boekingRij({ Boekstuk_Sleutel: "0704020024002", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000002", Boeking_Boekperiode: "07", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 9999, Boeking_Bedrag_Credit: 0 }),
    // huurdebiteuren-mutatie -- bevestigd GEEN liquide middelen, mag niet in de kasstroom verschijnen
    boekingRij({ Boekstuk_Sleutel: "0704020024003", Boeking_Boekstuknr: "024003", Boeking_Volgnr: "000003", Boeking_Boekperiode: "02", Boeking_Grootboeknr: "1310", Boeking_Bedrag_Debet: 200, Boeking_Bedrag_Credit: 0 }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
    balansRij({ Grootboekrekeningnr: "1010", Beginbalans_debet: 1000, Beginbalans_credit: 0, Rekening_omschrijving: "Bank" }),
    balansRij({ Grootboekrekeningnr: "1310", Beginbalans_debet: 0, Beginbalans_credit: 0, Rekening_omschrijving: "Huurdebiteuren" }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify(basisMapping()), "utf-8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerKasstroomPeriode", () => {
  it("telt beginbalans + boekingen t/m de opgegeven periode op voor een bevestigde liquide-middelen-rekening", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });

    const { resultaat } = genereerKasstroomPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    const bank = resultaat.rekeningen.find((r) => r.grootboekrekening === "1010");
    expect(bank?.eindstand.toString()).toBe("1500"); // 1000 beginbalans + 500 (periode 01), NIET periode 07 (9999)
  });

  it("sluit 1310 (Huurdebiteuren, liquideMiddelen:false) uit, ondanks een niet-nul mutatie", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });

    const { resultaat } = genereerKasstroomPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(resultaat.rekeningen.some((r) => r.grootboekrekening === "1310")).toBe(false);
    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "1310")).toBe(false);
  });

  it("markeert een BALANS-rekening met onbevestigde liquideMiddelen (null) als controleVereist bij een niet-nul mutatie", () => {
    writeFileSync(
      grootboekmappingPad(root, "070_rooisezoom"),
      JSON.stringify(basisMapping([{ grootboekrekening: "1010", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", liquideMiddelen: null, actief: true, status: "VOORGESTELD" }])),
      "utf-8",
    );
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });

    const { resultaat } = genereerKasstroomPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(resultaat.rekeningen.some((r) => r.grootboekrekening === "1010")).toBe(false);
    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "1010")).toBe(true);
  });

  it("gooit een duidelijke fout als de grootboekmapping ontbreekt", () => {
    rmSync(grootboekmappingPad(root, "070_rooisezoom"));
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    expect(() => genereerKasstroomPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" })).toThrow(/Grootboekmapping ontbreekt/);
  });
});
