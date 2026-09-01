import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { coerceCode, coerceDecimal, readFirstSheetAsRows } from "@bvc/data-contracts";
import { openCacheReadonly, type ContractRow, type RentrollRow, type UnitRow } from "@bvc/cache";
import {
  diagnoseerContractVerhogingen,
  type ContractVerhogingenDiagnoseResultaat,
  type CvdContractContext,
  type CvdUnitContext,
  type CvdVerhogingsregel,
  type CvdVsBedrag,
} from "@bvc/reporting";
import { administratieCachePad, bronGedeeldDir } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";

/**
 * Contract-verhogingen-diagnose (2026-08-27/28) — TIJDELIJK, ALLEEN-LEZEN,
 * onderzoekt de NIEUWE bron `bron_gedeeld/contract_verhogingen.xlsx`
 * (nog GEEN onderdeel van `BRON_TYPES`/cache/schema — bewust rechtstreeks
 * gelezen, niet via `resolveBron`/`ExcelBronAdapter`, want dit is geen
 * bekend brontype). Bevat dezelfde bedrijfsnr-scoping-discipline als de
 * eerdere bugfix in `genereerContractHuurderDiagnose.ts`: dit is óók een
 * gedeeld bestand over administraties, dus wordt hier al vanaf de eerste
 * regel gefilterd op `Bedrijfsnr === config.bedrijfsnr` — nooit alleen op
 * contractnummer.
 *
 * Echte kolomnamen bevestigd via een eerste 070-run (2026-08-27):
 * `Contract`/`Huurdernr`/`Complexnr`/`Unitnr`/`Huurder_Naam` — NIET
 * `Contractnummer`/`Huurdernummer`/`Complexnummer`/`Unitnummer` (die
 * bestaan niet in deze bron; `Huurder_Naam` heeft ook geen "_1"-suffix,
 * anders dan `contracten_huidig`'s `Huurder_Naam_1`).
 *
 * `contracten`/`rentroll` komen uit de al-herbouwde cache (bewezen,
 * correct bedrijfsnr-gescoped) — niet opnieuw uit een raw bestand
 * gelezen, om geen tweede keer in dezelfde koppelingsval te lopen.
 */

const VS_CODES = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0"));

const LEGE_RESULTAAT: ContractVerhogingenDiagnoseResultaat = {
  bronBestaat: false,
  ruweKolommen: [],
  bronPeildatum: null,
  koppeling: { aantalRegels070: 0, aantalUniekeContracten070InBron: 0, contractenZonderVerhogingshistorie: [], verhogingsregelsZonderContractmatch: [] },
  distinctStatusWaarden: [],
  distinctToekomstigeVerhogingWaarden: [],
  historiePerContract: [],
  reconciliatie: [],
  vs01Reconciliatie: { aantalContracten: 0, aantalExacteMatches: 0, aantalAfwijkingen: 0, grootsteAbsoluteAfwijking: null, perContract: [] },
  vsWijzigingStatistiek: [],
  waardeAnalyse: { aantalRegelsGeanalyseerd: 0, aantalExacteMatchesMetPercentageVs01: 0, aantalAfwijkingen: 0, maximaleAbsoluteAfwijking: null, aantalWaardeNulMaarVs01Wijzigt: 0, regels: [] },
  contractenZonderHistorieOnderzoek: [],
  unitsContext: [],
};

function tekst(rij: Record<string, unknown>, kolom: string): string | null {
  return coerceCode(rij[kolom]);
}
function bedrag(rij: Record<string, unknown>, kolom: string): Decimal | null {
  return coerceDecimal(rij[kolom]);
}

