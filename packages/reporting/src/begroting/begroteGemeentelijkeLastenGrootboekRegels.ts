import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";
import { resolveerPnLBronmapping, type PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * Gemeentelijke lasten — DIRECTE BEGROTING PER RELEVANTE GL-POST (Master Contract §6.8,
 * besluit 2026-09-25, Vervolgtranche 4). UITSLUITEND de pure rekenlaag.
 *
 * BESLUIT (letterlijk uit het Master Contract): "Gemeentelijke lasten worden rechtstreeks
 * begroot op de voor de administratie relevante grootboekpost(en); er wordt geen totaalbedrag
 * achteraf verdeeld. Het systeem telt de begrotingsregels op tot één P&L-post `Gemeentelijke
 * lasten pand`. Grootboek is leidend; OGB/kostensoort is uitsluitend optionele verfijning. Bij
 * één relevante GL bestaat de post uit één begrotingsregel; bij meerdere relevante GL's worden
 * deze afzonderlijk begroot en vervolgens opgeteld. Historische realisatieverhoudingen worden
 * niet als automatische verdeelsleutel gebruikt."
 *
 * WAT DEZE MODULE DOET
 *  - Elke begrotingsregel = één GL (verplicht) + optionele OGB + één JAARBEDRAG dat de gebruiker
 *    zelf invoert. Er is GEEN verdeelsleutel, GEEN percentage, GEEN afleiding van een regel uit
 *    een ander bedrag: deze module deelt nergens een totaal op.
 *  - `begroteGemeentelijkeLastenPost` = SOM van de regels = de ENE P&L-post "Gemeentelijke
 *    lasten pand". Subtotalen per GL zijn afgeleide informatie, geen invoer.
 *  - GEEN periodiciteit: net als de bestaande module kent de Begroting hier een vlak jaarbedrag
 *    (gemeentelijke lasten worden niet gelijkmatig geboekt; er is geen Q1–Q4-besluit).
 *
 * WAT "RELEVANTE GL" BETEKENT — GEGEVENSGEDREVEN, NOOIT GEHARDCODEERD
 *  De set relevante GL's is per administratie verschillend (bronbewijs: 070 boekt op GL4700 +
 *  GL4710, andere administraties op één GL4701). Zij wordt uitsluitend afgeleid uit de centrale,
 *  per-administratie P&L-bronmapping (`economischeModule = GEMEENTELIJKE_LASTEN`) via
 *  `bepaalRelevanteGemeentelijkeLastenGrootboeken`; geen enkele GL/OGB staat in deze module.
 *  Een regel met een GL die niet relevant is (of een OGB die binnen die GL niet in de mapping
 *  bestaat) is een KRITIEK "Controle vereist" — nooit stil aanvaard, nooit geraden. Financiële
 *  classificatie loopt zo altijd via de centrale mappinglaag (CLAUDE.md §6).
 *
 * INVARIANTEN
 *  - `null` (nog niet ingevuld) is nooit €0: een regel zonder bedrag is KRITIEK (blokkeert
 *    beoordeling/vaststellen) en draagt veilig €0 bij; een expliciet `Decimal(0)` is een geldige,
 *    bewuste keuze zonder melding.
 *  - Negatieve jaarbedragen zijn geldig met een WAARSCHUWING (zelfde conventie als de overige
 *    begrotingsmodules).
 *  - Een regel blijft financieel meetellen ook als zij een KRITIEK draagt (zelfde precedent als
 *    WOZ-objecten zonder complex): het KRITIEK blokkeert de vaststelling, de bijdrage verdwijnt
 *    niet stil.
 *  - Decimal-rekenen, geen Math.abs, geen afronding.
 *  - Deze module raakt het WOZ-gebaseerde voorstel (`berekenBegroteGemeentelijkeLasten`) NIET:
 *    dat blijft een aparte referentie en voedt GEEN regel automatisch.
 */

export type BgGlLastenControleErnst = BgControleErnst;

export interface BgGlLastenControleItem {
  /** Positie van de betrokken regel in de invoerlijst van deze aanroep — `null` = module-breed. */
  regelIndex: number | null;
  ernst: BgGlLastenControleErnst;
  bericht: string;
}

