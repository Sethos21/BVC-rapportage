import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import {
  LEEGSTAND_CATEGORIEEN,
  type BgLeegstandBasisbedragHerkomst,
  type BgLeegstandCategorie,
  type BgLeegstandControleErnst,
  type BgLeegstandControleItem,
  type BgLeegstandRegelInvoer,
  type BgLeegstandRegelUitkomst,
  type BgLeegstandReviewStatus,
} from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import type { HerberekendLeegstandCategorieResultaat, HerberekendLeegstandResultaat, LeegstandRegelUitkomstMetId } from "./herberekenen.js";

/**
 * Persistence voor de bevroren Leegstandskosten-OUTPUT (OB-031, fase P3) —
 * exact zoals `HerberekendLeegstandResultaat`/`@bvc/reporting`'s
 * `begroteLeegstand.ts` op HEAD die kennen; zie migratie 19 in
 * `migrations.ts`. UITSLUITEND serialisatie/deserialisatie — geen formules,
 * geen totalen opnieuw afgeleid, geen aanroep van `berekenBegroteLeegstand`/
 * `herberekenBegroting`.
 *
 * UITSLUITEND DE BEGROTING WORDT BEVROREN — EXPLICIETE ONDERBOUWING WAAROM
 * GEEN FROZEN-CLASSIFICATIE-TABEL NODIG IS (in tegenstelling tot
 * `frozenAlgemeneKostenResultaat.ts`, die de classificatie WEL meebevriest):
 *
 * Bij Algemene Kosten (migratie 16/17) draagt een BEGROTINGSREGEL zelf een
 * `ogb_kostensoort_code`, en de DAARUIT GERESOLVEDE `ogbKostensoortOmschrijving`
 * wordt op de regeluitkomst getoond — de classificatie is dus een
 * INGREDIËNT van het bevroren Begroting-resultaat zelf. Zonder een bevroren
 * kopie zou een latere wijziging van de levende classificatie een reeds
 * VASTGESTELDE regel-omschrijving met terugwerkende kracht kunnen doen
 * veranderen (of erger: laten "verdwijnen" als de code wordt hernoemd) —
 * vandaar dat migratie 17 de VOLLEDIGE resolved classificatie meebevriest.
 *
 * Bij Leegstandskosten is die situatie STRUCTUREEL AFWEZIG: migratie 18's
 * `begroting_leegstand_regel` heeft GEEN `ogb_kostensoort`-kolom — een
 * Leegstand-begrotingsregel bestaat uit categorie + complex(omschrijving) +
 * omschrijving + Q1-Q4, en wordt door `berekenBegroteLeegstand` berekend
 * ZONDER ooit de classificatie te raadplegen (zie `begroteLeegstand.ts`'s
 * moduledoc — `berekenBegroteLeegstand` ontvangt uberhaupt geen
 * classificatie-parameter, anders dan `berekenBegroteAlgemeneKosten`). De
 * classificatie is hier UITSLUITEND een ingrediënt van `berekenWerkelijkLeegstand`
 * — een aparte, bewust NOOIT-gepersisteerde/NOOIT-bevroren berekening (zie
 * hieronder). Er is dus geen enkel bevroren veld waarvan de waarde ooit van
 * de classificatie afhing — bevriezen zou een kopie zijn van iets dat het
 * bevroren resultaat toch al niet gebruikt.
 *
 * WAAROM WERKELIJK/ESTIMATED OOK NIET BEVROREN WORDEN (en dus ook geen
 * bevroren classificatie NODIG hebben): Werkelijk moet per definitie altijd
 * "t/m de laatst afgesloten periode" zijn — een moving target zolang het
 * boekjaar loopt, zowel door nieuwe boekingen als (legitiem) door
 * classificatiecorrecties op reeds geboekte OGB-codes. Bevriezen van
 * Werkelijk (of de classificatie die het voedt) op het moment van
 * Begroting-vaststellen zou deze functionele eis juist TEGENSPREKEN. Omdat
 * Werkelijk/Estimated bewust GEEN onderdeel zijn van `VastgesteldeBegroting`
 * (geen kolom, geen tabel, geen veld — ze worden ALTIJD opnieuw berekend via
 * `berekenWerkelijkLeegstand`/`berekenEstimatedLeegstand` met de dan-actuele
 * classificatie/boekingen als expliciete invoer, zie `begroteLeegstand.ts`),
 * is er ook geen "vastgesteld Werkelijk/Estimated" dat een latere
 * classificatiewijziging zou kunnen aantasten.
 *
 * BEWEZEN, NIET ALLEEN BEREDENEERD: `vaststellen.test.ts`'s
 * "Leegstand frozen-onafhankelijkheid"-testblok toont expliciet dat (a) het
 * bevroren Begroting-resultaat (`leesFrozenLeegstandResultaat`) BYTE-IDENTIEK
 * blijft nadat de levende classificatie ná vaststellen wordt gewijzigd/
 * verwijderd, en (b) een onafhankelijk aangeroepen `berekenWerkelijkLeegstand`
 * daarna correct — en veilig, zonder de frozen tabellen aan te raken — de
 * NIEUWE classificatie gebruikt, precies zoals bedoeld voor een levende
 * Werkelijk-berekening.
 *
 * Strikt gescheiden van `leegstandCategorieState.ts`/`leegstandRegels.ts`
 * (de persistente CONCEPT-input): deze laag leest die tabellen NOOIT terug
 * om een resultaat te reconstrueren.
 *
 * CONTROL → PERSISTENTIE-ID-VERTALING (BINNEN CATEGORIE): exact hetzelfde
 * patroon als `frozenAlgemeneKostenResultaat.ts`.
 *
 * `schrijfFrozenLeegstandResultaatZonderTransactie` is bewust als los,
 * transactievrij bouwblok geëxporteerd (niet via `index.ts`) zodat
 * `stelBegrotingVast` (`vaststellen.ts`) dezelfde schrijflogica kan
 * hergebruiken binnen haar eigen, grotere `BEGIN IMMEDIATE`-transactie.
 */

