# BEGROTING_MASTER_CONTRACT

Status: leidend uitvoeringscontract voor de Exploitatiebegroting  
Bijgewerkt: 30 september 2026  
Repository: `Sethos21/BVC-rapportage`

## 1. Bron van waarheid

Vanaf 29-09-2026 is de contractset in deze repository de leidende bouwwaarheid voor de begrotingsmodule.

Volgorde:
1. FO + addendum;
2. vastgestelde UX-documentatie in `docs/begroting/ux/` (overgedragen in commit `5379798`);
3. expliciet later geaccepteerde business-/architectuurbesluiten in deze contractset;
4. bewezen technische architectuur;
5. code.

Google Drive blijft projectarchief/bronmateriaal, maar een oudere Drive-kopie overschrijft deze GitHub-contractset niet. Bij echte strijd: `CONTRACTCONFLICT`.

De vastgestelde UX-set is vanaf commit `5379798` rechtstreeks in GitHub beschikbaar. Leidende UX-bronnen: `ux/FO_Exploitatiebegroting_v1.0.md`, het addendum en `ux/09_Begrotingsmodule_UX_Vastgesteld.md`. `ux/10_Begrotingsmodule_UX_Ontwerpen_Index.md`, de 13 ontwerpen en `ux/prototype/` zijn visuele/interactiereferentie en introduceren geen zelfstandige businesslogica. Latere expliciete besluiten in dit Master Contract hebben voorrang. Canon/Erfpacht blijft HOLD ondanks het aanwezige UX-ontwerp.

## 2. Harde invarianten

- EUR; bestaande Decimal/money-conventies; geen floating-point businesslogica.
- null/onbekend ≠ €0; bewust €0 is expliciet geldig.
- bronfeiten en aannames gescheiden.
- rekenen in rekenlaag, niet renderer.
- GL is leidend bron-hoofddomein; OGB is verfijning.
- stabiele codes/IDs, geen vrije-tekstclassificatie.
- geen hardcoded administratie 070 als generieke waarheid.
- geen kunstmatige Actual-verdeling of verzonnen CAPEX-classificatie.
- Actual exact één keer.
- vastgestelde Budget-versie immutable; Estimated muteert Budget niet.
- geaccepteerde fases niet heropenen zonder concrete regressie/contractconflict.

## 3. Lifecycle en Estimated

Flow: Nieuwe begroting → invullen → controleren → vaststellen → terugkijken.

Generiek: `Estimated = Werkelijk t/m afgesloten periode + verwachting resterende periode`.

De module bepaalt hoe resterende verwachting wordt opgebouwd. Als dat niet contractueel is vastgesteld: `BUSINESSBESLISSING`.

## 4. P&L-canon

Boven EBITDA: Huuropbrengst belast/onbelast; huurkorting zichtbaar in netto-opbouw; Beheersvergoeding; Managementvergoeding; Onderhoud; Leegstandskosten; Verzekeringen; Gemeentelijke lasten pand; Niet verrekenbare BTW; Accountantkosten; Juridische kosten; Makelaar- en taxatiekosten; Overige algemene kosten; Bankkosten. EBITDA is afgeleid.

Onder EBITDA: Rente leningen; Opbrengst rente; Verkoopresultaat; Zonnestroom waar van toepassing. Herwaardering/Goodwill standaard verborgen.

Canon/Erfpacht is expliciet HOLD/uit scope.

## 5. Geaccepteerde implementatiestand

Geaccepteerde tranche-HEADs:
- Tranche 4: `d77b90e`.
- Tranche 5: `44a9731`.
- Tranche 6: `650607f`.
- Tranche 7: `de2ae0e`.
- Tranche 8: `5125289`.
- **Tranche 9: `cda3baf` — TECHNISCH VOLLEDIG GESLOTEN 29-09-2026.**
- **Tranche 10: `50121a7` — Rente leningen + Opbrengst rente technisch afgerond 29-09-2026.**
- **Tranche 11: `efb6074` — eerste geïntegreerde begrotingswerkomgeving geaccepteerd 30-09-2026.**
- **Tranche 12: `7f09561` — Contracten/RentRoll → frozen Module1Snapshot + Huur/Beheer detailworkflow geaccepteerd 30-09-2026.**
- **Tranche 13: `007e89f` — assemblage bestaande begrotingsmodule geaccepteerd 30-09-2026.**

