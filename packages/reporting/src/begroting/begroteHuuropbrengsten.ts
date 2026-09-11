import Decimal from "decimal.js";

/**
 * Begrote huuropbrengsten — Module 1 (2026-09-01), fase 1A: UITSLUITEND de
 * pure rekenlaag, conform `ONTWERP_BEGROTINGSMODULE.md` (OB-001 t/m OB-009)
 * en de bewezen bronsemantiek uit het Module-1-brononderzoek (070_Rooise_Zoom).
 *
 * Architectuurgrens: deze module leest zelf GEEN Excel/SQLite/cache, schrijft
 * niets weg, rendert geen HTML, kent geen CLI. Signatuur is uitsluitend:
 * bevroren bronfeiten + begrotingsaannames + expliciete overrides →
 * berekende Module-1-uitkomst. De orchestratielaag (later, `apps/worker`)
 * is verantwoordelijk voor het bevriezen van de bronfeiten in een snapshot
 * vóórdat deze functie wordt aangeroepen.
 *
 * Invariant (2026-09-01, expliciet vastgesteld): `berekenBegroteHuuropbrengsten`
 * verwerkt EXACT ÉÉN administratie (één `bedrijfsnr`) per aanroep — bewaakt
 * met een harde fail-fast (zie de functie zelf), geen KRITIEK-melding met
 * doorgaan. Daarmee is `contractnummer` een geldige lokale sleutel voor
 * overrides binnen één begrotingsversie, zonder dat de interface zelf
 * `bedrijfsnr + contractnummer` als samengestelde sleutel hoeft te gebruiken.
 *
 * BEWEZEN BRONREGELS (niet opnieuw interpreteren, zie brononderzoeksrapport
 * in de sessie-geschiedenis):
 * - Contractidentiteit: Bedrijfsnr + Contract (bevestigd uniek binnen één
 *   administratie — 12/12 unieke waarden voor 070, en technisch afgedwongen
 *   via `packages/cache`'s `PRIMARY KEY (bedrijfsnr, contract)`).
 * - Bruto contractjaarhuur = som van alle VS=01 `Prolongatie_bedrag_jaar`-
 *   regels (rentroll). Huurkorting = positieve presentatie van de absolute
 *   som van VS=13-regels. Netto huur = bruto − korting. Deze definitie
 *   reconcilieert voor 070 EXACT naar € 687.900,88 / € 13.920,00 /
 *   € 673.980,88 (bruto/korting/netto) — bewezen, hier hergebruikt, NOOIT
 *   een tweede definitie. VS=01 is altijd positief, VS=13 altijd negatief
 *   in de bron; een schending daarvan is een KRITIEK datakwaliteitssignaal,
 *   niet een reden om de tekenconventie zelf te wijzigen.
 * - Contracteinde: `Expiratie_Expiratiedatum` (contracten_huidig) — NIET
 *   `Afloopdatum` (bij 070 vrijwel altijd leeg, zelfde precedent als
 *   Huurdersoverzicht).
 * - Volgende indexatiedatum: `Verhoging_datum`. Herhalingsinterval:
 *   `Verhoging_opnieuw_na` (maanden) — bewezen via kruisvalidatie tegen de
 *   historische `contract_verhogingen`-regels (contracten 028/048: exact
 *   12 maanden na de laatst verwerkte indexatie). `Datum_laatst_
 *   geprolongreerd` is GEEN indexatiedatum (batch-/prolongatiedatum).
 * - Belast/onbelast: rentroll `BTW_Y_N`, uitsluitend `Y`→BELAST en
 *   `N`→ONBELAST bewezen (070: 11 contracten Y, 1 contract — kinderopvang,
 *   een vrijgestelde sector — N). Een andere/inconsistente waarde over de
 *   regels van hetzelfde contract → ONBEKEND + controleVereist, nooit
 *   gokken. `BTW_compensatie`/`BTW_compensatie_jaar` hebben GEEN bewezen
 *   betekenis en worden hier niet gebruikt.
 *
 * VASTGESTELDE BUSINESSREGELS (2026-09-01, definitief — geen aannames meer):
 *
 * 1. CONTRACTSTART/-EINDE (OB-006, tijdsevenredigheid) — gebroken maanden
 *    worden pro-rata berekend als: teller = werkelijk aantal actieve
 *    kalenderdagen in de betreffende maand; noemer = werkelijk aantal
 *    kalenderdagen van DIE maand (dus 28, 29, 30 of 31 — geen vaste
 *    30-dagenconventie). Actieve dagen worden INCLUSIEF geteld (zowel
 *    ingangs- als einddatum tellen zelf mee). Schrikkeljaren volgen hiermee
 *    automatisch het werkelijke aantal dagen van februari (28 of 29) —
 *    geen aparte schrikkeljaarregel nodig, de noemer is altijd al het
 *    echte aantal dagen van de maand. Onderbouwd met twee onafhankelijke,
 *    echte boekingsvoorbeelden uit de gedeelde bron (meerdere
 *    administraties):
 *    - INGANG (070/0000000049, ingangsdatum 15-09-2024): "Huur 15 tm 30
 *      september 2024" = € 266,67 tegenover € 500,00 volle maand — exact
 *      500 × 16/30 (16 dagen inclusief, 30 dagen in september).
 *    - Onderscheidend 31-DAGEN-bewijs (022/0000000060, contractovergang
 *      10-03-2025): "Huur 10 tm 31 maart 2025" = € 1.445,42 tegenover
 *      € 2.036,74 volle maand — matcht 2036,74 × 22/31 (≈ € 1.445,43,
 *      1 cent afrondingsverschil) en NIET een vaste 30-dagenconventie (die
 *      € 1.493,94 zou geven, ~€ 48 af). Bewijst ondubbelzinnig: werkelijke
 *      kalenderdagen van de maand, geen vaste 30-dagenconventie.
 *    - EINDE (015/0000000002, contract inmiddels verdwenen uit
 *      contracten_huidig — echt beëindigd): volle junimaand 2024 eerst
 *      regulier gefactureerd (€ 11.980,73), later gecorrigeerd met "Credit
 *      huur 19 tm 30 juni 2024" = € -4.792,29 — exact 11.980,73 × 12/30.
 *      Bevestigt dat ook contracteinde dagfractie-proportioneel (actual-
 *      days) wordt afgehandeld, niet alleen contractstart.
 *
 * 2. INDEXATIE — werkt op MAANDNIVEAU, zonder dagpro-rata binnen de
 *    indexatiemaand zelf. Valt de (effectieve) indexatiedatum in augustus —
 *    ongeacht of dat technisch de 1e, 15e of 31e is — dan geldt het nieuwe
 *    huurniveau voor de VOLLEDIGE maand augustus; juli blijft volledig op
 *    het oude niveau. Deze implementatie voldeed hier al aan (er wordt
 *    uitsluitend op maandnummer vergeleken, de dag van `indexatiedatum`
 *    wordt genegeerd) — geborgd met een expliciete test (indexatiedatum op
 *    de 15e in plaats van de 1e).
 *
 * 3. HUURKORTING (VS=13) — BEWEZEN: VS=13 is de afzonderlijke
 *    huurkortingscomponent; VS=13 wordt niet automatisch verhoogd met de
 *    reguliere huurindexatie (contracten 049/051: bij de laatste twee
 *    verwerkte indexaties bleef Bedrag_oud_VS_13 = Bedrag_Nieuw_VS_13 terwijl
 *    VS=01 wél steeg). Het vlak/ongewijzigd doorzetten van de huidige korting
 *    over het hele begrotingsjaar blijft de fallback-begrotingsaanname voor
 *    een contract ZONDER bekende toekomstige mutatie (geen bewezen bronfeit
 *    voor dat contract) — zie punt 4 voor de situatie mét een bewezen
 *    toekomstige mutatie.
 *
 * 4. TOEKOMSTIGE VS13-KORTINGSWIJZIGING (bronfeit-stap, 2026-09-02,
 *    businessbesluit vastgesteld na het Contract_prijsspecificatie-/
 *    contracten_huidig_met_prijzen-brononderzoek) — BEWEZEN: `contract_
 *    prijsregels.xlsx` bevat voor sommige contracten (070: 049 en 051) een
 *    reeds bronfeit-bewezen, gedateerde toekomstige wijziging van het
 *    VS=13-bedrag (contract 049: −500 → 0 per 01-07-2027; contract 051:
 *    −660 → −250 per 01-05-2027 — beide unaniem over alle kandidaatregels
 *    voor die datum). Dit is GEEN begrotingsaanname en GEEN override: een
 *    bekend contractueel feit gaat vóór een begrotingsaanname. Businessbe-
 *    sluit (expliciet, 2026-09-02): een dergelijke wijziging wordt uitsluitend
 *    toegepast als de bronextractielaag hem al tot één eenduidig bedrag per
 *    kalendermaand heeft herleid (`BgToekomstigeKortingswijziging` op
 *    `BgContractFeiten`) — deze module kiest zelf NOOIT tussen conflicterende
 *    kandidaten (geen "hoogste Prijs_regelnr wint"-logica hier). Uitdrukkelijk
 *    NIET meegenomen: een eventuele toekomstige bruto-huurwaarde uit
 *    `contract_prijsregels.xlsx`/`contracten_huidig_met_prijzen.xlsx` — die
 *    bleek een vóór-indexatie placeholder (`Verhoging_methode=Prijsindex`
 *    berekent het werkelijke bedrag pas op het indexatiemoment zelf), en de
 *    bestaande aannamegebaseerde bruto-huurindexatie (punt 2) blijft daarom
 *    ongewijzigd leidend. `Prolongeren_na_perioden` is bewezen voor VS=01,
 *    maar NIET bewezen voor VS=13 (0 testbare gevallen in de volledige bron)
 *    — blijft daarom volledig buiten deze module; de bronextractielaag mag
 *    nooit stilzwijgend dezelfde deel-regel toepassen op een toekomstige
 *    VS13-mutatie.
 *
 * OPENSTAANDE ONDERZOEKS-/CONTROLEPUNTEN (blokkeren fase 1A niet):
 *
 * 5. De exacte inclusief/exclusief-semantiek van het bronveld
 *    `Expiratie_Expiratiedatum` zelf is niet onafhankelijk bevestigd — bij
 *    het 015/0002-bewijs (punt 1) is het onderliggende contract niet meer
 *    zichtbaar in `contracten_huidig`, dus kon niet gecontroleerd worden of
 *    dat veld de laatste ACTIEVE dag of de eerste NIET-actieve dag zou
 *    hebben bevat. De dagfractie-MECHANIEK (welke dagen wel/niet in
 *    rekening worden gebracht) is wel bewezen; deze module gaat er
 *    vooralsnog van uit dat `einddatum` de laatste actieve dag is
 *    (inclusief).
 * 6. Toekomstige prijsregels voor de bruto huur (in tegenstelling tot VS=13,
 *    zie punt 4): Informant bevat aantoonbaar veel meer tabellen (≈281, zie
 *    het Informant-ODBC-onderzoeksdocument) dan de huidige exportset (11
 *    brontypen). Mocht een toekomstige bron ooit een bewezen NA-indexatie
 *    bruto-huurbedrag leveren (in plaats van de nu bewezen vóór-indexatie
 *    placeholder), dan moet opnieuw worden beoordeeld of dat vóór de
 *    begrotingsaanname van punt 2 moet gaan. Er is GEEN fictieve bron/tabel
 *    aan dit project toegevoegd.
 */

