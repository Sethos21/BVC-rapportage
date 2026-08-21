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

### Opslag: centrale master + administratie-override

Twee lagen, samengevoegd door `resolveerGrootboekMapping` (`@bvc/domain`):

- **Master** — `config/grootboekmapping_master.json` (één bestand, geen
  `administratieId`, pad: `apps/worker/src/paths.ts`'s
  `grootboekmappingMasterPad`). Rekeningen waarvan de classificatie
  **betrouwbaar gelijk is over ≥2 administraties** — bevestigd via
  `@bvc/reporting`'s `inventariseerGrootboekrekeningen` (CLI: `bvc-worker
  grootboek-inventarisatie`), nooit een rekening die maar bij één
  Bedrijfsnr voorkomt (zie "Migratie" hieronder voor waarom).
- **Override** — `config/grootboekmappingen/<administratieId>.json` (pad:
  `grootboekmappingPad`). Mag **partieel** zijn: alleen de regels die voor
  die administratie afwijken van (of ontbreken in) de master. Een
  administratie zonder afwijkingen hoeft geen eigen regels te hebben — een
  lege `regels`-lijst (of het hele bestand afwezig) betekent "volg de
  master volledig".

Bij het laden (`apps/worker/src/grootboekmapping.ts`'s `leesGrootboekMapping`)
wint de override-regel per grootboekrekening als die bestaat, anders geldt
de master-regel. Beide bestanden zijn los OPTIONEEL (ontbreekt er één, dan
wordt die als leeg behandeld); zijn ze ALLEBEI afwezig voor een
administratie, dan gooit `leesGrootboekMapping` een duidelijke fout ("nog
niet geconfigureerd") — nooit stilzwijgend met een lege mapping doorgaan.
Dit ondersteunt direct de eis "niet elke administratie volledig apart
hoeven mappen, alleen afwijkingen en onbekende rekeningen beoordelen".

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

// BALANS-regel: geen rapportagepost/-categorie — niet van toepassing.
// balanszijde, tekenconventie EN liquideMiddelen zijn WEL verplicht aanwezig (mogen elk apart
// `null` zijn = nog niet bevestigd) — zie "Balanszijde ≠ presentatieteken" hieronder.
// balanszijde = vaste eigenschap van de rekening; tekenconventie = hoe het saldo BINNEN die
// zijde getoond wordt; liquideMiddelen = is dit een bank/kas-rekening (voor de Kasstroom-sectie,
// packages/reporting/README.md) — drie onafhankelijke velden.
{
  "grootboekrekening": "1010",       // Bank NL44RABO 0337 7344 45
  "soort": "BALANS",
  "balanszijde": "ACTIVA",           // "ACTIVA" | "PASSIVA" | null (nog niet bevestigd)
  "tekenconventie": "ZOALS_BRON",    // "ZOALS_BRON" | "OMGEKEERD" | null (nog niet bevestigd)
  "liquideMiddelen": null,           // true | false | null (nog niet bevestigd) — zie "Kasstroom" hieronder
  "actief": true,
  "status": "GOEDGEKEURD"
}
```

### Balanszijde (`balanszijde`, alleen BALANS-regels)

Toegevoegd 2026-08-19 na een echte productie-run van `balans-periode` voor
`070_Rooise_Zoom` (zie root-README/packages/reporting/README.md voor de
volledige toelichting bij de balansmodule). Eerdere versie leidde Activa/
Passiva af uit het teken van het berekende saldo — dat bleek fout: een
balanszijde is een **vaste eigenschap van de rekening zelf** (bank en
debiteuren horen bij Activa, crediteuren/voorzieningen/eigen vermogen bij
Passiva), nooit een gevolg van een tijdelijk saldoteken. Een debiteuren-
rekening met een vooruitbetalende huurder (creditsaldo) blijft Activa, met
een zichtbaar negatief bedrag — verhuist niet naar Passiva.

`balanszijde` is *nullable, niet optioneel*: het veld moet aanwezig zijn,
maar mag `null` zijn zolang de kant nog niet is vastgesteld — exact
hetzelfde patroon als `tekenconventie` bij RESULTAAT-regels.
`@bvc/domain`'s `balanszijdeVoorRegel` geeft dan `OnbekendOf`-`onbekend`
terug; `berekenBalansPeriode` zet zo'n rekening in `controleVereist`, nooit
een kant gokt op het saldoteken.

#### Balanszijde ≠ presentatieteken (ontwerpcorrectie 2026-08-20)

