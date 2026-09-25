import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerKasstroomManagementoverzicht } from "./genereerKasstroomManagementoverzicht.js";
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
    Boeking_Boekdatum: "15-01-2026",
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

function basisMapping(): Record<string, unknown> {
  return {
    versie: "0.1",
    administratieId: "070_rooisezoom",
    regels: [
      { grootboekrekening: "1010", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", liquideMiddelen: true, kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "1310", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", liquideMiddelen: false, kasstroomCategorie: "HUURONTVANGST", actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "0840", soort: "BALANS", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD", liquideMiddelen: false, kasstroomCategorie: "EIGENAARONTTREKKING", actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "4000", soort: "RESULTAAT", rapportagepost: "Onderhoud", rapportagecategorie: "Kosten", tekenconventie: "ZOALS_BRON", kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
    ],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-kasstroom-mgmt-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
    boekingRij({ Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 1000, Boeking_Bedrag_Credit: 0 }),
    boekingRij({ Boeking_Volgnr: "000002", Boeking_Grootboeknr: "1310", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 1000 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024002", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000001", Boeking_Boekperiode: "02", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 300 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024002", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000002", Boeking_Boekperiode: "02", Boeking_Grootboeknr: "0840", Boeking_Bedrag_Debet: 300, Boeking_Bedrag_Credit: 0 }),
    boekingRij({
      Boekstuk_Sleutel: "0704020024003",
      Boeking_Boekstuknr: "024003",
      Boeking_Volgnr: "000001",
      Boeking_Boekperiode: "03",
      Boeking_Boekdatum: "01-03-2026",
      Boeking_Grootboeknr: "1010",
      Boeking_Bedrag_Debet: 0,
      Boeking_Bedrag_Credit: 150,
      Boeking_Omschrijving: "Dakreparatie",
    }),
    boekingRij({
      Boekstuk_Sleutel: "0704020024003",
      Boeking_Boekstuknr: "024003",
      Boeking_Volgnr: "000002",
      Boeking_Boekperiode: "03",
      Boeking_Boekdatum: "01-03-2026",
      Boeking_Grootboeknr: "4000",
      Boeking_Bedrag_Debet: 150,
      Boeking_Bedrag_Credit: 0,
      Boeking_Omschrijving: "Dakreparatie",
    }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
    balansRij({ Grootboekrekeningnr: "1010", Beginbalans_debet: 2000, Beginbalans_credit: 0, Rekening_omschrijving: "Bank" }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify(basisMapping()), "utf-8");

  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerKasstroomManagementoverzicht", () => {
  it("schrijft een HTML-bestand naar rapporten/ met ontvangsten en de eigenaaronttrekkingen-uitsplitsing", () => {
    const resultaat = genereerKasstroomManagementoverzicht(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });

    expect(existsSync(resultaat.pad)).toBe(true);
    const geschreven = readFileSync(resultaat.pad, "utf-8");
    expect(geschreven).toBe(resultaat.html);
    expect(resultaat.resultaat.ontvangsten.toString()).toBe("1000");
    expect(resultaat.resultaat.uitgaven.toString()).toBe("450");
    expect(resultaat.resultaat.eigenaarOnttrekkingen.toString()).toBe("300");
    expect(resultaat.resultaat.overigeUitgaven.toString()).toBe("150");
    expect(resultaat.resultaat.bankstandBegin.toString()).toBe("2000");
    expect(resultaat.resultaat.bankstandEind.toString()).toBe("2550");
  });

  it("levert de top overige uitgaven, exclusief de eigenaaronttrekking", () => {
    const resultaat = genereerKasstroomManagementoverzicht(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });
    expect(resultaat.topOverigeUitgaven).toHaveLength(1);
    expect(resultaat.topOverigeUitgaven[0]?.omschrijving).toBe("Dakreparatie");
    expect(resultaat.topOverigeUitgaven[0]?.bedrag.toString()).toBe("150");
    expect(resultaat.html).toContain("Dakreparatie");
  });

  it("gooit een duidelijke fout als de grootboekmapping ontbreekt", () => {
    rmSync(grootboekmappingPad(root, "070_rooisezoom"));
    expect(() => genereerKasstroomManagementoverzicht(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" })).toThrow(/Grootboekmapping ontbreekt/);
  });

  it("--verwacht: sluit volledig als het verwachte bestand exact de berekende uitkomst bevat (regressiepunt)", () => {
    const basis = genereerKasstroomManagementoverzicht(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06" });
    const verwachtePad = join(root, "verwacht-kasstroom.json");
    writeFileSync(
      verwachtePad,
      JSON.stringify({
        bankstandBegin: basis.resultaat.bankstandBegin.toString(),
        bankstandEind: basis.resultaat.bankstandEind.toString(),
        ontvangsten: basis.resultaat.ontvangsten.toString(),
        uitgaven: basis.resultaat.uitgaven.toString(),
        nettoKasstroom: basis.resultaat.nettoKasstroom.toString(),
        eigenaarOnttrekkingen: basis.resultaat.eigenaarOnttrekkingen.toString(),
        overigeUitgaven: basis.resultaat.overigeUitgaven.toString(),
        perKwartaal: basis.resultaat.perKwartaal.map((k) => ({
          kwartaal: k.kwartaal,
          ontvangsten: k.ontvangsten.toString(),
          uitgaven: k.uitgaven.toString(),
          eigenaarOnttrekkingen: k.eigenaarOnttrekkingen.toString(),
          nettoKasstroom: k.nettoKasstroom.toString(),
        })),
      }),
      "utf-8",
    );

    const resultaat = genereerKasstroomManagementoverzicht(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06", verwachtePad });
    expect(resultaat.vergelijking?.alleSluitenBinnenTolerantie).toBe(true);
  });

  it("--verwacht: signaleert een afwijking als het verwachte bestand niet meer overeenkomt", () => {
    const verwachtePad = join(root, "verwacht-kasstroom.json");
    writeFileSync(
      verwachtePad,
      JSON.stringify({
        bankstandBegin: "2000",
        bankstandEind: "2550",
        ontvangsten: "1000",
        uitgaven: "450",
        nettoKasstroom: "550",
        eigenaarOnttrekkingen: "0", // afwijkend: verwacht 300
        overigeUitgaven: "450",
        perKwartaal: [1, 2, 3, 4].map((kwartaal) => ({ kwartaal, ontvangsten: "0", uitgaven: "0", eigenaarOnttrekkingen: "0", nettoKasstroom: "0" })),
      }),
      "utf-8",
    );

    const resultaat = genereerKasstroomManagementoverzicht(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeTotEnMet: "06", verwachtePad });
    expect(resultaat.vergelijking?.alleSluitenBinnenTolerantie).toBe(false);
    expect(resultaat.vergelijking?.regels.find((r) => r.label === "Eigenaaronttrekkingen")?.sluitBinnenTolerantie).toBe(false);
  });
});
