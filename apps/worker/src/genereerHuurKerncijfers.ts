import Decimal from "decimal.js";
import { openCacheReadonly, type ContractRow, type RentrollRow } from "@bvc/cache";
import {
  berekenHuurKerncijfers,
  type HuurContractRegel,
  type HuurKerncijfersResultaat,
  type HuurRentrollRegel,
} from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";

/**
 * Huur-/rentroll-kerncijfers v1 (2026-08-26) — tijdelijk CLI-commando, nog
 * GEEN renderer, nog NIET gekoppeld aan `kerncijfersManagement`. Leest
 * `rentroll`/`contracten` rechtstreeks uit de al-herbouwde cache
 * (ongefilterde `SELECT * FROM ...`, zelfde patroon als
 * `genereerRentrollDiagnose.ts`/`genereerVastgoedKerncijfers.ts`) en geeft
 * ze door aan `@bvc/reporting`'s pure `berekenHuurKerncijfers`. Bewust GEEN
 * boekjaar/periode: dit is een actuele bronstand (momentopname), zie de
 * moduledoc van `huurKerncijfers.ts`.
 */

const dec = (v: string | null): Decimal | null => (v === null ? null : new Decimal(v));
const datum = (v: string | null): Date | null => (v === null ? null : new Date(v));

export function genereerHuurKerncijfers(root: string, administratieId: string): HuurKerncijfersResultaat {
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  try {
    const rentrollRows = db.prepare("SELECT * FROM rentroll").all() as unknown as RentrollRow[];
    const contractRows = db.prepare("SELECT * FROM contracten").all() as unknown as ContractRow[];

    const rentroll: HuurRentrollRegel[] = rentrollRows.map((r) => ({
      contractnummer: r.contractnummer,
      complexnr: r.complexnummer,
      vorderingsoort: r.vorderingsoort,
      prolongatieBedragJaar: dec(r.prolongatie_bedrag_jaar),
      gehuurdOppervlak: dec(r.gehuurd_oppervlak),
      rapportageDatum: datum(r.rapportage_datum),
    }));
    const contracten: HuurContractRegel[] = contractRows.map((c) => ({
      contractnummer: c.contract,
      ingangsdatum: datum(c.ingangsdatum),
      afloopdatum: datum(c.afloopdatum),
      checkLopendContract: c.check_lopend_contract,
    }));

    return berekenHuurKerncijfers(rentroll, contracten);
  } finally {
    db.close();
  }
}
