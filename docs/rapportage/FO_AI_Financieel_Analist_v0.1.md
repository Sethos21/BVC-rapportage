# FO — BVC AI Financieel Analist
**Versie:** 0.1 (concept)  
**Datum:** 8 oktober 2026  
**Status:** functioneel ontwerp ter latere uitwerking; **geen implementatieopdracht**  
**Project:** BVC Financiële Rapportage Tool

## 1. Doel
Een optionele AI-ondersteunde onderzoeksfunctie die opvallende financiële afwijkingen signaleert en de beheerder in staat stelt **zelf te kiezen** welke afwijkingen diepgaand onderzocht worden. Het onderzoek gebruikt controleerbare bronboekingen en andere relevante administratiegegevens. Uitkomsten kunnen na menselijke beoordeling worden verwerkt als toelichting in de managementrapportage.

## 2. Vastgestelde uitgangspunten
1. **Eerst signaleren, daarna selecteert de beheerder.** De AI start geen ongevraagd diepgaand onderzoek naar alle afwijkingen.
2. De bestaande BVC-rekenkern blijft de enige autoriteit voor financiële bedragen, classificaties en rapportage-KPI's. AI berekent geen officiële cijfers.
3. Bij geselecteerde afwijkingen kan AI gericht onderliggende boekingen, grootboekrekeningen, omschrijvingen, leveranciers, complexen en relevante aanvullende bronnen onderzoeken, voor zover deze velden daadwerkelijk beschikbaar zijn.
4. AI levert een **onderbouwd voorstel** voor een toelichting; de beheerder beoordeelt, corrigeert en keurt goed voordat de tekst in een eigenaarsrapport verschijnt.
5. Beheerder kan ook zelf een vrije onderzoeksvraag stellen, buiten de automatisch gesignaleerde posten.
6. De financiële brongegevens en mappings worden nooit door AI gewijzigd.
7. De eigenaarsrapportage en het interne financiële controleverslag blijven gescheiden.
8. De huidige Q3-rapportageontwikkeling wordt niet onderbroken of gewijzigd door dit FO.

## 3. Scope
**In scope (toekomstig):**
- Signalering van opvallende verschillen in onder meer huurinkomsten, onderhoudskosten, nutsvoorzieningen, servicekosten en overige resultatenposten.
- Vergelijking huidige periode versus overeenkomstige periode vorig jaar; begroting alleen als een relevante begroting betrouwbaar/vastgesteld en beschikbaar is.
- Selectie van één of meerdere signalen voor verdiepend onderzoek.
- Onderzoek op boekingsniveau met bronverwijzingen, uitsplitsingen en reconciliatie naar de officiële rapportagepost.
- Concepttoelichtingen, bewerkbare tekst, akkoordstatus en opname in rapportversies.
- Handmatige onderzoeksvragen door bevoegde gebruikers.

**Buiten scope voor deze versie:** automatische boekingscorrecties, grootboekmappingwijzigingen, zelfstandig goedkeuren/publiceren, automatische prognoses, aanpassingen aan begrotingsmodules en volledig autonoom onderzoek van alle afwijkingen.

## 4. Gebruikersproces
1. Gebruiker kiest administratie, boekjaar, verslagperiode en rapporttype.
2. Bestaande rapportageketen produceert gevalideerde cijfers en controlemeldingen.
3. Signaleringslaag toont per post de periode, vergelijkingsbasis, absoluut en procentueel verschil, ernst/reden van signalering en eventuele datakwaliteitsbeperking.
4. Beheerder vinkt relevante signalen aan of stelt zelf een onderzoeksvraag.
5. AI stelt via uitsluitend **read-only, gecontroleerde BVC-functies** vervolgvragen aan de beschikbare data.
6. Onderzoeksresultaat toont bevindingen, bedragen, periode, complex/leverancier waar mogelijk, onderliggende boekingsreferenties, reconciliatie en onzekerheden.
7. AI maakt een concept-managementtoelichting. De beheerder kan feiten aanvullen, tekst aanpassen, afwijzen of goedkeuren.
8. Alleen goedgekeurde toelichtingen worden in een vrij te geven eigenaarsrapport opgenomen. Openstaande technische controles blijven in het interne controleverslag; materiële onzekerheden worden niet verhuld.

## 5. Functionele eisen
| ID | Eis |
|---|---|
| SIG-01 | Signalering op basis van officiële BVC-uitkomsten, zonder AI-herberekening van rapporttotalen. |
| SIG-02 | Zowel absolute als relatieve afwijkingen zichtbaar; drempels later instelbaar. |
| SIG-03 | Gebruiker kiest expliciet welke signalen onderzocht worden. |
| SIG-04 | Signalen zonder betrouwbare vergelijkingsbasis worden als zodanig gemarkeerd. |
| OND-01 | Read-only drilldown van rapportpost naar grootboek en individuele bronboekingen. |
| OND-02 | Analyse kan waar data dit ondersteunt per leverancier, complex, periode en boekingsomschrijving uitsplitsen. |
| OND-03 | Elke kwantitatieve conclusie is terug te voeren op concrete bronregels en de officiële rapportagepost. |
| OND-04 | Onderscheid tussen bewezen boekingsfeiten, aannemelijke interpretaties en onbewezen oorzaken. |
| OND-05 | Vrije onderzoeksvraag door beheerder met dezelfde toegangs- en bronrestricties. |
| TXT-01 | AI stelt toelichting voor zonder oorzaken te verzinnen. |
| TXT-02 | Beheerder kan toelichting wijzigen, aanvullen, opnieuw laten formuleren, afwijzen en goedkeuren. |
| TXT-03 | Goedgekeurde tekst is gekoppeld aan administratie, periode, rapportversie en relevante bron-/analysesnapshot. |
| TXT-04 | Nieuwe generatie overschrijft bestaande goedgekeurde tekst niet. |
| TXT-05 | Rapport kan zonder AI worden gegenereerd, met handmatige of geen toelichting. |
| CTL-01 | Technische controlemeldingen worden niet stilzwijgend genegeerd of verwijderd. |
| CTL-02 | Onderzoek en AI-gebruik zijn controleerbaar via auditlog (vraag, bronnen, resultaat, bewerking, akkoord). |

