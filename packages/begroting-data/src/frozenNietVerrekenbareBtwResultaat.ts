import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgControleErnst, BgNietVerrekenbareBtwControleItem, BgNietVerrekenbareBtwRegelInvoer, BgNietVerrekenbareBtwRegelUitkomst, BgNietVerrekenbareBtwReviewStatus } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import type { HerberekendNietVerrekenbareBtwResultaat, NietVerrekenbareBtwRegelUitkomstMetId } from "./herberekenen.js";

/**
 * Persistence voor de bevroren Niet-Verrekenbare-BTW-OUTPUT (Vervolgtranche 9 Deel B, Master
 * Contract) — exact zoals `HerberekendNietVerrekenbareBtwResultaat`/`@bvc/reporting`'s
 * `begroteNietVerrekenbareBtw.ts` op HEAD die kennen; zie migratie 38 in `migrations.ts`.
 * UITSLUITEND serialisatie/deserialisatie — geen formules, geen totalen opnieuw afgeleid, geen
 * aanroep van `berekenBegroteNietVerrekenbareBtw`/`herberekenBegroting`.
 *
 * UITSLUITEND DE BEGROTING WORDT BEVROREN — zelfde architectuurregel als `frozenGeplandeVerkoop
 * Resultaat.ts`: Werkelijk blijft per ontwerp altijd een live herberekening/actuele stand, ook ná
 * vaststellen. Estimated bestaat voor deze module niet (STOP: BUSINESSBESLISSING). GEEN frozen-
 * classificatietabel: een Niet-Verrekenbare-BTW-Begrotingsregel heeft geen OGB-koppeling.
 *
 * `schrijfFrozenNietVerrekenbareBtwResultaatZonderTransactie` is bewust als los, transactievrij
 * bouwblok geëxporteerd (niet via `index.ts`) zodat `stelBegrotingVast` (`vaststellen.ts`) dezelfde
 * schrijflogica kan hergebruiken binnen haar eigen, grotere `BEGIN IMMEDIATE`-transactie.
 */

function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const resultaat = fn();
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// ===== Rijtypen =====

interface ResultaatRow {
  beoordeeld: number;
  review_status: BgNietVerrekenbareBtwReviewStatus;
  module_totaal: string;
  vorig_jaar_werkelijk: string | null;
}

interface RegelRow {
  regel_id: number;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: string | null;
  financiele_bijdrage: string;
}

interface ControlRow {
  regel_id: number | null;
  ernst: string;
  bericht: string;
}

/**
 * Schrijft het COMPLETE bevroren Niet-Verrekenbare-BTW-resultaat voor één begrotingsversie —
 * vervangt, geen gedeeltelijke state. GEEN eigen transactie (de aanroeper bepaalt de
 * transactiegrens — zie `schrijfFrozenNietVerrekenbareBtwResultaat` voor de publieke, op zichzelf
 * staande variant). Faalt vóór enige schrijfactie als de parent niet bestaat of geen CONCEPT is.
 */
export function schrijfFrozenNietVerrekenbareBtwResultaatZonderTransactie(db: DatabaseSync, versieId: string, resultaat: HerberekendNietVerrekenbareBtwResultaat): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — frozen Niet-Verrekenbare-BTW-output mag uitsluitend op een CONCEPT-versie worden geschreven.`);
  }

  db.prepare(`DELETE FROM begroting_frozen_niet_verrekenbare_btw_control WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_niet_verrekenbare_btw_regel WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_niet_verrekenbare_btw_resultaat WHERE begroting_versie_id = ?`).run(versieId);

  db.prepare(`INSERT INTO begroting_frozen_niet_verrekenbare_btw_resultaat (begroting_versie_id, beoordeeld, review_status, module_totaal, vorig_jaar_werkelijk) VALUES (?, ?, ?, ?, ?)`).run(
    versieId,
    resultaat.beoordeeld ? 1 : 0,
    resultaat.reviewStatus,
    resultaat.moduleTotaal.toString(),
    resultaat.vorigJaarWerkelijk !== null ? resultaat.vorigJaarWerkelijk.toString() : null,
  );

  const insertRegel = db.prepare(
    `INSERT INTO begroting_frozen_niet_verrekenbare_btw_regel (begroting_versie_id, regel_id, omschrijving, complexnummer, jaarbedrag, financiele_bijdrage) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const { persistentieId, regel } of resultaat.regels) {
    const invoer = regel.invoer;
    insertRegel.run(versieId, persistentieId, invoer.omschrijving, invoer.complexnummer, invoer.jaarbedrag !== null ? invoer.jaarbedrag.toString() : null, regel.jaarbedrag.toString());
  }

  const insertControl = db.prepare(`INSERT INTO begroting_frozen_niet_verrekenbare_btw_control (begroting_versie_id, volgnr, regel_id, ernst, bericht) VALUES (?, ?, ?, ?, ?)`);
  resultaat.controleVereist.forEach((control, volgnr) => {
    let regelId: number | null = null;
    if (control.regelIndex !== null) {
      const gekoppeld = resultaat.regels[control.regelIndex];
      if (gekoppeld === undefined) {
        throw new Error(
          `Interne fout: begrotingsversie ${versieId}: control verwijst naar regelIndex ${control.regelIndex}, buiten bereik van ${resultaat.regels.length} regels — correlatie geschonden.`,
        );
      }
      regelId = gekoppeld.persistentieId;
    }
    insertControl.run(versieId, volgnr, regelId, control.ernst, control.bericht);
  });
}

