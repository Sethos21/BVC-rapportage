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
vereenvoudigd 2026-08-24 op expliciet verzoek van de gebruiker — "hoeveel
geld kwam er binnen, hoeveel ging eruit, en hoeveel daarvan heb ik zelf
opgenomen?").** Bouwt voort op (1) — `berekenKasstroomPeriode` wordt
ONGEWIJZIGD hergebruikt voor bankstand begin/eind/netto kasstroom, geen
dubbele berekening. Toont: bankstand begin, totale ontvangsten, totale
uitgaven, netto kasstroom, bankstand eind, een uitsplitsing BINNEN de
uitgaven (waarvan eigenaaronttrekkingen / waarvan overige uitgaven), en
per kwartaal ontvangsten/uitgaven/eigenaaronttrekkingen/netto kasstroom.

**Kernvereenvoudiging t.o.v. de eerste versie:** ontvangsten en uitgaven
worden UITSLUITEND afgeleid uit de mutaties op de bevestigde liquide-
middelen-rekening(en) zelf (elke boeking: positief = ontvangst, negatief =
uitgave als positief bedrag) — geen tegenrekening-classificatie meer nodig
voor het totaal. Eigenaaronttrekkingen is een aanvullende uitsplitsing
BINNEN de uitgaven, specifiek of een bevestigde `kasstroomCategorie:
"EIGENAARONTTREKKING"` (`@bvc/config`, op zowel BALANS- als RESULTAAT-
regels — nooit via `rapportagecategorie`, vrije tekst, zou CLAUDE.md §6
schenden). Bij 070: rekening `0840`.

**Mechanisme voor eigenaaronttrekkingen (herzien 2026-08-25, zie
"Productiebevinding" hieronder):** per boekstuk (`boekstukSleutel`) wordt
alleen bepaald of het ten minste één regel op een liquide-middelen-
rekening bevat (kasstroom-relevant). Is dat zo, dan telt ELKE
tegenrekening-regel in dat boekstuk met een bevestigde `kasstroomCategorie:
"EIGENAARONTTREKKING"` mee met haar eigen bedrag — geen boekstuk-brede
homogeniteitseis, geen bedrag-matching tussen een specifieke bankregel en
een specifieke tegenrekening. Dat is geen aanname: een boekstuk balanceert
per definitie (debet = credit), dus het bedrag van een bevestigde
eigenaaronttrekking-tegenrekening binnen een kasstroom-relevant boekstuk
IS het bedrag dat via de liquide-middelen-rekening is uitbetaald, ongeacht
wat er verder nog in datzelfde boekstuk zit.

**Twee aansluitingen gelden ALTIJD, structureel (geen aparte controle
nodig — ze volgen uit de constructie):**
- `ontvangsten - uitgaven = nettoKasstroom` (wiskundig gegarandeerd: som
  van de positieve delen minus som van de negatieve delen = som van alles).
- `eigenaarOnttrekkingen + overigeUitgaven = uitgaven` (`overigeUitgaven`
  is expliciet het restbedrag, geen los berekende/te bevestigen categorie
  — "overig" hoeft dus NOOIT bevestigd te worden, in tegenstelling tot
  `liquideMiddelen`/`kasstroomCategorie` zelf).

**Wat GEEN `controleVereist` oplevert (bewuste vereenvoudiging):** een
uitgave met een onbekende, ongemapte, of niet-EIGENAARONTTREKKING-
tegenrekening telt gewoon mee in `overigeUitgaven` — dat is de per
definitie gedefinieerde restcategorie, geen aanname die bevestiging
vereist. `controleVereist` bevat daarom uitsluitend de doorgegeven
`liquideMiddelen`-onzekerheid van `berekenKasstroomPeriode`.

**Productiebevinding (070_Rooise_Zoom, 2026-08-25) — waarom de eerste
versie van dit mechanisme faalde:** een echte run toonde `waarvan
eigenaaronttrekkingen: €0,00` terwijl `0840` al bevestigd leek op
`EIGENAARONTTREKKING`. Onderzoek met `kasstroomTegenrekeningDiagnose.ts`
(zie hieronder) op de ECHTE cache legde twee afzonderlijke oorzaken bloot:
1. De actieve productie-mapping had `kasstroomCategorie: null` voor `0840`
   staan — de eerdere bevestiging was nooit daadwerkelijk in het bestand
   op `BVC_DATA_ROOT` doorgevoerd (los, operationeel probleem — geen
   codefout).
2. Belangrijker: `boekstukSleutel` bleek bij 070 een MAANDELIJKSE
   verzamelboeking te zijn (één boekstuk bundelt meerdere afzonderlijke
   huurontvangsten, eigenaaronttrekkingen én kostenbetalingen — niet één
   boekstuk per transactie). De vorige versie van dit mechanisme eiste dat
   het NETTO liquide-bedrag van het HELE boekstuk negatief was én dat ALLE
   tegenrekeningen in dat boekstuk dezelfde categorie hadden — bij een
   verzamelboeking met gemengde categorieën (bv. huur ÉN onttrekking in
   hetzelfde boekstuk) is dat vrijwel nooit het geval, dus zelfs met (1)
   gecorrigeerd was 148.000 van de 253.000 aan echte 0840-mutaties gemist.
   Het huidige mechanisme (hierboven) heeft geen van beide eisen meer
   nodig en telt het bevestigde bedrag rechtstreeks, ongeacht wat er
   verder in het boekstuk zit.

**Bewust losgelaten uit de eerste, bredere opzet:** `huurontvangsten`/
`exploitatieUitgaven`/`OVERIG` als aparte KPI-categorieën, `uitbetalingsratio`,
en een configureerbare streefwaarde bankstand (`AdministratieConfig` had
hiervoor kort een `streefwaardeBankstand`-veld — weer verwijderd, niet
gebruikt door dit overzicht). `kasstroomCategorie` zelf (het config-veld)
blijft bestaan — een latere sectie kan de bredere HUURONTVANGST/
EXPLOITATIE_UITGAVE-indeling nog hergebruiken, dit overzicht gebruikt er nu
alleen `EIGENAARONTTREKKING` van.

**Renderer + Worker:** `renderKasstroomManagementoverzicht.ts` — bewust
NOG NIET pixel-perfect gelijk aan het aangeleverde voorbeeldontwerp (op
expliciet verzoek van de gebruiker), hergebruikt de bestaande
`.card`/`.kpi-*`-huisstijl zodat de outputstructuur al wel alle gevraagde
KPI's/kwartaalregels ondersteunt. `genereerKasstroomManagementoverzicht.ts`
+ CLI `kasstroom-managementoverzicht` schrijft HTML naar `rapporten/`
(zelfde patroon als `rapport-periode`/`genereerControlerapport.ts`).

**Bevestigd voor `070_Rooise_Zoom`:** `0840` (Ontrekkingen - Uitkeringen)
→ `kasstroomCategorie: "EIGENAARONTTREKKING"` — dat is voor dit
vereenvoudigde overzicht het enige dat nog bevestigd hoefde te worden.

**Diagnostiek: `kasstroomTegenrekeningDiagnose.ts` (2026-08-25, mechanisme
meegewerkt met de fix hierboven).** Alleen-lezen hulpmiddel, geen KPI, geen
rapportbestand — het instrument waarmee de productiebevinding hierboven is
gedaan, blijft bestaan voor toekomstige administraties/rekeningen.
`diagnoseerKasstroomTegenrekening(boekingen, mappingRegels, doelRekening)`
toont per boekstuk waarin de opgegeven rekening voorkomt: of dat boekstuk
kasstroom-relevant is (bevat het een liquide regel), of het vandaag meetelt
als eigenaaronttrekking, en zo niet, welke van de twee mogelijke oorzaken
dat verklaart (geen liquide regel in het boekstuk — bv. omdat de
doelrekening zelf onverwacht als `liquideMiddelen: true` staat; of de
rekening zelf heeft geen bevestigde `kasstroomCategorie:
"EIGENAARONTTREKKING"` — inclusief het `null`-geval dat de productiebevinding
verklaarde). Herhaalt bewust dezelfde logica als
`berekenKasstroomManagementoverzicht` — introduceert geen nieuwe
classificatie, legt alleen de bestaande bloot. Worker:
`genereerKasstroomTegenrekeningDiagnose.ts` + CLI
`kasstroom-diagnose-tegenrekening <administratieId> --boekjaar N
--periodeTotEnMet P --rekening <grootboekrekening>` (print JSON op
stdout, schrijft geen bestand).

