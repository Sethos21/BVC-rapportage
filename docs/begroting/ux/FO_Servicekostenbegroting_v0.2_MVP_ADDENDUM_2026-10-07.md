# FO Servicekostenbegroting v0.2 — MVP-addendum begrotingsinvoer en managementrapportage

## Status en doel

Status: **vastgesteld functioneel MVP-besluit**  
Datum: **7 oktober 2026**  
Hoofddocument: `FO_Servicekostenbegroting_v0.2`  

Dit document is een addendum op het volledige functionele ontwerp en vervangt dat ontwerp niet. Het legt een bewust vereenvoudigde eerste bouwfase vast waarmee BVC snel een servicekostenbegroting kan invoeren en de managementrapportage kan genereren.

Het hoofddocument blijft de toekomstgerichte ontwerpbron. Voor de MVP-implementatie heeft dit addendum voorrang waar het de scope uit het hoofddocument expliciet beperkt. Alle generieke begrotingsregels uit de actuele contractset blijven gelden, tenzij dit addendum daarvan uitdrukkelijk afwijkt.

Het uitgangspunt van de MVP is dat de inhoudelijke servicekostenbegroting al buiten de applicatie kan zijn opgesteld. De applicatie ondersteunt daarom eenvoudige handmatige invoer, kwartaalverdeling, vergelijking met realisatie en rapportage. Zij bouwt in deze fase geen volledige calculatie- of verdeelmachine.

---

## 1. Leidende MVP-scope

### SK-MVP-001 — Eén begroting per administratie en jaar

De gebruiker maakt één servicekostenbegroting per administratie en begrotingsjaar. De begroting wordt uitsluitend op administratieniveau ingevoerd.

### SK-MVP-002 — Jaarbedragen per kostensoort

De gebruiker voert per bestaande kostensoort eerst het begrotingsbedrag voor het volledige jaar in. Er wordt in de MVP geen nieuwe kostensoort aangemaakt.

### SK-MVP-003 — Geen Estimated Full Year

De servicekosten-MVP bevat geen Estimated Full Year, geen extrapolatie en geen automatische prognose. De rapportage vergelijkt gerealiseerde bedragen rechtstreeks met het relevante cumulatieve deel van de begroting.

### SK-MVP-004 — Geen begroting per complex

De begroting wordt niet over complexen verdeeld en er worden geen begrote complexbedragen opgeslagen. Een complexoverzicht blijft wel beschikbaar voor gerealiseerde kosten, gerealiseerde voorschotten en het gerealiseerde saldo.

### SK-MVP-005 — Geen automatische begrotingscalculatie

De MVP berekent geen begroting uit contracten, units, leegstand, historische complexverdelingen of verdeelsleutels. Deze gegevens kunnen later binnen het volledige FO worden toegevoegd, maar blokkeren de MVP niet.

### SK-MVP-006 — Bedragen en perioden

Begrotingsbedragen worden in euro’s vastgelegd. Het begrotingsjaar is een volledig jaar en gebruikt uitsluitend perioden 1 tot en met 12. De bestaande uitsluiting van kostensoort 9600 uit de servicekostenpositie blijft ongewijzigd van kracht.

---

## 2. Starten en referentiewaarden

### SK-MVP-007 — Referentie bij het invoeren

Bij het opstellen van een begroting toont het invoerscherm per kostensoort drie jaargangen naast elkaar:

1. de realisatie van het vorige volledige jaar;
2. de realisatie van het lopende jaar tot en met een gekozen periode;
3. de handmatig in te voeren begroting voor het nieuwe volledige jaar.

Voorbeeld bij begrotingsjaar 2027:

| Kolom | Inhoud |
|---|---|
| Realisatie 2025 | volledig jaar, perioden 1–12 |
| Realisatie 2026 | perioden 1 tot en met de gekozen realisatieperiode |
| Begroting 2027 | handmatige invoer volledig jaar |

De referentiejaren ondersteunen de invoer, maar worden geen onderdeel van het opgeslagen begrotingsbedrag.

### SK-MVP-008 — Keuze realisatieperiode

De gebruiker kiest voorafgaand aan of tijdens de invoer tot en met welke periode de actuele realisatie wordt getoond. Geldige waarden zijn 1 tot en met 12. De gekozen periode staat duidelijk in de schermkop.

### SK-MVP-009 — Wijzigen realisatieperiode

