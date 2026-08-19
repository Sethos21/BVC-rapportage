import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerPlPeriode } from "./genereerPlPeriode.js";
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
    Boeking_Grootboeknr: "4000",
    Boeking_Bedrag_Debet: 0,
    Boeking_Bedrag_Credit: 0,
    Boeking_Omschrijving: "test",
    Boeking_Saldo: "0",
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-pl-periode-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
    // periode 01: kosten (Beheerkosten) + opbrengsten (Huuropbrengsten belast)
    boekingRij({ Boeking_Boekperiode: "01", Boeking_Grootboeknr: "4000", Boeking_Bedrag_Debet: 100, Boeking_Bedrag_Credit: 0 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024002", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000002", Boeking_Boekperiode: "01", Boeking_Grootboeknr: "8800", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 500 }),
    // periode 06: nog meer Beheerkosten
    boekingRij({ Boekstuk_Sleutel: "0704020024003", Boeking_Boekstuknr: "024003", Boeking_Volgnr: "000003", Boeking_Boekperiode: "06", Boeking_Grootboeknr: "4000", Boeking_Bedrag_Debet: 50, Boeking_Bedrag_Credit: 0 }),
    // periode 07: buiten de gevraagde 1 t/m 6-range, moet niet meetellen
    boekingRij({ Boekstuk_Sleutel: "0704020024004", Boeking_Boekstuknr: "024004", Boeking_Volgnr: "000004", Boeking_Boekperiode: "07", Boeking_Grootboeknr: "4000", Boeking_Bedrag_Debet: 9999, Boeking_Bedrag_Credit: 0 }),
    // een nog niet gemapte rekening met een niet-nul saldo binnen periode 1-6 — moet als controleVereist verschijnen
    boekingRij({ Boekstuk_Sleutel: "0704020024005", Boeking_Boekstuknr: "024005", Boeking_Volgnr: "000005", Boeking_Boekperiode: "02", Boeking_Grootboeknr: "9999", Boeking_Bedrag_Debet: 30, Boeking_Bedrag_Credit: 0 }),
    // een bekende BALANS-rekening (bank) met saldo — mag NIET in controleVereist verschijnen
    boekingRij({ Boekstuk_Sleutel: "0704020024006", Boeking_Boekstuknr: "024006", Boeking_Volgnr: "000006", Boeking_Boekperiode: "03", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 500, Boeking_Bedrag_Credit: 0 }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(
    grootboekmappingPad(root, "070_rooisezoom"),
    JSON.stringify({
      versie: "0.1",
      administratieId: "070_rooisezoom",
      regels: [
        { grootboekrekening: "4000", soort: "RESULTAAT", rapportagepost: "Beheerkosten", rapportagecategorie: "Kosten", tekenconventie: "ZOALS_BRON", actief: true, status: "GOEDGEKEURD" },
        { grootboekrekening: "8800", soort: "RESULTAAT", rapportagepost: "Huuropbrengsten belast", rapportagecategorie: "Opbrengsten", tekenconventie: "OMGEKEERD", actief: true, status: "GOEDGEKEURD" },
        { grootboekrekening: "1010", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", actief: true, status: "GOEDGEKEURD" },
      ],
    }),
    "utf-8",
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("genereerPlPeriode", () => {
  it("berekent alleen de opgegeven boekperiode-range, met de goedgekeurde mapping toegepast", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });

    const { resultaat } = genereerPlPeriode(root, "070_rooisezoom", {
      boekjaar: 2026,
      boekperiodeVan: "01",
      boekperiodeTotEnMet: "06",
    });

    const beheerkosten = resultaat.posten.find((p) => p.rapportagepost === "Beheerkosten");
    const huuropbrengsten = resultaat.posten.find((p) => p.rapportagepost === "Huuropbrengsten belast");
    expect(beheerkosten?.bedrag.toString()).toBe("150"); // 100 (periode 01) + 50 (periode 06), NIET periode 07 (9999)
    expect(huuropbrengsten?.bedrag.toString()).toBe("500");
  });

  it("markeert de niet-gemapte rekening 9999 als controleVereist, met het rauwe saldo", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });

    const { resultaat } = genereerPlPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeVan: "01", boekperiodeTotEnMet: "06" });

    expect(resultaat.controleVereist).toHaveLength(1);
    expect(resultaat.controleVereist[0]).toMatchObject({ grootboekrekening: "9999", saldo: expect.objectContaining({}) });
    expect(resultaat.controleVereist[0]?.saldo.toString()).toBe("30");
  });

  it("negeert de bekende BALANS-rekening 1010 stil (geen post, geen controleVereist)", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });

    const { resultaat } = genereerPlPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeVan: "01", boekperiodeTotEnMet: "06" });

    expect(resultaat.posten.some((p) => p.rapportagepost === "1010")).toBe(false);
    expect(resultaat.controleVereist.some((c) => c.grootboekrekening === "1010")).toBe(false);
  });

  it("draait zonder --verwacht (geen vergelijking) zonder te falen", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const uitkomst = genereerPlPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeVan: "01", boekperiodeTotEnMet: "06" });
    expect(uitkomst.vergelijking).toBeUndefined();
  });

  it("vergelijkt automatisch met een opgegeven verwachte-bedragenbestand", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const verwachtePad = join(root, "verwacht.json");
    writeFileSync(
      verwachtePad,
      JSON.stringify({
        "Beheerkosten": { type: "bekend", waarde: "150" },
        "Huuropbrengsten belast": { type: "bekend", waarde: "450" },
      }),
      "utf-8",
    );

    const { vergelijking } = genereerPlPeriode(root, "070_rooisezoom", {
      boekjaar: 2026,
      boekperiodeVan: "01",
      boekperiodeTotEnMet: "06",
      verwachtePad,
    });

    expect(vergelijking).toBeDefined();
    const beheerkosten = vergelijking?.regels.find((r) => r.rapportagepost === "Beheerkosten");
    const huuropbrengsten = vergelijking?.regels.find((r) => r.rapportagepost === "Huuropbrengsten belast");
    expect(beheerkosten?.sluitBinnenTolerantie).toBe(true);
    expect(huuropbrengsten?.sluitBinnenTolerantie).toBe(false);
    expect(huuropbrengsten?.verschil.toString()).toBe("50");
  });

  it("zet een expliciet onbekend verwacht bedrag in nogNietBekend, nooit als fout (bv. een post die pas eind boekjaar bepaald wordt)", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const verwachtePad = join(root, "verwacht.json");
    writeFileSync(
      verwachtePad,
      JSON.stringify({
        "Beheerkosten": { type: "bekend", waarde: "150" },
        "Huuropbrengsten belast": { type: "onbekend", reden: "Wordt pas aan het einde van het boekjaar bepaald en geboekt" },
      }),
      "utf-8",
    );

    const { vergelijking } = genereerPlPeriode(root, "070_rooisezoom", {
      boekjaar: 2026,
      boekperiodeVan: "01",
      boekperiodeTotEnMet: "06",
      verwachtePad,
    });

    expect(vergelijking?.regels.some((r) => r.rapportagepost === "Huuropbrengsten belast")).toBe(false);
    expect(vergelijking?.ontbrekendInBerekening).toEqual([]);
    expect(vergelijking?.nogNietBekend).toEqual([
      { rapportagepost: "Huuropbrengsten belast", reden: "Wordt pas aan het einde van het boekjaar bepaald en geboekt" },
    ]);
  });

  it("gooit een duidelijke fout op een ongeldig verwachte-bedragenbestand (oud, plat formaat wordt niet meer geaccepteerd)", () => {
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    const verwachtePad = join(root, "verwacht.json");
    writeFileSync(verwachtePad, JSON.stringify({ "Beheerkosten": "150" }), "utf-8");

    expect(() =>
      genereerPlPeriode(root, "070_rooisezoom", { boekjaar: 2026, boekperiodeVan: "01", boekperiodeTotEnMet: "06", verwachtePad }),
    ).toThrow(/moet een object zijn/);
  });

  it("gooit een duidelijke fout als de grootboekmapping ontbreekt", () => {
    rmSync(grootboekmappingPad(root, "070_rooisezoom"));
    rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
    expect(() => genereerPlPeriode(root, "070_rooisezoom", { boekjaar: 2026 })).toThrow(/Grootboekmapping ontbreekt/);
  });
});

describe("bestandsopzet (sanity check)", () => {
  it("gebruikt bronbestanden in bron_gedeeld/, zoals de rest van de Worker", () => {
    expect(existsSync(join(bronGedeeldDir(root), "boekingen.xlsx"))).toBe(true);
  });
});
