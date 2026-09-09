import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import {
  ALGEMENE_KOSTEN_CATEGORIEEN,
  type BgAlgemeneKostenCategorie,
  type BgAlgemeneKostenClassificatieRegel,
  type BgAlgemeneKostenControleErnst,
  type BgAlgemeneKostenControleItem,
  type BgAlgemeneKostenRegelInvoer,
  type BgAlgemeneKostenRegelUitkomst,
  type BgAlgemeneKostenReviewStatus,
} from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import type {
  AlgemeneKostenRegelUitkomstMetId,
  HerberekendAlgemeneKostenCategorieResultaat,
  HerberekendAlgemeneKostenResultaat,
} from "./herberekenen.js";

/**
 * Persistence voor de bevroren Algemene-Kosten-OUTPUT (OB-035/036, fase P3)
 * — exact zoals `HerberekendAlgemeneKostenResultaat`/`@bvc/reporting`'s
 * `begroteAlgemeneKosten.ts` op HEAD die kennen; zie migratie 17 in
 * `migrations.ts` voor de volledige tabel-/CHECK-motivatie. UITSLUITEND
 * serialisatie/deserialisatie — geen formules, geen totalen opnieuw
 * afgeleid, geen aanroep van `berekenBegroteAlgemeneKosten`/
 * `herberekenBegroting`.
 *
 * Strikt gescheiden van `algemeneKostenClassificatie.ts`/
 * `algemeneKostenCategorieState.ts`/`algemeneKostenRegels.ts` (de
 * persistente CONCEPT-input, resp. de levende, administratie-brede
 * classificatieconfiguratie): deze laag leest die tabellen NOOIT terug om
 * een resultaat te reconstrueren — elke frozen rij is zelfstandig, volledig
 * terugleesbaar.
 *
 * DE VOLLEDIGE RESOLVED CLASSIFICATIE WORDT MEEBEVROREN (OB-035/036 §12):
 * `schrijfFrozenAlgemeneKostenResultaatZonderTransactie` ontvangt de
 * classificatie als EXTRA parameter (`leesAlgemeneKostenClassificatie(db,
 * versie.bedrijfsnr)`, door `vaststellen.ts` al gelezen als onderdeel van
 * `HerberekenInvoer`) — ALLE regels op dat moment, ook OGB-codes die in
 * geen enkele begrotingsregel zijn gebruikt. Een latere wijziging van de
 * levende classificatie kan deze bevroren kopie nooit meer raken (geen FK,
 * geen verwijzing — een volledige kopie).
 *
 * CONTROL → PERSISTENTIE-ID-VERTALING (BINNEN CATEGORIE): de pure
 * calculator se `BgAlgemeneKostenControleItem.regelIndex` is positioneel
 * BINNEN de regels van diezelfde `categorie` (zie
 * `begroteAlgemeneKosten.ts`'s moduledoc) — anders dan bij eerdere modules,
 * die één platte regellijst kennen. Bij het bevriezen wordt dat vertaald
 * naar het stabiele `persistentieId` via de al-berekende koppeling
 * (`resultaat.perCategorie.find(c => c.categorie === control.categorie)!.
 * regels[control.regelIndex].persistentieId`) — een `regelIndex` die buiten
 * bereik valt is een interne inconsistentie (fail-fast, geen stille
 * `NULL`). Bij het teruglezen gebeurt de omgekeerde vertaling
 * (`regel_id → regelIndex`, eveneens binnen dezelfde categorie).
 *
 * `schrijfFrozenAlgemeneKostenResultaatZonderTransactie` is bewust als los,
 * transactievrij bouwblok geëxporteerd (niet via `index.ts`) zodat
 * `stelBegrotingVast` (`vaststellen.ts`) dezelfde schrijflogica kan
 * hergebruiken binnen haar eigen, grotere `BEGIN IMMEDIATE`-transactie.
 */