Het wijzigen van de realisatieperiode ververst uitsluitend de getoonde actuele realisatie. Reeds ingevoerde jaar- en kwartaalbegrotingen veranderen daardoor nooit.

---

## 3. Jaarbedrag en kwartaalverdeling

### SK-MVP-010 — Jaarbedrag eerst

De gebruiker voert altijd eerst het volledige jaarbedrag in. Daarna maakt de applicatie de kwartaalverdeling beschikbaar.

### SK-MVP-011 — Eerste voorstel gelijkmatig

Na invoer van een jaarbedrag verdeelt de applicatie dit bedrag als voorstel gelijkmatig over Q1 tot en met Q4. Een afrondingsverschil wordt in Q4 verwerkt, zodat het voorstel exact aansluit op het jaarbedrag.

### SK-MVP-012 — Handmatige kwartaalwijziging

Ieder kwartaalbedrag is handmatig aanpasbaar. Na een handmatige wijziging worden de andere kwartalen niet stilzwijgend herberekend. De gebruiker past de overige kwartalen zelf aan of kiest opnieuw bewust voor gelijkmatig verdelen.

### SK-MVP-013 — Aansluitingscontrole

Per kostensoort geldt:

`Q1 + Q2 + Q3 + Q4 = begroting volledig jaar`

Bij een verschil toont de applicatie het exacte ontbrekende of te veel verdeelde bedrag. Een niet-aansluitende regel mag tussentijds als concept worden opgeslagen, maar blokkeert definitief maken.

Voorbeeld: bij een jaarbedrag van € 40.000 is het eerste voorstel viermaal € 10.000. Wijzigt de gebruiker Q1 naar € 25.000 en laat hij de andere kwartalen staan, dan is € 55.000 verdeeld. De applicatie meldt dat € 15.000 te veel is verdeeld; zij past geen ander kwartaal automatisch aan.

### SK-MVP-014 — Lege regel, nul en deelname aan totalen

Een lege begrotingsregel betekent dat de kostensoort nog niet is gebruikt. Een expliciet ingevoerde `0` is een geldige begrotingswaarde en is niet hetzelfde als leeg.

Alleen regels met een opgeslagen numerieke begrotingswaarde tellen mee in begrotings- en controletotalen. Lege regels blokkeren conceptopslag of definitief maken niet. Er wordt in deze MVP geen verplichte NTB-, NVT- of andere statuscode per kostensoort ingevoerd.

---

## 4. Kostengroepen en zichtbaarheid

### SK-MVP-015 — Groepen per administratie

De gebruiker kan per administratie presentatiegroepen maken, hernoemen, verwijderen en in volgorde plaatsen. Aan een groep worden bestaande kostensoorten gekoppeld. Het groepssubtotaal wordt automatisch berekend.

### SK-MVP-016 — Eén groep per kostensoort

Een kostensoort kan binnen een administratie op hetzelfde moment aan maximaal één groep zijn toegewezen. Reeds toegewezen kostensoorten zijn bij andere groepen niet opnieuw selecteerbaar. Niet-toegewezen kostensoorten verschijnen onder `Niet ingedeeld`.

### SK-MVP-017 — Groepsindeling bewaren en wijzigen

De groepsindeling wordt per administratie bewaard en mag later worden gewijzigd. De actuele groepsindeling wordt gebruikt voor de vergelijking van begroting en realisatie, inclusief eerdere jaren. Een wijziging herberekent alleen de presentatiesubtotalen en wijzigt geen opgeslagen bron- of begrotingsbedragen.

### SK-MVP-018 — Kostensoorten verbergen

Een kostensoort mag handmatig worden verborgen wanneer alle drie de relevante waarden nul of leeg zijn:

- realisatie vorig volledig jaar;
- realisatie lopend jaar tot en met de gekozen periode;
- nieuwe jaarbegroting.

Verbergen is uitsluitend presentatiegedrag en verwijdert geen gegevens. Als een verborgen kostensoort later een realisatie- of begrotingswaarde krijgt, verschijnt deze automatisch opnieuw. Verborgen regels blijven via de weergave-instellingen terug te vinden.

---

## 5. Begrote voorschotten

### SK-MVP-019 — Eén gecombineerd voorschottenbedrag

Naast de kosten voert de gebruiker één gecombineerd begrotingsbedrag voor service- en stookkostenvoorschotten in. De MVP splitst dit bedrag niet naar huurder, leegstand, complex, unit, contract of soort voorschot.

### SK-MVP-020 — Dezelfde kwartaalwerking

