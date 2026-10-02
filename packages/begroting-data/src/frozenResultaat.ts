import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type {
  BgBeheerComplexUitkomst,
  BgBeheerControleItem,
  BgBeheerMaandRegel,
  BgBeheerResultaat,
  BgBelastOnbelast,
  BgContractUitkomst,
  BgControleItem,
  BgHuurMaandRegel,
  BgHuurResultaat,
  BgOverrideScope,
} from "@bvc/reporting";
import { leesBegrotingsversie, type Begrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de bevroren Module-1/Module-2-OUTPUT (`BgHuurResultaat`/
 * `BgBeheerResultaat`, exact zoals HEAD die kent — zie migratie 5 in
 * `migrations.ts` voor de volledige mapping-motivatie, incl. welke velden
 * bewust NIET gedupliceerd worden). UITSLUITEND serialisatie/deserialisatie
 * — geen formules, geen totalen/controles opnieuw afgeleid, geen aanroep
 * van `berekenBegroteHuuropbrengsten`/`berekenBegroteBeheersvergoeding`/
 * `herberekenBegroting`.
 *
 * `schrijfFrozenBegrotingsresultaatZonderTransactie` is bewust als los,
 * transactievrij bouwblok geexporteerd (niet via `index.ts` - intern
 * hergebruik, zelfde grens als `markeerVastgesteld` in
 * `begrotingsversies.ts`) zodat Fase 1D.6b's `stelBegrotingVast`
 * (`vaststellen.ts`) exact dezelfde schrijflogica kan hergebruiken binnen
 * haar eigen, grotere schrijftransactie - zonder de geneste-`BEGIN`-val van
 * `schrijfFrozenBegrotingsresultaat`'s eigen transactie.
 */
export interface FrozenBegrotingsresultaat {
  module1: BgHuurResultaat;
  module2: BgBeheerResultaat;
}

/** Businessdatum ↔ kale `YYYY-MM-DD` (UTC-kalenderdag) — vierde plek met exact deze conversie, bewust nog steeds gedupliceerd (zie 1D.6a-rapport). */
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

interface Module1ResultaatRow {
  indexatie_percentage_algemeen: string;
  portefeuille_bruto_huur_zonder_indexatie: string;
  portefeuille_indexatie_effect: string;
  portefeuille_bruto_huur_met_indexatie: string;
  portefeuille_huurkorting: string;
  portefeuille_netto_huur: string;
  portefeuille_netto_huur_belast: string;
  portefeuille_netto_huur_onbelast: string;
  portefeuille_netto_huur_onbekende_btw: string;
}

interface Module1ContractRow {
  contractnummer: string;
  huurdernummer: string | null;
  huurder_naam: string | null;
  complexnummer: string | null;
  belast_onbelast: string;
  indexatie_percentage_gebruikt: string;
  indexatie_percentage_bron: string;
  override_scope: string | null;
  override_reden: string | null;
  effectieve_indexatiedatum: string | null;
  jaartotaal_bruto_huur_zonder_indexatie: string;
  jaartotaal_indexatie_effect: string;
  jaartotaal_bruto_huur_met_indexatie: string;
  jaartotaal_huurkorting: string;
  jaartotaal_netto_huur: string;
}

interface Module1MaandregelRow {
  maand: number;
  bruto_huur_zonder_indexatie: string;
  indexatie_effect: string;
  bruto_huur_met_indexatie: string;
  huurkorting: string;
  netto_huur: string;
  kortingswijziging_toegepast: string | null;
}

interface ControlRow {
  contractnummer: string | null;
  ernst: string;
  bericht: string;
}

interface Module2ResultaatRow {
  portefeuille_netto_huur_grondslag: string;
  portefeuille_vast_voor_indexatie: string;
  portefeuille_vast_indexatie_effect: string;
  portefeuille_vast_na_indexatie: string;
  portefeuille_variabele_vergoeding: string;
  portefeuille_totale_vergoeding: string;
}

interface Module2ComplexRow {
  complexnummer: string;
  vast_toegepast: number;
  variabel_toegepast: number;
  variabel_percentage_gebruikt: string | null;
  jaartotaal_netto_huur_grondslag: string;
  jaartotaal_vast_voor_indexatie: string;
  jaartotaal_vast_indexatie_effect: string;
  jaartotaal_vast_na_indexatie: string;
  jaartotaal_variabele_vergoeding: string;
  jaartotaal_totale_vergoeding: string;
}

interface Module2MaandregelRow {
  maand: number;
  vast_voor_indexatie: string;
  vast_indexatie_effect: string;
  vast_na_indexatie: string;
  variabele_vergoeding: string;
  totale_vergoeding: string;
}

interface Module2ControlRow {
  complexnummer: string | null;
  ernst: string;
  bericht: string;
}

/**
 * Schrijft het COMPLETE bevroren Module-1+Module-2-resultaat voor één
 * begrotingsversie — vervangt, geen gedeeltelijke Module-1/Module-2-state.
 * GEEN eigen transactie (de aanroeper bepaalt de transactiegrens; zie
 * `schrijfFrozenBegrotingsresultaat` voor de publieke, op zichzelf staande
 * variant en `stelBegrotingVast` (`vaststellen.ts`) voor hergebruik binnen
 * één grotere schrijftransactie). Faalt vóór enige schrijfactie als de
 * parent niet bestaat, geen CONCEPT is, of als `begrotingsjaar`/
 * `bronPeildatum` in het resultaat niet overeenkomen met de parent-versie —
 * dit zijn geen nieuwe businessregels, maar reeds bestaande structurele
 * invarianten (`herberekenBegroting` geeft deze waarden altijd ongewijzigd
 * door vanuit de versie).
 */
export function schrijfFrozenBegrotingsresultaatZonderTransactie(db: DatabaseSync, versieId: string, resultaat: FrozenBegrotingsresultaat): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — frozen output mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }
  if (resultaat.module1.begrotingsjaar !== versie.begrotingsjaar) {
    throw new Error(
      `Module-1-resultaat begrotingsjaar (${resultaat.module1.begrotingsjaar}) komt niet overeen met begrotingsversie ${versieId} (${versie.begrotingsjaar}).`,
    );
  }
  if (resultaat.module2.begrotingsjaar !== versie.begrotingsjaar) {
    throw new Error(
      `Module-2-resultaat begrotingsjaar (${resultaat.module2.begrotingsjaar}) komt niet overeen met begrotingsversie ${versieId} (${versie.begrotingsjaar}).`,
    );
  }
  if (formatBusinessDate(resultaat.module1.bronPeildatum) !== formatBusinessDate(versie.bronPeildatum)) {
    throw new Error(`Module-1-resultaat bronPeildatum komt niet overeen met begrotingsversie ${versieId}.`);
  }

  {
    db.prepare(`DELETE FROM begroting_frozen_module1_control WHERE begroting_versie_id = ?`).run(versieId);
    db.prepare(`DELETE FROM begroting_frozen_module1_maandregel WHERE begroting_versie_id = ?`).run(versieId);
    db.prepare(`DELETE FROM begroting_frozen_module1_contract WHERE begroting_versie_id = ?`).run(versieId);
    db.prepare(`DELETE FROM begroting_frozen_module1_resultaat WHERE begroting_versie_id = ?`).run(versieId);
    db.prepare(`DELETE FROM begroting_frozen_module2_control WHERE begroting_versie_id = ?`).run(versieId);
    db.prepare(`DELETE FROM begroting_frozen_module2_maandregel WHERE begroting_versie_id = ?`).run(versieId);
    db.prepare(`DELETE FROM begroting_frozen_module2_complex WHERE begroting_versie_id = ?`).run(versieId);
    db.prepare(`DELETE FROM begroting_frozen_module2_resultaat WHERE begroting_versie_id = ?`).run(versieId);

    const m1 = resultaat.module1;
    db.prepare(
      `INSERT INTO begroting_frozen_module1_resultaat
         (begroting_versie_id, indexatie_percentage_algemeen,
          portefeuille_bruto_huur_zonder_indexatie, portefeuille_indexatie_effect, portefeuille_bruto_huur_met_indexatie,
          portefeuille_huurkorting, portefeuille_netto_huur,
          portefeuille_netto_huur_belast, portefeuille_netto_huur_onbelast, portefeuille_netto_huur_onbekende_btw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      versieId,
      m1.indexatiePercentageAlgemeen.toString(),
      m1.portefeuilleTotalen.brutoHuurZonderIndexatie.toString(),
      m1.portefeuilleTotalen.indexatieEffect.toString(),
      m1.portefeuilleTotalen.brutoHuurMetIndexatie.toString(),
      m1.portefeuilleTotalen.huurkorting.toString(),
      m1.portefeuilleTotalen.nettoHuur.toString(),
      m1.portefeuilleTotalen.nettoHuurBelast.toString(),
      m1.portefeuilleTotalen.nettoHuurOnbelast.toString(),
      m1.portefeuilleTotalen.nettoHuurOnbekendeBtw.toString(),
    );

    const insertContract = db.prepare(
      `INSERT INTO begroting_frozen_module1_contract
         (begroting_versie_id, contractnummer, volgnr, huurdernummer, huurder_naam, complexnummer,
          belast_onbelast, indexatie_percentage_gebruikt, indexatie_percentage_bron, override_scope, override_reden,
          effectieve_indexatiedatum,
          jaartotaal_bruto_huur_zonder_indexatie, jaartotaal_indexatie_effect, jaartotaal_bruto_huur_met_indexatie,
          jaartotaal_huurkorting, jaartotaal_netto_huur)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMaandregel1 = db.prepare(
      `INSERT INTO begroting_frozen_module1_maandregel
         (begroting_versie_id, contractnummer, maand,
          bruto_huur_zonder_indexatie, indexatie_effect, bruto_huur_met_indexatie, huurkorting, netto_huur,
          kortingswijziging_toegepast)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    m1.contracten.forEach((contract, volgnr) => {
      insertContract.run(
        versieId,
        contract.contractnummer,
        volgnr,
        contract.huurdernummer,
        contract.huurderNaam,
        contract.complexnummer,
        contract.belastOnbelast,
        contract.indexatiePercentageGebruikt.toString(),
        contract.indexatiePercentageBron,
        contract.overrideToegepast !== null ? contract.overrideToegepast.scope : null,
        contract.overrideToegepast !== null ? contract.overrideToegepast.reden : null,
        optioneleBusinessDate(contract.effectieveIndexatiedatum),
        contract.jaartotaal.brutoHuurZonderIndexatie.toString(),
        contract.jaartotaal.indexatieEffect.toString(),
        contract.jaartotaal.brutoHuurMetIndexatie.toString(),
        contract.jaartotaal.huurkorting.toString(),
        contract.jaartotaal.nettoHuur.toString(),
      );

      for (const regel of contract.regels) {
        insertMaandregel1.run(
          versieId,
          contract.contractnummer,
          regel.maand,
          regel.brutoHuurZonderIndexatie.toString(),
          regel.indexatieEffect.toString(),
          regel.brutoHuurMetIndexatie.toString(),
          regel.huurkorting.toString(),
          regel.nettoHuur.toString(),
          optioneleBusinessDate(regel.kortingswijzigingToegepast),
        );
      }
    });

    const insertControl1 = db.prepare(
      `INSERT INTO begroting_frozen_module1_control (begroting_versie_id, volgnr, contractnummer, ernst, bericht) VALUES (?, ?, ?, ?, ?)`,
    );
    m1.controleVereist.forEach((control, volgnr) => {
      insertControl1.run(versieId, volgnr, control.contractnummer, control.ernst, control.bericht);
    });

    const m2 = resultaat.module2;
    db.prepare(
      `INSERT INTO begroting_frozen_module2_resultaat
         (begroting_versie_id, portefeuille_netto_huur_grondslag, portefeuille_vast_voor_indexatie,
          portefeuille_vast_indexatie_effect, portefeuille_vast_na_indexatie,
          portefeuille_variabele_vergoeding, portefeuille_totale_vergoeding)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      versieId,
      m2.portefeuilleTotalen.nettoHuurGrondslag.toString(),
      m2.portefeuilleTotalen.vastVoorIndexatie.toString(),
      m2.portefeuilleTotalen.vastIndexatieEffect.toString(),
      m2.portefeuilleTotalen.vastNaIndexatie.toString(),
      m2.portefeuilleTotalen.variabeleVergoeding.toString(),
      m2.portefeuilleTotalen.totaleVergoeding.toString(),
    );

    const insertComplex = db.prepare(
      `INSERT INTO begroting_frozen_module2_complex
         (begroting_versie_id, complexnummer, volgnr, vast_toegepast, variabel_toegepast, variabel_percentage_gebruikt,
          jaartotaal_netto_huur_grondslag, jaartotaal_vast_voor_indexatie, jaartotaal_vast_indexatie_effect,
          jaartotaal_vast_na_indexatie, jaartotaal_variabele_vergoeding, jaartotaal_totale_vergoeding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMaandregel2 = db.prepare(
      `INSERT INTO begroting_frozen_module2_maandregel
         (begroting_versie_id, complexnummer, maand, vast_voor_indexatie, vast_indexatie_effect, vast_na_indexatie,
          variabele_vergoeding, totale_vergoeding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    m2.complexen.forEach((complex, volgnr) => {
      insertComplex.run(
        versieId,
        complex.complexnummer,
        volgnr,
        complex.vastToegepast ? 1 : 0,
        complex.variabelToegepast ? 1 : 0,
        complex.variabelPercentageGebruikt !== null ? complex.variabelPercentageGebruikt.toString() : null,
        complex.jaartotaal.nettoHuurGrondslag.toString(),
        complex.jaartotaal.vastVoorIndexatie.toString(),
        complex.jaartotaal.vastIndexatieEffect.toString(),
        complex.jaartotaal.vastNaIndexatie.toString(),
        complex.jaartotaal.variabeleVergoeding.toString(),
        complex.jaartotaal.totaleVergoeding.toString(),
      );

      for (const regel of complex.regels) {
        insertMaandregel2.run(
          versieId,
          complex.complexnummer,
          regel.maand,
          regel.vastVoorIndexatie.toString(),
          regel.vastIndexatieEffect.toString(),
          regel.vastNaIndexatie.toString(),
          regel.variabeleVergoeding.toString(),
          regel.totaleVergoeding.toString(),
        );
      }
    });

    const insertControl2 = db.prepare(
      `INSERT INTO begroting_frozen_module2_control (begroting_versie_id, volgnr, complexnummer, ernst, bericht) VALUES (?, ?, ?, ?, ?)`,
    );
    m2.controleVereist.forEach((control, volgnr) => {
      insertControl2.run(versieId, volgnr, control.complexnummer, control.ernst, control.bericht);
    });
  }
}

/**
 * Publieke, op zichzelf staande variant: exact `schrijfFrozenBegrotingsresultaatZonderTransactie`,
 * maar binnen haar eigen complete `BEGIN`…`COMMIT`/`ROLLBACK`-transactie —
 * voor aanroepers die frozen output als losstaande operatie willen
 * schrijven (bv. tijdens CONCEPT, ter voorbereiding/test — zie moduledoc).
 */
export function schrijfFrozenBegrotingsresultaat(db: DatabaseSync, versieId: string, resultaat: FrozenBegrotingsresultaat): void {
  withTransaction(db, () => schrijfFrozenBegrotingsresultaatZonderTransactie(db, versieId, resultaat));
}

function reconstrueerModule1(db: DatabaseSync, versieId: string, versie: Begrotingsversie, header: Module1ResultaatRow): BgHuurResultaat {
  const contractRijen = db
    .prepare(
      `SELECT contractnummer, huurdernummer, huurder_naam, complexnummer, belast_onbelast,
              indexatie_percentage_gebruikt, indexatie_percentage_bron, override_scope, override_reden,
              effectieve_indexatiedatum,
              jaartotaal_bruto_huur_zonder_indexatie, jaartotaal_indexatie_effect, jaartotaal_bruto_huur_met_indexatie,
              jaartotaal_huurkorting, jaartotaal_netto_huur
       FROM begroting_frozen_module1_contract
       WHERE begroting_versie_id = ?
       ORDER BY volgnr`,
    )
    .all(versieId) as unknown as Module1ContractRow[];

  const maandregelStmt = db.prepare(
    `SELECT maand, bruto_huur_zonder_indexatie, indexatie_effect, bruto_huur_met_indexatie, huurkorting, netto_huur, kortingswijziging_toegepast
     FROM begroting_frozen_module1_maandregel
     WHERE begroting_versie_id = ? AND contractnummer = ?
     ORDER BY maand`,
  );

  const contracten: BgContractUitkomst[] = contractRijen.map((rij) => {
    const regels: BgHuurMaandRegel[] = (maandregelStmt.all(versieId, rij.contractnummer) as unknown as Module1MaandregelRow[]).map((r) => ({
      maand: r.maand,
      brutoHuurZonderIndexatie: new Decimal(r.bruto_huur_zonder_indexatie),
      indexatieEffect: new Decimal(r.indexatie_effect),
      brutoHuurMetIndexatie: new Decimal(r.bruto_huur_met_indexatie),
      huurkorting: new Decimal(r.huurkorting),
      nettoHuur: new Decimal(r.netto_huur),
      kortingswijzigingToegepast: optioneleParsedBusinessDate(r.kortingswijziging_toegepast),
    }));

    return {
      contractnummer: rij.contractnummer,
      huurdernummer: rij.huurdernummer,
      huurderNaam: rij.huurder_naam,
      complexnummer: rij.complexnummer,
      belastOnbelast: rij.belast_onbelast as BgBelastOnbelast,
      indexatiePercentageGebruikt: new Decimal(rij.indexatie_percentage_gebruikt),
      indexatiePercentageBron: rij.indexatie_percentage_bron as "ALGEMEEN" | "OVERRIDE",
      overrideToegepast:
        rij.override_scope !== null ? { scope: rij.override_scope as BgOverrideScope, reden: rij.override_reden } : null,
      effectieveIndexatiedatum: optioneleParsedBusinessDate(rij.effectieve_indexatiedatum),
      regels,
      jaartotaal: {
        brutoHuurZonderIndexatie: new Decimal(rij.jaartotaal_bruto_huur_zonder_indexatie),
        indexatieEffect: new Decimal(rij.jaartotaal_indexatie_effect),
        brutoHuurMetIndexatie: new Decimal(rij.jaartotaal_bruto_huur_met_indexatie),
        huurkorting: new Decimal(rij.jaartotaal_huurkorting),
        nettoHuur: new Decimal(rij.jaartotaal_netto_huur),
      },
    };
  });

  const controleVereist: BgControleItem[] = (
    db
      .prepare(`SELECT contractnummer, ernst, bericht FROM begroting_frozen_module1_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
      .all(versieId) as unknown as ControlRow[]
  ).map((r) => ({ contractnummer: r.contractnummer, ernst: r.ernst as BgControleItem["ernst"], bericht: r.bericht }));

  return {
    begrotingsjaar: versie.begrotingsjaar,
    bronPeildatum: versie.bronPeildatum,
    indexatiePercentageAlgemeen: new Decimal(header.indexatie_percentage_algemeen),
    contracten,
    portefeuilleTotalen: {
      brutoHuurZonderIndexatie: new Decimal(header.portefeuille_bruto_huur_zonder_indexatie),
      indexatieEffect: new Decimal(header.portefeuille_indexatie_effect),
      brutoHuurMetIndexatie: new Decimal(header.portefeuille_bruto_huur_met_indexatie),
      huurkorting: new Decimal(header.portefeuille_huurkorting),
      nettoHuur: new Decimal(header.portefeuille_netto_huur),
      nettoHuurBelast: new Decimal(header.portefeuille_netto_huur_belast),
      nettoHuurOnbelast: new Decimal(header.portefeuille_netto_huur_onbelast),
      nettoHuurOnbekendeBtw: new Decimal(header.portefeuille_netto_huur_onbekende_btw),
    },
    controleVereist,
  };
}

function reconstrueerModule2(db: DatabaseSync, versieId: string, versie: Begrotingsversie, header: Module2ResultaatRow): BgBeheerResultaat {
  const complexRijen = db
    .prepare(
      `SELECT complexnummer, vast_toegepast, variabel_toegepast, variabel_percentage_gebruikt,
              jaartotaal_netto_huur_grondslag, jaartotaal_vast_voor_indexatie, jaartotaal_vast_indexatie_effect,
              jaartotaal_vast_na_indexatie, jaartotaal_variabele_vergoeding, jaartotaal_totale_vergoeding
       FROM begroting_frozen_module2_complex
       WHERE begroting_versie_id = ?
       ORDER BY volgnr`,
    )
    .all(versieId) as unknown as Module2ComplexRow[];

  const maandregelStmt = db.prepare(
    `SELECT maand, vast_voor_indexatie, vast_indexatie_effect, vast_na_indexatie, variabele_vergoeding, totale_vergoeding
     FROM begroting_frozen_module2_maandregel
     WHERE begroting_versie_id = ? AND complexnummer = ?
     ORDER BY maand`,
  );

  const complexen: BgBeheerComplexUitkomst[] = complexRijen.map((rij) => {
    const regels: BgBeheerMaandRegel[] = (maandregelStmt.all(versieId, rij.complexnummer) as unknown as Module2MaandregelRow[]).map((r) => ({
      maand: r.maand,
      vastVoorIndexatie: new Decimal(r.vast_voor_indexatie),
      vastIndexatieEffect: new Decimal(r.vast_indexatie_effect),
      vastNaIndexatie: new Decimal(r.vast_na_indexatie),
      variabeleVergoeding: new Decimal(r.variabele_vergoeding),
      totaleVergoeding: new Decimal(r.totale_vergoeding),
    }));

    return {
      complexnummer: rij.complexnummer,
      vastToegepast: rij.vast_toegepast === 1,
      variabelToegepast: rij.variabel_toegepast === 1,
      variabelPercentageGebruikt: rij.variabel_percentage_gebruikt !== null ? new Decimal(rij.variabel_percentage_gebruikt) : null,
      regels,
      jaartotaal: {
        nettoHuurGrondslag: new Decimal(rij.jaartotaal_netto_huur_grondslag),
        vastVoorIndexatie: new Decimal(rij.jaartotaal_vast_voor_indexatie),
        vastIndexatieEffect: new Decimal(rij.jaartotaal_vast_indexatie_effect),
        vastNaIndexatie: new Decimal(rij.jaartotaal_vast_na_indexatie),
        variabeleVergoeding: new Decimal(rij.jaartotaal_variabele_vergoeding),
        totaleVergoeding: new Decimal(rij.jaartotaal_totale_vergoeding),
      },
    };
  });

  const controleVereist: BgBeheerControleItem[] = (
    db
      .prepare(`SELECT complexnummer, ernst, bericht FROM begroting_frozen_module2_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
      .all(versieId) as unknown as Module2ControlRow[]
  ).map((r) => ({ complexnummer: r.complexnummer, ernst: r.ernst as BgBeheerControleItem["ernst"], bericht: r.bericht }));

  return {
    begrotingsjaar: versie.begrotingsjaar,
    complexen,
    portefeuilleTotalen: {
      nettoHuurGrondslag: new Decimal(header.portefeuille_netto_huur_grondslag),
      vastVoorIndexatie: new Decimal(header.portefeuille_vast_voor_indexatie),
      vastIndexatieEffect: new Decimal(header.portefeuille_vast_indexatie_effect),
      vastNaIndexatie: new Decimal(header.portefeuille_vast_na_indexatie),
      variabeleVergoeding: new Decimal(header.portefeuille_variabele_vergoeding),
      totaleVergoeding: new Decimal(header.portefeuille_totale_vergoeding),
    },
    controleVereist,
  };
}

/**
 * Leest het bevroren Module-1+Module-2-resultaat voor een begrotingsversie.
 * `null` als er (nog) helemaal geen frozen output is. Gooit een harde fout
 * bij een structureel incomplete state (Module 1 wél, Module 2 niet
 * opgeslagen of omgekeerd) — dat hoort via de transactionele write-API nooit
 * te ontstaan; bij zo'n inconsistentie wordt bewust GEEN gedeeltelijk
 * resultaat gereconstrueerd.
 */
export function leesFrozenBegrotingsresultaat(db: DatabaseSync, versieId: string): FrozenBegrotingsresultaat | null {
  const m1Header = db.prepare(`SELECT * FROM begroting_frozen_module1_resultaat WHERE begroting_versie_id = ?`).get(versieId) as
    | unknown as Module1ResultaatRow
    | undefined;
  const m2Header = db.prepare(`SELECT * FROM begroting_frozen_module2_resultaat WHERE begroting_versie_id = ?`).get(versieId) as
    | unknown as Module2ResultaatRow
    | undefined;

  if (m1Header === undefined && m2Header === undefined) {
    return null;
  }
  if (m1Header === undefined || m2Header === undefined) {
    throw new Error(
      `Begrotingsversie ${versieId}: structureel incomplete frozen output (Module 1 en Module 2 horen altijd samen te bestaan) — geen gedeeltelijk resultaat gereconstrueerd.`,
    );
  }

  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId}: frozen output bestaat, maar de versie zelf is niet leesbaar (interne inconsistentie).`);
  }

  return {
    module1: reconstrueerModule1(db, versieId, versie, m1Header),
    module2: reconstrueerModule2(db, versieId, versie, m2Header),
  };
}
