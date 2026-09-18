import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type {
  BgGemeentelijkeLastenComplexTotaal,
  BgGemeentelijkeLastenControleErnst,
  BgGemeentelijkeLastenControleItem,
  BgGemeentelijkeLastenReviewStatus,
  BgWozObjectInvoer,
  BgWozObjectUitkomst,
} from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import type { HerberekendGemeentelijkeLastenResultaat, WozObjectUitkomstMetId } from "./herberekenen.js";

/**
 * Persistence voor de bevroren Gemeentelijke-Lasten/WOZ-OUTPUT (OB-033, fase
 * P3) — exact zoals `HerberekendGemeentelijkeLastenResultaat`/
 * `@bvc/reporting`'s `begroteGemeentelijkeLasten.ts` op HEAD die kennen; zie
 * migratie 15 in `migrations.ts` voor de volledige tabel-/CHECK-motivatie.
 * UITSLUITEND serialisatie/deserialisatie — geen formules, geen totalen
 * opnieuw afgeleid, geen aanroep van `berekenBegroteGemeentelijkeLasten`/
 * `herberekenBegroting`.
 *
 * Strikt gescheiden van `gemeentelijkeLastenModule.ts`/`wozObjecten.ts` (de
 * persistente CONCEPT-input): deze laag leest die tabellen NOOIT terug om
 * een resultaat te reconstrueren — elke frozen rij is zelfstandig, volledig
 * terugleesbaar.
 *
 * `werkelijkeGemeentelijkeLasten` ALS EXTRA PARAMETER (bewust GEEN wijziging
 * van de pure calculator): `BgGemeentelijkeLastenResultaat` echoot deze
 * module-brede aanname zelf niet terug (zie `begroteGemeentelijkeLasten.ts`)
 * — voor volledige auditability van de bevroren header accepteert
 * `schrijfFrozenGemeentelijkeLastenResultaatZonderTransactie` deze waarde
 * daarom apart, naast het al berekende resultaat. `vaststellen.ts` geeft
 * hiervoor de al-gelezen `invoer.gemeentelijkeLastenModule.
 * werkelijkeGemeentelijkeLasten` door — geen nieuwe leesactie, geen
 * conceptdata-afhankelijkheid bij FROZEN READ (die blijft uitsluitend de
 * vier frozen tabellen lezen).
 *
 * PERCOMPLEX ALS APARTE TABEL (bewust ANDERS dan Verzekeringen se drie-
 * tabellen-pattern, WEL zoals Gepland Onderhoud se vier-tabellen-pattern):
 * de pure calculator levert `perComplex` al aan als een eigen aggregatie
 * (zie `berekenBegroteGemeentelijkeLasten`'s `Map`-opbouw) — zonder eigen
 * frozen tabel zou frozen read die aggregatie opnieuw uit de frozen
 * WOZ-objecten moeten samenstellen, wat expliciet verboden is (zie fase-
 * instructie sectie 6/8: "HERBEREKEN deze waarden bij frozen read NIET").
 *
 * CONTROL → PERSISTENTIE-ID-VERTALING: exact hetzelfde principe als
 * `frozenGeplandOnderhoudResultaat.ts`/`frozenVerzekeringResultaat.ts`. De
 * pure calculator se `BgGemeentelijkeLastenControleItem.objectIndex` is
 * uitsluitend geldig binnen ÉÉN functie-aanroep. Bij het bevriezen wordt dat
 * vertaald naar het STABIELE `persistentieId` via de al-berekende koppeling
 * (`resultaat.wozObjecten[objectIndex].persistentieId`) — een `objectIndex`
 * die buiten het bereik van `resultaat.wozObjecten` valt is een interne
 * inconsistentie (fail-fast, geen stille `NULL`). Bij het teruglezen
 * gebeurt de omgekeerde vertaling (`woz_object_id → objectIndex`) via
 * dezelfde, opnieuw opgebouwde koppeling.
 *
 * `schrijfFrozenGemeentelijkeLastenResultaatZonderTransactie` is bewust als
 * los, transactievrij bouwblok geëxporteerd (niet via `index.ts`) zodat
 * `stelBegrotingVast` (`vaststellen.ts`) dezelfde schrijflogica kan
 * hergebruiken binnen haar eigen, grotere `BEGIN IMMEDIATE`-transactie.
 */

/**
 * `HerberekendGemeentelijkeLastenResultaat` aangevuld met de apart bevroren
 * `werkelijkeGemeentelijkeLasten` (zie moduledoc: GEEN onderdeel van
 * `BgGemeentelijkeLastenResultaat` zelf) — het volledige, zelfstandig
 * terugleesbare frozen resultaat, exact wat `VastgesteldeBegroting.
 * gemeentelijkeLasten` (`vaststellen.ts`) bevat.
 */
