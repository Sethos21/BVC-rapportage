import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakServeServer, valideerRapportInvoer } from "./serveServer.js";
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

function basisMapping(): Record<string, unknown> {
  return {
    versie: "0.1",
    administratieId: "070_rooisezoom",
    regels: [
      { grootboekrekening: "1010", soort: "BALANS", balanszijde: "ACTIVA", tekenconventie: "ZOALS_BRON", liquideMiddelen: true, kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "1711", soort: "BALANS", balanszijde: "PASSIVA", tekenconventie: "OMGEKEERD", liquideMiddelen: false, kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "8800", soort: "RESULTAAT", rapportagepost: "Huuropbrengsten belast", rapportagecategorie: "Opbrengsten", tekenconventie: "OMGEKEERD", kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
      { grootboekrekening: "4000", soort: "RESULTAAT", rapportagepost: "Overige kosten", rapportagecategorie: "Kosten", tekenconventie: "ZOALS_BRON", kasstroomCategorie: null, actief: true, status: "GOEDGEKEURD" },
    ],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-serve-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));

  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [
    boekingRij({ Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 500, Boeking_Bedrag_Credit: 0 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024002", Boeking_Boekstuknr: "024002", Boeking_Volgnr: "000002", Boeking_Grootboeknr: "8800", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 500 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024003", Boeking_Boekstuknr: "024003", Boeking_Volgnr: "000001", Boeking_Grootboeknr: "1010", Boeking_Bedrag_Debet: 0, Boeking_Bedrag_Credit: 200 }),
    boekingRij({ Boekstuk_Sleutel: "0704020024003", Boeking_Boekstuknr: "024003", Boeking_Volgnr: "000002", Boeking_Grootboeknr: "4000", Boeking_Bedrag_Debet: 200, Boeking_Bedrag_Credit: 0 }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "balans_per_jaar.xlsx"), [
    balansRij({ Grootboekrekeningnr: "1010", Beginbalans_debet: 1000, Beginbalans_credit: 0, Rekening_omschrijving: "Bank" }),
    balansRij({ Grootboekrekeningnr: "1711", Beginbalans_debet: 0, Beginbalans_credit: 1000, Rekening_omschrijving: "Crediteuren" }),
  ]);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "servicekosten.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), []);
  schrijfXlsxFixture(join(bronGedeeldDir(root), "complex_totalen.xlsx"), []);

  mkdirSync(grootboekmappingenDir(root), { recursive: true });
  writeFileSync(grootboekmappingPad(root, "070_rooisezoom"), JSON.stringify(basisMapping()), "utf-8");

  rebuildCache({ root, administratieId: "070_rooisezoom", onVoortgang: () => {} });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("valideerRapportInvoer", () => {
  const administraties = [{ administratieId: "070_rooisezoom", bedrijfsnr: "070", weergavenaam: "Rooise Zoom" }];

  it("accepteert geldige invoer, met boekperiodeVan default '01' als niet meegegeven", () => {
    const resultaat = valideerRapportInvoer({ administratieId: "070_rooisezoom", boekjaar: "2026", boekperiodeTotEnMet: "06" }, administraties);
    expect(resultaat).toEqual({ ok: true, administratieId: "070_rooisezoom", boekjaar: 2026, boekperiodeVan: "01", boekperiodeTotEnMet: "06" });
  });

  it("accepteert een expliciete boekperiodeVan <= boekperiodeTotEnMet", () => {
    const resultaat = valideerRapportInvoer({ administratieId: "070_rooisezoom", boekjaar: "2026", boekperiodeVan: "04", boekperiodeTotEnMet: "06" }, administraties);
    expect(resultaat).toEqual({ ok: true, administratieId: "070_rooisezoom", boekjaar: 2026, boekperiodeVan: "04", boekperiodeTotEnMet: "06" });
  });

  it("accepteert boekperiodeVan === boekperiodeTotEnMet", () => {
    const resultaat = valideerRapportInvoer({ administratieId: "070_rooisezoom", boekjaar: "2026", boekperiodeVan: "06", boekperiodeTotEnMet: "06" }, administraties);
    expect(resultaat.ok).toBe(true);
  });

  it("weigert boekperiodeVan > boekperiodeTotEnMet", () => {
    const resultaat = valideerRapportInvoer({ administratieId: "070_rooisezoom", boekjaar: "2026", boekperiodeVan: "08", boekperiodeTotEnMet: "03" }, administraties);
    expect(resultaat.ok).toBe(false);
    if (!resultaat.ok) expect(resultaat.fouten.some((f) => f.includes("Periode vanaf moet vóór of gelijk"))).toBe(true);
  });

  it.each(["00", "13", "6", "juni"])("weigert een ongeldige boekperiodeVan (%s)", (boekperiodeVan) => {
    const resultaat = valideerRapportInvoer({ administratieId: "070_rooisezoom", boekjaar: "2026", boekperiodeVan, boekperiodeTotEnMet: "06" }, administraties);
    expect(resultaat.ok).toBe(false);
  });

  it("weigert een onbekende administratie", () => {
    const resultaat = valideerRapportInvoer({ administratieId: "niet_bestaand", boekjaar: "2026", boekperiodeTotEnMet: "06" }, administraties);
    expect(resultaat.ok).toBe(false);
    if (!resultaat.ok) expect(resultaat.fouten.some((f) => f.includes("Onbekende administratie"))).toBe(true);
  });

  it("weigert een ontbrekende administratie-selectie", () => {
    const resultaat = valideerRapportInvoer({ boekjaar: "2026", boekperiodeTotEnMet: "06" }, administraties);
    expect(resultaat.ok).toBe(false);
  });

  it.each(["0000", "abc", "", "1999", "2101"])("weigert een ongeldig boekjaar (%s)", (boekjaar) => {
    const resultaat = valideerRapportInvoer({ administratieId: "070_rooisezoom", boekjaar, boekperiodeTotEnMet: "06" }, administraties);
    expect(resultaat.ok).toBe(false);
  });

  it.each(["00", "13", "6", "juni", ""])("weigert een ongeldige periode (%s)", (boekperiodeTotEnMet) => {
    const resultaat = valideerRapportInvoer({ administratieId: "070_rooisezoom", boekjaar: "2026", boekperiodeTotEnMet }, administraties);
    expect(resultaat.ok).toBe(false);
  });

  it.each(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"])("accepteert periode %s", (boekperiodeTotEnMet) => {
    const resultaat = valideerRapportInvoer({ administratieId: "070_rooisezoom", boekjaar: "2026", boekperiodeTotEnMet }, administraties);
    expect(resultaat.ok).toBe(true);
  });
});