Voor het begrote voorschottenbedrag geldt dezelfde werkwijze als voor kosten: eerst een volledig jaarbedrag, daarna een gelijkmatig kwartaalvoorstel, handmatig aanpasbare kwartalen en de verplichte aansluiting van de kwartaalsom op het jaarbedrag voordat de begroting definitief kan worden gemaakt.

### SK-MVP-021 — Bronteken van gerealiseerde voorschotten

De brondata blijft ongewijzigd en behoudt haar oorspronkelijke debet-/creditteken. Alleen aantoonbaar als service- of stookkostenvoorschot geclassificeerde realisatieboekingen worden voor de managementpresentatie genormaliseerd.

Voor de presentatie geldt:

`getoonde gerealiseerde voorschotten = -1 × som van de geclassificeerde bronboekingen`

Er wordt nadrukkelijk geen absolute waarde gebruikt. Daardoor blijven correcties, terugboekingen en een eventueel tegengesteld netsaldo financieel correct. Het begrote voorschottenbedrag wordt als positief businessbedrag ingevoerd.

### SK-MVP-022 — Saldoformule

Voor begroting en realisatie geldt dezelfde betekenis:

`servicekostensaldo = voorschotten - kosten`

- positief: voorschotoverschot;
- negatief: tekort, omdat de kosten hoger zijn dan de voorschotten.

De rapportage toont voorschotten daarom als positieve inkomstenpositie na de gecontroleerde tekennormalisatie.

---

## 6. Managementrapportage

### SK-MVP-023 — Invoer en rapportage zijn verschillende weergaven

Het invoerscherm toont historische realisatie als hulpmiddel voor het maken van de begroting. De managementrapportage vergelijkt de realisatie van het rapportagejaar met de begroting van datzelfde jaar. De realisatie van het vorige jaar wordt niet als extra kolom in de managementrapportage opgenomen.

### SK-MVP-024 — Cumulatieve kwartaalvergelijking

De kwartaalrapportage vergelijkt cumulatieve realisatie met cumulatieve begroting:

| Rapportagemoment | Realisatie | Cumulatieve begroting |
|---|---|---|
| Q1 | periode 1–3 | Q1 |
| Q2 | periode 1–6 | Q1 + Q2 |
| Q3 | periode 1–9 | Q1 + Q2 + Q3 |
| Q4 | periode 1–12 | Q1 + Q2 + Q3 + Q4 |

De volledige jaarbegroting blijft daarnaast als afzonderlijke kolom zichtbaar.

### SK-MVP-025 — Detailvergelijking

Per kostensoort toont de managementrapportage minimaal:

- cumulatieve realisatie;
- cumulatieve begroting;
- afwijking in euro’s;
- afwijking in procenten;
- begroting volledig jaar.

Dezelfde vergelijkingskolommen gelden voor groepssubtotalen, totale kosten, voorschotten en het servicekostensaldo.

De afwijking in euro’s wordt voor kosten als `cumulatieve begroting - cumulatieve realisatie` gepresenteerd, zodat een overschrijding negatief zichtbaar wordt. Voor voorschotten en het saldo volgt de afwijking dezelfde economische richting als de saldo-opbouw. De rekenlaag levert deze betekenissen centraal aan; scherm en PDF bevatten geen eigen variant.

Als de vergelijkingsbasis nul is, toont de procentkolom geen misleidend percentage maar een neutrale aanduiding, bijvoorbeeld `—`.

### SK-MVP-026 — Administratieniveau met werkelijke complexspecificatie

Omdat de MVP geen begroting per complex vastlegt, vindt de vergelijking realisatie versus begroting uitsluitend plaats op administratieniveau, per groep en kostensoort. De applicatie verdeelt de administratiebegroting niet kunstmatig over complexen.

Het complexoverzicht blijft een werkelijke specificatie en toont per complex naast elkaar:

- gerealiseerde kosten;
- gerealiseerde voorschotten;
- gerealiseerd saldo.

### SK-MVP-027 — Opbouw van het rapport

De bestaande compacte servicekostenoverzichtspagina in het managementrapport blijft behouden en wordt uitgebreid met de begrotingsvergelijking op administratieniveau. Direct daarna volgt een specificatiepagina met de groepen, kostensoorten en de kolommen uit SK-MVP-025.

De complexspecificatie blijft onderdeel van de rapportage, maar bevat in de MVP geen begrote complexkolommen. De schermweergave en PDF gebruiken dezelfde centrale rekenuitkomst.

