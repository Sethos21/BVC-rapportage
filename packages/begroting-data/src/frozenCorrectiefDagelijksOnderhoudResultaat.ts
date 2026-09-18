import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type {
  BgCorrectiefDagelijksControleErnst,
  BgCorrectiefDagelijksControleItem,
  BgCorrectiefDagelijksRegelInvoer,
  BgCorrectiefDagelijksRegelUitkomst,
  BgCorrectiefDagelijksReviewStatus,
} from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import type { CorrectiefDagelijksRegelUitkomstMetId, HerberekendCorrectiefDagelijksResultaat } from "./herberekenen.js";

/**
 * Persistence voor de bevroren Correctief/Dagelijks-Onderhoud-OUTPUT (fase
 * CD-P3, OB-028) — exact zoals `HerberekendCorrectiefDagelijksResultaat`/
 * `@bvc/reporting`'s `begroteCorrectiefDagelijksOnderhoud.ts` op HEAD die
 * kennen; zie migratie 11 in `migrations.ts` voor de volledige tabel-/
 * CHECK-motivatie. UITSLUITEND serialisatie/deserialisatie — geen formules,
 * geen totalen opnieuw afgeleid, geen aanroep van
 * `berekenBegroteCorrectiefDagelijksOnderhoud`/`herberekenBegroting`.
 *
 * Strikt gescheiden van `correctiefDagelijksOnderhoudRegels.ts`/
 * `correctiefDagelijksOnderhoudBeoordeeld.ts` (de persistente CONCEPT-
 * input): deze laag leest die tabellen NOOIT terug om een resultaat te
 * reconstrueren — elke frozen rij is zelfstandig, volledig terugleesbaar.
 *
 * CONTROL → PERSISTENTIE-ID-VERTALING: exact hetzelfde principe als
 * `frozenGeplandOnderhoudResultaat.ts`. De pure calculator se
 * `BgCorrectiefDagelijksControleItem.regelIndex` is uitsluitend geldig
 * binnen ÉÉN functie-aanroep (positionele correlatie, zie
 * `begroteCorrectiefDagelijksOnderhoud.ts`'s moduledoc). Bij het bevriezen
 * wordt dat vertaald naar het STABIELE `persistentieId` via de al-berekende
 * CD-P2-koppeling (`resultaat.regels[regelIndex].persistentieId`) — een
 * `regelIndex` die buiten het bereik van `resultaat.regels` valt is een
 * interne inconsistentie (fail-fast, geen stille `NULL`). Bij het
 * teruglezen gebeurt de omgekeerde vertaling (`regel_id → regelIndex`) via
 * dezelfde, opnieuw opgebouwde koppeling.
 *
 * `schrijfFrozenCorrectiefDagelijksOnderhoudResultaatZonderTransactie` is
 * bewust als los, transactievrij bouwblok geëxporteerd (niet via
 * `index.ts` — intern hergebruik, zelfde grens als
 * `schrijfFrozenGeplandOnderhoudResultaatZonderTransactie`) zodat
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
  totaal_jaar: string;
  beoordeeld: number;
  review_status: string;
}

interface RegelRow {
  regel_id: number;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: string;
}

interface ControlRow {
  regel_id: number | null;
  ernst: string;
  bericht: string;
}

/**
 * Schrijft het COMPLETE bevroren Correctief/Dagelijks-Onderhoud-resultaat
 * voor één begrotingsversie — vervangt, geen gedeeltelijke state. GEEN
 * eigen transactie (de aanroeper bepaalt de transactiegrens — zie
 * `schrijfFrozenCorrectiefDagelijksOnderhoudResultaat` voor de publieke, op
 * zichzelf staande variant). Faalt vóór enige schrijfactie als de parent
 * niet bestaat of geen CONCEPT is — dezelfde structurele invariant als elke
 * eerdere frozen-write-functie.
 *
 * Ontvangt een reeds berekend `HerberekendCorrectiefDagelijksResultaat` —
 * herberekent NIETS, valideert GEEN businessregels (lifecycle-validatie
 * zoals "beoordeeld moet true zijn"/"geen KRITIEK" is de verantwoordelijkheid
 * van `vaststellen.ts`, vóórdat deze functie wordt aangeroepen).
 */
