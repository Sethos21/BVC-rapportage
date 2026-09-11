import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgGeldEenheid, BgManagementControleItem, BgManagementInvoer, BgManagementMaandRegel, BgManagementResultaat } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor de bevroren Module-3-OUTPUT (`BgManagementResultaat`,
 * fase 2C.4, exact zoals `begroteManagementvergoeding.ts` op HEAD kent).
 * UITSLUITEND serialisatie/deserialisatie — geen formules, geen totalen
 * opnieuw afgeleid, geen aanroep van `berekenBegroteManagementvergoeding`/
 * `herberekenBegroting`.
 *
 * Strikt gescheiden van `module3Invoer.ts` (migratie 6, de persistente
 * INVOER): deze laag leest NOOIT `begroting_management_invoer` om een
 * resultaat te reconstrueren — elke frozen rij is zelfstandig, volledig
 * terugleesbaar (zie migratie 7's moduledoc in `migrations.ts`).
 *
 * `schrijfFrozenModule3ResultaatZonderTransactie` is bewust als los,
 * transactievrij bouwblok geëxporteerd (niet via `index.ts` — intern
 * hergebruik, zelfde grens als `schrijfFrozenBegrotingsresultaatZonderTransactie`
 * in `frozenResultaat.ts`) zodat een toekomstige fase 2C.5's uitgebreide
 * `stelBegrotingVast` (`vaststellen.ts`) dezelfde schrijflogica kan
 * hergebruiken binnen haar eigen, grotere schrijftransactie — zonder de
 * geneste-`BEGIN`-val van `schrijfFrozenModule3Resultaat`'s eigen transactie.
 */

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

interface ResultaatRow {
  wijze: string;
  invoer_bestaand_bedrag: string | null;
  invoer_bestaand_eenheid: string | null;
  invoer_nieuw_bedrag: string | null;
  invoer_nieuwe_eenheid: string | null;
  invoer_indexatie_percentage: string | null;
  invoer_indexatiedatum: string | null;
  invoer_ingangsdatum: string | null;
  resultaat_bestaand_bedrag_maand: string | null;
  resultaat_bestaand_bedrag_jaar: string | null;
  resultaat_nieuw_bedrag_maand: string | null;
  resultaat_nieuw_bedrag_jaar: string | null;
  effectieve_indexatiedatum: string | null;
  effectieve_ingangsdatum: string | null;
  jaartotaal_basis_bedrag: string;
  jaartotaal_effect: string;
  jaartotaal_bedrag: string;
}

interface MaandregelRow {
  maand: number;
  basis_bedrag: string;
  effect: string;
  bedrag: string;
}

interface ControlRow {
  ernst: string;
  bericht: string;
}

/** Reconstrueert `invoer: BgManagementInvoer` uit de `invoer_*`-kolommen — geen enkele formule, uitsluitend een letterlijke kopie per wijze. */
function reconstrueerInvoer(rij: ResultaatRow): BgManagementInvoer {
  if (rij.wijze === "INDEXEER_BESTAAND") {
    return {
      wijze: "INDEXEER_BESTAAND",
      bestaandBedrag: new Decimal(rij.invoer_bestaand_bedrag!),
      eenheid: rij.invoer_bestaand_eenheid as BgGeldEenheid,
      indexatiePercentage: new Decimal(rij.invoer_indexatie_percentage!),
      indexatiedatum: parseBusinessDate(rij.invoer_indexatiedatum!),
    };
  }
  if (rij.wijze === "WIJZIG_BESTAAND_BEDRAG") {
    return {
      wijze: "WIJZIG_BESTAAND_BEDRAG",
      bestaandBedrag: new Decimal(rij.invoer_bestaand_bedrag!),
      bestaandEenheid: rij.invoer_bestaand_eenheid as BgGeldEenheid,
      nieuwBedrag: new Decimal(rij.invoer_nieuw_bedrag!),
      nieuweEenheid: rij.invoer_nieuwe_eenheid as BgGeldEenheid,
      ingangsdatum: parseBusinessDate(rij.invoer_ingangsdatum!),
    };
  }
  if (rij.wijze === "NIEUWE_VERGOEDING") {
    return {
      wijze: "NIEUWE_VERGOEDING",
      bedrag: new Decimal(rij.invoer_nieuw_bedrag!),
      eenheid: rij.invoer_nieuwe_eenheid as BgGeldEenheid,
      ingangsdatum: optioneleParsedBusinessDate(rij.invoer_ingangsdatum),
    };
  }
  throw new Error(`begroting_frozen_module3_resultaat: onbekende wijze "${rij.wijze}" — interne inconsistentie.`);
}

/**
 * Schrijft het COMPLETE bevroren Module-3-resultaat voor één
 * begrotingsversie — vervangt, geen gedeeltelijke state. GEEN eigen
 * transactie (de aanroeper bepaalt de transactiegrens — zie
 * `schrijfFrozenModule3Resultaat` voor de publieke, op zichzelf staande
 * variant). Faalt vóór enige schrijfactie als de parent niet bestaat of geen
 * CONCEPT is — dezelfde structurele invariant als `frozenResultaat.ts`
 * (`begrotingsjaar` wordt hier niet apart gevalideerd: `BgManagementResultaat`
 * bevat dat veld wel, maar het wordt — net als bij Module 1/2 — bij lezen
 * uit de parent-versie gereconstrueerd, nooit dubbel opgeslagen).
 */
export function schrijfFrozenModule3ResultaatZonderTransactie(db: DatabaseSync, versieId: string, resultaat: BgManagementResultaat): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — frozen Module-3-output mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  db.prepare(`DELETE FROM begroting_frozen_module3_control WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_module3_maandregel WHERE begroting_versie_id = ?`).run(versieId);
  db.prepare(`DELETE FROM begroting_frozen_module3_resultaat WHERE begroting_versie_id = ?`).run(versieId);

  const invoer = resultaat.invoer;
  let invoerBestaandBedrag: string | null = null;
  let invoerBestaandEenheid: string | null = null;
  let invoerNieuwBedrag: string | null = null;
  let invoerNieuweEenheid: string | null = null;
  let invoerIndexatiePercentage: string | null = null;
  let invoerIndexatiedatum: string | null = null;
  let invoerIngangsdatum: string | null = null;

  if (invoer.wijze === "INDEXEER_BESTAAND") {
    invoerBestaandBedrag = invoer.bestaandBedrag.toString();
    invoerBestaandEenheid = invoer.eenheid;
    invoerIndexatiePercentage = invoer.indexatiePercentage.toString();
    invoerIndexatiedatum = formatBusinessDate(invoer.indexatiedatum);
  } else if (invoer.wijze === "WIJZIG_BESTAAND_BEDRAG") {
    invoerBestaandBedrag = invoer.bestaandBedrag.toString();
    invoerBestaandEenheid = invoer.bestaandEenheid;
    invoerNieuwBedrag = invoer.nieuwBedrag.toString();
    invoerNieuweEenheid = invoer.nieuweEenheid;
    invoerIngangsdatum = formatBusinessDate(invoer.ingangsdatum);
  } else {
    invoerNieuwBedrag = invoer.bedrag.toString();
    invoerNieuweEenheid = invoer.eenheid;
    invoerIngangsdatum = invoer.ingangsdatum !== null ? formatBusinessDate(invoer.ingangsdatum) : null;
  }

  db.prepare(
    `INSERT INTO begroting_frozen_module3_resultaat
       (begroting_versie_id, wijze,
        invoer_bestaand_bedrag, invoer_bestaand_eenheid, invoer_nieuw_bedrag, invoer_nieuwe_eenheid,
        invoer_indexatie_percentage, invoer_indexatiedatum, invoer_ingangsdatum,
        resultaat_bestaand_bedrag_maand, resultaat_bestaand_bedrag_jaar,
        resultaat_nieuw_bedrag_maand, resultaat_nieuw_bedrag_jaar,
        effectieve_indexatiedatum, effectieve_ingangsdatum,
        jaartotaal_basis_bedrag, jaartotaal_effect, jaartotaal_bedrag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    versieId,
    invoer.wijze,
    invoerBestaandBedrag,
    invoerBestaandEenheid,
    invoerNieuwBedrag,
    invoerNieuweEenheid,
    invoerIndexatiePercentage,
    invoerIndexatiedatum,
    invoerIngangsdatum,
    resultaat.bestaandBedrag !== null ? resultaat.bestaandBedrag.maand.toString() : null,
    resultaat.bestaandBedrag !== null ? resultaat.bestaandBedrag.jaar.toString() : null,
    resultaat.nieuwBedrag !== null ? resultaat.nieuwBedrag.maand.toString() : null,
    resultaat.nieuwBedrag !== null ? resultaat.nieuwBedrag.jaar.toString() : null,
    optioneleBusinessDate(resultaat.effectieveIndexatiedatum),
    optioneleBusinessDate(resultaat.effectieveIngangsdatum),
    resultaat.jaartotaal.basisBedrag.toString(),
    resultaat.jaartotaal.effect.toString(),
    resultaat.jaartotaal.bedrag.toString(),
  );

  const insertMaandregel = db.prepare(
    `INSERT INTO begroting_frozen_module3_maandregel (begroting_versie_id, maand, basis_bedrag, effect, bedrag) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const regel of resultaat.regels) {
    insertMaandregel.run(versieId, regel.maand, regel.basisBedrag.toString(), regel.effect.toString(), regel.bedrag.toString());
  }

  const insertControl = db.prepare(
    `INSERT INTO begroting_frozen_module3_control (begroting_versie_id, volgnr, ernst, bericht) VALUES (?, ?, ?, ?)`,
  );
  resultaat.controleVereist.forEach((control, volgnr) => {
    insertControl.run(versieId, volgnr, control.ernst, control.bericht);
  });
}