export type BgBelastOnbelast = "BELAST" | "ONBELAST" | "ONBEKEND";
export type BgControleErnst = "KRITIEK" | "WAARSCHUWING" | "INFORMATIEF";

export interface BgControleItem {
  /** `null` = niet aan één specifiek contract toe te wijzen. */
  contractnummer: string | null;
  ernst: BgControleErnst;
  bericht: string;
}

/**
 * Eén rentroll-component van een contract (bevroren snapshot-data — GEEN
 * volledige, ongefilterde rentroll-rij, uitsluitend de velden die Module 1
 * nodig heeft). `vorderingsoort` "01"/"13" zijn de enige bewezen-relevante
 * waarden; andere waarden (bv. "12", Compensatie OB) worden gemeld en niet
 * meegeteld — zelfde precedent als Huurdersoverzicht.
 */
export interface BgRentrollComponent {
  vorderingsoort: string;
  bedragJaar: Decimal;
  /** Ruwe BTW_Y_N-waarde van DEZE rentroll-regel — Module 1 bepaalt zelf de consistentie over alle regels van het contract. */
  btwYn: string | null;
}

/**
 * Eén bronfeit-bewezen, door de (toekomstige) bronextractielaag reeds
 * eenduidig geselecteerde toekomstige wijziging van de VS=13-huurkorting
 * (bv. uit `contract_prijsregels.xlsx`) — GEEN begrotingsaanname, GEEN
 * override. Bedrag in de RUWE brontekenconventie (0 of negatief, nooit
 * positief) — dezelfde conventie als `BgRentrollComponent.bedragJaar` voor
 * VS=13. `ingangsdatum` geldt voor de VOLLEDIGE kalendermaand (zelfde regel
 * als indexatie) — geen dagpro-rata op de wijziging zelf. Bewust GEEN
 * `Prijs_regelnr`/herkomstveld — conflictresolutie tussen kandidaatregels op
 * dezelfde datum is een verantwoordelijkheid van de bronextractielaag, deze
 * module verwacht al een eenduidige lijst (met een lichte defensieve
 * dubbelcheck, zie `bepaalKortingBasisPerMaand`).
 */