### Regressiepunt: 070_Rooise_Zoom kasstroom-managementoverzicht sluit (2026-08-25)

Na de fix hierboven is `kasstroom-managementoverzicht 070_Rooise_Zoom
--boekjaar 2026 --periodeTotEnMet 06` door de gebruiker persoonlijk
geverifieerd tegen de echte productie-run en bevestigd correct — niet
afgeleid of aangenomen. Vastgelegde uitkomst:

| Veld | Bedrag |
| --- | --- |
| Bankstand begin | € 1.607,50 |
| Bankstand eind | € 73.038,37 |
| Totale ontvangsten | € 552.498,76 |
| Totale uitgaven | € 481.067,89 |
| Netto kasstroom | € 71.430,87 |
| Waarvan eigenaaronttrekkingen | € 253.000,00 |
| Waarvan overige uitgaven | € 228.067,89 |
| Q1 (ontvangsten / uitgaven / onttrekkingen / netto) | € 307.782,11 / € 222.424,47 / € 100.000,00 / € 85.357,64 |
| Q2 (ontvangsten / uitgaven / onttrekkingen / netto) | € 244.716,65 / € 258.643,42 / € 153.000,00 / −€ 13.926,77 |
| Q3 / Q4 | € 0,00 (geen boekingen in deze periode) |
| Controle vereist | geen |

Anders dan de balans-periode-regressietest hierboven (`070_Rooise_Zoom
sluit`, 2026-08-21) is dit NIET als een hardgecodeerde test met
gereconstrueerde boekingsregels vastgelegd: de balans-periodetest kon
volstaan met 14 statische beginbalanscijfers, maar deze uitkomst volgt
uit maanden aan individuele boekingsregels (productiedata, buiten git —
CLAUDE.md §5) die niet in de repo passen of horen. In plaats daarvan is
dit vastgelegd via het generieke `--verwacht <pad-naar-json>`-mechanisme
(`vergelijkKasstroomManagementoverzichtMetVerwacht`,
`kasstroomManagementoverzichtVergelijking.ts` — zelfde rol als
`pl-periode`'s `--verwacht`, hier op de vaste KPI-velden + vier
kwartalen in plaats van een dynamische rapportagepost-lijst). Een
`verwacht-070-2026-06.json` met bovenstaande cijfers is aan de gebruiker
geleverd; `bvc-worker kasstroom-managementoverzicht 070_Rooise_Zoom
--boekjaar 2026 --periodeTotEnMet 06 --verwacht <pad>` toetst elke
toekomstige run automatisch tegen deze bevestigde uitkomst
(`exitCode 1` bij een afwijking buiten €0,01).

**Beleid vanaf hier (op expliciet verzoek van de gebruiker, 2026-08-25):**
geen verdere wijzigingen meer aan `berekenKasstroomManagementoverzicht`
of `diagnoseerKasstroomTegenrekening` tenzij een ANDERE administratie
daadwerkelijk een nieuw, nog niet gedekt geval blootlegt (bv. onttrekkingen
die niet via een aparte rekening maar rechtstreeks tegen de winstreserve
lopen — zie de eerdere toelichting hierboven over dat scenario). Vormgeving
(HTML/CSS) van dit overzicht wordt bewust NIET nu losstaand opgepoetst —
dat gebeurt later gezamenlijk met P&L en balans, zodat huisstijlwerk niet
drie keer apart gebeurt.

### Aanvullend: Top overige uitgaven (`kasstroomTopUitgaven.ts`, 2026-08-25)

Puur informatieve uitsplitsing BOVENOP het (vastgelegde) managementoverzicht
— bewust in een EIGEN functie, niet in `berekenKasstroomManagementoverzicht`
zelf, om de zojuist vastgelegde regressie-uitkomst niet aan te raken.
`berekenTopOverigeUitgaven(boekingen, mappingRegels, aantal = 3)` levert de
N grootste individuele "werkelijke uitgaande bankbetalingen" (elke losse
boeking op een liquide-middelen-rekening met een negatief saldo — dezelfde
regel als `uitgaven`, geen boekstukaggregatie), **exclusief**
eigenaaronttrekkingen.

Een individuele bankregel wordt uitgesloten als hetzelfde boekstuk een
tegenrekening-regel bevat met een bevestigde `kasstroomCategorie:
"EIGENAARONTTREKKING"` én EXACT hetzelfde bedrag — bedrag-matching per
boekstuk (multiset, elke tegenrekening-regel maar één keer verbruikt), zodat
een verzamelboeking met meerdere onttrekkingen ze stuk voor stuk correct
uitsluit. Dit patroon is empirisch bevestigd bij 070 (elke
eigenaaronttrekking-tegenrekeningregel heeft daar een exact even grote,
tegengestelde liquide regel in hetzelfde boekstuk — zie het
`kasstroomTegenrekeningDiagnose`-onderzoek hierboven). Puur informatief:
telt niet apart mee, heeft geen invloed op `uitgaven`/`overigeUitgaven`/
enige aansluiting. Gerenderd als extra tabel (datum/omschrijving/bedrag) in
`renderKasstroomManagementoverzicht.ts`, alleen als
`KasstroomManagementoverzichtInvoer.topOverigeUitgaven` is meegegeven
(optioneel veld — leeg/ontbrekend rendert geen sectie).

### Onderzoek: BTW-positie (2026-08-25, nog GEEN mapping/berekening gewijzigd)

Op verzoek onderzocht of een BTW-kasstroom-KPI (ontvangen/betaald/saldo)
betrouwbaar afleidbaar is. `1506` (Afdrachten BTW, samen met `1505` een
BTW-paar — zie packages/config/README.md, bewust nooit geclassificeerd op
basis van hun toevallig gelijke/tegengestelde bedragen) bleek GEEN directe
banktegenrekening: een diagnose tegen de echte `070_Rooise_Zoom`-cache
(`kasstroom-diagnose-tegenrekening --rekening 1506`) toonde één boekstuk
(26-01-2026, €31.617) waar `1506` uitsluitend tegen `1600` (Crediteuren)
boekt — geen liquide regel in dat boekstuk.

Om te onderzoeken of die €31.617 via `1600` alsnog naar de bank loopt (en
dus wél een kasstroom-BTW-post zou zijn), is `kasstroomRekeningActiviteit.ts`
gebouwd: `diagnoseerRekeningActiviteit(boekingen, mappingRegels,
doelRekening)` toont ALLE boekingen op één rekening chronologisch
(boekstukSleutel/dagboeknr/datum/bedrag/omschrijving/kasstroom-relevantie),
zonder zelf iets te matchen. Reden om dit als apart, generiek instrument te
bouwen i.p.v. direct een matchpoging te coderen: een crediteurenrekening is
gepoold over meerdere leveranciers/facturen, en de factuurregistratie
(credit 1600) en de betaling (debit 1600, tegen de bank) staan gegarandeerd
in VERSCHILLENDE boekstukken (anders dan bij eigenaaronttrekkingen, waar
tegenrekening en bankregel in hetzelfde boekstuk staan) — een keten
betrouwbaar volgen kan dus niet via `boekstukSleutel`, en een blind
bedrag-match tussen een credit- en een latere debitregel op 1600 zou precies
de "toevallige bedragmatch"-fout herhalen die bij 1505/1506 al expliciet is
afgewezen. Worker: `genereerKasstroomRekeningActiviteit.ts` + CLI
`kasstroom-diagnose-rekeningactiviteit <administratieId> --boekjaar N
--periodeTotEnMet P --rekening <grootboekrekening>`.

