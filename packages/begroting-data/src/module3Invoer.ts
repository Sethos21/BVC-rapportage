import Decimal from "decimal.js";
import type { DatabaseSync } from "node:sqlite";
import type { BgGeldEenheid, BgManagementInvoer } from "@bvc/reporting";
import { leesBegrotingsversie } from "./begrotingsversies.js";

/**
 * Persistence voor `BgManagementInvoer` — Module-3-rekeninvoer
 * (Managementvergoeding, `packages/reporting/src/begroting/
 * begroteManagementvergoeding.ts` op HEAD). UITSLUITEND opslag/reconstructie
 * van de drie exclusieve invoerwijzen — geen aanroep van de pure
 * Module-3-rekenfunctie zelf, geen bronextractie.
 *
 * Functioneel maximaal één rij per begrotingsversie (1-op-1, PK = FK =
 * `begroting_versie_id`, zelfde precedent als `begroting_aannames`).
 * "Geen rij" is een EIGEN, betekenisvolle toestand ("nog niet beoordeeld") —
 * expliciet ANDERS dan een rij met een bedrag van €0 (een bewuste
 * begrotingswaarde). `leesModule3Invoer` geeft daarom `null` terug als er
 * geen rij bestaat, NOOIT een default/leeg `BgManagementInvoer` en NOOIT een
 * `Decimal(0)` — zie de businessbeslissing in migratie 6's moduledoc.
 *
 * Kolomnamen dekken de CONCEPTEN "bestaand bedrag"/"nieuw bedrag", niet
 * letterlijk elke per-wijze TypeScript-veldnaam (`eenheid` bij
 * `INDEXEER_BESTAAND` vs. `bestaandEenheid` bij `WIJZIG_BESTAAND_BEDRAG` zijn
 * hetzelfde concept) — zie migratie 6's moduledoc voor de volledige
 * kolom-naar-wijze-mapping en de CHECK-constraint die dit op databaseniveau
 * afdwingt.
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

interface ManagementInvoerRow {
  wijze: string;
  bestaand_bedrag: string | null;
  bestaand_eenheid: string | null;
  nieuw_bedrag: string | null;
  nieuwe_eenheid: string | null;
  indexatie_percentage: string | null;
  indexatiedatum: string | null;
  ingangsdatum: string | null;
}

/** Geeft `waarde` terug, of gooit een duidelijke interne-inconsistentiefout als de DB-CHECK-constraint onverhoopt niet heeft gehouden. */
function verplichteKolom<T>(waarde: T | null, kolom: string, wijze: string): T {
  if (waarde === null) {
    throw new Error(`begroting_management_invoer: kolom "${kolom}" is NULL voor wijze "${wijze}" — interne inconsistentie (DB-CHECK had dit moeten voorkomen).`);
  }
  return waarde;
}

/**
 * Schrijft (of vervangt volledig) de Module-3-invoer voor één
 * begrotingsversie. Faalt vóór elke databasewijziging als de parent niet
 * bestaat of geen CONCEPT is. Eén enkele `INSERT … ON CONFLICT … DO
 * UPDATE`-statement die ALLE kolommen expliciet zet (ook naar `NULL` voor
 * kolommen die bij de nieuwe `wijze` niet van toepassing zijn) — voor een
 * 1-op-1-record is dat al atomair en een complete vervanging, geen
 * gedeeltelijke patchsemantiek (zelfde patroon als `module1Aannames.ts`).
 */