### Huur
Budget/Werkelijk/Estimated/P&L gereed. Tranche 12 koppelt bewezen Contracten + RentRoll aan `BgContractFeiten[]` en een frozen `Module1Snapshot`; Huur-detail-UX is aangesloten. Voorstel gebruikt contractbasis + algemene indexatie zonder contractoverride; `Jouw begroting` gebruikt de beoordeelde overrides. Estimated gebruikt frozen Budget-contractsnapshot + Actual; refreshed-contract-state forecast is toekomstig werk. Toekomstige kortingswijzigingen uit `contract_prijsregels.xlsx` zijn bronmatig bewezen maar ingestie/kandidaat-resolutie is nog niet gebouwd.

### Beheersvergoeding
Budget/Werkelijk/Estimated/P&L gereed. Tranche 12 sluit de detail-UX aan. **Definitief functioneel besluit, gecorrigeerd na Tranche 13:** Beheersvergoeding bestaat uit het bestaande vaste en variabele deel; het variabele deel wordt berekend als het vastgelegde percentage over de **netto begrote jaarhuur uit Module 1**. Tranche 13 bewijst deze grondslag technisch. Dit besluit hoort bij Beheersvergoeding, niet bij Managementvergoeding.

### Managementvergoeding
Budget/Estimated/P&L gereed; Actual 070 blijft `BRONGAT`. Managementvergoeding blijft conform de bestaande Module-3-systematiek (nieuwe vergoeding / bestaand indexeren / bestaand wijzigen). **Er wordt geen percentage-over-huurmechanisme aan Managementvergoeding toegevoegd.** De eerdere contracttekst die een variabele Managementvergoeding aan netto begrote jaarhuur koppelde was een terminologieverwisseling met Beheersvergoeding en is hierbij ingetrokken.

### Onderhoud
Budget gereed; Actual en Estimated op totaalniveau; Actual nooit splitsen in gepland/correctief. Werkelijk kan boekhouddimensies Gebouwen/Terrein/Installaties behouden.

### Verzekeringen
Budget/Estimated/P&L gereed. Actual module-niveau gereed; per polis geaccepteerd `BRONGAT`.

### Gemeentelijke lasten / WOZ
Budget per relevante GL, Actual, Estimated en P&L gereed. WOZ-voorstel is referentie. Exact één relevante GL: bewuste `Voorstel overnemen`; meerdere GL's: handmatig per GL. Verschil voorstel versus GL-budget is niet-blokkerend. Onbevestigde WOZ-set blokkeert vaststellen.

### Algemene kosten
Budget/Estimated/P&L gereed. 070 Actual: Makelaar/Overige/Bank bewezen; Accountant/Juridisch `BRONGAT`.

### Leegstandskosten
Budget/Estimated/P&L gereed. Na Tranche 9 is Servicekosten leegstand voor de bewezen 070-combinatie ook Actual/P&L gereed. Nuts, Overige en overige niet-bewezen mappings blijven `BRONGAT`.

## 6. HARD BESLUIT §8.10 — cross-domain P&L-presentatie

Een OGB verandert het bron-hoofddomein niet. Een expliciet bewezen combinatie GL+OGB mag via een afzonderlijke expliciete P&L-presentatiemapping economisch onder een andere canonieke P&L-post worden gepresenteerd als broncombinatie en economische betekenis bewezen zijn.

Harde voorwaarden: expliciete mapping; geen omschrijvingsherkenning/fuzzy matching; geen verdeling/schatting; bronboeking niet muteren; uiteindelijke P&L exact één keer.

Bewezen situatie 070:
`GL4350 + OGB4319 → Leegstandskosten → Servicekosten`.

Tranche 9 implementeerde hiervoor een generiek presentatiemechanisme. Bron-hoofddomein blijft Servicekosten eigenaar. Niet heel GL4350 wordt verplaatst. Andere administraties/OGB's erven de mapping niet automatisch. §8.10 is hiermee gesloten.

## 7. Niet verrekenbare BTW — Tranche 9 geaccepteerd

### Budget
- zelfstandige P&L-post boven EBITDA;
- geen automatische btw-pro-rata;
- voorstel op basis van Werkelijk vorig jaar indien betrouwbaar beschikbaar;
- voorstel is informatief en overschrijft handmatige Budget niet;
- handmatige Budgetregels toegestaan;
- bewust €0 geldig;
- ontbrekende historie = onbekend, nooit €0.

### Werkelijk
- uitsluitend bewezen administratiegebonden mapping;
- 070: GL4903 bewezen;
- geen GL-hardcoding in businesslogica;
- zonder bewezen mapping: onbekend.

