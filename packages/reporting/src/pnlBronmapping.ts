/**
 * Centrale P&L-/Bronmappingarchitectuur — FASE M1 (2026-09-14): UITSLUITEND
 * het pure fundament (economische module-registry + `PnLBronmappingRegel`-
 * type + de pure resolver). Geen persistence, geen migratie van bestaande
 * module-classificaties, geen herwiring van bestaande `berekenWerkelijkX`-
 * functies, geen presentatielaag, geen rapportagesnapshot, geen UI. Dit
 * bestand staat BEWUST parallel naast de bestaande architectuur — Rente/
 * Leegstand/Algemene Kosten/Geplande Verkoop blijven ongewijzigd hun eigen
 * classificatietabel/-parameter gebruiken totdat een latere fase ze op deze
 * centrale resolver herwiret.
 *
 * KERNPRINCIPE — GROOTBOEKREKENING BEPAALT HET ECONOMISCHE HOOFDDOMEIN:
 * een `PnLBronmappingRegel` met `ogbKostensoort: null` is de GL-brede
 * hoofdregel/default-mapping voor die grootboekrekening; een regel met een
 * gevulde `ogbKostensoort` verfijnt BINNEN diezelfde grootboekrekening naar
 * een specifiekere economische categorie — en mag NOOIT een andere
 * `economischeModule` dragen dan de GL-default van dezelfde grootboek-
 * rekening (zie `resolveerPnLBronmapping`'s harde invariant-check hieronder).
 * Een OGB kan dus nooit een boeking naar een andere economische module laten
 * "springen" dan zijn eigen grootboekrekening.
 *
 * BITEMPOREEL, MAAR PRAGMATISCH GEHOUDEN (architectuurcorrectie 2026-09-14):
 * elke mappingregel heeft zowel een GELDIGHEIDSTIJD (`geldigVanaf`/
 * `geldigTot`, boekjaar+periode — "wanneer gold dit economisch") als een
 * SYSTEEMTIJD (`aangemaaktOp` — "wanneer wist het systeem dit", append-only,
 * nooit gewijzigd). Dit onderscheid is noodzakelijk om twee soorten
 * mappingwijziging eenduidig te ondersteunen zonder een "time machine" te
 * hoeven bouwen:
 *
 *  A. NIEUWE MAPPING VANAF PERIODE — de economische betekenis verandert
 *     werkelijk vanaf een gekozen periode. De oude regel se
 *     geldigheidsinterval eindigt daar (in een latere fase expliciet
 *     afgesloten door de schrijver), de nieuwe regel begint daar. Voor een
 *     gegeven periode is er dan hooguit één regel waarvan het
 *     geldigheidsinterval die periode dekt — geen ambiguïteit nodig.
 *
 *  B. HISTORISCHE CORRECTIE — een mapping blijkt vanaf een EERDERE periode
 *     fout te zijn geweest. De nieuwe regel se geldigheidsinterval kan dan
 *     een periode dekken die de oude regel OOK al dekte (bewust overlappend,
 *     in tegenstelling tot geval A) — hier lost `aangemaaktOp` de ambiguïteit
 *     op: de resolver kiest altijd de kandidaat met de HOOGSTE `aangemaaktOp`
 *     (het meest recent bekende inzicht), nooit een willekeurige of de
 *     eerste. Dit werkt voor een onbeperkt aantal opeenvolgende correcties
 *     zonder enige aparte "laatste-correctie"-boekhouding: de resolver
 *     filtert simpelweg op geldigheid + `aangemaaktOp ≤ opSysteemtijdstip` en
 *     kiest daarbinnen de nieuwste — zie de tests voor het bewijs dat dit
 *     model voldoende is.
 *
 * `opSysteemtijdstip` is BEWUST een verplicht invoerveld (nooit een impliciete
 * `new Date()` binnen deze pure functie, zelfde principe als elders in dit
 * project: geen verborgen kloktoegang in een pure calculator). Live-
 * resolutie geeft hier simpelweg "nu" door; een toekomstige VASTGESTELDE
 * P&L-rapportage (buiten scope van M1) zou hier zijn eigen bevroren
 * `vastgesteldOp`-tijdstip doorgeven — maar zoals afgesproken bewaart een
 * vastgesteld rapport straks zijn BEREKENDE resultaat als eigen waarheid, en
 * hoeft het NOOIT opnieuw via deze resolver gereconstrueerd te worden. Deze
 * resolver is dus uitsluitend voor LIVE-classificatie bedoeld.
 *
 * GEEN VRIJE TEKST, GEEN PORTFOLIO-BREDE BETEKENIS, GEEN IMPLICIETE FALLBACK
 * NAAR EEN ANDERE GL: onbekende combinaties leveren altijd `NIET_GEMAPT` op,
 * nooit een gok.
 *
 * ── ADDENDUM — FASE EBITDA-CANON (2026-09-16) ───────────────────────────────
 * De EBITDA Coverage Gate (2026-09-15) constateerde dat GL4350 in de M5-
 * testfixtures met `economischeModule: "LEEGSTAND"` is vastgelegd, terwijl
 * diezelfde grootboekrekening in de praktijk BREDER kan zijn: naast
 * servicekosten leegstand (bewezen: OGB4319) kan een GL zoals 4350 ook
 * reguliere, niet-leegstandgerelateerde servicekosten van de eigenaar dragen.
 * Businessbesluit (2026-09-16): dit was geen fout in de invariant HIERBOVEN
 * — die blijft woordelijk correct en ONGEWIJZIGD ("GL bepaalt hoofddomein,
 * OGB verfijnt BINNEN dat domein, OGB mag nooit naar een ander domein
 * springen"). Het was een te specifieke KEUZE VAN WELKE MODULEWAARDE als
 * hoofddomein diende voor déze ene GL, gemaakt in test fixtures die NOOIT
 * echt gepersisteerd zijn (bevestigd: `voegPnLBronmappingMutatieToe` wordt
 * nergens buiten haar eigen testbestand aangeroepen — er bestaat geen
 * productie-mappingrij voor GL4350).
 *
 * Consequentie voor toekomstig gebruik van deze module-registry: een waarde
 * in `PNL_ECONOMISCHE_MODULES` moet een economisch HOOFDDOMEIN
 * vertegenwoordigen — breed genoeg om alle legitieme kostensoorten van een
 * GL te omvatten — nooit een specifieke SUBCATEGORIE die toevallig de enige
 * tot dusver bewezen invulling van die GL is. `ONDERHOUD` (drie GL's, drie
 * categorieën) en `GEMEENTELIJKE_LASTEN` (twee GL's, één categorie, één met
 * GL-default) zijn hiervan al werkende voorbeelden.
 *
 * ── RESOLUTIE — FASE GAT-006 (2026-09-17) ───────────────────────────────────
 * Het hierboven aangekondigde hoofddomein is vastgesteld: `SERVICEKOSTEN_EIGENAAR`
 * (toegevoegd aan `PNL_ECONOMISCHE_MODULES`). GL4350 is GEEN Leegstand-GL —
 * het draagt zowel reguliere als tijdens-leegstand servicekosten van de
 * eigenaar. Zie `servicekostenEigenaarCentraleMapping.ts`/
 * `werkelijkServicekostenEigenaar.ts` voor de volledige uitwerking
 * (categorieën `SERVICEKOSTEN_EIGENAAR_REGULIER`/`SERVICEKOSTEN_LEEGSTAND`,
 * bewezen 070/GL4350/OGB4319 → `SERVICEKOSTEN_LEEGSTAND`, €1.354,10). Geen
 * migratie nodig: er bestond nooit een gepersisteerde mapping voor GL4350
 * (bevestigd, zie hierboven). `LEEGSTAND` blijft een zelfstandig hoofddomein
 * voor GL's die daadwerkelijk uitsluitend leegstand betreffen (bewezen: geen
 * enkele voor 070) — `SERVICEKOSTEN_EIGENAAR` is geen vervanging van
 * `LEEGSTAND` en geen verzamelbak voor alle leegstandsgerelateerde kosten.
 */

