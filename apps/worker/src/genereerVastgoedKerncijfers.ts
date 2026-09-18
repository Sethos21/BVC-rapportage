import Decimal from "decimal.js";
import { openCacheReadonly, type ComplexTotaalRow, type RentrollRow, type UnitRow } from "@bvc/cache";
import {
  berekenVastgoedKerncijfers,
  type VastgoedComplexTotaalRegel,
  type VastgoedKerncijfersResultaat,
  type VastgoedRentrollRegel,
  type VastgoedUnitRegel,
} from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";

/**
 * Vastgoed-KPI's v1 (2026-08-26) — tijdelijk CLI-commando, nog GEEN
 * renderer/HTML, nog NIET gekoppeld aan `kerncijfersManagement`. Leest
 * `units`/`rentroll`/`complex_totalen` rechtstreeks uit de al-herbouwde
 * cache (zelfde ongefilterde `SELECT * FROM ...`-patroon als
 * `genereerControlerapport.ts` — de cache is al per-administratie
 * gescheiden) en geeft ze door aan `@bvc/reporting`'s pure
 * `berekenVastgoedKerncijfers`. Bewust GEEN `boekjaar`/`periodeTotEnMet`:
 * dit is een actuele bronstand (momentopname), geen periodegebonden
 * berekening — zie de moduledoc van `vastgoedKerncijfers.ts` voor waarom.
 */

const dec = (v: string | null): Decimal | null => (v === null ? null : new Decimal(v));
const datum = (v: string | null): Date | null => (v === null ? null : new Date(v));

export function genereerVastgoedKerncijfers(root: string, administratieId: string): VastgoedKerncijfersResultaat {
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  try {
    const unitRows = db.prepare("SELECT * FROM units").all() as unknown as UnitRow[];
    const rentrollRows = db.prepare("SELECT * FROM rentroll").all() as unknown as RentrollRow[];
    const complexTotaalRows = db.prepare("SELECT * FROM complex_totalen").all() as unknown as ComplexTotaalRow[];

    const units: VastgoedUnitRegel[] = unitRows.map((r) => ({ complexnr: r.complexnummer, unitnr: r.unitnummer, vvo: dec(r.unit_vvo) }));
    const rentroll: VastgoedRentrollRegel[] = rentrollRows.map((r) => ({
      contractnummer: r.contractnummer,
      complexnr: r.complexnummer,
      gehuurdOppervlak: dec(r.gehuurd_oppervlak),
      prolongatieBedragJaar: dec(r.prolongatie_bedrag_jaar),
      rapportageDatum: datum(r.rapportage_datum),
    }));
    const complexTotalen: VastgoedComplexTotaalRegel[] = complexTotaalRows.map((r) => ({
      complexnr: r.complexnr,
      totaalOppervlakte: dec(r.totaal_oppervlakte),
      totaalVerhuurd: dec(r.totaal_verhuurd),
      totaalLeegstand: dec(r.totaal_leegstand),
    }));

    return berekenVastgoedKerncijfers(units, rentroll, complexTotalen);
  } finally {
    db.close();
  }
}