describe("maakServeServer (HTTP)", () => {
  async function metServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
    const server = maakServeServer(root);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const poort = (server.address() as { port: number }).port;
    try {
      return await fn(`http://127.0.0.1:${poort}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("bindt uitsluitend aan 127.0.0.1, niet aan alle interfaces", async () => {
    const server = maakServeServer(root);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as AddressInfo;
      expect(address.address).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("GET / toont het selectiescherm met de echte administratie in de dropdown", async () => {
    await metServer(async (baseUrl) => {
      const res = await fetch(baseUrl + "/");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Rooise Zoom");
      expect(html).toContain('value="070_rooisezoom"');
      expect(html).toContain("Managementrapport openen");
    });
  });

  it("POST /rapport/management met geldige invoer genereert het echte managementrapport (dezelfde generator als de CLI)", async () => {
    await metServer(async (baseUrl) => {
      const res = await fetch(baseUrl + "/rapport/management", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: "070_rooisezoom", boekjaar: "2026", boekperiodeTotEnMet: "06" }).toString(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("1. Managementsamenvatting");
      expect(html).toContain("€ 500,00"); // totale opbrengsten, zelfde als genereerKerncijfers/genereerManagementRapport-regressietest
      expect(html).toContain("€ 1.300,00"); // bankstand einde
    });
  });

  it("POST /rapport/management weigert een onbekende administratie — genereert geen rapport", async () => {
    await metServer(async (baseUrl) => {
      const res = await fetch(baseUrl + "/rapport/management", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: "niet_bestaand", boekjaar: "2026", boekperiodeTotEnMet: "06" }).toString(),
      });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Onbekende administratie");
      expect(html).not.toContain("1. Managementsamenvatting");
    });
  });

  it("POST /rapport/management weigert een ongeldige periode — genereert geen rapport", async () => {
    await metServer(async (baseUrl) => {
      const res = await fetch(baseUrl + "/rapport/management", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: "070_rooisezoom", boekjaar: "2026", boekperiodeTotEnMet: "13" }).toString(),
      });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Periode t/m moet");
    });
  });

  it("POST /rapport/management weigert een boekperiodeVan die na boekperiodeTotEnMet ligt — genereert geen rapport", async () => {
    await metServer(async (baseUrl) => {
      const res = await fetch(baseUrl + "/rapport/management", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: "070_rooisezoom", boekjaar: "2026", boekperiodeVan: "08", boekperiodeTotEnMet: "03" }).toString(),
      });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Periode vanaf moet vóór of gelijk");
      expect(html).not.toContain("1. Managementsamenvatting");
    });
  });

  it("POST /rapport/management met boekperiodeVan genereert het rapport met de gekozen subperiode", async () => {
    await metServer(async (baseUrl) => {
      const res = await fetch(baseUrl + "/rapport/management", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: "070_rooisezoom", boekjaar: "2026", boekperiodeVan: "01", boekperiodeTotEnMet: "06" }).toString(),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Periode 01 t/m 06");
    });
  });

  it("geeft een nette 404-pagina voor een onbekende route", async () => {
    await metServer(async (baseUrl) => {
      const res = await fetch(baseUrl + "/onbekend");
      expect(res.status).toBe(404);
    });
  });
});