export type FrozenLeegstandResultaat = HerberekendLeegstandResultaat;

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

interface CategorieRow {
  categorie: BgLeegstandCategorie;
  beoordeeld: number;
  review_status: BgLeegstandReviewStatus;
  categorie_totaal: string;
  laatst_bekend_servicekostenvoorschot_jaar: string | null;
  laatst_bekend_servicekostenvoorschot_jaar_herkomst: BgLeegstandBasisbedragHerkomst | null;
  verwachte_leegstandsperiode_maanden: string | null;
  berekend_voorstel: string | null;
  module_totaal: string;
}

interface RegelRow {
  regel_id: number;
  categorie: BgLeegstandCategorie;
  complexnummer: string | null;
  complexomschrijving: string | null;
  omschrijving: string;
  q1: string | null;
  q2: string | null;
  q3: string | null;
  q4: string | null;
  totaal: string;
}

interface ControlRow {
  categorie: BgLeegstandCategorie;
  regel_id: number | null;
  ernst: string;
  bericht: string;
}

/**
 * Schrijft het COMPLETE bevroren Leegstandskosten-Begroting-resultaat voor
 * één begrotingsversie — vervangt, geen gedeeltelijke state. GEEN eigen
 * transactie (de aanroeper bepaalt de transactiegrens — zie
 * `schrijfFrozenLeegstandResultaat` voor de publieke, op zichzelf staande
 * variant). Faalt vóór enige schrijfactie als de parent niet bestaat of geen
 * CONCEPT is.
 *
 * Ontvangt een reeds berekend `HerberekendLeegstandResultaat` — herberekent
 * NIETS, valideert GEEN businessregels (lifecycle-validatie zoals "alle drie
 * categorieën beoordeeld=true"/"geen KRITIEK" is de verantwoordelijkheid van
 * `vaststellen.ts`, vóórdat deze functie wordt aangeroepen).
 */
