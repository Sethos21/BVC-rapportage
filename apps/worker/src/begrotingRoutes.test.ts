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
      // (UX-uitrol: de rij bevat nu ook een inline-uitklap-link met data-attributen, vandaar het ruimere venster.)
      const opbrengstRegel = html.slice(html.indexOf("Opbrengst rente"), html.indexOf("Opbrengst rente") + 700);
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
      schrijfVerzekeringRegels,
      schrijfVerzekeringBeoordeeld,
      schrijfGemeentelijkeLastenModule,
      schrijfGemeentelijkeLastenRegels,
      schrijfAlgemeneKostenCategorieState,
      schrijfLeegstandCategorieState,
      schrijfRenteCategorieState,
      schrijfNietVerrekenbareBtwState,
      stelBegrotingVast,
    } = await import("@bvc/begroting-data");
    const { ALGEMENE_KOSTEN_CATEGORIEEN, LEEGSTAND_CATEGORIEEN, RENTE_CATEGORIEEN } = await import("@bvc/reporting");

    const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
    const versie = maakBegrotingsversie(db, { originType: "NIEUW", bedrijfsnr: BEDRIJFSNR, begrotingsjaar: 2027, bronPeildatum: new Date() });
    const id = versie.id;
    schrijfModule1Snapshot(db, id, []);
    schrijfModule1Aannames(db, id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) }, "06");
    schrijfModule3Invoer(db, id, { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(500), eenheid: "MAAND", ingangsdatum: null });
    schrijfGeplandOnderhoudActiviteiten(db, id, [
      {
        id: null,
        complexnummer: "001",
        omschrijving: "Dakrenovatie terugkijktest",
        grootboekrekening: "4300",
        ogbKostensoort: null,
        aanleidingType: "MJOP",
        aanleidingToelichting: "MJOP 2027, dakvervanging conform onderhoudsplan",
        q1: new Decimal(1000),
        q2: new Decimal(1000),
        q3: new Decimal(1000),
        q4: new Decimal(1000),
        status: "GEPLAND",
        leverancier: null,
        offertebedrag: null,
        notitie: null,
      },
    ]);
    schrijfGeplandOnderhoudBeoordeeld(db, id, true);
    schrijfCorrectiefDagelijksOnderhoudRegels(db, id, []);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, id, true);
    schrijfVerzekeringRegels(db, id, [
      {
        id: null,
        complexnummer: "001",
        verzekeraar: "Interpolis terugkijktest",
        grootboekrekening: "4130",
        ogbKostensoort: null,
        ingangsdatum: new Date("2024-01-01T00:00:00.000Z"),
        looptijdMaanden: 12,
        bedrag: new Decimal("5180.75"),
        indexPercentage: new Decimal(3),
        handmatigBegrootOverride: new Decimal(5300),
      },
    ]);
    schrijfVerzekeringBeoordeeld(db, id, true);
    voegPnLBronmappingMutatieToe(db, {
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
    schrijfGemeentelijkeLastenRegels(db, id, [{ id: null, grootboekrekening: "4710", ogbKostensoort: null, jaarbedrag: new Decimal(9500) }]);
    schrijfGemeentelijkeLastenModule(db, id, { werkelijkeGemeentelijkeLasten: null, wozStijgingPercentage: null, lastenPercentageStijging: null, begrotingsPercentageOverride: null, beoordeeld: true });
    schrijfAlgemeneKostenCategorieState(db, id, Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c: string) => [c, { beoordeeld: true, vorigJaarBedrag: null, verwachteVerhogingPercentage: null }])) as never);
    schrijfLeegstandCategorieState(
      db,
      id,
      Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c: string) => [c, { beoordeeld: true, laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null }])) as never,
    );
    schrijfRenteCategorieState(db, id, Object.fromEntries(RENTE_CATEGORIEEN.map((c: string) => [c, { beoordeeld: true }])) as never);
    // Geplande Verkoop is contractueel HOLD (Master Contract §8) en neemt bewust NIET deel aan de
    // vaststel-gate — geen `schrijfGeplandeVerkoopBeoordeeld`-aanroep hier bewijst dat vaststellen via de
    // volledige begrotingsketen ook zonder deze beoordeling slaagt (product-readiness fix).
    schrijfNietVerrekenbareBtwState(db, id, { beoordeeld: true, vorigJaarWerkelijk: null });
    stelBegrotingVast(db, id, new Date());
    db.close();

    await metServer(async (baseUrl) => {
      const hoofdscherm = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${id}?laatstAfgeslotenBoekperiode=06`);
      const html = await hoofdscherm.text();
      expect(html).toContain("Vastgesteld");
      // UX-assemblagedelta (docs/begroting/ux/): hoofdscherm gebruikt de vastgestelde werkomgeving-shell
      // (zijbalk + status-pill), niet de kale paginaShell.
      expect(html).toContain('class="sidebar"');
      expect(html).toContain('class="pill vastgesteld"');

      // UX_13 Terugkijken: de controleren/vaststellen-pagina toont bij VASTGESTELD een leesbare
      // bevestigingsbanner in plaats van het vaststel-formulier.
      const controleVastgesteld = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${id}/controle?laatstAfgeslotenBoekperiode=06`);
      expect(controleVastgesteld.status).toBe(200);
      const controleHtml = await controleVastgesteld.text();
      expect(controleHtml).toContain("Begroting vastgesteld");
      expect(controleHtml).not.toContain('name="bevestigd"');

      const schrijfPoging = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${id}/module/rente-leningen?laatstAfgeslotenBoekperiode=06`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ begrotingsbedrag: "1", beoordeeld: "1", resterendeVerwachting: "" }).toString(),
      });
      expect(schrijfPoging.status).toBe(400);
      expect(await schrijfPoging.text()).toContain("alleen-lezen");

      // Generieke read-only lifecycle (Tranche 14): ELKE aangesloten detailmodule blijft na
      // VASTGESTELD leesbaar (GET, waarden zichtbaar, `fieldset disabled`) maar weigert schrijfacties
      // (POST -> 400 "alleen-lezen") -- dezelfde detailpagina/render-functie, geen tweede read-only UI.
      const moduleUrl = (key: string) => `${baseUrl}/begroting/${ADMINISTRATIE_ID}/${id}/module/${key}?laatstAfgeslotenBoekperiode=06`;
      const alleenLezenModules: ReadonlyArray<{ key: string; verwachteWaarde: string }> = [
        { key: "management", verwachteWaarde: "500" },
        { key: "correctief", verwachteWaarde: "Correctief" },
        { key: "btw", verwachteWaarde: "btw" },
        { key: "rente-leningen", verwachteWaarde: "Rente leningen" },
        { key: "rente-opbrengst", verwachteWaarde: "Opbrengst rente" },
        { key: "leegstand", verwachteWaarde: "Leegstandskosten" },
        { key: "algemene-kosten", verwachteWaarde: "Algemene kosten" },
        { key: "verzekeringen", verwachteWaarde: "Interpolis terugkijktest" },
        { key: "gepland-onderhoud", verwachteWaarde: "Dakrenovatie terugkijktest" },
        { key: "gemeentelijke-lasten", verwachteWaarde: "9500" },
      ];
      for (const { key, verwachteWaarde } of alleenLezenModules) {
        const getResp = await fetch(moduleUrl(key));
        expect.soft(getResp.status, `GET ${key}`).toBe(200);
        const getHtml = await getResp.text();
        expect.soft(getHtml, `${key} bevat fieldset disabled`).toContain("<fieldset disabled");
        expect.soft(getHtml, `${key} bevat alleen-lezen banner`).toContain("alleen-lezen");
        expect.soft(getHtml, `${key} toont opgeslagen waarde`).toContain(verwachteWaarde);

        const postResp = await fetch(moduleUrl(key), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ beoordeeld: "1" }).toString(),
        });
        expect.soft(postResp.status, `POST ${key} geblokkeerd`).toBe(400);
        expect.soft(await postResp.text(), `POST ${key} meldt alleen-lezen`).toContain("alleen-lezen");
      }
    });
  });
});

/**
 * UX-UITROL (2026-10-02, Sectie 3) — bewijst de "BELANGRIJK ACCEPTATIEPUNT"-scenario's: de
 * Gepland- en Correctief/Dagelijks-detailschermen tonen nu het bestaande, al-bewezen
 * `leesOnderhoudTotaalResultaat`-totaal (Begroting/Werkelijk/Estimated), i.p.v. alleen hun eigen
 * geïsoleerde moduletotaal. Reusing: geen nieuwe berekening, alleen UI-orchestratie.
 */
describe("Onderhoud totaal zichtbaar op Gepland- en Correctief-detailscherm (UX-uitrol, Sectie 3)", () => {
  it("alleen Gepland ingevuld: Correctief toont €0, totaal = Gepland, Werkelijk en Estimated zichtbaar", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [boekingRij("4300", 300, null, null), boekingRij("4330", 150, null, null), boekingRij("4340", 75, null, null)]);
    const mappingDb = openOrCreateDatabase(pnlBronmappingDatabasePad(root, ADMINISTRATIE_ID));
    voegPnLBronmappingMutatieToe(mappingDb, pnlMapping("4300", "ONDERHOUD_GEBOUWEN"));
    voegPnLBronmappingMutatieToe(mappingDb, pnlMapping("4330", "ONDERHOUD_TERREIN"));
    voegPnLBronmappingMutatieToe(mappingDb, pnlMapping("4340", "ONDERHOUD_INSTALLATIES"));
    mappingDb.close();

    const { schrijfGeplandOnderhoudActiviteiten, schrijfGeplandOnderhoudBeoordeeld } = await import("@bvc/begroting-data");

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2027", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      const versieId = hoofdschermUrl.split("/")[3]!.split("?")[0]!;

      const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      schrijfGeplandOnderhoudActiviteiten(db, versieId, [
        {
          id: null,
          complexnummer: "001",
          omschrijving: "Dakrenovatie",
          grootboekrekening: "4300",
          ogbKostensoort: null,
          aanleidingType: "MJOP",
          aanleidingToelichting: "MJOP 2027",
          q1: new Decimal(1000),
          q2: new Decimal(1000),
          q3: new Decimal(1000),
          q4: new Decimal(1000),
          status: "GEPLAND",
          leverancier: null,
          offertebedrag: null,
          notitie: null,
        },
      ]);
      schrijfGeplandOnderhoudBeoordeeld(db, versieId, true);
      db.close();

      const geplandHtml = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/gepland-onderhoud?laatstAfgeslotenBoekperiode=06`)).text();
      expect(geplandHtml).toContain("Onderhoud totaal");
      expect(geplandHtml).toContain("€ 4.000,00"); // Begroting Gepland + Begroting Onderhoud totaal (Correctief nog leeg)
      expect(geplandHtml).toContain("€ 0,00"); // Begroting Correctief/dagelijks (nog niets ingevuld)
      expect(geplandHtml).toContain("€ 525,00"); // Werkelijk Onderhoud totaal (300+150+75), exact één keer bepaald
      expect(geplandHtml).toContain("Estimated Onderhoud totaal");

      const correctiefHtml = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/correctief?laatstAfgeslotenBoekperiode=06`)).text();
      // Zelfde samengestelde totaal zichtbaar op de Correctief-pagina — geen tweede, afwijkende berekening.
      expect(correctiefHtml).toContain("€ 4.000,00");
      expect(correctiefHtml).toContain("€ 525,00");
    });
  });

  it("alleen Correctief ingevuld: Gepland toont €0, totaal = Correctief, zichtbaar op beide schermen", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [boekingRij("4300", 300, null, null), boekingRij("4330", 150, null, null), boekingRij("4340", 75, null, null)]);
    const mappingDb = openOrCreateDatabase(pnlBronmappingDatabasePad(root, ADMINISTRATIE_ID));
    voegPnLBronmappingMutatieToe(mappingDb, pnlMapping("4300", "ONDERHOUD_GEBOUWEN"));
    voegPnLBronmappingMutatieToe(mappingDb, pnlMapping("4330", "ONDERHOUD_TERREIN"));
    voegPnLBronmappingMutatieToe(mappingDb, pnlMapping("4340", "ONDERHOUD_INSTALLATIES"));
    mappingDb.close();

    const { schrijfCorrectiefDagelijksOnderhoudRegels, schrijfCorrectiefDagelijksOnderhoudBeoordeeld } = await import("@bvc/begroting-data");

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2027", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      const versieId = hoofdschermUrl.split("/")[3]!.split("?")[0]!;

      const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      schrijfCorrectiefDagelijksOnderhoudRegels(db, versieId, [{ id: null, omschrijving: "Dagelijks onderhoud", complexnummer: "001", grootboekrekening: "4330", ogbKostensoort: null, jaarbedrag: new Decimal(1200) }]);
      schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versieId, true);
      db.close();

      const geplandHtml = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/gepland-onderhoud?laatstAfgeslotenBoekperiode=06`)).text();
      const correctiefHtml = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/correctief?laatstAfgeslotenBoekperiode=06`)).text();
      // Begroting Onderhoud totaal = 0 (Gepland) + 1200 (Correctief) = 1200, identiek op beide schermen.
      expect(geplandHtml).toContain("€ 1.200,00");
      expect(correctiefHtml).toContain("€ 1.200,00");
      expect(geplandHtml).toContain("€ 525,00");
      expect(correctiefHtml).toContain("€ 525,00");
    });
  });

  it("beide (Gepland + Correctief) ingevuld: Onderhoud totaal = som, Werkelijk blijft exact hetzelfde getal op beide schermen", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), [boekingRij("4300", 300, null, null), boekingRij("4330", 150, null, null), boekingRij("4340", 75, null, null)]);
    const mappingDb = openOrCreateDatabase(pnlBronmappingDatabasePad(root, ADMINISTRATIE_ID));
    voegPnLBronmappingMutatieToe(mappingDb, pnlMapping("4300", "ONDERHOUD_GEBOUWEN"));
    voegPnLBronmappingMutatieToe(mappingDb, pnlMapping("4330", "ONDERHOUD_TERREIN"));
    voegPnLBronmappingMutatieToe(mappingDb, pnlMapping("4340", "ONDERHOUD_INSTALLATIES"));
    mappingDb.close();

    const { schrijfGeplandOnderhoudActiviteiten, schrijfGeplandOnderhoudBeoordeeld, schrijfCorrectiefDagelijksOnderhoudRegels, schrijfCorrectiefDagelijksOnderhoudBeoordeeld } = await import("@bvc/begroting-data");

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2027", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      const versieId = hoofdschermUrl.split("/")[3]!.split("?")[0]!;

      const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      schrijfGeplandOnderhoudActiviteiten(db, versieId, [
        {
          id: null,
          complexnummer: "001",
          omschrijving: "Dakrenovatie",
          grootboekrekening: "4300",
          ogbKostensoort: null,
          aanleidingType: "MJOP",
          aanleidingToelichting: "MJOP 2027",
          q1: new Decimal(1000),
          q2: new Decimal(1000),
          q3: new Decimal(1000),
          q4: new Decimal(1000),
          status: "GEPLAND",
          leverancier: null,
          offertebedrag: null,
          notitie: null,
        },
      ]);
      schrijfGeplandOnderhoudBeoordeeld(db, versieId, true);
      schrijfCorrectiefDagelijksOnderhoudRegels(db, versieId, [{ id: null, omschrijving: "Dagelijks onderhoud", complexnummer: "001", grootboekrekening: "4330", ogbKostensoort: null, jaarbedrag: new Decimal(1200) }]);
      schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versieId, true);
      db.close();

      const geplandHtml = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/gepland-onderhoud?laatstAfgeslotenBoekperiode=06`)).text();
      const correctiefHtml = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/correctief?laatstAfgeslotenBoekperiode=06`)).text();

      // Begroting Onderhoud totaal = 4000 (Gepland) + 1200 (Correctief) = 5200, identiek op beide schermen.
      expect(geplandHtml).toContain("€ 5.200,00");
      expect(correctiefHtml).toContain("€ 5.200,00");
      // Werkelijk Onderhoud totaal (525) komt exact één keer voor — geen optelling per module, hetzelfde getal op beide schermen.
      expect(geplandHtml).toContain("€ 525,00");
      expect(correctiefHtml).toContain("€ 525,00");
      // Estimated Onderhoud totaal = Werkelijk (525) + resterende verwachting (0, geen Estimated-verwachtingen ingevuld).
      expect(geplandHtml).toContain("Estimated Onderhoud totaal");
      expect(correctiefHtml).toContain("Estimated Onderhoud totaal");
    });
  });
});

/**
 * UX-UITROL (2026-10-02, generieke regel) — bewijst dat de nieuwe, gedeelde
 * `moduleWerkomgevingPnLHtml` daadwerkelijk is aangesloten op een moduledetailscherm (hier
 * Managementvergoeding, het eenvoudigste geval): dezelfde vergelijkende-P&L-rij als op het
 * hoofdscherm is nu ook zichtbaar op het detailscherm zelf. De onderliggende berekening
 * (`leesVergelijkendeBegrotingsPnL`) is al uitgebreid getest elders — dit bewijst uitsluitend de
 * UI-bedrading (handler -> render), niet de financiële uitkomst zelf.
 */
describe("Vergelijkende P&L zichtbaar op overige moduledetailschermen (UX-uitrol, generieke regel)", () => {
  it("Managementvergoeding-detailscherm toont de Vergelijkende-P&L-samenvatting met dezelfde regel als het hoofdscherm", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2027", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      const versieId = hoofdschermUrl.split("/")[3]!.split("?")[0]!;

      await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/management?laatstAfgeslotenBoekperiode=06`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ wijze: "NIEUWE_VERGOEDING", bedrag: "500", eenheid: "MAAND", ingangsdatum: "", beoordeeld: "1" }).toString(),
      });

      const managementHtml = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/management?laatstAfgeslotenBoekperiode=06`)).text();
      expect(managementHtml).toContain("Vergelijkende P&amp;L");
      expect(managementHtml).toContain("Managementvergoeding");
      // Geen vorigjaarversie/Werkelijk-bron aanwezig in deze fixture: blijft zichtbaar "onbekend", nooit stilzwijgend €0.
      expect(managementHtml).toContain("onbekend");

      const hoofdschermHtml = await (await fetch(baseUrl + hoofdschermUrl)).text();
      // Zelfde rij, zelfde label, al aanwezig op het hoofdscherm — geen tweede, afwijkende berekening op het detailscherm.
      expect(hoofdschermHtml).toContain("Managementvergoeding");
    });
  });
});

/**
 * UX-UITROL (2026-10-02, §9.2) — de WOZ-historie-CSV-export (`leesWozHistorieCsv`, al volledig
 * gebouwd en getest in `@bvc/begroting-data`/`@bvc/reporting`) was niet aangesloten op een route.
 * Bewijst de nieuwe GET-route + de "zichtbaar maar uitgeschakeld zonder bevestigde set"-regel.
 */
describe("WOZ-historie CSV-export (UX-uitrol §9.2)", () => {
  it("export is uitgeschakeld zonder bevestigde WOZ-set, en beschikbaar met correcte CSV na bevestiging", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
    const { schrijfWozObjecten, schrijfWozSetBevestigd } = await import("@bvc/begroting-data");

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2027", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      const versieId = hoofdschermUrl.split("/")[3]!.split("?")[0]!;
      const csvUrl = `${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/gemeentelijke-lasten/woz-historie.csv`;
      const glUrl = `${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/gemeentelijke-lasten?laatstAfgeslotenBoekperiode=06`;

      const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      schrijfWozObjecten(db, versieId, [
        { id: null, complexnummer: "001", objectType: "GEHEEL_COMPLEX", unitnummer: null, aanslagjaar: 2026, waardepeildatum: new Date("2025-01-01T00:00:00.000Z"), werkelijkeWoz: new Decimal(500000), verwachteWozOverride: null },
      ]);
      db.close();

      // Vóór bevestiging: het GL-scherm toont de export-link als uitgeschakeld, en de route zelf weigert.
      const glHtmlVoor = await (await fetch(glUrl)).text();
      expect(glHtmlVoor).toContain("pas beschikbaar na bevestiging");
      const csvVoor = await fetch(csvUrl);
      expect(csvVoor.status).toBe(400);
      expect(await csvVoor.text()).toContain("nog niet bevestigd");

      const db2 = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      schrijfWozSetBevestigd(db2, versieId, true);
      db2.close();

      // Na bevestiging: het GL-scherm toont een echte link, en de route levert een correcte CSV.
      const glHtmlNa = await (await fetch(glUrl)).text();
      expect(glHtmlNa).toContain(`href="${csvUrl.slice(baseUrl.length)}"`);
      const csvNa = await fetch(csvUrl);
      expect(csvNa.status).toBe(200);
      expect(csvNa.headers.get("content-type")).toContain("text/csv");
      const csvTekst = await csvNa.text();
      expect(csvTekst.split("\r\n")[0]).toBe("Administratie;Complex;Unit/Geheel complex;Aanslagjaar;Waardepeildatum;Werkelijke WOZ;Verschil € vorig jaar;Verschil % vorig jaar");
      expect(csvTekst).toContain("001;Geheel complex;2026;2025-01-01;500000");
    });
  });
});

/**
 * UX-UITROL (2026-10-02, §9.1) — "Maandverloop" (`berekenVerzekeringMaandverloop`, al volledig
 * gebouwd en getest in `@bvc/reporting`) was niet aangesloten op een route. Bewijst de nieuwe
 * link + sub-pagina, inclusief het expliciete "onbekend" (nooit een stille €0-reeks) voor een
 * polis zonder rekenkritische velden.
 */
describe("Verzekeringen — Maandverloop (UX-uitrol §9.1)", () => {
  it("Maandverloop-link opent de maand-/kwartaalverdeling voor een complete polis, en toont onbekend voor een onvolledige polis", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
    const { schrijfVerzekeringRegels } = await import("@bvc/begroting-data");

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2027", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      const versieId = hoofdschermUrl.split("/")[3]!.split("?")[0]!;

      const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      schrijfVerzekeringRegels(db, versieId, [
        { id: null, complexnummer: "001", verzekeraar: "Interpolis", grootboekrekening: "4130", ogbKostensoort: null, ingangsdatum: new Date("2024-01-01T00:00:00.000Z"), looptijdMaanden: 12, bedrag: new Decimal(1200), indexPercentage: new Decimal(0), handmatigBegrootOverride: null },
        { id: null, complexnummer: "002", verzekeraar: "Onvolledige polis", grootboekrekening: "4130", ogbKostensoort: null, ingangsdatum: null, looptijdMaanden: null, bedrag: null, indexPercentage: null, handmatigBegrootOverride: null },
      ]);
      db.close();

      const verzekeringenUrl = `${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/verzekeringen?laatstAfgeslotenBoekperiode=06`;
      const verzekeringenHtml = await (await fetch(verzekeringenUrl)).text();
      expect(verzekeringenHtml).toContain("Maandverloop");
      const maandverloopMatch = verzekeringenHtml.match(/module\/verzekeringen\/maandverloop\?polisId=(\d+)/g);
      expect(maandverloopMatch).not.toBeNull();
      expect(maandverloopMatch!.length).toBe(2); // beide polissen hebben een id en dus een link, ongeacht volledigheid

      const [compleetUrl, onvolledigUrl] = maandverloopMatch!.map((m) => `${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/${m}`);

      const compleetHtml = await (await fetch(compleetUrl!)).text();
      expect(compleetHtml).toContain("januari");
      expect(compleetHtml).toContain("december");
      expect(compleetHtml).toContain("€ 100,00"); // 1200/12, geen indexatie
      expect(compleetHtml).toContain("Q1");

      const onvolledigHtml = await (await fetch(onvolledigUrl!)).text();
      expect(onvolledigHtml).toContain("onbekend");
      expect(onvolledigHtml).not.toContain("€ 0,00"); // nooit een stille €0-reeks
    });
  });
});

/**
 * UX-UITROL (2026-10-06, ARCHITECTUURPUNT-besluit) — bewijst de inline-uitklapbare detailweergave
 * (UX_01/prototype): het hoofdscherm bevat per bewerkbare regel een `[data-expand]`-link met een
 * `?fragment=1`-URL naar DEZELFDE bestaande route; die route levert dan uitsluitend de
 * formulierinhoud (geen zijbalk/`<html>`-skelet), en een normale (niet-fragment) aanroep van
 * exact dezelfde URL blijft de volledige pagina — bewijst dat er geen tweede render-pad is.
 */
describe("Inline-uitklapbare detailweergave op het hoofdscherm (UX-uitrol, ARCHITECTUURPUNT-besluit)", () => {
  it("hoofdscherm bevat data-expand-links met fragment-URL's; de route levert fragment vs. volledige pagina op basis van ?fragment=1", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2027", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;

      const hoofdschermHtml = await (await fetch(baseUrl + hoofdschermUrl)).text();
      expect(hoofdschermHtml).toContain("data-expand=");
      expect(hoofdschermHtml).toContain('class="detail-row"');
      expect(hoofdschermHtml).toContain("<script>"); // de enige client-side JS in de module, uitsluitend op het hoofdscherm

      const managementUrlMatch = hoofdschermHtml.match(/data-url="([^"]*\/module\/management\?[^"]*)"/);
      expect(managementUrlMatch).not.toBeNull();
      const managementUrl = managementUrlMatch![1]!.replace(/&amp;/g, "&");

      // Volledige pagina (geen ?fragment=1): bevat het paginaskelet.
      const volledigeHtml = await (await fetch(baseUrl + managementUrl)).text();
      expect(volledigeHtml).toContain('class="sidebar"');
      expect(volledigeHtml.toLowerCase()).toContain("<!doctype html>");
      expect(volledigeHtml).toContain("Managementvergoeding");

      // Fragment (?fragment=1): dezelfde inhoud, zonder paginaskelet — klaar om inline te plaatsen.
      const fragmentHtml = await (await fetch(`${baseUrl}${managementUrl}&fragment=1`)).text();
      expect(fragmentHtml).not.toContain('class="sidebar"');
      expect(fragmentHtml.toLowerCase()).not.toContain("<!doctype html>");
      expect(fragmentHtml).toContain('class="inline-detail"');
      expect(fragmentHtml).toContain("Managementvergoeding");
      expect(fragmentHtml).toContain("<form"); // het echte, bestaande formulier — geen tweede invoerpad

      // Een formulier binnen het fragment post naar dezelfde bestaande route (geen fragment-param nodig voor opslaan).
      const actionMatch = fragmentHtml.match(/<form method="POST" action="([^"]*)"/);
      expect(actionMatch).not.toBeNull();
      expect(actionMatch![1]).toBe(managementUrl.replace(/&amp;/g, "&"));
    });
  });

  it("VASTGESTELD: dezelfde inline-uitklaplink blijft werken, gelabeld als Bekijken, en toont de alleen-lezen onderbouwing", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
    const {
      maakBegrotingsversie,
      schrijfModule1Snapshot,
      schrijfModule1Aannames,
      schrijfModule3Invoer,
      schrijfGeplandOnderhoudBeoordeeld,
      schrijfCorrectiefDagelijksOnderhoudRegels,
      schrijfCorrectiefDagelijksOnderhoudBeoordeeld,
      schrijfVerzekeringBeoordeeld,
      schrijfGemeentelijkeLastenModule,
      schrijfAlgemeneKostenCategorieState,
      schrijfLeegstandCategorieState,
      schrijfRenteCategorieState,
      schrijfNietVerrekenbareBtwState,
      stelBegrotingVast,
    } = await import("@bvc/begroting-data");
    const { ALGEMENE_KOSTEN_CATEGORIEEN, LEEGSTAND_CATEGORIEEN, RENTE_CATEGORIEEN } = await import("@bvc/reporting");

    const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
    const versie = maakBegrotingsversie(db, { originType: "NIEUW", bedrijfsnr: BEDRIJFSNR, begrotingsjaar: 2027, bronPeildatum: new Date() });
    const id = versie.id;
    schrijfModule1Snapshot(db, id, []);
    schrijfModule1Aannames(db, id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) }, "06");
    schrijfModule3Invoer(db, id, { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(500), eenheid: "MAAND", ingangsdatum: null });
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
    schrijfNietVerrekenbareBtwState(db, id, { beoordeeld: true, vorigJaarWerkelijk: null });
    stelBegrotingVast(db, id, new Date());
    db.close();

    await metServer(async (baseUrl) => {
      const hoofdschermHtml = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${id}?laatstAfgeslotenBoekperiode=06`)).text();
      expect(hoofdschermHtml).toContain("Bekijken");
      const managementUrlMatch = hoofdschermHtml.match(/data-url="([^"]*\/module\/management\?[^"]*)"/);
      expect(managementUrlMatch).not.toBeNull();
      const managementUrl = managementUrlMatch![1]!.replace(/&amp;/g, "&");

      const fragmentHtml = await (await fetch(`${baseUrl}${managementUrl}&fragment=1`)).text();
      expect(fragmentHtml).toContain("alleen-lezen");
      expect(fragmentHtml).toContain("<fieldset disabled");
      expect(fragmentHtml).toContain("500"); // de vastgestelde onderbouwing blijft zichtbaar
    });
  });
});