/** `HerberekendAlgemeneKostenResultaat` aangevuld met de volledige resolved lokale classificatie zoals die gold op het moment van vaststellen (zie moduledoc). */
export interface FrozenAlgemeneKostenResultaat extends HerberekendAlgemeneKostenResultaat {
  classificatie: readonly BgAlgemeneKostenClassificatieRegel[];
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

// ===== Rijtypen =====

interface ClassificatieRow {
  ogb_kostensoort: string;
  ogb_kostensoort_omschrijving: string;
  categorie: BgAlgemeneKostenCategorie;
}

interface CategorieRow {
  categorie: BgAlgemeneKostenCategorie;
  beoordeeld: number;
  review_status: BgAlgemeneKostenReviewStatus;
  categorie_totaal: string;
  vorig_jaar_bedrag: string | null;
  verwachte_verhoging_percentage: string | null;
  berekend_voorstel: string | null;
  module_totaal: string;
}

interface RegelRow {
  regel_id: number;
  categorie: BgAlgemeneKostenCategorie;
  ogb_kostensoort_code: string | null;
  ogb_kostensoort_omschrijving: string | null;
  omschrijving: string;
  complexnummer: string | null;
  jaarbedrag: string | null;
  financiele_bijdrage: string;
}

interface ControlRow {
  categorie: BgAlgemeneKostenCategorie;
  regel_id: number | null;
  ernst: string;
  bericht: string;
}

/**
 * Schrijft het COMPLETE bevroren Algemene-Kosten-resultaat (inclusief de
 * volledige resolved classificatie) voor één begrotingsversie — vervangt,
 * geen gedeeltelijke state. GEEN eigen transactie (de aanroeper bepaalt de
 * transactiegrens — zie `schrijfFrozenAlgemeneKostenResultaat` voor de
 * publieke, op zichzelf staande variant). Faalt vóór enige schrijfactie als
 * de parent niet bestaat of geen CONCEPT is.
 *
 * Ontvangt een reeds berekend `HerberekendAlgemeneKostenResultaat` plus de
 * bijbehorende classificatie — herberekent NIETS, valideert GEEN
 * businessregels (lifecycle-validatie zoals "alle vijf categorieën
 * beoordeeld=true"/"geen KRITIEK" is de verantwoordelijkheid van
 * `vaststellen.ts`, vóórdat deze functie wordt aangeroepen).
 */
export function schrijfFrozenAlgemeneKostenResultaatZonderTransactie(
  db: DatabaseSync,
  versieId: string,
  resultaat: HerberekendAlgemeneKostenResultaat,
  classificatie: readonly BgAlgemeneKostenClassificatieRegel[],
): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — frozen Algemene-Kosten-output mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  db.prepare(`DELETE FROM begroting_frozen_algemene_kosten_control WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_algemene_kosten_regel WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_algemene_kosten_categorie WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_algemene_kosten_classificatie WHERE begroting_versie_id = ?`).run(versieId);

  const insertClassificatie = db.prepare(
    `INSERT INTO begroting_frozen_algemene_kosten_classificatie (begroting_versie_id, volgnr, ogb_kostensoort, ogb_kostensoort_omschrijving, categorie)
     VALUES (?, ?, ?, ?, ?)`,
  );
  classificatie.forEach((regel, volgnr) => {
    insertClassificatie.run(versieId, volgnr, regel.ogbKostensoort, regel.ogbKostensoortOmschrijving, regel.categorie);
  });