**Onderzoek Boeking_Grootboek_A/B (2026-08-26, correctie + diagnostische
uitbreiding, nog GEEN classificatie/kasstroomlogica):** de brondata bevat
volgens `packages/data-contracts/src/sources/boekingen.ts` twee extra
kolommen (`Boeking_Grootboek_A`/`Boeking_Grootboek_B`) die in potentie een
betrouwbaardere koppelsleutel zijn dan bedrag-matching om een keten zoals
1506 → 1600 → bank te volgen (bv. een factuur-/matchingreferentie) — precies
om de "toevallige bedragmatch"-fout te vermijden die bij 1505/1506 al is
afgewezen (zie hierboven, en `packages/config/README.md`).

Eerdere versie van deze paragraaf beweerde dat deze twee velden nergens
voorbij de staging-laag kwamen — dat was **onjuist**: `packages/cache`'s
schema had `grootboek_a`/`grootboek_b` op de `boekingen`-tabel al sinds de
oorspronkelijke pivot naar de lokale-eerst architectuur, en
`rebuildCache`/`apps/worker/src/rebuildCache.ts` vulde ze ook al. Het
werkelijke gat zat alleen in het gedeelde `Boekingsregel`-domeintype
(`@bvc/domain`, bewust minimaal — alleen velden die berekeningen nodig
hebben): dat gaf A/B niet door, waardoor geen enkel reporting-instrument ze
kon tonen.

Minimale diagnostische uitbreiding (géén wijziging aan `Boekingsregel`
zelf, dus geen enkele KPI/domeincode geraakt): `kasstroomRekeningActiviteit.ts`
heeft nu een lokaal intersection-type `BoekingsregelMetGrootboekAB`
(`Boekingsregel & { grootboekA, grootboekB }`); `RekeningActiviteitRegel`
bevat `grootboekA`/`grootboekB`, en `apps/worker/src/genereerKasstroomRekeningActiviteit.ts`
vult ze rechtstreeks vanuit de cache-rij (`row.grootboek_a`/`row.grootboek_b`)
in plaats van via de gedeelde `naarBoekingsregel`-mapper. Zichtbaar via
dezelfde CLI als hierboven:
`kasstroom-diagnose-rekeningactiviteit <administratieId> --boekjaar N
--periodeTotEnMet P --rekening <grootboekrekening>` (JSON op stdout bevat nu
per regel ook `grootboekA`/`grootboekB`).

**Nog open, met opzet niet zelf aangenomen:** wat A/B inhoudelijk
voorstellen (bv. factuurreferentie versus grootboek-subrekening) staat
nergens gedocumenteerd in de bron en moet empirisch worden vastgesteld door
deze diagnose tegen de echte cache van 070_Rooise_Zoom te draaien voor zowel
de BTW-boeking op 1506/1600 (26-01-2026, €31.617) als de bijbehorende
betaling (27-01-2026). Pas ná die inspectie kan beoordeeld worden of A/B de
keten 1506 → 1600 → bank deterministisch kunnen volgen, en of dat ook
standhoudt bij verzamelbetalingen/deelbetalingen — dit bestand matcht nog
steeds niets automatisch.

**Resultaat van die inspectie (2026-08-26): A/B zijn GEEN bruikbare
koppelsleutel — onderzoek gepauzeerd op verzoek van de gebruiker.** Een
echte run van `kasstroom-diagnose-rekeningactiviteit` tegen 070_Rooise_Zoom
voor rekening 1600 (boekjaar 2026 t/m periode 02, 176 regels) toonde dat
`grootboekA` op ELKE regel dezelfde waarde heeft (`"00000910"`) — inclusief
de BTW-boeking zelf (26-01, boekstuk `202650000035`, -€31.617) én de
bijbehorende betaling (27-01, boekstuk `202620000007`, +€31.617), maar ook
elke andere, volledig ongerelateerde boeking op 1600 (verzekeringspremies,
schoonmaak, elektra-afrekeningen, liftonderhoud, etc.). `grootboekB` was op
alle 176 regels `null`. A/B varieert dus niet per boekstuk/factuur/betaling
op deze rekening — het gedraagt zich als een vast, rekeninggebonden
kenmerk (vermoedelijk een intern Informant/PxPlus-kenmerk van rekening 1600
zelf), niet als een per-transactie referentie. Daarmee kan het geen twee
specifieke boekstukken van elkaar onderscheiden en dus de keten 1506 → 1600
→ bank niet deterministisch volgen — noch voor het basisgeval, laat staan
voor verzamel-/deelbetalingen.

De diagnostische uitbreiding (`grootboekA`/`grootboekB` op
`RekeningActiviteitRegel`, zie hierboven) blijft in de code staan — die is
op zichzelf correct en herbruikbaar (bv. om A/B op een andere rekening of
administratie te checken), maar het BTW-ketenonderzoek zelf is op expliciet
verzoek van de gebruiker gepauzeerd: geen vervolgstap (1506 los checken,
alternatieve velden zoeken, structurele matching bouwen) ondernemen zonder
dat opnieuw met de gebruiker af te stemmen.

## Kerncijfers / Management-KPI's (`kerncijfersManagement.ts`, v1, 2026-08-26) — samenstellen, geen nieuwe berekening

Compact managementoverzicht, op verzoek van de gebruiker gebouwd bovenop
drie al-bewezen rekenmodules — `berekenPlPeriode`/`berekenNettoResultaat`,
`berekenKasstroomManagementoverzicht` en (uitsluitend voor de
datakwaliteitsindicator) `berekenBalansPeriode`. `samenstelKerncijfersManagement`
herschikt alleen bestaande resultaten; er wordt geen boeking, saldo of
mapping opnieuw beoordeeld. Zeven velden:

- `totaleOpbrengsten`/`totaleKosten` — uit `PlPeriodeResultaat.categorieTotalen`,
  opgezocht op de rapportagecategorienamen `"Opbrengsten"`/`"Kosten"` (de
  enige twee die systeembreed in gebruik zijn, zelfde aanname als
  `STANDAARD_TEKEN_PER_CATEGORIE` in `genereerBalansPeriode.ts` — bewust nog
  niet generieker gemaakt, op verzoek gebruiker). Komt een categorie niet
  voor in een geldige periode, dan is het resultaat €0 (geen boekingen in
  die categorie — een legitieme lege-som, geen datagat); rekeningen die
  helemaal niet classificeerbaar zijn, blijven zoals altijd apart zichtbaar
  via `PlPeriodeResultaat.controleVereist`, niet stilzwijgend meegeteld.
- `resultaatHuidigBoekjaar` — rechtstreeks `berekenNettoResultaat`'s
  `OnbekendOf<Decimal>`, ongewijzigd.
- `bankstandEindePeriode`/`nettoKasstroom`/`eigenaarOnttrekkingen` —
  rechtstreeks uit `KasstroomManagementoverzichtResultaat`.
- `balansSluitBinnenTolerantie` — rechtstreeks
  `BalansAansluitingscontrole.sluitBinnenTolerantie`: uitsluitend een
  datakwaliteitsindicator, GEEN van de zes kerncijfers hierboven wordt via
  de balans herberekend of gevalideerd.

Bewust een APARTE module van de bestaande `kerncijfers.ts`/`renderKerncijfers.ts`
("sectie 01 — Kerncijfers (KPI-dashboard)" hieronder): dat is een vroege,
nooit aan een Worker-commando of aan echte cachedata gekoppelde poort van
`legacy/index.html`'s `renderOverzicht` (huurinkomen/EBITDA/uitbetalingsratio/
bankstand/debiteuren/servicekosten-saldo + bezettingsgraad, getest tegen
fixture "Fergagne BV") — een ander, breder concept. Niet vermengd of
overschreven, expliciete keuze van de gebruiker.

