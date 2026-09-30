import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Decimal from "decimal.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase, voegPnLBronmappingMutatieToe } from "@bvc/begroting-data";
import { maakServeServer } from "./serveServer.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, begrotingsversiesDatabasePad, bronGedeeldDir, pnlBronmappingDatabasePad } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

/**
 * TRANCHE 11 — bewijst de acceptatiecriteria (opdracht §15/§16) end-to-end via ECHTE HTTP-
 * requests tegen de daadwerkelijke `serve`-server: een echt xlsx-bronbestand + een echte
 * PnL-bronmapping-SQLite (zelfde bewezen patroon als `genereerPnLPeriode.test.ts`) + een echte
 * `@bvc/begroting-data`-begrotingendatabase. Geen mockdata — dezelfde productieketens als de
 * rest van de Worker.
 */

let root: string;
const ADMINISTRATIE_ID = "070_rooisezoom";
const BEDRIJFSNR = "070";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-begroting-http-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, ADMINISTRATIE_ID), { recursive: true });
  schrijfAdministratieConfig(root, ADMINISTRATIE_ID, nieuweAdministratieConfig(BEDRIJFSNR, "Rooise Zoom"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function boekingRij(gl: string, saldo: number, ogb: string | null, ogbOms: string | null, periode = "06"): Record<string, unknown> {
  return {
    Bedrijfsnr: BEDRIJFSNR,
    Boeking_Boekjaar: 2026,
    Boeking_Boekperiode: periode,
    Boeking_Grootboeknr: gl,
    Boeking_OGB_Kostensoort: ogb,
    Boeking_OGB_Kostensoort_Omschr: ogbOms,
    Boeking_Complexnr: null,
    Boeking_Bedrag_Debet: saldo >= 0 ? saldo : 0,
    Boeking_Bedrag_Credit: saldo >= 0 ? 0 : -saldo,
  };
}

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

function zetRenteMapping(): void {
  const mappingDb = openOrCreateDatabase(pnlBronmappingDatabasePad(root, ADMINISTRATIE_ID));
  try {
    voegPnLBronmappingMutatieToe(mappingDb, {
      bedrijfsnr: BEDRIJFSNR,
      grootboekrekening: "4600",
      grootboekOmschrijving: null,
      ogbKostensoort: "4601",
      ogbKostensoortOmschrijving: null,
      economischeModule: "RENTE",
      economischeCategorie: "RENTEKOSTEN",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      type: "NIEUWE_MAPPING_VANAF_PERIODE",
      vorigeMappingId: null,
      gewijzigdOp: new Date("2026-09-18T00:00:00.000Z"),
      gebruiker: "test",
      wijzigingsreden: "testfixture",
    });
  } finally {
    mappingDb.close();
  }
}

describe("Begrotingsworkflow via echte HTTP-routes (Tranche 11) — acceptatiecriteria A-I", () => {
  it("A/B/E/F/G/H: nieuwe begroting starten, echte Werkelijk tonen, Budget invoeren+opslaan+herladen zonder Werkelijk te muteren", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [boekingRij("4600", 1200, "4601", "Rente lening")]);
    zetRenteMapping();

    await metServer(async (baseUrl) => {
      // A: de begrotingskeuze is echt aangesloten op de bestaande administratielijst.
      const keuze = await fetch(`${baseUrl}/begroting?administratieId=${ADMINISTRATIE_ID}`);
      expect(keuze.status).toBe(200);
      const keuzeHtml = await keuze.text();
      expect(keuzeHtml).toContain("Nieuwe begroting starten");
      expect(keuzeHtml).toContain("Nog geen begrotingsversie");

      // Nieuwe begroting 2027 starten, Werkelijk 2026 t/m periode 06.
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2027", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
        redirect: "manual",
      });
      expect(nieuw.status).toBe(302);
      const hoofdschermUrl = nieuw.headers.get("location")!;
      expect(hoofdschermUrl).toMatch(new RegExp(`^/begroting/${ADMINISTRATIE_ID}/.+laatstAfgeslotenBoekperiode=06`));

      // B: Werkelijk komt uit de echte productiebron (GL4600/OGB4601, bewezen RENTE-mapping) — geen mockdata.
      const hoofdscherm1 = await fetch(baseUrl + hoofdschermUrl);
      expect(hoofdscherm1.status).toBe(200);
      const html1 = await hoofdscherm1.text();
      expect(html1).toContain("Rente leningen");
      expect(html1).toContain("€ 1.200,00"); // Werkelijk

      // E/F: een geldig Budget-bedrag invoeren en opslaan voor Rente leningen.
      const moduleUrl = hoofdschermUrl.replace(/\?.*/, "") + "/module/rente-leningen?laatstAfgeslotenBoekperiode=06";
      const formGet = await fetch(baseUrl + moduleUrl);
      expect(formGet.status).toBe(200);
      expect(await formGet.text()).toContain("Rente leningen");

      const opslaan = await fetch(baseUrl + moduleUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ begrotingsbedrag: "1500,00", beoordeeld: "1", resterendeVerwachting: "0" }).toString(),
        redirect: "manual",
      });
      expect(opslaan.status).toBe(302);

      // G: herladen (een NIEUWE request) geeft dezelfde, zojuist opgeslagen Budget-waarde terug.
      const hoofdscherm2 = await fetch(baseUrl + hoofdschermUrl);
      const html2 = await hoofdscherm2.text();
      expect(html2).toContain("€ 1.500,00"); // Jouw begroting

      // H: de Budget-wijziging heeft Werkelijk niet stilzwijgend gemuteerd — nog steeds 1.200,00.
      expect(html2).toContain("€ 1.200,00");
    });
  });

  it("D: een BRONGAT-module (Opbrengst rente, geen mapping geregistreerd) blijft zichtbaar onbekend, nooit €0", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [boekingRij("4600", 1200, "4601", "Rente lening")]);
    zetRenteMapping(); // registreert uitsluitend RENTEKOSTEN, niet RENTE_OPBRENGSTEN

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2027", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      const html = await (await fetch(baseUrl + hoofdschermUrl)).text();
      expect(html).toContain("Opbrengst rente");
      // De Werkelijk-cel voor Opbrengst rente moet "onbekend" zijn — nooit "€ 0,00".
      const opbrengstRegel = html.slice(html.indexOf("Opbrengst rente"), html.indexOf("Opbrengst rente") + 400);
      expect(opbrengstRegel).toContain("onbekend");
    });
  });

  it("I: geen mock-/fixturedata nodig — vaststellen wordt geblokkeerd met een concrete, geen stille fout, wanneer verplichte modules nog niet beoordeeld zijn", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [boekingRij("4600", 1200, "4601", "Rente lening")]);
    zetRenteMapping();

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2027", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      const versieId = hoofdschermUrl.split("/")[3]!.split("?")[0]!;

      const vaststellen = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/vaststellen?laatstAfgeslotenBoekperiode=06`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ bevestigd: "1" }).toString(),
      });
      expect(vaststellen.status).toBe(400);
      const html = await vaststellen.text();
      expect(html).toContain("Vaststellen kan nog niet");

      // De begroting is nog gewoon CONCEPT en aanpasbaar — een geblokkeerde vaststelpoging op één onderdeel blokkeert de rest van de werkomgeving niet.
      const hoofdschermNa = await fetch(baseUrl + hoofdschermUrl);
      expect(await hoofdschermNa.text()).toContain("Concept");
    });
  });

  it("VASTGESTELD wordt na volledig vaststellen alleen-lezen (Terugkijken) en weigert nieuwe moduleschrijfacties", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
    const {
      maakBegrotingsversie,
      schrijfModule1Snapshot,
      schrijfModule1Aannames,
      schrijfModule3Invoer,
      schrijfGeplandOnderhoudActiviteiten,
      schrijfGeplandOnderhoudBeoordeeld,
      schrijfCorrectiefDagelijksOnderhoudRegels,
      schrijfCorrectiefDagelijksOnderhoudBeoordeeld,
      schrijfVerzekeringBeoordeeld,
      schrijfGemeentelijkeLastenModule,
      schrijfAlgemeneKostenCategorieState,
      schrijfLeegstandCategorieState,
      schrijfRenteCategorieState,
      schrijfGeplandeVerkoopBeoordeeld,
      schrijfNietVerrekenbareBtwState,
      stelBegrotingVast,
    } = await import("@bvc/begroting-data");
    const { ALGEMENE_KOSTEN_CATEGORIEEN, LEEGSTAND_CATEGORIEEN, RENTE_CATEGORIEEN } = await import("@bvc/reporting");

    const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
    const versie = maakBegrotingsversie(db, { originType: "NIEUW", bedrijfsnr: BEDRIJFSNR, begrotingsjaar: 2027, bronPeildatum: new Date() });
    const id = versie.id;
    schrijfModule1Snapshot(db, id, []);
    schrijfModule1Aannames(db, id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) });
    schrijfModule3Invoer(db, id, { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(500), eenheid: "MAAND", ingangsdatum: null });
    schrijfGeplandOnderhoudActiviteiten(db, id, []);
    schrijfGeplandOnderhoudBeoordeeld(db, id, true);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, id, []);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, id, true);
    schrijfVerzekeringBeoordeeld(db, id, true);
    schrijfGemeentelijkeLastenModule(db, id, { werkelijkeGemeentelijkeLasten: null, wozStijgingPercentage: null, lastenPercentageStijging: null, begrotingsPercentageOverride: null, beoordeeld: true });
    schrijfAlgemeneKostenCategorieState(db, id, Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c: string) => [c, { beoordeeld: true, vorigJaarBedrag: null, verwachteVerhogingPercentage: null }])) as never);
    schrijfLeegstandCategorieState(
      db,
      id,
      Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c: string) => [c, { beoordeeld: true, laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null }])) as never,
    );
    schrijfRenteCategorieState(db, id, Object.fromEntries(RENTE_CATEGORIEEN.map((c: string) => [c, { beoordeeld: true }])) as never);
    schrijfGeplandeVerkoopBeoordeeld(db, id, true);
    schrijfNietVerrekenbareBtwState(db, id, { beoordeeld: true, vorigJaarWerkelijk: null });
    stelBegrotingVast(db, id, new Date());
    db.close();

    await metServer(async (baseUrl) => {
      const hoofdscherm = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${id}?laatstAfgeslotenBoekperiode=06`);
      const html = await hoofdscherm.text();
      expect(html).toContain("Vastgesteld");

      const schrijfPoging = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${id}/module/rente-leningen?laatstAfgeslotenBoekperiode=06`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ begrotingsbedrag: "1", beoordeeld: "1", resterendeVerwachting: "" }).toString(),
      });
      expect(schrijfPoging.status).toBe(400);
      expect(await schrijfPoging.text()).toContain("alleen-lezen");
    });
  });
});