export function schrijfFrozenCorrectiefDagelijksOnderhoudResultaatZonderTransactie(
  db: DatabaseSync,
  versieId: string,
  resultaat: HerberekendCorrectiefDagelijksResultaat,
): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — frozen Correctief/Dagelijks-Onderhoud-output mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  db.prepare(`DELETE FROM begroting_frozen_correctief_dagelijks_onderhoud_control WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_correctief_dagelijks_onderhoud_regel WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_correctief_dagelijks_onderhoud_resultaat WHERE begroting_versie_id = ?`).run(versieId);

  db.prepare(
    `INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_resultaat
       (begroting_versie_id, totaal_jaar, beoordeeld, review_status)
     VALUES (?, ?, ?, ?)`,
  ).run(versieId, resultaat.totaalJaar.toString(), resultaat.beoordeeld ? 1 : 0, resultaat.reviewStatus);

  const insertRegel = db.prepare(
    `INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_regel
       (begroting_versie_id, regel_id, omschrijving, complexnummer, jaarbedrag)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const { persistentieId, regel } of resultaat.regels) {
    const invoer = regel.invoer;
    insertRegel.run(versieId, persistentieId, invoer.omschrijving, invoer.complexnummer, regel.jaarbedrag.toString());
  }

  const insertControl = db.prepare(
    `INSERT INTO begroting_frozen_correctief_dagelijks_onderhoud_control (begroting_versie_id, volgnr, regel_id, ernst, bericht) VALUES (?, ?, ?, ?, ?)`,
  );
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
 * `schrijfFrozenCorrectiefDagelijksOnderhoudResultaatZonderTransactie`, maar
 * binnen haar eigen complete `BEGIN`…`COMMIT`/`ROLLBACK`-transactie — voor
 * aanroepers die frozen Correctief/Dagelijks-Onderhoud-output als
 * losstaande operatie willen schrijven (bv. tijdens CONCEPT, ter
 * voorbereiding/test).
 */
export function schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(
  db: DatabaseSync,
  versieId: string,
  resultaat: HerberekendCorrectiefDagelijksResultaat,
): void {
  withTransaction(db, () => schrijfFrozenCorrectiefDagelijksOnderhoudResultaatZonderTransactie(db, versieId, resultaat));
}

/**
 * Leest het bevroren Correctief/Dagelijks-Onderhoud-resultaat voor een
 * begrotingsversie. `null` als er (nog) geen frozen output is — nooit een
 * default/leeg resultaat en nooit `Decimal(0)` in plaats van "ontbrekend".
 *
 * `regel.index`/`invoer` worden hier gereconstrueerd op basis van de
 * bevroren rij zelf — ÉÉN `jaarbedrag`-veld volstaat (zie migratie 11's
 * moduledoc: ingevoerde en berekende bedragen zijn bij een succesvol
 * bevroren regel altijd al gelijk, want een `null`/NaN-jaarbedrag zou al
 * een KRITIEK-control en dus een vaststel-blokkade hebben veroorzaakt).
 * `index` op de gereconstrueerde `BgCorrectiefDagelijksRegelUitkomst` heeft,
 * net als in de pure module, geen businessbetekenis — hier simpelweg de
 * leespositie.
 */
export function leesFrozenCorrectiefDagelijksOnderhoudResultaat(db: DatabaseSync, versieId: string): HerberekendCorrectiefDagelijksResultaat | null {
  const header = db
    .prepare(`SELECT * FROM begroting_frozen_correctief_dagelijks_onderhoud_resultaat WHERE begroting_versie_id = ?`)
    .get(versieId) as unknown as ResultaatRow | undefined;
  if (header === undefined) {
    return null;
  }

  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(
      `Begrotingsversie ${versieId}: frozen Correctief/Dagelijks-Onderhoud-output bestaat, maar de versie zelf is niet leesbaar (interne inconsistentie).`,
    );
  }

  const regelRijen = db
    .prepare(
      `SELECT regel_id, omschrijving, complexnummer, jaarbedrag
       FROM begroting_frozen_correctief_dagelijks_onderhoud_regel
       WHERE begroting_versie_id = ?
       ORDER BY regel_id`,
    )
    .all(versieId) as unknown as RegelRow[];

  const regels: CorrectiefDagelijksRegelUitkomstMetId[] = regelRijen.map((rij, index) => {
    const invoer: BgCorrectiefDagelijksRegelInvoer = {
      omschrijving: rij.omschrijving,
      complexnummer: rij.complexnummer,
      jaarbedrag: new Decimal(rij.jaarbedrag),
    };
    const regel: BgCorrectiefDagelijksRegelUitkomst = {
      index,
      invoer,
      jaarbedrag: new Decimal(rij.jaarbedrag),
    };
    return { persistentieId: rij.regel_id, regel };
  });
  const indexPerPersistentieId = new Map(regels.map((r, index) => [r.persistentieId, index]));

  const controlRijen = db
    .prepare(`SELECT regel_id, ernst, bericht FROM begroting_frozen_correctief_dagelijks_onderhoud_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
    .all(versieId) as unknown as ControlRow[];
  const controleVereist: BgCorrectiefDagelijksControleItem[] = controlRijen.map((rij) => {
    let regelIndex: number | null = null;
    if (rij.regel_id !== null) {
      const gevonden = indexPerPersistentieId.get(rij.regel_id);
      if (gevonden === undefined) {
        throw new Error(
          `Interne fout: begrotingsversie ${versieId}: frozen control verwijst naar regel_id ${rij.regel_id}, die niet voorkomt in de frozen regels — inconsistente frozen data.`,
        );
      }
      regelIndex = gevonden;
    }
    return { regelIndex, ernst: rij.ernst as BgCorrectiefDagelijksControleErnst, bericht: rij.bericht };
  });

  return {
    begrotingsjaar: versie.begrotingsjaar,
    beoordeeld: header.beoordeeld === 1,
    reviewStatus: header.review_status as BgCorrectiefDagelijksReviewStatus,
    regels,
    totaalJaar: new Decimal(header.totaal_jaar),
    controleVereist,
  };
}