Worker: `genereerKerncijfers.ts` — één cache-read, zelfde
mapping-/periodeselectiepatroon als `genereerRapportPeriode.ts`, nu voor
drie i.p.v. twee bronnen. CLI (TIJDELIJK, v1, nog geen renderer/HTML):
`kerncijfers <administratieId> --boekjaar N --periodeTotEnMet P
[--tolerantie N]`, JSON op stdout.

**Vastgoed-KPI's (bezettingsgraad, huur per m², contractvervalkalender) —
kort bronnenonderzoek, nog GEEN mapping/implementatie (2026-08-26):**
- Bezettingsgraad/leegstand: `complex_totalen` heeft `totaal_oppervlakte`/
  `totaal_verhuurd`/`totaal_leegstand` al per complex geaggregeerd —
  sterkste kandidaat, en er bestaat al een ongebruikte rekenfunctie
  (`berekenBezettingsgraadPortefeuille`, in de bestaande `kerncijfers.ts`)
  die hier direct op past.
- Huur per m²: `rentroll` heeft `prolongatie_bedrag_jaar` (jaarhuur) +
  `gehuurd_oppervlak` per contract, aggregeerbaar per complex. Data lijkt
  aanwezig, maar (a) rentroll heeft een `rapportage_datum`
  (peildatum-snapshot) waarvoor — anders dan bij boekingen/balansstanden —
  nog GEEN expliciete periodeselectie-functie bestaat in
  `packages/cache/periodeSelectie.ts`; (b) welke huurcomponent telt (kaal /
  incl. korting / incl. servicevoorschot) is nog geen bevestigde keuze.
- Contractvervalkalender/WALT: `contracten` heeft expiratie-/
  opzegdatumvelden, te combineren met rentroll (huur) en units (m²) voor
  een gewogen resterende looptijd. Theoretisch afleidbaar, maar
  join-integriteit (complexnummer/unitnummer/contractnummer consistent
  over de drie tabellen) is nog niet tegen echte data geverifieerd.
- Op geen van deze vier tabellen bestaat vandaag enige domain/reporting-laag
  (geen mapper, geen rekenfunctie behalve de losse
  bezettingsgraad-/huur-helpers in `kerncijfers.ts`) — volledig braakliggend
  terrein, geen vervolgstap zonder nieuwe afstemming met de gebruiker.

## Vastgoed-kerncijfers v1 (`vastgoedKerncijfers.ts`, 2026-08-26) — bottom-up bezettingsgraad/leegstand, STRIKT GESCHEIDEN van de financiële kerncijfers

Eerste echte vastgoed-KPI-module, op basis van het bottom-up-onderzoek
hierboven. `berekenVastgoedKerncijfers(units, rentroll, complexTotalen)`
importeert NIETS van `plPeriodeBerekening.ts`/`balansPeriodeBerekening.ts`/
`kasstroomManagementoverzicht.ts`/`kerncijfersManagement.ts` en gebruikt
eigen, lokale invoertypen (geen `Boekingsregel`) — bewust geen
boekjaar/periode, dit is een **momentopname** (`momentopname: true` in de
output), geen periodegebonden cijfer (zie het peildatum-onderzoek hierboven:
geen van de drie bronnen heeft een betrouwbare, gezamenlijke historische
periodeselectie). `bronPeildatum` wordt alleen gevuld als ALLE aangeleverde
`rentroll.rapportage_datum`-waarden identiek zijn, anders `null` — nooit
verzonnen.

**Bronkeuze v1** (voor 070_Rooise_Zoom bottom-up gereconcilieerd, GEEN
universele boekhoudkundige waarheid voor elke toekomstige bron/
administratie):
- totale VVO per complex = som van `units.VVO`;
- verhuurde VVO per complex = som van `rentroll.gehuurd_oppervlak` voor
  regels met `gehuurd_oppervlak > 0`;
- `complex_totalen` is UITSLUITEND een onafhankelijke controlebron — nooit
  een fallback voor een ontbrekende/afwijkende units-/rentroll-waarde;
- `contracten` is in v1 GEEN bron voor oppervlakte: bij 070 is aangetoond
  dat een contract zonder `unitnr` meerdere units kan omvatten (contract
  0000000043, complex 001, 750 m² over vermoedelijk 2 units) — een
  unit-niveau-telling via `contracten` zou dat stilzwijgend missen. Om
  dezelfde reden bouwt v1 ook geen "aantal verhuurde units"-KPI.

**Datakwaliteitsregels**, via het `OnbekendOf`/`controleVereist`-patroon:
verhuurde VVO > totale VVO is KRITIEK (blokkeert een negatieve leegstand of
bezettingsgraad >100%); een ontbrekende/`null` VVO of `gehuurd_oppervlak`
wordt nooit stilzwijgend als 0 behandeld (totale/verhuurde VVO wordt dan
`onbekend`); units met VVO = 0 en rentroll-regels met `gehuurd_oppervlak =
0` tellen niet mee maar worden wel INFORMATIEF gemeld; afwijkende patronen
(0 m² + positieve jaarhuur, negatieve jaarhuur + oppervlak > 0) worden als
WAARSCHUWING gerapporteerd; een negatief `gehuurd_oppervlak` is KRITIEK en
telt niet mee; afwijkingen tussen de bottom-up-berekening en
`complex_totalen` (Totaal_Oppervlakte/Totaal_Verhuurd/Totaal_Leegstand,
per complex) worden gesignaleerd maar NOOIT automatisch gecorrigeerd. Een
geslaagde KPI-berekening betekent dus niet automatisch dat `controleVereist`
leeg is — zie het regressiepunt hieronder (complex 002/004).

Worker: `genereerVastgoedKerncijfers.ts` leest `units`/`rentroll`/
`complex_totalen` rechtstreeks uit de cache (zelfde ongefilterde
`SELECT * FROM ...`-patroon als `genereerControlerapport.ts`). Tijdelijk
CLI-commando (nog geen renderer/HTML, nog NIET gekoppeld aan
`kerncijfersManagement`): `vastgoed-kerncijfers <administratieId>` — geen
`--boekjaar`/`--periodeTotEnMet`, JSON op stdout.

### Regressiepunt: 070_Rooise_Zoom vastgoed-kerncijfers (2026-08-26)

`vastgoed-kerncijfers 070_Rooise_Zoom` door de gebruiker persoonlijk
gedraaid tegen de echte productiecache en bevestigd — exact gelijk aan de
bottom-up-analyse hierboven:

| | Totale VVO | Verhuurde VVO | Leegstand | Bezettingsgraad | Leegstandspercentage |
| --- | --- | --- | --- | --- | --- |
| Portefeuille | 6.773,5 m² | 6.589,5 m² | 184 m² | 97,28% | 2,72% |
| Complex 001 | 1.390 m² | 1.390 m² | 0 m² | 100% | 0% |
| Complex 002 | 1.138 m² | 954 m² | 184 m² | 83,83% | 16,17% |
| Complex 003 | 912 m² | 912 m² | 0 m² | 100% | 0% |
| Complex 004 | 3.333,5 m² | 3.333,5 m² | 0 m² | 100% | 0% |

`bronPeildatum`: 2026-07-31 (alle rentroll-regels bleken dezelfde
`rapportage_datum` te hebben). `controleVereist` bevatte exact de vijf
verwachte meldingen: INFORMATIEF voor de 0 m²-unit (001/0005) en de twee
kortingsregels op rentroll (003), en WAARSCHUWING voor de al bekende
afwijkingen bij complex 002 (`Totaal_Leegstand`) en 004
(`Totaal_Oppervlakte`) — geen KRITIEK. Bevestigt dat een betrouwbare
bottom-up KPI en een niet-lege `controleVereist` tegelijk kunnen bestaan.

### Regressiepunt: 070_Rooise_Zoom kerncijfers (2026-08-26)

`kerncijfers 070_Rooise_Zoom --boekjaar 2026 --periodeTotEnMet 06` door de
gebruiker persoonlijk gedraaid tegen de echte productiecache en bevestigd:

