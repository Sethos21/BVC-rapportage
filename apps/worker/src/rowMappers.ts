import Decimal from "decimal.js";
import type { BalansstandRow, BoekingRow } from "@bvc/cache";
import type { Balansstand, Boekingsregel } from "@bvc/domain";

/** Cache-rij (BoekingRow) -> domeintype (Boekingsregel). Gedeeld tussen alle Worker-commando's die op boekingen rekenen. */
export function naarBoekingsregel(row: BoekingRow): Boekingsregel {
  return {
    bedrijfsnr: row.bedrijfsnr,
    boekjaar: row.boekjaar,
    dagboeknr: row.dagboeknr,
    boekstuknr: row.boekstuknr,
    volgnr: row.volgnr,
    boekstukSleutel: row.boekstuk_sleutel,
    grootboeknr: row.grootboeknr,
    boekdatum: new Date(row.boekdatum),
    omschrijving: row.omschrijving ?? "",
    bedragDebet: new Decimal(row.bedrag_debet),
    bedragCredit: new Decimal(row.bedrag_credit),
    complexnr: row.complexnr ?? undefined,
    unitnr: row.unitnr ?? undefined,
    contractnr: row.contractnr ?? undefined,
  };
}

/** Cache-rij (BalansstandRow) -> domeintype (Balansstand), inclusief beginbalans. Nullable beginbalans blijft `null` (nooit stilzwijgend 0, CLAUDE.md §6). */
export function naarBalansstand(row: BalansstandRow): Balansstand {
  return {
    bedrijfsnr: row.bedrijfsnr,
    jaar: row.jaar,
    grootboekrekeningnr: row.grootboekrekeningnr,
    saldoDebet: new Decimal(row.saldo_debet),
    saldoCredit: new Decimal(row.saldo_credit),
    eindsaldo: new Decimal(row.eindsaldo),
    beginbalansDebet: row.beginbalans_debet === null ? null : new Decimal(row.beginbalans_debet),
    beginbalansCredit: row.beginbalans_credit === null ? null : new Decimal(row.beginbalans_credit),
    rekeningOmschrijving: row.rekening_omschrijving,
  };
}
