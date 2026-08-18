# @bvc/config

Versioned, config-gestuurde instellingen (CLAUDE.md §3: "geen hardcoded
uitzonderingen"). Elk bestand hier is een Zod-schema + een `parseX(ruw)`-
validator; de daadwerkelijke waarden staan in JSON-bestanden in de data
root (`BVC_DATA_ROOT/config/…`, buiten git — zie root-README §5), geladen
door `apps/worker`.

## Beheerparameters (`parameters.ts`)

Eén centraal, gedeeld bestand (`config/parameters.json`) met regels als
"kostensoort 9600 altijd uitgesloten van servicekosten". Ontbreekt het
bestand, dan gelden `STANDAARD_PARAMETERS` (reproduceert het gedrag van
vóór het config-gestuurd maken van deze regel) — zie
`apps/worker/src/parameters.ts`'s `laadBeheerparameters`.

## Grootboekmapping (`grootboekmapping.ts`)

Centrale, config-gestuurde classificatie van grootboekrekeningen naar
rapportageposten — **de eerstvolgende stap na het Controlerapport op de
echte cache van `070_Rooise_Zoom`**, en de enige plek waar deze
classificatie mag staan (CLAUDE.md: "financiële classificatie loopt altijd
via de centrale mapping/configuratielaag"). Rapportage-/KPI-code leest
deze mapping, bepaalt hem nooit zelf.

### Opslag: één bestand per administratie

`config/grootboekmappingen/<administratieId>.json` in de data root (pad:
`apps/worker/src/paths.ts`'s `grootboekmappingPad`). Bewust **geen**
centrale standaardmapping/fallback: ontbreekt het bestand voor een
administratie, dan gooit `apps/worker/src/grootboekmapping.ts`'s
`leesGrootboekMapping` een duidelijke fout ("nog niet geconfigureerd") —
nooit stilzwijgend de mapping van een andere administratie hergebruiken of
met een lege mapping doorgaan. Dit ondersteunt direct de eis "later per
administratie aan te passen": elke administratie heeft haar eigen
bestand/regels, zonder codewijziging.

### Structuur

Elke regel heeft een `soort`: `"RESULTAAT"` (V&W-rekening, komt in de P&L)
of `"BALANS"` (balansrekening, hoort nooit in een P&L). Dat onderscheid komt
rechtstreeks uit de "Srt"-kolom (Bal/V&W) van het officiële rekeningschema
van de bron ("Rekeningschema basisgegevens" per administratie/bedrijf) —
geen zelfbedachte categorie.

```jsonc
// RESULTAAT-regel: volledige P&L-classificatie nodig
{
  "grootboekrekening": "4000",       // grootboekrekeningnummer uit de bron
  "soort": "RESULTAAT",
  "rapportagepost": "Beheerkosten",  // specifieke rapportregel
  "rapportagecategorie": "Kosten",   // bredere groepering
  "tekenconventie": "ZOALS_BRON",    // "ZOALS_BRON" | "OMGEKEERD" | null (nog niet bevestigd)
  "actief": true,                    // operationele aan/uit-schakelaar
  "status": "GOEDGEKEURD"            // "VOORGESTELD" | "GOEDGEKEURD" — GOEDGEKEURD is een menselijke stap
}

// BALANS-regel: geen rapportagepost/-categorie/tekenconventie — niet van toepassing
{
  "grootboekrekening": "1010",       // Bank NL44RABO 0337 7344 45
  "soort": "BALANS",
  "actief": true,
  "status": "GOEDGEKEURD"
}
```

Een grootboekrekening mag maar één keer in `regels` voorkomen —
`parseGrootboekMapping` wijst dubbele nummers af (ambigue mapping), ook
tussen `RESULTAAT` en `BALANS` heen. Het schema is `strict()`: een
BALANS-regel met een `rapportagepost`-veld (of omgekeerd) wordt geweigerd,
niet stilzwijgend genegeerd.

`@bvc/reporting`'s `berekenPlPeriode` behandelt de twee soorten fundamenteel
anders: een BALANS-rekening met saldo in de periode wordt **stil genegeerd**
(bekend, bewust buiten P&L-scope — geen post, geen `controleVereist`). Een
rekening die helemaal niet in de mapping voorkomt (of inactief is) komt wél
in `controleVereist` terecht — dat onderscheid (bekend-en-uitgesloten versus
onbekend) is precies waarom dit veld bestaat: in de praktijk raakt vrijwel
elke boeking ook een balansrekening (tegenboeking op bank/debiteuren/
crediteuren/tussenrekening), en die mogen niet als "nog te classificeren"
blijven opduiken.

Nieuwe rekening toevoegen of een bestaande aanpassen: bewerk het JSON-
bestand van die administratie en voeg/wijzig een regel — geen
codewijziging nodig. Een rekening die niet meer gebruikt moet worden,
wordt op `"actief": false` gezet (niet verwijderd, zodat de historische
regel zichtbaar blijft) — `zoekMappingRegel` (`@bvc/domain`) behandelt een
inactieve regel hetzelfde als een onbekende rekening (`OnbekendOf`
"onbekend").

### Tekenconventie

- **`"ZOALS_BRON"`** — rapportagebedrag = brondata-saldo (debet − credit)
  ongewijzigd.
- **`"OMGEKEERD"`** — rapportagebedrag = −1 × brondata-saldo. Vooral
  relevant voor omzetrekeningen (bv. `8800`) die credit-normaal geboekt
  worden en in de bron als negatief saldo verschijnen, maar in de
  managementrapportage als positief opbrengstbedrag getoond moeten worden.
- **`null`** — nog niet bevestigd. `@bvc/domain`'s
  `presentatiefactorVoorRegel` geeft dan `OnbekendOf`-`onbekend` terug —
  nooit stilzwijgend `"ZOALS_BRON"`/factor 1 aannemen.

### Goedgekeurde mapping voor `070_Rooise_Zoom` (27 rekeningen: 14 RESULTAAT + 13 BALANS)

**RESULTAAT (14)** — afgeleid door de gebruiker uit vergelijking van het
Controlerapport tegen de bestaande Q2-2026-rapportage, en vervolgens
expliciet **GOEDGEKEURD** inclusief tekenconventie per rekening
(2026-08-17). `rapportagecategorie` is hier mechanisch afgeleid uit de
standaard grootboek-nummerconventie (4xxx = Kosten, 8xxx = Opbrengsten);
een fijnere indeling is voorlopig bewust niet gewenst (zie "Bewust
uitgesteld" hieronder).

| grootboekrekening | rapportagepost | rapportagecategorie | tekenconventie |
|---|---|---|---|
| 4000 | Beheerkosten | Kosten | ZOALS_BRON |
| 4130 | Verzekeringen | Kosten | ZOALS_BRON |
| 4300 | Onderhoud gebouwen | Kosten | ZOALS_BRON |
| 4330 | Onderhoud terrein | Kosten | ZOALS_BRON |
| 4340 | Onderhoud installaties | Kosten | ZOALS_BRON |
| 4350 | Servicekosten eigenaar | Kosten | ZOALS_BRON |
| 4700 | WOZ / OZB | Kosten | ZOALS_BRON |
| 4710 | Gemeentelijke heffingen | Kosten | ZOALS_BRON |
| 4903 | Niet verrekenbare BTW | Kosten | ZOALS_BRON |
| 4990 | Diverse algemene kosten | Kosten | ZOALS_BRON |
| 8800 | Huuropbrengsten belast | Opbrengsten | OMGEKEERD |
| 8801 | Huuropbrengsten onbelast | Opbrengsten | OMGEKEERD |
| 8805 | Verleende huurkorting | Opbrengsten | OMGEKEERD |
| 8815 | Zonnestroom | Opbrengsten | OMGEKEERD |

**BALANS (13)** — bevestigd tegen het officiële rekeningschema van bedrijf
070 ("Rekeningschema basisgegevens", Srt-kolom Bal/V&W, 2026-08-18) nadat
een eerste `pl-periode`-run op boekjaar 2026 periode 1 t/m 6 deze exacte 13
rekeningen als `controleVereist` naar boven bracht (elke boeking raakt ook
een balansrekening — bank, debiteuren/crediteuren, tussenrekeningen). Geen
enkele bleek een V&W-rekening.

| grootboekrekening | omschrijving |
|---|---|
| 0840 | Ontrekkingen - Uitkeringen |
| 0901 | Voorziening onderhoud Zoom 1 |
| 0902 | Voorziening onderhoud Zoom 2 |
| 0903 | Voorziening onderhoud Zoom 3 |
| 1010 | Bank NL44RABO 0337 7344 45 |
| 1310 | Huurdebiteuren |
| 1400 | Te ontvangen vergoedingen |
| 1410 | Vooruitbetaalde kosten |
| 1506 | Afdrachten BTW |
| 1600 | Crediteuren |
| 1700 | Te betalen kosten |
| 1711 | Tussenrekening servicekst |
| 1712 | Betaalde Service kosten |

Alle 27 regels: `"actief": true`, `"status": "GOEDGEKEURD"`.

Het kant-en-klare JSON-bestand voor deze 27 regels staat in
`packages/tests/src/fixtures.ts`'s `rooiseZoomGrootboekMapping()` (gebruikt
door de tests als representatieve fixture — zie hieronder). Omdat
`BVC_DATA_ROOT` buiten git staat (CLAUDE.md §5), moet de gebruiker dit
bestand zelf naar
`<BVC_DATA_ROOT>/config/grootboekmappingen/070_Rooise_Zoom.json` kopiëren
om het daadwerkelijk te gebruiken — dit gebeurt niet automatisch.

Nog niet in de mapping (nog geen boekingen-activiteit gezien in periode 1
t/m 6 van 2026, dus nog niet als `controleVereist` naar boven gekomen, maar
wél bekend uit het rekeningschema als V&W-rekening): `8810` (Opbr.
administratiekosten), `9100` (Mutatie voorzieningen), en overige
V&W-rekeningen die niet in de eerste 14 stonden (`8820`, `9400`, `9800`,
`9900`). Zodra die in een toekomstige periode saldo hebben, brengt
`pl-periode` ze vanzelf naar boven — dan classificeren we ze op dezelfde
manier, niet vooraf gokken.

### Bewust uitgesteld (geen open keuze, expliciet besluit)

- **Rapportagecategorie-granulariteit** — voorlopig bewust alleen Kosten/
  Opbrengsten; een fijnere indeling (Beheer/Onderhoud/Belastingen en
  heffingen/Servicekosten/Huuropbrengsten/Overige opbrengsten) komt pas
  later als daar behoefte aan is.

### Technisch aandachtspunt: verhouding tot het bestaande `GrootboekMapping`-type in `@bvc/domain`

`@bvc/domain`'s `types.ts` bevat een ouder, uitgebreider `GrootboekMapping`-
type (`balansOfResultaat`/`rapportcode`/`presentatiefactor`/`geldigVanaf`/
`status`/`versie`, gebruikt door `finance.ts`'s
`rapportbedrag`/`nietGemapteRekeningenMetSaldo`), afkomstig uit een extern
dossierdocument (`GROOTBOEKMAPPING_SPEC_v0.1.md`, niet in deze repository)
met een geldigheids-/goedkeuringsmodel per periode, tot nu toe zonder
opslag-/laadlaag. Deze bouwstap introduceert bewust een **apart,
eenvoudiger** schema (`GrootboekMappingRegel`) dat exact de gevraagde
velden dekt (rapportagepost/rapportagecategorie/tekenconventie/actief),
zonder de bestaande `finance.ts`-functies aan te passen. Op expliciet
verzoek van de gebruiker blijft dit zo: **geen samenvoeging en geen
verwijdering nu** — dit is een bewust uitgestelde beslissing, geen open
vraag die om een antwoord vraagt. Twee `GrootboekMapping`-achtige modellen
naast elkaar in de codebase is de bekende, geaccepteerde staat totdat een
latere sessie hier expliciet een beslissing over neemt.

### Nog niet inhoudelijk bevestigd

- **Balans op een specifieke boekperiode** (zie `@bvc/cache`'s
  `periodeSelectie.ts`) kan de huidige cache niet leveren — een bekend gat,
  geen aanname.
