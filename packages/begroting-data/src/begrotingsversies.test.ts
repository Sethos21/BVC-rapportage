import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  leesBegrotingsversie,
  maakBegrotingsversie,
  markeerVastgesteld,
  verwijderConceptVersie,
  wijzigConceptNaamNotitie,
  type NieuweBegrotingsversieInput,
} from "./begrotingsversies.js";
import { openOrCreateDatabase } from "./database.js";

let dir: string;
let dbPad: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bvc-begroting-data-versies-"));
  dbPad = join(dir, "begrotingen.sqlite");
  db = openOrCreateDatabase(dbPad);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NIEUW_INPUT: NieuweBegrotingsversieInput = {
  originType: "NIEUW",
  bedrijfsnr: "070",
  begrotingsjaar: 2027,
  bronPeildatum: new Date(Date.UTC(2026, 6, 31)), // 31-07-2026
  naam: "Budget 2027 v1",
  notitie: "eerste concept",
};

describe("maakBegrotingsversie / leesBegrotingsversie", () => {
  it("3. nieuwe CONCEPT-versie round-trip: alle velden komen ongewijzigd terug", () => {
    const aangemaakt = maakBegrotingsversie(db, NIEUW_INPUT);
    const gelezen = leesBegrotingsversie(db, aangemaakt.id);

    expect(gelezen).toEqual(aangemaakt);
    expect(gelezen!.status).toBe("CONCEPT");
    expect(gelezen!.bedrijfsnr).toBe("070");
    expect(gelezen!.begrotingsjaar).toBe(2027);
    expect(gelezen!.naam).toBe("Budget 2027 v1");
    expect(gelezen!.notitie).toBe("eerste concept");
    expect(gelezen!.vastgesteldAt).toBeNull();
    expect(gelezen!.basedOnVersionId).toBeNull();
    expect(gelezen!.originType).toBe("NIEUW");
  });

  it("4. bron_peildatum round-trip: exact dezelfde UTC-kalenderdag, ongeacht tijdstip-component van de invoer", () => {
    // Bewust een Date MET een niet-middernacht tijdstip-component, om te bewijzen dat alleen de
    // UTC-kalenderdag wordt bewaard (zelfde conventie als Module 1's `naarKalenderDag`).
    const metTijdstip = new Date(Date.UTC(2027, 4, 1, 13, 45, 30));
    const aangemaakt = maakBegrotingsversie(db, { ...NIEUW_INPUT, bronPeildatum: metTijdstip });

    expect(aangemaakt.bronPeildatum.getUTCFullYear()).toBe(2027);
    expect(aangemaakt.bronPeildatum.getUTCMonth()).toBe(4);
    expect(aangemaakt.bronPeildatum.getUTCDate()).toBe(1);
    expect(aangemaakt.bronPeildatum.getUTCHours()).toBe(0); // tijdstip-component is weg, niet meegenomen

    const ruweRij = db.prepare(`SELECT bron_peildatum FROM begrotingsversies WHERE id = ?`).get(aangemaakt.id) as { bron_peildatum: string };
    expect(ruweRij.bron_peildatum).toBe("2027-05-01"); // kale YYYY-MM-DD in de database, geen tijdstip

    const opnieuwGelezen = leesBegrotingsversie(db, aangemaakt.id)!;
    expect(opnieuwGelezen.bronPeildatum.getTime()).toBe(aangemaakt.bronPeildatum.getTime());
  });

  it("5. created_at is een UTC-ISO-timestamp, geen kale datum", () => {
    const voor = Date.now();
    const aangemaakt = maakBegrotingsversie(db, NIEUW_INPUT);
    const na = Date.now();

    const ruweRij = db.prepare(`SELECT created_at FROM begrotingsversies WHERE id = ?`).get(aangemaakt.id) as { created_at: string };
    expect(ruweRij.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // ISO-8601 UTC, incl. milliseconden en Z
    expect(aangemaakt.createdAt.getTime()).toBeGreaterThanOrEqual(voor);
    expect(aangemaakt.createdAt.getTime()).toBeLessThanOrEqual(na);
  });

  it("6. NIEUW + based_on_version_id = NULL is toegestaan", () => {
    const aangemaakt = maakBegrotingsversie(db, { ...NIEUW_INPUT, originType: "NIEUW" });
    expect(aangemaakt.originType).toBe("NIEUW");
    expect(aangemaakt.basedOnVersionId).toBeNull();
  });

  it("7. GEBASEERD_OP_VERSIE + geldige parent is toegestaan", () => {
    const parent = maakBegrotingsversie(db, NIEUW_INPUT);
    const kind = maakBegrotingsversie(db, {
      originType: "GEBASEERD_OP_VERSIE",
      bedrijfsnr: "070",
      begrotingsjaar: 2027,
      bronPeildatum: new Date(Date.UTC(2026, 11, 1)),
      basedOnVersionId: parent.id,
    });
    expect(kind.originType).toBe("GEBASEERD_OP_VERSIE");
    expect(kind.basedOnVersionId).toBe(parent.id);
  });

  it("8. NIEUW + non-NULL based_on_version_id wordt geweigerd (CHECK-constraint)", () => {
    const parent = maakBegrotingsversie(db, NIEUW_INPUT);
    // Raw INSERT nodig — de TypeScript-input-union laat deze combinatie al niet toe.
    expect(() =>
      db
        .prepare(
          `INSERT INTO begrotingsversies
             (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, naam, notitie, created_at, vastgesteld_at, based_on_version_id, origin_type)
           VALUES (?, '070', 2027, '2026-07-31', 'CONCEPT', NULL, NULL, ?, NULL, ?, 'NIEUW')`,
        )
        .run(randomUUID(), new Date().toISOString(), parent.id),
    ).toThrow();
  });

  it("9. GEBASEERD_OP_VERSIE + NULL based_on_version_id wordt geweigerd (CHECK-constraint)", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO begrotingsversies
             (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, naam, notitie, created_at, vastgesteld_at, based_on_version_id, origin_type)
           VALUES (?, '070', 2027, '2026-07-31', 'CONCEPT', NULL, NULL, ?, NULL, NULL, 'GEBASEERD_OP_VERSIE')`,
        )
        .run(randomUUID(), new Date().toISOString()),
    ).toThrow();
  });

  it("10. een onbestaande parent wordt geweigerd via de foreign key", () => {
    expect(() =>
      maakBegrotingsversie(db, {
        originType: "GEBASEERD_OP_VERSIE",
        bedrijfsnr: "070",
        begrotingsjaar: 2027,
        bronPeildatum: new Date(Date.UTC(2026, 6, 31)),
        basedOnVersionId: "bestaat-niet",
      }),
    ).toThrow();
  });

  it("11. zelfreferentie (based_on_version_id = id) wordt geweigerd (CHECK-constraint)", () => {
    const id = randomUUID();
    expect(() =>
      db
        .prepare(
          `INSERT INTO begrotingsversies
             (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, naam, notitie, created_at, vastgesteld_at, based_on_version_id, origin_type)
           VALUES (?, '070', 2027, '2026-07-31', 'CONCEPT', NULL, NULL, ?, NULL, ?, 'GEBASEERD_OP_VERSIE')`,
        )
        .run(id, new Date().toISOString(), id),
    ).toThrow();
  });
});

describe("write-once + immutability-triggers", () => {
  it("12. write-once-velden weigeren wijziging, ook tijdens CONCEPT", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);

    expect(() => db.prepare(`UPDATE begrotingsversies SET bedrijfsnr = '999' WHERE id = ?`).run(versie.id)).toThrow(/write-once/);
    expect(() => db.prepare(`UPDATE begrotingsversies SET bron_peildatum = '2099-01-01' WHERE id = ?`).run(versie.id)).toThrow(/write-once/);
    expect(() => db.prepare(`UPDATE begrotingsversies SET begrotingsjaar = 2099 WHERE id = ?`).run(versie.id)).toThrow(/write-once/);
    expect(() => db.prepare(`UPDATE begrotingsversies SET created_at = '2099-01-01T00:00:00.000Z' WHERE id = ?`).run(versie.id)).toThrow(
      /write-once/,
    );
    expect(() => db.prepare(`UPDATE begrotingsversies SET origin_type = 'GEBASEERD_OP_VERSIE' WHERE id = ?`).run(versie.id)).toThrow(
      /write-once/,
    );

    // Nullable write-once veld: NULL -> waarde moet ook geweigerd worden (bewijst dat de trigger `IS NOT`
    // gebruikt i.p.v. `<>`, dat NULL-transities anders zou missen).
    const parent = maakBegrotingsversie(db, NIEUW_INPUT);
    expect(() => db.prepare(`UPDATE begrotingsversies SET based_on_version_id = ? WHERE id = ?`).run(parent.id, versie.id)).toThrow(
      /write-once/,
    );

    // De versie zelf is door al deze geweigerde pogingen niet aangetast.
    const ongewijzigd = leesBegrotingsversie(db, versie.id);
    expect(ongewijzigd).toEqual(versie);
  });

  it("13. naam/notitie wijzigen tijdens CONCEPT is toegestaan (write-once-trigger blokkeert dit terecht NIET)", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);
    const bijgewerkt = wijzigConceptNaamNotitie(db, versie.id, { naam: "Budget 2027 v2", notitie: "bijgewerkt concept" });

    expect(bijgewerkt.naam).toBe("Budget 2027 v2");
    expect(bijgewerkt.notitie).toBe("bijgewerkt concept");
    // Alle write-once-velden zijn intussen ongewijzigd gebleven.
    expect(bijgewerkt.id).toBe(versie.id);
    expect(bijgewerkt.createdAt).toEqual(versie.createdAt);
    expect(bijgewerkt.bronPeildatum).toEqual(versie.bronPeildatum);
  });

  it("14. CONCEPT → VASTGESTELD is technisch toegestaan via de interne lifecycle-route (markeerVastgesteld)", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);
    expect(() => markeerVastgesteld(db, versie.id, new Date())).not.toThrow();

    const bijgewerkt = leesBegrotingsversie(db, versie.id)!;
    expect(bijgewerkt.status).toBe("VASTGESTELD");
  });

  it("15. vastgesteld_at wordt bij de CONCEPT → VASTGESTELD-overgang gezet, en niet eerder", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);
    expect(versie.vastgesteldAt).toBeNull();

    const tijdstip = new Date(Date.UTC(2027, 0, 15, 9, 0, 0));
    markeerVastgesteld(db, versie.id, tijdstip);

    const bijgewerkt = leesBegrotingsversie(db, versie.id)!;
    expect(bijgewerkt.vastgesteldAt).toEqual(tijdstip);
  });

  it("16. VASTGESTELD → CONCEPT wordt geweigerd (de VASTGESTELD-trigger vuurt op elke latere UPDATE, ook een terugzetpoging)", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => db.prepare(`UPDATE begrotingsversies SET status = 'CONCEPT' WHERE id = ?`).run(versie.id)).toThrow(/immutable/);

    const nogSteedsVastgesteld = leesBegrotingsversie(db, versie.id)!;
    expect(nogSteedsVastgesteld.status).toBe("VASTGESTELD");
  });

  it("17. naam/notitie wijzigen na VASTGESTELD wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => wijzigConceptNaamNotitie(db, versie.id, { naam: "mag niet" })).toThrow(/VASTGESTELD/);

    // Ook een rechtstreekse UPDATE (buiten de TS-functie om) wordt door de DB-trigger tegengehouden.
    expect(() => db.prepare(`UPDATE begrotingsversies SET naam = 'ook niet' WHERE id = ?`).run(versie.id)).toThrow(/immutable/);
  });

  it("18. elke andere UPDATE na VASTGESTELD wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => db.prepare(`UPDATE begrotingsversies SET notitie = 'iets anders' WHERE id = ?`).run(versie.id)).toThrow(/immutable/);
    expect(() => db.prepare(`UPDATE begrotingsversies SET vastgesteld_at = '2099-01-01T00:00:00.000Z' WHERE id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
  });

  it("19. DELETE van een VASTGESTELDE versie wordt geweigerd", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => db.prepare(`DELETE FROM begrotingsversies WHERE id = ?`).run(versie.id)).toThrow(/nooit worden verwijderd/);
    expect(leesBegrotingsversie(db, versie.id)).not.toBeNull();
  });

  it("20. verwijderConceptVersie ondersteunt DELETE van een CONCEPT-versie, expliciet getest", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);
    verwijderConceptVersie(db, versie.id);
    expect(leesBegrotingsversie(db, versie.id)).toBeNull();

    // En weigert netjes op een VASTGESTELDE versie (met een duidelijke TS-foutmelding, vóór de DB-trigger).
    const andereVersie = maakBegrotingsversie(db, NIEUW_INPUT);
    markeerVastgesteld(db, andereVersie.id, new Date());
    expect(() => verwijderConceptVersie(db, andereVersie.id)).toThrow(/VASTGESTELD/);
    expect(leesBegrotingsversie(db, andereVersie.id)).not.toBeNull();
  });
});

