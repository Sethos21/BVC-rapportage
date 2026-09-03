import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type BegrotingsversieStatus = "CONCEPT" | "VASTGESTELD";
export type BegrotingsversieOriginType = "NIEUW" | "GEBASEERD_OP_VERSIE";

export interface Begrotingsversie {
  id: string;
  bedrijfsnr: string;
  begrotingsjaar: number;
  /** Bevroren bronmoment — kale kalenderdag, UTC-genormaliseerd (zie `parseBusinessDate`). Write-once. */
  bronPeildatum: Date;
  status: BegrotingsversieStatus;
  naam: string | null;
  notitie: string | null;
  createdAt: Date;
  vastgesteldAt: Date | null;
  basedOnVersionId: string | null;
  originType: BegrotingsversieOriginType;
}

/**
 * Discriminated union — maakt de lineage-invariant (NIEUW ⇔ geen
 * based_on_version_id, GEBASEERD_OP_VERSIE ⇔ wél) al op TypeScript-niveau
 * onmogelijk om verkeerd te construeren, als aanvulling op (niet ter
 * vervanging van) de CHECK-constraint in migratie 2.
 */
export type NieuweBegrotingsversieInput =
  | {
      originType: "NIEUW";
      bedrijfsnr: string;
      begrotingsjaar: number;
      bronPeildatum: Date;
      naam?: string | null;
      notitie?: string | null;
    }
  | {
      originType: "GEBASEERD_OP_VERSIE";
      bedrijfsnr: string;
      begrotingsjaar: number;
      bronPeildatum: Date;
      basedOnVersionId: string;
      naam?: string | null;
      notitie?: string | null;
    };

interface BegrotingsversieRow {
  id: string;
  bedrijfsnr: string;
  begrotingsjaar: number;
  bron_peildatum: string;
  status: string;
  naam: string | null;
  notitie: string | null;
  created_at: string;
  vastgesteld_at: string | null;
  based_on_version_id: string | null;
  origin_type: string;
}

/**
 * Businessdatum (`bron_peildatum`) → kale `YYYY-MM-DD`, UTC-kalenderdag van
 * `date` — expliciet via de UTC-getters (niet `toISOString().slice(0,10)`
 * los toegepast op een willekeurige `Date`), zodat de opgeslagen dag altijd
 * de UTC-kalenderdag is, ongeacht een eventuele tijdstip-component. Zelfde
 * conventie als `@bvc/reporting`'s Module 1 (`naarKalenderDag`).
 */
function formatBusinessDate(date: Date): string {
  const jaar = date.getUTCFullYear().toString().padStart(4, "0");
  const maand = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dag = date.getUTCDate().toString().padStart(2, "0");
  return `${jaar}-${maand}-${dag}`;
}

/** Kale `YYYY-MM-DD` → `Date` op UTC-middernacht van diezelfde kalenderdag — de exacte inverse van `formatBusinessDate`. */
function parseBusinessDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`Ongeldige businessdatum uit persistence: "${value}" (verwacht YYYY-MM-DD).`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function rowToBegrotingsversie(row: BegrotingsversieRow): Begrotingsversie {
  return {
    id: row.id,
    bedrijfsnr: row.bedrijfsnr,
    begrotingsjaar: row.begrotingsjaar,
    bronPeildatum: parseBusinessDate(row.bron_peildatum),
    status: row.status as BegrotingsversieStatus,
    naam: row.naam,
    notitie: row.notitie,
    createdAt: new Date(row.created_at),
    vastgesteldAt: row.vastgesteld_at !== null ? new Date(row.vastgesteld_at) : null,
    basedOnVersionId: row.based_on_version_id,
    originType: row.origin_type as BegrotingsversieOriginType,
  };
}