## 6. Voorbeeld: onderhoud installaties
Een resultatenpost wijkt materieel af ten opzichte van vorig jaar. De signaleringslaag toont het verschil zonder verklaring. De beheerder selecteert **Onderzoeken**. De AI vraagt de bijbehorende grootboek- en boekingsregels over beide perioden op, groepeert waar mogelijk naar leverancier/complex en signaleert relevante grote posten of correcties. Een toelichting mag een eenmalige vervanging alleen als oorzaak noemen wanneer de beschikbare boekingsgegevens of door de beheerder bevestigde informatie dat ondersteunen. Anders luidt de conclusie dat de oorzaak nog niet is vastgesteld.

## 7. Voorgestelde systeemgrenzen (nog technisch te toetsen)
- **Bestaande financiële kern:** officiële P&L, balans, kasstroom, huur, vastgoed en servicekosten, inclusief goedgekeurde mappings.
- **Signaleringsservice:** deterministische vergelijking van gevalideerde uitkomsten; drempelconfiguratie.
- **Onderzoeksinterface:** afgeschermde, alleen-lezen queryfuncties; autorisatie per administratie; limieten op dataomvang, tijdsvenster en aantallen boekingen.
- **AI-orchestratie:** optionele provider via API; selecteert toegestane onderzoekstools en formuleert tekst; geen directe vrije SQL/Excel-schrijfbevoegdheid.
- **Review- en rapportlaag:** toelichtingen met versie-/akkoordstatus; gescheiden eigenaar- en intern rapport.

Dit is een **functionele richting**, geen vastgestelde technische architectuur. Bestaande Worker-, SQLite-, cache- en rapportagefuncties moeten vóór implementatie worden geïnventariseerd en hergebruikt.

## 8. Betrouwbaarheid, beveiliging en privacy
- Administratiescheiding en gebruikersautorisatie gelden voor iedere bronaanroep.
- AI heeft geen schrijfbevoegdheid op boekingen, bron-Excel, cache, mappings of financiële resultaten.
- Bronreferenties zijn traceerbaar; geen gefingeerde leveranciers, facturen of verklaringen.
- Geen conclusie op basis van onvolledige/ongemapte cijfers zonder expliciete waarschuwing.
- Alleen noodzakelijke gegevens naar een externe AI-provider; persoonsgegevens en contractgevoelige data minimaliseren, maskeren waar mogelijk.
- Providerkeuze, verwerkersafspraken, bewaartermijnen, kostenlimieten en toegangslogging vóór productie beoordelen.
- Mislukte AI-aanroep blokkeert het genereren van een cijfermatig rapport niet.
- Conceptteksten zijn geen financieel goedgekeurde bevindingen.

## 9. Acceptatiecriteria (voor latere bouw)
1. Een afwijking wordt getoond zonder dat automatisch een diepgaand AI-onderzoek start.
2. Onderzoek start pas na expliciete selectie of handmatige vraag.
3. Een onderzoek kan van rapportpost naar onderliggende boekingsregels navigeren en bedragen aantoonbaar aansluiten.
4. Onvoldoende bewijs leidt tot een gemarkeerde onzekerheid, niet tot een verzonnen oorzaak.
5. Alleen door de beheerder goedgekeurde tekst komt in een definitieve eigenaarsrapportage.
6. Bestaande H1/Q3-regressies en financiële berekeningen blijven ongewijzigd.
7. Zonder beschikbare AI-provider blijft rapportgeneratie functioneren.
8. Het interne controleoverzicht blijft volledig, onafhankelijk van de eigenaarsrapportage.

## 10. Later te besluiten — geen vragen nu
- Welke signaleringsdrempels per kostensoort/administratie en welke prioritering?
- Welke bronvelden voor leveranciers, facturen, complexen en omschrijvingen zijn daadwerkelijk betrouwbaar beschikbaar?
- Welke onderzoeksfuncties bestaan al en welke ontbreken?
- Welke AI-provider/API, kostenplafonds, privacy- en autorisatie-inrichting?
- Welke reviewrollen en precieze goedkeuringsworkflow?
- Hoe wordt de analysesnapshot opgeslagen en bij latere bronverversingen herleid?
- Hoe worden boekingsreferenties en drilldown in HTML/PDF gepresenteerd?

## 11. Fasering
**Nu:** FO vastleggen; geen codewijziging. Q3-managementrapportage V2 blijft prioriteit.  
**Later fase A:** bestaande bronnen en read-only onderzoeksfuncties inventariseren, signalering ontwerpen.  
**Later fase B:** selectieve AI-drilldown en bewijsvoering bouwen.  
**Later fase C:** toelichtingeneditor, versiebeheer en rapportintegratie testen en vrijgeven.