function naarVerhogingsregel(rij: Record<string, unknown>): CvdVerhogingsregel {
  const vsBedragen: CvdVsBedrag[] = VS_CODES.map((vs) => ({
    vs: `VS_${vs}`,
    bedragOud: bedrag(rij, `Bedrag_oud_VS_${vs}`),
    bedragBerekend: bedrag(rij, `Bedrag_Berekend_VS_${vs}`),
    bedragNieuw: bedrag(rij, `Bedrag_Nieuw_VS_${vs}`),
  })).filter((v) => v.bedragOud !== null || v.bedragBerekend !== null || v.bedragNieuw !== null);

  return {
    bedrijfsnr: tekst(rij, "Bedrijfsnr"),
    contractnummer: tekst(rij, "Contract"),
    huurdernummer: tekst(rij, "Huurdernr"),
    huurderNaam: tekst(rij, "Huurder_Naam"),
    complexnummer: tekst(rij, "Complexnr"),
    unitnummer: tekst(rij, "Unitnr"),
    jaar: tekst(rij, "Jaar"),
    periode: tekst(rij, "Periode"),
    status: tekst(rij, "Status"),
    verhogingsmethode: tekst(rij, "Verhogingsmethode"),
    waarde: bedrag(rij, "Waarde"),
    indexeringOud: bedrag(rij, "Indexering_oud"),
    indexeringNieuw: bedrag(rij, "Indexering_nieuw"),
    totaalOud: bedrag(rij, "Totaal_Oud"),
    totaalNieuw: bedrag(rij, "Totaal_Nieuw"),
    vsBedragen,
    toekomstigeVerhoging: tekst(rij, "Toekomstige_verhoging"),
    regelnummer: tekst(rij, "Regelnummer"),
    aanmaakwijze: tekst(rij, "Aanmaakwijze"),
    incidenteel: tekst(rij, "Incidenteel"),
    iahVerhogingToegepast: tekst(rij, "IAH_verhoging_toegepast"),
    prijsindexOpslagToegepast: tekst(rij, "Prijsindex_opslag_toegepast"),
    prijsindexOpslagPercentage: bedrag(rij, "Prijsindex_opslag_percentage"),
    cbsAfrondingToegepast: tekst(rij, "CBS_afronding_toegepast"),
    tabeljaar: tekst(rij, "Tabeljaar"),
    prijsindextabel: tekst(rij, "Prijsindextabel"),
  };
}

export function genereerContractVerhogingenDiagnose(root: string, administratieId: string): ContractVerhogingenDiagnoseResultaat {
  const config = leesAdministratieConfig(root, administratieId);

  const pad = join(bronGedeeldDir(root), "contract_verhogingen.xlsx");
  if (!existsSync(pad)) {
    return LEGE_RESULTAAT;
  }

  const ruweRijen = readFirstSheetAsRows(readFileSync(pad));
  const ruweKolommen = Array.from(new Set(ruweRijen.flatMap((r) => Object.keys(r)))).sort();
  const regels070 = ruweRijen.filter((r) => tekst(r, "Bedrijfsnr") === config.bedrijfsnr).map(naarVerhogingsregel);

  const db = openCacheReadonly(administratieCachePad(root, administratieId));
  let bekendeContracten: CvdContractContext[];
  let bronPeildatum: Date | null;
  let unitsContext: CvdUnitContext[];
  try {
    const contractRows = db.prepare("SELECT * FROM contracten").all() as unknown as ContractRow[];

    const unitRows = db.prepare("SELECT * FROM units").all() as unknown as UnitRow[];
    unitsContext = unitRows.map((u) => ({
      bedrijfsnr: u.bedrijfsnr,
      complexnummer: u.complexnummer,
      unitnummer: u.unitnummer,
      vvo: u.unit_vvo !== null ? new Decimal(u.unit_vvo) : null,
      unitomschrijving: u.unitomschrijving,
    }));

    const rentrollRows = db.prepare("SELECT * FROM rentroll").all() as unknown as RentrollRow[];
    const rentrollPerContract = new Map<string, { brutoJaarhuur: Decimal | null; huurkorting: Decimal | null }>();
    for (const r of rentrollRows) {
      const bestaand = rentrollPerContract.get(r.contractnummer) ?? { brutoJaarhuur: null, huurkorting: null };
      if (r.vorderingsoort === "01" && r.prolongatie_bedrag_jaar !== null) bestaand.brutoJaarhuur = new Decimal(r.prolongatie_bedrag_jaar);
      if (r.vorderingsoort === "13" && r.prolongatie_bedrag_jaar !== null) bestaand.huurkorting = new Decimal(r.prolongatie_bedrag_jaar);
      rentrollPerContract.set(r.contractnummer, bestaand);
    }

    bekendeContracten = contractRows.map((c) => {
      const rentroll = rentrollPerContract.get(c.contract) ?? { brutoJaarhuur: null, huurkorting: null };
      return {
        contractnummer: c.contract,
        huurderNaam: c.huurder_naam,
        ingangsdatum: c.ingangsdatum !== null ? new Date(c.ingangsdatum) : null,
        volgendeIndexeringsdatum: c.verhoging_datum !== null ? new Date(c.verhoging_datum) : null,
        brutoJaarhuur: rentroll.brutoJaarhuur,
        huurkorting: rentroll.huurkorting,
      };
    });

    const rapportageDatums = new Set(rentrollRows.map((r) => r.rapportage_datum).filter((d): d is string => d !== null));
    bronPeildatum = rapportageDatums.size === 1 ? new Date([...rapportageDatums][0]!) : null;
  } finally {
    db.close();
  }

  return diagnoseerContractVerhogingen(ruweKolommen, regels070, bekendeContracten, bronPeildatum, unitsContext);
}
