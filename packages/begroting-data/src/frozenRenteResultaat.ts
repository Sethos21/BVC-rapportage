import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import { RENTE_CATEGORIEEN, type BgRenteCategorie, type BgRenteControleErnst, type BgRenteControleItem, type BgRenteRegelInvoer, type BgRenteRegelUitkomst, type BgRenteReviewStatus } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";
import type { HerberekendRenteCategorieResultaat, HerberekendRenteResultaat, RenteRegelUitkomstMetId } from "./herberekenen.js";

/**
 * Persistence voor de bevroren Rente-OUTPUT (OB-037/038, fase P3) — exact
 * zoals `HerberekendRenteResultaat`/`@bvc/reporting`'s `begroteRente.ts` op
 * HEAD die kennen; zie migratie 21 in `migrations.ts`. UITSLUITEND
 * serialisatie/deserialisatie — geen formules, geen totalen opnieuw
 * afgeleid, geen aanroep van `berekenBegroteRente`/`herberekenBegroting`.
 *
 * UITSLUITEND DE BEGROTING WORDT BEVROREN — zelfde architectuurregel als
 * `frozenLeegstandResultaat.ts`: Werkelijk/Estimated blijven per ontwerp
 * ALTIJD een live herberekening tegen de actuele boekhouding/classificatie,
 * ook ná vaststellen. GEEN frozen-classificatietabel: een Rente-
 * begrotingsregel heeft geen OGB-koppeling (zie migratie 20) — `ogb_referentie`
 * is een puur informatief tekstveld, geen classificatie, dus wordt het
 * gewoon ALS TYPED bevroren, zonder enige lookup.
 *
 * GEEN GEDENORMALISEERD MODULETOTAAL: Rentekosten en Rente opbrengsten zijn
 * twee afzonderlijke P&L-posten (zie `begroteRente.ts`'s moduledoc) — er is
 * dus geen enkele afgeleide "module"-waarde om te bevriezen of per ongeluk
 * opnieuw te berekenen.
 *
 * Strikt gescheiden van `renteCategorieState.ts`/`renteRegels.ts` (de
 * persistente CONCEPT-input): deze laag leest die tabellen NOOIT terug om
 * een resultaat te reconstrueren.
 *
 * CONTROL → PERSISTENTIE-ID-VERTALING (BINNEN CATEGORIE): exact hetzelfde
 * patroon als `frozenLeegstandResultaat.ts`.
 *
 * `schrijfFrozenRenteResultaatZonderTransactie` is bewust als los,
 * transactievrij bouwblok geëxporteerd (niet via `index.ts`) zodat
 * `stelBegrotingVast` (`vaststellen.ts`) dezelfde schrijflogica kan
 * hergebruiken binnen haar eigen, grotere `BEGIN IMMEDIATE`-transactie.
 */

export type FrozenRenteResultaat = HerberekendRenteResultaat;

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
  categorie: BgRenteCategorie;
  beoordeeld: number;
  review_status: BgRenteReviewStatus;
  categorie_totaal: string;
}

interface RegelRow {
  regel_id: number;
  categorie: BgRenteCategorie;
  omschrijving: string;
  complexnummer: string | null;
  ogb_referentie: string | null;
  laatst_bekend_saldo: string | null;
  rentepercentage: string | null;
  begrotingsbedrag: string | null;
  berekend_voorstel: string | null;
  bedrag: string;
}

interface ControlRow {
  categorie: BgRenteCategorie;
  regel_id: number | null;
  ernst: string;
  bericht: string;
}

/**
 * Schrijft het COMPLETE bevroren Rente-Begroting-resultaat voor één
 * begrotingsversie — vervangt, geen gedeeltelijke state. GEEN eigen
 * transactie (de aanroeper bepaalt de transactiegrens — zie
 * `schrijfFrozenRenteResultaat` voor de publieke, op zichzelf staande
 * variant). Faalt vóór enige schrijfactie als de parent niet bestaat of geen
 * CONCEPT is.
 *
 * Ontvangt een reeds berekend `HerberekendRenteResultaat` — herberekent
 * NIETS, valideert GEEN businessregels (lifecycle-validatie zoals "beide
 * categorieën beoordeeld=true"/"geen KRITIEK" is de verantwoordelijkheid van
 * `vaststellen.ts`, vóórdat deze functie wordt aangeroepen).
 */