export function schrijfFrozenLeegstandResultaatZonderTransactie(db: DatabaseSync, versieId: string, resultaat: HerberekendLeegstandResultaat): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — frozen Leegstand-output mag uitsluitend op een CONCEPT-versie worden geschreven.`);
  }

  db.prepare(`DELETE FROM begroting_frozen_leegstand_control WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_leegstand_regel WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_leegstand_categorie WHERE begroting_versie_id = ?`).run(versieId);

  const insertCategorie = db.prepare(
    `INSERT INTO begroting_frozen_leegstand_categorie
       (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal, laatst_bekend_servicekostenvoorschot_jaar, laatst_bekend_servicekostenvoorschot_jaar_herkomst, verwachte_leegstandsperiode_maanden, berekend_voorstel, module_totaal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRegel = db.prepare(
    `INSERT INTO begroting_frozen_leegstand_regel
       (begroting_versie_id, regel_id, categorie, complexnummer, complexomschrijving, omschrijving, q1, q2, q3, q4, totaal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const categorieResultaat of resultaat.perCategorie) {
    insertCategorie.run(
      versieId,
      categorieResultaat.categorie,
      categorieResultaat.beoordeeld ? 1 : 0,
      categorieResultaat.reviewStatus,
      categorieResultaat.categorieTotaal.toString(),
      categorieResultaat.laatstBekendServicekostenvoorschotJaar !== null ? categorieResultaat.laatstBekendServicekostenvoorschotJaar.toString() : null,
      categorieResultaat.laatstBekendServicekostenvoorschotJaarHerkomst,
      categorieResultaat.verwachteLeegstandsperiodeMaanden !== null ? categorieResultaat.verwachteLeegstandsperiodeMaanden.toString() : null,
      categorieResultaat.berekendVoorstel !== null ? categorieResultaat.berekendVoorstel.toString() : null,
      resultaat.moduleTotaal.toString(),
    );

    for (const { persistentieId, regel } of categorieResultaat.regels) {
      const invoer = regel.invoer;
      insertRegel.run(
        versieId,
        persistentieId,
        categorieResultaat.categorie,
        invoer.complexnummer,
        invoer.complexomschrijving,
        invoer.omschrijving,
        invoer.q1 !== null ? invoer.q1.toString() : null,
        invoer.q2 !== null ? invoer.q2.toString() : null,
        invoer.q3 !== null ? invoer.q3.toString() : null,
        invoer.q4 !== null ? invoer.q4.toString() : null,
        regel.totaal.toString(),
      );
    }
  }

  const insertControl = db.prepare(
    `INSERT INTO begroting_frozen_leegstand_control (begroting_versie_id, volgnr, categorie, regel_id, ernst, bericht) VALUES (?, ?, ?, ?, ?, ?)`,
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
 * `schrijfFrozenLeegstandResultaatZonderTransactie`, maar binnen haar eigen
 * complete `BEGIN`…`COMMIT`/`ROLLBACK`-transactie.
 */
export function schrijfFrozenLeegstandResultaat(db: DatabaseSync, versieId: string, resultaat: HerberekendLeegstandResultaat): void {
  withTransaction(db, () => schrijfFrozenLeegstandResultaatZonderTransactie(db, versieId, resultaat));
}

/**
 * Leest het bevroren Leegstandskosten-Begroting-resultaat voor een
 * begrotingsversie. `null` als er (nog) geen frozen output is — nooit een
 * default/leeg resultaat.
 *
 * UITSLUITEND frozen tabellen — GEEN aanroep van `berekenBegroteLeegstand`,
 * GEEN lezen van `leegstandCategorieState.ts`/`leegstandRegels.ts`
 * (concept-input), GEEN herberekening van categorietotalen/`moduleTotaal`/
 * rekenhulp-voorstel.
 *
 * EXISTENTIE-CHECK VIA DE CATEGORIE-TABEL: een succesvol bevroren resultaat
 * heeft ALTIJD precies 3 categorie-rijen (zie migratie 19).
 */
export function leesFrozenLeegstandResultaat(db: DatabaseSync, versieId: string): FrozenLeegstandResultaat | null {
  const categorieRijen = db
    .prepare(
      `SELECT categorie, beoordeeld, review_status, categorie_totaal, laatst_bekend_servicekostenvoorschot_jaar, laatst_bekend_servicekostenvoorschot_jaar_herkomst, verwachte_leegstandsperiode_maanden, berekend_voorstel, module_totaal
       FROM begroting_frozen_leegstand_categorie
       WHERE begroting_versie_id = ?`,
    )
    .all(versieId) as unknown as CategorieRow[];
  if (categorieRijen.length === 0) {
    return null;
  }

  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId}: frozen Leegstand-output bestaat, maar de versie zelf is niet leesbaar (interne inconsistentie).`);
  }

  const regelRijen = db
    .prepare(
      `SELECT regel_id, categorie, complexnummer, complexomschrijving, omschrijving, q1, q2, q3, q4, totaal
       FROM begroting_frozen_leegstand_regel
       WHERE begroting_versie_id = ?
       ORDER BY regel_id`,
    )
    .all(versieId) as unknown as RegelRow[];

  const indexPerPersistentieId = new Map<number, { categorie: BgLeegstandCategorie; index: number }>();
  const regelsPerCategorie = new Map<BgLeegstandCategorie, LeegstandRegelUitkomstMetId[]>();
  for (const rij of regelRijen) {
    const bestaand = regelsPerCategorie.get(rij.categorie) ?? [];
    const index = bestaand.length;
    const invoer: BgLeegstandRegelInvoer = {
      categorie: rij.categorie,
      complexnummer: rij.complexnummer,
      complexomschrijving: rij.complexomschrijving,
      omschrijving: rij.omschrijving,
      q1: rij.q1 !== null ? new Decimal(rij.q1) : null,
      q2: rij.q2 !== null ? new Decimal(rij.q2) : null,
      q3: rij.q3 !== null ? new Decimal(rij.q3) : null,
      q4: rij.q4 !== null ? new Decimal(rij.q4) : null,
    };
    const totaal = new Decimal(rij.totaal);
    const regelUitkomst: BgLeegstandRegelUitkomst = {
      index,
      invoer,
      q1: invoer.q1 ?? new Decimal(0),
      q2: invoer.q2 ?? new Decimal(0),
      q3: invoer.q3 ?? new Decimal(0),
      q4: invoer.q4 ?? new Decimal(0),
      totaal,
    };
    bestaand.push({ persistentieId: rij.regel_id, regel: regelUitkomst });
    regelsPerCategorie.set(rij.categorie, bestaand);
    indexPerPersistentieId.set(rij.regel_id, { categorie: rij.categorie, index });
  }

  // Vaste volgorde `LEEGSTAND_CATEGORIEEN` (zelfde als de pure calculator) — GEEN `SELECT`-volgorde van SQLite, die is niet gegarandeerd.
  const categorieRijPerCategorie = new Map(categorieRijen.map((rij) => [rij.categorie, rij]));
  const perCategorie = LEEGSTAND_CATEGORIEEN.map((categorie) => {
    const rij = categorieRijPerCategorie.get(categorie)!;
    const categorieResultaat: HerberekendLeegstandCategorieResultaat = {
      categorie: rij.categorie,
      beoordeeld: rij.beoordeeld === 1,
      reviewStatus: rij.review_status,
      regels: regelsPerCategorie.get(rij.categorie) ?? [],
      categorieTotaal: new Decimal(rij.categorie_totaal),
      laatstBekendServicekostenvoorschotJaar: rij.laatst_bekend_servicekostenvoorschot_jaar !== null ? new Decimal(rij.laatst_bekend_servicekostenvoorschot_jaar) : null,
      laatstBekendServicekostenvoorschotJaarHerkomst: rij.laatst_bekend_servicekostenvoorschot_jaar_herkomst,
      verwachteLeegstandsperiodeMaanden: rij.verwachte_leegstandsperiode_maanden !== null ? new Decimal(rij.verwachte_leegstandsperiode_maanden) : null,
      berekendVoorstel: rij.berekend_voorstel !== null ? new Decimal(rij.berekend_voorstel) : null,
    };
    return categorieResultaat;
  });

  const totaalVoor = (categorie: BgLeegstandCategorie): Decimal => perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;

  const controlRijen = db
    .prepare(`SELECT categorie, regel_id, ernst, bericht FROM begroting_frozen_leegstand_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
    .all(versieId) as unknown as ControlRow[];
  const controleVereist: BgLeegstandControleItem[] = controlRijen.map((rij) => {
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
    return { categorie: rij.categorie, regelIndex, ernst: rij.ernst as BgLeegstandControleErnst, bericht: rij.bericht };
  });

  return {
    begrotingsjaar: versie.begrotingsjaar,
    perCategorie,
    nutsLeegstand: totaalVoor("NUTS_LEEGSTAND"),
    servicekostenLeegstand: totaalVoor("SERVICEKOSTEN_LEEGSTAND"),
    overigeLeegstandskosten: totaalVoor("OVERIGE_LEEGSTANDSKOSTEN"),
    // Rechtstreeks uit de (gedenormaliseerde) frozen kolom — bewust GEEN optelling van de drie
    // categorie_totaal-waarden hier, zie migratie 19's moduledoc.
    moduleTotaal: new Decimal(categorieRijen[0]!.module_totaal),
    controleVereist,
  };
}