describe("status/vastgesteld_at CHECK-constraint (lifecycle-state-koppeling)", () => {
  it("1. CONCEPT + vastgesteld_at IS NULL is toegestaan (normale aanmaak)", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);
    expect(versie.status).toBe("CONCEPT");
    expect(versie.vastgesteldAt).toBeNull();
  });

  it("2. CONCEPT + niet-NULL vastgesteld_at wordt geweigerd (CHECK-constraint), zowel via UPDATE als via INSERT", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);

    // UPDATE: status blijft CONCEPT, alleen vastgesteld_at los vullen — raakt geen enkele trigger
    // (vastgesteld_at staat niet in de write-once-lijst, status verandert niet), moet dus uitsluitend
    // door de NIEUWE CHECK-constraint worden tegengehouden.
    expect(() => db.prepare(`UPDATE begrotingsversies SET vastgesteld_at = ? WHERE id = ?`).run(new Date().toISOString(), versie.id)).toThrow(
      /CHECK constraint failed/,
    );

    // INSERT: dezelfde ongeldige combinatie rechtstreeks aangemaakt.
    expect(() =>
      db
        .prepare(
          `INSERT INTO begrotingsversies
             (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, naam, notitie, created_at, vastgesteld_at, based_on_version_id, origin_type)
           VALUES (?, '070', 2027, '2026-07-31', 'CONCEPT', NULL, NULL, ?, ?, NULL, 'NIEUW')`,
        )
        .run(randomUUID(), new Date().toISOString(), new Date().toISOString()),
    ).toThrow(/CHECK constraint failed/);

    // De bestaande versie is door de geweigerde UPDATE-poging niet aangetast.
    expect(leesBegrotingsversie(db, versie.id)!.vastgesteldAt).toBeNull();
  });

  it("3. VASTGESTELD + NULL vastgesteld_at wordt geweigerd (CHECK-constraint) op INSERT-niveau", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO begrotingsversies
             (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, naam, notitie, created_at, vastgesteld_at, based_on_version_id, origin_type)
           VALUES (?, '070', 2027, '2026-07-31', 'VASTGESTELD', NULL, NULL, ?, NULL, NULL, 'NIEUW')`,
        )
        .run(randomUUID(), new Date().toISOString()),
    ).toThrow(/CHECK constraint failed/);
  });

  it("4. CONCEPT → VASTGESTELD met status én vastgesteld_at tegelijk gezet blijft toegestaan (markeerVastgesteld voldoet al aan de CHECK)", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);
    const tijdstip = new Date(Date.UTC(2027, 0, 15, 9, 0, 0));

    expect(() => markeerVastgesteld(db, versie.id, tijdstip)).not.toThrow();

    const bijgewerkt = leesBegrotingsversie(db, versie.id)!;
    expect(bijgewerkt.status).toBe("VASTGESTELD");
    expect(bijgewerkt.vastgesteldAt).toEqual(tijdstip);

    // Rechtstreeks op rijniveau: status en vastgesteld_at zijn in exact dezelfde, ene UPDATE gezet — een
    // hypothetische tweestaps-implementatie (eerst status, dan pas vastgesteld_at) zou al op de eerste
    // stap tegen deze CHECK-constraint zijn aangelopen, dus dit welslagen bewijst de atomiciteit impliciet.
    const ruweRij = db.prepare(`SELECT status, vastgesteld_at FROM begrotingsversies WHERE id = ?`).get(versie.id) as {
      status: string;
      vastgesteld_at: string;
    };
    expect(ruweRij.status).toBe("VASTGESTELD");
    expect(ruweRij.vastgesteld_at).toBe(tijdstip.toISOString());
  });

  it("5. na VASTGESTELD blijft iedere volgende mutatie geblokkeerd (ongewijzigd t.o.v. de bestaande triggers, nu naast de CHECK)", () => {
    const versie = maakBegrotingsversie(db, NIEUW_INPUT);
    markeerVastgesteld(db, versie.id, new Date());

    expect(() => db.prepare(`UPDATE begrotingsversies SET status = 'CONCEPT', vastgesteld_at = NULL WHERE id = ?`).run(versie.id)).toThrow(
      /immutable/,
    );
    expect(() => db.prepare(`DELETE FROM begrotingsversies WHERE id = ?`).run(versie.id)).toThrow(/nooit worden verwijderd/);
  });
});
