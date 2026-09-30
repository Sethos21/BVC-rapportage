import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openOrCreateDatabase, voegPnLBronmappingMutatieToe } from "@bvc/begroting-data";
import { maakServeServer } from "./serveServer.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir, pnlBronmappingDatabasePad } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

/**
 * TRANCHE 13 — ASSEMBLAGE: bewijst dat de vijf reeds bestaande, geaccepteerde begrotingsmodules
 * (Leegstand/Algemene kosten/Verzekeringen/Gepland onderhoud/Gemeentelijke lasten) nu daadwerkelijk
 * bereikbaar en bruikbaar zijn vanuit `/begroting` — geen nieuwe financiële logica, uitsluitend
 * UI-aansluiting op de bestaande, ongewijzigde rekenlaag/persistence. Fixturebewijs door de echte
 * productiecodeketen (geen echte BVC-productiedata).
 */

let root: string;
const ADMINISTRATIE_ID = "070_rooisezoom";
const BEDRIJFSNR = "070";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-begroting-assemblage-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, ADMINISTRATIE_ID), { recursive: true });
  schrijfAdministratieConfig(root, ADMINISTRATIE_ID, nieuweAdministratieConfig(BEDRIJFSNR, "Rooise Zoom"));
  schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

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

async function nieuweBegroting(baseUrl: string): Promise<{ hoofdschermUrl: string; moduleUrl: (key: string) => string }> {
  const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2028", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "0" }).toString(),
    redirect: "manual",
  });
  const hoofdschermUrl = nieuw.headers.get("location")!;
  const basis = hoofdschermUrl.replace(/\?.*/, "");
  return { hoofdschermUrl, moduleUrl: (key: string) => `${basis}/module/${key}?laatstAfgeslotenBoekperiode=06` };
}

