import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  administratieCachePad,
  bronGedeeldDir,
  initAdministratie,
  rebuildCache,
  resolveAlleBronnen,
} from "@bvc/worker";
import {
  balansRijen,
  boekingenRijen,
  complexTotalenRijen,
  contractenRijen,
  contractVerhogingenRijen,
  ouderdomsanalyseRijen,
  rentrollRijen,
  schrijfAfgebrokenXlsxFixture,
  schrijfXlsxFixture,
  servicekostenRijen,
  unitsRijen,
  vorderingenMetAfboekingenRijen,
} from "./fixtures.js";

const OUDERDOMSANALYSE_METADATA = { boekjaar: 2026, boekperiode: "06", peildatum: new Date(Date.UTC(2026, 5, 30)) };

/**
 * Volledig pre-flight-traject: init-administratie → status → rebuild-cache,
 * gedeeld-bronmodus met twee administraties (070, 074) door elkaar in
 * dezelfde acht gedeelde bronbestanden — precies de opzet die de Worker in
 * productie tegenkomt. Geen mocks van de Worker zelf: dit roept dezelfde
 * publieke functies aan die de CLI/bvc-worker.exe gebruiken.
 */

let root: string;
const ADMIN_070 = "070_RooiseZoom";
const ADMIN_074 = "074_Fergagne";