  const insertCategorie = db.prepare(
    `INSERT INTO begroting_frozen_algemene_kosten_categorie
       (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal, vorig_jaar_bedrag, verwachte_verhoging_percentage, berekend_voorstel, module_totaal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRegel = db.prepare(
    `INSERT INTO begroting_frozen_algemene_kosten_regel
       (begroting_versie_id, regel_id, categorie, ogb_kostensoort_code, ogb_kostensoort_omschrijving, omschrijving, complexnummer, jaarbedrag, financiele_bijdrage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const categorieResultaat of resultaat.perCategorie) {
    insertCategorie.run(
      versieId,
      categorieResultaat.categorie,
      categorieResultaat.beoordeeld ? 1 : 0,
      categorieResultaat.reviewStatus,
      categorieResultaat.categorieTotaal.toString(),
      categorieResultaat.vorigJaarBedrag !== null ? categorieResultaat.vorigJaarBedrag.toString() : null,
      categorieResultaat.verwachteVerhogingPercentage !== null ? categorieResultaat.verwachteVerhogingPercentage.toString() : null,
      categorieResultaat.berekendVoorstel !== null ? categorieResultaat.berekendVoorstel.toString() : null,
      resultaat.moduleTotaal.toString(),
    );

    for (const { persistentieId, regel } of categorieResultaat.regels) {
      const invoer = regel.invoer;
      insertRegel.run(
        versieId,
        persistentieId,
        categorieResultaat.categorie,
        invoer.ogbKostensoortCode,
        regel.ogbKostensoortOmschrijving,
        invoer.omschrijving,
        invoer.complexnummer,
        invoer.jaarbedrag !== null ? invoer.jaarbedrag.toString() : null,
        regel.jaarbedrag.toString(),
      );
    }
  }

  const insertControl = db.prepare(
    `INSERT INTO begroting_frozen_algemene_kosten_control (begroting_versie_id, volgnr, categorie, regel_id, ernst, bericht) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  resultaat.controleVereist.forEach((control, volgnr) => {
    let regelId: number | null = null;
    if (control.regelIndex !== null) {
      const categorieResultaat = resultaat.perCategorie.find((c) => c.categorie === control.categorie);
      const gekoppeld = categorieResultaat?.regels[control.regelIndex];
      if (gekoppeld === undefined) {
        throw new Error(
          `Interne fout: begrotingsversie ${versieId}: control voor categorie ${control.categorie} verwijst naar regelIndex ${control.regelIndex}, buiten bereik van die categorie se regels — correlatie geschonden.`,
        );
      }
      regelId = gekoppeld.persistentieId;
    }
    insertControl.run(versieId, volgnr, control.categorie, regelId, control.ernst, control.bericht);
  });
}

/**
 * Publieke, op zichzelf staande variant: exact
 * `schrijfFrozenAlgemeneKostenResultaatZonderTransactie`, maar binnen haar
 * eigen complete `BEGIN`…`COMMIT`/`ROLLBACK`-transactie.
 */
export function schrijfFrozenAlgemeneKostenResultaat(
  db: DatabaseSync,
  versieId: string,
  resultaat: HerberekendAlgemeneKostenResultaat,
  classificatie: readonly BgAlgemeneKostenClassificatieRegel[],
): void {
  withTransaction(db, () => schrijfFrozenAlgemeneKostenResultaatZonderTransactie(db, versieId, resultaat, classificatie));
}

/**
 * Leest het bevroren Algemene-Kosten-resultaat (incl. de bevroren
 * classificatie) voor een begrotingsversie. `null` als er (nog) geen frozen
 * output is — nooit een default/leeg resultaat.
 *
 * UITSLUITEND frozen tabellen — GEEN aanroep van
 * `berekenBegroteAlgemeneKosten`, GEEN lezen van
 * `algemeneKostenClassificatie.ts`/`algemeneKostenCategorieState.ts`/
 * `algemeneKostenRegels.ts` (levende config/concept-input), GEEN
 * herberekening van categorietotalen/`moduleTotaal`/rekenhulp-voorstel.
 *
 * EXISTENTIE-CHECK VIA DE CATEGORIE-TABEL: een succesvol bevroren resultaat
 * heeft ALTIJD precies 5 categorie-rijen (zie migratie 17); de
 * classificatie kan legitiem leeg zijn (een administratie zonder
 * geconfigureerde OGB-mapping) en is daarom GEEN geschikte
 * existentie-indicator.
 */
export function leesFrozenAlgemeneKostenResultaat(db: DatabaseSync, versieId: string): FrozenAlgemeneKostenResultaat | null {
  const categorieRijen = db
    .prepare(
      `SELECT categorie, beoordeeld, review_status, categorie_totaal, vorig_jaar_bedrag, verwachte_verhoging_percentage, berekend_voorstel, module_totaal
       FROM begroting_frozen_algemene_kosten_categorie
       WHERE begroting_versie_id = ?`,
    )
    .all(versieId) as unknown as CategorieRow[];
  if (categorieRijen.length === 0) {
    return null;
  }

  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId}: frozen Algemene-Kosten-output bestaat, maar de versie zelf is niet leesbaar (interne inconsistentie).`);
  }

  const classificatieRijen = db
    .prepare(
      `SELECT ogb_kostensoort, ogb_kostensoort_omschrijving, categorie
       FROM begroting_frozen_algemene_kosten_classificatie
       WHERE begroting_versie_id = ?
       ORDER BY volgnr`,
    )
    .all(versieId) as unknown as ClassificatieRow[];
  const classificatie: BgAlgemeneKostenClassificatieRegel[] = classificatieRijen.map((rij) => ({
    ogbKostensoort: rij.ogb_kostensoort,
    ogbKostensoortOmschrijving: rij.ogb_kostensoort_omschrijving,
    categorie: rij.categorie,
  }));

  const regelRijen = db
    .prepare(
      `SELECT regel_id, categorie, ogb_kostensoort_code, ogb_kostensoort_omschrijving, omschrijving, complexnummer, jaarbedrag, financiele_bijdrage
       FROM begroting_frozen_algemene_kosten_regel
       WHERE begroting_versie_id = ?
       ORDER BY regel_id`,
    )
    .all(versieId) as unknown as RegelRow[];