### Estimated — definitief businessbesluit 29-09-2026
`Estimated Niet verrekenbare BTW = Werkelijk t/m afgesloten periode + handmatig ingevoerde verwachting resterend jaar`.

Regels:
- één handmatig veld/bedrag voor de resterende verwachting op moduleniveau;
- expliciet €0 is geldig;
- leeg/niet ingevuld = onbekend;
- geen automatische extrapolatie;
- niet `Begroting - Werkelijk`;
- niet vorig jaar automatisch doortrekken;
- geen percentage van huur, omzet of kosten;
- geen btw-pro-rata;
- geen maand- of kwartaalverdeling;
- wijziging van de resterende verwachting muteert de vastgestelde Budget niet.

De eerdere `BUSINESSBESLISSING` voor Estimated BTW is opgelost en technisch geïmplementeerd in `cda3baf` (migratie 39). Geen rij = onbekend; expliciet €0 blijft onderscheidbaar; Estimated blijft wijzigbaar zonder de vastgestelde Budget te muteren.

## 8. Nog niet starten

Canon/Erfpacht; rente leningen zonder bewezen bronmodel; Opbrengst rente tot eigen tranche; Geplande verkoop tot UX/integratiebesluit; nieuwe versieflow; autosave/locking; algemene UI/export; refreshed-contract-state huurforecast; bronmappings Management/Accountant/Juridisch tenzij afzonderlijk opgedragen.

## 9. STOP-codes

Exact: `BUSINESSBESLISSING`, `CONTRACTCONFLICT`, `BRONGAT`, `ARCHITECTUURPUNT`. STOP is een geldige gate-uitkomst.

## 10. Tranche 10 — rente

Rente leningen en Opbrengst rente zijn technisch aangesloten op Budget/Werkelijk/Estimated/P&L. Budget is handmatig; geen lening-/renteberekeningsengine. Estimated = Actual + handmatige resterende verwachting. Werkelijk uitsluitend via bewezen GL/OGB; 070 blijft BRONGAT. Voor Rente opbrengsten mag de interne ruwe boekhoudconventie negatief zijn, maar toekomstige gebruikersinvoer toont/aanvaardt een positief opbrengstbedrag en vertaalt dit aan de invoergrens.

## 11. Tranche 11 — geaccepteerd

Tranche 11 is **geen managementrapportage** en veronderstelt niet dat al een echte financiële begroting is opgesteld. Doel is de eerste geïntegreerde, daadwerkelijk invulbare exploitatiebegrotingsworkflow volgens de vastgestelde UX-set: **Nieuwe begroting → invullen → controleren → vaststellen → terugkijken**.

Het hoofdscherm is de vergelijkende P&L-werkweergave voor het opstellen van de nieuwe begroting. Vergelijkingsperspectieven zijn: Begroting vorig jaar | Realisatie huidig jaar | Estimated huidig jaar | Voorstel nieuw begrotingsjaar | Jouw begroting nieuw jaar. Vergelijkingsdata zijn onderbouwing; `Jouw begroting` is het nieuwe begrotingsproduct.

Tranche 11 hergebruikt uitsluitend bestaande geaccepteerde financiële rekenlogica en bouwt de integratie/productie-UI volgens de vastgestelde UX. Geen test- of fictieve waarden presenteren als echte begrotingsdata. Ontbrekende historische begroting blijft ontbrekend/onbekend. OPEN UX-punten uit hoofdstuk 12 van `09_Begrotingsmodule_UX_Vastgesteld.md` worden niet door Claude ingevuld: waar noodzakelijk volgt `BUSINESSBESLISSING` of `CONTRACTCONFLICT`. Canon/Erfpacht en Verkoopresultaat blijven buiten scope.


## 12. Volgende fase — Tranche 12

Tranche 11 eind-HEAD `efb6074` is geaccepteerd als **eerste geïntegreerde begrotingswerkomgeving / technisch gesloten integratieketen**, niet als volledig afgeronde begrotingsmodule.

Geaccepteerd ARCHITECTUURPUNT: de begrotingsworkflow draait voorlopig als sibling-routes `/begroting` op de bestaande lokale Worker serve-server, omdat dit de actuele live `BVC_DATA_ROOT`-gekoppelde applicatieketen is. Dit besluit maakt server-rendered Worker-UI niet automatisch tot de definitieve frontendarchitectuur.

Belangrijke bewijsnuance: de Tranche-11 HTTP-test gebruikt een XLSX-fixture en echte SQLite/mapping-/productiecodepaden. Dit bewijst de end-to-end technische productieketen, maar is niet hetzelfde als een acceptatieproef met een werkelijk BVC-productiebestand. Presenteer fixturebedragen daarom nooit als werkelijk financieel resultaat van administratie 070.

