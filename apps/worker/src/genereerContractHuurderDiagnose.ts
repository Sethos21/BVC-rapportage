import Decimal from "decimal.js";
import { openCacheReadonly, type ContractRow, type RentrollRow, type OuderdomsanalyseRow } from "@bvc/cache";
import { coerceCode, coerceDate } from "@bvc/data-contracts";
import {
  diagnoseerContractHuurder,
  ruweContractSleutel,
  type ChdContractRegel,
  type ChdOuderdomsanalyseRegel,
  type ChdRentrollRegel,
  type ChdResultaat,
  type ChdRuweContractnummerBotsing,
  type ChdRuweContractvelden,
  type ChdServicekostenVoorschotRegel,
} from "@bvc/reporting";
import { administratieCachePad } from "./paths.js";
import { resolveBron } from "./sourceResolver.js";
import { ExcelBronAdapter } from "./bronAdapter.js";
import { genereerServicekostenPositie } from "./genereerServicekostenPositie.js";

/**
 * Contract/huurder-diagnose (2026-08-27) — TIJDELIJK, ALLEEN-LEZEN CLI-
 * commando, geen renderer. Orchestreert: gecachte `contracten`/`rentroll`/
 * `ouderdomsanalyse` (ongefilterde `SELECT * FROM ...`), het RUWE
 * contracten_huidig-bronbestand voor een aantal nog niet gemodelleerde
 * kolommen (Waarborgsom, Verhoging_datum, Datum_laatst_geprolongreerd,
 * Complexomschrijving — zie packages/reporting/README.md voor de volledige
 * lijst en waarom), en — uitsluitend als boekjaar+periode zijn opgegeven —
 * `genereerServicekostenPositie`'s A-sectie (`voorschottenPerContractHuurder`)
 * voor de geboekte, periodegebonden servicekostenvoorschotten. Rekent zelf
 * niets uit; alle koppel-/vergelijklogica staat in `@bvc/reporting`'s pure
 * `diagnoseerContractHuurder`.
 */

export interface ContractHuurderDiagnoseOpties {
  servicekostenPeriode?: { boekjaar: number; boekperiodeVan?: string | undefined; boekperiodeTotEnMet: string } | undefined;
}

const dec = (v: string | null): Decimal | null => (v === null ? null : new Decimal(v));
const datum = (v: string | null): Date | null => (v === null ? null : new Date(v));
const nietLeeg = (v: string | null): string | null => (v === null || v === "" ? null : v);

function ruweTekst(rij: Record<string, unknown>, kolom: string): string | null {
  return coerceCode(rij[kolom]);
}
function ruweDatum(rij: Record<string, unknown>, kolom: string): Date | null {
  return coerceDate(rij[kolom]);
}