| Veld | Waarde |
| --- | --- |
| Totale opbrengsten | € 341.734,81 |
| Totale kosten | € 30.555,15 |
| Resultaat huidig boekjaar | € 311.179,66 |
| Bankstand einde periode | € 73.038,37 |
| Netto kasstroom | € 71.430,87 |
| Eigenaaronttrekkingen | € 253.000,00 |
| Balans sluit binnen tolerantie | ja |

**Koppeling vastgoedsectie (2026-08-26):** `samenstelKerncijfersManagement`
kreeg een vijfde parameter (`VastgoedKerncijfersResultaat`, ongewijzigd
doorgegeven als `vastgoed`); `genereerKerncijfers.ts` hergebruikt
`genereerVastgoedKerncijfers.ts` ongewijzigd via een eigen, tweede
cacheverbinding. `kerncijfers 070_Rooise_Zoom --boekjaar 2026
--periodeTotEnMet 06` door de gebruiker opnieuw gedraaid tegen de echte
cache bevestigt dat beide secties naast elkaar staan zonder vermenging: de
financiële velden hierboven zijn byte-voor-byte gelijk aan vóór de
koppeling, en `vastgoed` is byte-voor-byte gelijk aan het
vastgoed-kerncijfers-regressiepunt hierboven (portefeuille, alle vier
complexen, `bronPeildatum` 2026-07-31, en alle vijf `controleVereist`-
meldingen met dezelfde ernstniveaus). Nog geen renderer — alleen de
samengestelde JSON-output.

Twee onafhankelijke kruiscontroles bevestigen dat er geen nieuwe rekenlogica
is geslopen: (1) bankstand/netto kasstroom/eigenaaronttrekkingen zijn EXACT
gelijk aan het al op 2026-08-25 geverifieerde
`kasstroom-managementoverzicht`-regressiepunt hierboven; (2) €341.734,81 −
€30.555,15 = €311.179,66, exact gelijk aan `resultaatHuidigBoekjaar` — de
opbrengsten/kosten-extractie en `berekenNettoResultaat` zijn dus onderling
consistent.

## Rentroll-diagnose (`rentrollDiagnose.ts`, TIJDELIJK, 2026-08-26) — onderzoek vóór een huur-KPI-module

Alleen-lezen, geen KPI: toont per rentroll-regel `Vorderingsoort`,
`prolongatie_bedrag_jaar`, `korting_bedrag_jaar`, `gehuurd_oppervlak` en —
uitsluitend bij een deterministische (1-op-1) match op contractnummer —
`ingangsdatum`/`afloopdatum`/`check_lopend_contract` uit `contracten` (geen
match of meerdere matches wordt expliciet gemeld, nooit gegokt). Plus
diagnostische totalen per `Vorderingsoort`. Gebouwd om vast te stellen hoe
`Vorderingsoort` zich in de echte 070-data gedraagt vóórdat er een
huur-KPI-module op gebaseerd werd — zie de bevindingen direct hieronder bij
`huurKerncijfers.ts`. CLI: `rentroll-diagnose <administratieId>`.

## Huur-/rentroll-kerncijfers v1 (`huurKerncijfers.ts`, 2026-08-26) — bruto/netto jaarhuur, huurkortingen, huur per m², STRIKT ZELFSTANDIG

Tweede vastgoed-KPI-module, bewust volledig los van `vastgoedKerncijfers.ts`
(geen import, geen gedeelde VVO-definitie) — beide modules rekenen
onafhankelijk, gereconcilieerd tegen dezelfde 070-data, geen technische
koppeling (bewuste keuze van de gebruiker: eerst de output afzonderlijk
bewijzen, pas daarna beoordelen of een gedeelde helper zinvol is).

**Bronregels**, bevestigd via `rentrollDiagnose.ts`-onderzoek tegen de
echte 070-cache (2026-08-26) — GEEN universele waarheid voor elke
toekomstige bron/administratie:
- `Vorderingsoort = "01"` = reguliere bruto jaarhuur.
- `Vorderingsoort = "13"` = huurkorting (negatief bedrag verwacht).
- `Vorderingsoort = "12"` (Compensatie OB) komt bij 070 niet voor — puur
  informatief genegeerd als hij wel voorkomt.
- `korting_bedrag_jaar` (het aparte kolomveld) staat bij 070 altijd op 0 —
  NOOIT leidend; de huurkorting komt uitsluitend uit de `13`-regel(s) van
  `prolongatie_bedrag_jaar`.
- Verhuurde VVO (deze module) = eigen, onafhankelijke som
  `gehuurd_oppervlak` van geldige `01`-regels — komt voor 070 toevallig
  exact overeen met `vastgoedKerncijfers.ts`'s VVO (6.589,5 m²), maar dat
  is geen garantie voor andere administraties.

**Contractgeldigheid** (`bepaalContractGeldigheid`, apart geëxporteerd en
grensgeval-getest): peildatum = `bronPeildatum` uit
`rentroll.rapportage_datum` (alleen gevuld bij eenduidigheid, zelfde
bepaling als `vastgoedKerncijfers.ts`, bewust opnieuw lokaal gedefinieerd
i.p.v. gedeeld). Ontbrekende `ingangsdatum` → geldigheid altijd `onbekend`;
`ingangsdatum`/`afloopdatum`-grenzen zijn INCLUSIEF; geen `afloopdatum` =
open einde, blijft geldig. `check_lopend_contract` wordt gecrosscheckt
(afwijking → WAARSCHUWING) maar is nooit leidend boven de berekende
geldigheid.

**Datakwaliteitscontroles** (`OnbekendOf`/`controleVereist`): onbekende/
onverwachte `Vorderingsoort`, ontbrekende of niet-eenduidige
contractkoppeling, ontbrekend `prolongatie_bedrag_jaar`, `01` met 0/
ontbrekende m² (WAARSCHUWING) of negatieve m² (KRITIEK), `13` met een
niet-negatieve waarde (KRITIEK, geen aanname dat het toch een korting is)
of met oppervlak > 0 (WAARSCHUWING), meerdere geldige `01`-regels voor
hetzelfde contract (INFORMATIEF). Nooit automatisch gecorrigeerd.

Worker: `genereerHuurKerncijfers.ts`. Tijdelijk CLI-commando (nog geen
renderer, nog niet gekoppeld aan `kerncijfersManagement`):
`huur-kerncijfers <administratieId>` — geen `--boekjaar`/
`--periodeTotEnMet` (momentopname), JSON op stdout.

### Regressiepunt: 070_Rooise_Zoom huur-kerncijfers (2026-08-26)

`huur-kerncijfers 070_Rooise_Zoom` door de gebruiker persoonlijk gedraaid
tegen de echte productiecache en bevestigd:

| | Bruto jaarhuur | Huurkortingen | Netto jaarhuur | Verhuurde VVO | Bruto €/m² | Netto €/m² |
| --- | --- | --- | --- | --- | --- | --- |
| Portefeuille | € 687.900,88 | € 13.920,00 | € 673.980,88 | 6.589,5 m² | € 104,39 | € 102,28 |
| Complex 001 | € 168.630,48 | € 0 | € 168.630,48 | 1.390 m² | € 121,32 | € 121,32 |
| Complex 002 | € 113.637,88 | € 0 | € 113.637,88 | 954 m² | € 119,12 | € 119,12 |
| Complex 003 | € 99.390,12 | € 13.920,00 | € 85.470,12 | 912 m² | € 108,98 | € 93,72 |
| Complex 004 | € 306.242,40 | € 0 | € 306.242,40 | 3.333,5 m² | € 91,87 | € 91,87 |

`bronPeildatum`: 2026-07-31. `controleVereist`: leeg — geen enkel
datakwaliteitspunt getriggerd voor de al bewezen 070-structuur. Complex 003
laat goed zien waarom bruto/netto apart tonen zinvol is: €108,98 bruto
zakt naar €93,72 netto door de huurkortingen, terwijl de andere drie
complexen geen bruto/netto-verschil hebben.