/**
 * Publieke, op zichzelf staande variant: exact
 * `schrijfFrozenModule3ResultaatZonderTransactie`, maar binnen haar eigen
 * complete `BEGIN`…`COMMIT`/`ROLLBACK`-transactie — voor aanroepers die
 * frozen Module-3-output als losstaande operatie willen schrijven (bv.
 * tijdens CONCEPT, ter voorbereiding/test — zelfde patroon als
 * `schrijfFrozenBegrotingsresultaat`).
 */
export function schrijfFrozenModule3Resultaat(db: DatabaseSync, versieId: string, resultaat: BgManagementResultaat): void {
  withTransaction(db, () => schrijfFrozenModule3ResultaatZonderTransactie(db, versieId, resultaat));
}

/**
 * Leest het bevroren Module-3-resultaat voor een begrotingsversie. `null`
 * als er (nog) geen frozen output is — NOOIT een default/leeg resultaat en
 * NOOIT `Decimal(0)` in plaats van "ontbrekend" (zelfde discipline als
 * `module3Invoer.ts`'s `leesModule3Invoer`).
 */
export function leesFrozenModule3Resultaat(db: DatabaseSync, versieId: string): BgManagementResultaat | null {
  const header = db.prepare(`SELECT * FROM begroting_frozen_module3_resultaat WHERE begroting_versie_id = ?`).get(versieId) as unknown as
    | ResultaatRow
    | undefined;
  if (header === undefined) {
    return null;
  }

  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId}: frozen Module-3-output bestaat, maar de versie zelf is niet leesbaar (interne inconsistentie).`);
  }

  const maandregelRijen = db
    .prepare(`SELECT maand, basis_bedrag, effect, bedrag FROM begroting_frozen_module3_maandregel WHERE begroting_versie_id = ? ORDER BY maand`)
    .all(versieId) as unknown as MaandregelRow[];
  const regels: BgManagementMaandRegel[] = maandregelRijen.map((r) => ({
    maand: r.maand,
    basisBedrag: new Decimal(r.basis_bedrag),
    effect: new Decimal(r.effect),
    bedrag: new Decimal(r.bedrag),
  }));

  const controleRijen = db
    .prepare(`SELECT ernst, bericht FROM begroting_frozen_module3_control WHERE begroting_versie_id = ? ORDER BY volgnr`)
    .all(versieId) as unknown as ControlRow[];
  const controleVereist: BgManagementControleItem[] = controleRijen.map((r) => ({ ernst: r.ernst as BgManagementControleItem["ernst"], bericht: r.bericht }));

  return {
    begrotingsjaar: versie.begrotingsjaar,
    invoer: reconstrueerInvoer(header),
    bestaandBedrag:
      header.resultaat_bestaand_bedrag_maand !== null && header.resultaat_bestaand_bedrag_jaar !== null
        ? { maand: new Decimal(header.resultaat_bestaand_bedrag_maand), jaar: new Decimal(header.resultaat_bestaand_bedrag_jaar) }
        : null,
    nieuwBedrag:
      header.resultaat_nieuw_bedrag_maand !== null && header.resultaat_nieuw_bedrag_jaar !== null
        ? { maand: new Decimal(header.resultaat_nieuw_bedrag_maand), jaar: new Decimal(header.resultaat_nieuw_bedrag_jaar) }
        : null,
    effectieveIndexatiedatum: optioneleParsedBusinessDate(header.effectieve_indexatiedatum),
    effectieveIngangsdatum: optioneleParsedBusinessDate(header.effectieve_ingangsdatum),
    regels,
    jaartotaal: {
      basisBedrag: new Decimal(header.jaartotaal_basis_bedrag),
      effect: new Decimal(header.jaartotaal_effect),
      bedrag: new Decimal(header.jaartotaal_bedrag),
    },
    controleVereist,
  };
}