/**
 * UX_10 "Verborgen onderdelen" (CONTRACTCONFLICT-besluit 2026-10-06) — end-to-end via echte
 * HTTP-routes: verbergen/weergeven, persistentie, hoofdscherm-weergave, en het effect op
 * vaststellen (geen Module-3-invoer meer vereist zodra verborgen). Uitsluitend Managementvergoeding.
 */
describe("Verborgen onderdelen — Managementvergoeding (UX_10, CONTRACTCONFLICT-besluit)", () => {
  async function nieuweVersie(baseUrl: string): Promise<string> {
    const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2027", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
      redirect: "manual",
    });
    const hoofdschermUrl = nieuw.headers.get("location")!;
    return hoofdschermUrl.split("/")[3]!.split("?")[0]!;
  }

  it("verbergen zonder bestaande invoer: bevestigingsscherm -> hoofdscherm toont 'Verborgen onderdelen' i.p.v. de Management-rij -> weergeven herstelt de rij", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);

    await metServer(async (baseUrl) => {
      const versieId = await nieuweVersie(baseUrl);
      const managementUrl = `${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/management`;
      const verbergenUrl = `${managementUrl}/verbergen`;

      // Vóór verbergen: Management staat gewoon op het hoofdscherm, verbergen-link zichtbaar op het Management-scherm.
      const managementHtmlVoor = await (await fetch(`${managementUrl}?laatstAfgeslotenBoekperiode=06`)).text();
      expect(managementHtmlVoor).toContain("Niet van toepassing — dit onderdeel verbergen");

      const hoofdschermVoor = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}?laatstAfgeslotenBoekperiode=06`)).text();
      expect(hoofdschermVoor).toContain("Managementvergoeding");
      expect(hoofdschermVoor).not.toContain("Verborgen onderdelen");

      // Bevestigingsscherm.
      const bevestigScherm = await (await fetch(verbergenUrl)).text();
      expect(bevestigScherm).toContain("niet van toepassing");
      expect(bevestigScherm).toContain('name="bevestiging"');

      // Zonder de checkbox: geweigerd, geen wijziging.
      const zonderBevestiging = await fetch(verbergenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({}).toString() });
      expect(zonderBevestiging.status).toBe(400);

      // Met expliciete bevestiging: verbergen slaagt.
      const metBevestiging = await fetch(verbergenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ bevestiging: "1" }).toString(),
        redirect: "manual",
      });
      expect(metBevestiging.status).toBe(302);

      // Na verbergen: hoofdscherm toont GEEN Managementvergoeding-rij meer, wel het "Verborgen onderdelen"-paneel met Weergeven.
      const hoofdschermNa = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}?laatstAfgeslotenBoekperiode=06`)).text();
      expect(hoofdschermNa).toContain("Verborgen onderdelen");
      expect(hoofdschermNa).toContain("Weergeven");
      expect(hoofdschermNa).not.toContain('data-expand="MANAGEMENTVERGOEDING--management"');

      // Management-scherm zelf toont nu de "niet van toepassing"-banner i.p.v. het formulier.
      const managementHtmlNa = await (await fetch(`${managementUrl}?laatstAfgeslotenBoekperiode=06`)).text();
      expect(managementHtmlNa).toContain("Niet van toepassing.");
      expect(managementHtmlNa).not.toContain('name="wijze"');

      // Weergeven herstelt de rij.
      const weergevenResp = await fetch(`${managementUrl}/weergeven`, { method: "POST", redirect: "manual" });
      expect(weergevenResp.status).toBe(302);
      const hoofdschermNaWeergeven = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}?laatstAfgeslotenBoekperiode=06`)).text();
      expect(hoofdschermNaWeergeven).toContain("Managementvergoeding");
      expect(hoofdschermNaWeergeven).not.toContain("Verborgen onderdelen");
    });
  });

  it("verbergen is geblokkeerd zodra er al Module-3-invoer bestaat — geen enkel bestaand bedrag verdwijnt onzichtbaar uit de P&L", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);

    await metServer(async (baseUrl) => {
      const versieId = await nieuweVersie(baseUrl);
      const managementUrl = `${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}/module/management`;

      await fetch(`${managementUrl}?laatstAfgeslotenBoekperiode=06`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ wijze: "NIEUWE_VERGOEDING", bedrag: "500", eenheid: "MAAND", ingangsdatum: "" }).toString(),
      });

      const bevestigScherm = await fetch(`${managementUrl}/verbergen`);
      expect(bevestigScherm.status).toBe(200);
      expect(await bevestigScherm.text()).toContain("Er is al invoer vastgelegd");

      const poging = await fetch(`${managementUrl}/verbergen`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ bevestiging: "1" }).toString(),
      });
      expect(poging.status).toBe(400);
      expect(await poging.text()).toContain("Er is al invoer vastgelegd");

      // Hoofdscherm toont Management nog gewoon — niets is verdwenen.
      const hoofdscherm = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}?laatstAfgeslotenBoekperiode=06`)).text();
      expect(hoofdscherm).toContain("Managementvergoeding");
      expect(hoofdscherm).not.toContain("Verborgen onderdelen");
    });
  });

  it("verborgen + geen invoer: vaststellen slaagt (geen Module-3-invoer meer vereist); niet-verborgen blokkeert nog steeds zoals voorheen", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
    const {
      schrijfGeplandOnderhoudBeoordeeld,
      schrijfCorrectiefDagelijksOnderhoudRegels,
      schrijfCorrectiefDagelijksOnderhoudBeoordeeld,
      schrijfVerzekeringBeoordeeld,
      schrijfGemeentelijkeLastenModule,
      schrijfAlgemeneKostenCategorieState,
      schrijfLeegstandCategorieState,
      schrijfRenteCategorieState,
      schrijfNietVerrekenbareBtwState,
    } = await import("@bvc/begroting-data");
    const { ALGEMENE_KOSTEN_CATEGORIEEN, LEEGSTAND_CATEGORIEEN, RENTE_CATEGORIEEN } = await import("@bvc/reporting");

    function vulRestVanDeKetenIn(versieId: string): void {
      const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      schrijfGeplandOnderhoudBeoordeeld(db, versieId, true);
      schrijfCorrectiefDagelijksOnderhoudRegels(db, versieId, []);
      schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versieId, true);
      schrijfVerzekeringBeoordeeld(db, versieId, true);
      schrijfGemeentelijkeLastenModule(db, versieId, { werkelijkeGemeentelijkeLasten: null, wozStijgingPercentage: null, lastenPercentageStijging: null, begrotingsPercentageOverride: null, beoordeeld: true });
      schrijfAlgemeneKostenCategorieState(db, versieId, Object.fromEntries(ALGEMENE_KOSTEN_CATEGORIEEN.map((c: string) => [c, { beoordeeld: true, vorigJaarBedrag: null, verwachteVerhogingPercentage: null }])) as never);
      schrijfLeegstandCategorieState(
        db,
        versieId,
        Object.fromEntries(LEEGSTAND_CATEGORIEEN.map((c: string) => [c, { beoordeeld: true, laatstBekendServicekostenvoorschotJaar: null, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null }])) as never,
      );
      schrijfRenteCategorieState(db, versieId, Object.fromEntries(RENTE_CATEGORIEEN.map((c: string) => [c, { beoordeeld: true }])) as never);
      schrijfNietVerrekenbareBtwState(db, versieId, { beoordeeld: true, vorigJaarWerkelijk: null });
      db.close();
    }

    await metServer(async (baseUrl) => {
      // Scenario 1: NIET verborgen, geen invoer -> blokkeert (ongewijzigd bestaand gedrag).
      const versieId1 = await nieuweVersie(baseUrl);
      vulRestVanDeKetenIn(versieId1);
      const vaststelPoging1 = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId1}/vaststellen?laatstAfgeslotenBoekperiode=06`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ bevestigd: "1" }).toString(),
      });
      expect(vaststelPoging1.status).toBe(400);
      expect(await vaststelPoging1.text()).toContain("Vaststellen kan nog niet");

      // Scenario 2: WEL verborgen, geen invoer -> vaststellen slaagt.
      const versieId2 = await nieuweVersie(baseUrl);
      vulRestVanDeKetenIn(versieId2);
      await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId2}/module/management/verbergen`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ bevestiging: "1" }).toString(),
      });
      const vaststelPoging2 = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId2}/vaststellen?laatstAfgeslotenBoekperiode=06`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ bevestigd: "1" }).toString(),
        redirect: "manual",
      });
      expect(vaststelPoging2.status).toBe(302);

      // VASTGESTELD: verbergen/weergeven-routes weigeren nu (alleen-lezen).
      const verbergenNaVaststellen = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId2}/module/management/verbergen`);
      expect(verbergenNaVaststellen.status).toBe(400);
      const weergevenNaVaststellen = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId2}/module/management/weergeven`, { method: "POST" });
      expect(weergevenNaVaststellen.status).toBe(400);
    });
  });
});

function pnlMapping(grootboekrekening: string, economischeCategorie: string): Parameters<typeof voegPnLBronmappingMutatieToe>[1] {
  return {
    bedrijfsnr: BEDRIJFSNR,
    grootboekrekening,
    grootboekOmschrijving: null,
    ogbKostensoort: null,
    ogbKostensoortOmschrijving: null,
    economischeModule: "ONDERHOUD",
    economischeCategorie,
    geldigVanafBoekjaar: 2020,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    type: "NIEUWE_MAPPING_VANAF_PERIODE",
    vorigeMappingId: null,
    gewijzigdOp: new Date("2026-01-01T00:00:00.000Z"),
    gebruiker: "test",
    wijzigingsreden: "testfixture",
  };
}

function contractRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnr: BEDRIJFSNR,
    Contract: "0000000043",
    Complexnummer: "001",
    Unitnummer: "0001",
    Huurdernummer: "00000028",
    Huurder_Naam_1: "Voorbeeld Huurder BV",
    Ingangsdatum: "01-01-2020",
    Expiratie_Expiratiedatum: "31-12-2030",
    Verhoging_datum: "01-08-2027",
    Verhoging_opnieuw_na: 12,
    ...overrides,
  };
}

function rentrollRij(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Bedrijfsnummer: BEDRIJFSNR,
    Contractnummer: "0000000043",
    Vorderingsoort: "01",
    Unitnummer: "0001",
    Complexnummer: "001",
    Prolongatie_bedrag_jaar: 120000,
    BTW_Y_N: "Y",
    ...overrides,
  };
}

/**
 * TRANCHE 12 — Huur/Beheer via de echte Contracten/RentRoll-bron (fixturebewijs door de echte
 * productiecodeketen, zie CLAUDE.md/BEGROTING_MASTER_CONTRACT.md §12 over het onderscheid met
 * werkelijke BVC-productiedata). Bewijst §21's checklist: contractbron inlezen -> snapshot
 * schrijven -> herladen -> zelfde snapshot -> indexatie -> override -> Jouw begroting verandert
 * -> bronfeiten/Werkelijk blijven onveranderd.
 */
describe("Huur/Beheer via echte HTTP-routes met een echte Contracten/RentRoll-fixture (Tranche 12)", () => {
  it("nieuwe begroting laadt de contractbasis, toont Huur/Beheer op het hoofdscherm, en een override wijzigt Jouw begroting zonder Voorstel/Werkelijk te raken", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [contractRij()]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [rentrollRij()]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2028", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "0" }).toString(),
        redirect: "manual",
      });
      expect(nieuw.status).toBe(302);
      const hoofdschermUrl = nieuw.headers.get("location")!;
      expect(hoofdschermUrl).toContain("melding=Contractbasis%20geladen");

      // Hoofdscherm toont de contract-afgeleide Huur/Beheer-waarden (bruto huur 120.000, geen indexatie/override -> 0% algemeen).
      const hoofdscherm1 = await fetch(baseUrl + hoofdschermUrl);
      const html1 = await hoofdscherm1.text();
      expect(html1).toContain("Huuropbrengst belast");
      expect(html1).toContain("€ 120.000,00");
      // UX-assemblagedelta: CONCEPT toont de werkomgeving-shell met de "Concept"-pill.
      expect(html1).toContain('class="sidebar"');
      expect(html1).toContain('class="pill concept"');

      // Huur-detailpagina toont het contract.
      const huurUrl = hoofdschermUrl.replace(/\?.*/, "") + "/module/huur?laatstAfgeslotenBoekperiode=06";
      const huurDetail1 = await fetch(baseUrl + huurUrl);
      expect(huurDetail1.status).toBe(200);
      const huurDetailHtml1 = await huurDetail1.text();
      expect(huurDetailHtml1).toContain("0000000043");
      expect(huurDetailHtml1).toContain("Voorbeeld Huurder BV");
      expect(huurDetailHtml1).toContain("Belast");

      // Override van 10% instellen voor dit contract.
      const overrideOpslaan = await fetch(baseUrl + huurUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ "override_0000000043": "10" }).toString(),
        redirect: "manual",
      });
      expect(overrideOpslaan.status).toBe(302);

      // Jouw begroting wijkt nu af van 120.000 (10%-override, effectief vanaf de indexatiedatum -> € 125.000,00 met de
      // bewezen maandgranulariteit); Voorstel (0% algemene indexatie, zonder override) blijft ongewijzigd € 120.000,00;
      // Werkelijk blijft onbekend/onveranderd.
      const hoofdscherm2 = await fetch(baseUrl + hoofdschermUrl);
      const html2 = await hoofdscherm2.text();
      expect(html2).toContain("€ 125.000,00"); // Jouw begroting mét override
      expect(html2).toContain("€ 120.000,00"); // Voorstel zonder override blijft zichtbaar ernaast

      // Herladen (nieuwe request): de override-waarde blijft bewaard (roundtrip).
      const huurDetail2 = await fetch(baseUrl + huurUrl);
      expect(await huurDetail2.text()).toContain('value="10"');

      // Beheer-detailpagina is bereikbaar en toont het complex uit de contractbasis.
      const beheerUrl = hoofdschermUrl.replace(/\?.*/, "") + "/module/beheer?laatstAfgeslotenBoekperiode=06";
      const beheerDetail = await fetch(baseUrl + beheerUrl);
      expect(beheerDetail.status).toBe(200);
      expect(await beheerDetail.text()).toContain("001"); // complexnummer uit het contract
    });
  });

  it("UX-UITROL §4: Huur-detailscherm toont een complex/contract-weergavewissel en markeert een in het begrotingsjaar aflopend contract", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [
      contractRij({ Contract: "0000000043", Complexnummer: "001", Expiratie_Expiratiedatum: "31-12-2030" }),
      contractRij({ Contract: "0000000099", Complexnummer: "002", Huurdernummer: "00000099", Huurder_Naam_1: "Aflopende Huurder BV", Expiratie_Expiratiedatum: "30-06-2028" }),
    ]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [
      rentrollRij({ Contractnummer: "0000000043", Complexnummer: "001", Prolongatie_bedrag_jaar: 120000 }),
      rentrollRij({ Contractnummer: "0000000099", Complexnummer: "002", Unitnummer: "0002", Prolongatie_bedrag_jaar: 60000 }),
    ]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2028", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "0" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      const huurUrl = hoofdschermUrl.replace(/\?.*/, "") + "/module/huur?laatstAfgeslotenBoekperiode=06";

      // Standaard (contractweergave): het in 2028 aflopende contract 0000000099 is herkenbaar gemarkeerd; het doorlopende contract niet.
      const contractHtml = await (await fetch(baseUrl + huurUrl)).text();
      expect(contractHtml).toContain("0000000099");
      expect(contractHtml).toContain("loopt af in 2028");
      const regelAflopend = contractHtml.slice(contractHtml.indexOf("0000000099"), contractHtml.indexOf("0000000099") + 300);
      expect(regelAflopend).toContain("loopt af in 2028");
      const regelDoorlopend = contractHtml.slice(contractHtml.indexOf("0000000043"), contractHtml.indexOf("0000000043") + 300);
      expect(regelDoorlopend).not.toContain("loopt af");

      // Complexweergave: twee complexen, geaggregeerd (netto 120.000 + 60.000), geen per-contract-overrideveld.
      const complexHtml = await (await fetch(`${baseUrl + huurUrl}&weergave=complex`)).text();
      expect(complexHtml).toContain("Per complex");
      expect(complexHtml).toContain("001");
      expect(complexHtml).toContain("002");
      expect(complexHtml).toContain("€ 120.000,00");
      expect(complexHtml).toContain("€ 30.000,00");
      expect(complexHtml).not.toContain("Overrides opslaan");
    });
  });

  it("TRANCHE 14: een toekomstige contract_prijsregels-kortingswijziging werkt door in de netto begrote huur vanaf de juiste maand, en dus automatisch in de variabele Beheersvergoeding (dezelfde Module-1-grondslag)", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [contractRij()]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [
      rentrollRij({ Vorderingsoort: "01", Prolongatie_bedrag_jaar: 120000 }),
      rentrollRij({ Vorderingsoort: "13", Prolongatie_bedrag_jaar: -12000 }),
    ]);
    // Bronfeit-bewezen toekomstige wijziging (zie contractPrijsregelsResolver.ts): vanaf 01-07-2028
    // vervalt de huurkorting (-1.000/mnd -> 0), eenduidig herleid uit één kandidaatrij.
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contract_prijsregels.xlsx"), [
      { Bedrijfsnr: BEDRIJFSNR, Contractnr: "0000000043", Prijs_regelnr: "9", Status: "Nieuw", Ingangsdatum_prijsregel: "01-07-2028", Bedrag_vorderingsoort_13: "0" },
    ]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2028", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "0" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;

      // Netto begrote huur 2028: jan-jun -1.000/mnd korting (bevroren rentroll-basis, 6.000 totaal),
      // jul-dec 0 korting (de toekomstige wijziging) -> 120.000 - 6.000 = 114.000. NIET de vlakke
      // 108.000 (120.000 - 12.000) die zonder deze wijziging het hele jaar zou blijven gelden.
      const html = await (await fetch(baseUrl + hoofdschermUrl)).text();
      expect(html).toContain("€ 114.000,00");
      expect(html).not.toContain("€ 108.000,00");

      // Dezelfde Module-1-grondslag stroomt automatisch door in de variabele Beheersvergoeding.
      const beheerUrl = hoofdschermUrl.replace(/\?.*/, "") + "/module/beheer?laatstAfgeslotenBoekperiode=06";
      const configureer = await fetch(baseUrl + beheerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ complexnummer_0: "001", variabelPercentage_0: "10" }).toString(),
        redirect: "manual",
      });
      expect(configureer.status).toBe(302);

      const beheerDetail = await (await fetch(baseUrl + beheerUrl)).text();
      expect(beheerDetail).toContain("€ 114.000,00"); // nettoHuurGrondslag -- inclusief de toekomstige kortingswijziging
      expect(beheerDetail).toContain("€ 11.400,00"); // 10% variabele vergoeding over de bijgewerkte grondslag (niet € 10.800,00)
    });
  });

  it("ontbreekt de Contracten/RentRoll-bron, dan start de begroting leeg met een zichtbare melding, geen misleidende €0", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
    // Geen contracten_huidig.xlsx/rentroll.xlsx aangemaakt.

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2028", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "3" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      expect(hoofdschermUrl).toContain("melding=Geen%20Contracten");

      const html = await (await fetch(baseUrl + hoofdschermUrl)).text();
      expect(html).toContain("Geen Contracten");
    });
  });
});

/**
 * Product-readiness fix (migratie 42) — bewijst dat de laatst afgesloten boekperiode nu persistent
 * bij de begrotingsversie wordt vastgelegd (`begroting_aannames`), nooit meer een hardcoded "12" of
 * een stilzwijgende afleiding, en dat een opgeslagen periode nooit door een afwijkende queryparameter
 * wordt overschreven.
 */
describe("laatstAfgeslotenBoekperiode persistent per begrotingsversie (product-readiness fix, migratie 42)", () => {
  it("1. een nieuwe begroting met periode 06 slaat die direct persistent op, en 'Openen' (zonder queryparameter) toont daarna de echte begroting", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2026", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "0" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      const versieId = hoofdschermUrl.split("/")[3]!.split("?")[0]!;

      // Exact de "Openen"-link uit het keuzescherm: GEEN queryparameter.
      const openen = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}`);
      expect(openen.status).toBe(200);
      const html = await openen.text();
      expect(html).toContain("Vergelijkende exploitatiebegroting");
      expect(html).toContain("t/m periode 06");
      expect(html).not.toContain("Kies de laatst afgesloten boekperiode");

      const { openOrCreateDatabase: openDb, leesLaatstAfgeslotenBoekperiode } = await import("@bvc/begroting-data");
      const { begrotingsversiesDatabasePad: dbPad } = await import("./paths.js");
      const db = openDb(dbPad(root, ADMINISTRATIE_ID));
      expect(leesLaatstAfgeslotenBoekperiode(db, versieId)).toBe("06");
      db.close();
    });
  });

  it("2. opnieuw openen (nieuwe, onafhankelijke requests — 'nieuwe sessie') blijft exact dezelfde periode tonen", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2026", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "0" }).toString(),
        redirect: "manual",
      });
      const versieId = nieuw.headers.get("location")!.split("/")[3]!.split("?")[0]!;

      for (let poging = 0; poging < 3; poging++) {
        const html = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}`)).text();
        expect(html).toContain("t/m periode 06");
      }
    });
  });

  it("3. een bestaande (legacy) versie zonder opgeslagen periode toont nooit stilzwijgend een default — de gebruiker moet expliciet kiezen, en die keuze wordt daarna persistent", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
    const { maakBegrotingsversie, schrijfModule1Snapshot, schrijfModule1Aannames, leesLaatstAfgeslotenBoekperiode, openOrCreateDatabase: openDb } = await import("@bvc/begroting-data");
    const { begrotingsversiesDatabasePad: dbPad } = await import("./paths.js");

    const db = openDb(dbPad(root, ADMINISTRATIE_ID));
    const versie = maakBegrotingsversie(db, { originType: "NIEUW", bedrijfsnr: BEDRIJFSNR, begrotingsjaar: 2026, bronPeildatum: new Date() });
    schrijfModule1Snapshot(db, versie.id, []);
    // Bewust GEEN 4e argument — exact de situatie van vóór migratie 42 (en van c8d5a538 vóór de handmatige correctie).
    schrijfModule1Aannames(db, versie.id, { begrotingsjaar: 2026, indexatiePercentage: new Decimal(3) });
    db.close();

    await metServer(async (baseUrl) => {
      // GET zonder queryparameter: geen default, geen afleiding -- expliciete-keuze-scherm.
      const zonderQuery = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versie.id}`);
      expect(zonderQuery.status).toBe(200);
      const htmlZonder = await zonderQuery.text();
      expect(htmlZonder).toContain("Kies de laatst afgesloten boekperiode");
      expect(htmlZonder).not.toContain("Vergelijkende exploitatiebegroting");

      // GET MET een queryparameter wordt ook niet stilzwijgend geaccepteerd zolang er niets is opgeslagen --
      // nog steeds het keuzescherm, geen vlucht via de URL.
      const metQuery = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versie.id}?laatstAfgeslotenBoekperiode=12`);
      expect(await metQuery.text()).toContain("Kies de laatst afgesloten boekperiode");

      // Expliciete keuze indienen.
      const keuze = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versie.id}/boekperiode`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ laatstAfgeslotenBoekperiode: "09" }).toString(),
        redirect: "manual",
      });
      expect(keuze.status).toBe(302);

      const dbNa = openDb(dbPad(root, ADMINISTRATIE_ID));
      expect(leesLaatstAfgeslotenBoekperiode(dbNa, versie.id)).toBe("09");
      dbNa.close();

      // Vanaf nu toont "Openen" zonder queryparameter de echte begroting met de zojuist gekozen periode.
      const htmlNa = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versie.id}`)).text();
      expect(htmlNa).toContain("t/m periode 09");
    });
  });

  it("4. een afwijkende/gemanipuleerde queryparameter kan een al opgeslagen periode nooit stilzwijgend overschrijven", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2026", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "0" }).toString(),
        redirect: "manual",
      });
      const versieId = nieuw.headers.get("location")!.split("/")[3]!.split("?")[0]!;

      const html = await (await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${versieId}?laatstAfgeslotenBoekperiode=12`)).text();
      expect(html).toContain("t/m periode 06"); // de opgeslagen waarde wint, de query-12 wordt genegeerd
      expect(html).not.toContain("t/m periode 12");
    });
  });

  it("5. bestaande financiële rekenuitkomsten blijven ongewijzigd door deze fix (geen Huur/Beheer-wijziging)", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "contracten_huidig.xlsx"), [contractRij()]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "rentroll.xlsx"), [rentrollRij()]);
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);

    await metServer(async (baseUrl) => {
      const nieuw = await fetch(`${baseUrl}/begroting/nieuw`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ administratieId: ADMINISTRATIE_ID, begrotingsjaar: "2028", laatstAfgeslotenBoekperiode: "06", indexatiePercentage: "0" }).toString(),
        redirect: "manual",
      });
      const hoofdschermUrl = nieuw.headers.get("location")!;
      const html = await (await fetch(baseUrl + hoofdschermUrl)).text();
      expect(html).toContain("Huuropbrengst belast");
      expect(html).toContain("€ 120.000,00"); // zelfde contract-afgeleide bruto huur als vóór deze fix
    });
  });
});

