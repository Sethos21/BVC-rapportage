# BVC Rapportage (FinancieelRapport)

Financiële vastgoedrapportagetool voor BVC. Inhoudelijk leidend is het
overdrachtsdossier **Vastgoed-AI_Architectuur_v2.0** (Google Drive,
eigenaar BVC), aangevuld en op punten overruled door twee latere lokale
overdrachtsdocumenten:

1. `CLAUDE_OVERDRACHT_LOKALE_DATAOPZET_v0.1.md`
2. `CLAUDE_AANVULLENDE_INSTRUCTIES_LOKALE_BRONNEN_v0.1.md` (laatste woord
   bij conflicten over repository, lokale opslag en bronselectie)

Dit document is een samenvatting, geen vervanging — bij twijfel gelden de
brondocumenten.

## Architectuur: lokaal, geen cloud, geen centrale database

**Belangrijke koerswijziging (2026-08-12):** het project startte als een
cloud-architectuur (Next.js + PostgreSQL, zie git-historie). Seth heeft dat
expliciet teruggedraaid: de applicatie moet **lokaal/on-premise** draaien,
bereikbaar binnen het interne bedrijfsnetwerk, zonder publieke SQL-hosting
of centrale databaseserver — de gegevens blijven in de werkomgeving.

- **Geen PostgreSQL, geen Prisma.** In plaats daarvan: de xlsx-bronbestanden
  zelf zijn leidend; een lokaal, volledig herbouwbaar SQLite-bestand
  (`node:sqlite`, ingebouwd in Node 22) dient uitsluitend als cache/index
  per administratie (`packages/cache`).
- **Eén administratie tegelijk**, niet-gelijktijdig gebruik door Seth en
  een paar collega's.
- **Hybride bronopslag**: per brontype én per administratie wordt expliciet
  gekozen tussen `gedeeld` (één centrale map met regels voor meerdere
  administraties, gefilterd op `Bedrijfsnr`) of `eigen` (bronmap van die
  ene administratie). Nooit automatisch samenvoegen of uitwijken.
- **Geen bronarchief.** Per bronmap/brontype staat alleen het actuele
  bestand; een geldige nieuwe import vervangt het vorige atomisch. Geen
  historische kopieën — wel auditmetadata (jsonl).

## Structuur

```
apps/
  web/              Next.js-app (rapportages — nog grotendeels te bouwen; draait lokaal, geen cloud-hosting)
  worker/           Bronresolver, veilig vervangingsprotocol, cache-herbouw (CLI)
packages/
  domain/           Centrale berekeningen + geld-/percentageformattering (CAL-FIN-*, CAL-VG-*, CAL-CTR-*, huisstijlregels)
  data-contracts/   Zod-schema's + parsers per brontype, op de ECHTE kolomnamen van de IDBC-exports
  cache/            Lokale herbouwbare SQLite-cache (geen systeem-van-record)
  reporting/        Nog leeg — rapportdefinities/KPI-laag volgt in een latere fase
  tests/            Nog leeg — integratie-/e2e-tests volgen in een latere fase
legacy/             De oorspronkelijke single-file HTML-prototype, bewaard als referentie
```

### Databronmap (runtime, niet in git)

```
<BVC_DATA_ROOT>/
├── config/                          rapportdefinities/, grootboekmappings/, managementparameters/
├── bron_gedeeld/                    boekingen.xlsx, balans_per_jaar.xlsx, rentroll.xlsx, ...
├── audit/import_log_gedeeld.jsonl
└── administraties/<Bedrijfsnr>_<naam>/
    ├── administratie.json           bronlocaties per brontype: 'gedeeld' | 'eigen'
    ├── bron/                        alleen brontypen op 'eigen' (standaard: begroting)
    ├── cache/cache.sqlite           volledig herbouwbaar, geen historie
    ├── rapporten/
    └── audit/import_log.jsonl
```

`BVC_DATA_ROOT` is bewust configureerbaar (env var), geen hardcoded pad —
dit draait op verschillende werkcomputers.

## Wat nu al werkt

- **`packages/data-contracts`** — Zod-broncontracten voor 8 IDBC-bronnen
  (Boekingen, Balans, Servicekosten, Contracten, Units, RentRoll, Complex
  Totalen, **Ouderdomsanalyse**), op **echte, geverifieerde kolomnamen**.
  Bevestigde naamsinconsistenties tussen bronnen zijn expliciet in code
  gedocumenteerd (RentRoll: `Bedrijfsnummer`; Complex Totalen: `Complexnr`).
- **`packages/domain`** — centrale financiële/vastgoedberekeningen plus
  geld-/percentageformattering conform de huisstijl- en rekenregels
  (`€ 1.250,75`, centen afronden per stap, nul is geldig, totalen altijd
  controleren).
- **`packages/cache`** — bouwt en opent de lokale SQLite-cache.
- **`apps/worker`** — bronresolver (`gedeeld`/`eigen`, nooit samenvoegen),
  het veilige vervangingsprotocol (kopie → hash+validatie → bij fout niets
  wijzigen → atomisch vervangen → caches ongeldig maken → audit → opruimen),
  een crash-herstelbare lockfile, en cache-herbouw met verplichte
  administratiescheiding (getest: een gedeeld bronbestand met meerdere
  administraties lekt nooit rijen tussen administraties).

## Wat nadrukkelijk nog NIET gebouwd is

- **Rapportpagina's/exports** (HTML/PDF/DOCX in BVC-huisstijl) — `apps/web`
  is een placeholder. Eerste concrete doel: P&L-exploitatierapportage per
  vastgoedobject (testcase: object 070 "Rooise Zoom", 2020–2026).
- **Begroting-broncontract**: `BVC_Begrotingsformat_v0.2.xlsx` heeft nog
  geen volledig Zod-contract (alleen leesbaarheid wordt nu gecontroleerd) —
  zie `apps/worker/src/validateBron.ts`.
- **Contract-, huur- en servicekosten-rapportlogica**, grootboekmapping-
  goedkeuring (alleen `VOORGESTELD` mag Claude registreren, nooit
  `GOEDGEKEURD`), authenticatie/rollen.
- **Definitieve locatie** van `BVC_DATA_ROOT` en back-upeigenaar — open punt.
- Deze repository blijft voorlopig op GitHub (`Sethos21/BVC-rapportage`,
  waar deze sessie al op werkte toen de "geen nieuwe repo zonder
  goedkeuring"-instructie kwam) — verhuizing naar `BVC-Tools/apps/FinancieelRapport/`
  is een aparte, latere goedkeuringsstap, geen automatisme.

## Lokale ontwikkeling

```bash
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test

# CLI (vereist BVC_DATA_ROOT):
export BVC_DATA_ROOT=/pad/naar/BVC-FinancieelRapport
pnpm --filter @bvc/worker cli status <administratieId>
pnpm --filter @bvc/worker cli replace boekingen gedeeld /pad/naar/nieuw-bestand.xlsx
pnpm --filter @bvc/worker cli rebuild-cache <administratieId>
```

## Herkomst

Broninspectie (kolomkoppen, sleutels, dataconventies) is uitgevoerd tegen
de daadwerkelijke IDBC-exportbestanden uit de Drive-map `03_Databronnen`
van het overdrachtsdossier — niet tegen sjablonen. Zie de Zod-schema's in
`packages/data-contracts/src/sources/*.ts` voor de exacte, geverifieerde
kolomnamen per bron.