function schrijfAlleGedeeldeBronnen(): void {
  const dir = bronGedeeldDir(root);
  mkdirSync(dir, { recursive: true });
  schrijfXlsxFixture(join(dir, "boekingen.xlsx"), boekingenRijen());
  schrijfXlsxFixture(join(dir, "balans_per_jaar.xlsx"), balansRijen());
  schrijfXlsxFixture(join(dir, "servicekosten.xlsx"), servicekostenRijen());
  schrijfXlsxFixture(join(dir, "rentroll.xlsx"), rentrollRijen());
  schrijfXlsxFixture(join(dir, "contracten_huidig.xlsx"), contractenRijen());
  schrijfXlsxFixture(join(dir, "units.xlsx"), unitsRijen());
  schrijfXlsxFixture(join(dir, "complex_totalen.xlsx"), complexTotalenRijen());
  schrijfXlsxFixture(join(dir, "saldo_huurders.xlsx"), ouderdomsanalyseRijen());
  schrijfXlsxFixture(join(dir, "contract_verhogingen.xlsx"), contractVerhogingenRijen());
  schrijfXlsxFixture(join(dir, "vorderingen_met_afboekingen.xlsx"), vorderingenMetAfboekingenRijen());
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-preflight-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── 1. Volledig pad + gedeeld-bronmodus met meerdere administraties ────────

describe("1. init-administratie → status → rebuild-cache, gedeeld-bronmodus, meerdere administraties", () => {
  it("initialiseert twee administraties zonder handmatig JSON, en beide zien de status van dezelfde gedeelde bronnen", () => {
    schrijfAlleGedeeldeBronnen();
    const config070 = initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    const config074 = initAdministratie(root, ADMIN_074, "074", "Fergagne bv");
    expect(config070.bronlocaties.boekingen).toBe("gedeeld");
    expect(config074.bronlocaties.boekingen).toBe("gedeeld");

    const status070 = resolveAlleBronnen(root, ADMIN_070);
    const status074 = resolveAlleBronnen(root, ADMIN_074);
    for (const bron of status070) {
      if (bron.bronType === "begroting") continue;
      expect(bron.bestaat, `${bron.bronType} zou aanwezig moeten zijn (gedeeld)`).toBe(true);
    }
    const nietBegroting = (bronnen: typeof status070) => bronnen.filter((b) => b.bronType !== "begroting").map((b) => b.pad);
    expect(nietBegroting(status070)).toEqual(nietBegroting(status074));
  });

  it("rebuild-cache voor beide administraties uit dezelfde gedeelde bronnen slaagt en levert een leesbare cache op", () => {
    schrijfAlleGedeeldeBronnen();
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    initAdministratie(root, ADMIN_074, "074", "Fergagne bv");

    const resultaat070 = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    const resultaat074 = rebuildCache({ root, administratieId: ADMIN_074, onVoortgang: () => {} });

    expect(existsSync(resultaat070.cachePad)).toBe(true);
    expect(existsSync(resultaat074.cachePad)).toBe(true);
    expect(resultaat070.cachePad).not.toBe(resultaat074.cachePad);
  });
});

// ── 2. Bedrijfsnr-isolatie over ALLE brontypen ──────────────────────────────

describe("2. Bedrijfsnr-isolatie: administratie 070 krijgt uitsluitend rijen van 070", () => {
  beforeEach(() => {
    schrijfAlleGedeeldeBronnen();
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    initAdministratie(root, ADMIN_074, "074", "Fergagne bv");
  });

  it("cache van 070 bevat geen enkele rij van 074, in geen van de acht brontabellen", () => {
    rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {}, ouderdomsanalyseMetadata: OUDERDOMSANALYSE_METADATA });
    const db = new DatabaseSync(administratieCachePad(root, ADMIN_070), { readOnly: true });
    try {
      const tabellenMetBedrijfsnrKolom: Record<string, string> = {
        boekingen: "bedrijfsnr",
        balansstanden: "bedrijfsnr",
        servicekosten: "bedrijfsnr",
        contracten: "bedrijfsnr",
        units: "bedrijfsnr",
        rentroll: "bedrijfsnummer",
        complex_totalen: "bedrijfsnr",
        ouderdomsanalyse: "bedrijfsnr",
      };
      for (const [tabel, kolom] of Object.entries(tabellenMetBedrijfsnrKolom)) {
        const rijen = db.prepare(`SELECT DISTINCT ${kolom} AS bedrijfsnr FROM ${tabel}`).all() as { bedrijfsnr: string }[];
        expect(rijen.every((r) => r.bedrijfsnr === "070"), `${tabel} bevat een niet-070-rij: ${JSON.stringify(rijen)}`).toBe(true);
        expect(rijen.length, `${tabel} zou minstens 1 rij voor 070 moeten hebben`).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  });

  it("cache van 074 bevat symmetrisch geen enkele rij van 070", () => {
    rebuildCache({ root, administratieId: ADMIN_074, onVoortgang: () => {} });
    const db = new DatabaseSync(administratieCachePad(root, ADMIN_074), { readOnly: true });
    try {
      const rijen = db.prepare("SELECT DISTINCT bedrijfsnr FROM boekingen").all() as { bedrijfsnr: string }[];
      expect(rijen).toEqual([{ bedrijfsnr: "074" }]);
    } finally {
      db.close();
    }
  });
});

// ── 3. Ontbrekende begroting blokkeert niets ────────────────────────────────

describe("3. Ontbrekende begroting is niet-blokkerend en wordt expliciet gemeld", () => {
  it("rebuild-cache slaagt zonder begroting.xlsx en meldt dit als ontbrekende bron, niet als fout", () => {
    schrijfAlleGedeeldeBronnen();
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    // begroting staat standaard op 'eigen' en er is geen bron/begroting.xlsx aangemaakt.
    const resultaat = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    expect(resultaat.ontbrekendeBronnen).toContain("begroting");
    expect(resultaat.issues.some((i) => i.ernst === "KRITIEK")).toBe(false);
    expect(existsSync(resultaat.cachePad)).toBe(true);
  });
});

// ── 4. Ontbrekende/lege/foutieve bronbestanden ──────────────────────────────

describe("4. Ontbrekende, lege en foutieve bronbestanden", () => {
  it("ontbrekend bronbestand: expliciet gemeld, geen crash, cache toch bruikbaar voor wat wél aanwezig is", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), unitsRijen());
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    expect(() => rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} })).not.toThrow();
    const resultaat = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    expect(resultaat.ontbrekendeBronnen).toContain("boekingen");
    expect(resultaat.rowCounts["units"]).toBe(1);
  });

  it("leeg bronbestand (0 datarijen): geen crash, 0 rijen in cache voor die bron", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), []);
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    const resultaat = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    expect(resultaat.rowCounts["units"]).toBe(0);
    expect(resultaat.issues.some((i) => i.ernst === "KRITIEK")).toBe(false);
  });

  it("bestand met lege sheet (alleen een titel, geen enkele rij of kolomkop): geen crash", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), [{}]);
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    expect(() => rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} })).not.toThrow();
  });

  it("foutieve/onbekende kolomnamen: rij wordt als KRITIEK issue geblokkeerd, geen crash, geen gegokte waarden", () => {
    schrijfXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"), [
      { Verkeerde_Kolom: "070", Nog_Een_Verkeerde: "iets" },
    ]);
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    const resultaat = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    expect(resultaat.rowCounts["units"]).toBe(0);
    expect(resultaat.issues.some((i) => i.ernst === "KRITIEK")).toBe(true);
  });

  it("afgebroken/corrupt xlsx-bestand (bv. mislukte netwerkkopie): gooit een duidelijke fout i.p.v. stil te falen of een lege cache te suggereren", () => {
    schrijfAfgebrokenXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"));
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    expect(() => rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} })).toThrow(/ZIP/i);
  });

  it("BEKEND RISICO: willekeurige niet-xlsx tekst met een .xlsx-extensie crasht niet, maar wordt stilzwijgend als 0 rijen gelezen (SheetJS-fallbackgedrag, niet Worker-specifiek)", () => {
    // Dit is bewust gedocumenteerd, niet 'gefixt' — een verkeerd-hernoemd bestand levert
    // hierdoor geen duidelijke foutmelding op, alleen een verdachte 0-rijen-uitkomst.
    mkdirSync(bronGedeeldDir(root), { recursive: true });
    writeFileSync(join(bronGedeeldDir(root), "units.xlsx"), "dit is geen xlsx-bestand, gewoon platte tekst");
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    const resultaat = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    expect(resultaat.rowCounts["units"]).toBe(0);
  });
});