/**
 * Veilig verwijderen conceptbegroting (productieacceptatie-delta, vervangt de eerdere opdracht).
 * Uitsluitend testdata (tijdelijke tmp-root/-database) — raakt nooit de echte 070/2026-versies.
 */
describe("Veilig verwijderen conceptbegroting", () => {
  /** Volledig vaststelbare fixture — exact hetzelfde bewezen patroon als de Tranche-14-test hierboven, hier uitsluitend hergebruikt om één échte VASTGESTELDE testversie te krijgen (de publieke ingang is en blijft `stelBegrotingVast`, nooit het interne `markeerVastgesteld`). */
  async function maakVastgesteldeTestversie(db: ReturnType<typeof openOrCreateDatabase>, begrotingsjaar: number): Promise<string> {
    const {
      maakBegrotingsversie,
      schrijfModule1Snapshot,
      schrijfModule1Aannames,
      schrijfModule3Invoer,
      schrijfGeplandOnderhoudBeoordeeld,
      schrijfCorrectiefDagelijksOnderhoudBeoordeeld,
      schrijfVerzekeringBeoordeeld,
      schrijfGemeentelijkeLastenModule,
      schrijfAlgemeneKostenCategorieState,
      schrijfLeegstandCategorieState,
      schrijfRenteCategorieState,
      schrijfNietVerrekenbareBtwState,
      stelBegrotingVast,
    } = await import("@bvc/begroting-data");
    const { ALGEMENE_KOSTEN_CATEGORIEEN, LEEGSTAND_CATEGORIEEN, RENTE_CATEGORIEEN } = await import("@bvc/reporting");

    const versie = maakBegrotingsversie(db, { originType: "NIEUW", bedrijfsnr: BEDRIJFSNR, begrotingsjaar, bronPeildatum: new Date() });
    const id = versie.id;
    schrijfModule1Snapshot(db, id, []);
    schrijfModule1Aannames(db, id, { begrotingsjaar, indexatiePercentage: new Decimal(3) }, "06");
    schrijfModule3Invoer(db, id, { wijze: "NIEUWE_VERGOEDING", bedrag: new Decimal(500), eenheid: "MAAND", ingangsdatum: null });
    schrijfGeplandOnderhoudBeoordeeld(db, id, true);
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
    schrijfNietVerrekenbareBtwState(db, id, { beoordeeld: true, vorigJaarWerkelijk: null });
    stelBegrotingVast(db, id, new Date());
    return id;
  }

  async function zetTweeVersiesNeer(): Promise<{
    conceptA: string;
    conceptB: string;
    vastgesteld: string;
    db: ReturnType<typeof openOrCreateDatabase>;
  }> {
    const { maakBegrotingsversie, schrijfModule1Snapshot, schrijfModule1Aannames } = await import("@bvc/begroting-data");
    const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
    const a = maakBegrotingsversie(db, { originType: "NIEUW", bedrijfsnr: BEDRIJFSNR, begrotingsjaar: 2026, bronPeildatum: new Date() });
    schrijfModule1Snapshot(db, a.id, []);
    schrijfModule1Aannames(db, a.id, { begrotingsjaar: 2026, indexatiePercentage: new Decimal(3) }, "06");

    const b = maakBegrotingsversie(db, { originType: "NIEUW", bedrijfsnr: BEDRIJFSNR, begrotingsjaar: 2027, bronPeildatum: new Date() });
    schrijfModule1Snapshot(db, b.id, []);
    schrijfModule1Aannames(db, b.id, { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) }, "06");

    const vastgesteld = await maakVastgesteldeTestversie(db, 2025);

    return { conceptA: a.id, conceptB: b.id, vastgesteld, db };
  }

  it("1. keuzescherm toont 'Verwijderen' bij CONCEPT, niet bij VASTGESTELD", async () => {
    const { conceptA, vastgesteld, db } = await zetTweeVersiesNeer();
    db.close();

    await metServer(async (baseUrl) => {
      const html = await (await fetch(`${baseUrl}/begroting?administratieId=${ADMINISTRATIE_ID}`)).text();
      expect(html).toContain(`/begroting/${ADMINISTRATIE_ID}/${conceptA}/verwijderen`);
      expect(html).not.toContain(`/begroting/${ADMINISTRATIE_ID}/${vastgesteld}/verwijderen`);
    });
  });

  it("2. directe GET op het verwijderscherm voor een VASTGESTELDE versie toont nooit het bevestigingsformulier", async () => {
    const { vastgesteld, db } = await zetTweeVersiesNeer();
    db.close();

    await metServer(async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${vastgesteld}/verwijderen`);
      expect(resp.status).toBe(400);
      const html = await resp.text();
      expect(html).not.toContain("Typ exact");
      expect(html).toContain("immutable");
    });
  });

  it("3. lege bevestiging verwijdert niets", async () => {
    const { conceptA, db } = await zetTweeVersiesNeer();
    db.close();

    await metServer(async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${conceptA}/verwijderen`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ bevestiging: "" }).toString(),
      });
      expect(resp.status).toBe(400);

      const dbNa = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      const { leesBegrotingsversie } = await import("@bvc/begroting-data");
      expect(leesBegrotingsversie(dbNa, conceptA)).not.toBeNull();
      dbNa.close();
    });
  });

  it("4. verkeerde bevestiging (andere schrijfwijze) verwijdert niets", async () => {
    const { conceptA, db } = await zetTweeVersiesNeer();
    db.close();

    await metServer(async (baseUrl) => {
      for (const foutieveTekst of ["verwijderen", "VERWIJDER", "Verwijderen", " VERWIJDEREN", "VERWIJDEREN "]) {
        const resp = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${conceptA}/verwijderen`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ bevestiging: foutieveTekst }).toString(),
        });
        expect.soft(resp.status, `bevestiging="${foutieveTekst}"`).toBe(400);
      }

      const dbNa = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      const { leesBegrotingsversie } = await import("@bvc/begroting-data");
      expect(leesBegrotingsversie(dbNa, conceptA)).not.toBeNull();
      dbNa.close();
    });
  });

  it("5. exacte bevestiging 'VERWIJDEREN' verwijdert de CONCEPT-versie en uitsluitend haar eigen versiegebonden data — versie B en de VASTGESTELDE versie blijven volledig intact (geen orphan records)", async () => {
    const { conceptA, conceptB, vastgesteld, db } = await zetTweeVersiesNeer();
    db.close();

    await metServer(async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${conceptA}/verwijderen`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ bevestiging: "VERWIJDEREN" }).toString(),
        redirect: "manual",
      });
      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toContain(`/begroting?administratieId=${ADMINISTRATIE_ID}`);
      expect(resp.headers.get("location")).toContain("melding=");

      const dbNa = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      const { leesBegrotingsversie } = await import("@bvc/begroting-data");
      // Versie A: volledig weg, inclusief haar eigen versiegebonden data (cascade, geen orphans).
      expect(leesBegrotingsversie(dbNa, conceptA)).toBeNull();
      expect(dbNa.prepare(`SELECT 1 FROM begroting_aannames WHERE begroting_versie_id = ?`).get(conceptA)).toBeUndefined();
      // Versie B en de vastgestelde versie: volledig ongemoeid (aannames blijven bestaan, nog steeds precies 1 rij elk).
      expect(leesBegrotingsversie(dbNa, conceptB)).not.toBeNull();
      expect(dbNa.prepare(`SELECT 1 FROM begroting_aannames WHERE begroting_versie_id = ?`).get(conceptB)).toBeDefined();
      expect(leesBegrotingsversie(dbNa, vastgesteld)).not.toBeNull();
      expect(dbNa.prepare(`SELECT 1 FROM begroting_aannames WHERE begroting_versie_id = ?`).get(vastgesteld)).toBeDefined();
      dbNa.close();
    });
  });

  it("6. een directe server-side POST-poging om een VASTGESTELDE versie te verwijderen wordt geweigerd, ook met de exacte bevestigingstekst", async () => {
    const { vastgesteld, db } = await zetTweeVersiesNeer();
    db.close();

    await metServer(async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${vastgesteld}/verwijderen`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ bevestiging: "VERWIJDEREN" }).toString(),
        redirect: "manual",
      });
      expect(resp.status).toBe(400);
      expect(await resp.text()).toContain("immutable");

      const dbNa = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      const { leesBegrotingsversie } = await import("@bvc/begroting-data");
      expect(leesBegrotingsversie(dbNa, vastgesteld)).not.toBeNull();
      dbNa.close();
    });
  });

  it("7. verwijderen is administratie- en versiegebonden: een niet-bestaande combinatie faalt veilig (404), raakt niets", async () => {
    const { conceptA, db } = await zetTweeVersiesNeer();
    db.close();

    await metServer(async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/begroting/onbekende_administratie/${conceptA}/verwijderen`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ bevestiging: "VERWIJDEREN" }).toString(),
      });
      expect(resp.status).toBe(404);

      const dbNa = openOrCreateDatabase(begrotingsversiesDatabasePad(root, ADMINISTRATIE_ID));
      const { leesBegrotingsversie } = await import("@bvc/begroting-data");
      expect(leesBegrotingsversie(dbNa, conceptA)).not.toBeNull(); // niet geraakt
      dbNa.close();
    });
  });

  it("8. bestaande Openen-flow en opgeslagen periodecontext blijven werken voor een niet-verwijderde versie", async () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "boekingen.xlsx"), []);
    const { conceptB, db } = await zetTweeVersiesNeer();
    db.close();

    await metServer(async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/begroting/${ADMINISTRATIE_ID}/${conceptB}`); // "Openen"-link: geen queryparameter
      expect(resp.status).toBe(200);
      const html = await resp.text();
      expect(html).toContain("Vergelijkende exploitatiebegroting");
      expect(html).toContain("t/m periode 06");
      expect(html).not.toContain("Kies de laatst afgesloten boekperiode");
    });
  });
});