export function schrijfModule3Invoer(db: DatabaseSync, versieId: string, invoer: BgManagementInvoer): void {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    throw new Error(`Begrotingsversie ${versieId} bestaat niet.`);
  }
  if (versie.status !== "CONCEPT") {
    throw new Error(
      `Begrotingsversie ${versieId} heeft status ${versie.status} — Module-3-invoer mag uitsluitend op een CONCEPT-versie worden geschreven.`,
    );
  }

  let bestaandBedrag: string | null = null;
  let bestaandEenheid: BgGeldEenheid | null = null;
  let nieuwBedrag: string | null = null;
  let nieuweEenheid: BgGeldEenheid | null = null;
  let indexatiePercentage: string | null = null;
  let indexatiedatum: string | null = null;
  let ingangsdatum: string | null = null;

  if (invoer.wijze === "INDEXEER_BESTAAND") {
    bestaandBedrag = invoer.bestaandBedrag.toString();
    bestaandEenheid = invoer.eenheid;
    indexatiePercentage = invoer.indexatiePercentage.toString();
    indexatiedatum = formatBusinessDate(invoer.indexatiedatum);
  } else if (invoer.wijze === "WIJZIG_BESTAAND_BEDRAG") {
    bestaandBedrag = invoer.bestaandBedrag.toString();
    bestaandEenheid = invoer.bestaandEenheid;
    nieuwBedrag = invoer.nieuwBedrag.toString();
    nieuweEenheid = invoer.nieuweEenheid;
    ingangsdatum = formatBusinessDate(invoer.ingangsdatum);
  } else {
    nieuwBedrag = invoer.bedrag.toString();
    nieuweEenheid = invoer.eenheid;
    ingangsdatum = invoer.ingangsdatum !== null ? formatBusinessDate(invoer.ingangsdatum) : null;
  }

  db.prepare(
    `INSERT INTO begroting_management_invoer
       (begroting_versie_id, wijze, bestaand_bedrag, bestaand_eenheid, nieuw_bedrag, nieuwe_eenheid, indexatie_percentage, indexatiedatum, ingangsdatum)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (begroting_versie_id) DO UPDATE SET
       wijze = excluded.wijze,
       bestaand_bedrag = excluded.bestaand_bedrag,
       bestaand_eenheid = excluded.bestaand_eenheid,
       nieuw_bedrag = excluded.nieuw_bedrag,
       nieuwe_eenheid = excluded.nieuwe_eenheid,
       indexatie_percentage = excluded.indexatie_percentage,
       indexatiedatum = excluded.indexatiedatum,
       ingangsdatum = excluded.ingangsdatum`,
  ).run(versieId, invoer.wijze, bestaandBedrag, bestaandEenheid, nieuwBedrag, nieuweEenheid, indexatiePercentage, indexatiedatum, ingangsdatum);
}

/**
 * Leest de Module-3-invoer voor een begrotingsversie. `null` als de versie
 * niet bestaat, ÓF als er nog geen Module-3-invoer is opgeslagen — beide
 * legitieme, van elkaar te onderscheiden gevallen tijdens CONCEPT (de
 * aanroeper kan het onderscheid maken via `leesBegrotingsversie` als dat
 * relevant is). `null` betekent hier ALTIJD "geen rij", NOOIT "bedrag €0".
 */
export function leesModule3Invoer(db: DatabaseSync, versieId: string): BgManagementInvoer | null {
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    return null;
  }

  const row = db
    .prepare(
      `SELECT wijze, bestaand_bedrag, bestaand_eenheid, nieuw_bedrag, nieuwe_eenheid, indexatie_percentage, indexatiedatum, ingangsdatum
       FROM begroting_management_invoer
       WHERE begroting_versie_id = ?`,
    )
    .get(versieId) as unknown as ManagementInvoerRow | undefined;
  if (row === undefined) {
    return null;
  }

  if (row.wijze === "INDEXEER_BESTAAND") {
    return {
      wijze: "INDEXEER_BESTAAND",
      bestaandBedrag: new Decimal(verplichteKolom(row.bestaand_bedrag, "bestaand_bedrag", row.wijze)),
      eenheid: verplichteKolom(row.bestaand_eenheid, "bestaand_eenheid", row.wijze) as BgGeldEenheid,
      indexatiePercentage: new Decimal(verplichteKolom(row.indexatie_percentage, "indexatie_percentage", row.wijze)),
      indexatiedatum: parseBusinessDate(verplichteKolom(row.indexatiedatum, "indexatiedatum", row.wijze)),
    };
  }

  if (row.wijze === "WIJZIG_BESTAAND_BEDRAG") {
    return {
      wijze: "WIJZIG_BESTAAND_BEDRAG",
      bestaandBedrag: new Decimal(verplichteKolom(row.bestaand_bedrag, "bestaand_bedrag", row.wijze)),
      bestaandEenheid: verplichteKolom(row.bestaand_eenheid, "bestaand_eenheid", row.wijze) as BgGeldEenheid,
      nieuwBedrag: new Decimal(verplichteKolom(row.nieuw_bedrag, "nieuw_bedrag", row.wijze)),
      nieuweEenheid: verplichteKolom(row.nieuwe_eenheid, "nieuwe_eenheid", row.wijze) as BgGeldEenheid,
      ingangsdatum: parseBusinessDate(verplichteKolom(row.ingangsdatum, "ingangsdatum", row.wijze)),
    };
  }

  if (row.wijze === "NIEUWE_VERGOEDING") {
    return {
      wijze: "NIEUWE_VERGOEDING",
      bedrag: new Decimal(verplichteKolom(row.nieuw_bedrag, "nieuw_bedrag", row.wijze)),
      eenheid: verplichteKolom(row.nieuwe_eenheid, "nieuwe_eenheid", row.wijze) as BgGeldEenheid,
      ingangsdatum: row.ingangsdatum !== null ? parseBusinessDate(row.ingangsdatum) : null,
    };
  }

  throw new Error(`begroting_management_invoer: onbekende wijze "${row.wijze}" — interne inconsistentie (DB-CHECK had dit moeten voorkomen).`);
}