export const PNL_ECONOMISCHE_MODULES = [
  "HUUR",
  "BEHEER",
  "MANAGEMENT",
  "ONDERHOUD",
  "LEEGSTAND",
  "SERVICEKOSTEN_EIGENAAR",
  "VERZEKERINGEN",
  "GEMEENTELIJKE_LASTEN",
  "ALGEMENE_KOSTEN",
  "RENTE",
  "VERKOOP",
  "NIET_VERREKENBARE_BTW",
  "WAARDERING",
  "ADMINISTRATIEKOSTEN_DOORBELASTING",
] as const;

export type PnLEconomischeModule = (typeof PNL_ECONOMISCHE_MODULES)[number];

/**
 * Eén bronmappingregel — administratie-specifiek, nooit portfolio-breed.
 * `ogbKostensoort: null` = de GL-brede hoofdregel/default-mapping voor
 * `grootboekrekening`. `economischeCategorie` is een vrije string hier: deze
 * module kent de module-eigen categorie-enums (bv. `ALGEMENE_KOSTEN_CATEGORIEEN`)
 * niet — die koppeling is de verantwoordelijkheid van de aanroeper/latere fase.
 */
export interface PnLBronmappingRegel {
  bedrijfsnr: string;
  grootboekrekening: string;
  /** `null` = GL-brede hoofdregel/default. */
  ogbKostensoort: string | null;
  economischeModule: PnLEconomischeModule;
  economischeCategorie: string;
  /** Geldigheidstijd (economische werkelijkheid) — begin, inclusief. */
  geldigVanafBoekjaar: number;
  geldigVanafPeriode: string;
  /** Geldigheidstijd — einde, EXCLUSIEF. `null` = nog steeds geldig (open einde). */
  geldigTotBoekjaar: number | null;
  geldigTotPeriode: string | null;
  /** Systeemtijd — wanneer deze rij is aangemaakt. Append-only, nooit gewijzigd na aanmaak. */
  aangemaaktOp: Date;
}