export interface BgToekomstigeKortingswijziging {
  ingangsdatum: Date;
  nieuweKortingPerMaand: Decimal;
}

export interface BgContractFeiten {
  bedrijfsnr: string;
  contractnummer: string;
  huurdernummer: string | null;
  huurderNaam: string | null;
  complexnummer: string | null;
  rentrollComponenten: readonly BgRentrollComponent[];
  ingangsdatum: Date | null;
  /** Expiratie_Expiratiedatum. `null` = doorlopend/onbekend einde. */
  einddatum: Date | null;
  /** Verhoging_datum — de eerstvolgende geplande indexatiedatum op het moment van bevriezen. `null` = onbekend. */
  indexatiedatum: Date | null;
  /** Verhoging_opnieuw_na — herhalingsinterval in maanden. `null` = onbekend. */
  indexatieHerhalingMaanden: number | null;
  /**
   * Bronfeit-bewezen, reeds eenduidig geselecteerde toekomstige VS=13-
   * kortingswijzigingen. Lege array = geen bekende toekomstige mutatie — de
   * huidige korting geldt dan ongewijzigd het hele begrotingsjaar (bestaand
   * gedrag, ongewijzigd).
   */
  toekomstigeKortingswijzigingen: readonly BgToekomstigeKortingswijziging[];
}

export type BgOverrideScope = "VERSIE" | "STRUCTUREEL";

/**
 * Expliciete contractoverride van het ALGEMENE verwachte indexatiepercentage
 * (OB-002). `scope` is metadata (VERSIE = alleen deze begrotingsversie,
 * STRUCTUREEL = bedoeld voor toekomstige versies) — verandert de
 * bronfeiten/het snapshot NOOIT, uitsluitend het toegepaste percentage voor
 * dit contract. De systeemwaarde (het algemene percentage) blijft via
 * `BgHuurResultaat.indexatiePercentageAlgemeen` en `BgContractUitkomst.
 * indexatiePercentageBron` zichtbaar/herleidbaar naast de override.
 */
export interface BgContractOverride {
  contractnummer: string;
  indexatiePercentage: Decimal;
  scope: BgOverrideScope;
  reden?: string;
}

export interface BgHuurAannames {
  begrotingsjaar: number;
  /** Algemeen verwacht indexatiepercentage — begrotingsAANNAME, nooit een bronfeit. Uitgedrukt als getal, bv. `3` voor 3%. */
  indexatiePercentage: Decimal;
}

export interface BgHuurMaandRegel {
  maand: number; // 1..12
  brutoHuurZonderIndexatie: Decimal;
  indexatieEffect: Decimal;
  brutoHuurMetIndexatie: Decimal;
  huurkorting: Decimal;
  nettoHuur: Decimal;
  /** Ingangsdatum van de bronfeit-kortingswijziging die deze maand bepaalt, of `null` = de basis (huidige) korting geldt nog. */
  kortingswijzigingToegepast: Date | null;
}

interface BgJaartotalen {
  brutoHuurZonderIndexatie: Decimal;
  indexatieEffect: Decimal;
  brutoHuurMetIndexatie: Decimal;
  huurkorting: Decimal;
  nettoHuur: Decimal;
}

export interface BgContractUitkomst {
  contractnummer: string;
  huurdernummer: string | null;
  huurderNaam: string | null;
  complexnummer: string | null;
  belastOnbelast: BgBelastOnbelast;
  indexatiePercentageGebruikt: Decimal;
  indexatiePercentageBron: "ALGEMEEN" | "OVERRIDE";
  overrideToegepast: { scope: BgOverrideScope; reden: string | null } | null;
  /** `null` = geen indexatie toegepast dit begrotingsjaar (geen effectieve indexatiedatum binnen het jaar). */
  effectieveIndexatiedatum: Date | null;
  regels: BgHuurMaandRegel[];
  jaartotaal: BgJaartotalen;
}

export interface BgPortefeuilleTotalen extends BgJaartotalen {
  nettoHuurBelast: Decimal;
  nettoHuurOnbelast: Decimal;
  nettoHuurOnbekendeBtw: Decimal;
}

export interface BgHuurResultaat {
  begrotingsjaar: number;
  /** Het bevroren bronmoment waartegen `Verhoging_datum` als "eerstvolgend" is beoordeeld — expliciet meegegeven, nooit hier herleid. */
  bronPeildatum: Date;
  indexatiePercentageAlgemeen: Decimal;
  contracten: BgContractUitkomst[];
  portefeuilleTotalen: BgPortefeuilleTotalen;
  controleVereist: BgControleItem[];
}

const DAG_MS = 24 * 60 * 60 * 1000;
const MAX_PROJECTIE_ITERATIES = 240; // 20 jaar veiligheidsgrens tegen een oneindige lus bij een corrupt interval.

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function leegJaartotaal(): BgJaartotalen {
  return {
    brutoHuurZonderIndexatie: new Decimal(0),
    indexatieEffect: new Decimal(0),
    brutoHuurMetIndexatie: new Decimal(0),
    huurkorting: new Decimal(0),
    nettoHuur: new Decimal(0),
  };
}