### Tranche 12 — prioriteit
Bouw de ontbrekende echte Contracten/RentRoll → `Module1Snapshot`-keten en sluit daarmee Huur en Beheersvergoeding functioneel aan op de invulbare begrotingsworkflow. Managementvergoeding mag de contract-afgeleide huurbasis hergebruiken volgens bestaand contract, maar de bekende Actual-mapping-BRONGAT voor 070 blijft gelden.

Doel: een nieuwe begroting gebruikt echte contract-/rentrollbronfeiten voor de huurgrondslag in plaats van lege/handmatig gefabriceerde snapshots. Bronfeiten en begrotingsaannames blijven strikt gescheiden. Geen refreshed-contract-state forecast bouwen tenzij afzonderlijk opgedragen. Daarna moeten Huur en Beheersvergoeding via de vastgestelde detail-UX daadwerkelijk bewerkbaar zijn.

Bouw geen brede visuele redesign en open geen onafhankelijke modules opnieuw. Indien de bronstructuur van Contracten/RentRoll onvoldoende bewezen is: `BRONGAT`; bij noodzakelijke nieuwe functionele keuze: `BUSINESSBESLISSING`.


## 13. Tranche 12 — geaccepteerd

Eind-HEAD `7f0956139f0d077440d4f656592fc104cb8daa24` is geaccepteerd. De echte bronketen Contracten + RentRoll → `BgContractFeiten[]` → frozen `Module1Snapshot` → Huur → Beheersvergoeding → begrotings-P&L is aangesloten. De read-only productieproef op 070_Rooise_Zoom reproduceerde de eerder bewezen contracttotalen; fixturetests blijven als fixture gelabeld.

Resterend huurpunt: `contract_prijsregels.xlsx` / `contracten_huidig_met_prijzen.xlsx` naar `BgToekomstigeKortingswijziging`, inclusief kandidaat-resolutielaag. Het bronfeit is bewezen; de ingestie/resolutie is nog niet gebouwd. Dit is bouwrestant, geen reden om Tranche 12 te heropenen.

## 14. Volgende fase — Tranche 13

Tranche 13 sluit eerst de ontbrekende toekomstige kortingswijzigingen aan en maakt daarna **Gepland onderhoud** daadwerkelijk invulbaar via de reeds vastgestelde UX. Hergebruik de bestaande onderhouds-Budget/Estimated/P&L-logica. Actual blijft uitsluitend op onderhoud-totaalniveau; splits Actual nooit kunstmatig in gepland/correctief. Bouw geen andere detailmodules in deze tranche.


## 15. Tranche 13 — geaccepteerd en architectuurcorrecties

Eind-HEAD `007e89fd01a5465ed80093c97390671ac53cad84` is geaccepteerd. Gepland onderhoud, Verzekeringen, Gemeentelijke lasten/WOZ, Algemene kosten en Leegstand zijn via assemblage op de bestaande `/begroting`-workflow aangesloten; bestaande calculators en persistence blijven leidend.

### Databasearchitectuur
Per administratie gebruikt de begrotingsmodule één SQLite-bestand voor zowel begrotingsversies/moduledata als de P&L-bronmapping. `begrotingsversiesDatabasePad(...)` en `pnlBronmappingDatabasePad(...)` wijzen daarom bewust naar hetzelfde administratiegebonden bestand. Dit is een geaccepteerd architectuurbesluit, niet een tijdelijke testfix. Splits deze functies niet opnieuw over twee databases zonder expliciet `ARCHITECTUURPUNT` en migratieplan. Als ooit data uit een historisch afzonderlijk `begrotingsversies.sqlite` moet worden behouden, is expliciete datamigratie vereist; een padwijziging alleen is dan onvoldoende.

### Read-only terugkijken na vaststellen
Een vastgestelde begrotingsversie is immutable, maar **alle detailonderbouwingen moeten via GET leesbaar blijven** bij terugkijken. Schrijfacties blijven geblokkeerd. De huidige code laat dit al toe voor Huur/Beheer; het generiek doortrekken naar de overige detailmodules is een kleine lifecycle-restdelta en geen herontwerp.

### Open restpunt
Toekomstige kortingswijzigingen uit `contract_prijsregels.xlsx` zijn nog niet ingelezen. Kandidaatresolutie mag niet stilzwijgend op `Status` of “nieuwste regel” worden gebaseerd; bij niet-eenduidige bewezen resolutie volgt `BRONGAT`.
