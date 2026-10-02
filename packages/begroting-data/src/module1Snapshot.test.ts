import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenBegroteHuuropbrengsten, type BgContractFeiten } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, verwijderConceptVersie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";
import { leesModule1Snapshot, schrijfModule1Snapshot } from "./module1Snapshot.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-snapshot-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NIEUWE_VERSIE_INPUT: NieuweBegrotingsversieInput = {
  originType: "NIEUW",
  bedrijfsnr: "070",
  begrotingsjaar: 2027,
  bronPeildatum: new Date(Date.UTC(2026, 6, 31)),
};

function maakContract(contractnummer: string, overrides: Partial<BgContractFeiten> = {}): BgContractFeiten {
  return {
    bedrijfsnr: "070",
    contractnummer,
    huurdernummer: "H1",
    huurderNaam: "Test Huurder BV",
    complexnummer: "001",
    rentrollComponenten: [{ vorderingsoort: "01", bedragJaar: new Decimal(120000), btwYn: "Y" }],
    ingangsdatum: new Date(Date.UTC(2020, 0, 1)),
    einddatum: null,
    indexatiedatum: new Date(Date.UTC(2027, 6, 1)),
    indexatieHerhalingMaanden: 12,
    toekomstigeKortingswijzigingen: [],
    ...overrides,
  };
}