/**
 * Bruto jaarhuur (som VS=01) + huurkorting (abs som VS=13), met dezelfde
 * tekenconventie-bewaking als Huurdersoverzicht: VS=01 moet positief zijn,
 * VS=13 moet negatief zijn — een schending is KRITIEK en die regel telt niet
 * mee. Overige Vorderingsoorten worden gemeld (INFORMATIEF) en genegeerd.
 */
function aggregeerRentrollComponenten(
  contractnummer: string,
  componenten: readonly BgRentrollComponent[],
): { brutoJaarhuur: Decimal; huurkorting: Decimal; controleVereist: BgControleItem[] } {
  const controleVereist: BgControleItem[] = [];
  const vs01Bedragen: Decimal[] = [];
  const vs13Bedragen: Decimal[] = [];

  for (const c of componenten) {
    if (c.vorderingsoort === "01") {
      if (!c.bedragJaar.greaterThan(0)) {
        controleVereist.push({
          contractnummer,
          ernst: "KRITIEK",
          bericht: `Contract ${contractnummer}: Vorderingsoort "01"-regel heeft een niet-positief bedrag (${c.bedragJaar.toString()}, bewezen tekenconventie eist > 0) — buiten de som gehouden.`,
        });
        continue;
      }
      vs01Bedragen.push(c.bedragJaar);
    } else if (c.vorderingsoort === "13") {
      if (!c.bedragJaar.isNegative()) {
        controleVereist.push({
          contractnummer,
          ernst: "KRITIEK",
          bericht: `Contract ${contractnummer}: Vorderingsoort "13"-regel heeft een niet-negatief bedrag (${c.bedragJaar.toString()}) — buiten de som gehouden.`,
        });
        continue;
      }
      vs13Bedragen.push(c.bedragJaar);
    } else {
      controleVereist.push({
        contractnummer,
        ernst: "INFORMATIEF",
        bericht: `Contract ${contractnummer}: onverwachte Vorderingsoort "${c.vorderingsoort}" — niet meegeteld in de begrote huuropbrengsten.`,
      });
    }
  }

  if (vs01Bedragen.length === 0) {
    controleVereist.push({
      contractnummer,
      ernst: "WAARSCHUWING",
      bericht: `Contract ${contractnummer}: geen (geldige) Vorderingsoort "01"-regel gevonden — bruto jaarhuur behandeld als 0.`,
    });
  }

  return { brutoJaarhuur: som(vs01Bedragen), huurkorting: som(vs13Bedragen).abs(), controleVereist };
}

/**
 * Belast/onbelast uitsluitend op basis van BTW_Y_N over de relevante
 * (VS=01/VS=13) regels van het contract. Consistent → BELAST/ONBELAST.
 * Geen relevante regels, of een andere/inconsistente waarde → ONBEKEND +
 * WAARSCHUWING (nooit gokken).
 */
function bepaalBelastOnbelast(
  contractnummer: string,
  componenten: readonly BgRentrollComponent[],
): { belastOnbelast: BgBelastOnbelast; controleVereist: BgControleItem[] } {
  const relevanteWaarden = componenten
    .filter((c) => c.vorderingsoort === "01" || c.vorderingsoort === "13")
    .map((c) => c.btwYn);

  const uniekeWaarden = new Set(relevanteWaarden);
  if (uniekeWaarden.size === 1) {
    const waarde = [...uniekeWaarden][0];
    if (waarde === "Y") return { belastOnbelast: "BELAST", controleVereist: [] };
    if (waarde === "N") return { belastOnbelast: "ONBELAST", controleVereist: [] };
  }

  return {
    belastOnbelast: "ONBEKEND",
    controleVereist: [
      {
        contractnummer,
        ernst: "WAARSCHUWING",
        bericht: `Contract ${contractnummer}: belast/onbelast-classificatie (BTW_Y_N) is niet eenduidig "Y" of "N" over alle regels (${[...uniekeWaarden].map((w) => JSON.stringify(w)).join(", ") || "geen regels"}) — classificatie ONBEKEND, huur wordt wel berekend maar niet meegeteld in de belast/onbelast-totalen.`,
      },
    ],
  };
}

/** Eén kalendermaand (1-12) van `jaar`, als [eerste dag, laatste dag] (beide UTC-middernacht, inclusief). */
function maandBereik(jaar: number, maand: number): { start: Date; eind: Date } {
  return { start: new Date(Date.UTC(jaar, maand - 1, 1)), eind: new Date(Date.UTC(jaar, maand, 0)) };
}

/**
 * Telt `aantalMaanden` op bij `datum`, met de doelmaand berekend via
 * gehele-getallen-rekenkunde (jaar*12+maand) — niet via `Date.UTC`'s eigen
 * dag-normalisatie. Reden: `new Date(Date.UTC(jaar, maand+n, dag))` laat
 * een dag die niet in de doelmaand past (bv. dag 31 in een doelmaand met
 * 28/29/30 dagen) stilzwijgend doorlopen naar de VOLGENDE maand — dat zou
 * de businessregel "voor de begroting is de indexatiemaand leidend"
 * schenden. Deze functie KLEMT de dag daarom af op de laatste dag van de
 * daadwerkelijke doelmaand (net als vrijwel elke kalenderbibliotheek: 31
 * januari + 1 maand = 28/29 februari, nooit 2/3 maart). Voor alle bewezen
 * gevallen (Verhoging_Dag altijd "01") heeft dit geen effect — dit is
 * uitsluitend een defensieve correctie voor een dag > 28 die (nog) niet in
 * de bron is waargenomen.
 */
function addMaandenUTC(datum: Date, aantalMaanden: number): Date {
  const jaarMaandIndex = datum.getUTCFullYear() * 12 + datum.getUTCMonth() + aantalMaanden;
  const doelJaar = Math.floor(jaarMaandIndex / 12);
  const doelMaand0 = jaarMaandIndex - doelJaar * 12;
  const laatsteDagVanDoelMaand = new Date(Date.UTC(doelJaar, doelMaand0 + 1, 0)).getUTCDate();
  const dag = Math.min(datum.getUTCDate(), laatsteDagVanDoelMaand);
  return new Date(Date.UTC(doelJaar, doelMaand0, dag));
}