Een echte productie-run liet zien dat de eerdere aanpak — Activa/Passiva
plus impliciet "toon het rauwe saldo, geen tekenomkering" — verkeerd
overkwam: vrijwel alle Passiva-rekeningen kwamen daardoor negatief uit
(credit-normaal), terwijl een balans normaliter schulden/voorzieningen als
POSITIEF bedrag toont. De fout zat niet in `balanszijde` zelf (dat blijft
correct: een vaste eigenschap, nooit uit het saldoteken afgeleid), maar in
het ontbreken van een DERDE, apart concept: hoe het werkelijk berekende
saldo BINNEN die balanszijde getoond wordt. Vandaar `tekenconventie` — nu
óók op `BalansRegel`, exact hetzelfde schema/patroon als bij RESULTAAT-
regels (`"ZOALS_BRON" | "OMGEKEERD" | null`, nullable, nooit een default
aangenomen). Bewust GEEN generieke regel per balanszijde (bv. "alle Passiva
OMGEKEERD"): welke conventie een rekening nodig heeft, staat per rekening
vast, niet per zijde — zie de tabel hieronder waar twee PASSIVA-
voorzieningsrekeningen (0902/0903, credit-normaal, rauw saldo negatief) wél
`OMGEKEERD` nodig hebben om positief te tonen, maar hun zusterrekening 0901
(dezelfde soort, maar rauw saldo positief in deze dataset) juist
`ZOALS_BRON` nodig heeft — een generieke regel per balanszijde (of zelfs
per "soort" rekening) had dit niet correct kunnen dekken, exact het punt
van deze correctie.

#### Balanszijde/tekenconventie `070_Rooise_Zoom` (bijgewerkt 2026-08-21)

**Balanszijde** — 14 van de 15 BALANS-rekeningen zijn nu vastgelegd (`0850`
en `1790` zijn deze ronde nieuw toegevoegd, gevonden dankzij de
bugfix hieronder; alleen 1506 blijft expliciet ongeclassificeerd):

| grootboekrekening | omschrijving | balanszijde | motivatie |
|---|---|---|---|
| 1010 | Bank NL44RABO 0337 7344 45 | ACTIVA | bankrekening (gebruiker) |
| 1310 | Huurdebiteuren | ACTIVA | debiteuren (gebruiker) |
| 1400 | Te ontvangen vergoedingen | ACTIVA | "te ontvangen" = vordering |
| 1410 | Vooruitbetaalde kosten | ACTIVA | vooruitbetaling = vordering |
| 1712 | Betaalde Service kosten | ACTIVA | gebruiker (2026-08-20) |
| 1600 | Crediteuren | PASSIVA | crediteuren (gebruiker) |
| 1700 | Te betalen kosten | PASSIVA | "te betalen" = schuld |
| 1711 | Tussenrekening servicekst | PASSIVA | gebruiker (2026-08-20) |
| 0840 | Ontrekkingen - Uitkeringen | PASSIVA | eigen vermogen/onttrekkingen (gebruiker) |
| 0850 | Resultaat vorig boekjaar | PASSIVA | eigen vermogen — gebruiker (2026-08-21), gevonden via de beginbalans-bugfix |
| 0901/0902/0903 | Voorziening onderhoud Zoom 1/2/3 | PASSIVA | voorziening (gebruiker) |
| 1790 | Waarborgsommen | PASSIVA | schuld aan huurders — gebruiker (2026-08-21), gevonden via de beginbalans-bugfix |

**Nog `null`:** `1506` Afdrachten BTW — de gebruiker heeft expliciet
gevraagd deze nog niet te classificeren.

**Tekenconventie** — per 2026-08-21 zijn 14 van de 15 rekeningen bevestigd
(alleen 1506 blijft `null`). Voor 1010/1310/1400/1410 volgt de conventie
direct uit "mag daar negatief zijn" (= toon ongewijzigd, geen aanname
nodig):

| grootboekrekening | tekenconventie | onderbouwing |
|---|---|---|
| 1010, 1310, 1400, 1410 | ZOALS_BRON | expliciet: "mag daar negatief zijn" — geen omkering, toon het rauwe saldo |
| 0840 | OMGEKEERD | **Herzien 2026-08-21 — was eerder ZOALS_BRON.** Eerste inschatting (2026-08-20): het rauwe saldo van 0840 (+2.703.646,45) matchte exact de "Algemene Reserve"-waarde uit de bestaande Q2-rapportage, dus ZOALS_BRON leek juist. De gebruiker corrigeerde dit expliciet: 0840 ("Ontrekkingen - Uitkeringen") moet als NEGATIEF bedrag op Passiva getoond worden — onttrekkingen/uitkeringen verminderen het eigen vermogen, terwijl `0850` (Resultaat vorig boekjaar) juist positief blijft. Rauw `+2.703.646,45` × −1 = `−2.703.646,45`, dus technisch `OMGEKEERD`. **Dit is expliciet een 070-specifieke herstructurering, (nog) niet bij andere administraties.** |
| 0850 | OMGEKEERD | Resultaat vorig boekjaar — nieuw sinds de omschrijvingswijziging bij 0840; door de beginbalans-bugfix (zie packages/reporting/README.md) voor het eerst zichtbaar geworden (~€2,33M) en door de gebruiker bevestigd op basis van de gewenste eindpresentatie. |
| 1600, 1700 | OMGEKEERD | crediteuren/te betalen kosten — credit-normaal, moet als positieve schuld getoond worden. Bevestigd door de gebruiker "voor 070"; `1600`/`1700` staan in de master alleen met `balanszijde` (tekenconventie `null`, nog niet cross-administratie bevestigd) — de tekenconventie is daarom uitsluitend als override bij 070 vastgelegd, niet in `grootboekmapping_master.json`. |
| 1711 | OMGEKEERD | tussenrekening servicekosten — credit-normaal, zelfde redenering als 1600/1700. |
| 1712 | ZOALS_BRON | betaalde servicekosten — debet-normaal, rauw saldo al correct. Zelfde master/override-verhouding als 1600/1700: master heeft `balanszijde` maar geen tekenconventie, de 070-bevestiging staat in de override. |
| 1790 | OMGEKEERD | waarborgsommen — credit-normaal (schuld aan huurders), zelfde als 1600/1700/1711. Nieuw account, door de beginbalans-bugfix voor het eerst zichtbaar geworden. |
| 0901 | OMGEKEERD | **Let op — technisch tegengesteld aan hoe de gebruiker het account eerst in een losse opsomming benoemde.** De gebruiker gaf een uitgewerkt cijfervoorbeeld als leidend: rauw `+4.577,18` (positief debetsaldo) moet op de Passiva-zijde als `-4.577,18` getoond worden. Dat vereist factor −1, dus technisch `OMGEKEERD` — ondanks dat een eerdere losse bullet-opsomming per ongeluk "ZOALS_BRON" noemde. Het cijfervoorbeeld is leidend, op expliciet verzoek van de gebruiker ("Kies zelf de correcte enum op basis van wat die enum technisch doet"). |
| 0902, 0903 | OMGEKEERD | voorziening, credit-normaal (rauw saldo negatief), moet positief getoond worden — bevestigd met een uitgewerkt cijfervoorbeeld (rauw `-22.019,21`/`-3.939,55` → PASSIVA `+22.019,21`/`+3.939,55`). |

Merk op dat 0901 enerzijds en 0902/0903 anderzijds dezelfde `tekenconventie`
(OMGEKEERD) hebben, maar met tegengesteld rauw saldoteken (0901 rauw
positief, 0902/0903 rauw negatief) — precies de reden waarom
`tekenconventie` per rekening vastligt, nooit generiek per balanszijde of
per "soort" rekening afgeleid mag worden (zie de ontwerpcorrectie
hierboven).

**Bewust niet geclassificeerd (nog):** `1505`/`1506` vormen een BTW-paar
met exact tegengestelde bedragen. De gebruiker heeft expliciet gevraagd
hier GEEN classificatie uit af te leiden op basis van die toevallige
gelijke/tegengestelde bedragen — de relatie moet inhoudelijk (niet
statistisch) vastgesteld worden. `1505` komt daarom nergens in een
mapping-bestand voor (niet in master, niet in de 070-override); `1506`
blijft in de master staan met `balanszijde`/`tekenconventie` beide `null`.
Beide blijven zichtbaar in `controleVereist` tot de gebruiker ze
inhoudelijk classificeert.

Onvolledig bevestigde BALANS-regels (balanszijde en/of tekenconventie
`null`) staan op `"status": "VOORGESTELD"`, nooit stilzwijgend
`GOEDGEKEURD` — zie CLAUDE.md §6.

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

### Liquide middelen (`liquideMiddelen`, alleen BALANS-regels, 2026-08-22)

Derde, onafhankelijke classificatie op een BALANS-regel, toegevoegd als
voorbereiding op de Kasstroom-sectie (packages/reporting/README.md, eerste
versie: alleen mutatie bankstand). Bepaalt of een rekening meetelt in de
kasstroom-mutatie — los van `balanszijde` (alle liquide middelen zijn
ACTIVA, maar niet andersom: huurdebiteuren/vooruitbetaalde kosten zijn ook
ACTIVA maar geen liquide middelen) en los van `tekenconventie`.

- **`true`** — deze rekening is bank/kas, telt mee in de kasstroom-mutatie.
- **`false`** — bekend en bevestigd GEEN liquide middelen (bv. debiteuren).
  Wordt stil buiten de kasstroom-berekening gehouden, net als een BALANS-
  regel in de P&L — bekend-en-uitgesloten, geen `controleVereist`.
- **`null`** — nog niet bevestigd (de standaard voor elke bestaande regel
  op het moment dat dit veld werd toegevoegd — **ook voor `1010` Bank
  NL44RABO 0337 7344 45**, ondanks de vrij duidelijke rekeningnaam: deze
  classificatie is bewust NIET afgeleid uit de omschrijving/naam, exact
  dezelfde reden waarom `balanszijde`/`tekenconventie` nooit uit het
  saldoteken worden afgeleid — zie CLAUDE.md §3, geen string-matching op
  "Bank" als impliciete classificatieregel). Een rekening met een niet-nul
  mutatie in de periode blijft dan zichtbaar in de kasstroom-
  `controleVereist`, nooit stilzwijgend meegeteld of weggelaten.

**Nog te bevestigen voor `070_Rooise_Zoom`:** welke rekening(en) liquide
middelen zijn. `1010` (Bank NL44RABO 0337 7344 45) is de voor de hand
liggende kandidaat, maar is bewust NIET zelf op `true` gezet — dat is aan
de gebruiker.

### Migratie: van 27 regels bij `070_Rooise_Zoom` naar master + override (2026-08-19)

`070_Rooise_Zoom` bevestigde eerder 27 regels (14 RESULTAAT + 13 BALANS,
alle `"status": "GOEDGEKEURD"`). Een volledige `grootboek-inventarisatie`
over alle administraties (292 unieke grootboekrekeningen, 122 bij ≥2
Bedrijfsnr's, waarvan 66 daarbinnen consistent) leverde per rekening op of
die betrouwbaar gelijk is over administraties. **Promotie naar de master
vereist beide**: `consistent: true` ÉN gebruikt door ≥2 Bedrijfsnr's — een
rekening die (nog) maar bij één administratie voorkomt is per definitie
geen bewijs van cross-administratie-consistentie, ook al scoort hij zelf
`consistent: true` (dat bewijst dan alleen interne consistentie binnen dat
ene Bedrijfsnr).

**Naar `grootboekmapping_master.json` gepromoveerd (15 regels)** — status
**`VOORGESTELD`**, niet `GOEDGEKEURD`: promotie naar de master is een
nieuwe claim (deze classificatie geldt voor àlle administraties die deze
rekening gebruiken, niet alleen 070) die een AI-sessie niet zelf mag
goedkeuren (CLAUDE.md §6), ook niet als de onderliggende regel bij 070 al
goedgekeurd was:

| grootboekrekening | soort | rapportagepost/omschrijving | bevestigd bij Bedrijfsnr's |
|---|---|---|---|
| 4130 | RESULTAAT | Verzekeringen | 002,003,005,007,013,070,074 (7) |
| 4300 | RESULTAAT | Onderhoud gebouwen | 002,070,071,072,073,074 (6) |
| 4330 | RESULTAAT | Onderhoud terrein | 002,070,071 (3) |
| 4340 | RESULTAAT | Onderhoud installaties | 070,071,074 (3) |
| 4700 | RESULTAAT | WOZ / OZB | 002,070,074 (3) |
| 4710 | RESULTAAT | Gemeentelijke heffingen | 002,070,074 (3) |
| 4903 | RESULTAAT | Niet verrekenbare BTW | 002,070 (2) |
| 4990 | RESULTAAT | Diverse algemene kosten | 13 Bedrijfsnr's |
| 8801 | RESULTAAT | Huuropbrengsten onbelast | 002,013,070,071,073,074 (6) |
| 1400 | BALANS | Te ontvangen vergoedingen | 10 Bedrijfsnr's |
| 1410 | BALANS | Vooruitbetaalde kosten | 6 Bedrijfsnr's |
| 1506 | BALANS | Afdrachten BTW | 9 Bedrijfsnr's |
| 1600 | BALANS | Crediteuren | 15 Bedrijfsnr's |
| 1700 | BALANS | Te betalen kosten | 14 Bedrijfsnr's |
| 1712 | BALANS | Betaalde Service kosten | 10 Bedrijfsnr's |

**Blijft als override in `070_Rooise_Zoom.json` (12 regels)** — ongewijzigd,
nog steeds `"status": "GOEDGEKEURD"`:

| grootboekrekening | soort | rapportagepost/omschrijving | reden voor niet-promotie |
|---|---|---|---|
| 4000 | RESULTAAT | Beheerkosten | inconsistent — omschrijving varieert (Beheerkosten/Beheer vergoeding/Beheerskosten/Beheervergoeding) |
| 4350 | RESULTAAT | Servicekosten eigenaar | alleen bij 070 gezien (`consistent: true` maar single-admin — geen bewijs, zie boven) |
| 8800 | RESULTAAT | Huuropbrengsten belast | inconsistent — omschrijving varieert (Huuropbrengsten Belast/Huuropbrengsten) |
| 8805 | RESULTAAT | Verleende huurkorting | alleen bij 070 gezien |
| 8815 | RESULTAAT | Zonnestroom | alleen bij 070 gezien |
| 0840 | BALANS | Ontrekkingen - Uitkeringen | inconsistent — 070's omschrijving wijkt af van "Algemene Reserve" elders |
| 0901 | BALANS | Voorziening onderhoud Zoom 1 | inconsistent — omschrijving varieert per administratie |
| 0902 | BALANS | Voorziening onderhoud Zoom 2 | inconsistent — omschrijving varieert |
| 0903 | BALANS | Voorziening onderhoud Zoom 3 | inconsistent — omschrijving varieert |
| 1010 | BALANS | Bank NL44RABO 0337 7344 45 | inconsistent — elke administratie heeft een andere bankrekening (verwacht) |
| 1310 | BALANS | Huurdebiteuren | inconsistent — één administratie (069) noemt dit "Eigenarendebiteuren" |
| 1711 | BALANS | Tussenrekening servicekst | inconsistent — sommige administraties noemen dit "Voorschotten servicekst" |

**Sindsdien uitgebreid (niet meer 12 regels):** de override groeide na deze
migratie verder met bevestigde `tekenconventie`-waarden voor de master-only
rekeningen 1600/1700/1712 (zie "Balanszijde/tekenconventie
`070_Rooise_Zoom`" hierboven — een 070-specifieke tekenconventie-bevestiging
wordt als override vastgelegd, nooit als mutatie van de master) en met
twee volledig nieuwe rekeningen, `0850` en `1790`, die pas na een
beginbalans-bugfix zichtbaar werden. De override telt per 2026-08-21 17
regels.

**Kanttekening (bewust niet automatisch toegepast):** bij 0901/0902/0903
is uitsluitend de omschrijving-tekst inconsistent — de onderliggende
`Balans_vw`-waarde is bij alle betrokken Bedrijfsnr's identiek `"Balans"`.
Voor een BALANS-classificatie (die geen omschrijving opslaat) zou je
kunnen beargumenteren dat dat al genoeg is. Dit is bewust NIET als
promotiecriterium gebruikt — de strikte regel (omschrijving én
`Balans_vw` moeten beide gelijk zijn) is wat is afgesproken, dus deze drie
blijven voorlopig override bij 070.

**Bijvangst:** de bronkolom `Balans_vw` bevat in de praktijk consistent
`"Balans"` of `"V & W"` — bevestigt het vermoeden dat deze kolom
rechtstreeks bruikbaar is als Bal/V&W-signaal, gelijk aan de "Srt"-kolom
uit het eerder handmatig aangeleverde rekeningschema van 070.

Nog niet in master of override (nog geen boekingen-activiteit gezien bij
070 in periode 1 t/m 6 van 2026, dus nog niet beoordeeld): `8810` (Opbr.
administratiekosten — wél bij meerdere Bedrijfsnr's gezien maar
inconsistent qua omschrijving), `9100` (Mutatie voorzieningen — alleen bij
070). Zodra deze in een toekomstige periode saldo hebben bij 070, brengt
`pl-periode` ze als `controleVereist` naar boven.

Het kant-en-klare JSON-bestand voor de oorspronkelijke 27 regels (vóór
migratie) staat nog in `packages/tests/src/fixtures.ts`'s
`rooiseZoomGrootboekMapping()`, gebruikt als representatieve fixture in
tests. Omdat `BVC_DATA_ROOT` buiten git staat (CLAUDE.md §5), plaatst de
gebruiker de gemigreerde bestanden zelf: `grootboekmapping_master.json` in
`<BVC_DATA_ROOT>/config/` en de bijgewerkte (12-regel) override in
`<BVC_DATA_ROOT>/config/grootboekmappingen/070_Rooise_Zoom.json`.

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
