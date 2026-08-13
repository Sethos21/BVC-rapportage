import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { CACHE_TABLES_DDL } from "./schema.js";
import type {
  BalansstandRow,
  BoekingRow,
  CacheData,
  ComplexTotaalRow,
  ContractRow,
  OuderdomsanalyseRow,
  RentrollRow,
  ServicekostenRow,
  UnitRow,
} from "./rows.js";

const BOEKING_COLUMNS: (keyof BoekingRow)[] = [
  "bedrijfsnr", "boekjaar", "boekperiode", "dagboeknr", "boekstuknr", "volgnr", "boekstuk_sleutel",
  "boekdatum", "grootboeknr", "kostenplaatsnr", "complexnr", "unitnr", "contractnr", "huurdernr",
  "bedrag_debet", "bedrag_credit", "saldo", "omschrijving", "grootboek_a", "grootboek_b",
];
const BALANSSTAND_COLUMNS: (keyof BalansstandRow)[] = [
  "bedrijfsnr", "jaar", "grootboekrekeningnr", "beginbalans_debet", "beginbalans_credit",
  "saldo_debet", "saldo_credit", "eindsaldo", "rekening_omschrijving", "balans_vw",
];
const SERVICEKOSTEN_COLUMNS: (keyof ServicekostenRow)[] = [
  "bedrijfsnr", "boekjaar", "boekperiode", "dagboeknummer", "boekstuknummer", "volgnummer",
  "complexnummer", "unitnummer", "contractnummer", "huurdernummer", "kostensoort",
  "kostensoort_omschrijving", "omschrijving", "bedrag_debet", "bedrag_credit", "saldo",
  "doorbelasten", "uitsluitingsstatus",
];
const CONTRACT_COLUMNS: (keyof ContractRow)[] = [
  "bedrijfsnr", "contract", "complexnummer", "unitnummer", "huurdernummer", "ingangsdatum",
  "afloopdatum", "check_lopend_contract", "expiratie_expiratiedatum", "expiratie_opzegdatum",
  "expiratie_aantal_per_optie", "expiratie_huidige",
];
const UNIT_COLUMNS: (keyof UnitRow)[] = [
  "bedrijfsnr", "complexnummer", "unitnummer", "unit_non_actief", "unitomschrijving", "unitsoort",
  "unit_vvo", "unit_bvo", "unit_adres", "unit_postcode", "unit_plaats",
];
const RENTROLL_COLUMNS: (keyof RentrollRow)[] = [
  "bedrijfsnummer", "contractnummer", "vorderingsoort", "unitnummer", "complexnummer",
  "rapportage_datum", "prolongatie_bedrag_jaar", "korting_bedrag_jaar", "service_voorschot_jaar",
  "gehuurd_oppervlak", "contract_expiratiedatum", "contract_opzegdatum",
];
const COMPLEX_TOTAAL_COLUMNS: (keyof ComplexTotaalRow)[] = [
  "bedrijfsnr", "complexnr", "totaal_oppervlakte", "totaal_verhuurd", "totaal_leegstand",
];
const OUDERDOMSANALYSE_COLUMNS: (keyof OuderdomsanalyseRow)[] = [
  "bedrijfsnr", "huurdernr", "achterstand", "achterstand_tm_30_dagen", "achterstand_tm_60_dagen",
  "achterstand_tm_90_dagen", "achterstand_90plus_dagen", "vooruitbetaling", "saldo", "boekjaar",
  "boekperiode", "peildatum",
];

export interface BuildCacheResult {
  path: string;
  rowCounts: Record<keyof CacheData, number>;
  builtAt: string;
}

const LEGE_ROWCOUNTS: Record<keyof CacheData, number> = {
  boekingen: 0, balansstanden: 0, servicekosten: 0, contracten: 0,
  units: 0, rentroll: 0, complex_totalen: 0, ouderdomsanalyse: 0,
};

/**
 * Bouwt een cache incrementeel op, tabel voor tabel, in plaats van in één
 * keer vanuit een volledig in-memory `CacheData`-object. Dit voorkomt dat
 * de rijen van alle brontypen tegelijk in het geheugen moeten staan — de
 * aanroeper (bv. `rebuildCache` in apps/worker) kan per brontype inlezen,
 * filteren, invoegen én daarna laten vrijgeven door de garbage collector
 * vóórdat het volgende (mogelijk grote) bronbestand wordt gelezen.
 *
 * Zelfde veiligheidspatroon als voorheen: alles gebeurt in een tijdelijk
 * bestand, pas bij `finish()` volgt de atomische rename. Bij een fout moet
 * de aanroeper `abort()` aanroepen zodat het tijdelijke bestand niet blijft
 * staan — een eventueel bestaand cache-bestand op `targetPath` blijft in
 * beide gevallen ongewijzigd tot `finish()` slaagt.
 */