/** Dagfractie (0..1) van overlap tussen [ingangsdatum, einddatum] en de kalendermaand [maandStart, maandEind]. */
function bepaalActieveDagfractie(maandStart: Date, maandEind: Date, ingangsdatum: Date, einddatum: Date | null): Decimal {
  const vanaf = ingangsdatum.getTime() > maandStart.getTime() ? ingangsdatum : maandStart;
  const tot = einddatum !== null && einddatum.getTime() < maandEind.getTime() ? einddatum : maandEind;
  if (vanaf.getTime() > tot.getTime()) return new Decimal(0);
  const actieveDagen = Math.round((tot.getTime() - vanaf.getTime()) / DAG_MS) + 1;
  const dagenInMaand = Math.round((maandEind.getTime() - maandStart.getTime()) / DAG_MS) + 1;
  return new Decimal(actieveDagen).dividedBy(dagenInMaand);
}

/** Normaliseert naar UTC-middernacht van dezelfde kalenderdag — zodat datumvergelijkingen nooit door een tijdstip-component worden beïnvloed. */
function naarKalenderDag(datum: Date): Date {
  return new Date(Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate()));
}

/**
 * Bepaalt de effectieve indexatiedatum voor het begrotingsjaar.
 *
 * Bewezen bronsemantiek: `Verhoging_datum` is de EERSTVOLGENDE geplande
 * indexatiedatum OP HET MOMENT VAN DE BRONEXPORT/-SNAPSHOT (`bronPeildatum`)
 * — nooit een historische/laatst-toegepaste datum. Ligt `indexatiedatum` op
 * de bronpeildatum al in het verleden, dan is de bronwaarde zelf STALE
 * (een mogelijk achterlopende/niet-verwerkte Informant-batch) en mag hij
 * nooit worden doorgeprojecteerd — dat zou een gegokte indexatie zijn.
 * Daarom, in deze volgorde:
 * 1. `indexatiedatum === null` → geen indexatie (melding: zie aanroeper).
 * 2. `indexatiedatum < bronPeildatum` (kalenderdag-vergelijking, geen
 *    tijdstip-effecten) → STALE, geen projectie, geen indexatie, WAARSCHUWING.
 * 3. `indexatiedatum` valt in het begrotingsjaar → ongewijzigd gebruiken.
 * 4. `indexatiedatum` vóór het begrotingsjaar (en niet stale) → uitsluitend
 *    VOORWAARTS projecteren met `indexatieHerhalingMaanden` (Verhoging_
 *    opnieuw_na) — nooit een ander interval verzinnen.
 * 5. `indexatiedatum` ná het begrotingsjaar → GEEN achterwaartse
 *    reconstructie van een oudere, niet-geregistreerde indexatiedatum —
 *    geen indexatie toegepast, wel een informatieve melding waarom.
 */
function bepaalEffectieveIndexatiedatum(
  contractnummer: string,
  indexatiedatum: Date | null,
  herhalingMaanden: number | null,
  begrotingsjaar: number,
  bronPeildatum: Date,
): { datum: Date | null; controleVereist: BgControleItem[] } {
  if (indexatiedatum === null) {
    return { datum: null, controleVereist: [] };
  }

  if (naarKalenderDag(indexatiedatum).getTime() < naarKalenderDag(bronPeildatum).getTime()) {
    return {
      datum: null,
      controleVereist: [
        {
          contractnummer,
          ernst: "WAARSCHUWING",
          bericht: `Contract ${contractnummer}: de geregistreerde eerstvolgende indexatiedatum (${indexatiedatum.toISOString().slice(0, 10)}) lag op de bronpeildatum (${bronPeildatum.toISOString().slice(0, 10)}) al in het verleden — mogelijk een achterlopende/niet-verwerkte Informant-batch. Niet doorgeprojecteerd, geen indexatie toegepast.`,
        },
      ],
    };
  }

  const bronjaar = indexatiedatum.getUTCFullYear();
  if (bronjaar === begrotingsjaar) {
    return { datum: indexatiedatum, controleVereist: [] };
  }

  if (bronjaar > begrotingsjaar) {
    return {
      datum: null,
      controleVereist: [
        {
          contractnummer,
          ernst: "INFORMATIEF",
          bericht: `Contract ${contractnummer}: de eerstvolgende geplande indexatiedatum (${indexatiedatum.toISOString().slice(0, 10)}) ligt ná begrotingsjaar ${begrotingsjaar} — geen indexatie toegepast (geen achterwaartse reconstructie van een oudere indexatiedatum).`,
        },
      ],
    };
  }

  // bronjaar < begrotingsjaar: uitsluitend voorwaarts projecteren.
  if (herhalingMaanden === null || !Number.isFinite(herhalingMaanden) || herhalingMaanden <= 0) {
    return {
      datum: null,
      controleVereist: [
        {
          contractnummer,
          ernst: "WAARSCHUWING",
          bericht: `Contract ${contractnummer}: indexatiedatum (${indexatiedatum.toISOString().slice(0, 10)}) valt niet in begrotingsjaar ${begrotingsjaar} en er is geen betrouwbaar herhalingsinterval (Verhoging_opnieuw_na) om naar dit jaar door te projecteren — geen indexatie toegepast.`,
        },
      ],
    };
  }

  let kandidaat = indexatiedatum;
  let iteraties = 0;
  while (kandidaat.getUTCFullYear() < begrotingsjaar && iteraties < MAX_PROJECTIE_ITERATIES) {
    kandidaat = addMaandenUTC(kandidaat, herhalingMaanden);
    iteraties += 1;
  }

  if (kandidaat.getUTCFullYear() !== begrotingsjaar) {
    return {
      datum: null,
      controleVereist: [
        {
          contractnummer,
          ernst: "WAARSCHUWING",
          bericht: `Contract ${contractnummer}: voorwaartse doorprojectie van de indexatiedatum met interval ${herhalingMaanden} maand(en) landt niet in begrotingsjaar ${begrotingsjaar} — geen indexatie toegepast.`,
        },
      ],
    };
  }
  return { datum: kandidaat, controleVereist: [] };
}