export interface FrozenGemeentelijkeLastenResultaat extends HerberekendGemeentelijkeLastenResultaat {
  werkelijkeGemeentelijkeLasten: Decimal | null;
}

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

// ===== Rijtypen =====

interface ResultaatRow {
  werkelijke_gemeentelijke_lasten: string | null;
  woz_stijging_percentage: string | null;
  lasten_percentage_stijging: string | null;
  begrotings_percentage_override: string | null;
  beoordeeld: number;
  review_status: string;
  totale_werkelijke_woz: string;
  historisch_lasten_percentage: string;
  automatisch_begrotings_percentage: string;
  effectief_begrotings_percentage: string;
  totale_automatisch_verwachte_woz: string;
  totale_effectief_verwachte_woz: string;
  begrote_gemeentelijke_lasten: string;
}

interface WozObjectRow {
  woz_object_id: number;
  complexnummer: string;
  woz_object_adres: string;
  aanslagjaar: number;
  waardepeildatum: string;
  werkelijke_woz: string;
  verwachte_woz_override: string | null;
  automatisch_verwachte_woz: string;
  effectief_verwachte_woz: string;
}

interface ComplexRow {
  complexnummer: string;
  effectief_verwachte_woz: string;
  begrote_gemeentelijke_lasten: string;
}

interface ControlRow {
  woz_object_id: number | null;
  ernst: string;
  bericht: string;
}

/**
 * Schrijft het COMPLETE bevroren Gemeentelijke-Lasten/WOZ-resultaat voor
 * één begrotingsversie — vervangt, geen gedeeltelijke state. GEEN eigen
 * transactie (de aanroeper bepaalt de transactiegrens — zie
 * `schrijfFrozenGemeentelijkeLastenResultaat` voor de publieke, op zichzelf
 * staande variant). Faalt vóór enige schrijfactie als de parent niet
 * bestaat of geen CONCEPT is — dezelfde structurele invariant als elke
 * eerdere frozen-write-functie.
 *
 * Ontvangt een reeds berekend `HerberekendGemeentelijkeLastenResultaat` —
 * herberekent NIETS, valideert GEEN businessregels (lifecycle-validatie
 * zoals "beoordeeld moet true zijn"/"geen KRITIEK" is de verantwoordelijkheid
 * van `vaststellen.ts`, vóórdat deze functie wordt aangeroepen). Ontvangt
 * `werkelijkeGemeentelijkeLasten` als aparte parameter (zie moduledoc).
 */
