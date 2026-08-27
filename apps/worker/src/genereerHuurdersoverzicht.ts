import Decimal from "decimal.js";
import { openCacheReadonly, type ContractRow, type RentrollRow } from "@bvc/cache";
import { berekenHuurdersoverzicht, type HoContractRegel, type HoRentrollRegel, type HuurdersoverzichtResultaat } from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";

/**
 * Huurdersoverzicht v1 (2026-08-27) — tijdelijk CLI-commando, nog GEEN
 * renderer/management-rapport-koppeling. Leest `contracten`/`rentroll`
 * rechtstreeks uit de al-herbouwde cache (ongefilterde `SELECT * FROM
 * ...`, zelfde patroon als `genereerHuurKerncijfers.ts`) en geeft ze door
 * aan `@bvc/reporting`'s pure `berekenHuurdersoverzicht`. Bewust GEEN
 * boekjaar/periode: momentopname, zie de moduledoc van
 * `huurdersoverzicht.ts`.
 */

const dec = (v: string | null): Decimal | null => (v === null ? null : new Decimal(v));
const datum = (v: string | null): Date | null => (v === null ? null : new Date(v));
const nietLeeg = (v: string | null): string | null => (v === null || v === "" ? null : v);

export function genereerHuurdersoverzicht(root: string, administratieId: string): HuurdersoverzichtResultaat {
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  try {
    const contractRows = db.prepare("SELECT * FROM contracten").all() as unknown as ContractRow[];
    const rentrollRows = db.prepare("SELECT * FROM rentroll").all() as unknown as RentrollRow[];

    const contracten: HoContractRegel[] = contractRows.map((c) => ({
      bedrijfsnr: c.bedrijfsnr,
      contractnummer: c.contract,
      huurdernummer: c.huurdernummer,
      huurderNaam: c.huurder_naam,
      complexnummer: c.complexnummer,
      complexomschrijving: c.complexomschrijving,
      unitnummer: nietLeeg(c.unitnummer),
      ingangsdatum: datum(c.ingangsdatum),
      afloopdatum: datum(c.afloopdatum),
      checkLopendContract: c.check_lopend_contract,
      expiratieExpiratiedatum: datum(c.expiratie_expiratiedatum),
      expiratieOpzegdatum: datum(c.expiratie_opzegdatum),
      waarborgsom: dec(c.waarborgsom),
      verhogingDatum: datum(c.verhoging_datum),
      verhogingJaarVlgd: c.verhoging_jaar_vlgd,
      verhogingPeriodeVlgd: c.verhoging_periode_vlgd,
      verhogingPercentage: dec(c.verhoging_percentage),
      verhogingMethode: c.verhoging_methode,
      omschrijvingIndextabel: c.omschrijving_indextabel,
    }));

    const rentroll: HoRentrollRegel[] = rentrollRows.map((r) => ({
      contractnummer: r.contractnummer,
      vorderingsoort: r.vorderingsoort,
      complexnummer: r.complexnummer,
      unitnummer: nietLeeg(r.unitnummer),
      prolongatieBedragJaar: dec(r.prolongatie_bedrag_jaar),
      gehuurdOppervlak: dec(r.gehuurd_oppervlak),
      serviceVoorschotJaar: dec(r.service_voorschot_jaar),
      rapportageDatum: datum(r.rapportage_datum),
      contractExpiratiedatum: datum(r.contract_expiratiedatum),
      contractOpzegdatum: datum(r.contract_opzegdatum),
    }));

    return berekenHuurdersoverzicht(contracten, rentroll);
  } finally {
    db.close();
  }
}