/**
 * Bepaalt de effectieve kortingsbasis (VS=13, per maand, in de interne
 * POSITIEVE presentatievorm — zelfde conventie als `huurkorting`/
 * `kortingMaandBasis` elders in deze functie) voor elke maand van het
 * begrotingsjaar: de huidige (rentroll-afgeleide) korting, eventueel
 * overschreven door bronfeit-bewezen toekomstige `BgToekomstigeKortingswijziging`-
 * stappen (zie punt 4 van de moduledocumentatie hierboven).
 *
 * WEL een `bronPeildatum`-staleness-guard — `huidigeKortingMaandBasis` is
 * zelf een bevroren bronfeit ZOALS HET GOLD OP `bronPeildatum`. Een
 * `BgToekomstigeKortingswijziging` met `ingangsdatum < bronPeildatum` zou, als
 * hij echt is, allang in die bevroren basis verwerkt moeten zijn — hem dan
 * ALSNOG als losse tijdlijnstap toepassen zou een niet-bewezen aanname
 * introduceren over welke (oudere) waarde vóór die datum gold. Zo'n
 * wijziging wordt daarom als stale behandeld: gemeld, niet toegepast, de
 * bevroren basis blijft ongewijzigd gelden. `ingangsdatum === bronPeildatum`
 * is WEL geldig (geen stale) — op kalenderdag vergeleken, geen tijdstip-
 * effecten (analoog aan `bepaalEffectieveIndexatiedatum`'s grensgeval).
 *
 * Validatievolgorde: (1) ongeldige datum (`Invalid Date`) → KRITIEK; (2)
 * positief bedrag (> 0) → KRITIEK; (3) `ingangsdatum < bronPeildatum` →
 * WAARSCHUWING (stale); (4) ingangsdatum ná `contractEinddatum` →
 * WAARSCHUWING; (5) groeperen op kalendermaand — gelijke bedragen binnen de
 * groep dedupliceren (vroegste datum als traceerbare datum, geen melding),
 * verschillende bedragen → WAARSCHUWING, hele maandgroep niet toegepast; (6)
 * resterende, unieke wijzigingen oplopend toepassen (jaar < begrotingsjaar →
 * vanaf januari; jaar === begrotingsjaar → vanaf die maand; jaar >
 * begrotingsjaar → INFORMATIEF, niet toegepast) — een latere wijziging
 * overschrijft een eerdere voor de overlappende staartmaanden.
 */
function bepaalKortingBasisPerMaand(
  contractnummer: string,
  huidigeKortingMaandBasis: Decimal,
  wijzigingen: readonly BgToekomstigeKortingswijziging[],
  begrotingsjaar: number,
  contractEinddatum: Date | null,
  bronPeildatum: Date,
): { basisPerMaand: Decimal[]; toegepastPerMaand: (Date | null)[]; controleVereist: BgControleItem[] } {
  const controleVereist: BgControleItem[] = [];

  const gevalideerd: BgToekomstigeKortingswijziging[] = [];
  for (const wijziging of wijzigingen) {
    if (Number.isNaN(wijziging.ingangsdatum.getTime())) {
      controleVereist.push({
        contractnummer,
        ernst: "KRITIEK",
        bericht: `Contract ${contractnummer}: een toekomstige VS13-kortingswijziging heeft een ongeldige ingangsdatum (Invalid Date) — niet toegepast, basiskorting blijft gelden.`,
      });
      continue;
    }
    if (wijziging.nieuweKortingPerMaand.greaterThan(0)) {
      controleVereist.push({
        contractnummer,
        ernst: "KRITIEK",
        bericht: `Contract ${contractnummer}: een toekomstige VS13-kortingswijziging per ${wijziging.ingangsdatum.toISOString().slice(0, 10)} heeft een positief bedrag (${wijziging.nieuweKortingPerMaand.toString()}, bewezen tekenconventie eist ≤ 0) — niet toegepast, basiskorting blijft gelden.`,
      });
      continue;
    }
    if (naarKalenderDag(wijziging.ingangsdatum).getTime() < naarKalenderDag(bronPeildatum).getTime()) {
      controleVereist.push({
        contractnummer,
        ernst: "WAARSCHUWING",
        bericht: `Contract ${contractnummer}: een toekomstige VS13-kortingswijziging per ${wijziging.ingangsdatum.toISOString().slice(0, 10)} lag op de bronpeildatum (${bronPeildatum.toISOString().slice(0, 10)}) al in het verleden — hoort dan al in de bevroren huidige korting verwerkt te zijn, niet toegepast als losse tijdlijnstap.`,
      });
      continue;
    }
    if (contractEinddatum !== null && naarKalenderDag(wijziging.ingangsdatum).getTime() > naarKalenderDag(contractEinddatum).getTime()) {
      controleVereist.push({
        contractnummer,
        ernst: "WAARSCHUWING",
        bericht: `Contract ${contractnummer}: een toekomstige VS13-kortingswijziging per ${wijziging.ingangsdatum.toISOString().slice(0, 10)} ligt ná het contracteinde (${contractEinddatum.toISOString().slice(0, 10)}) — niet toegepast (kan sowieso geen effect hebben).`,
      });
      continue;
    }
    gevalideerd.push(wijziging);
  }

  const perMaandGroep = new Map<string, BgToekomstigeKortingswijziging[]>();
  for (const wijziging of gevalideerd) {
    const sleutel = `${wijziging.ingangsdatum.getUTCFullYear()}-${wijziging.ingangsdatum.getUTCMonth()}`;
    const groep = perMaandGroep.get(sleutel) ?? [];
    groep.push(wijziging);
    perMaandGroep.set(sleutel, groep);
  }

  const gededupliceerd: BgToekomstigeKortingswijziging[] = [];
  for (const groep of perMaandGroep.values()) {
    const uniekeBedragen = new Set(groep.map((w) => w.nieuweKortingPerMaand.toString()));
    if (uniekeBedragen.size > 1) {
      const voorbeeld = groep[0]!;
      controleVereist.push({
        contractnummer,
        ernst: "WAARSCHUWING",
        bericht: `Contract ${contractnummer}: meerdere toekomstige VS13-kortingswijzigingen voor dezelfde kalendermaand (${voorbeeld.ingangsdatum.getUTCFullYear()}-${String(voorbeeld.ingangsdatum.getUTCMonth() + 1).padStart(2, "0")}) geven verschillende bedragen — geen van beide toegepast, de korting van vóór die maand blijft doorlopen.`,
      });
      continue;
    }
    const vroegste = groep.reduce((a, b) => (a.ingangsdatum.getTime() <= b.ingangsdatum.getTime() ? a : b));
    gededupliceerd.push(vroegste);
  }

  gededupliceerd.sort((a, b) => a.ingangsdatum.getTime() - b.ingangsdatum.getTime());

  const basisPerMaand: Decimal[] = new Array(12).fill(huidigeKortingMaandBasis);
  const toegepastPerMaand: (Date | null)[] = new Array(12).fill(null);

  for (const wijziging of gededupliceerd) {
    const wijzigingsjaar = wijziging.ingangsdatum.getUTCFullYear();
    if (wijzigingsjaar > begrotingsjaar) {
      controleVereist.push({
        contractnummer,
        ernst: "INFORMATIEF",
        bericht: `Contract ${contractnummer}: een bekende toekomstige VS13-kortingswijziging per ${wijziging.ingangsdatum.toISOString().slice(0, 10)} ligt ná begrotingsjaar ${begrotingsjaar} — nog niet van toepassing dit jaar.`,
      });
      continue;
    }
    const vanafMaand = wijzigingsjaar < begrotingsjaar ? 1 : wijziging.ingangsdatum.getUTCMonth() + 1;
    for (let maand = vanafMaand; maand <= 12; maand += 1) {
      // `.abs()` hier is GEEN validatie — die is hierboven al gebeurd (positief bedrag is KRITIEK-
      // geweigerd vóórdat een wijziging ooit hier komt). Dit zet een reeds-geldig, ruw brontekenbedrag
      // (0 of negatief) uitsluitend om naar dezelfde interne POSITIEVE magnitudeconventie als
      // `huidigeKortingMaandBasis`/`kortingMaandBasis` — nooit gebruikt om een ongeldige waarde geldig te maken.
      basisPerMaand[maand - 1] = wijziging.nieuweKortingPerMaand.abs();
      toegepastPerMaand[maand - 1] = wijziging.ingangsdatum;
    }
  }

  return { basisPerMaand, toegepastPerMaand, controleVereist };
}