/** Maakt een nieuwe CONCEPT-begrotingsversie aan. `id`/`createdAt` worden hier bepaald (niet door de aanroeper). */
export function maakBegrotingsversie(db: DatabaseSync, input: NieuweBegrotingsversieInput): Begrotingsversie {
  const id = randomUUID();
  const createdAt = new Date();
  const basedOnVersionId = input.originType === "GEBASEERD_OP_VERSIE" ? input.basedOnVersionId : null;

  db.prepare(
    `INSERT INTO begrotingsversies
       (id, bedrijfsnr, begrotingsjaar, bron_peildatum, status, naam, notitie, created_at, vastgesteld_at, based_on_version_id, origin_type)
     VALUES (?, ?, ?, ?, 'CONCEPT', ?, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    input.bedrijfsnr,
    input.begrotingsjaar,
    formatBusinessDate(input.bronPeildatum),
    input.naam ?? null,
    input.notitie ?? null,
    createdAt.toISOString(),
    basedOnVersionId,
    input.originType,
  );

  const aangemaakt = leesBegrotingsversie(db, id);
  if (aangemaakt === null) {
    throw new Error(`Interne fout: begrotingsversie ${id} kon direct na aanmaak niet worden teruggelezen.`);
  }
  return aangemaakt;
}

/** Leest één begrotingsversie op id. `null` als hij niet bestaat. */
export function leesBegrotingsversie(db: DatabaseSync, id: string): Begrotingsversie | null {
  const row = db.prepare(`SELECT * FROM begrotingsversies WHERE id = ?`).get(id) as BegrotingsversieRow | undefined;
  return row !== undefined ? rowToBegrotingsversie(row) : null;
}

/**
 * Wijzigt `naam`/`notitie` van een CONCEPT-versie (beide optioneel — alleen
 * de meegegeven velden worden aangepast). Gooit een duidelijke fout als de
 * versie niet bestaat of al VASTGESTELD is — de DB-trigger blokkeert dat
 * laatste sowieso al, deze check bestaat uitsluitend voor een duidelijkere
 * foutmelding vóórdat er een statement wordt uitgevoerd.
 */
export function wijzigConceptNaamNotitie(
  db: DatabaseSync,
  id: string,
  wijziging: { naam?: string | null; notitie?: string | null },
): Begrotingsversie {
  const bestaande = leesBegrotingsversie(db, id);
  if (bestaande === null) {
    throw new Error(`Begrotingsversie ${id} bestaat niet.`);
  }
  if (bestaande.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${id} heeft status ${bestaande.status} — naam/notitie zijn uitsluitend wijzigbaar tijdens CONCEPT.`);
  }

  const naam = wijziging.naam !== undefined ? wijziging.naam : bestaande.naam;
  const notitie = wijziging.notitie !== undefined ? wijziging.notitie : bestaande.notitie;
  db.prepare(`UPDATE begrotingsversies SET naam = ?, notitie = ? WHERE id = ?`).run(naam, notitie, id);

  const bijgewerkt = leesBegrotingsversie(db, id);
  if (bijgewerkt === null) {
    throw new Error(`Interne fout: begrotingsversie ${id} kon direct na wijziging niet worden teruggelezen.`);
  }
  return bijgewerkt;
}

/** Verwijdert een CONCEPT-versie. Gooit een duidelijke fout bij een onbestaande of VASTGESTELDE versie (DB-trigger blokkeert dat laatste sowieso). */
export function verwijderConceptVersie(db: DatabaseSync, id: string): void {
  const bestaande = leesBegrotingsversie(db, id);
  if (bestaande === null) {
    throw new Error(`Begrotingsversie ${id} bestaat niet.`);
  }
  if (bestaande.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${id} heeft status ${bestaande.status} — uitsluitend een CONCEPT-versie mag worden verwijderd.`);
  }
  db.prepare(`DELETE FROM begrotingsversies WHERE id = ?`).run(id);
}

/**
 * Interne lifecycle-primitief: zet een CONCEPT-versie om naar VASTGESTELD.
 *
 * BEWUST GEEN publieke, op zichzelf staande "vaststellen()"-businessoperatie
 * en BEWUST NIET geëxporteerd via `index.ts` — dat zou een tweede, parallelle
 * vaststelflow creëren naast de échte VASTSTELLEN-transactie (Fase 1D.6),
 * die Module 1/2 berekent, frozen output wegschrijft, ÉN deze statusovergang
 * uitvoert, alles in één atomaire transactie. Deze functie is uitsluitend
 * het herbruikbare bouwblok dat 1D.6 straks bínnen die transactie zal
 * aanroepen. Hij is nu al nodig en getest omdat de DB-invariant "een
 * VASTGESTELDE versie is immutable" al in deze fase bewijsbaar moet zijn.
 *
 * Draait zelf GEEN eigen transactie — dat is de verantwoordelijkheid van de
 * aanroeper (in 1D.6: dezelfde transactie als de frozen-output-writes).
 */
export function markeerVastgesteld(db: DatabaseSync, id: string, vastgesteldAt: Date): void {
  const resultaat = db
    .prepare(`UPDATE begrotingsversies SET status = 'VASTGESTELD', vastgesteld_at = ? WHERE id = ? AND status = 'CONCEPT'`)
    .run(vastgesteldAt.toISOString(), id);
  if (Number(resultaat.changes) === 0) {
    throw new Error(`Begrotingsversie ${id} kon niet naar VASTGESTELD worden gezet — bestaat niet, of is al VASTGESTELD.`);
  }
}
