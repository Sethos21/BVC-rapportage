/**
 * Cache-schema — geen migraties. Iedere herbouw maakt deze tabellen
 * opnieuw aan in een tijdelijk bestand (zie buildCache.ts); de cache is
 * per definitie herbouwbaar en bevat geen historie (CLAUDE_OVERDRACHT_
 * LOKALE_DATAOPZET_v0.1.md, punt 8). Geldbedragen staan als TEXT
 * (decimal.js-string) om drijvendekommafouten te vermijden — SQLite REAL
 * is IEEE754 floating point en dus ongeschikt voor geld.
 */
export const CACHE_TABLES_DDL: readonly string[] = [
  `CREATE TABLE boekingen (
    bedrijfsnr TEXT NOT NULL,
    boekjaar INTEGER NOT NULL,
    boekperiode TEXT NOT NULL,
    dagboeknr TEXT NOT NULL,
    boekstuknr TEXT NOT NULL,
    volgnr TEXT NOT NULL,
    boekstuk_sleutel TEXT NOT NULL,
    boekdatum TEXT NOT NULL,
    grootboeknr TEXT NOT NULL,
    kostenplaatsnr TEXT,
    complexnr TEXT,
    unitnr TEXT,
    contractnr TEXT,
    huurdernr TEXT,
    bedrag_debet TEXT NOT NULL,
    bedrag_credit TEXT NOT NULL,
    saldo TEXT NOT NULL,
    omschrijving TEXT,
    grootboek_a TEXT,
    grootboek_b TEXT,
    PRIMARY KEY (bedrijfsnr, boekjaar, dagboeknr, boekstuknr, volgnr)
  )`,
  `CREATE TABLE balansstanden (
    bedrijfsnr TEXT NOT NULL,
    jaar INTEGER NOT NULL,
    grootboekrekeningnr TEXT NOT NULL,
    beginbalans_debet TEXT,
    beginbalans_credit TEXT,
    saldo_debet TEXT NOT NULL,
    saldo_credit TEXT NOT NULL,
    eindsaldo TEXT NOT NULL,
    rekening_omschrijving TEXT,
    balans_vw TEXT,
    PRIMARY KEY (bedrijfsnr, jaar, grootboekrekeningnr)
  )`,
  `CREATE TABLE servicekosten (
    bedrijfsnr TEXT NOT NULL,
    boekjaar INTEGER NOT NULL,
    boekperiode TEXT NOT NULL,
    dagboeknummer TEXT NOT NULL,
    boekstuknummer TEXT NOT NULL,
    volgnummer TEXT NOT NULL,
    complexnummer TEXT,
    unitnummer TEXT,
    contractnummer TEXT,
    huurdernummer TEXT,
    kostensoort TEXT NOT NULL,
    kostensoort_omschrijving TEXT,
    omschrijving TEXT,
    bedrag_debet TEXT NOT NULL,
    bedrag_credit TEXT NOT NULL,
    saldo TEXT NOT NULL,
    doorbelasten TEXT,
    uitsluitingsstatus TEXT NOT NULL,
    kostensoort_soort TEXT,
    jaar_sv_afrekening TEXT,
    huurder_naam TEXT,
    PRIMARY KEY (bedrijfsnr, boekjaar, boekperiode, dagboeknummer, boekstuknummer, volgnummer)
  )`,
  `CREATE TABLE contracten (
    bedrijfsnr TEXT NOT NULL,
    contract TEXT NOT NULL,
    complexnummer TEXT,
    unitnummer TEXT,
    huurdernummer TEXT,
    ingangsdatum TEXT,
    afloopdatum TEXT,
    check_lopend_contract TEXT,
    expiratie_expiratiedatum TEXT,
    expiratie_opzegdatum TEXT,
    expiratie_aantal_per_optie INTEGER,
    expiratie_huidige TEXT,
    huurder_naam TEXT,
    waarborgsom TEXT,
    complexomschrijving TEXT,
    verhoging_datum TEXT,
    verhoging_jaar_vlgd TEXT,
    verhoging_periode_vlgd TEXT,
    verhoging_percentage TEXT,
    verhoging_methode TEXT,
    omschrijving_indextabel TEXT,
    PRIMARY KEY (bedrijfsnr, contract)
  )`,
  `CREATE TABLE units (
    bedrijfsnr TEXT NOT NULL,
    complexnummer TEXT NOT NULL,
    unitnummer TEXT NOT NULL,
    unit_non_actief TEXT,
    unitomschrijving TEXT,
    unitsoort TEXT,
    unit_vvo TEXT,
    unit_bvo TEXT,
    unit_adres TEXT,
    unit_postcode TEXT,
    unit_plaats TEXT,
    PRIMARY KEY (bedrijfsnr, complexnummer, unitnummer)
  )`,
  `CREATE TABLE rentroll (
    bedrijfsnummer TEXT NOT NULL,
    contractnummer TEXT NOT NULL,
    vorderingsoort TEXT NOT NULL,
    unitnummer TEXT NOT NULL DEFAULT '',
    complexnummer TEXT,
    rapportage_datum TEXT,
    prolongatie_bedrag_jaar TEXT,
    korting_bedrag_jaar TEXT,
    service_voorschot_jaar TEXT,
    gehuurd_oppervlak TEXT,
    contract_expiratiedatum TEXT,
    contract_opzegdatum TEXT,
    PRIMARY KEY (bedrijfsnummer, contractnummer, vorderingsoort, unitnummer)
  )`,
  `CREATE TABLE complex_totalen (
    bedrijfsnr TEXT NOT NULL,
    complexnr TEXT NOT NULL,
    totaal_oppervlakte TEXT,
    totaal_verhuurd TEXT,
    totaal_leegstand TEXT,
    PRIMARY KEY (bedrijfsnr, complexnr)
  )`,
  `CREATE TABLE ouderdomsanalyse (
    bedrijfsnr TEXT NOT NULL,
    huurdernr TEXT NOT NULL,
    achterstand TEXT NOT NULL,
    achterstand_tm_30_dagen TEXT NOT NULL,
    achterstand_tm_60_dagen TEXT NOT NULL,
    achterstand_tm_90_dagen TEXT NOT NULL,
    achterstand_90plus_dagen TEXT NOT NULL,
    vooruitbetaling TEXT NOT NULL,
    saldo TEXT NOT NULL,
    boekjaar INTEGER NOT NULL,
    boekperiode TEXT NOT NULL,
    peildatum TEXT NOT NULL,
    PRIMARY KEY (bedrijfsnr, huurdernr, boekjaar, boekperiode)
  )`,
  `CREATE TABLE contract_verhogingen (
    bedrijfsnr TEXT NOT NULL,
    contract TEXT NOT NULL,
    jaar TEXT NOT NULL,
    periode TEXT NOT NULL,
    status TEXT,
    toekomstige_verhoging TEXT,
    bedrag_oud_vs01 TEXT,
    bedrag_nieuw_vs01 TEXT,
    PRIMARY KEY (bedrijfsnr, contract, jaar, periode)
  )`,
  `CREATE TABLE vorderingen_met_afboekingen (
    bedrijfsnr TEXT NOT NULL,
    contractnr TEXT NOT NULL,
    vordering_volgnr TEXT NOT NULL,
    huurdernr TEXT NOT NULL,
    complexnummer TEXT,
    unitnummer TEXT,
    datum_vordering TEXT NOT NULL,
    omschrijving_vordering TEXT,
    factuurnummer TEXT,
    totaalbedrag TEXT NOT NULL,
    bedrag_afgeboekt TEXT NOT NULL,
    openstaand TEXT NOT NULL,
    afgehandeld_periode TEXT,
    afgehandeld_jaar TEXT,
    PRIMARY KEY (bedrijfsnr, contractnr, vordering_volgnr)
  )`,
  `CREATE TABLE cache_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

export type CacheTableName =
  | "boekingen"
  | "balansstanden"
  | "servicekosten"
  | "contracten"
  | "units"
  | "rentroll"
  | "complex_totalen"
  | "ouderdomsanalyse"
  | "contract_verhogingen"
  | "vorderingen_met_afboekingen";