export function berekenBegroteHuuropbrengsten(
  contracten: readonly BgContractFeiten[],
  overrides: readonly BgContractOverride[],
  aannames: BgHuurAannames,
  /**
   * Het bevroren bronmoment (uit het snapshot, NOOIT tijdens herberekening
   * opnieuw uit de actuele cache gehaald) waartegen `Verhoging_datum` als
   * "eerstvolgende geplande indexatiedatum" geldig is. Bewust GEEN veld op
   * `BgHuurAannames` — dit is een bronfeit van het snapshot, geen
   * begrotingsaanname. Eén waarde voor de hele aanroep (niet per contract):
   * alle contracten in één aanroep komen uit hetzelfde bevroren bronmoment
   * (zelfde invariant als "één administratie per aanroep" hierboven) —
   * een per-contract veld zou dat alleen maar kunnen laten uiteenlopen
   * zonder een geldige reden.
   */
  bronPeildatum: Date,
): BgHuurResultaat {
  // Invariant (fase 1A, expliciet vastgesteld): deze functie verwerkt EXACT
  // één administratie per aanroep. `contractnummer` is daarmee een geldige
  // lokale sleutel voor overrides binnen één begrotingsversie — de bredere
  // sleutel Bedrijfsnr+Contract is dan altijd al uniek. Gemengde
  // administraties in één aanroep zijn een aanroepersfout (geen datakwaliteits-
  // signaal van een individueel contract) en falen daarom hard, i.p.v. een
  // mogelijk misleidend resultaat te retourneren.
  const bedrijfsnrs = new Set(contracten.map((c) => c.bedrijfsnr));
  if (bedrijfsnrs.size > 1) {
    throw new Error(
      `berekenBegroteHuuropbrengsten verwerkt exact één administratie per aanroep — kreeg contracten van meerdere bedrijfsnr's (${[...bedrijfsnrs].sort().join(", ")}). De aanroeper moet per administratie apart aanroepen.`,
    );
  }

  const controleVereist: BgControleItem[] = [];

  const overridePerContract = new Map<string, BgContractOverride>();
  for (const override of overrides) {
    if (overridePerContract.has(override.contractnummer)) {
      controleVereist.push({
        contractnummer: override.contractnummer,
        ernst: "WAARSCHUWING",
        bericht: `Contract ${override.contractnummer}: meerdere indexatiepercentage-overrides opgegeven — alleen de eerste wordt toegepast.`,
      });
      continue;
    }
    overridePerContract.set(override.contractnummer, override);
  }
  const bekendeContractnummers = new Set(contracten.map((c) => c.contractnummer));
  for (const override of overrides) {
    if (!bekendeContractnummers.has(override.contractnummer)) {
      controleVereist.push({
        contractnummer: override.contractnummer,
        ernst: "WAARSCHUWING",
        bericht: `Override voor contract ${override.contractnummer} verwijst niet naar een contract in de invoer — genegeerd.`,
      });
    }
  }

  const contractUitkomsten: BgContractUitkomst[] = contracten.map((contract) => {
    const { brutoJaarhuur, huurkorting, controleVereist: aggregatieMeldingen } = aggregeerRentrollComponenten(
      contract.contractnummer,
      contract.rentrollComponenten,
    );
    controleVereist.push(...aggregatieMeldingen);

    const { belastOnbelast, controleVereist: btwMeldingen } = bepaalBelastOnbelast(contract.contractnummer, contract.rentrollComponenten);
    controleVereist.push(...btwMeldingen);

    const override = overridePerContract.get(contract.contractnummer) ?? null;
    const indexatiePercentageGebruikt = override?.indexatiePercentage ?? aannames.indexatiePercentage;
    const indexatiePercentageBron: "ALGEMEEN" | "OVERRIDE" = override ? "OVERRIDE" : "ALGEMEEN";

    // Dagfracties eerst bepalen (onafhankelijk van indexatie) — nodig om te weten of dit
    // contract daadwerkelijk huur genereert in het begrotingsjaar, VOORDAT een eventuele
    // "indexatiebron ontbreekt"-melding wordt overwogen (geen ruis voor niet-overlappende contracten).
    const dagfracties: Decimal[] = [];
    for (let maand = 1; maand <= 12; maand += 1) {
      const { start, eind } = maandBereik(aannames.begrotingsjaar, maand);
      dagfracties.push(
        contract.ingangsdatum === null ? new Decimal(0) : bepaalActieveDagfractie(start, eind, contract.ingangsdatum, contract.einddatum),
      );
    }
    const heeftOverlap = dagfracties.some((f) => f.greaterThan(0));

    const { datum: effectieveIndexatiedatum, controleVereist: indexatieMeldingen } = bepaalEffectieveIndexatiedatum(
      contract.contractnummer,
      contract.indexatiedatum,
      contract.indexatieHerhalingMaanden,
      aannames.begrotingsjaar,
      bronPeildatum,
    );
    controleVereist.push(...indexatieMeldingen);
    if (contract.indexatiedatum === null && heeftOverlap) {
      controleVereist.push({
        contractnummer: contract.contractnummer,
        ernst: "WAARSCHUWING",
        bericht: `Contract ${contract.contractnummer}: genereert huur in begrotingsjaar ${aannames.begrotingsjaar}, maar er is geen betrouwbare indexatiedatum (Verhoging_datum) bekend — geen indexatie toegepast.`,
      });
    }

    const brutoMaandBasis = brutoJaarhuur.dividedBy(12);
    const kortingMaandBasis = huurkorting.dividedBy(12);
    const indexatiemaand = effectieveIndexatiedatum !== null ? effectieveIndexatiedatum.getUTCMonth() + 1 : null;

    const {
      basisPerMaand: kortingBasisPerMaand,
      toegepastPerMaand: kortingswijzigingPerMaand,
      controleVereist: kortingswijzigingMeldingen,
    } = bepaalKortingBasisPerMaand(
      contract.contractnummer,
      kortingMaandBasis,
      contract.toekomstigeKortingswijzigingen,
      aannames.begrotingsjaar,
      contract.einddatum,
      bronPeildatum,
    );
    controleVereist.push(...kortingswijzigingMeldingen);

    const regels: BgHuurMaandRegel[] = [];
    for (let maand = 1; maand <= 12; maand += 1) {
      const dagfractie = dagfracties[maand - 1]!;
      const brutoHuurZonderIndexatie = brutoMaandBasis.times(dagfractie);
      const indexatieActief = indexatiemaand !== null && maand >= indexatiemaand;
      const indexatieEffect = indexatieActief ? brutoHuurZonderIndexatie.times(indexatiePercentageGebruikt).dividedBy(100) : new Decimal(0);
      const brutoHuurMetIndexatie = brutoHuurZonderIndexatie.plus(indexatieEffect);
      const huurkortingMaand = kortingBasisPerMaand[maand - 1]!.times(dagfractie);
      const nettoHuur = brutoHuurMetIndexatie.minus(huurkortingMaand);

      regels.push({
        maand,
        brutoHuurZonderIndexatie,
        indexatieEffect,
        brutoHuurMetIndexatie,
        huurkorting: huurkortingMaand,
        nettoHuur,
        kortingswijzigingToegepast: kortingswijzigingPerMaand[maand - 1] ?? null,
      });
    }

    if (contract.ingangsdatum === null) {
      controleVereist.push({
        contractnummer: contract.contractnummer,
        ernst: "WAARSCHUWING",
        bericht: `Contract ${contract.contractnummer}: geen ingangsdatum bekend — tijdsevenredigheid kan niet worden bepaald, begrote huur behandeld als 0 voor het volledige jaar.`,
      });
    } else if (!heeftOverlap) {
      controleVereist.push({
        contractnummer: contract.contractnummer,
        ernst: "INFORMATIEF",
        bericht: `Contract ${contract.contractnummer}: geen overlap met begrotingsjaar ${aannames.begrotingsjaar} — draagt niet bij aan de begroting.`,
      });
    }

    const jaartotaal: BgJaartotalen = {
      brutoHuurZonderIndexatie: som(regels.map((r) => r.brutoHuurZonderIndexatie)),
      indexatieEffect: som(regels.map((r) => r.indexatieEffect)),
      brutoHuurMetIndexatie: som(regels.map((r) => r.brutoHuurMetIndexatie)),
      huurkorting: som(regels.map((r) => r.huurkorting)),
      nettoHuur: som(regels.map((r) => r.nettoHuur)),
    };

    return {
      contractnummer: contract.contractnummer,
      huurdernummer: contract.huurdernummer,
      huurderNaam: contract.huurderNaam,
      complexnummer: contract.complexnummer,
      belastOnbelast,
      indexatiePercentageGebruikt,
      indexatiePercentageBron,
      overrideToegepast: override ? { scope: override.scope, reden: override.reden ?? null } : null,
      effectieveIndexatiedatum,
      regels,
      jaartotaal,
    };
  });

  const portefeuilleTotalen: BgPortefeuilleTotalen = {
    ...leegJaartotaal(),
    nettoHuurBelast: new Decimal(0),
    nettoHuurOnbelast: new Decimal(0),
    nettoHuurOnbekendeBtw: new Decimal(0),
  };
  for (const c of contractUitkomsten) {
    portefeuilleTotalen.brutoHuurZonderIndexatie = portefeuilleTotalen.brutoHuurZonderIndexatie.plus(c.jaartotaal.brutoHuurZonderIndexatie);
    portefeuilleTotalen.indexatieEffect = portefeuilleTotalen.indexatieEffect.plus(c.jaartotaal.indexatieEffect);
    portefeuilleTotalen.brutoHuurMetIndexatie = portefeuilleTotalen.brutoHuurMetIndexatie.plus(c.jaartotaal.brutoHuurMetIndexatie);
    portefeuilleTotalen.huurkorting = portefeuilleTotalen.huurkorting.plus(c.jaartotaal.huurkorting);
    portefeuilleTotalen.nettoHuur = portefeuilleTotalen.nettoHuur.plus(c.jaartotaal.nettoHuur);
    if (c.belastOnbelast === "BELAST") portefeuilleTotalen.nettoHuurBelast = portefeuilleTotalen.nettoHuurBelast.plus(c.jaartotaal.nettoHuur);
    else if (c.belastOnbelast === "ONBELAST") portefeuilleTotalen.nettoHuurOnbelast = portefeuilleTotalen.nettoHuurOnbelast.plus(c.jaartotaal.nettoHuur);
    else portefeuilleTotalen.nettoHuurOnbekendeBtw = portefeuilleTotalen.nettoHuurOnbekendeBtw.plus(c.jaartotaal.nettoHuur);
  }

  return {
    begrotingsjaar: aannames.begrotingsjaar,
    bronPeildatum,
    indexatiePercentageAlgemeen: aannames.indexatiePercentage,
    contracten: contractUitkomsten,
    portefeuilleTotalen,
    controleVereist,
  };
}
