import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgGeplandeVerkoopControleErnst, BgGeplandeVerkoopControleItem, BgGeplandeVerkoopRegelInvoer, BgGeplandeVerkoopRegelUitkomst, BgGeplandeVerkoopReviewStatus } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import type { GeplandeVerkoopRegelUitkomstMetId, HerberekendGeplandeVerkoopResultaat } from "./herberekenen.js";

/**
 * Persistence voor de bevroren Geplande-Verkoop-OUTPUT (OB-039, fase P3) —
 * exact zoals `HerberekendGeplandeVerkoopResultaat`/`@bvc/reporting`'s
 * `begroteGeplandeVerkoop.ts` op HEAD die kennen; zie migratie 23 in
 * `migrations.ts`. UITSLUITEND serialisatie/deserialisatie — geen formules,
 * geen totalen opnieuw afgeleid, geen aanroep van
 * `berekenBegroteGeplandeVerkoop`/`herberekenBegroting`.
 *
 * UITSLUITEND DE BEGROTING WORDT BEVROREN — zelfde architectuurregel als
 * `frozenRenteResultaat.ts`/`frozenCorrectiefDagelijksOnderhoudResultaat.ts`:
 * Werkelijk/Estimated blijven per ontwerp ALTIJD een live
 * herberekening/actuele stand, ook ná vaststellen. GEEN frozen-
 * classificatietabel: een Geplande-Verkoop-Begrotingsregel heeft geen
 * OGB-koppeling (zie migratie 22) — `objectreferentie` is een puur vrij
 * tekstveld, geen classificatie, dus wordt het gewoon ALS TYPED bevroren,
 * zonder enige lookup.
 *
 * GEEN GEDENORMALISEERD TOTAAL: er bestaat geen enkele afgeleide
 * "totaal"-waarde op `BgGeplandeVerkoopResultaat` (zie die moduledoc —
 * schijnzekerheid voorkomen) om te bevriezen of per ongeluk opnieuw te
 * berekenen.
 *
 * Strikt gescheiden van `geplandeVerkoopBeoordeeld.ts`/
 * `geplandeVerkoopRegels.ts` (de persistente CONCEPT-input) EN van
 * `geplandeVerkoopEstimatedRegels.ts` (de nooit-bevroren Estimated-input):
 * deze laag leest die tabellen NOOIT terug om een resultaat te
 * reconstrueren.
 *
 * `schrijfFrozenGeplandeVerkoopResultaatZonderTransactie` is bewust als los,
 * transactievrij bouwblok geëxporteerd (niet via `index.ts`) zodat
 * `stelBegrotingVast` (`vaststellen.ts`) dezelfde schrijflogica kan
 * hergebruiken binnen haar eigen, grotere `BEGIN IMMEDIATE`-transactie.
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
  review_status: BgGeplandeVerkoopReviewStatus;
}

interface RegelRow {
  regel_id: number;
  objectreferentie: string;
  omschrijving: string;
  geplande_verkoopdatum: string | null;
  verwachte_verkoopopbrengst: string | null;
  verwachte_boekwaarde: string | null;
  verwachte_verkoopkosten: string | null;
  verwachte_einddatum_huur_exploitatie: string | null;
  toelichting: string | null;
  verwacht_verkoopresultaat: string | null;
}

interface ControlRow {
  regel_id: number | null;
  ernst: string;
  bericht: string;
}

/**
 * Schrijft het COMPLETE bevroren Geplande-Verkoop-resultaat voor één
 * begrotingsversie — vervangt, geen gedeeltelijke state. GEEN eigen
 * transactie (de aanroeper bepaalt de transactiegrens — zie
 * `schrijfFrozenGeplandeVerkoopResultaat` voor de publieke, op zichzelf
 * staande variant). Faalt vóór enige schrijfactie als de parent niet
 * bestaat of geen CONCEPT is.
 *
 * Ontvangt een reeds berekend `HerberekendGeplandeVerkoopResultaat` —
 * herberekent NIETS, valideert GEEN businessregels (lifecycle-validatie
 * zoals "beoordeeld=true"/"geen KRITIEK" is de verantwoordelijkheid van
 * `vaststellen.ts`, vóórdat deze functie wordt aangeroepen).
 */
export function schrijfFrozenGeplandeVerkoopResultaatZonderTransactie(db: DatabaseSync, versieId: string, resultaat: HerberekendGeplandeVerkoopResultaat): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — frozen Geplande-Verkoop-output mag uitsluitend op een CONCEPT-versie worden geschreven.`);
  }

  db.prepare(`DELETE FROM begroting_frozen_geplande_verkoop_control WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_geplande_verkoop_regel WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_geplande_verkoop_resultaat WHERE begroting_versie_id = ?`).run(versieId);

  db.prepare(`INSERT INTO begroting_frozen_geplande_verkoop_resultaat (begroting_versie_id, beoordeeld, review_status) VALUES (?, ?, ?)`).run(
    versieId,
    resultaat.beoordeeld ? 1 : 0,
    resultaat.reviewStatus,
  );

  const insertRegel = db.prepare(
    `INSERT INTO begroting_frozen_geplande_verkoop_regel
       (begroting_versie_id, regel_id, objectreferentie, omschrijving, geplande_verkoopdatum, verwachte_verkoopopbrengst, verwachte_boekwaarde, verwachte_verkoopkosten, verwachte_einddatum_huur_exploitatie, toelichting, verwacht_verkoopresultaat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const { persistentieId, regel } of resultaat.regels) {
    const invoer = regel.invoer;
    insertRegel.run(
      versieId,
      persistentieId,
      invoer.objectreferentie,
      invoer.omschrijving,
      invoer.geplandeVerkoopdatum !== null ? invoer.geplandeVerkoopdatum.toISOString() : null,
      invoer.verwachteVerkoopopbrengst !== null ? invoer.verwachteVerkoopopbrengst.toString() : null,
      invoer.verwachteBoekwaarde !== null ? invoer.verwachteBoekwaarde.toString() : null,
      invoer.verwachteVerkoopkosten !== null ? invoer.verwachteVerkoopkosten.toString() : null,
      invoer.verwachteEinddatumHuurExploitatie !== null ? invoer.verwachteEinddatumHuurExploitatie.toISOString() : null,
      invoer.toelichting,
      regel.verwachtVerkoopresultaat !== null ? regel.verwachtVerkoopresultaat.toString() : null,
    );
  }

  const insertControl = db.prepare(`INSERT INTO begroting_frozen_geplande_verkoop_control (begroting_versie_id, volgnr, regel_id, ernst, bericht) VALUES (?, ?, ?, ?, ?)`);
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
 * `schrijfFrozenGeplandeVerkoopResultaatZonderTransactie`, maar binnen haar
 * eigen complete `BEGIN`…`COMMIT`/`ROLLBACK`-transactie.
 */