export function schrijfFrozenGemeentelijkeLastenResultaatZonderTransactie(
  db: DatabaseSync,
  versieId: string,
  resultaat: HerberekendGemeentelijkeLastenResultaat,
  werkelijkeGemeentelijkeLasten: Decimal | null,
): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — frozen Gemeentelijke-Lasten/WOZ-output mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  db.prepare(`DELETE FROM begroting_frozen_gemeentelijke_lasten_control WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_gemeentelijke_lasten_complex WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_woz_object WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_gemeentelijke_lasten_resultaat WHERE begroting_versie_id = ?`).run(versieId);

  db.prepare(
    `INSERT INTO begroting_frozen_gemeentelijke_lasten_resultaat
       (begroting_versie_id, werkelijke_gemeentelijke_lasten, woz_stijging_percentage, lasten_percentage_stijging,
        begrotings_percentage_override, beoordeeld, review_status, totale_werkelijke_woz, historisch_lasten_percentage,
        automatisch_begrotings_percentage, effectief_begrotings_percentage, totale_automatisch_verwachte_woz,
        totale_effectief_verwachte_woz, begrote_gemeentelijke_lasten)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    versieId,
    werkelijkeGemeentelijkeLasten !== null ? werkelijkeGemeentelijkeLasten.toString() : null,
    resultaat.wozStijgingPercentage !== null ? resultaat.wozStijgingPercentage.toString() : null,
    resultaat.lastenPercentageStijging !== null ? resultaat.lastenPercentageStijging.toString() : null,
    resultaat.begrotingsPercentageOverride !== null ? resultaat.begrotingsPercentageOverride.toString() : null,
    resultaat.beoordeeld ? 1 : 0,
    resultaat.reviewStatus,
    resultaat.totaleWerkelijkeWoz.toString(),
    resultaat.historischLastenPercentage.toString(),
    resultaat.automatischBegrotingsPercentage.toString(),
    resultaat.effectiefBegrotingsPercentage.toString(),
    resultaat.totaleAutomatischVerwachteWoz.toString(),
    resultaat.totaleEffectiefVerwachteWoz.toString(),
    resultaat.begroteGemeentelijkeLasten.toString(),
  );

  const insertWozObject = db.prepare(
    `INSERT INTO begroting_frozen_woz_object
       (begroting_versie_id, woz_object_id, complexnummer, woz_object_adres, aanslagjaar, waardepeildatum,
        werkelijke_woz, verwachte_woz_override, automatisch_verwachte_woz, effectief_verwachte_woz)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const { persistentieId, wozObject } of resultaat.wozObjecten) {
    const invoer = wozObject.invoer;
    insertWozObject.run(
      versieId,
      persistentieId,
      invoer.complexnummer,
      invoer.wozObjectAdres,
      invoer.aanslagjaar,
      invoer.waardepeildatum !== null ? formatBusinessDate(invoer.waardepeildatum) : null,
      invoer.werkelijkeWoz !== null ? invoer.werkelijkeWoz.toString() : null,
      invoer.verwachteWozOverride !== null ? invoer.verwachteWozOverride.toString() : null,
      wozObject.automatischVerwachteWoz.toString(),
      wozObject.effectiefVerwachteWoz.toString(),
    );
  }

  const insertComplex = db.prepare(
    `INSERT INTO begroting_frozen_gemeentelijke_lasten_complex
       (begroting_versie_id, complexnummer, volgnr, effectief_verwachte_woz, begrote_gemeentelijke_lasten)
     VALUES (?, ?, ?, ?, ?)`,
  );
  resultaat.perComplex.forEach((complex, volgnr) => {
    insertComplex.run(versieId, complex.complexnummer, volgnr, complex.effectiefVerwachteWoz.toString(), complex.begroteGemeentelijkeLasten.toString());
  });

  const insertControl = db.prepare(
    `INSERT INTO begroting_frozen_gemeentelijke_lasten_control (begroting_versie_id, volgnr, woz_object_id, ernst, bericht) VALUES (?, ?, ?, ?, ?)`,
  );
  resultaat.controleVereist.forEach((control, volgnr) => {
    let wozObjectId: number | null = null;
    if (control.objectIndex !== null) {
      const gekoppeld = resultaat.wozObjecten[control.objectIndex];
      if (gekoppeld === undefined) {
        throw new Error(
          `Interne fout: begrotingsversie ${versieId}: control verwijst naar objectIndex ${control.objectIndex}, buiten bereik van ${resultaat.wozObjecten.length} WOZ-objecten — correlatie geschonden.`,
        );
      }
      wozObjectId = gekoppeld.persistentieId;
    }
    insertControl.run(versieId, volgnr, wozObjectId, control.ernst, control.bericht);
  });
}

/**
 * Publieke, op zichzelf staande variant: exact
 * `schrijfFrozenGemeentelijkeLastenResultaatZonderTransactie`, maar binnen
 * haar eigen complete `BEGIN`…`COMMIT`/`ROLLBACK`-transactie.
 */
export function schrijfFrozenGemeentelijkeLastenResultaat(
  db: DatabaseSync,
  versieId: string,
  resultaat: HerberekendGemeentelijkeLastenResultaat,
  werkelijkeGemeentelijkeLasten: Decimal | null,
): void {
  withTransaction(db, () => schrijfFrozenGemeentelijkeLastenResultaatZonderTransactie(db, versieId, resultaat, werkelijkeGemeentelijkeLasten));
}

/**
 * Leest het bevroren Gemeentelijke-Lasten/WOZ-resultaat voor een
 * begrotingsversie, samen met de apart bevroren `werkelijkeGemeentelijkeLasten`.
 * `null` als er (nog) geen frozen output is — nooit een default/leeg
 * resultaat en nooit `Decimal(0)` in plaats van "ontbrekend".
 *
 * UITSLUITEND frozen tabellen — GEEN aanroep van
 * `berekenBegroteGemeentelijkeLasten`, GEEN lezen van
 * `gemeentelijkeLastenModule.ts`/`wozObjecten.ts` (concept-input), GEEN
 * herberekening van `perComplex`/percentages (die komen rechtstreeks uit
 * `begroting_frozen_gemeentelijke_lasten_complex`/-`resultaat`).
 */