export interface BgGlLastenRegelInvoer {
  /** `null`/leeg = nog niet gekozen — KRITIEK. */
  grootboekrekening: string | null;
  /** Optionele verfijning binnen dezelfde GL; `null` = geen OGB. Een lege string is ongeldig (KRITIEK), nooit stil `null`. */
  ogbKostensoort: string | null;
  /** `null` = nog niet ingevuld (KRITIEK, veilige bijdrage 0); expliciete `Decimal(0)` = bewust €0. */
  jaarbedrag: Decimal | null;
}

/** Eén voor de administratie relevante GL, afgeleid uit de centrale mapping (zie `bepaalRelevanteGemeentelijkeLastenGrootboeken`). */
export interface BgRelevantGrootboek {
  grootboekrekening: string;
  /** `true` als de mapping deze GL ook zonder OGB classificeert (GL-default): dan is elke OGB-verfijning binnen deze GL toegestaan. */
  glDefault: boolean;
  /** De OGB's met een eigen GL+OGB-mappingregel binnen deze GL. Bij `glDefault = false` zijn alleen deze OGB's toegestaan. */
  ogbKostensoorten: readonly string[];
}

export interface BgGlLastenRegelUitkomst {
  index: number;
  /** De oorspronkelijke invoer — traceerbaarheid, inclusief een eventueel ongeldig/ontbrekend veld. */
  invoer: BgGlLastenRegelInvoer;
  /** Veilig: `Decimal(0)` als `jaarbedrag` ontbreekt/ongeldig is (met KRITIEK). Anders het ingevoerde bedrag, ongewijzigd. */
  bijdrage: Decimal;
}

export interface BgGlLastenGrootboekSubtotaal {
  grootboekrekening: string;
  aantalRegels: number;
  subtotaal: Decimal;
}

export interface BgGlLastenResultaat {
  regels: BgGlLastenRegelUitkomst[];
  /** De ENE P&L-post "Gemeentelijke lasten pand": de som van alle regels. Geen regels → `Decimal(0)` (bewust €0 hangt af van `beoordeeld` op moduleniveau). */
  begroteGemeentelijkeLastenPost: Decimal;
  /** Afgeleid, in volgorde van eerste voorkomen; alleen regels met een niet-lege GL. */
  perGrootboek: BgGlLastenGrootboekSubtotaal[];
  controleVereist: BgGlLastenControleItem[];
}

function leegOfNull(waarde: string | null): waarde is null | "" {
  return waarde === null || waarde.trim().length === 0;
}

function isGeldigDecimal(waarde: Decimal | null): waarde is Decimal {
  return waarde !== null && !waarde.isNaN();
}