export function genereerContractHuurderDiagnose(root: string, administratieId: string, opties: ContractHuurderDiagnoseOpties = {}): ChdResultaat {
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  let contracten: ChdContractRegel[];
  let rentroll: ChdRentrollRegel[];
  let ouderdomsanalyse: ChdOuderdomsanalyseRegel[];
  try {
    const contractRows = db.prepare("SELECT * FROM contracten").all() as unknown as ContractRow[];
    contracten = contractRows.map((c) => ({
      bedrijfsnr: c.bedrijfsnr,
      contractnummer: c.contract,
      complexnummer: c.complexnummer,
      unitnummer: nietLeeg(c.unitnummer),
      huurdernummer: c.huurdernummer,
      ingangsdatum: datum(c.ingangsdatum),
      afloopdatum: datum(c.afloopdatum),
      checkLopendContract: c.check_lopend_contract,
      expiratieExpiratiedatum: datum(c.expiratie_expiratiedatum),
      expiratieOpzegdatum: datum(c.expiratie_opzegdatum),
    }));

    const rentrollRows = db.prepare("SELECT * FROM rentroll").all() as unknown as RentrollRow[];
    rentroll = rentrollRows.map((r) => ({
      contractnummer: r.contractnummer,
      vorderingsoort: r.vorderingsoort,
      complexnummer: r.complexnummer,
      unitnummer: nietLeeg(r.unitnummer),
      prolongatieBedragJaar: dec(r.prolongatie_bedrag_jaar),
      kortingBedragJaar: dec(r.korting_bedrag_jaar),
      serviceVoorschotJaar: dec(r.service_voorschot_jaar),
      gehuurdOppervlak: dec(r.gehuurd_oppervlak),
      rapportageDatum: datum(r.rapportage_datum),
      contractExpiratiedatum: datum(r.contract_expiratiedatum),
      contractOpzegdatum: datum(r.contract_opzegdatum),
    }));

    const ouderdomsanalyseRows = db.prepare("SELECT * FROM ouderdomsanalyse").all() as unknown as OuderdomsanalyseRow[];
    ouderdomsanalyse = ouderdomsanalyseRows.map((o) => ({
      huurdernr: o.huurdernr,
      boekjaar: o.boekjaar,
      boekperiode: o.boekperiode,
      peildatum: new Date(o.peildatum),
      achterstand: new Decimal(o.achterstand),
      vooruitbetaling: new Decimal(o.vooruitbetaling),
      saldo: new Decimal(o.saldo),
    }));
  } finally {
    db.close();
  }

  // BUGFIX (2026-08-27): contracten_huidig.xlsx is een GEDEELD bronbestand over alle
  // administraties — `Contract` is uitsluitend uniek binnen een administratie (zie
  // `contractNatuurlijkeSleutel`'s bedrijfsnr::contract-sleutel in data-contracts).
  // Voorheen werd hier alleen op contractnummer gesleuteld, waardoor een botsend
  // contractnummer in een ANDERE administratie stilzwijgend de 070-rij overschreef
  // (ontdekt via een afwijking tussen deze diagnose en het cache-gebaseerde
  // huurdersoverzicht voor contracten 0000000048/0000000051/0000000052 — de cache,
  // via rebuildCache.ts's bedrijfsnr-filter, had wél de juiste rij). Nu strikt op
  // bedrijfsnr+contractnummer, plus een aparte, puur diagnostische lijst die elke
  // botsing zichtbaar maakt (`alleRuweRijenPerContractnummer`).
  const ruweContractvelden = new Map<string, ChdRuweContractvelden>();
  const alleRuweRijenPerContractnummer = new Map<string, ChdRuweContractnummerBotsing[]>();
  const bron = resolveBron(root, administratieId, "contracten_huidig");
  if (bron.bestaat) {
    const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);
    for (const rij of ruweRijen) {
      const contractnummer = ruweTekst(rij, "Contract");
      if (contractnummer === null) continue;
      const rijBedrijfsnr = ruweTekst(rij, "Bedrijfsnr");
      const huurderNaam1 = ruweTekst(rij, "Huurder_Naam_1");
      const complexomschrijving = ruweTekst(rij, "Complexomschrijving");
      const waarborgsom = ruweTekst(rij, "Waarborgsom");

      const botsingLijst = alleRuweRijenPerContractnummer.get(contractnummer) ?? [];
      botsingLijst.push({ bedrijfsnr: rijBedrijfsnr ?? "(onbekend)", huurderNaam1, complexomschrijving, waarborgsom });
      alleRuweRijenPerContractnummer.set(contractnummer, botsingLijst);

      if (rijBedrijfsnr === null) continue;
      ruweContractvelden.set(ruweContractSleutel(rijBedrijfsnr, contractnummer), {
        waarborgsom,
        waarborgNietGeprolongeerd: ruweTekst(rij, "Waarborg_niet_geprolongeerd"),
        waarborgbeheer: ruweTekst(rij, "Waarborgbeheer"),
        complexomschrijving,
        huurderNaam1,
        datumLaatstGeprolongeerd: ruweDatum(rij, "Datum_laatst_geprolongreerd"),
        jaarLaatstGeprolongeerd: ruweTekst(rij, "Jaar_laatst_geprolongreerd"),
        periodeLaatstGeprolongeerd: ruweTekst(rij, "Periode_laatst_geprolongreerd"),
        verhogingDatum: ruweDatum(rij, "Verhoging_datum"),
        verhogingJaarVolgend: ruweTekst(rij, "Verhoging_Jaar_vlgd"),
        verhogingPeriodeVolgend: ruweTekst(rij, "Verhoging_Periode_vlgd"),
        verhogingPercentage: ruweTekst(rij, "Verhoging_percentage"),
        verhogingMethode: ruweTekst(rij, "Verhoging_methode"),
        omschrijvingIndextabel: ruweTekst(rij, "Omschrijving_indextabel"),
      });
    }
  }

  let servicekostenVoorschotten: ChdServicekostenVoorschotRegel[] = [];
  let servicekostenPeriode: ChdResultaat["servicekostenPeriode"] = null;
  if (opties.servicekostenPeriode) {
    const { boekjaar, boekperiodeVan, boekperiodeTotEnMet } = opties.servicekostenPeriode;
    const positie = genereerServicekostenPositie(root, administratieId, {
      boekjaar,
      boekperiodeVan,
      boekperiodeTotEnMet,
      doelrekeningen: [],
    });
    servicekostenVoorschotten = positie.actuelePositie.voorschottenPerContractHuurder;
    servicekostenPeriode = { boekjaar, boekperiodeVan: positie.boekperiodeVan, boekperiodeTotEnMet };
  }

  return diagnoseerContractHuurder(contracten, rentroll, ouderdomsanalyse, ruweContractvelden, alleRuweRijenPerContractnummer, servicekostenVoorschotten, servicekostenPeriode);
}