export function schrijfFrozenRenteResultaatZonderTransactie(db: DatabaseSync, versieId: string, resultaat: HerberekendRenteResultaat): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(`Begrotingsversie ${versieId} heeft status ${versie.status} — frozen Rente-output mag uitsluitend op een CONCEPT-versie worden geschreven.`);
  }

  db.prepare(`DELETE FROM begroting_frozen_rente_control WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_rente_regel WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_rente_categorie WHERE begroting_versie_id = ?`).run(versieId);

  const insertCategorie = db.prepare(
    `INSERT INTO begroting_frozen_rente_categorie (begroting_versie_id, categorie, beoordeeld, review_status, categorie_totaal) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertRegel = db.prepare(
    `INSERT INTO begroting_frozen_rente_regel
       (begroting_versie_id, regel_id, categorie, omschrijving, complexnummer, ogb_referentie, laatst_bekend_saldo, rentepercentage, begrotingsbedrag, berekend_voorstel, bedrag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const categorieResultaat of resultaat.perCategorie) {
    insertCategorie.run(versieId, categorieResultaat.categorie, categorieResultaat.beoordeeld ? 1 : 0, categorieResultaat.reviewStatus, categorieResultaat.categorieTotaal.toString());

    for (const { persistentieId, regel } of categorieResultaat.regels) {
      const invoer = regel.invoer;
      insertRegel.run(
        versieId,
        persistentieId,
        categorieResultaat.categorie,
        invoer.omschrijving,
        invoer.complexnummer,
        invoer.ogbReferentie,
        invoer.laatstBekendSaldo !== null ? invoer.laatstBekendSaldo.toString() : null,
        invoer.rentepercentage !== null ? invoer.rentepercentage.toString() : null,
        invoer.begrotingsbedrag !== null ? invoer.begrotingsbedrag.toString() : null,
        regel.berekendVoorstel !== null ? regel.berekendVoorstel.toString() : null,
        regel.bedrag.toString(),
      );
    }
  }

  const insertControl = db.prepare(`INSERT INTO begroting_frozen_rente_control (begroting_versie_id, volgnr, categorie, regel_id, ernst, bericht) VALUES (?, ?, ?, ?, ?, ?)`);
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
 * `schrijfFrozenRenteResultaatZonderTransactie`, maar binnen haar eigen
 * complete `BEGIN`…`COMMIT`/`ROLLBACK`-transactie.
 */
export function schrijfFrozenRenteResultaat(db: DatabaseSync, versieId: string, resultaat: HerberekendRenteResultaat): void {
  withTransaction(db, () => schrijfFrozenRenteResultaatZonderTransactie(db, versieId, resultaat));
}

/**
 * Leest het bevroren Rente-Begroting-resultaat voor een begrotingsversie.
 * `null` als er (nog) geen frozen output is — nooit een default/leeg
 * resultaat.
 *
 * UITSLUITEND frozen tabellen — GEEN aanroep van `berekenBegroteRente`, GEEN
 * lezen van `renteCategorieState.ts`/`renteRegels.ts` (concept-input), GEEN
 * herberekening van categorietotalen/rekenhulp-voorstel.
 *
 * EXISTENTIE-CHECK VIA DE CATEGORIE-TABEL: een succesvol bevroren resultaat
 * heeft ALTIJD precies 2 categorie-rijen (zie migratie 21).
 */
export function leesFrozenRenteResultaat(db: DatabaseSync, versieId: string): FrozenRenteResultaat | null {
  const categorieRijen = db
    .prepare(`SELECT categorie, beoordeeld, review_status, categorie_totaal FROM begroting_frozen_rente_categorie WHERE begroting_versie_id = ?`)
    .all(versieId) as unknown as CategorieRow[];
  if (categorieRijen.length === 0) {
    return null;
  }

  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId}: frozen Rente-output bestaat, maar de versie zelf is niet leesbaar (interne inconsistentie).`);
  }

  const regelRijen = db
    .prepare(
      `SELECT regel_id, categorie, omschrijving, complexnummer, ogb_referentie, laatst_bekend_saldo, rentepercentage, begrotingsbedrag, berekend_voorstel, bedrag
       FROM begroting_frozen_rente_regel
       WHERE begroting_versie_id = ?
       ORDER BY regel_id`,
    )
    .all(versieId) as unknown as RegelRow[];

  const indexPerPersistentieId = new Map<number, { categorie: BgRenteCategorie; index: number }>();
  const regelsPerCategorie = new Map<BgRenteCategorie, RenteRegelUitkomstMetId[]>();
  for (const rij of regelRijen) {
    const bestaand = regelsPerCategorie.get(rij.categorie) ?? [];
    const index = bestaand.length;
    const invoer: BgRenteRegelInvoer = {
      categorie: rij.categorie,
      omschrijving: rij.omschrijving,
      complexnummer: rij.complexnummer,
      ogbReferentie: rij.ogb_referentie,
      laatstBekendSaldo: rij.laatst_bekend_saldo !== null ? new Decimal(rij.laatst_bekend_saldo) : null,
      rentepercentage: rij.rentepercentage !== null ? new Decimal(rij.rentepercentage) : null,
      begrotingsbedrag: rij.begrotingsbedrag !== null ? new Decimal(rij.begrotingsbedrag) : null,
    };
    const regelUitkomst: BgRenteRegelUitkomst = {
      index,
      invoer,
      berekendVoorstel: rij.berekend_voorstel !== null ? new Decimal(rij.berekend_voorstel) : null,
      bedrag: new Decimal(rij.bedrag),
    };
    bestaand.push({ persistentieId: rij.regel_id, regel: regelUitkomst });
    regelsPerCategorie.set(rij.categorie, bestaand);
    indexPerPersistentieId.set(rij.regel_id, { categorie: rij.categorie, index });
  }

  // Vaste volgorde `RENTE_CATEGORIEEN` (zelfde als de pure calculator) — GEEN `SELECT`-volgorde van SQLite, die is niet gegarandeerd.
  const categorieRijPerCategorie = new Map(categorieRijen.map((rij) => [rij.categorie, rij]));
  const perCategorie = RENTE_CATEGORIEEN.map((categorie) => {
    const rij = categorieRijPerCategorie.get(categorie)!;
    const categorieResultaat: HerberekendRenteCategorieResultaat = {
      categorie: rij.categorie,
      beoordeeld: rij.beoordeeld === 1,
      reviewStatus: rij.review_status,
      regels: regelsPerCategorie.get(rij.categorie) ?? [],
      categorieTotaal: new Decimal(rij.categorie_totaal),
    };
    return categorieResultaat;
  });

  const totaalVoor = (categorie: BgRenteCategorie): Decimal => perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal;

  const controlRijen = db
    .prepare(`SELECT categorie, regel_id, ernst, bericht FROM begroting_frozen_rente_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
    .all(versieId) as unknown as ControlRow[];
  const controleVereist: BgRenteControleItem[] = controlRijen.map((rij) => {
    let regelIndex: number | null = null;
    if (rij.regel_id !== null) {
      const gevonden = indexPerPersistentieId.get(rij.regel_id);
      if (gevonden === undefined) {
        throw new Error(`Interne fout: begrotingsversie ${versieId}: frozen control verwijst naar regel_id ${rij.regel_id}, die niet voorkomt in de frozen regels — inconsistente frozen data.`);
      }
      regelIndex = gevonden.index;
    }
    return { categorie: rij.categorie, regelIndex, ernst: rij.ernst as BgRenteControleErnst, bericht: rij.bericht };
  });

  return {
    begrotingsjaar: versie.begrotingsjaar,
    perCategorie,
    rentekosten: totaalVoor("RENTEKOSTEN"),
    renteOpbrengsten: totaalVoor("RENTE_OPBRENGSTEN"),
    controleVereist,
  };
}
