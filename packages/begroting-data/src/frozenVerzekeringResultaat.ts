import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgVerzekeringControleErnst, BgVerzekeringControleItem, BgVerzekeringRegelUitkomst, BgVerzekeringReviewStatus } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import type { HerberekendVerzekeringResultaat, VerzekeringRegelUitkomstMetId } from "./herberekenen.js";

/**
 * Persistence voor de bevroren Verzekeringen-OUTPUT (OB-032) — exact zoals
 * `HerberekendVerzekeringResultaat`/`@bvc/reporting`'s
 * `begroteVerzekeringen.ts` op HEAD die kennen; zie migratie 13 in
 * `migrations.ts` voor de volledige tabel-/CHECK-motivatie. UITSLUITEND
 * serialisatie/deserialisatie — geen formules, geen totalen opnieuw
 * afgeleid, geen aanroep van `berekenBegroteVerzekeringen`/
 * `herberekenBegroting`.
 *
 * Strikt gescheiden van `verzekeringRegels.ts`/`verzekeringBeoordeeld.ts`
 * (de persistente CONCEPT-input): deze laag leest die tabellen NOOIT terug
 * om een resultaat te reconstrueren — elke frozen rij is zelfstandig,
 * volledig terugleesbaar.
 *
 * VERLENGMOMENTEN, BEWUST VEREENVOUDIGD (OB032-correctie): alleen het
 * EERSTE relevante verlengmoment (`eersteRelevanteVerlengmoment`) en het
 * AANTAL (`relevanteVerlengmomenten.length`) worden bevroren — niet de
 * volledige datumreeks. Reden: uitsluitend het eerste moment is financieel
 * bepalend (`berekendBegroot` is er al mee berekend, dus zelf al volledig
 * gereproduceerd), en geen enkele bronregel bij 070 toont een polis met
 * een sub-jaarlijkse looptijd die tot meerdere momenten zou leiden — een
 * volledige child-tabel voor die lijst zou functionaliteit bouwen die nog
 * niet aantoonbaar nodig is (zelfde principe als "geen perComplex zonder
 * bewezen noodzaak").
 *
 * CONTROL → PERSISTENTIE-ID-VERTALING: exact hetzelfde principe als
 * `frozenCorrectiefDagelijksOnderhoudResultaat.ts`. De pure calculator se
 * `BgVerzekeringControleItem.regelIndex` is uitsluitend geldig binnen ÉÉN
 * functie-aanroep. Bij het bevriezen wordt dat vertaald naar het STABIELE
 * `persistentieId` via de al-berekende koppeling
 * (`resultaat.regels[regelIndex].persistentieId`) — een `regelIndex` die
 * buiten het bereik van `resultaat.regels` valt is een interne
 * inconsistentie (fail-fast, geen stille `NULL`). Bij het teruglezen
 * gebeurt de omgekeerde vertaling (`regel_id → regelIndex`) via dezelfde,
 * opnieuw opgebouwde koppeling.
 *
 * `schrijfFrozenVerzekeringResultaatZonderTransactie` is bewust als los,
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

function formatBusinessDate(date: Date): string {
  const jaar = date.getUTCFullYear().toString().padStart(4, "0");
  const maand = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dag = date.getUTCDate().toString().padStart(2, "0");
  return `${jaar}-${maand}-${dag}`;
}

function parseBusinessDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`Ongeldige businessdatum uit persistence: "${value}" (verwacht YYYY-MM-DD).`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function optioneleBusinessDate(date: Date | null): string | null {
  return date !== null ? formatBusinessDate(date) : null;
}

function optioneleParsedBusinessDate(value: string | null): Date | null {
  return value !== null ? parseBusinessDate(value) : null;
}

// ===== Rijtypen =====

interface ResultaatRow {
  totaal_berekend_begroot: string;
  totaal_effectief_begroot: string;
  beoordeeld: number;
  review_status: string;
}

interface RegelRow {
  regel_id: number;
  complexnummer: string;
  verzekeraar: string;
  ingangsdatum: string;
  looptijd_maanden: number;
  bedrag: string;
  index_percentage: string;
  handmatig_begroot_override: string | null;
  berekend_begroot: string;
  effectief_begroot: string;
  eerste_relevante_verlengmoment: string | null;
  aantal_relevante_verlengmomenten: number;
}

interface ControlRow {
  regel_id: number | null;
  ernst: string;
  bericht: string;
}

/**
 * Schrijft het COMPLETE bevroren Verzekeringen-resultaat voor één
 * begrotingsversie — vervangt, geen gedeeltelijke state. GEEN eigen
 * transactie (de aanroeper bepaalt de transactiegrens — zie
 * `schrijfFrozenVerzekeringResultaat` voor de publieke, op zichzelf staande
 * variant). Faalt vóór enige schrijfactie als de parent niet bestaat of
 * geen CONCEPT is — dezelfde structurele invariant als elke eerdere
 * frozen-write-functie.
 *
 * Ontvangt een reeds berekend `HerberekendVerzekeringResultaat` —
 * herberekent NIETS, valideert GEEN businessregels (lifecycle-validatie
 * zoals "beoordeeld moet true zijn"/"geen KRITIEK" is de verantwoordelijkheid
 * van `vaststellen.ts`, vóórdat deze functie wordt aangeroepen).
 */
