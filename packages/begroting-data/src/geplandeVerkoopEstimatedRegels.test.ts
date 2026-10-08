import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maakBegrotingsversie, markeerVastgesteld, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import {
  leesGeplandeVerkoopEstimatedRegels,
  schrijfGeplandeVerkoopEstimatedRegels,
  type GeplandeVerkoopEstimatedRegel,
  type GeplandeVerkoopEstimatedRegelInvoer,
} from "./geplandeVerkoopEstimatedRegels.js";
import { leesGeplandeVerkoopRegels, schrijfGeplandeVerkoopRegels, type GeplandeVerkoopRegelInvoer } from "./geplandeVerkoopRegels.js";
import { openOrCreateDatabase } from "./database.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-geplande-verkoop-estimated-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NIEUWE_VERSIE_INPUT: NieuweBegrotingsversieInput = {
  originType: "NIEUW",
  bedrijfsnr: "023",
  begrotingsjaar: 2027,
  bronPeildatum: new Date(Date.UTC(2026, 6, 31)),
};

function estimatedRegelInvoer(overrides: Partial<GeplandeVerkoopEstimatedRegelInvoer> = {}): GeplandeVerkoopEstimatedRegelInvoer {
  return {
    id: null,
    objectreferentie: "Hoofdstraat 103",
    omschrijving: "Verkoop pand Hoofdstraat 103",
    geplandeVerkoopdatum: new Date("2027-06-01T00:00:00.000Z"),
    verwachteVerkoopopbrengst: new Decimal(785000),
    verwachteBoekwaarde: new Decimal(600000),
    verwachteVerkoopkosten: new Decimal(15000),
    verwachteEinddatumHuurExploitatie: null,
    toelichting: null,
    ...overrides,
  };
}

function begrotingRegelInvoer(overrides: Partial<GeplandeVerkoopRegelInvoer> = {}): GeplandeVerkoopRegelInvoer {
  return {
    id: null,
    objectreferentie: "Hoofdstraat 103",
    omschrijving: "Verkoop pand Hoofdstraat 103",
    geplandeVerkoopdatum: new Date("2027-06-01T00:00:00.000Z"),
    verwachteVerkoopopbrengst: new Decimal(785000),
    verwachteBoekwaarde: new Decimal(600000),
    verwachteVerkoopkosten: new Decimal(15000),
    verwachteEinddatumHuurExploitatie: null,
    toelichting: null,
    ...overrides,
  };
}

function naarInvoer(r: GeplandeVerkoopEstimatedRegel): GeplandeVerkoopEstimatedRegelInvoer {
  return { ...r };
}