// ── 5. Nederlandse/echte-notatie edge cases ─────────────────────────────────

describe("5. Getallen, datums, negatieve bedragen, null/lege waarden, NL-notaties", () => {
  beforeEach(() => {
    schrijfAlleGedeeldeBronnen();
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    initAdministratie(root, ADMIN_074, "074", "Fergagne bv");
  });

  it("komma-decimaal (rentroll/complex_totalen/ouderdomsanalyse) wordt correct als punt-decimaal opgeslagen", () => {
    const resultaat = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    expect(resultaat.issues.some((i) => i.ernst === "KRITIEK")).toBe(false);
    const db = new DatabaseSync(resultaat.cachePad, { readOnly: true });
    try {
      const rentrollRij = db.prepare("SELECT prolongatie_bedrag_jaar, korting_bedrag_jaar FROM rentroll WHERE bedrijfsnummer='070'").get() as
        | { prolongatie_bedrag_jaar: string; korting_bedrag_jaar: string }
        | undefined;
      expect(rentrollRij?.prolongatie_bedrag_jaar).toBe("19986.48");
      expect(rentrollRij?.korting_bedrag_jaar).toBe("-200"); // legitiem negatieve korting
    } finally {
      db.close();
    }
  });

  it("#REF! in Boeking_Saldo (bevestigd in echte export) crasht de import niet en negeert alleen het audit-veld", () => {
    expect(() => rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} })).not.toThrow();
    const resultaat = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    expect(resultaat.rowCounts["boekingen"]).toBe(2);
  });

  it("negatieve Vooruitbetaling in ouderdomsanalyse wordt correct bewaard (geen Math.abs())", () => {
    const resultaat = rebuildCache({
      root,
      administratieId: ADMIN_074,
      onVoortgang: () => {},
      ouderdomsanalyseMetadata: { boekjaar: 2026, boekperiode: "06", peildatum: new Date(Date.UTC(2026, 5, 30)) },
    });
    const db = new DatabaseSync(resultaat.cachePad, { readOnly: true });
    try {
      const rij = db.prepare("SELECT vooruitbetaling, saldo FROM ouderdomsanalyse WHERE bedrijfsnr='074'").get() as
        | { vooruitbetaling: string; saldo: string }
        | undefined;
      expect(rij?.vooruitbetaling).toBe("-150");
      expect(rij?.saldo).toBe("150");
    } finally {
      db.close();
    }
  });
});

// ── 7. Cache-inhoud komt overeen met de input ───────────────────────────────