export function schrijfFrozenGeplandeVerkoopResultaat(db: DatabaseSync, versieId: string, resultaat: HerberekendGeplandeVerkoopResultaat): void {
  withTransaction(db, () => schrijfFrozenGeplandeVerkoopResultaatZonderTransactie(db, versieId, resultaat));
}

/**
 * Leest het bevroren Geplande-Verkoop-resultaat voor een begrotingsversie.
 * `null` als er (nog) geen frozen output is — nooit een default/leeg
 * resultaat.
 *
 * EXISTENTIE-CHECK VIA DE RESULTAAT-TABEL: een succesvol bevroren resultaat
 * heeft ALTIJD precies 1 rij in `begroting_frozen_geplande_verkoop_resultaat`
 * (PRIMARY KEY = `begroting_versie_id`, zie migratie 23).
 */
export function leesFrozenGeplandeVerkoopResultaat(db: DatabaseSync, versieId: string): HerberekendGeplandeVerkoopResultaat | null {
  const header = db.prepare(`SELECT beoordeeld, review_status FROM begroting_frozen_geplande_verkoop_resultaat WHERE begroting_versie_id = ?`).get(versieId) as unknown as
    | ResultaatRow
    | undefined;
  if (header === undefined) {
    return null;
  }

  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId}: frozen Geplande-Verkoop-output bestaat, maar de versie zelf is niet leesbaar (interne inconsistentie).`);
  }

  const regelRijen = db
    .prepare(
      `SELECT regel_id, objectreferentie, omschrijving, geplande_verkoopdatum, verwachte_verkoopopbrengst, verwachte_boekwaarde, verwachte_verkoopkosten, verwachte_einddatum_huur_exploitatie, toelichting, verwacht_verkoopresultaat
       FROM begroting_frozen_geplande_verkoop_regel
       WHERE begroting_versie_id = ?
       ORDER BY regel_id`,
    )
    .all(versieId) as unknown as RegelRow[];

  const regels: GeplandeVerkoopRegelUitkomstMetId[] = regelRijen.map((rij, index) => {
    const invoer: BgGeplandeVerkoopRegelInvoer = {
      objectreferentie: rij.objectreferentie,
      omschrijving: rij.omschrijving,
      geplandeVerkoopdatum: rij.geplande_verkoopdatum !== null ? new Date(rij.geplande_verkoopdatum) : null,
      verwachteVerkoopopbrengst: rij.verwachte_verkoopopbrengst !== null ? new Decimal(rij.verwachte_verkoopopbrengst) : null,
      verwachteBoekwaarde: rij.verwachte_boekwaarde !== null ? new Decimal(rij.verwachte_boekwaarde) : null,
      verwachteVerkoopkosten: rij.verwachte_verkoopkosten !== null ? new Decimal(rij.verwachte_verkoopkosten) : null,
      verwachteEinddatumHuurExploitatie: rij.verwachte_einddatum_huur_exploitatie !== null ? new Date(rij.verwachte_einddatum_huur_exploitatie) : null,
      toelichting: rij.toelichting,
    };
    const regel: BgGeplandeVerkoopRegelUitkomst = {
      index,
      invoer,
      verwachtVerkoopresultaat: rij.verwacht_verkoopresultaat !== null ? new Decimal(rij.verwacht_verkoopresultaat) : null,
    };
    return { persistentieId: rij.regel_id, regel };
  });
  const indexPerPersistentieId = new Map(regels.map((r, index) => [r.persistentieId, index]));

  const controlRijen = db
    .prepare(`SELECT regel_id, ernst, bericht FROM begroting_frozen_geplande_verkoop_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
    .all(versieId) as unknown as ControlRow[];
  const controleVereist: BgGeplandeVerkoopControleItem[] = controlRijen.map((rij) => {
    let regelIndex: number | null = null;
    if (rij.regel_id !== null) {
      const gevonden = indexPerPersistentieId.get(rij.regel_id);
      if (gevonden === undefined) {
        throw new Error(`Interne fout: begrotingsversie ${versieId}: frozen control verwijst naar regel_id ${rij.regel_id}, die niet voorkomt in de frozen regels — inconsistente frozen data.`);
      }
      regelIndex = gevonden;
    }
    return { regelIndex, ernst: rij.ernst as BgGeplandeVerkoopControleErnst, bericht: rij.bericht };
  });

  return {
    begrotingsjaar: versie.begrotingsjaar,
    beoordeeld: header.beoordeeld === 1,
    reviewStatus: header.review_status,
    regels,
    controleVereist,
  };
}
