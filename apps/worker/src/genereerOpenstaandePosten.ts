import Decimal from "decimal.js";
import { openCacheReadonly, type OuderdomsanalyseRow, type VorderingMetAfboekingRow } from "@bvc/cache";
import { berekenOpenstaandePosten, type OpResultaat, type OpSaldoHuurderRegel, type OpVorderingRegel } from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";

/**
 * Openstaande-posten v1 (2026-08-31) — tijdelijk CLI-commando, nog GEEN
 * renderer/koppeling aan Huurdersoverzicht/managementrapport. Leest
 * `vorderingen_met_afboekingen`/`ouderdomsanalyse` (= saldo_huurders,
 * zie paths.ts) rechtstreeks uit de al-herbouwde cache (ongefilterde
 * `SELECT * FROM ...`, cache is al per administratie bedrijfsnr-gescoped
 * door rebuildCache.ts) en geeft ze door aan @bvc/reporting's pure
 * berekenOpenstaandePosten, samen met de geconfigureerde
 * debiteurenbeheer-status (nooit een aanname — ontbrekende config leest
 * leesAdministratieConfig al aan als "onbekend").
 */

const dec = (v: string): Decimal => new Decimal(v);
const datum = (v: string): Date => new Date(v);

export function genereerOpenstaandePosten(root: string, administratieId: string): OpResultaat {
  const config = leesAdministratieConfig(root, administratieId);
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  try {
    const vorderingRows = db.prepare("SELECT * FROM vorderingen_met_afboekingen").all() as unknown as VorderingMetAfboekingRow[];
    const vorderingen: OpVorderingRegel[] = vorderingRows.map((r) => ({
      bedrijfsnr: r.bedrijfsnr,
      contractnummer: r.contractnr,
      vorderingVolgnummer: r.vordering_volgnr,
      huurdernummer: r.huurdernr,
      complexnummer: r.complexnummer,
      unitnummer: r.unitnummer,
      factuurnummer: r.factuurnummer,
      datumVordering: datum(r.datum_vordering),
      omschrijving: r.omschrijving_vordering,
      totaalbedrag: dec(r.totaalbedrag),
      bedragAfgeboekt: dec(r.bedrag_afgeboekt),
      openstaand: dec(r.openstaand),
    }));

    const saldoRows = db.prepare("SELECT * FROM ouderdomsanalyse").all() as unknown as OuderdomsanalyseRow[];
    const saldoHuurders: OpSaldoHuurderRegel[] = saldoRows.map((r) => ({
      huurdernummer: r.huurdernr,
      achterstand: dec(r.achterstand),
      achterstandTm30Dagen: dec(r.achterstand_tm_30_dagen),
      achterstandTm60Dagen: dec(r.achterstand_tm_60_dagen),
      achterstandTm90Dagen: dec(r.achterstand_tm_90_dagen),
      achterstand90PlusDagen: dec(r.achterstand_90plus_dagen),
      vooruitbetaling: dec(r.vooruitbetaling),
      saldo: dec(r.saldo),
    }));

    const debiteurenbeheer = config.debiteurenbeheer?.bankAfletteringDoorOns ?? "onbekend";
    return berekenOpenstaandePosten(vorderingen, saldoHuurders, debiteurenbeheer);
  } finally {
    db.close();
  }
}
