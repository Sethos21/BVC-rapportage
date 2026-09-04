import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type {
  BgGeplandOnderhoudAanleidingType,
  BgGeplandOnderhoudActiviteitInvoer,
  BgGeplandOnderhoudActiviteitUitkomst,
  BgGeplandOnderhoudComplexTotaal,
  BgGeplandOnderhoudControleErnst,
  BgGeplandOnderhoudControleItem,
  BgGeplandOnderhoudReviewStatus,
  BgGeplandOnderhoudStatus,
} from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import type { GeplandOnderhoudActiviteitUitkomstMetId, HerberekendGeplandOnderhoudResultaat } from "./herberekenen.js";

/**
 * Persistence voor de bevroren Gepland-Onderhoud-OUTPUT (fase GO-P3, exact
 * zoals `HerberekendGeplandOnderhoudResultaat`/`@bvc/reporting`'s
 * `begroteGeplandOnderhoud.ts` op HEAD die kennen — zie migratie 9 in
 * `migrations.ts` voor de volledige tabel-/CHECK-motivatie). UITSLUITEND
 * serialisatie/deserialisatie — geen formules, geen totalen opnieuw
 * afgeleid, geen aanroep van `berekenBegroteGeplandOnderhoud`/
 * `herberekenBegroting`.
 *
 * Strikt gescheiden van `geplandOnderhoudActiviteiten.ts`/
 * `geplandOnderhoudBeoordeeld.ts` (de persistente CONCEPT-input): deze laag
 * leest die tabellen NOOIT terug om een resultaat te reconstrueren — elke
 * frozen rij is zelfstandig, volledig terugleesbaar.
 *
 * CONTROL → PERSISTENTIE-ID-VERTALING: de pure calculator se
 * `BgGeplandOnderhoudControleItem.activiteitIndex` is uitsluitend geldig
 * binnen ÉÉN functie-aanroep (positionele correlatie, zie
 * `begroteGeplandOnderhoud.ts`'s moduledoc). Bij het bevriezen wordt dat
 * vertaald naar het STABIELE `persistentieId` via de al-berekende GO-P2-
 * koppeling (`resultaat.activiteiten[activiteitIndex].persistentieId`) — een
 * `activiteitIndex` die buiten het bereik van `resultaat.activiteiten` valt
 * is een interne inconsistentie (fail-fast, geen stille `NULL`). Bij het
 * teruglezen gebeurt de omgekeerde vertaling (`activiteit_id →
 * activiteitIndex`) via dezelfde, opnieuw opgebouwde koppeling.
 *
 * `schrijfFrozenGeplandOnderhoudResultaatZonderTransactie` is bewust als los,
 * transactievrij bouwblok geëxporteerd (niet via `index.ts` — intern
 * hergebruik, zelfde grens als `schrijfFrozenModule3ResultaatZonderTransactie`)
 * zodat `stelBegrotingVast` (`vaststellen.ts`) dezelfde schrijflogica kan
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
  totaal_q1: string;
  totaal_q2: string;
  totaal_q3: string;
  totaal_q4: string;
  totaal_jaar: string;
  totaal_zonder_geldig_complex: string;
  beoordeeld: number;
  review_status: string;
}

interface ActiviteitRow {
  activiteit_id: number;
  complexnummer: string;
  omschrijving: string;
  aanleiding_type: string;
  aanleiding_toelichting: string;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  jaartotaal: string;
  status: string;
  leverancier: string | null;
  offertebedrag: string | null;
  notitie: string | null;
}

interface ComplexRow {
  complexnummer: string;
  aantal_activiteiten: number;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  jaartotaal: string;
}

interface ControlRow {
  activiteit_id: number | null;
  ernst: string;
  bericht: string;
}

/**
 * Schrijft het COMPLETE bevroren Gepland-Onderhoud-resultaat voor één
 * begrotingsversie — vervangt, geen gedeeltelijke state. GEEN eigen
 * transactie (de aanroeper bepaalt de transactiegrens — zie
 * `schrijfFrozenGeplandOnderhoudResultaat` voor de publieke, op zichzelf
 * staande variant). Faalt vóór enige schrijfactie als de parent niet bestaat
 * of geen CONCEPT is — dezelfde structurele invariant als elke eerdere
 * frozen-write-functie.
 *
 * Ontvangt een reeds berekend `HerberekendGeplandOnderhoudResultaat` —
 * herberekent NIETS, valideert GEEN businessregels (lifecycle-validatie
 * zoals "beoordeeld moet true zijn"/"geen KRITIEK" is de verantwoordelijkheid
 * van `vaststellen.ts`, vóórdat deze functie wordt aangeroepen).
 */