export function schrijfFrozenVerzekeringResultaatZonderTransactie(
  db: DatabaseSync,
  versieId: string,
  resultaat: HerberekendVerzekeringResultaat,
): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — frozen Verzekeringen-output mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  db.prepare(`DELETE FROM begroting_frozen_verzekering_control WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_verzekering_regel WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_verzekering_resultaat WHERE begroting_versie_id = ?`).run(versieId);

  db.prepare(
    `INSERT INTO begroting_frozen_verzekering_resultaat
       (begroting_versie_id, totaal_berekend_begroot, totaal_effectief_begroot, beoordeeld, review_status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(versieId, resultaat.totaalBerekendBegroot.toString(), resultaat.totaalEffectiefBegroot.toString(), resultaat.beoordeeld ? 1 : 0, resultaat.reviewStatus);

  const insertRegel = db.prepare(
    `INSERT INTO begroting_frozen_verzekering_regel
       (begroting_versie_id, regel_id, complexnummer, verzekeraar, ingangsdatum, looptijd_maanden, bedrag, index_percentage,
        handmatig_begroot_override, berekend_begroot, effectief_begroot, eerste_relevante_verlengmoment, aantal_relevante_verlengmomenten)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const { persistentieId, regel } of resultaat.regels) {
    const invoer = regel.invoer;
    insertRegel.run(
      versieId,
      persistentieId,
      invoer.complexnummer,
      invoer.verzekeraar,
      optioneleBusinessDate(invoer.ingangsdatum),
      invoer.looptijdMaanden,
      invoer.bedrag !== null ? invoer.bedrag.toString() : null,
      invoer.indexPercentage !== null ? invoer.indexPercentage.toString() : null,
      invoer.handmatigBegrootOverride !== null ? invoer.handmatigBegrootOverride.toString() : null,
      regel.berekendBegroot.toString(),
      regel.effectiefBegroot.toString(),
      optioneleBusinessDate(regel.eersteRelevanteVerlengmoment),
      regel.relevanteVerlengmomenten.length,
    );
  }

  const insertControl = db.prepare(
    `INSERT INTO begroting_frozen_verzekering_control (begroting_versie_id, volgnr, regel_id, ernst, bericht) VALUES (?, ?, ?, ?, ?)`,
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
 * `schrijfFrozenVerzekeringResultaatZonderTransactie`, maar binnen haar
 * eigen complete `BEGIN`…`COMMIT`/`ROLLBACK`-transactie.
 */
export function schrijfFrozenVerzekeringResultaat(db: DatabaseSync, versieId: string, resultaat: HerberekendVerzekeringResultaat): void {
  withTransaction(db, () => schrijfFrozenVerzekeringResultaatZonderTransactie(db, versieId, resultaat));
}

/**
 * Leest het bevroren Verzekeringen-resultaat voor een begrotingsversie.
 * `null` als er (nog) geen frozen output is — nooit een default/leeg
 * resultaat en nooit `Decimal(0)` in plaats van "ontbrekend".
 *
 * `regel.index`/`invoer` worden hier gereconstrueerd op basis van de
 * bevroren rij zelf. `invoer.bedrag`/`indexPercentage`/`ingangsdatum`/
 * `looptijdMaanden` zijn bij een succesvol bevroren regel altijd geldig
 * (de KRITIEK-blokkade in `vaststellen.ts` sluit dat uit vóór freeze) —
 * ÉÉN set volstaat, geen aparte "ingevoerd vs. berekend"-splitsing nodig.
 * `relevanteVerlengmomenten` wordt gereconstrueerd als een array met
 * uitsluitend het bevroren `eersteRelevanteVerlengmoment` erin (lengte 0
 * of 1) — het bevroren `aantal_relevante_verlengmomenten` blijft apart
 * beschikbaar voor wie het werkelijke aantal wil weten (zie moduledoc:
 * bewuste vereenvoudiging, de volledige lijst wordt niet bevroren).
 */
export function leesFrozenVerzekeringResultaat(db: DatabaseSync, versieId: string): HerberekendVerzekeringResultaat | null {
  const header = db.prepare(`SELECT * FROM begroting_frozen_verzekering_resultaat WHERE begroting_versie_id = ?`).get(versieId) as unknown as
    | ResultaatRow
    | undefined;
  if (header === undefined) {
    return null;
  }

  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId}: frozen Verzekeringen-output bestaat, maar de versie zelf is niet leesbaar (interne inconsistentie).`);
  }

  const regelRijen = db
    .prepare(
      `SELECT regel_id, complexnummer, verzekeraar, ingangsdatum, looptijd_maanden, bedrag, index_percentage,
              handmatig_begroot_override, berekend_begroot, effectief_begroot, eerste_relevante_verlengmoment, aantal_relevante_verlengmomenten
       FROM begroting_frozen_verzekering_regel
       WHERE begroting_versie_id = ?
       ORDER BY regel_id`,
    )
    .all(versieId) as unknown as RegelRow[];

  const regels: VerzekeringRegelUitkomstMetId[] = regelRijen.map((rij, index) => {
    const eersteRelevanteVerlengmoment = optioneleParsedBusinessDate(rij.eerste_relevante_verlengmoment);
    const regelUitkomst: BgVerzekeringRegelUitkomst = {
      index,
      invoer: {
        complexnummer: rij.complexnummer,
        verzekeraar: rij.verzekeraar,
        ingangsdatum: parseBusinessDate(rij.ingangsdatum),
        looptijdMaanden: rij.looptijd_maanden,
        bedrag: new Decimal(rij.bedrag),
        indexPercentage: new Decimal(rij.index_percentage),
        handmatigBegrootOverride: rij.handmatig_begroot_override !== null ? new Decimal(rij.handmatig_begroot_override) : null,
      },
      berekendBegroot: new Decimal(rij.berekend_begroot),
      effectiefBegroot: new Decimal(rij.effectief_begroot),
      eersteRelevanteVerlengmoment,
      relevanteVerlengmomenten: eersteRelevanteVerlengmoment !== null ? [eersteRelevanteVerlengmoment] : [],
    };
    return { persistentieId: rij.regel_id, regel: regelUitkomst };
  });
  const indexPerPersistentieId = new Map(regels.map((r, index) => [r.persistentieId, index]));

  const controlRijen = db
    .prepare(`SELECT regel_id, ernst, bericht FROM begroting_frozen_verzekering_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
    .all(versieId) as unknown as ControlRow[];
  const controleVereist: BgVerzekeringControleItem[] = controlRijen.map((rij) => {
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
    return { regelIndex, ernst: rij.ernst as BgVerzekeringControleErnst, bericht: rij.bericht };
  });

  return {
    begrotingsjaar: versie.begrotingsjaar,
    beoordeeld: header.beoordeeld === 1,
    reviewStatus: header.review_status as BgVerzekeringReviewStatus,
    regels,
    totaalBerekendBegroot: new Decimal(header.totaal_berekend_begroot),
    totaalEffectiefBegroot: new Decimal(header.totaal_effectief_begroot),
    controleVereist,
  };
}