---

## 7. Concept, definitief en hergebruik generieke infrastructuur

### SK-MVP-028 — Concept is tussentijds bewerkbaar

Een begroting kan onvolledig als concept worden opgeslagen en later worden hervat. Automatisch tussentijds opslaan en de expliciete actie `Concept opslaan` volgen de generieke begrotingsinfrastructuur.

### SK-MVP-029 — Definitief maken

Beheerder en Financieel medewerker mogen een begroting definitief maken. Definitief maken is alleen toegestaan wanneer alle gebruikte numerieke begrotingsregels en het voorschottenbedrag per regel op de kwartalen aansluiten.

Een definitieve begroting is alleen-lezen. Een latere inhoudelijke wijziging wordt in een nieuwe versie vastgelegd. Er wordt voor de servicekosten-MVP geen afwijkend versiebeheer gebouwd.

### SK-MVP-030 — Geen dubbele technische variant

De MVP hergebruikt de bestaande generieke voorzieningen voor conceptstatus, autosave, handmatig opslaan, exclusief bewerken, overname na inactiviteit, definitief maken en versiebeheer. Deze voorzieningen worden niet opnieuw als servicekostenspecifieke workflow geïmplementeerd.

---

## 8. Expliciet buiten de MVP

De volgende onderdelen uit het volledige FO blijven toekomstscope en worden niet gebouwd als voorwaarde voor deze MVP:

- begrotingsinvoer of -verdeling per complex;
- `NTB/onverdeeld` als complexverdeling;
- automatische verdeling op basis van historie of verdeelsleutels;
- begroting per unit, huurder of contract;
- afzonderlijke huurders- en leegstandsvoorschotten;
- contract- of prijsregelprognoses;
- leegstandsprolongatie in de begroting;
- Estimated Full Year en naar-rato-extrapolatie;
- voorstel voor nieuwe voorschotten per complex, unit of huurder;
- individuele servicekostenafrekening;
- automatische mutatie van contracten of prijsregels.

Deze scopebeperking verwijdert de betreffende ontwerpkeuzes niet uit `FO_Servicekostenbegroting_v0.2`. Zij worden alleen uitgesteld totdat BVC na de MVP bewust een volgende bouwfase opent.

---

## 9. Minimale acceptatiecriteria

De MVP is functioneel acceptabel wanneer ten minste de volgende situaties reproduceerbaar werken:

1. Voor begrotingsjaar 2027 toont het invoerscherm realisatie 2025 volledig, realisatie 2026 tot en met een gekozen periode en een lege invoerkolom voor 2027.
2. Wijzigen van de realisatieperiode wijzigt geen opgeslagen begrotingswaarde.
3. Een jaarbedrag van € 40.000 levert aanvankelijk vier aansluitende kwartalen op en blijft daarna volledig handmatig aanpasbaar.
4. Een verschil tussen jaarbedrag en kwartaalsom toont het exacte verschil, kan in concept blijven staan en blokkeert definitief maken.
5. Een kostensoort kan niet gelijktijdig aan twee groepen worden gekoppeld.
6. Een verborgen nulregel verschijnt automatisch terug zodra realisatie of begroting niet langer nul/leeg is.
7. Gerealiseerde voorschotten met een creditteken worden zonder bronmutatie positief gepresenteerd via tekeninversie; correcties blijven in het netsaldo behouden.
8. Bij voorschotten van € 113.330 en kosten van € 91.178 toont het saldo € 22.152 positief.
9. Een Q2-rapport vergelijkt realisatie periode 1–6 met begroting Q1+Q2 en toont daarnaast de volledige jaarbegroting.
10. De rapportage toont geen kunstmatig toegerekende begroting per complex, maar wel gerealiseerde kosten, voorschotten en saldo per complex.

---

## 10. Implementatie-instructie

Voor de bouw geldt de actuele repositoryhiërarchie en contractset in `docs/begroting/`. Dit addendum is de leidende functionele scope voor de servicekosten-MVP. Bij een technisch of functioneel conflict wordt geen businesslogica stilzwijgend ingevuld: het conflict wordt expliciet als `CONTRACTCONFLICT` of `BUSINESSBESLISSING` teruggelegd.

De implementatie moet bronbedragen, tekennormalisatie, begrotingsinvoer, kwartaalverdeling, groepering en rapportageberekeningen centraal en testbaar houden. UI en PDF presenteren dezelfde uitkomst en mogen geen eigen financiële formule introduceren.