describe("schrijfModule1Snapshot / leesModule1Snapshot", () => {
  it("3. lege Module-1-snapshot: round-trip naar een lege array", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, []);
    expect(leesModule1Snapshot(db, versie.id)).toEqual([]);
  });

  it("4. één volledig contract: round-trip exact, alle scalar velden", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const contract = maakContract("0000000028", {
      huurdernummer: "0021",
      huurderNaam: "Fruitcake BV",
      complexnummer: "002",
      ingangsdatum: new Date(Date.UTC(2020, 0, 1)),
      einddatum: new Date(Date.UTC(2029, 11, 31)),
      indexatiedatum: new Date(Date.UTC(2027, 6, 1)),
      indexatieHerhalingMaanden: 12,
      rentrollComponenten: [{ vorderingsoort: "01", bedragJaar: new Decimal("37318.80"), btwYn: "Y" }],
      toekomstigeKortingswijzigingen: [],
    });

    schrijfModule1Snapshot(db, versie.id, [contract]);
    const gelezen = leesModule1Snapshot(db, versie.id);

    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]).toEqual(contract);
  });

  it("5. meerdere contracten: deterministisch gelezen (op contractnummer), ongeacht schrijfvolgorde", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Bewust NIET in gesorteerde volgorde aangeboden.
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000052"), maakContract("0000000028"), maakContract("0000000045")]);

    const gelezen = leesModule1Snapshot(db, versie.id);
    expect(gelezen.map((c) => c.contractnummer)).toEqual(["0000000028", "0000000045", "0000000052"]);
  });

  it("6. alle rentroll-componenten blijven behouden, ook onbekende/niet-VS01/VS13 vorderingsoorten", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const contract = maakContract("0000000043", {
      rentrollComponenten: [
        { vorderingsoort: "01", bedragJaar: new Decimal(92875.92), btwYn: "Y" },
        { vorderingsoort: "13", bedragJaar: new Decimal(-6000), btwYn: "Y" },
        { vorderingsoort: "99", bedragJaar: new Decimal(0), btwYn: null }, // onbekende/niet-bewezen vorderingsoort
      ],
    });
    schrijfModule1Snapshot(db, versie.id, [contract]);

    const gelezen = leesModule1Snapshot(db, versie.id)[0]!;
    expect(gelezen.rentrollComponenten).toHaveLength(3);
    expect(gelezen.rentrollComponenten.map((c) => c.vorderingsoort).sort()).toEqual(["01", "13", "99"]);
    expect(gelezen.rentrollComponenten.find((c) => c.vorderingsoort === "99")!.btwYn).toBeNull();
  });

  it("7. negatieve VS13 blijft exact negatief (geen .abs() in persistence)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const contract = maakContract("0000000049", {
      rentrollComponenten: [
        { vorderingsoort: "01", bedragJaar: new Decimal(12777.36), btwYn: "Y" },
        { vorderingsoort: "13", bedragJaar: new Decimal(-6000), btwYn: "Y" },
      ],
    });
    schrijfModule1Snapshot(db, versie.id, [contract]);

    const vs13 = leesModule1Snapshot(db, versie.id)[0]!.rentrollComponenten.find((c) => c.vorderingsoort === "13")!;
    expect(vs13.bedragJaar.isNegative()).toBe(true);
    expect(vs13.bedragJaar.toString()).toBe("-6000");

    // Ook rechtstreeks op rijniveau: het ruwe TEXT-veld bevat het minteken, geen omgezette/afgeronde waarde.
    const ruweRij = db
      .prepare(
        `SELECT bedrag_jaar FROM begroting_contract_rentroll_component WHERE begroting_versie_id = ? AND contractnummer = ? AND vorderingsoort = '13'`,
      )
      .get(versie.id, "0000000049") as { bedrag_jaar: string };
    expect(ruweRij.bedrag_jaar).toBe("-6000");
  });

  it("8. Decimal TEXT round-trip zonder number-conversie (meer decimalen dan 2, geen precisieverlies)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    // Een waarde die als JS `number` precisie zou verliezen/afronden — bewijst dat er nergens een
    // Number()-omzetting in het schrijf- of leespad zit.
    const precisieBedrag = new Decimal("12345.6789012345");
    const contract = maakContract("0000000001", {
      rentrollComponenten: [{ vorderingsoort: "01", bedragJaar: precisieBedrag, btwYn: "Y" }],
    });
    schrijfModule1Snapshot(db, versie.id, [contract]);

    const ruweRij = db
      .prepare(`SELECT bedrag_jaar, typeof(bedrag_jaar) AS type FROM begroting_contract_rentroll_component WHERE begroting_versie_id = ?`)
      .get(versie.id) as { bedrag_jaar: string; type: string };
    expect(ruweRij.type).toBe("text"); // SQLite TEXT, geen REAL
    expect(ruweRij.bedrag_jaar).toBe("12345.6789012345");

    const gelezenBedrag = leesModule1Snapshot(db, versie.id)[0]!.rentrollComponenten[0]!.bedragJaar;
    expect(gelezenBedrag.toString()).toBe("12345.6789012345");
    expect(gelezenBedrag.equals(precisieBedrag)).toBe(true);
  });

  it("9. nullable datums: exact round-trip, zowel volledig NULL als volledig gevuld", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const zonderDatums = maakContract("0000000001", { ingangsdatum: null, einddatum: null, indexatiedatum: null });
    const metDatums = maakContract("0000000002", {
      ingangsdatum: new Date(Date.UTC(2020, 0, 1)),
      einddatum: new Date(Date.UTC(2029, 11, 31)),
      indexatiedatum: new Date(Date.UTC(2027, 6, 1)),
    });
    schrijfModule1Snapshot(db, versie.id, [zonderDatums, metDatums]);

    const gelezen = leesModule1Snapshot(db, versie.id);
    const gelezenZonder = gelezen.find((c) => c.contractnummer === "0000000001")!;
    expect(gelezenZonder.ingangsdatum).toBeNull();
    expect(gelezenZonder.einddatum).toBeNull();
    expect(gelezenZonder.indexatiedatum).toBeNull();

    const gelezenMet = gelezen.find((c) => c.contractnummer === "0000000002")!;
    expect(gelezenMet.ingangsdatum).toEqual(new Date(Date.UTC(2020, 0, 1)));
    expect(gelezenMet.einddatum).toEqual(new Date(Date.UTC(2029, 11, 31)));
    expect(gelezenMet.indexatiedatum).toEqual(new Date(Date.UTC(2027, 6, 1)));
  });

  it("10. indexatieHerhalingMaanden: exact round-trip, incl. NULL", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const metInterval = maakContract("0000000001", { indexatieHerhalingMaanden: 12 });
    const zonderInterval = maakContract("0000000002", { indexatieHerhalingMaanden: null });
    schrijfModule1Snapshot(db, versie.id, [metInterval, zonderInterval]);

    const gelezen = leesModule1Snapshot(db, versie.id);
    expect(gelezen.find((c) => c.contractnummer === "0000000001")!.indexatieHerhalingMaanden).toBe(12);
    expect(gelezen.find((c) => c.contractnummer === "0000000002")!.indexatieHerhalingMaanden).toBeNull();
  });

  it("11. toekomstige kortingswijziging: exact round-trip (ingangsdatum + ruw brontekenbedrag)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const contract = maakContract("0000000049", {
      toekomstigeKortingswijzigingen: [{ ingangsdatum: new Date(Date.UTC(2027, 6, 1)), nieuweKortingPerMaand: new Decimal(0) }],
    });
    schrijfModule1Snapshot(db, versie.id, [contract]);

    const gelezen = leesModule1Snapshot(db, versie.id)[0]!.toekomstigeKortingswijzigingen;
    expect(gelezen).toHaveLength(1);
    expect(gelezen[0]!.ingangsdatum).toEqual(new Date(Date.UTC(2027, 6, 1)));
    expect(gelezen[0]!.nieuweKortingPerMaand.toString()).toBe("0");
  });

  it("12. meerdere kortingswijzigingen blijven behouden en chronologisch geordend", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    const contract = maakContract("0000000051", {
      // Bewust NIET in chronologische volgorde aangeboden.
      toekomstigeKortingswijzigingen: [
        { ingangsdatum: new Date(Date.UTC(2027, 4, 1)), nieuweKortingPerMaand: new Decimal(-250) },
        { ingangsdatum: new Date(Date.UTC(2026, 6, 1)), nieuweKortingPerMaand: new Decimal(-660) },
      ],
    });
    schrijfModule1Snapshot(db, versie.id, [contract]);

    const gelezen = leesModule1Snapshot(db, versie.id)[0]!.toekomstigeKortingswijzigingen;
    expect(gelezen).toHaveLength(2);
    expect(gelezen[0]!.ingangsdatum).toEqual(new Date(Date.UTC(2026, 6, 1)));
    expect(gelezen[0]!.nieuweKortingPerMaand.toString()).toBe("-660");
    expect(gelezen[1]!.ingangsdatum).toEqual(new Date(Date.UTC(2027, 4, 1)));
    expect(gelezen[1]!.nieuweKortingPerMaand.toString()).toBe("-250");
  });

  it("13. complete snapshot vervangen verwijdert de oude contracten + children volledig", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [
      maakContract("0000000028", {
        rentrollComponenten: [{ vorderingsoort: "01", bedragJaar: new Decimal(1000), btwYn: "Y" }],
        toekomstigeKortingswijzigingen: [{ ingangsdatum: new Date(Date.UTC(2027, 6, 1)), nieuweKortingPerMaand: new Decimal(0) }],
      }),
    ]);

    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000099")]);

    const gelezen = leesModule1Snapshot(db, versie.id);
    expect(gelezen.map((c) => c.contractnummer)).toEqual(["0000000099"]);

    // Rechtstreeks op rijniveau: "028" en zijn children bestaan nergens meer, niet alleen "onzichtbaar".
    const oudeSnapshotRij = db
      .prepare(`SELECT 1 FROM begroting_contract_snapshot WHERE begroting_versie_id = ? AND contractnummer = '0000000028'`)
      .get(versie.id);
    const oudeComponentRij = db
      .prepare(`SELECT 1 FROM begroting_contract_rentroll_component WHERE begroting_versie_id = ? AND contractnummer = '0000000028'`)
      .get(versie.id);
    const oudeKortingRij = db
      .prepare(`SELECT 1 FROM begroting_contract_kortingswijziging WHERE begroting_versie_id = ? AND contractnummer = '0000000028'`)
      .get(versie.id);
    expect(oudeSnapshotRij).toBeUndefined();
    expect(oudeComponentRij).toBeUndefined();
    expect(oudeKortingRij).toBeUndefined();
  });

  it("14. fout midden in vervanging: volledige rollback naar de vorige snapshot", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);

    // Bewust corrupt (contractnummer=null omzeilt de TS-typing, simuleert een aanroepersfout) — forceert
    // een échte NOT NULL-constraintfout MIDDEN in de INSERT-lus, niet vooraf al afgevangen door de eigen
    // dubbel-contractnummer-check (die controleert alleen op duplicaten, niet op ongeldige waarden).
    const kapotContract = { ...maakContract("0000000029"), contractnummer: null as unknown as string };

    expect(() => schrijfModule1Snapshot(db, versie.id, [maakContract("0000000099"), kapotContract])).toThrow();

    const naMislukking = leesModule1Snapshot(db, versie.id);
    expect(naMislukking).toHaveLength(1);
    expect(naMislukking[0]!.contractnummer).toBe("0000000028"); // exact de vorige snapshot, ongewijzigd
  });

  it("15. dubbel (begroting_versie_id, contractnummer) wordt door de database geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);

    // Rechtstreekse SQL, buiten de TS-array-precheck om — bewijst de PK-constraint zelf.
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_contract_snapshot
             (begroting_versie_id, contractnummer, bedrijfsnr, huurdernummer, huurder_naam, complexnummer, ingangsdatum, einddatum, indexatiedatum, indexatie_herhaling_maanden)
           VALUES (?, '0000000028', '070', NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
        )
        .run(versie.id),
    ).toThrow();
  });

  it("16. schrijven op een onbestaande begrotingsversie wordt geweigerd", () => {
    expect(() => schrijfModule1Snapshot(db, "bestaat-niet", [maakContract("0000000028")])).toThrow(/bestaat niet/);
  });

  it("17. verwijderConceptVersie cascadeert de snapshot + beide child-tabellen volledig weg", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [
      maakContract("0000000028", {
        toekomstigeKortingswijzigingen: [{ ingangsdatum: new Date(Date.UTC(2027, 6, 1)), nieuweKortingPerMaand: new Decimal(0) }],
      }),
    ]);

    verwijderConceptVersie(db, versie.id);

    expect(db.prepare(`SELECT 1 FROM begroting_contract_snapshot WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
    expect(db.prepare(`SELECT 1 FROM begroting_contract_rentroll_component WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
    expect(db.prepare(`SELECT 1 FROM begroting_contract_kortingswijziging WHERE begroting_versie_id = ?`).get(versie.id)).toBeUndefined();
  });

  it("23. lezen van de snapshot verandert niets aan de data (herhaald lezen is identiek)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);

    const eersteKeer = leesModule1Snapshot(db, versie.id);
    const tweedeKeer = leesModule1Snapshot(db, versie.id);
    expect(tweedeKeer).toEqual(eersteKeer);
  });

  it("24. de gelezen snapshot compileert en werkt rechtstreeks als invoer van de échte berekenBegroteHuuropbrengsten (@bvc/reporting)", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028")]);
    const contracten = leesModule1Snapshot(db, versie.id);

    // Compile-time bewijs: `contracten` (readonly BgContractFeiten[]) gaat rechtstreeks, ongewijzigd, als
    // eerste argument — geen aanpassing/cast nodig. Runtime: de échte pure functie accepteert het zonder fouten.
    expect(() =>
      berekenBegroteHuuropbrengsten(contracten, [], { begrotingsjaar: 2027, indexatiePercentage: new Decimal(3) }, versie.bronPeildatum),
    ).not.toThrow();
  });
});