export class CacheBuilder {
  private readonly db: DatabaseSync;
  private readonly tmpPath: string;
  private readonly rowCounts: Record<keyof CacheData, number> = { ...LEGE_ROWCOUNTS };
  private klaar = false;

  constructor(private readonly targetPath: string) {
    mkdirSync(dirname(targetPath), { recursive: true });
    this.tmpPath = `${targetPath}.tmp-${randomUUID()}`;
    if (existsSync(this.tmpPath)) unlinkSync(this.tmpPath);
    this.db = new DatabaseSync(this.tmpPath);
    for (const ddl of CACHE_TABLES_DDL) this.db.exec(ddl);
  }

  insertBoekingen(rows: readonly BoekingRow[]): void {
    insertAll(this.db, "boekingen", BOEKING_COLUMNS, rows);
    this.rowCounts.boekingen += rows.length;
  }

  insertBalansstanden(rows: readonly BalansstandRow[]): void {
    insertAll(this.db, "balansstanden", BALANSSTAND_COLUMNS, rows);
    this.rowCounts.balansstanden += rows.length;
  }

  insertServicekosten(rows: readonly ServicekostenRow[]): void {
    insertAll(this.db, "servicekosten", SERVICEKOSTEN_COLUMNS, rows);
    this.rowCounts.servicekosten += rows.length;
  }

  insertContracten(rows: readonly ContractRow[]): void {
    insertAll(this.db, "contracten", CONTRACT_COLUMNS, rows);
    this.rowCounts.contracten += rows.length;
  }

  insertUnits(rows: readonly UnitRow[]): void {
    insertAll(this.db, "units", UNIT_COLUMNS, rows);
    this.rowCounts.units += rows.length;
  }

  insertRentroll(rows: readonly RentrollRow[]): void {
    insertAll(this.db, "rentroll", RENTROLL_COLUMNS, rows);
    this.rowCounts.rentroll += rows.length;
  }

  insertComplexTotalen(rows: readonly ComplexTotaalRow[]): void {
    insertAll(this.db, "complex_totalen", COMPLEX_TOTAAL_COLUMNS, rows);
    this.rowCounts.complex_totalen += rows.length;
  }

  insertOuderdomsanalyse(rows: readonly OuderdomsanalyseRow[]): void {
    insertAll(this.db, "ouderdomsanalyse", OUDERDOMSANALYSE_COLUMNS, rows);
    this.rowCounts.ouderdomsanalyse += rows.length;
  }

  /** Schrijft cache_meta, sluit de database en vervangt `targetPath` atomisch. */
  finish(): BuildCacheResult {
    const builtAt = new Date().toISOString();
    this.db.prepare("INSERT INTO cache_meta (key, value) VALUES (?, ?)").run("built_at", builtAt);
    this.db.close();
    this.klaar = true;
    renameSync(this.tmpPath, this.targetPath);
    return { path: this.targetPath, rowCounts: { ...this.rowCounts }, builtAt };
  }

  /** Ruimt het tijdelijke bestand op na een fout — het bestaande cache-bestand blijft onaangetast. */
  abort(): void {
    if (this.klaar) return;
    this.db.close();
    if (existsSync(this.tmpPath)) unlinkSync(this.tmpPath);
  }
}

/**
 * Bouwt een volledig nieuwe cache in één keer vanuit een compleet
 * `CacheData`-object — handig voor tests en kleine imports. Voor grote
 * bronbestanden (zie apps/worker's rebuildCache) gebruikt de aanroeper
 * `CacheBuilder` rechtstreeks om niet alle brontypen tegelijk in het
 * geheugen te hoeven houden.
 */
export function buildCache(targetPath: string, data: CacheData): BuildCacheResult {
  const builder = new CacheBuilder(targetPath);
  try {
    builder.insertBoekingen(data.boekingen);
    builder.insertBalansstanden(data.balansstanden);
    builder.insertServicekosten(data.servicekosten);
    builder.insertContracten(data.contracten);
    builder.insertUnits(data.units);
    builder.insertRentroll(data.rentroll);
    builder.insertComplexTotalen(data.complex_totalen);
    builder.insertOuderdomsanalyse(data.ouderdomsanalyse);
    return builder.finish();
  } catch (error) {
    builder.abort();
    throw error;
  }
}

function insertAll<T extends object>(
  db: DatabaseSync,
  table: string,
  columns: readonly string[],
  rows: readonly T[],
): void {
  if (rows.length === 0) return;
  const placeholders = columns.map(() => "?").join(", ");
  const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`);
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const record = row as Record<string, string | number | null>;
      stmt.run(...columns.map((column) => record[column] ?? null));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