export function schrijfFrozenGeplandOnderhoudResultaatZonderTransactie(
  db: DatabaseSync,
  versieId: string,
  resultaat: HerberekendGeplandOnderhoudResultaat,
): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — frozen Gepland-Onderhoud-output mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  db.prepare(`DELETE FROM begroting_frozen_gepland_onderhoud_control WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_gepland_onderhoud_complex WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_gepland_onderhoud_activiteit WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_gepland_onderhoud_resultaat WHERE begroting_versie_id = ?`).run(versieId);

  db.prepare(
    `INSERT INTO begroting_frozen_gepland_onderhoud_resultaat
       (begroting_versie_id, totaal_q1, totaal_q2, totaal_q3, totaal_q4, totaal_jaar, totaal_zonder_geldig_complex, beoordeeld, review_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    versieId,
    resultaat.kwartaalTotalen.q1.toString(),
    resultaat.kwartaalTotalen.q2.toString(),
    resultaat.kwartaalTotalen.q3.toString(),
    resultaat.kwartaalTotalen.q4.toString(),
    resultaat.totaalJaar.toString(),
    resultaat.totaalZonderGeldigComplex.toString(),
    resultaat.beoordeeld ? 1 : 0,
    resultaat.reviewStatus,
  );

  const insertActiviteit = db.prepare(
    `INSERT INTO begroting_frozen_gepland_onderhoud_activiteit
       (begroting_versie_id, activiteit_id, complexnummer, omschrijving, aanleiding_type, aanleiding_toelichting,
        q1, q2, q3, q4, jaartotaal, status, leverancier, offertebedrag, notitie)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const { persistentieId, activiteit } of resultaat.activiteiten) {
    const invoer = activiteit.invoer;
    insertActiviteit.run(
      versieId,
      persistentieId,
      invoer.complexnummer,
      invoer.omschrijving,
      invoer.aanleidingType,
      invoer.aanleidingToelichting,
      activiteit.q1.toString(),
      activiteit.q2.toString(),
      activiteit.q3.toString(),
      activiteit.q4.toString(),
      activiteit.jaartotaal.toString(),
      invoer.status,
      invoer.leverancier ?? null,
      invoer.offertebedrag !== undefined && invoer.offertebedrag !== null ? invoer.offertebedrag.toString() : null,
      invoer.notitie ?? null,
    );
  }

  const insertComplex = db.prepare(
    `INSERT INTO begroting_frozen_gepland_onderhoud_complex
       (begroting_versie_id, complexnummer, volgnr, aantal_activiteiten, q1, q2, q3, q4, jaartotaal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  resultaat.perComplex.forEach((complex, volgnr) => {
    insertComplex.run(
      versieId,
      complex.complexnummer,
      volgnr,
      complex.aantalActiviteiten,
      complex.q1.toString(),
      complex.q2.toString(),
      complex.q3.toString(),
      complex.q4.toString(),
      complex.jaartotaal.toString(),
    );
  });

  const insertControl = db.prepare(
    `INSERT INTO begroting_frozen_gepland_onderhoud_control (begroting_versie_id, volgnr, activiteit_id, ernst, bericht) VALUES (?, ?, ?, ?, ?)`,
  );
  resultaat.controleVereist.forEach((control, volgnr) => {
    let activiteitId: number | null = null;
    if (control.activiteitIndex !== null) {
      const gekoppeld = resultaat.activiteiten[control.activiteitIndex];
      if (gekoppeld === undefined) {
        throw new Error(
          `Interne fout: begrotingsversie ${versieId}: control verwijst naar activiteitIndex ${control.activiteitIndex}, buiten bereik van ${resultaat.activiteiten.length} activiteiten — correlatie geschonden.`,
        );
      }
      activiteitId = gekoppeld.persistentieId;
    }
    insertControl.run(versieId, volgnr, activiteitId, control.ernst, control.bericht);
  });
}

/**
 * Publieke, op zichzelf staande variant: exact
 * `schrijfFrozenGeplandOnderhoudResultaatZonderTransactie`, maar binnen haar
 * eigen complete `BEGIN`…`COMMIT`/`ROLLBACK`-transactie — voor aanroepers die
 * frozen Gepland-Onderhoud-output als losstaande operatie willen schrijven
 * (bv. tijdens CONCEPT, ter voorbereiding/test).
 */
export function schrijfFrozenGeplandOnderhoudResultaat(db: DatabaseSync, versieId: string, resultaat: HerberekendGeplandOnderhoudResultaat): void {
  withTransaction(db, () => schrijfFrozenGeplandOnderhoudResultaatZonderTransactie(db, versieId, resultaat));
}

/**
 * Leest het bevroren Gepland-Onderhoud-resultaat voor een begrotingsversie.
 * `null` als er (nog) geen frozen output is — nooit een default/leeg
 * resultaat en nooit `Decimal(0)` in plaats van "ontbrekend".
 *
 * `activiteit.index`/`invoer` worden hier gereconstrueerd op basis van de
 * bevroren rij zelf — ÉÉN q1-q4-set volstaat (zie migratie 9's moduledoc:
 * ingevoerde en berekende bedragen zijn bij een succesvol bevroren activiteit
 * altijd al gelijk, want een NaN/ongeldig kwartaal zou al een KRITIEK-control
 * en dus een vaststel-blokkade hebben veroorzaakt). `index` op de
 * gereconstrueerde `BgGeplandOnderhoudActiviteitUitkomst` heeft, net als in
 * de pure module, geen businessbetekenis — hier simpelweg de leespositie.
 */
export function leesFrozenGeplandOnderhoudResultaat(db: DatabaseSync, versieId: string): HerberekendGeplandOnderhoudResultaat | null {
  const header = db.prepare(`SELECT * FROM begroting_frozen_gepland_onderhoud_resultaat WHERE begroting_versie_id = ?`).get(versieId) as unknown as
    | ResultaatRow
    | undefined;
  if (header === undefined) {
    return null;
  }

  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId}: frozen Gepland-Onderhoud-output bestaat, maar de versie zelf is niet leesbaar (interne inconsistentie).`);
  }

  const activiteitRijen = db
    .prepare(
      `SELECT activiteit_id, complexnummer, omschrijving, aanleiding_type, aanleiding_toelichting, q1, q2, q3, q4, jaartotaal, status, leverancier, offertebedrag, notitie
       FROM begroting_frozen_gepland_onderhoud_activiteit
       WHERE begroting_versie_id = ?
       ORDER BY activiteit_id`,
    )
    .all(versieId) as unknown as ActiviteitRow[];

  const activiteiten: GeplandOnderhoudActiviteitUitkomstMetId[] = activiteitRijen.map((rij, index) => {
    const invoer: BgGeplandOnderhoudActiviteitInvoer = {
      complexnummer: rij.complexnummer,
      omschrijving: rij.omschrijving,
      aanleidingType: rij.aanleiding_type as BgGeplandOnderhoudAanleidingType,
      aanleidingToelichting: rij.aanleiding_toelichting,
      q1: new Decimal(rij.q1),
      q2: new Decimal(rij.q2),
      q3: new Decimal(rij.q3),
      q4: new Decimal(rij.q4),
      status: rij.status as BgGeplandOnderhoudStatus,
      leverancier: rij.leverancier,
      offertebedrag: rij.offertebedrag !== null ? new Decimal(rij.offertebedrag) : null,
      notitie: rij.notitie,
    };
    const activiteit: BgGeplandOnderhoudActiviteitUitkomst = {
      index,
      invoer,
      q1: new Decimal(rij.q1),
      q2: new Decimal(rij.q2),
      q3: new Decimal(rij.q3),
      q4: new Decimal(rij.q4),
      jaartotaal: new Decimal(rij.jaartotaal),
    };
    return { persistentieId: rij.activiteit_id, activiteit };
  });
  const indexPerPersistentieId = new Map(activiteiten.map((a, index) => [a.persistentieId, index]));

  const complexRijen = db
    .prepare(
      `SELECT complexnummer, aantal_activiteiten, q1, q2, q3, q4, jaartotaal
       FROM begroting_frozen_gepland_onderhoud_complex
       WHERE begroting_versie_id = ?
       ORDER BY volgnr`,
    )
    .all(versieId) as unknown as ComplexRow[];
  const perComplex: BgGeplandOnderhoudComplexTotaal[] = complexRijen.map((rij) => ({
    complexnummer: rij.complexnummer,
    aantalActiviteiten: rij.aantal_activiteiten,
    q1: new Decimal(rij.q1),
    q2: new Decimal(rij.q2),
    q3: new Decimal(rij.q3),
    q4: new Decimal(rij.q4),
    jaartotaal: new Decimal(rij.jaartotaal),
  }));

  const controlRijen = db
    .prepare(`SELECT activiteit_id, ernst, bericht FROM begroting_frozen_gepland_onderhoud_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
    .all(versieId) as unknown as ControlRow[];
  const controleVereist: BgGeplandOnderhoudControleItem[] = controlRijen.map((rij) => {
    let activiteitIndex: number | null = null;
    if (rij.activiteit_id !== null) {
      const gevonden = indexPerPersistentieId.get(rij.activiteit_id);
      if (gevonden === undefined) {
        throw new Error(
          `Interne fout: begrotingsversie ${versieId}: frozen control verwijst naar activiteit_id ${rij.activiteit_id}, die niet voorkomt in de frozen activiteiten — inconsistente frozen data.`,
        );
      }
      activiteitIndex = gevonden;
    }
    return { activiteitIndex, ernst: rij.ernst as BgGeplandOnderhoudControleErnst, bericht: rij.bericht };
  });

  return {
    begrotingsjaar: versie.begrotingsjaar,
    beoordeeld: header.beoordeeld === 1,
    reviewStatus: header.review_status as BgGeplandOnderhoudReviewStatus,
    activiteiten,
    kwartaalTotalen: {
      q1: new Decimal(header.totaal_q1),
      q2: new Decimal(header.totaal_q2),
      q3: new Decimal(header.totaal_q3),
      q4: new Decimal(header.totaal_q4),
    },
    totaalJaar: new Decimal(header.totaal_jaar),
    perComplex,
    totaalZonderGeldigComplex: new Decimal(header.totaal_zonder_geldig_complex),
    controleVereist,
  };
}