export function berekenBegroteGemeentelijkeLastenPerGrootboek(
  regelsInvoer: readonly BgGlLastenRegelInvoer[],
  relevanteGrootboeken: readonly BgRelevantGrootboek[],
): BgGlLastenResultaat {
  const controleVereist: BgGlLastenControleItem[] = [];
  const meldRegel = (index: number, bericht: string, ernst: BgGlLastenControleErnst = "KRITIEK") => controleVereist.push({ regelIndex: index, ernst, bericht });

  const relevantPerGl = new Map(relevanteGrootboeken.map((g) => [g.grootboekrekening, g]));
  const gezienSleutels = new Map<string, number>();

  const regels: BgGlLastenRegelUitkomst[] = regelsInvoer.map((invoer, index) => {
    const gl = invoer.grootboekrekening;
    if (leegOfNull(gl)) {
      meldRegel(index, `Gemeentelijke-lastenregel ${index}: grootboekrekening ontbreekt — verplicht; de regel is GL-leidend. Het bedrag blijft financieel meetellen.`);
    } else {
      const relevant = relevantPerGl.get(gl);
      if (relevant === undefined) {
        meldRegel(
          index,
          `Gemeentelijke-lastenregel ${index}: grootboekrekening ${gl} is voor deze administratie geen relevante Gemeentelijke-lasten-GL volgens de centrale mapping — Controle vereist; het bedrag blijft financieel meetellen.`,
        );
      } else if (invoer.ogbKostensoort !== null) {
        if (invoer.ogbKostensoort.trim().length === 0) {
          meldRegel(index, `Gemeentelijke-lastenregel ${index}: OGB/kostensoort is leeg — laat het veld leeg (geen OGB) of kies een bestaande OGB binnen GL ${gl}.`);
        } else if (!relevant.glDefault && !relevant.ogbKostensoorten.includes(invoer.ogbKostensoort)) {
          meldRegel(
            index,
            `Gemeentelijke-lastenregel ${index}: OGB/kostensoort ${invoer.ogbKostensoort} bestaat binnen GL ${gl} niet in de centrale mapping — OGB is uitsluitend een verfijning binnen dezelfde GL; Controle vereist.`,
          );
        }
      }

      const sleutel = `${gl}\u0000${invoer.ogbKostensoort ?? ""}`;
      const eerder = gezienSleutels.get(sleutel);
      if (eerder !== undefined) {
        meldRegel(
          index,
          `Gemeentelijke-lastenregel ${index}: dubbele regel voor GL ${gl}${invoer.ogbKostensoort !== null ? ` / OGB ${invoer.ogbKostensoort}` : " (zonder OGB)"} — komt ook voor als regel ${eerder}; één regel per GL(+OGB), voeg de bedragen bewust samen.`,
        );
      } else {
        gezienSleutels.set(sleutel, index);
      }
    }

    const bedrag = invoer.jaarbedrag;
    if (bedrag === null) {
      meldRegel(index, `Gemeentelijke-lastenregel ${index}: jaarbedrag is niet ingevuld — verplicht voor beoordelen/vaststellen (leeg is niet €0); veilige bijdrage 0 toegepast.`);
    } else if (bedrag.isNaN()) {
      meldRegel(index, `Gemeentelijke-lastenregel ${index}: jaarbedrag is geen geldig getal (NaN) — veilige bijdrage 0 toegepast.`);
    } else if (bedrag.isNegative()) {
      meldRegel(index, `Gemeentelijke-lastenregel ${index}: jaarbedrag is negatief (${bedrag.toString()}) — ongebruikelijk, toegestaan, telt rekenkundig mee.`, "WAARSCHUWING");
    }

    return { index, invoer, bijdrage: isGeldigDecimal(bedrag) ? bedrag : new Decimal(0) };
  });

  // Aandachtspunten per GL — allemaal niet-blokkerend (inhoudelijke waarschuwingen).
  const glMetOgbRegel = new Set<string>();
  const glZonderOgbRegel = new Set<string>();
  for (const { invoer } of regels) {
    if (leegOfNull(invoer.grootboekrekening)) continue;
    (invoer.ogbKostensoort !== null ? glMetOgbRegel : glZonderOgbRegel).add(invoer.grootboekrekening as string);
  }
  for (const gl of glMetOgbRegel) {
    if (glZonderOgbRegel.has(gl)) {
      controleVereist.push({
        regelIndex: null,
        ernst: "WAARSCHUWING",
        bericht: `GL ${gl} heeft zowel een regel zonder OGB als regel(s) met OGB — de bedragen worden opgeteld; controleer dat ze elkaar niet overlappen.`,
      });
    }
  }
  const gedekteGl = new Set([...glMetOgbRegel, ...glZonderOgbRegel]);
  for (const relevant of relevanteGrootboeken) {
    if (!gedekteGl.has(relevant.grootboekrekening)) {
      controleVereist.push({
        regelIndex: null,
        ernst: "WAARSCHUWING",
        bericht: `Relevante GL ${relevant.grootboekrekening} heeft geen begrotingsregel — telt als €0 in de post; voer een regel met een bewust bedrag in als hier lasten worden verwacht.`,
      });
    }
  }

  const perGlMap = new Map<string, { aantalRegels: number; subtotaal: Decimal }>();
  for (const { invoer, bijdrage } of regels) {
    if (leegOfNull(invoer.grootboekrekening)) continue;
    const huidig = perGlMap.get(invoer.grootboekrekening) ?? { aantalRegels: 0, subtotaal: new Decimal(0) };
    perGlMap.set(invoer.grootboekrekening, { aantalRegels: huidig.aantalRegels + 1, subtotaal: huidig.subtotaal.plus(bijdrage) });
  }

  return {
    regels,
    begroteGemeentelijkeLastenPost: regels.reduce((totaal, r) => totaal.plus(r.bijdrage), new Decimal(0)),
    perGrootboek: [...perGlMap.entries()].map(([grootboekrekening, v]) => ({ grootboekrekening, aantalRegels: v.aantalRegels, subtotaal: v.subtotaal })),
    controleVereist,
  };
}

