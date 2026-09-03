import Decimal from "decimal.js";
import { openCacheReadonly, type ContractRow, type RentrollRow } from "@bvc/cache";
import {
  diagnoseerRentroll,
  type RentrollDiagnoseContractRegel,
  type RentrollDiagnoseRentrollRegel,
  type RentrollDiagnoseResultaat,
} from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";

/**
 * Rentroll-diagnose (2026-08-26) — TIJDELIJK, ALLEEN-LEZEN CLI-commando,
 * geen renderer. Leest `rentroll`/`contracten` rechtstreeks uit de
 * al-herbouwde cache (ongefilterde `SELECT * FROM ...`, zelfde patroon als
 * `genereerControlerapport.ts`/`genereerVastgoedKerncijfers.ts`) en geeft
 * ze door aan `@bvc/reporting`'s pure `diagnoseerRentroll`. Bouwt GEEN
 * huur-KPI, wijzigt niets aan `vastgoedKerncijfers.ts`,
 * `kerncijfersManagement.ts` of `@bvc/domain/vastgoed.ts` — bedoeld om te
 * bepalen hoe `Vorderingsoort` zich in de echte 070-data gedraagt vóórdat
 * een huur-KPI-module ontworpen wordt.
 */

const dec = (v: string | null): Decimal | null => (v === null ? null : new Decimal(v));
const datum = (v: string | null): Date | null => (v === null ? null : new Date(v));
/** RentrollRow slaat een ontbrekend unitnummer op als lege string (zie apps/worker/src/rebuildCache.ts) — hier weer expliciet `null` voor de diagnose. */
const nietLeeg = (v: string | null): string | null => (v === null || v === "" ? null : v);

export function genereerRentrollDiagnose(root: string, administratieId: string): RentrollDiagnoseResultaat {
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  try {
    const rentrollRows = db.prepare("SELECT * FROM rentroll").all() as unknown as RentrollRow[];
    const contractRows = db.prepare("SELECT * FROM contracten").all() as unknown as ContractRow[];

    const rentroll: RentrollDiagnoseRentrollRegel[] = rentrollRows.map((r) => ({
      contractnummer: r.contractnummer,
      complexnr: r.complexnummer,
      unitnr: nietLeeg(r.unitnummer),
      vorderingsoort: r.vorderingsoort,
      prolongatieBedragJaar: dec(r.prolongatie_bedrag_jaar),
      kortingBedragJaar: dec(r.korting_bedrag_jaar),
      gehuurdOppervlak: dec(r.gehuurd_oppervlak),
      rapportageDatum: datum(r.rapportage_datum),
    }));
    const contracten: RentrollDiagnoseContractRegel[] = contractRows.map((c) => ({
      contractnummer: c.contract,
      ingangsdatum: datum(c.ingangsdatum),
      afloopdatum: datum(c.afloopdatum),
      expiratieExpiratiedatum: datum(c.expiratie_expiratiedatum),
      checkLopendContract: c.check_lopend_contract,
    }));

    return diagnoseerRentroll(rentroll, contracten);
  } finally {
    db.close();
  }
}
