# BVC Rapportage

Financiële vastgoedrapportagetool voor BVC. Deze repository wordt herbouwd
volgens het overdrachtsdossier **Vastgoed-AI_Architectuur_v2.0** (Google
Drive, eigenaar BVC) — dat dossier is inhoudelijk leidend, niet dit
document. Bij twijfel: lees eerst `CLAUDE_PROJECTINSTRUCTIES.md` en
`00_PROJECTSTATUS.md` in dat dossier.

## Waarom een relationele database (niet Firestore)

Het zusterproject `actielijst-online` gebruikt Firebase/Firestore. Dit
project gebruikt in plaats daarvan **PostgreSQL**, om twee redenen:

1. Het is een formeel vastgesteld ontwerpbesluit in het dossier
   (**OB-033**: *"Zonder bruikbare bestaande repository geldt TypeScript
   met een relationele PostgreSQL-datalaag als technische standaard."*).
2. De brondata is inherent relationeel: samengestelde natuurlijke sleutels
   (bv. `Bedrijfsnr + Boekjaar + Dagboeknr + Boekstuknr + Volgnr`),
   verplichte debet/credit-boekstukintegriteit, en sterk genormaliseerde
   entiteiten (`administratie → complex → unit`, contract-koppelingen,
   grootboekmapping) — precies het soort data waar foreign keys en
   transacties voor bedoeld zijn.

## Structuur

```
apps/
  web/              Next.js-app (rapportages, dashboards — nog grotendeels te bouwen)
  worker/           Importjobs: bronbestand -> validatie -> staging (CLI, geen live cron/queue nog)
packages/
  domain/           Centrale berekeningen (CAL-FIN-*, CAL-VG-*, CAL-CTR-*) — geen rapportlokale formules
  data-contracts/   Zod-schema's + parsers per brontype, op de ECHTE kolomnamen van de IDBC-exports
  db/               Prisma-schema (PostgreSQL) — staging + kernmodel
  reporting/        Nog leeg — rapportdefinities/KPI-laag volgt in een latere fase
  tests/            Nog leeg — integratie-/e2e-tests volgen in een latere fase
legacy/             De oorspronkelijke single-file HTML-prototype, bewaard als referentie
```

## Wat nu al werkt (Fase 1: import, staging, datakwaliteit)

- `packages/data-contracts`: Zod-broncontracten voor de 7 IDBC-bronnen
  (Boekingen, Balans, Servicekosten, Contracten, Units, RentRoll, Complex
  Totalen), opgebouwd op **echte, bij het bronbestand geverifieerde
  kolomnamen** — niet verzonnen. Twee bevestigde naamsinconsistenties
  tussen bronnen zijn expliciet in code gedocumenteerd: RentRoll gebruikt
  `Bedrijfsnummer` (niet `Bedrijfsnr`), Complex Totalen gebruikt
  `Complexnr` (niet `Complexnummer`).
- `packages/domain`: centrale financiële en vastgoedberekeningen
  (`Boeking_Saldo`, boekstukcontrole, bezettingsgraad, oppervlaktehiërarchie,
  jaarhuur, ...) met unit tests die expliciet de bekende fouten uit het
  foutdossier reproduceren (bv. de bankaansluiting-afwijking uit FA-005).
- `packages/db`: Postgres-schema met append-only staging (ruwe rij +
  gevalideerde sleutelvelden) en het begin van het genormaliseerde model
  (`dim_administratie`, `dim_complex`, `dim_unit`, `dim_grootboekrekening`,
  `map_rapportregel_grootboekrekening`, `fact_grootboekboeking`,
  `fact_balansstand`, `ctrl_data_check`, `def_managementparameter` — geseed
  met de pilot-startwaarden uit `12_MANAGEMENTPARAMETERS_v0.1.md`).
- `apps/worker`: CLI die een bronbestand valideert en wegschrijft naar de
  bijbehorende staging-tabel, idempotent op bestandshash.

## Wat nadrukkelijk nog NIET gebouwd is

- **Rapportpagina's, dashboards, KPI-schermen** — `apps/web` is een
  placeholder. De rapportdefinities/KPI-laag (`packages/reporting`) is leeg.
- **Contract-, huur- en servicekosten-domeinmodel** (`dim_huurder`,
  `dim_contract`, `link_contract_*`, `fact_contract_prijsregel`,
  `fact_rentrollregel`, `fact_servicekostenregel`, `fact_budgetregel`,
  `fact_signalering`, `fact_managementaandachtspunt`, `def_kpi`,
  `def_rapportregel`) — volgt in latere MVP-stappen per
  `11_IMPLEMENTATIE_ROADMAP.md`.
- **Grootboekmapping-goedkeuring**: er is geen enkele `GOEDGEKEURD`-mapping.
  Claude mag mappings alleen als `VOORGESTELD` registreren (OB-034) —
  productierapporten zijn hierdoor sowieso nog geblokkeerd (PAR-MAP-001).
- **Authenticatie/rollen** (Beheerder, Financieel beoordelaar,
  Vastgoedmanager, Eigenaar/lezer, Applicatiebeheerder).
- **Hosting/deploy**: nog geen gekozen omgeving voor Next.js + PostgreSQL
  (Firebase Hosting alleen volstaat hier niet — dat host geen server/DB).
  De CI-workflow (`.github/workflows/ci.yml`) bouwt/test alleen, deployt niets.
- Bronnen die het dossier zelf al blokkeert: openstaande-postenbron
  (debiteurenouderdom), bankstreefwaarden per administratie, en het lege
  bestand "Nog onbekend" (geen data, niet importeren tot geïdentificeerd).

## Lokale ontwikkeling

```bash
pnpm install
cp packages/db/.env.example packages/db/.env   # DATABASE_URL naar een lokale Postgres
pnpm db:generate
pnpm db:validate
pnpm typecheck
pnpm test
```

## Herkomst

Broninspectie (kolomkoppen, sleutels, dataconventies) is uitgevoerd tegen
de daadwerkelijke IDBC-exportbestanden uit de Drive-map `03_Databronnen`
van het overdrachtsdossier — niet tegen sjablonen. Zie de Zod-schema's in
`packages/data-contracts/src/sources/*.ts` voor de exacte, geverifieerde
kolomnamen per bron.