const BOEKPERIODEN_PER_JAAR = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;

export interface BgRelevantieContext {
  bedrijfsnr: string;
  begrotingsjaar: number;
}

/**
 * Bepaalt, GEGEVENSGEDREVEN uit de centrale per-administratie P&L-bronmapping, welke grootboekrekeningen
 * (en welke OGB-verfijningen daarbinnen) voor deze administratie Gemeentelijke lasten dragen in het
 * begrotingsjaar. Geen enkele GL/OGB is hier bekend: alleen mappingregels met
 * `economischeModule = GEMEENTELIJKE_LASTEN` (na resolutie via de centrale resolver) tellen mee.
 *
 * Een sleutel is relevant als de resolver hem in MINSTENS ÉÉN boekperiode van het begrotingsjaar naar
 * `GEMEENTELIJKE_LASTEN` vertaalt (een mapping die halverwege het jaar ingaat of eindigt telt dus mee).
 * Het systeemtijd-afkappunt is het nieuwste `aangemaaktOp` binnen de mapping van deze administratie —
 * "alles wat het systeem weet" zonder klok (deterministisch; geen `new Date()`).
 *
 * Geen mappingregels voor de administratie → lege lijst (geen enkele GL is dan bewezen relevant; elke
 * begrotingsregel krijgt dan een KRITIEK — nooit een gok).
 */
export function bepaalRelevanteGemeentelijkeLastenGrootboeken(mappingregels: readonly PnLBronmappingRegel[], context: BgRelevantieContext): BgRelevantGrootboek[] {
  const regelsAdministratie = mappingregels.filter((r) => r.bedrijfsnr === context.bedrijfsnr);
  if (regelsAdministratie.length === 0) return [];

  const opSysteemtijdstip = new Date(Math.max(...regelsAdministratie.map((r) => r.aangemaaktOp.getTime())));
  const resolveertNaarGemeentelijkeLasten = (grootboekrekening: string, ogbKostensoort: string | null, specificiteit: "GL_OGB" | "GL_DEFAULT"): boolean =>
    BOEKPERIODEN_PER_JAAR.some((boekperiode) => {
      const resultaat = resolveerPnLBronmapping(
        { bedrijfsnr: context.bedrijfsnr, grootboekrekening, ogbKostensoort, boekjaar: context.begrotingsjaar, boekperiode, opSysteemtijdstip },
        regelsAdministratie,
      );
      return resultaat.status === "GEMAPT" && resultaat.economischeModule === "GEMEENTELIJKE_LASTEN" && resultaat.specificiteit === specificiteit;
    });

  const grootboeken = [...new Set(regelsAdministratie.map((r) => r.grootboekrekening))].sort();
  const relevant: BgRelevantGrootboek[] = [];
  for (const grootboekrekening of grootboeken) {
    const glDefault = resolveertNaarGemeentelijkeLasten(grootboekrekening, null, "GL_DEFAULT");
    const kandidaatOgbs = [...new Set(regelsAdministratie.filter((r) => r.grootboekrekening === grootboekrekening && r.ogbKostensoort !== null).map((r) => r.ogbKostensoort as string))].sort();
    const ogbKostensoorten = kandidaatOgbs.filter((ogb) => resolveertNaarGemeentelijkeLasten(grootboekrekening, ogb, "GL_OGB"));
    if (glDefault || ogbKostensoorten.length > 0) {
      relevant.push({ grootboekrekening, glDefault, ogbKostensoorten });
    }
  }
  return relevant;
}