describe("7. SQLite-cache-inhoud komt inhoudelijk overeen met de brondata", () => {
  it("rijaantallen per bron en per administratie kloppen exact met de input", () => {
    schrijfAlleGedeeldeBronnen();
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    initAdministratie(root, ADMIN_074, "074", "Fergagne bv");

    const resultaat070 = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {}, ouderdomsanalyseMetadata: OUDERDOMSANALYSE_METADATA });
    const resultaat074 = rebuildCache({ root, administratieId: ADMIN_074, onVoortgang: () => {}, ouderdomsanalyseMetadata: OUDERDOMSANALYSE_METADATA });

    // boekingenRijen() heeft 2 rijen voor 070, 1 voor 074 (zie fixtures.ts).
    expect(resultaat070.rowCounts["boekingen"]).toBe(2);
    expect(resultaat074.rowCounts["boekingen"]).toBe(1);
    // Alle overige bronnen: 1 rij per administratie in de fixtures.
    for (const tabel of ["balansstanden", "servicekosten", "contracten", "units", "rentroll", "complex_totalen", "ouderdomsanalyse", "vorderingen_met_afboekingen"]) {
      expect(resultaat070.rowCounts[tabel], tabel).toBe(tabel === "servicekosten" ? 2 : 1);
      expect(resultaat074.rowCounts[tabel], tabel).toBe(1);
    }
  });

  it("een specifiek bedrag in de cache is exact herleidbaar naar de brondata (geen afronding/mutatie)", () => {
    schrijfAlleGedeeldeBronnen();
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");
    const resultaat = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    const db = new DatabaseSync(resultaat.cachePad, { readOnly: true });
    try {
      const rij = db.prepare("SELECT bedrag_debet, saldo FROM boekingen WHERE boekstuknr='024001'").get() as
        | { bedrag_debet: string; saldo: string }
        | undefined;
      expect(rij?.bedrag_debet).toBe("1665.54");
      expect(rij?.saldo).toBe("1665.54"); // centraal herberekend, niet de #REF!-bronwaarde
    } finally {
      db.close();
    }
  });
});

// ── 8. Atomiciteit bij een fout halverwege ──────────────────────────────────

describe("8. Atomiciteit: een fout halverwege raakt een bestaande goede cache niet", () => {
  it("een geslaagde cache blijft ongewijzigd als een volgende rebuild halverwege faalt", () => {
    schrijfAlleGedeeldeBronnen();
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");

    const eersteResultaat = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    const dbVoor = new DatabaseSync(eersteResultaat.cachePad, { readOnly: true });
    const rijenVoor = dbVoor.prepare("SELECT * FROM boekingen ORDER BY boekstuknr").all();
    dbVoor.close();
    expect(rijenVoor.length).toBeGreaterThan(0);

    // Breek een van de bronnen zodat de volgende rebuild halverwege faalt
    // (na boekingen, bij units — afgebroken/corrupt bestand i.p.v. geldig xlsx).
    schrijfAfgebrokenXlsxFixture(join(bronGedeeldDir(root), "units.xlsx"));

    expect(() => rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} })).toThrow();

    // De bestaande cache van vóór de mislukte poging moet exact hetzelfde zijn gebleven.
    const dbNa = new DatabaseSync(eersteResultaat.cachePad, { readOnly: true });
    const rijenNa = dbNa.prepare("SELECT * FROM boekingen ORDER BY boekstuknr").all();
    dbNa.close();
    expect(rijenNa).toEqual(rijenVoor);

    // Geen tijdelijke .tmp-* bestanden blijven achter na de mislukte poging.
    const cacheDirBestanden = readdirSync(join(root, "administraties", ADMIN_070, "cache"));
    expect(cacheDirBestanden.some((n: string) => n.includes(".tmp-"))).toBe(false);
  });
});

// ── 9. Idempotentie: tweemaal dezelfde rebuild geeft identiek resultaat ────

describe("9. Idempotentie: herhaalde rebuild geeft identiek resultaat, geen dubbele records", () => {
  it("tweemaal achter elkaar herbouwen met dezelfde bron geeft byte-voor-byte dezelfde rijinhoud", () => {
    schrijfAlleGedeeldeBronnen();
    initAdministratie(root, ADMIN_070, "070", "Rooise Zoom");

    const eerste = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    const dbEerste = new DatabaseSync(eerste.cachePad, { readOnly: true });
    const rijenEerste = dbEerste.prepare("SELECT * FROM boekingen ORDER BY boekstuknr").all();
    dbEerste.close();

    const tweede = rebuildCache({ root, administratieId: ADMIN_070, onVoortgang: () => {} });
    const dbTweede = new DatabaseSync(tweede.cachePad, { readOnly: true });
    const rijenTweede = dbTweede.prepare("SELECT * FROM boekingen ORDER BY boekstuknr").all();
    dbTweede.close();

    expect(tweede.rowCounts).toEqual(eerste.rowCounts);
    expect(rijenTweede).toEqual(rijenEerste);
    // Geen dubbele records: primary key in het schema zou dit al afdwingen,
    // maar controleer ook expliciet dat er geen 2x zoveel rijen zijn ontstaan.
    expect(rijenTweede).toHaveLength(rijenEerste.length);
  });
});