Tijdens het bouwen ontdekt (en hier gefixt): decimal.js's `.isPositive()`
behandelt `0` als positief (`s > 0` is niet de interne definitie — intern
is het teken van 0 standaard `+1`). Een check "13-regel met oppervlak >
0" gaf hierdoor false positives bij `gehuurd_oppervlak = 0`; gefixt met
`.greaterThan(0)`. Zelfde patroon bleek ook in `vastgoedKerncijfers.ts` te
zitten (zie de losse bugfix hieronder).

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

## Servicekosten (`servicekostenPositie.ts`, v1, 2026-08-27) — actuele positie, afrekening voorgaand jaar, grootboekreconciliatie

Zelfstandig domein, gebouwd op twee onderzoeksrondes tegen de echte
`070_Rooise_Zoom`-bron (`servicekostenAfrekeningDiagnose.ts` en
`servicekostenGrootboekReconciliatieDiagnose.ts`, beide TIJDELIJK/
alleen-lezen en nog steeds aanwezig als losstaande CLI-diagnosecommando's
— zie hieronder). Drie conceptueel gescheiden onderdelen, altijd samen
berekend door `samenstelServicekostenPositie`:

- **A. Actuele positie** — werkelijke kosten + voorschotten in de
  geselecteerde periode. `actueelSaldo = kostenSaldo + voorschottenSaldo`
  (NOOIT `kosten - voorschotten` — voorschotten zijn credit-normaal, dus
  al negatief onder de debet-credit-conventie). Portefeuille/complex
  betrouwbaar; voorschotten per contract/huurder volledig herleidbaar;
  kosten per huurder bewust NIET als allocatie gebouwd (slechts ~5% van
  de kostenregels heeft een contract-/huurderkoppeling — een "kosten per
  huurder"-tabel zou schijnprecisie zijn zonder bewezen verdeelsleutel).
- **B. Afrekening voorgaand jaar** — kostensoorten in de bestaande,
  config-gestuurde `uitgeslotenKostensoorten`-lijst (bij 070: "9600"),
  NOOIT onderdeel van A, wel volledig traceerbaar per complex/contract-
  huurder/afrekenjaar (`Service_BK_Jaar_SV_Afrekening`, als
  `OnbekendOf<string>` — nooit gegokt als het veld ontbreekt).
- **C. Financiële reconciliatie** — de doelrekeningen (bij 070: "1711"/
  "1712") zijn een PARAMETER van de aanroep, geen aanname in de
  rekenlaag. Koppeling uitsluitend op de natuurlijke sleutel
  (boekjaar+dagboek+boekstuk+volgnummer) — nooit bedrag-matching. Elke
  aanroep bewijst de aansluiting opnieuw, per rekening en per boekperiode.

**Dubbele classificatie/vangrail** (`bepaalServicekostenStroom`) — twee
onafhankelijke signalen moeten elkaar bevestigen: de bestaande
`uitgeslotenKostensoorten`-config bepaalt AFREKENING_VOORGAAND_JAAR
(verwacht: bron-native `Kostensoort_Soort = "Nvt"`); voor de overige
regels bepaalt `Kostensoort_Soort` zelf WERKELIJKE_KOSTEN/VOORSCHOT. Bij
tegenspraak — een uitgesloten kostensoort met een andere
Kostensoort_Soort dan "Nvt", of een "Nvt"-regel die niet in de
uitsluitingslijst staat — wordt de regel ONBEKEND: nooit meegeteld in A
of B, saldo uitsluitend zichtbaar in `controleVereist`. Dit is de
expliciete vangrail tegen stilzwijgend generaliseren van het
070-patroon naar een administratie met een afwijkende structuur
(getest met een bewust afwijkende fixture, zie `servicekostenPositie.test.ts`).

**Schema/cache**: `Kostensoort_Soort`/`Service_BK_Jaar_SV_Afrekening` zijn
sinds 2026-08-27 onderdeel van het PRODUCTIESCHEMA
(`ServicekostenregelBronSchema`) en de `servicekosten`-cachetabel
(`kostensoort_soort`/`jaar_sv_afrekening`) — pas toegevoegd nadat twee
diagnoserondes tegen echte data het nut bewezen. Een cache die vóór deze
datum is gebouwd mist deze kolommen; `rebuild-cache` opnieuw draaien is
verplicht vóór `servicekosten-positie` bruikbare cijfers geeft.

Worker: `genereerServicekostenPositie.ts` (`selecteerServicekosten`/
`selecteerBoekingen`, exact dezelfde boekjaar/periodeVan/periodeTotEnMet
voor servicekosten én boekingen — geen rekenlogica in de Worker). CLI:
`bvc-worker servicekosten-positie <administratieId> --boekjaar N
[--periodeVan P] --periodeTotEnMet P --rekeningen <lijst>`. Nog GEEN
renderer, nog NIET gekoppeld aan `management-rapport`.

### Regressiepunt: 070_Rooise_Zoom servicekosten-positie sluit (2026-08-27)

`servicekosten-positie 070_Rooise_Zoom --boekjaar 2026 --periodeTotEnMet
06 --rekeningen 1711,1712` is door de gebruiker persoonlijk geverifieerd
tegen de echte productie-run (ná `rebuild-cache` met het uitgebreide
schema) en bevestigd correct. Vastgelegde uitkomst:

| Veld | Waarde |
| --- | --- |
| Kosten (actuele periode) | € 91.177,91 |
| Voorschotten (actuele periode) | −€ 114.530,00 |
| Actueel saldo (kosten + voorschotten) | −€ 23.352,09 |
| Status | `VOORSCHOTTEN_HOGER_DAN_KOSTEN` |
| Afrekening voorgaand jaar (kostensoort 9600) | 19 regels, saldo € 31.926,39 — apart, niet in bovenstaand actueel saldo |
| Reconciliatie 1711 (grootboeksaldo € 106.080,00) | verschil € 0,00 |
| Reconciliatie 1712 (grootboeksaldo −€ 97.505,70) | verschil € 0,00 |
| Reconciliatie per periode (6 periodes × 2 rekeningen = 12 controles) | alle 12 verschil € 0,00 |
| `controleVereist` | 2 regels, beide INFORMATIEF (225 kosten-regels zonder contract/huurder — verwacht; 19 afrekeningsregels apart gehouden) — GEEN WAARSCHUWING |

**Expliciet niet generaliseren**: de 1711/1712-aansluiting is bewezen
voor `070_Rooise_Zoom`, boekjaar 2026, periode 01–06 — dit is GEEN
universele aanname dat elke administratie dezelfde grootboekrekeningen
of dezelfde 100%-koppelgraad heeft. `doelrekeningen` blijft daarom een
verplichte parameter, en de reconciliatiesectie (C) + de classificatie-
vangrail draaien bij elke aanroep opnieuw, voor elke administratie
opnieuw.

**Tijdelijke diagnosecommando's blijven staan** (nog niet verwijderd,
op expliciet verzoek): `servicekosten-bronkolommen`,
`servicekosten-afrekening-diagnose`, `servicekosten-grootboek-
reconciliatie`. Alle drie blijven waardevol als onafhankelijke
patroonvalidatie/regressiecontrole vóór of náást de productiemodule,
vooral bij een nieuwe administratie.

## Contract/huurder-diagnose (`contractHuurderDiagnose.ts`, TIJDELIJK, 2026-08-27) — bouwstap vóór een Huurdersoverzicht-module

Alleen-lezen, geen KPI, geen renderer: zet per contract alle bronnen die
potentieel relevant zijn voor een toekomstig Huurdersoverzicht (uit het
externe Functioneel Ontwerp, niet in deze repository) naast elkaar, om vóór
elke implementatiekeuze eerst de echte 070-data te kunnen inspecteren.
Gebouwd na een bottom-up onderzoeksronde die vier correcties opleverde op
een eerder onderzoeksvoorstel:

1. **FO is leidend, legacy is alleen visuele referentie** — het onderzoek
   classificeert nu elk FO-veld expliciet als v1/later onderzoek/bron
   ontbreekt, in plaats van legacy's kolommen als scope te gebruiken.