export interface PnLMappingResolutieInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  /** `null` = geen OGB-kostensoort op de boeking. */
  ogbKostensoort: string | null;
  boekjaar: number;
  boekperiode: string;
  /** Systeemtijd-cutoff — verplicht, geen impliciete `new Date()` in deze pure functie. */
  opSysteemtijdstip: Date;
}

export type PnLMappingSpecificiteit = "GL_OGB" | "GL_DEFAULT";

export interface PnLMappingGevonden {
  status: "GEMAPT";
  economischeModule: PnLEconomischeModule;
  economischeCategorie: string;
  specificiteit: PnLMappingSpecificiteit;
  gebruikteMapping: PnLBronmappingRegel;
}

export interface PnLMappingNietGevonden {
  status: "NIET_GEMAPT";
}

export type PnLMappingResolutieResultaat = PnLMappingGevonden | PnLMappingNietGevonden;

interface Periode {
  boekjaar: number;
  boekperiode: string;
}

/** Lexicografische vergelijking op (boekjaar, boekperiode) — `boekperiode` is een zero-padded string ("01".."12"), string-vergelijking is hier correct. */
function vergelijkPeriode(a: Periode, b: Periode): number {
  if (a.boekjaar !== b.boekjaar) return a.boekjaar - b.boekjaar;
  return a.boekperiode.localeCompare(b.boekperiode);
}

/** `geldigTot` is EXCLUSIEF: een regel geldt niet meer vanaf (en met) de `geldigTot`-periode zelf. */
function valtBinnenGeldigheid(regel: PnLBronmappingRegel, gevraagd: Periode): boolean {
  const vanaf: Periode = { boekjaar: regel.geldigVanafBoekjaar, boekperiode: regel.geldigVanafPeriode };
  if (vergelijkPeriode(gevraagd, vanaf) < 0) return false;
  if (regel.geldigTotBoekjaar !== null) {
    const tot: Periode = { boekjaar: regel.geldigTotBoekjaar, boekperiode: regel.geldigTotPeriode! };
    if (vergelijkPeriode(gevraagd, tot) >= 0) return false;
  }
  return true;
}

/**
 * Kiest, uit een reeds op geldigheid+systeemtijd gefilterde kandidatenlijst,
 * de regel met de HOOGSTE `aangemaaktOp` (het meest recent bekende inzicht —
 * zie moduledoc voor waarom dit historische correcties eenduidig oplost).
 * Fail-fast bij een exacte tie (twee regels met identiek `aangemaaktOp` voor
 * dezelfde combinatie): dat is een interne inconsistentie van de (latere)
 * schrijflaag, nooit iets om stilzwijgend/willekeurig op te lossen.
 */
