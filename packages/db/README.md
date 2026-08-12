# @bvc/db

PostgreSQL-schema (Prisma) voor BVC Rapportage. Zie de root-README voor
waarom dit een relationele database is (OB-033) in plaats van het
Firestore-patroon van het zusterproject `actielijst-online`.

## Scope van dit schema (nu)

- **Staging**: `stg_import_batch` + één tabel per brontype
  (`stg_boekingsregel`, `stg_balansstand`, `stg_servicekostenregel`,
  `stg_contract`, `stg_rentrollregel`, `stg_unit`, `stg_complex_totaal`,
  `stg_begrotingregel`). Sleutel-/rekenvelden zijn expliciete kolommen
  (gevalideerd tegen `@bvc/data-contracts`); de volledige brongetrouwe rij
  staat daarnaast in `raw` (Json) voor volledige herleidbaarheid zonder
  alle 37–170 bronkolommen 1-op-1 te modelleren — dit volgt de
  `stg_bronrecord`-instructie uit het logisch datamodel ("ruwe payload").
- **Kernmodel**: `dim_administratie`, `dim_complex`, `dim_unit`,
  `dim_grootboekrekening`, `map_rapportregel_grootboekrekening`,
  `fact_grootboekboeking`, `fact_balansstand`, `ctrl_data_check`,
  `def_managementparameter` (geseed met de pilot-startwaarden uit
  `12_MANAGEMENTPARAMETERS_v0.1.md`, m.u.v. de verplicht per-administratie
  bankstreefwaarde `PAR-LIQ-001`, die bewust geen default heeft).

## Nadrukkelijk nog niet in dit schema

Dit is Fase 1 (import/staging/datakwaliteit) plus het begin van Fase 2
(grootboekmapping) uit `11_IMPLEMENTATIE_ROADMAP.md`. Nog te bouwen in latere
fasen: `dim_huurder`, `dim_contract`, `link_contract_complex`/`link_contract_unit`,
`fact_contract_prijsregel`, `fact_rentrollregel`, `fact_servicekostenregel`,
`fact_budgetregel`, `map_budgetregel`, `map_servicekostensoort`,
`fact_signalering`, `fact_managementaandachtspunt`, `def_kpi`, `def_rapportregel`.
Deze zijn expliciet weggelaten, niet vergeten — ze horen bij de latere
MVP-stappen (huur/contracten, onderhoud/investeringen, servicekosten,
begroting, signaleringen) en zouden nu ongebruikte, ongeteste tabellen zijn.

## Gebruik

```bash
cp .env.example .env   # DATABASE_URL invullen
pnpm --filter @bvc/db generate
pnpm --filter @bvc/db validate
pnpm --filter @bvc/db migrate:dev   # vereist een draaiende Postgres
```

Er is nog geen gekozen hosting/managed-Postgres-omgeving (open punt, zie
root-README) — `DATABASE_URL` wijst voorlopig naar een lokale/dev-database.