describe("Assemblage Tranche 13 — vijf bestaande modules bereikbaar en invulbaar vanuit /begroting", () => {
  it("Leegstandskosten: GET toont het scherm, POST slaat op, herladen behoudt de regel, Jouw begroting LEEGSTANDSKOSTEN wijzigt", async () => {
    await metServer(async (baseUrl) => {
      const { hoofdschermUrl, moduleUrl } = await nieuweBegroting(baseUrl);
      const url = moduleUrl("leegstand");

      const getVoor = await fetch(baseUrl + url);
      expect(getVoor.status).toBe(200);
      expect(await getVoor.text()).toContain("Nuts leegstand");

      const post = await fetch(baseUrl + url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ nuts_omschrijving_0: "Verwarming leegstand unit 3", nuts_q1_0: "0", nuts_q2_0: "0", nuts_q3_0: "150", nuts_q4_0: "150", nuts_beoordeeld: "1", service_beoordeeld: "1", overige_beoordeeld: "1" }).toString(),
        redirect: "manual",
      });
      expect(post.status).toBe(302);

      const getNa = await fetch(baseUrl + url);
      expect(await getNa.text()).toContain("Verwarming leegstand unit 3");

      const hoofdscherm = await (await fetch(baseUrl + hoofdschermUrl)).text();
      expect(hoofdscherm).toContain("€ 300,00"); // Leegstandskosten Jouw begroting (150+150)
    });
  });

  it("Algemene kosten: Juridische kosten opslaan wijzigt Jouw begroting; Werkelijk blijft onbekend (070 Actual-BRONGAT, geen mapping geregistreerd)", async () => {
    await metServer(async (baseUrl) => {
      const { hoofdschermUrl, moduleUrl } = await nieuweBegroting(baseUrl);
      const url = moduleUrl("algemene-kosten");

      expect((await fetch(baseUrl + url)).status).toBe(200);

      const post = await fetch(baseUrl + url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          juridisch_omschrijving_0: "Incasso-advies",
          juridisch_jaarbedrag_0: "1250",
          accountant_beoordeeld: "1",
          juridisch_beoordeeld: "1",
          makelaar_beoordeeld: "1",
          algemeen_beoordeeld: "1",
          bank_beoordeeld: "1",
        }).toString(),
        redirect: "manual",
      });
      expect(post.status).toBe(302);

      const html = await (await fetch(baseUrl + hoofdschermUrl)).text();
      expect(html).toContain("€ 1.250,00"); // Jouw begroting Juridische kosten
      expect(html).toContain("Bron-/mappingdekking voor Algemene-Kosten-Werkelijk (JURIDISCHE_KOSTEN)"); // Werkelijk blijft onbekend, BRONGAT niet gemaskeerd
    });
  });

  it("Verzekeringen: polisregel opslaan en herladen, beoordeeld-vlag blijft bewaard", async () => {
    await metServer(async (baseUrl) => {
      const { hoofdschermUrl, moduleUrl } = await nieuweBegroting(baseUrl);
      const url = moduleUrl("verzekeringen");

      expect((await fetch(baseUrl + url)).status).toBe(200);

      const post = await fetch(baseUrl + url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ complex_0: "001", verzekeraar_0: "Interpolis", grootboekrekening_0: "4130", ingangsdatum_0: "2024-01-01", looptijd_0: "12", bedrag_0: "5180.75", index_0: "3", override_0: "5300", beoordeeld: "1" }).toString(),
        redirect: "manual",
      });
      expect(post.status).toBe(302);

      const getNa = await fetch(baseUrl + url);
      const html = await getNa.text();
      expect(html).toContain("Interpolis");
      expect(html).toContain('checked'); // beoordeeld-checkbox blijft aangevinkt

      const hoofdscherm = await (await fetch(baseUrl + hoofdschermUrl)).text();
      expect(hoofdscherm).toContain("€ 5.300,00"); // de handmatige override, niet het berekende (geïndexeerde) voorstel
    });
  });

  it("Gepland onderhoud: activiteit opslaan telt mee in de gecombineerde P&L-post Onderhoud, zonder dubbeltelling met Correctief/dagelijks", async () => {
    await metServer(async (baseUrl) => {
      const { hoofdschermUrl, moduleUrl } = await nieuweBegroting(baseUrl);
      const geplandUrl = moduleUrl("gepland-onderhoud");

      const getVoor = await fetch(baseUrl + geplandUrl);
      expect(getVoor.status).toBe(200);
      expect(await getVoor.text()).toContain("Werkelijk is alleen beschikbaar voor Onderhoud totaal");

      const post = await fetch(baseUrl + geplandUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ complex_0: "001", omschrijving_0: "Dakrenovatie", grootboekrekening_0: "4300", aanleiding_0: "MJOP", toelichting_0: "MJOP 2028, dakvervanging conform onderhoudsplan", q1_0: "1000", q2_0: "1000", q3_0: "1000", q4_0: "1000", status_0: "GEPLAND", beoordeeld: "1" }).toString(),
        redirect: "manual",
      });
      expect(post.status).toBe(302);

      const getNa = await fetch(baseUrl + geplandUrl);
      expect(await getNa.text()).toContain("Dakrenovatie");

      // De gecombineerde P&L-post Onderhoud vereist dat BEIDE submodules bewust beoordeeld zijn -- Correctief/dagelijks
      // (al bestaand sinds Tranche 11) heeft hier bewust nul regels en wordt hier expliciet beoordeeld.
      const correctiefUrl = moduleUrl("correctief");
      await fetch(baseUrl + correctiefUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ beoordeeld: "1" }).toString(), redirect: "manual" });

      const hoofdscherm = await (await fetch(baseUrl + hoofdschermUrl)).text();
      // Onderhoud = Gepland (4000) + Correctief (0, nog geen regels) = 4000 -- één post, geen dubbeltelling.
      expect(hoofdscherm).toContain("€ 4.000,00");
    });
  });

  it("Gemeentelijke lasten/WOZ: GL-regel + WOZ-object opslaan, herladen behoudt beide, Jouw begroting Gemeentelijke lasten pand wijzigt", async () => {
    const mappingDb = openOrCreateDatabase(pnlBronmappingDatabasePad(root, ADMINISTRATIE_ID));
    try {
      voegPnLBronmappingMutatieToe(mappingDb, {
        bedrijfsnr: BEDRIJFSNR,
        grootboekrekening: "4710",
        grootboekOmschrijving: null,
        ogbKostensoort: null,
        ogbKostensoortOmschrijving: null,
        economischeModule: "GEMEENTELIJKE_LASTEN",
        economischeCategorie: "GEMEENTELIJKE_LASTEN",
        geldigVanafBoekjaar: 2020,
        geldigVanafPeriode: "01",
        geldigTotBoekjaar: null,
        geldigTotPeriode: null,
        type: "NIEUWE_MAPPING_VANAF_PERIODE",
        vorigeMappingId: null,
        gewijzigdOp: new Date("2026-01-01T00:00:00.000Z"),
        gebruiker: "test",
        wijzigingsreden: "testfixture",
      });
    } finally {
      mappingDb.close();
    }

    await metServer(async (baseUrl) => {
      const { hoofdschermUrl, moduleUrl } = await nieuweBegroting(baseUrl);
      const url = moduleUrl("gemeentelijke-lasten");

      const getVoor = await fetch(baseUrl + url);
      expect(getVoor.status).toBe(200);
      expect(await getVoor.text()).toContain("WOZ-historie");

      const post = await fetch(baseUrl + url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          actie: "opslaan",
          gl_grootboekrekening_0: "4710",
          gl_jaarbedrag_0: "9500",
          woz_complex_0: "001",
          woz_objectType_0: "GEHEEL_COMPLEX",
          woz_aanslagjaar_0: "2026",
          woz_waardepeildatum_0: "2026-01-01",
          woz_werkelijk_0: "1000000",
          wozSetBevestigd: "1",
          wozStijging: "2",
          lastenStijging: "0",
          werkelijkeLasten: "9500",
          beoordeeld: "1",
        }).toString(),
        redirect: "manual",
      });
      expect(post.status).toBe(302);

      const getNa = await fetch(baseUrl + url);
      const html = await getNa.text();
      expect(html).toContain("4710");
      expect(html).toContain('value="1000000"');

      const hoofdscherm = await (await fetch(baseUrl + hoofdschermUrl)).text();
      expect(hoofdscherm).toContain("€ 9.500,00");
    });
  });
});
