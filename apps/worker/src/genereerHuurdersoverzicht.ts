import Decimal from "decimal.js";
import { openCacheReadonly, type ContractRow, type ContractVerhogingRow, type RentrollRow } from "@bvc/cache";
import { berekenHuurdersoverzicht, type HoContractRegel, type HoRentrollRegel, type HoVerhogingRegel, type HuurdersoverzichtResultaat } from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";

/**
 * Huurdersoverzicht v1 (2026-08-27, laatste-indexatie 2026-08-28) —
 * tijdelijk CLI-commando, nog GEEN renderer-koppeling aan management-
 * rapport. Leest `contracten`/`rentroll`/`contract_verhogingen`
 * rechtstreeks uit de al-herbouwde cache (ongefilterde `SELECT * FROM
 * ...`, zelfde patroon als `genereerHuurKerncijfers.ts` — de cache is al
 * per administratie bedrijfsnr-gescoped door `rebuildCache.ts`) en geeft
 * ze door aan `@bvc/reporting`'s pure `berekenHuurdersoverzicht`. Bewust
 * GEEN boekjaar/periode: momentopname, zie de moduledoc van
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

    const verhogingRows = db.prepare("SELECT * FROM contract_verhogingen").all() as unknown as ContractVerhogingRow[];
    const verhogingen: HoVerhogingRegel[] = verhogingRows.map((v) => ({
      contractnummer: v.contract,
      jaar: v.jaar,
      periode: v.periode,
      status: v.status,
      toekomstigeVerhoging: v.toekomstige_verhoging,
      bedragOudVs01: dec(v.bedrag_oud_vs01),
      bedragNieuwVs01: dec(v.bedrag_nieuw_vs01),
    }));

    return berekenHuurdersoverzicht(contracten, rentroll, verhogingen);
  } finally {
    db.close();
  }
}