2. **`servicekostenPositie`'s `voorschottenPerContractHuurder` is GEEN
   automatisch synoniem voor het FO-veld "servicekostenvoorschot"** — dat
   is een geboekt bedrag over een gekozen periode, terwijl Huurdersoverzicht
   een momentopname is. `rentroll.Service_voorschot_jaar` (gecached als
   `service_voorschot_jaar`, tot nu toe door geen enkele module gebruikt)
   is een kandidaat die qua vorm (rechtstreeks op de rentroll-regel, net
   als `Prolongatie_bedrag_jaar`) beter aansluit, maar dit is NIET bewezen
   — de diagnose toont beide apart naast elkaar, koppelt of vergelijkt ze
   nooit tot één cijfer.
3. **Geen einddatum/looptijdstatus kiezen vóór bronvergelijking** —
   `contracten.afloopdatum`, `contracten.expiratie_expiratiedatum`/
   `_opzegdatum` en `rentroll.contract_expiratiedatum`/`_opzegdatum` (vijf
   velden, twee bronnen) staan alle vijf naast elkaar in de output; welk
   veld authoritative is voor contracteinde/restlooptijd wordt hier NIET
   bepaald.
4. **Hercontrole van `contracten.Huurder_Naam_1`**: op commit `19be378`
   bevestigd nog steeds NIET gewired naar `ContractRow`/de cache (alleen
   `servicekosten.Naam_1` is gewired, sinds de huurdernaam-toevoeging aan
   het managementrapport) — geen dubbel werk, de eerdere observatie klopte
   nog.

**Nieuwe bronvondsten** (via een hercontrole van de al-bestaande
`contracten-bronkolommen-070.json`-diagnose-uitvoer, 197 rijen): het RUWE
`contracten_huidig`-bestand bevat, nog ongemodelleerd, een uitgebreide
waarborg-/indexeringsstructuur — `Waarborgsom` (197/197 gevuld, direct
naamsmatch met het FO-veld), `Waarborg_niet_geprolongeerd`,
`Waarborgbeheer`, `Bankgarantie_*` (alternatieve zekerheidsvorm),
`Complexomschrijving` (197/197 gevuld — een leesbare complexnaam bestaat
dus wél, eerder onterecht als "ontbrekend" gerapporteerd),
`Datum_laatst_geprolongreerd`/`Jaar_laatst_geprolongreerd`/
`Periode_laatst_geprolongreerd` (kandidaat voor "laatste huurverhoging"),
en `Verhoging_datum`/`Verhoging_Jaar_vlgd`/`Verhoging_Periode_vlgd`/
`Verhoging_percentage`/`Verhoging_methode`/`Omschrijving_indextabel`
(kandidaat voor "indexeringsdatum"). Geen van deze kandidaten is
semantisch bevestigd — "prolongatie" kan een breder begrip zijn dan
"huurverhoging"; de diagnose toont de ruwe waarden zodat dat per contract
te beoordelen is.

**Wat de diagnose toont per contract** (`ChdRegel`): de gecachte
`contracten`-regel; alle gecachte `rentroll`-regels (0..n, één per
Vorderingsoort — geen optelling/classificatie); alle bovenstaande
ruwe/ongemodelleerde contracten-kolommen, rechtstreeks uit het bronbestand
gelezen (geen schema/cache-wijziging: dezelfde raw-read-techniek als
`contracten-bronkolommen`); alle `ouderdomsanalyse`-regels op het
huurdernummer van dit contract, over alle in de cache aanwezige
boekjaar/boekperiodes (test van de openstaand-saldo-koppeling — bestaat
en is gecached, maar nooit eerder tegen echte huurdernummer-waarden
gecontroleerd); en — uitsluitend als de aanroeper `--boekjaar`/
`--periodeTotEnMet` opgeeft — de geboekte servicekostenvoorschotten uit
`genereerServicekostenPositie`'s A-sectie (`voorschottenPerContractHuurder`,
ongewijzigd hergebruikt, `doelrekeningen: []` zodat alleen A wordt
opgevraagd), expliciet gescheiden getoond van `rentroll.service_voorschot_jaar`
(zie punt 2 hierboven). Overal waar geen deterministische 1-op-1 koppeling
bestaat blijft het een array — nooit een eerste/beste/toevallige match
kiezen (zelfde discipline als `rentrollDiagnose.ts`).

Worker: `genereerContractHuurderDiagnose.ts`. CLI: `bvc-worker
contract-huurder-diagnose <administratieId> [--boekjaar N
--periodeTotEnMet P [--periodeVan P]]` — geen KPI, geen schema/cache-
wijziging, alleen JSON op stdout.

**Tegen de echte 070-cache gedraaid (2026-08-27)** — bevindingen die het
Huurdersoverzicht-ontwerp direct hebben bijgestuurd (zie hieronder):
`Datum_laatst_geprolongreerd` bleek voor alle 12 contracten identiek
(01-08-2026) — een systeembrede batchdatum, GEEN per-contract "laatste
huurverhoging" (kandidaat ingetrokken). `Complexomschrijving` bleek GEEN
1-op-1 relatie met `Complexnummer` te hebben (complexnummer "003" komt
voor met drie verschillende omschrijvingen; "Cuijk 33A" komt voor onder
zowel complexnummer "002" als "003") — nooit een authoritative complexnaam,
uitsluitend een aanduiding. `afloopdatum` bleek 0/12 gevuld terwijl
`expiratie_expiratiedatum` 12/12 gevuld was — laatstgenoemde is daarom de
basis voor contracteinde/status geworden, NIET `bepaalContractGeldigheid`.
`rentroll.Service_voorschot_jaar` bleek voor 11/12 contracten precies het
geboekte periodebedrag × 2 (halfjaarperiode) — sterke, niet-sluitende
aanwijzing dat dit het contractuele jaarvoorschot is.