function nieuwsteAangemaakt(kandidaten: readonly PnLBronmappingRegel[], context: string): PnLBronmappingRegel | null {
  if (kandidaten.length === 0) return null;
  const maxTijd = Math.max(...kandidaten.map((r) => r.aangemaaktOp.getTime()));
  const winnaars = kandidaten.filter((r) => r.aangemaaktOp.getTime() === maxTijd);
  if (winnaars.length > 1) {
    throw new Error(
      `Interne fout: meerdere PnL-bronmappingregels (${context}) met exact hetzelfde aangemaaktOp-tijdstip (${new Date(maxTijd).toISOString()}) — ambigu, kan niet eenduidig worden opgelost.`,
    );
  }
  return winnaars[0]!;
}

/**
 * De pure, centraal herbruikbare P&L-bronmappingresolver (FASE M1).
 *
 * Resolutievolgorde:
 *  1. Een geldige `(grootboekrekening, ogbKostensoort)`-specifieke mapping
 *     (alleen geprobeerd als de boeking zelf een OGB-kostensoort draagt).
 *  2. Anders de geldige GL-brede default-mapping (`ogbKostensoort: null`).
 *  3. Anders `NIET_GEMAPT` — nooit raden, nooit een impliciete fallback naar
 *     een andere grootboekrekening.
 *
 * Harde invariant: als zowel een GL+OGB- als een GL-default-mapping worden
 * gevonden, moeten ze dezelfde `economischeModule` dragen — een OGB mag
 * nooit naar een andere economische module "springen" dan zijn eigen GL
 * (zie moduledoc). Schending gooit een fail-fast fout, nooit een stille
 * inconsistentie.
 */
export function resolveerPnLBronmapping(invoer: PnLMappingResolutieInvoer, mappingregels: readonly PnLBronmappingRegel[]): PnLMappingResolutieResultaat {
  const gevraagdePeriode: Periode = { boekjaar: invoer.boekjaar, boekperiode: invoer.boekperiode };

  const kandidatenVoorGl = mappingregels.filter(
    (r) =>
      r.bedrijfsnr === invoer.bedrijfsnr &&
      r.grootboekrekening === invoer.grootboekrekening &&
      r.aangemaaktOp.getTime() <= invoer.opSysteemtijdstip.getTime() &&
      valtBinnenGeldigheid(r, gevraagdePeriode),
  );

  const glOgbKandidaten = invoer.ogbKostensoort !== null ? kandidatenVoorGl.filter((r) => r.ogbKostensoort === invoer.ogbKostensoort) : [];
  const glDefaultKandidaten = kandidatenVoorGl.filter((r) => r.ogbKostensoort === null);

  const gekozenGlOgb = nieuwsteAangemaakt(glOgbKandidaten, `bedrijfsnr=${invoer.bedrijfsnr}, GL=${invoer.grootboekrekening}, OGB=${invoer.ogbKostensoort}`);
  const gekozenGlDefault = nieuwsteAangemaakt(glDefaultKandidaten, `bedrijfsnr=${invoer.bedrijfsnr}, GL=${invoer.grootboekrekening} (default)`);

  if (gekozenGlOgb !== null) {
    if (gekozenGlDefault !== null && gekozenGlOgb.economischeModule !== gekozenGlDefault.economischeModule) {
      throw new Error(
        `Interne fout: GL+OGB-mapping (bedrijfsnr=${invoer.bedrijfsnr}, GL=${invoer.grootboekrekening}, OGB=${invoer.ogbKostensoort}) heeft economischeModule "${gekozenGlOgb.economischeModule}", ` +
          `maar de GL-default-mapping van dezelfde grootboekrekening heeft "${gekozenGlDefault.economischeModule}" — een OGB mag nooit naar een andere economische module springen dan zijn eigen GL.`,
      );
    }
    return {
      status: "GEMAPT",
      economischeModule: gekozenGlOgb.economischeModule,
      economischeCategorie: gekozenGlOgb.economischeCategorie,
      specificiteit: "GL_OGB",
      gebruikteMapping: gekozenGlOgb,
    };
  }

  if (gekozenGlDefault !== null) {
    return {
      status: "GEMAPT",
      economischeModule: gekozenGlDefault.economischeModule,
      economischeCategorie: gekozenGlDefault.economischeCategorie,
      specificiteit: "GL_DEFAULT",
      gebruikteMapping: gekozenGlDefault,
    };
  }

  return { status: "NIET_GEMAPT" };
}