describe("bedrijfsnr-consistentie-invariant (snapshot moet bij het bedrijfsnr van de parent-versie horen)", () => {
  it("1. contract.bedrijfsnr = parent.bedrijfsnr blijft toegestaan", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT); // bedrijfsnr "070"
    expect(() => schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { bedrijfsnr: "070" })])).not.toThrow();
    expect(leesModule1Snapshot(db, versie.id)[0]!.bedrijfsnr).toBe("070");
  });

  it("2+3. één afwijkend bedrijfsnr wordt geweigerd vóór vervanging — de vorige geldige snapshot blijft volledig intact", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT); // bedrijfsnr "070"
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { bedrijfsnr: "070" })]);

    expect(() =>
      schrijfModule1Snapshot(db, versie.id, [maakContract("0000000099", { bedrijfsnr: "070" }), maakContract("0000000098", { bedrijfsnr: "010" })]),
    ).toThrow(/bedrijfsnr/);

    // De vorige, geldige snapshot ("028") staat er nog exact zoals hij was — de nieuwe (deels ongeldige)
    // set is nooit toegepast, ook niet gedeeltelijk (de fout wordt al vóór de transactie gegooid).
    const naMislukking = leesModule1Snapshot(db, versie.id);
    expect(naMislukking).toHaveLength(1);
    expect(naMislukking[0]!.contractnummer).toBe("0000000028");
  });

  it("4. rechtstreekse SQL INSERT met afwijkend bedrijfsnr wordt door SQLite zelf geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT); // bedrijfsnr "070"
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_contract_snapshot
             (begroting_versie_id, contractnummer, bedrijfsnr, huurdernummer, huurder_naam, complexnummer, ingangsdatum, einddatum, indexatiedatum, indexatie_herhaling_maanden)
           VALUES (?, '0000000028', '010', NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
        )
        .run(versie.id),
    ).toThrow(/bedrijfsnr/);
  });

  it("5. rechtstreekse SQL UPDATE van een CONCEPT-snapshot naar afwijkend bedrijfsnr wordt eveneens geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT); // bedrijfsnr "070"
    schrijfModule1Snapshot(db, versie.id, [maakContract("0000000028", { bedrijfsnr: "070" })]);

    expect(() =>
      db.prepare(`UPDATE begroting_contract_snapshot SET bedrijfsnr = '010' WHERE begroting_versie_id = ?`).run(versie.id),
    ).toThrow(/bedrijfsnr/);

    // Ongewijzigd gebleven.
    expect(leesModule1Snapshot(db, versie.id)[0]!.bedrijfsnr).toBe("070");
  });

  it("6. een snapshot met meerdere contracten, allemaal met hetzelfde parent-bedrijfsnr, round-tript probleemloos", () => {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT); // bedrijfsnr "070"
    schrijfModule1Snapshot(db, versie.id, [
      maakContract("0000000028", { bedrijfsnr: "070" }),
      maakContract("0000000045", { bedrijfsnr: "070" }),
      maakContract("0000000052", { bedrijfsnr: "070" }),
    ]);

    const gelezen = leesModule1Snapshot(db, versie.id);
    expect(gelezen).toHaveLength(3);
    expect(gelezen.every((c) => c.bedrijfsnr === "070")).toBe(true);
  });
});