/**
 * Publieke, op zichzelf staande variant: exact
 * `schrijfFrozenNietVerrekenbareBtwResultaatZonderTransactie`, maar binnen haar eigen complete
 * `BEGIN`…`COMMIT`/`ROLLBACK`-transactie.
 */
export function schrijfFrozenNietVerrekenbareBtwResultaat(db: DatabaseSync, versieId: string, resultaat: HerberekendNietVerrekenbareBtwResultaat): void {
  withTransaction(db, () => schrijfFrozenNietVerrekenbareBtwResultaatZonderTransactie(db, versieId, resultaat));
}

/**
 * Leest het bevroren Niet-Verrekenbare-BTW-resultaat voor een begrotingsversie. `null` als er (nog)
 * geen frozen output is — nooit een default/leeg resultaat.
 *
 * EXISTENTIE-CHECK VIA DE RESULTAAT-TABEL: een succesvol bevroren resultaat heeft ALTIJD precies 1
 * rij in `begroting_frozen_niet_verrekenbare_btw_resultaat` (PRIMARY KEY = `begroting_versie_id`,
 * zie migratie 38).
 */
export function leesFrozenNietVerrekenbareBtwResultaat(db: DatabaseSync, versieId: string): HerberekendNietVerrekenbareBtwResultaat | null {
  const header = db.prepare(`SELECT beoordeeld, review_status, module_totaal, vorig_jaar_werkelijk FROM begroting_frozen_niet_verrekenbare_btw_resultaat WHERE begroting_versie_id = ?`).get(
    versieId,
  ) as unknown as ResultaatRow | undefined;
  if (header === undefined) {
    return null;
  }

  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId}: frozen Niet-Verrekenbare-BTW-output bestaat, maar de versie zelf is niet leesbaar (interne inconsistentie).`);
  }

  const regelRijen = db
    .prepare(`SELECT regel_id, omschrijving, complexnummer, jaarbedrag, financiele_bijdrage FROM begroting_frozen_niet_verrekenbare_btw_regel WHERE begroting_versie_id = ? ORDER BY regel_id`)
    .all(versieId) as unknown as RegelRow[];

  const regels: NietVerrekenbareBtwRegelUitkomstMetId[] = regelRijen.map((rij, index) => {
    const invoer: BgNietVerrekenbareBtwRegelInvoer = { omschrijving: rij.omschrijving, complexnummer: rij.complexnummer, jaarbedrag: rij.jaarbedrag !== null ? new Decimal(rij.jaarbedrag) : null };
    const regel: BgNietVerrekenbareBtwRegelUitkomst = { index, invoer, jaarbedrag: new Decimal(rij.financiele_bijdrage) };
    return { persistentieId: rij.regel_id, regel };
  });
  const indexPerPersistentieId = new Map(regels.map((r, index) => [r.persistentieId, index]));

  const controlRijen = db
    .prepare(`SELECT regel_id, ernst, bericht FROM begroting_frozen_niet_verrekenbare_btw_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
    .all(versieId) as unknown as ControlRow[];
  const controleVereist: BgNietVerrekenbareBtwControleItem[] = controlRijen.map((rij) => {
    let regelIndex: number | null = null;
    if (rij.regel_id !== null) {
      const gevonden = indexPerPersistentieId.get(rij.regel_id);
      if (gevonden === undefined) {
        throw new Error(`Interne fout: begrotingsversie ${versieId}: frozen control verwijst naar regel_id ${rij.regel_id}, die niet voorkomt in de frozen regels — inconsistente frozen data.`);
      }
      regelIndex = gevonden;
    }
    return { regelIndex, ernst: rij.ernst as BgControleErnst, bericht: rij.bericht };
  });

  return {
    begrotingsjaar: versie.begrotingsjaar,
    beoordeeld: header.beoordeeld === 1,
    reviewStatus: header.review_status,
    regels,
    moduleTotaal: new Decimal(header.module_totaal),
    vorigJaarWerkelijk: header.vorig_jaar_werkelijk !== null ? new Decimal(header.vorig_jaar_werkelijk) : null,
    controleVereist,
  };
}