export function leesFrozenGemeentelijkeLastenResultaat(db: DatabaseSync, versieId: string): FrozenGemeentelijkeLastenResultaat | null {
  const header = db
    .prepare(`SELECT * FROM begroting_frozen_gemeentelijke_lasten_resultaat WHERE begroting_versie_id = ?`)
    .get(versieId) as unknown as ResultaatRow | undefined;
  if (header === undefined) {
    return null;
  }

  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(
      `Begrotingsversie ${versieId}: frozen Gemeentelijke-Lasten/WOZ-output bestaat, maar de versie zelf is niet leesbaar (interne inconsistentie).`,
    );
  }

  const wozObjectRijen = db
    .prepare(
      `SELECT woz_object_id, complexnummer, woz_object_adres, aanslagjaar, waardepeildatum, werkelijke_woz, verwachte_woz_override,
              automatisch_verwachte_woz, effectief_verwachte_woz
       FROM begroting_frozen_woz_object
       WHERE begroting_versie_id = ?
       ORDER BY woz_object_id`,
    )
    .all(versieId) as unknown as WozObjectRow[];

  const wozObjecten: WozObjectUitkomstMetId[] = wozObjectRijen.map((rij, index) => {
    const invoer: BgWozObjectInvoer = {
      complexnummer: rij.complexnummer,
      wozObjectAdres: rij.woz_object_adres,
      aanslagjaar: rij.aanslagjaar,
      waardepeildatum: parseBusinessDate(rij.waardepeildatum),
      werkelijkeWoz: new Decimal(rij.werkelijke_woz),
      verwachteWozOverride: rij.verwachte_woz_override !== null ? new Decimal(rij.verwachte_woz_override) : null,
    };
    const wozObjectUitkomst: BgWozObjectUitkomst = {
      index,
      invoer,
      automatischVerwachteWoz: new Decimal(rij.automatisch_verwachte_woz),
      effectiefVerwachteWoz: new Decimal(rij.effectief_verwachte_woz),
    };
    return { persistentieId: rij.woz_object_id, wozObject: wozObjectUitkomst };
  });
  const indexPerPersistentieId = new Map(wozObjecten.map((o, index) => [o.persistentieId, index]));

  const complexRijen = db
    .prepare(
      `SELECT complexnummer, effectief_verwachte_woz, begrote_gemeentelijke_lasten
       FROM begroting_frozen_gemeentelijke_lasten_complex
       WHERE begroting_versie_id = ?
       ORDER BY volgnr`,
    )
    .all(versieId) as unknown as ComplexRow[];
  const perComplex: BgGemeentelijkeLastenComplexTotaal[] = complexRijen.map((rij) => ({
    complexnummer: rij.complexnummer,
    effectiefVerwachteWoz: new Decimal(rij.effectief_verwachte_woz),
    begroteGemeentelijkeLasten: new Decimal(rij.begrote_gemeentelijke_lasten),
  }));

  const controlRijen = db
    .prepare(`SELECT woz_object_id, ernst, bericht FROM begroting_frozen_gemeentelijke_lasten_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
    .all(versieId) as unknown as ControlRow[];
  const controleVereist: BgGemeentelijkeLastenControleItem[] = controlRijen.map((rij) => {
    let objectIndex: number | null = null;
    if (rij.woz_object_id !== null) {
      const gevonden = indexPerPersistentieId.get(rij.woz_object_id);
      if (gevonden === undefined) {
        throw new Error(
          `Interne fout: begrotingsversie ${versieId}: frozen control verwijst naar woz_object_id ${rij.woz_object_id}, die niet voorkomt in de frozen WOZ-objecten — inconsistente frozen data.`,
        );
      }
      objectIndex = gevonden;
    }
    return { objectIndex, ernst: rij.ernst as BgGemeentelijkeLastenControleErnst, bericht: rij.bericht };
  });

  return {
    begrotingsjaar: versie.begrotingsjaar,
    beoordeeld: header.beoordeeld === 1,
    reviewStatus: header.review_status as BgGemeentelijkeLastenReviewStatus,
    wozObjecten,
    totaleWerkelijkeWoz: new Decimal(header.totale_werkelijke_woz),
    historischLastenPercentage: new Decimal(header.historisch_lasten_percentage),
    wozStijgingPercentage: header.woz_stijging_percentage !== null ? new Decimal(header.woz_stijging_percentage) : null,
    lastenPercentageStijging: header.lasten_percentage_stijging !== null ? new Decimal(header.lasten_percentage_stijging) : null,
    automatischBegrotingsPercentage: new Decimal(header.automatisch_begrotings_percentage),
    begrotingsPercentageOverride: header.begrotings_percentage_override !== null ? new Decimal(header.begrotings_percentage_override) : null,
    effectiefBegrotingsPercentage: new Decimal(header.effectief_begrotings_percentage),
    totaleAutomatischVerwachteWoz: new Decimal(header.totale_automatisch_verwachte_woz),
    totaleEffectiefVerwachteWoz: new Decimal(header.totale_effectief_verwachte_woz),
    begroteGemeentelijkeLasten: new Decimal(header.begrote_gemeentelijke_lasten),
    perComplex,
    controleVereist,
    werkelijkeGemeentelijkeLasten: header.werkelijke_gemeentelijke_lasten !== null ? new Decimal(header.werkelijke_gemeentelijke_lasten) : null,
  };
}