describe("immutability na VASTGESTELD (snapshot + beide child-tabellen)", () => {
  function maakVastgesteldeVersieMetSnapshot(): string {
    const versie = maakBegrotingsversie(db, NIEUWE_VERSIE_INPUT);
    schrijfModule1Snapshot(db, versie.id, [
      maakContract("0000000028", {
        toekomstigeKortingswijzigingen: [{ ingangsdatum: new Date(Date.UTC(2027, 6, 1)), nieuweKortingPerMaand: new Decimal(0) }],
      }),
    ]);
    markeerVastgesteld(db, versie.id, new Date());
    return versie.id;
  }

  it("18. snapshot INSERT ná VASTGESTELD wordt geweigerd", () => {
    const versieId = maakVastgesteldeVersieMetSnapshot();
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_contract_snapshot
             (begroting_versie_id, contractnummer, bedrijfsnr, huurdernummer, huurder_naam, complexnummer, ingangsdatum, einddatum, indexatiedatum, indexatie_herhaling_maanden)
           VALUES (?, '0000000099', '070', NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
        )
        .run(versieId),
    ).toThrow(/immutable/);
  });

  it("19. snapshot UPDATE ná VASTGESTELD wordt geweigerd", () => {
    const versieId = maakVastgesteldeVersieMetSnapshot();
    expect(() =>
      db.prepare(`UPDATE begroting_contract_snapshot SET complexnummer = '999' WHERE begroting_versie_id = ?`).run(versieId),
    ).toThrow(/immutable/);
  });

  it("20. snapshot DELETE ná VASTGESTELD wordt geweigerd (en dus ook schrijfModule1Snapshot zelf)", () => {
    const versieId = maakVastgesteldeVersieMetSnapshot();
    expect(() => db.prepare(`DELETE FROM begroting_contract_snapshot WHERE begroting_versie_id = ?`).run(versieId)).toThrow(/immutable/);
    expect(() => schrijfModule1Snapshot(db, versieId, [maakContract("0000000001")])).toThrow(/VASTGESTELD/);
  });

  it("21. rentroll-component INSERT/UPDATE/DELETE ná VASTGESTELD worden alle drie geweigerd", () => {
    const versieId = maakVastgesteldeVersieMetSnapshot();
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_contract_rentroll_component (begroting_versie_id, contractnummer, volgnr, vorderingsoort, bedrag_jaar, btw_yn)
           VALUES (?, '0000000028', 99, '01', '1', 'Y')`,
        )
        .run(versieId),
    ).toThrow(/immutable/);
    expect(() =>
      db
        .prepare(`UPDATE begroting_contract_rentroll_component SET bedrag_jaar = '999' WHERE begroting_versie_id = ?`)
        .run(versieId),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_contract_rentroll_component WHERE begroting_versie_id = ?`).run(versieId)).toThrow(
      /immutable/,
    );
  });

  it("22. kortingswijziging-child INSERT/UPDATE/DELETE ná VASTGESTELD worden alle drie geweigerd", () => {
    const versieId = maakVastgesteldeVersieMetSnapshot();
    expect(() =>
      db
        .prepare(
          `INSERT INTO begroting_contract_kortingswijziging (begroting_versie_id, contractnummer, volgnr, ingangsdatum, nieuwe_korting_per_maand)
           VALUES (?, '0000000028', 99, '2028-01-01', '0')`,
        )
        .run(versieId),
    ).toThrow(/immutable/);
    expect(() =>
      db
        .prepare(`UPDATE begroting_contract_kortingswijziging SET nieuwe_korting_per_maand = '-999' WHERE begroting_versie_id = ?`)
        .run(versieId),
    ).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM begroting_contract_kortingswijziging WHERE begroting_versie_id = ?`).run(versieId)).toThrow(
      /immutable/,
    );
  });
});