  const indexPerPersistentieId = new Map<number, { categorie: BgAlgemeneKostenCategorie; index: number }>();
  const regelsPerCategorie = new Map<BgAlgemeneKostenCategorie, AlgemeneKostenRegelUitkomstMetId[]>();
  for (const rij of regelRijen) {
    const bestaand = regelsPerCategorie.get(rij.categorie) ?? [];
    const index = bestaand.length;
    const invoer: BgAlgemeneKostenRegelInvoer = {
      categorie: rij.categorie,
      ogbKostensoortCode: rij.ogb_kostensoort_code,
      omschrijving: rij.omschrijving,
      complexnummer: rij.complexnummer,
      jaarbedrag: rij.jaarbedrag !== null ? new Decimal(rij.jaarbedrag) : null,
    };
    const regelUitkomst: BgAlgemeneKostenRegelUitkomst = {
      index,
      invoer,
      ogbKostensoortOmschrijving: rij.ogb_kostensoort_omschrijving,
      jaarbedrag: new Decimal(rij.financiele_bijdrage),
    };
    bestaand.push({ persistentieId: rij.regel_id, regel: regelUitkomst });
    regelsPerCategorie.set(rij.categorie, bestaand);
    indexPerPersistentieId.set(rij.regel_id, { categorie: rij.categorie, index });
  }

  // Vaste volgorde `ALGEMENE_KOSTEN_CATEGORIEEN` (zelfde als de pure calculator, zie
  // `begroteAlgemeneKosten.ts`) — GEEN `SELECT`-volgorde van SQLite, die is niet gegarandeerd.
  const categorieRijPerCategorie = new Map(categorieRijen.map((rij) => [rij.categorie, rij]));
  const perCategorie = ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie) => {
    const rij = categorieRijPerCategorie.get(categorie)!;
    const categorieResultaat: HerberekendAlgemeneKostenCategorieResultaat = {
      categorie: rij.categorie,
      beoordeeld: rij.beoordeeld === 1,
      reviewStatus: rij.review_status,
      regels: regelsPerCategorie.get(rij.categorie) ?? [],
      categorieTotaal: new Decimal(rij.categorie_totaal),
      vorigJaarBedrag: rij.vorig_jaar_bedrag !== null ? new Decimal(rij.vorig_jaar_bedrag) : null,
      verwachteVerhogingPercentage: rij.verwachte_verhoging_percentage !== null ? new Decimal(rij.verwachte_verhoging_percentage) : null,
      berekendVoorstel: rij.berekend_voorstel !== null ? new Decimal(rij.berekend_voorstel) : null,
    };
    return categorieResultaat;
  });

  const totaalVoor = (categorie: BgAlgemeneKostenCategorie): Decimal => perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;

  const controlRijen = db
    .prepare(`SELECT categorie, regel_id, ernst, bericht FROM begroting_frozen_algemene_kosten_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
    .all(versieId) as unknown as ControlRow[];
  const controleVereist: BgAlgemeneKostenControleItem[] = controlRijen.map((rij) => {
    let regelIndex: number | null = null;
    if (rij.regel_id !== null) {
      const gevonden = indexPerPersistentieId.get(rij.regel_id);
      if (gevonden === undefined) {
        throw new Error(
          `Interne fout: begrotingsversie ${versieId}: frozen control verwijst naar regel_id ${rij.regel_id}, die niet voorkomt in de frozen regels — inconsistente frozen data.`,
        );
      }
      regelIndex = gevonden.index;
    }
    return { categorie: rij.categorie, regelIndex, ernst: rij.ernst as BgAlgemeneKostenControleErnst, bericht: rij.bericht };
  });

  return {
    begrotingsjaar: versie.begrotingsjaar,
    perCategorie,
    accountantskosten: totaalVoor("ACCOUNTANT"),
    algemeneKosten: totaalVoor("ALGEMENE_KOSTEN"),
    juridischeKosten: totaalVoor("JURIDISCHE_KOSTEN"),
    makelaarskosten: totaalVoor("MAKELAARSKOSTEN"),
    bankkosten: totaalVoor("BANKKOSTEN"),
    // Rechtstreeks uit de (gedenormaliseerde) frozen kolom — bewust GEEN optelling van de vijf
    // categorie_totaal-waarden hier, zie migratie 17's moduledoc.
    moduleTotaal: new Decimal(categorieRijen[0]!.module_totaal),
    controleVereist,
    classificatie,
  };
}
