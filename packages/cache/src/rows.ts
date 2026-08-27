/** Rijvormen voor de cache-tabellen — kolomnamen matchen 1-op-1 met schema.ts. */

export interface BoekingRow {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  dagboeknr: string;
  boekstuknr: string;
  volgnr: string;
  boekstuk_sleutel: string;
  boekdatum: string;
  grootboeknr: string;
  kostenplaatsnr: string | null;
  complexnr: string | null;
  unitnr: string | null;
  contractnr: string | null;
  huurdernr: string | null;
  bedrag_debet: string;
  bedrag_credit: string;
  saldo: string;
  omschrijving: string | null;
  grootboek_a: string | null;
  grootboek_b: string | null;
}

export interface BalansstandRow {
  bedrijfsnr: string;
  jaar: number;
  grootboekrekeningnr: string;
  beginbalans_debet: string | null;
  beginbalans_credit: string | null;
  saldo_debet: string;
  saldo_credit: string;
  eindsaldo: string;
  rekening_omschrijving: string | null;
  balans_vw: string | null;
}

export interface ServicekostenRow {
  bedrijfsnr: string;
  boekjaar: number;
  boekperiode: string;
  dagboeknummer: string;
  boekstuknummer: string;
  volgnummer: string;
  complexnummer: string | null;
  unitnummer: string | null;
  contractnummer: string | null;
  huurdernummer: string | null;
  kostensoort: string;
  kostensoort_omschrijving: string | null;
  omschrijving: string | null;
  bedrag_debet: string;
  bedrag_credit: string;
  saldo: string;
  doorbelasten: string | null;
  uitsluitingsstatus: string;
  kostensoort_soort: string | null;
  jaar_sv_afrekening: string | null;
}

export interface ContractRow {
  bedrijfsnr: string;
  contract: string;
  complexnummer: string | null;
  unitnummer: string | null;
  huurdernummer: string | null;
  ingangsdatum: string | null;
  afloopdatum: string | null;
  check_lopend_contract: string | null;
  expiratie_expiratiedatum: string | null;
  expiratie_opzegdatum: string | null;
  expiratie_aantal_per_optie: number | null;
  expiratie_huidige: string | null;
}

export interface UnitRow {
  bedrijfsnr: string;
  complexnummer: string;
  unitnummer: string;
  unit_non_actief: string | null;
  unitomschrijving: string | null;
  unitsoort: string | null;
  unit_vvo: string | null;
  unit_bvo: string | null;
  unit_adres: string | null;
  unit_postcode: string | null;
  unit_plaats: string | null;
}

export interface RentrollRow {
  bedrijfsnummer: string;
  contractnummer: string;
  vorderingsoort: string;
  unitnummer: string;
  complexnummer: string | null;
  rapportage_datum: string | null;
  prolongatie_bedrag_jaar: string | null;
  korting_bedrag_jaar: string | null;
  service_voorschot_jaar: string | null;
  gehuurd_oppervlak: string | null;
  contract_expiratiedatum: string | null;
  contract_opzegdatum: string | null;
}

export interface ComplexTotaalRow {
  bedrijfsnr: string;
  complexnr: string;
  totaal_oppervlakte: string | null;
  totaal_verhuurd: string | null;
  totaal_leegstand: string | null;
}

export interface OuderdomsanalyseRow {
  bedrijfsnr: string;
  huurdernr: string;
  achterstand: string;
  achterstand_tm_30_dagen: string;
  achterstand_tm_60_dagen: string;
  achterstand_tm_90_dagen: string;
  achterstand_90plus_dagen: string;
  vooruitbetaling: string;
  saldo: string;
  boekjaar: number;
  boekperiode: string;
  peildatum: string;
}

export interface CacheData {
  boekingen: BoekingRow[];
  balansstanden: BalansstandRow[];
  servicekosten: ServicekostenRow[];
  contracten: ContractRow[];
  units: UnitRow[];
  rentroll: RentrollRow[];
  complex_totalen: ComplexTotaalRow[];
  ouderdomsanalyse: OuderdomsanalyseRow[];
}

export const EMPTY_CACHE_DATA: CacheData = {
  boekingen: [],
  balansstanden: [],
  servicekosten: [],
  contracten: [],
  units: [],
  rentroll: [],
  complex_totalen: [],
  ouderdomsanalyse: [],
};
