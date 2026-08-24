# @bvc/reporting

## Controlerapport (rauw brondata-overzicht, geen grootboekmapping)

`renderControlerapportHtml` rendert een trial-balance-achtig overzicht
rechtstreeks uit de cache: grootboek-totalen per rekening (boekingen),
balans-eindsaldi, servicekosten per kostensoort, contracten/units/
rentroll-listing en complex-totalen. **Bewust geen grootboekmapping en
geen servicekosten-uitsluitingsregels toegepast** — dit rapport dient om
de ingelezen brondata regel-voor-regel te vergelijken met een bestaande
rapportage (reconciliatie), niet als KPI-analyse. Blokkeert nooit op een
ontbrekende/nog niet geladen bron (begroting, ouderdomsanalyse) — toont
dan een duidelijke melding in die sectie. `apps/worker`'s
`genereerControlerapport` bouwt de invoer uit de SQLite-cache (leest
niet uit Excel) en schrijft naar `rapporten/`; CLI: `bvc-worker
controlerapport <administratieId>`.

Dit was de **eerste** sectie die tegen een echte, herbouwde cache is
gevalideerd (zie root-README); de P&L-periodeberekening hieronder is de
tweede. Kerncijfers en het bredere P&L-/balansrapport zijn dat nog niet.

## P&L-periodeberekening (`plPeriodeBerekening.ts`) — rekenkern + vergelijking, nog geen renderer