**Bugfix (2026-08-27): ruwe contractvelden werden op contractnummer
alleen gekoppeld, niet op bedrijfsnr+contractnummer.**
`contracten_huidig.xlsx` is een GEDEELD bronbestand over alle
administraties (`Contract` is uitsluitend uniek binnen een administratie,
zie `contractNatuurlijkeSleutel`'s `bedrijfsnr::contract`-sleutel). De
raw-row-`Map` in `genereerContractHuurderDiagnose.ts` sleutelde
oorspronkelijk alleen op `Contract`, waardoor een botsend contractnummer in
een ANDERE administratie de 070-rij stilzwijgend kon overschrijven — geen
foutmelding, gewoon een plausibel-ogende verkeerde huurdernaam/
Complexomschrijving/Waarborgsom. Ontdekt doordat een `huurdersoverzicht`-
run (cache-gebaseerd, via `rebuildCache.ts`'s bedrijfsnr-filter altijd
correct) voor drie contracten (0000000048/0000000051/0000000052) afweek
van een eerdere `contract-huurder-diagnose`-run. **`huurdersoverzicht`/
`genereerHuurdersoverzicht.ts` was NOOIT aangetast** — uitsluitend deze
tijdelijke diagnose is gerepareerd: `ruweContractSleutel(bedrijfsnr,
contractnummer)` als verplichte samengestelde sleutel, plus een nieuw,
puur diagnostisch veld `alleRuweRijenMetDitContractnummer` (ALLE ruwe
rijen met dat contractnummer, ongeacht bedrijfsnr) om een botsing direct
zichtbaar te maken. Geregressietest in `contractHuurderDiagnose.test.ts`
("BUGFIX: ...") bevestigt de juiste rij wordt gekozen bij een botsing.

## Huurdersoverzicht v1 (`huurdersoverzicht.ts`, 2026-08-27) — contract-geankerd, eerste rapportonderdeel op basis van `contract-huurder-diagnose`

Eerste contract-geankerde module: **één rij per contract** (nooit per
rentroll-regel, nooit een kunstmatige unittoewijzing). Ontwerp vooraf
expliciet goedgekeurd op basis van de `contract-huurder-diagnose`-run
hierboven. `berekenHuurdersoverzicht(contracten, rentroll)` is puur en
volledig los van `kerncijfersManagement.ts`/`plPeriodeBerekening.ts`/
`balansPeriodeBerekening.ts`/`kasstroomManagementoverzicht.ts` — bewust GEEN
boekjaar/periode, dit is een **momentopname** (`momentopname: true`),
zelfde `bronPeildatum`-conventie als `vastgoedKerncijfers.ts`/
`huurKerncijfers.ts` (alleen gevuld bij eenduidige `rentroll.rapportage_
datum`, anders `null`, opnieuw lokaal gedefinieerd — zelfde precedent).

**Huur/m² per contract — hergebruikt `bepaalContractGeldigheid`
rechtstreeks** (ongewijzigd geïmporteerd uit `huurKerncijfers.ts`) voor de
vraag welke rentroll-regels meetellen — dezelfde functie die het
al-bevestigde portefeuillecijfer oplevert. Vorderingsoort 01/13-
classificatie, geldigheids-/datakwaliteitscontroles zijn één-op-één
gespiegeld aan `huurKerncijfers.ts` (nooit een tweede definitie), plus twee
NIEUWE controles specifiek voor het contract-anker: een rentroll-regel se
complexnummer/unitnummer die afwijkt van het contract se eigen waarde
(WAARSCHUWING).

**Contracteinde/status — NIET `bepaalContractGeldigheid`** (die is
afloopdatum-gebaseerd, bij 070 vrijwel altijd "geldig" omdat `afloopdatum`
zo goed als nooit gevuld is). Nieuwe, aparte functie
`bepaalContracteindeStatus(expiratieExpiratiedatum, peildatum)`:
`restlooptijdDagen = round((expiratie - peildatum) / 86.400.000)`; `< 0`
dagen → `EXPIRATIEDATUM_GEPASSEERD` (WAARSCHUWING — een gepasseerde
expiratiedatum is bewezen GEEN garantie dat het contract beëindigd is, zie
`huurKerncijfers.ts`'s eigen reden om expiratie niet als harde
geldigheidsgrens te gebruiken); `0–364` → `VERLOOPT_BINNENKORT`; `365–729`
→ `AANDACHT`; `≥730` → `GEEN_URGENTIE`; onbekende expiratiedatum →
`ONBEKEND`. `rentroll.contract_expiratiedatum`/`_opzegdatum` dienen
uitsluitend als onafhankelijke reconciliatiecontrole (contracten blijft
leidend voor weergave); een afwijking tussen beide bronnen levert een
WAARSCHUWING op, nooit een stilzwijgende keuze.

**`Complexomschrijving` → `objectomschrijving`** — uitsluitend een
gebruiksvriendelijke aanduiding naast het authoritative `complexnummer`,
ongevalideerd doorgegeven, NOOIT gebruikt voor joins/aggregaties/
reconciliaties. Een afwijkende omschrijving tussen contracten binnen
hetzelfde complex is dus bewust geen reden om cijfers anders te groeperen
(zie de bevinding hierboven bij `contract-huurder-diagnose`).

**Servicekostenvoorschot** — `rentroll.Service_voorschot_jaar`
(contractueel). `servicekostenPositie.ts`'s `voorschottenPerContractHuurder`
(geboekt, periodegebonden) is BEWUST NIET gebruikt/samengevoegd — een
toekomstige reconciliatie tussen beide is een aparte, latere stap.

**Waarborgsom** — `contracten.Waarborgsom`, rechtstreeks doorgegeven
(`Decimal | null`): `0` is een geldige waarde (geen waarborg), `null`
betekent "niet geregistreerd" en levert een INFORMATIEF-melding op — nooit
verward.

**Bewust GEEN velden in v1** (niet als `null`-placeholder, gewoon afwezig
in het type): openstaand saldo/debiteuren (ouderdomsanalyse bestaat en is
gecached, maar de koppeling op huurdernummer is nog niet bewezen — zie
`contract-huurder-diagnose`'s bevindingen; vervolgactie: "ouderdomsanalyse-
bron + koppeling op huurdernummer valideren"); kosten per huurder
(`servicekostenPositie.ts` heeft al bewezen dat het grootste deel van de
werkelijke kosten complexbreed is, geen bewezen verdeelsleutel); "laatste
huurverhoging" (kandidaatveld `Datum_laatst_geprolongreerd` ingetrokken,
zie hierboven — blijft "nog niet vastgesteld").

**Schema/cache (2026-08-27)** — `ContractBronSchema`/`GestaagdContract`
uitgebreid met `Waarborgsom`, `Complexomschrijving`, `Verhoging_datum`,
`Verhoging_Jaar_vlgd`/`_Periode_vlgd`, `Verhoging_percentage`,
`Verhoging_methode`, `Omschrijving_indextabel`. De `contracten`-cachetabel
kreeg dezelfde velden plus `huurder_naam` (structureel gewired — dit was
sinds de huurdernaam-toevoeging aan het managementrapport bewust nog niet
gebeurd, zie eerdere onderzoeksronde). Een cache die vóór deze datum is
gebouwd mist deze kolommen; `rebuild-cache` opnieuw draaien is verplicht.

Worker: `genereerHuurdersoverzicht.ts` (`SELECT * FROM contracten`/
`rentroll`, zelfde ongefilterde patroon als `genereerHuurKerncijfers.ts`).
CLI: `bvc-worker huurdersoverzicht <administratieId>` — momentopname, geen
`--boekjaar`/`--periodeTotEnMet`, JSON op stdout. Nog GEEN renderer, nog
NIET gekoppeld aan `management-rapport`.

### Regressiepunt: 070_Rooise_Zoom Huurdersoverzicht (in-repo, 2026-08-27)

Twee regressietests — één puur (`huurdersoverzicht.test.ts`, met
lokaal-geconstrueerde `HoContractRegel`/`HoRentrollRegel`-invoer) en één
volledige pijplijn (`genereerHuurdersoverzicht.test.ts`, echte
xlsx→cache→worker-route, incl. de nieuwe contracten-kolommen) — gebruiken
de EXACTE cijfers van alle 12 echte 070-contracten uit de
`contract-huurder-diagnose`-run hierboven. Beide bevestigen dat de som
over de 12 contractregels exact aansluit op het al-bevestigde
huur-kerncijfers-regressiepunt: bruto jaarhuur € 687.900,88,
huurkortingen € 13.920,00, netto jaarhuur € 673.980,88, verhuurde VVO
6.589,5 m². Contract `0000000043` (zonder unitnummer) blijft in beide
tests expliciet `unitnummer: null`. Dit is nog GEEN vervanging van de
verplichte, door de gebruiker persoonlijk gedraaide 070-regressie tegen de
levende cache (zelfde discipline als elke eerdere module) — dat volgt
zodra `huurdersoverzicht 070_Rooise_Zoom` na een `rebuild-cache` is
gedraaid.

**Update (2026-08-27): het inmiddels bevestigde `contract-huurder-
diagnose`-cijfermateriaal voor 070 bleek voor drie contracten
(0000000048/0000000051/0000000052) af te wijken van een botsend
contractnummer uit een andere administratie — een bug in de TIJDELIJKE
diagnose (zie de bugfix-paragraaf hierboven), niet in
`huurdersoverzicht`/`genereerHuurdersoverzicht.ts`. De v2-herrun van
`contract-huurder-diagnose` (na de bugfix) bevestigt dat
`huurdersoverzicht`'s cache-gebaseerde output voor alle 12 contracten al
correct was — inclusief deze drie.**

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
| 05 | Servicekosten (incl. stijgers/dalers, signaalbadges) | `renderServicekosten` | ~1859 | rekenlaag gebouwd (`servicekostenPositie.ts`, zie sectie hierboven — actuele positie/afrekening voorgaand jaar/grootboekreconciliatie, regressiepunt 070 bevestigd) — renderer en koppeling aan management-rapport nog te bouwen |
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
