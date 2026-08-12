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

/**
 * Bouwt een volledig nieuwe cache in een tijdelijk bestand en vervangt
 * daarna atomisch het cache-bestand op `targetPath` (rename is atomisch
 * binnen hetzelfde bestandssysteem). Bij een fout tijdens het bouwen
 * blijft een eventueel bestaand cache-bestand ongewijzigd — precies het
 * "veilige vervanging"-patroon uit de lokale overdracht, toegepast op de cache.
 */
export function buildCache(targetPath: string, data: CacheData): BuildCacheResult {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp-${randomUUID()}`;
  if (existsSync(tmpPath)) unlinkSync(tmpPath);

  const db = new DatabaseSync(tmpPath);
  const builtAt = new Date().toISOString();
  try {
    for (const ddl of CACHE_TABLES_DDL) db.exec(ddl);

    insertAll(db, "boekingen", BOEKING_COLUMNS, data.boekingen);
    insertAll(db, "balansstanden", BALANSSTAND_COLUMNS, data.balansstanden);
    insertAll(db, "servicekosten", SERVICEKOSTEN_COLUMNS, data.servicekosten);
    insertAll(db, "contracten", CONTRACT_COLUMNS, data.contracten);
    insertAll(db, "units", UNIT_COLUMNS, data.units);
    insertAll(db, "rentroll", RENTROLL_COLUMNS, data.rentroll);
    insertAll(db, "complex_totalen", COMPLEX_TOTAAL_COLUMNS, data.complex_totalen);
    insertAll(db, "ouderdomsanalyse", OUDERDOMSANALYSE_COLUMNS, data.ouderdomsanalyse);

    db.prepare("INSERT INTO cache_meta (key, value) VALUES (?, ?)").run("built_at", builtAt);
  } finally {
    db.close();
  }

  renameSync(tmpPath, targetPath);

  return {
    path: targetPath,
    rowCounts: {
      boekingen: data.boekingen.length,
      balansstanden: data.balansstanden.length,
      servicekosten: data.servicekosten.length,
      contracten: data.contracten.length,
      units: data.units.length,
      rentroll: data.rentroll.length,
      complex_totalen: data.complex_totalen.length,
      ouderdomsanalyse: data.ouderdomsanalyse.length,
    },
    builtAt,
  };
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