De eerste koppeling van de goedgekeurde grootboekmapping (`@bvc/config`,
zie `packages/config/README.md`) en de expliciete periodeselectie
(`@bvc/cache`'s `periodeSelectie.ts`, zie `packages/cache/README.md`) aan
een daadwerkelijke berekening. Bewust **klein gehouden**: alleen de
rekenkern en een vergelijkingsfunctie, **geen HTML/renderer** — dat is een
latere, losse stap.

- **`berekenPlPeriode(boekingen: Boekingsregel[], mappingRegels)`** —
  neemt een al-periodeselecteerde lijst boekingen (`@bvc/cache`'s
  `selecteerBoekingen`, buiten deze functie aangeroepen) en de
  grootboekmapping, en levert per rapportagepost de rapportregelsom
  (CAL-FIN-003, `rapportbedrag` × CAL-FIN-002 tekenconventie) plus
  categorietotalen. Rekent bewust **geen gecombineerd nettoresultaat**
  over categorieën heen uit (Kosten en Opbrengsten kunnen, afhankelijk van
  hun tekenconventie, allebei als positief bedrag gepresenteerd worden —
  zoals bij de goedgekeurde `070_Rooise_Zoom`-mapping — dus een blinde som
  over alle categorieën zou geen betekenisvol resultaat opleveren; welke
  categorieën optellen/aftrekken voor een resultaatregel is een
  indelingsvraag die nog niet geformaliseerd is). Grootboekrekeningen met
  een niet-nul saldo die niet verwerkt konden worden (onbekende rekening,
  inactieve mapping, onbevestigde tekenconventie) komen in
  `controleVereist` — nooit stilzwijgend overgeslagen.
- **`vergelijkMetGereconcilieerd(resultaat, verwachtePerRapportagepost,
  toleranceEuro)`** — vergelijkt automatisch per rapportagepost met eerder
  handmatig gereconcilieerde bedragen (hergebruikt CAL-FIN-009/010,
  `budgetafwijking(Pct)`: "verwacht" = budget, "berekend" = realisatie).
  `verwachtePerRapportagepost` is een `Map<string, OnbekendOf<Decimal>>` —
  een verwacht bedrag kan zelf `OnbekendOf`-`onbekend` zijn (bv. "deze post
  wordt pas aan het einde van het boekjaar bepaald en geboekt"); zo'n regel
  belandt in `nogNietBekend`, nooit in `ontbrekendInBerekening` of als
  fout. Dit is een generieke, per rapportagepost in de invoerdata
  aangeleverde uitzondering (CLAUDE.md §3) — geen hardcoded uitzondering
  voor een specifiek grootboekrekeningnummer in code. Rapportageposten die
  verder maar aan één kant voorkomen belanden in
  `ontbrekendInBerekening`/`onverwachtInBerekening`, nooit als 0 vergeleken.
- **`apps/worker/src/genereerPlPeriode.ts`** — leest de cache
  (`selecteerBoekingen` op bedrijfsnr + boekjaar + boekperiode-range) en de
  goedgekeurde grootboekmapping, converteert cacherijen naar
  `Boekingsregel` (Decimal), en roept `berekenPlPeriode` aan. CLI:
  `bvc-worker pl-periode <administratieId> --boekjaar N [--periodeVan P
  --periodeTotEnMet P] [--verwacht <pad-naar-json>] [--tolerantie N]`.
  `--verwacht` wijst naar een ad-hoc JSON-bestand met de al gereconcilieerde
  bedragen, per rapportagepost een `OnbekendOf<Decimal>` in JSON-vorm:
  ```jsonc
  {
    "Beheerkosten": { "type": "bekend", "waarde": "6446" },
    "Niet verrekenbare BTW": { "type": "onbekend", "reden": "Wordt pas aan het einde van het boekjaar bepaald en geboekt" }
  }
  ```
  Geen vaste locatie in de data root, dit is invoer per vergelijking, geen
  permanente config. Print JSON naar stdout (geen bestand, geen HTML) en
  zet de exitcode op 1 als `controleVereist` niet leeg is.

## Balans-periodeberekening (`balansPeriodeBerekening.ts` + `renderBalansPeriode.ts`)

Tweede koppeling van dezelfde bewezen keten (goedgekeurde master+override-
grootboekmapping + expliciete periodeselectie) aan een balans, náást de
P&L hierboven — beide zijn outputs van dezelfde rekenlaag (CLAUDE.md §2),
geen parallelle berekening. Regressie-administratie: `070_Rooise_Zoom`
(de al bewezen P&L-uitkomst blijft ongewijzigd, zie `genereerPlPeriode.test.ts`).

- **Peildatum zonder cache-schemawijziging.** De cache bevat geen
  boekperiode-kolom in `balansstanden` (alleen een jaareindsaldo — zie
  `selecteerBalansOpBoekperiode`'s "bekend, nog niet opgelost gat"). Het
  saldo op een expliciete boekjaar+boekperiode-peildatum is desondanks
  reproduceerbaar zonder Worker-importarchitectuurwijziging: `saldo =
  beginbalans (jaarstart, uit `balansstanden`) + som van boekingen t/m de
  opgegeven boekperiode` (`@bvc/cache`'s `selecteerBoekingen`, zoals de
  P&L-periodeselectie). Ontbreekt de beginbalans (beide velden `null`),
  dan is het saldo expliciet niet te bepalen — nooit stilzwijgend 0
  aangenomen (CLAUDE.md §6).
- **`berekenBalansPeriode(balansstanden, boekingen, master, override,
  resultaatHuidigBoekjaar, toleranceEuro?)`** (master/override apart sinds
  2026-08-20, zie "Voorbereiding op interactieve correctie" hieronder) —
  per BALANS-soort rekening:
  beginbalans + mutaties in de periode (rauw saldo), gepresenteerd met de
  rekening-eigen tekenconventie (zie hieronder). RESULTAAT-soort
  rekeningen (die horen in de P&L) worden hier volledig genegeerd — geen
  post, geen `controleVereist`; hun bijdrage komt via het apart
  aangeleverde `resultaatHuidigBoekjaar` (zie "Resultaat huidig boekjaar"
  hieronder), niet via een interne herberekening. Onbekende/inactieve
  rekeningen en BALANS-rekeningen zonder bepaalbare beginbalans/
  balanszijde/tekenconventie belanden — net als bij `berekenPlPeriode` —
  in `controleVereist`, nooit stilzwijgend weggelaten.
- **Bugfix (2026-08-20, gevonden via een echte productie-run): een
  volledig ongemapte rekening met een grote, stilstaande beginbalans (geen
  mutatie deze periode) verdween stilzwijgend uit de uitkomst.** De
  "onbekende mapping"-tak in `berekenBalansPeriode` keek alleen naar de
  periodemutatie (`!mutatie.isZero()`) om te bepalen of een ongemapte
  rekening in `controleVereist` moest — een rekening als "Resultaat vorig
  boekjaar" (een grote, jaarlijks vaste post die dit boekjaar terecht geen
  mutatie heeft) werd daardoor volledig onzichtbaar, ook al droeg hij wél
  bij aan de echte balans. Dit was de hoofdoorzaak van een groot deel van
  een aansluitingsverschil bij een echte 070-run. Gefixt door ook de
  beginbalans mee te nemen in de "best bekende"-waarde en de aanwezigheid
  van een balansstand-rij te laten meetellen — exact dezelfde logica die de
  "beginbalans onbekend"-tak al had voor bekende-maar-onvolledige
  rekeningen, nu ook toegepast op volledig ongemapte rekeningen.
- **Drie onafhankelijke concepten (ontwerpcorrectie 2026-08-20, na een
  echte productie-run):**
  1. **`balanszijde`** (ACTIVA/PASSIVA) — een vaste eigenschap van de
     rekening (`@bvc/config`'s `BalansRegel.balanszijde`), nooit uit het
     saldoteken afgeleid. Een rekening als Huurdebiteuren blijft Activa
     ook met een tijdelijk creditsaldo (vooruitbetalende huurder); een
     voorziening blijft Passiva ongeacht het actuele teken.
  2. **Het werkelijk berekende saldo** (beginbalans + mutaties, debet -
     credit) — de rauwe boekhoudkundige waarheid.
  3. **`tekenconventie`** (ZOALS_BRON/OMGEKEERD, óók op `BalansRegel`, apart
     veld van `balanszijde`) — bepaalt hoe (2) BINNEN (1) getoond wordt.
     Eerdere versie toonde simpelweg het rauwe saldo (impliciet
     ZOALS_BRON voor alles); een echte productie-run liet zien dat dat
     verkeerd overkomt — vrijwel elke Passiva-rekening (credit-normaal)
     kwam daardoor negatief uit, terwijl een balans schulden/voorzieningen
     normaliter als positief bedrag toont. De oplossing is NIET één
     generieke regel per balanszijde (bv. "alle Passiva OMGEKEERD") — dat
     zou dezelfde soort fout in de andere richting zijn — maar een
     onafhankelijk, per-rekening bevestigd veld, exact hetzelfde
     schema/patroon als RESULTAAT's `tekenconventie`
     (`@bvc/domain`'s `presentatiefactorVoorRegel` werkt nu structureel op
     beide regeltypen). Zie `packages/config/README.md`'s "Balanszijde ≠
     presentatieteken" voor de per-rekening stand bij `070_Rooise_Zoom` —
     op dit moment hebben de meeste Passiva-rekeningen bewust nog GEEN
     bevestigde tekenconventie (geen aanname), dus verschijnen ze in
     `controleVereist` totdat bevestigd.
  Beide (1) en (3) zijn onafhankelijk nullable; ontbreekt er één, dan komt
  de rekening in `controleVereist` — nooit gegokt op basis van
  rekeningomschrijving (CLAUDE.md §3/§6) en nooit op het saldoteken.
  `saldo` in `BalansPeriodePost` is het GETOONDE bedrag (na
  tekenconventie) en behoudt zijn werkelijke teken, ook als dat afwijkt
  van wat je op die balanszijde zou verwachten — precies de structuur die
  een latere balanstoelichting nodig heeft (zie hieronder).
  `rapportagepost`/omschrijving komt rechtstreeks uit de bron
  (`Rekening_omschrijving`), ook geen classificatie, alleen doorgegeven.
- **Resultaat huidig boekjaar (`berekenNettoResultaat`,
  `plPeriodeBerekening.ts`).** Er bestaat geen eigen grootboekrekening voor
  "resultaat lopend boekjaar" — dat bedrag wordt afgeleid van de P&L
  (`berekenPlPeriode`'s `categorieTotalen`, die zelf bewust GEEN
  gecombineerd nettoresultaat berekent, zie hierboven). `berekenNettoResultaat
  (categorieTotalen, tekenPerCategorie)` lost dat hier expliciet op zonder
  zelf een aanname te hardcoden: de aanroeper geeft het optel-/aftrekteken
  per rapportagecategorie mee. `apps/worker/src/genereerBalansPeriode.ts`
  gebruikt daarvoor `STANDAARD_TEKEN_PER_CATEGORIE` (Opbrengsten +1, Kosten
  -1 — Resultaat = Opbrengsten - Kosten, de enige twee rapportagecategorieën
  die nu system-breed bestaan) als expliciete, overrideable standaard op de
  Worker-orkestratielaag — bewust niet in `@bvc/domain`/`@bvc/reporting`
  gehardcodeerd. Een categorie zonder bevestigd teken maakt het resultaat
  `OnbekendOf`-`onbekend`, nooit een aanname.
- **Bron-kolom `Boeking_Saldo`: bewust NIET gebruikt als primair signed
  bedrag (onderzocht, geen wijziging nodig).** `boekingen` bevat een
  bronkolom `Boeking_Saldo` naast Debet/Credit. Onderzoek (2026-08-19)
  bevestigt dat dit al vóór de balansmodule was opgelost, en dat de
  balansmodule dezelfde conventie volgt als de al bewezen P&L: elke
  boekingsregel wordt centraal herberekend als `debet - credit`
  (`@bvc/domain`'s `boekingSaldo`, CAL-FIN-001) — de bronkolom
  `Boeking_Saldo` wordt uitsluitend voor audit gebruikt via
  `parseBoekingen`'s `controleerBronsaldoAfwijking`
  (`@bvc/data-contracts`), dat een WAARSCHUWING (niet-blokkerend) geeft
  wanneer de bron zelf afwijkt van de herberekende waarde. Een
  onparseerbare bronwaarde (bevestigd: Excel-foutwaarden als `#REF!` komen
  in de praktijk voor in deze kolom) wordt door `coerceDecimal`
  (`packages/data-contracts/src/lib/coerce.ts`) als `null` behandeld —
  nooit een crash, nooit een gok — en blijft dan simpelweg buiten de
  audit-vergelijking, zonder de herberekende `debet - credit` te
  beïnvloeden. Debet en Credit blijven daarnaast altijd los beschikbaar
  (audit trail); de introductie van deze balansmodule vervangt die
  informatie niet.
- **Voorbereiding op interactieve correctie (2026-08-20, nog GEEN UI
  gebouwd).** Een toekomstige stap moet een gebruiker per balanspost
  `balanszijde`/`tekenconventie` laten overschrijven — nooit de brondata of
  het rauwe saldo, uitsluitend classificatie/presentatie — met een
  onderscheid tussen "alleen dit rapport" en "opslaan als
  administratie-override" (nooit automatisch de master aanpassen: die
  verandert alleen via een expliciete, losse mapping-bouwstap, nooit als
  bijeffect van een rapportcorrectie). Om die workflow straks niet te
  blokkeren, geeft `BalansPeriodePost` nu al elk van de vier onderliggende
  waarden apart terug: `ruwSaldo` (vóór tekenconventie), `tekenconventie`
  (de toegepaste conventie), `saldo` (= rapportageBedrag, ná
  tekenconventie) en `herkomst` (`@bvc/domain`'s `MappingHerkomst`:
  `"MASTER" | "ADMINISTRATIE_OVERRIDE" | "RAPPORT_OVERRIDE" |
  "ONBEKEND"` — `RAPPORT_OVERRIDE` bestaat als opslagmechanisme nog niet,
  alvast gereserveerd in de type-unie). `BalansPeriodeControleVereist`
  draagt `herkomst` ook. Vandaar dat `berekenBalansPeriode` `master` en
  `override` nu APART aanneemt (`@bvc/domain`'s `herkomstVoorRekening`) in
  plaats van al samengevoegd — zonder die scheiding is herkomst niet te
  bepalen. Dit is bewust ALLEEN de rekenlaag-voorbereiding: geen UI, geen
  opslagmechanisme voor een rapport-correctie, geen wijziging aan
  `resolveerGrootboekMapping`'s bestaande contract (nog steeds gebruikt
  door `berekenPlPeriode`, ongewijzigd). Hetzelfde mechanisme (automatische
  classificatie + menselijke correctie + gecontroleerd opslaan, nooit de
  master stilzwijgend) is bedoeld om later ook voor de kostensoorten-
  module te hergebruiken — nog niet gebouwd, wel het ontwerpdoel.
- **Balanstoelichting: nog niet gebouwd, wel voorbereid.** Er is bewust
  geen automatische toelichtingslogica gebouwd op basis van aannames (bv.
  "een negatief saldo op Huurdebiteuren betekent een vooruitbetalende
  huurder"). Wat de rekenmodule wél teruggeeft — een `rapportagecategorie`
  die nooit van het saldoteken afhangt, plus het werkelijke (mogelijk
  negatieve) `saldo` — is precies de structuur die een latere toelichting
  nodig heeft om zulke gevallen te signaleren (`saldo.isNegative() &&
  rapportagecategorie === "ACTIVA"` bijvoorbeeld), zonder dat deze
  bouwstap daar al een uitspraak over doet.
- **Aansluitingscontrole (`aansluiting`), herzien naar de standaard
  balansvergelijking.** `verschil = activaTotaal - passivaTotaal -
  resultaatHuidigBoekjaar` (activa/passiva zijn de GETOONDE, dus
  tekenconventie-toegepaste totalen — signed, bewust geen `.abs()`), hoort
  ~0 te zijn: Activa = Passiva + Resultaat huidig boekjaar. `verschil` is
  zelf `OnbekendOf<Decimal>` — is `resultaatHuidigBoekjaar` onbekend (een
  P&L-categorie zonder bevestigd teken), dan is de aansluiting simpelweg
  niet te bepalen, nooit een gok; `sluitBinnenTolerantie` is dan `false`
  (een onbekende aansluiting is nooit stilzwijgend "sluitend"). Dit
  verving de eerdere "raw debet-credit sommeert tot 0"-truc (die alleen
  werkte zolang nergens een tekenconventie werd toegepast) — nu een
  herkenbare, echte boekhoudkundige vergelijking.
- **`apps/worker/src/genereerBalansPeriode.ts`** — leest de cache
  (`boekingen` via `selecteerBoekingen` met alleen `boekperiodeTotEnMet`,
  `balansstanden` op bedrijfsnr+jaar) en `leesGrootboekMappingGesplitst`
  (`apps/worker/src/grootboekmapping.ts`, nieuw sinds 2026-08-20) —
  master en override apart, nodig voor `herkomst` in de balansuitvoer;
  `leesGrootboekMapping` (samengevoegd) blijft ongewijzigd bestaan voor
  `genereerPlPeriode`. Draait daarnaast
  `berekenPlPeriode` + `berekenNettoResultaat` op dezelfde
  boekingenselectie voor `resultaatHuidigBoekjaar` (geen parallelle
  P&L-herberekening — twee outputs van dezelfde rekenlaag). CLI:
  `bvc-worker balans-periode <administratieId> --boekjaar N
  --periodeTotEnMet P [--tolerantie N]`. Exitcode 1 bij niet-lege
  `controleVereist` of een niet-sluitende (of onbekende) aansluitingscontrole.
- **`renderBalansPeriodeHtml`** — rendert uitsluitend de al-berekende
  `BalansPeriodeResultaat` (geen eigen berekening, geen eigen
  tekenconventie): Activa-/Passiva-tabellen met rekening/omschrijving/
  saldo + subtotaalrij, het resultaat huidig boekjaar, de
  aansluitingscontrole (toont "Onbekend — ⟨reden⟩" i.p.v. een bedrag als
  `resultaatHuidigBoekjaar`/`verschil` `OnbekendOf`-`onbekend` is), en een
  altijd zichtbare "Controle vereist"-sectie (ook als leeg — dan een
  expliciete "geen"-melding, geen weggelaten sectie).
- **Gedeelde row-mappers.** `apps/worker/src/rowMappers.ts`
  (`naarBoekingsregel`, `naarBalansstand`) is uit `genereerPlPeriode.ts`
  getrokken zodat beide Worker-commando's dezelfde cacherij→domeintype-
  conversie gebruiken — geen duplicatie.

## Gecombineerd periode-rapport (resultatenrekening + balans, `rapport-periode`)

De eerste "bruikbare" financiële rapportage (2026-08-21, op expliciet
verzoek van de gebruiker: "niet nog meer CLI-JSON bekijken, maar de eerste
bruikbare financiële rapportage maken waarin P&L en balans samenkomen") —
één HTML-document met de resultatenrekening én de balans van dezelfde
periode, in plaats van twee losse CLI-JSON-uitvoeren die de gebruiker zelf
naast elkaar moest leggen.

- **`renderPlPeriode.ts`** (nieuw) — de eerste HTML-renderer voor de
  al-bestaande, mapping-gedreven `PlPeriodeResultaat`
  (`plPeriodeBerekening.ts`'s `berekenPlPeriode`, tot nu toe alleen als
  CLI-JSON zichtbaar via `pl-periode`). Rapportagecategorieën zijn vrije
  tekst (geen hardcoded Kosten/Opbrengsten-indeling, zie
  `plPeriodeBerekening.ts`'s moduledoc) — er verschijnt daarom één tabel
  per categorie in de volgorde van `categorieTotalen`, plus een altijd
  zichtbare "Controle vereist"-sectie. Dit is een ANDER, apart bestand van
  het oudere `plRapport.ts`/`renderHtml.ts` (zie "P&L-exploitatierapportage"
  hierboven, dat op al-gevalideerde jaarcijfers werkt) — geen samenvoeging,
  zelfde bewuste scheiding als bij `GrootboekMapping` hieronder.
- **`renderRapportPeriode.ts`** (nieuw) — combineert
  `renderPlPeriodeBody`/`renderBalansPeriodeBody` (beide nu apart
  geëxporteerd, naast de bestaande `renderPlPeriodeHtml`/
  `renderBalansPeriodeHtml` die zelfstandig blijven werken) in ÉÉN
  document-skelet/cover — geen eigen berekening, geen gedupliceerde
  opmaaklogica. De al-bewezen rekenlogica (zie de 070_Rooise_Zoom-
  regressietest hieronder) komt hier niet in terecht: deze renderer rekent
  zelf niets uit, presenteert alleen de twee al-berekende resultaten na
  elkaar.
- **`apps/worker/src/genereerRapportPeriode.ts`** + CLI `rapport-periode
  <administratieId> --boekjaar N --periodeTotEnMet P [--tolerantie N]` —
  draait dezelfde berekeningen als `pl-periode`/`balans-periode` (geen
  parallelle rekenlaag) en schrijft het resultaat als HTML naar
  `rapporten/` (zelfde patroon als `genereerControlerapport.ts`), i.p.v.
  JSON naar stdout te printen. Exitcode 1 bij niet-lege `controleVereist`
  (P&L of balans) of een niet-sluitende (of onbekende) aansluitingscontrole.

Nog niet gedaan: PDF-export van dit gecombineerde rapport, en de
interactieve correctiemogelijkheid voor balanszijde/tekenconventie per
rapport (`RAPPORT_OVERRIDE`, zie `balansPeriodeBerekening.ts`'s moduledoc
"Herkomst") — expliciet bewust uitgesteld door de gebruiker, de
reken-/herkomstlaag is er al op voorbereid maar de UI komt in een latere
stap.

### Regressiereferentie: 070_Rooise_Zoom sluit (2026-08-21)

`balansPeriodeBerekening.test.ts` bevat sinds 2026-08-21 een vastgelegde
regressietest op basis van de eerste ECHTE productie-run van
`bvc-worker.exe balans-periode 070_Rooise_Zoom --boekjaar 2026
--periodeTotEnMet 06` die volledig sluit: alle 14 bevestigde
BALANS-rekeningen (master + 070-override) samen leveren Activa
€144.016,55, Passiva −€167.163,11, Resultaat huidig boekjaar €311.179,66,
verschil €0,00 (`sluitBinnenTolerantie: true`) — door de gebruiker
persoonlijk geverifieerd tegen de echte cijfers, niet afgeleid of
aangenomen. De test herbouwt dezelfde beginbalans-per-rekening (géén
mutaties nodig, alleen het resulterende `ruwSaldo` telt) en de exacte
master/override-classificatie uit `<BVC_DATA_ROOT>/config/` op dat moment,
en checkt zowel het totaal als het GETOONDE saldo per individuele
rekening. Doel: een latere, onbedoelde wijziging aan `berekenBalansPeriode`
of de mapping-resolutieketen (`resolveerGrootboekMapping`/
`presentatiefactorVoorRegel`/`balanszijdeVoorRegel`) breekt deze test
zodra de al-bewezen 070-aansluiting niet langer sluit — in plaats van pas
in een volgende productie-run ontdekt te worden. `1505`/`1506` en de
dormant-rekeningen vallen hier bewust buiten: die blijven `controleVereist`
in productie, geen geraden classificatie.

## Kasstroom (`kasstroomBerekening.ts` + `kasstroomManagementoverzicht.ts`)

Twee, bewust gescheiden bouwstappen (2026-08-22), de eerste twee gebouwde
onderdelen van roadmap-sectie "03 Kasstroom" hieronder:

**1. Mutatie bankstand (`kasstroomBerekening.ts`, eerste, eenvoudige
versie).** `berekenKasstroomPeriode`: beginbalans + boekingen t/m de
opgegeven periode, uitsluitend voor rekeningen met een bevestigde
`liquideMiddelen: true` (`@bvc/config`'s nieuwe BALANS-veld, zelfde
nullable-patroon als `balanszijde`/`tekenconventie` — nooit afgeleid uit de
rekeningnaam/-omschrijving). Worker: `genereerKasstroomPeriode.ts` + CLI
`kasstroom-periode` (print JSON, zelfde stijl als de eerste versies van
`pl-periode`/`balans-periode`).

**2. Kasstroom-managementoverzicht (`kasstroomManagementoverzicht.ts`,
uitgebreide versie, op expliciet verzoek van de gebruiker).** Bouwt voort
op (1) — `berekenKasstroomPeriode` wordt ONGEWIJZIGD hergebruikt voor
bankstand begin/eind/netto kasstroom, geen dubbele berekening — en voegt
huurontvangsten/exploitatie-uitgaven/eigenaaronttrekkingen,
kwartaal-uitsplitsing, uitbetalingsratio en een configureerbare
streefwaarde bankstand toe.

**Onderzoek vóór implementatie (verplicht door de gebruiker gesteld):**
huurontvangsten/exploitatie-uitgaven mogen NIET uit P&L-bedragen komen,
alleen uit werkelijke kasmutaties. Mechanisme: boekingen groeperen per
`boekstukSleutel` (hergebruik van het al-bewezen `boekstukcontrole`/
CAL-FIN-006-concept uit `@bvc/domain`'s `finance.ts` — niets nieuws). Voor
elk boekstuk met een regel op een liquide-middelen-rekening zijn de
overige regels de tegenrekening(en). Elke tegenrekening wordt
geclassificeerd via een NIEUW, config-gestuurd veld — `kasstroomCategorie`
(`@bvc/config`, op zowel BALANS- als RESULTAAT-regels, zie
packages/config/README.md) — nooit via `rapportagecategorie` (vrije tekst,
zou CLAUDE.md §6 schenden). Empirisch bevestigd door de gebruiker: bij 070
lopen huurontvangsten via Huurdebiteuren (`1310`, een BALANS-rekening),
niet rechtstreeks via een Opbrengsten-rekening; exploitatie-uitgaven zijn
gemengd (soms direct Bank↔Kosten, soms via Crediteuren/Te betalen kosten).

**Boekstuk-regels (nooit gokken):**
- Alle tegenrekeningen dezelfde bevestigde categorie → het volledige
  liquide-bedrag telt mee voor die categorie (kwartaal = boekdatum van de
  liquide-regel).
- Eén of meer tegenrekeningen onbekend/ongemapt of `kasstroomCategorie:
  null` → het boekstuk telt NERGENS mee, de tegenrekening(en) komen in
  `controleVereist`.
- Tegenrekeningen met VERSCHILLENDE bevestigde categorieën binnen één
  boekstuk → niet eenduidig toe te wijzen, het hele boekstuk komt in
  `controleVereist` (nooit stilzwijgend verdeeld/geraden).
- Uitsluitend liquide-middelen-regels (bv. overboeking tussen twee
  liquide-middelen-rekeningen) → geen KPI van toepassing, genegeerd.

**Tekenconventie van de KPI's:** `exploitatieUitgaven` en
`eigenaarOnttrekkingen` worden als POSITIEF bedrag gerapporteerd (een
bankuitgave is van nature een credit — dus een negatief `boekingSaldo` —
hier bewust omgekeerd tot een leesbaar positief KPI-bedrag, net als een
`tekenconventie: OMGEKEERD`-post in de balans). `huurontvangsten` is van
nature al positief. `overig` (bevestigd géén van de drie KPI-categorieën,
bv. BTW/voorzieningen/tussenrekeningen) behoudt het RUWE, ondertekende
bedrag — een technische reconciliatiebucket, geen gepresenteerde KPI.

**Streefwaarde bankstand:** geen globale `Beheerparameters` (elke
administratie heeft een andere gewenste bankstand) — een nieuw, optioneel
`streefwaardeBankstand`-veld in de per-administratie `AdministratieConfig`
(`apps/worker/src/administratie.ts`), decimaal bedrag als string, net als
`bedrijfsnr`/`weergavenaam` al daar staan. Ontbreekt het, dan levert de
KPI `onbekend`, nooit een geraden standaardwaarde.

**Renderer + Worker:** `renderKasstroomManagementoverzicht.ts` — bewust
NOG NIET pixel-perfect gelijk aan het aangeleverde voorbeeldontwerp (op
expliciet verzoek van de gebruiker), hergebruikt de bestaande
`.card`/`.kpi-*`-huisstijl zodat de outputstructuur al wel alle gevraagde
KPI's/kwartaalregels ondersteunt. `genereerKasstroomManagementoverzicht.ts`
+ CLI `kasstroom-managementoverzicht` schrijft HTML naar `rapporten/`
(zelfde patroon als `rapport-periode`/`genereerControlerapport.ts`).

**Nog te bevestigen voor `070_Rooise_Zoom`:** `kasstroomCategorie` staat
voor alle rekeningen nog op `null` — zie packages/config/README.md
"Kasstroomcategorie" voor de exacte lijst rekeningen die nog bevestigd
moeten worden (`1310`, `0840`, en de Kosten/Crediteuren/Te-betalen-kosten-
rekeningen).

## Grootboek-inventarisatie (`grootboekInventarisatie.ts`) — voorbereiding op een centrale mastermapping

Puur diagnostisch, alleen-lezen: past geen mapping toe, verandert niets.
Voorbereidende stap voor schaalbaarheid van de grootboekmapping naar
meerdere administraties (tot nu toe was `070_Rooise_Zoom` de enige, volledig
handmatig doorlopen administratie).

- **`inventariseerGrootboekrekeningen(boekingen, balansomschrijvingen)`** —
  groepeert grootboekrekeninggebruik per Bedrijfsnr (aantal boekingen,
  rauw saldototaal) en koppelt de omschrijving + ruwe `Balans_vw`-waarde uit
  de `balans_per_jaar`-bron (meest recente boekjaar per Bedrijfsnr+rekening).
  Per rekeningnummer: `consistent: true` alleen als omschrijving én
  `balansVw` exact gelijk zijn bij elk Bedrijfsnr dat de rekening gebruikt —
  dat is de enige basis om een rekening automatisch als "betrouwbaar gelijk
  over administraties" te bestempelen; bij de kleinste afwijking `false`,
  nooit gegokt.
- **`apps/worker/src/genereerGrootboekInventarisatie.ts`** — leest
  `bron_gedeeld/boekingen.xlsx` en `bron_gedeeld/balans_per_jaar.xlsx`
  rechtstreeks en ongefilterd (alle Bedrijfsnr-waarden die in het bestand
  voorkomen), niet via een per-administratie cache. CLI: `bvc-worker
  grootboek-inventarisatie` (geen `administratieId`, geen `BVC_DATA_ROOT`-
  administratie nodig — werkt direct op de gedeelde bron). Beperking: dekt
  alleen bronnen die op `'gedeeld'` staan (de standaardinstelling); een
  administratie met `'eigen'` boekingen/balans_per_jaar zit hier nog niet
  in.
- **Nog onbevestigd:** of de brondata-kolom `Balans_vw` daadwerkelijk
  Bal/V&W aangeeft (zoals de "Srt"-kolom in het handmatig aangeleverde
  rekeningschema van `070_Rooise_Zoom`) — dat blijkt pas uit de echte
  waarden die `grootboek-inventarisatie` teruggeeft. Als dat bevestigd
  wordt, kan de `soort`-classificatie (zie `packages/config/README.md`)
  mogelijk rechtstreeks uit deze gedeelde bron afgeleid worden i.p.v. per
  administratie een apart rekeningschema te moeten aanleveren — nog niet
  aangenomen, alleen een mogelijkheid om te verifiëren.

## Kerncijfers (sectie 01 — KPI-dashboard)

`renderKerncijfersHtml` rendert het portefeuille-KPI-dashboard: 6
KPI-kaarten (huurinkomen, EBITDA, uitbetalingsratio, bankstand, debiteuren,
servicekosten-saldo, elk met mutatie-/statuskleur), kwartaalbalken
huurinkomen, huur-per-complextabel en een optionele bezettingsgraadkaart.
Poort van `legacy/index.html`'s `renderOverzicht` (zie
"Streefontwerp"-sectie hieronder), met herberekende cijfers via
`kerncijfers.ts` i.p.v. de inline JS-berekeningen uit legacy.
`renderKerncijfers.ts` rekent zelf niets uit.

Testcase: "Fergagne BV" (zie `*.test.ts`), dezelfde klant als het
aangeleverde streefontwerp-PDF.

## P&L-exploitatierapportage (eerste rapportonderdeel)

`renderPLRapportHtml` rendert een exploitatierapport per vastgoedobject in
BVC-huisstijl: coverpage, samenvatting, inkomsten, kosten, netto
exploitatieresultaat, een eenvoudige staafdiagram (inline SVG, geen
externe grafiekbibliotheek) en toelichting. Alle berekeningen staan in
`plRapport.ts` (hergebruikt `@bvc/domain`); `renderHtml.ts` rekent zelf
niets uit, alleen formatteren (`financieleberekeningen.md`: "geen
berekeningen in de UI-laag").

Testcase: object 070 "Rooise Zoom" (zie `*.test.ts`).

Nog niet gebouwd: PDF/DOCX-export (alleen HTML nu), en het bredere
rapportmodel uit het grote dossier (`def_rapportregel`/`def_kpi` uit
`04_Rapporten/`), dat voortbouwt op een **goedgekeurde** grootboekmapping
die er nog niet is (zie root-README). Dit P&L-rapport werkt met al
gevalideerde jaarcijfers als invoer, niet rechtstreeks met ruwe
Boekingen-rijen — die koppeling volgt in een latere fase.

## Streefontwerp volledige rapportage (bevestigd, nog te bouwen)

De gebruiker heeft een PDF-ontwerp (`BVC_Rapportage_Fergagne_2ekw2026.pdf`,
13 pagina's) aangeleverd als "hoe ik het uiteindelijk wil hebben". De
CSS-variabelen, sectie-ID's en `@media print`-paginabreaks in de PDF komen
exact overeen met `legacy/index.html` — dat bestand is dus de bevestigde
bron van het ontwerp, met een werkende (JS-gedreven) referentie-implementatie
per sectie. `legacy/index.html` is daarmee de te volgen spec voor structuur
en huisstijl; de rekenlogica daarin (inline JS) wordt **niet** hergebruikt —
die moet via `@bvc/domain`/`@bvc/reporting` herberekend worden, net als bij
de P&L-cijfers nu.

Huisstijl (kleuren, typografie, kaart-/tabelpatronen) staat gedeeld in
`huisstijl.ts` (`HUISSTIJL_CSS`, `escapeHtml`, `formatBedragHtml`,
`renderRapportDocument`) en wordt door elke sectierenderer hergebruikt.
Nog te porten secties (met bronregels in `legacy/index.html`):

| # | Sectie | Legacy render-functie | Regel | Status |
|---|---|---|---|---|
| 01 | Kerncijfers (KPI-dashboard: huurinkomen, EBITDA, uitbetalingsratio, bankstand, debiteuren, servicekosten-saldo + bezettingsgraad) | `renderOverzicht` | ~1502 | ✅ gebouwd (`kerncijfers.ts` + `renderKerncijfers.ts`) |
| 02 | Resultaat P&L per kwartaal | `renderPnl` | ~1580 | deels gebouwd — `plRapport.ts`/`renderHtml.ts` (jaarcijfers, ander datamodel/CSS dan kwartaal+begroting) én sinds 2026-08-21 `renderPlPeriode.ts` (mapping-gedreven periodecijfers, nu ook onderdeel van het gecombineerde `rapport-periode`-document hieronder) — nog geen kwartaal+begroting-vergelijking in de renderer zelf |
| 03 | Kasstroom | `renderCashflow` | ~1647 | deels gebouwd — `kasstroomBerekening.ts` (mutatie bankstand) + `kasstroomManagementoverzicht.ts` (huurontvangsten/exploitatie-uitgaven/eigenaaronttrekkingen/kwartalen/uitbetalingsratio, zie sectie hierboven); renderer nog niet pixel-perfect gelijk aan het voorbeeldontwerp, en `kasstroomCategorie` nog niet bevestigd voor 070 |
| 04 | Balans | `renderBalans` | ~1725 | ✅ gebouwd (`balansPeriodeBerekening.ts` + `renderBalansPeriode.ts`) — zie sectie hieronder |
| 05 | Servicekosten (incl. stijgers/dalers, signaalbadges) | `renderServicekosten` | ~1859 | nog te bouwen |
| 06 | Verhuur / huuroverzicht (contracttabel, statusbadges op resterende looptijd) | `renderRentroll` | ~1897 | nog te bouwen |
| 07 | Onderhoud & investeringen | `renderOnderhoud` | ~1983 | nog te bouwen |
| 08 | Signalen & aandachtspunten | `renderSignalen` | ~2020 | nog te bouwen |

Elke sectie krijgt een eigen typed invoermodel (`types.ts`) en een puur
rekenmodule (zoals `plRapport.ts`/`kerncijfers.ts`) los van de renderer,
zodat de "geen berekeningen in de UI-laag"-regel overal geldt. Volgorde
nog te bepalen voor 03–08; 05 (Servicekosten, met stijgers/dalers en
signaalbadges) of 06 (Verhuur/huuroverzicht) liggen het meest voor de
hand als volgende stap, omdat ze qua databehoefte het dichtst bij de al
bestaande bron-/domeinfuncties liggen (`sources/servicekosten.ts`,
`sources/contracten.ts`, `resterendeLooptijdDagen`).
