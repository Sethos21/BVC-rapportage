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

```jsonc
{
  "versie": "0.1",
  "administratieId": "070_rooisezoom",
  "regels": [
    {
      "grootboekrekening": "4000",       // grootboekrekeningnummer uit de bron
      "rapportagepost": "Beheerkosten",  // specifieke rapportregel
      "rapportagecategorie": "Kosten",   // bredere groepering
      "tekenconventie": null,            // "ZOALS_BRON" | "OMGEKEERD" | null (nog niet bevestigd)
      "actief": true,                    // operationele aan/uit-schakelaar
      "status": "VOORGESTELD"            // "VOORGESTELD" | "GOEDGEKEURD" — GOEDGEKEURD is een menselijke stap
    }
  ]
}
```

Een grootboekrekening mag maar één keer in `regels` voorkomen —
`parseGrootboekMapping` wijst dubbele nummers af (ambigue mapping).

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

### Bevestigde mapping voor `070_Rooise_Zoom` (14 rekeningen)

Afgeleid door de gebruiker uit vergelijking van het Controlerapport tegen
de bestaande Q2-2026-rapportage (2026-08-17). `rapportagepost` is
bevestigd; `rapportagecategorie` is hier mechanisch afgeleid uit de
standaard grootboek-nummerconventie (4xxx = Kosten, 8xxx = Opbrengsten —
een structurele afleiding, geen inhoudelijke aanname) en dus **een open
punt** als een fijnere indeling gewenst is. `tekenconventie` is voor **geen
enkele** van deze 14 rekeningen expliciet bevestigd (de gebruiker gaf de
doel-rapportagepost, niet het teken) en staat daarom overal op `null` —
zie "Nog niet inhoudelijk bevestigd" hieronder. Alle regels: `"actief":
true`, `"status": "VOORGESTELD"` (nooit `GOEDGEKEURD` door een AI-sessie).

| grootboekrekening | rapportagepost | rapportagecategorie |
|---|---|---|
| 4000 | Beheerkosten | Kosten |
| 4130 | Verzekeringen | Kosten |
| 4300 | Onderhoud gebouwen | Kosten |
| 4330 | Onderhoud terrein | Kosten |
| 4340 | Onderhoud installaties | Kosten |
| 4350 | Servicekosten eigenaar | Kosten |
| 4700 | WOZ / OZB | Kosten |
| 4710 | Gemeentelijke heffingen | Kosten |
| 4903 | Niet verrekenbare BTW | Kosten |
| 4990 | Diverse algemene kosten | Kosten |
| 8800 | Huuropbrengsten belast | Opbrengsten |
| 8801 | Huuropbrengsten onbelast | Opbrengsten |
| 8805 | Verleende huurkorting | Opbrengsten |
| 8815 | Zonnestroom | Opbrengsten |

Het kant-en-klare JSON-bestand voor deze 14 regels staat in
`packages/tests/src/fixtures.ts`'s `rooiseZoomGrootboekMapping()` (gebruikt
door de tests als representatieve fixture — zie hieronder) en in de
Oplevering van deze bouwstap. Omdat `BVC_DATA_ROOT` buiten git staat
(CLAUDE.md §5), moet de gebruiker dit bestand zelf naar
`<BVC_DATA_ROOT>/config/grootboekmappingen/070_Rooise_Zoom.json` kopiëren
om het daadwerkelijk te gebruiken — dit gebeurt niet automatisch.

### Nog niet inhoudelijk bevestigd (open punten voor de gebruiker)

- **Tekenconventie per rekening** — voor alle 14 rekeningen hierboven op
  `null`. Met name `8800`/`8801`/`8815` (opbrengsten, vermoedelijk
  `"OMGEKEERD"`) en `8805` (huurkorting — een aftrekpost, teken hangt af van
  hoe de bron die boekt) hebben expliciete bevestiging nodig voordat
  rapportbedragen ermee berekend mogen worden.
- **Rapportagecategorie-granulariteit** — nu alleen Kosten/Opbrengsten
  (structureel afgeleid); een fijnere indeling (Beheer/Onderhoud/
  Belastingen en heffingen/Servicekosten/Huuropbrengsten/Overige
  opbrengsten) is mogelijk gewenst maar niet door de gebruiker bevestigd.
- **Verhouding tot het bestaande `GrootboekMapping`-type in
  `@bvc/domain`** (`types.ts`, met `balansOfResultaat`/`rapportcode`/
  `presentatiefactor`/`geldigVanaf`/`status`/`versie`, gebruikt door
  `finance.ts`'s `rapportbedrag`/`nietGemapteRekeningenMetSaldo`) — dat is
  een eerder, uitgebreider model uit een extern dossierdocument
  (`GROOTBOEKMAPPING_SPEC_v0.1.md`, niet in deze repository) met een
  geldigheids-/goedkeuringsmodel per periode, tot nu toe zonder
  opslag-/laadlaag. Deze bouwstap introduceert bewust een **apart,
  eenvoudiger** schema (`GrootboekMappingRegel`) dat exact de vier
  gevraagde velden dekt (rapportagepost/rapportagecategorie/tekenconventie/
  actief), zonder de bestaande `finance.ts`-functies aan te passen. Of/hoe
  deze twee modellen op termijn worden samengevoegd is niet door de
  gebruiker besloten — een latere, expliciete keuze.
- **Balans op een specifieke boekperiode** (zie `@bvc/cache`'s
  `periodeSelectie.ts`) kan de huidige cache niet leveren — een bekend gat,
  geen aanname.