describe("schrijfGeplandeVerkoopEstimatedRegels / leesGeplandeVerkoopEstimatedRegels", () => {
  it("1. nul regels lezen", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    expect(leesGeplandeVerkoopEstimatedRegels(db, versie.id)).toEqual([]);
  });

  it("2. schrijven/lezen round-trip, inclusief Decimal-precisie", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopEstimatedRegels(db, versie.id, [estimatedRegelInvoer({ verwachteVerkoopopbrengst: new Decimal("800000.5") })]);
    const gelezen = leesGeplandeVerkoopEstimatedRegels(db, versie.id);
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]?.verwachteVerkoopopbrengst?.toString()).toBe("800000.5");
  });

  it("3. Estimated en Begroting zijn twee volledig gescheiden tabellen — schrijven op de één raakt de ander niet", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopRegels(db, versie.id, [begrotingRegelInvoer({ verwachteVerkoopopbrengst: new Decimal(785000) })]);
    schrijfGeplandeVerkoopEstimatedRegels(db, versie.id, [estimatedRegelInvoer({ verwachteVerkoopopbrengst: new Decimal(900000) })]);

    expect(leesGeplandeVerkoopRegels(db, versie.id)[0]?.verwachteVerkoopopbrengst?.toString()).toBe("785000");
    expect(leesGeplandeVerkoopEstimatedRegels(db, versie.id)[0]?.verwachteVerkoopopbrengst?.toString()).toBe("900000");
  });

  it("4 (kernbewijs OB039-006/7). Estimated-regels blijven schrijfbaar NA vaststellen, terwijl Begroting-regels dan geblokkeerd zijn", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopRegels(db, versie.id, [begrotingRegelInvoer()]);
    schrijfGeplandeVerkoopEstimatedRegels(db, versie.id, [estimatedRegelInvoer({ verwachteVerkoopopbrengst: new Decimal(785000) })]);
    markeerVastgesteld(db, versie.id, new Date());

    // Begroting: geblokkeerd, zoals verwacht.
    expect(() => schrijfGeplandeVerkoopRegels(db, versie.id, [begrotingRegelInvoer()])).toThrow(/VASTGESTELD/);

    // Estimated: BEWUST NIET geblokkeerd — de actuele verwachting mag na vaststellen blijven bewegen.
    expect(() => schrijfGeplandeVerkoopEstimatedRegels(db, versie.id, [estimatedRegelInvoer({ verwachteVerkoopopbrengst: new Decimal(820000) })])).not.toThrow();
    expect(leesGeplandeVerkoopEstimatedRegels(db, versie.id)[0]?.verwachteVerkoopopbrengst?.toString()).toBe("820000");
  });

  it("5. directe SQL INSERT/UPDATE/DELETE op Estimated-regels blijven toegestaan na VASTGESTELD (geen immutability-trigger, bewust anders dan Begroting-regels)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regel] = schrijfGeplandeVerkoopEstimatedRegels(db, versie.id, [estimatedRegelInvoer()]);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => db.prepare(`UPDATE begroting_geplande_verkoop_estimated_regel SET omschrijving = 'gewijzigd' WHERE id = ?`).run(regel!.id)).not.toThrow();
    expect(leesGeplandeVerkoopEstimatedRegels(db, versie.id)[0]?.omschrijving).toBe("gewijzigd");
  });

  it("6. verwijderen van de CONCEPT-ouderversie cascadeert de Estimated-regels weg (FK ON DELETE CASCADE blijft gelden)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfGeplandeVerkoopEstimatedRegels(db, versie.id, [estimatedRegelInvoer()]);
    db.prepare(`DELETE FROM begrotingsversies WHERE id = ?`).run(versie.id);
    expect(db.prepare(`SELECT 1 FROM begroting_geplande_verkoop_estimated_regel WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
  });

  it("7. bestaande regel update behoudt ID", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfGeplandeVerkoopEstimatedRegels(db, versie.id, [estimatedRegelInvoer({ omschrijving: "Origineel" })]);
    const bijgewerkt = schrijfGeplandeVerkoopEstimatedRegels(db, versie.id, [{ ...naarInvoer(origineel!), omschrijving: "Bijgewerkt" }]);
    expect(bijgewerkt[0]?.id).toBe(origineel!.id);
    expect(bijgewerkt[0]?.omschrijving).toBe("Bijgewerkt");
  });

  it("8. ID van andere begrotingsversie -> fail-fast + rollback", () => {
    const versieA = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const versieB = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [regelB] = schrijfGeplandeVerkoopEstimatedRegels(db, versieB.id, [estimatedRegelInvoer()]);
    expect(() => schrijfGeplandeVerkoopEstimatedRegels(db, versieA.id, [{ ...naarInvoer(regelB!), omschrijving: "Gekaapt" }])).toThrow(/behoort bij begrotingsversie/);
  });

  it("9. duplicate bestaande ID in input -> fail-fast + rollback", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const [origineel] = schrijfGeplandeVerkoopEstimatedRegels(db, versie.id, [estimatedRegelInvoer({ omschrijving: "Origineel" })]);
    expect(() =>
      schrijfGeplandeVerkoopEstimatedRegels(db, versie.id, [
        { ...naarInvoer(origineel!), omschrijving: "Versie 1" },
        { ...naarInvoer(origineel!), omschrijving: "Versie 2" },
      ]),
    ).toThrow(/meerdere keren voor in één save/);
  });

  it("10. begrotingsversie bestaat niet -> fail-fast", () => {
    expect(() => schrijfGeplandeVerkoopEstimatedRegels(db, "onbestaande-versie-id", [estimatedRegelInvoer()])).toThrow(/bestaat niet/);
  });
});
