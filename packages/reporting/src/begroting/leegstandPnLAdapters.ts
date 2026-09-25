import Decimal from "decimal.js";
import { LEEGSTAND_CATEGORIEEN, type BgLeegstandCategorie, type EstimatedLeegstandResultaat, type WerkelijkLeegstandResultaat } from "./begroteLeegstand.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel, PurePnLSpecificatieRegel } from "../pnlEngine.js";

/**
 * LEEGSTANDSKOSTEN → PURE P&L (Vervolgtranche 8): de P&L kent ÉÉN post `Leegstandskosten` (Master Contract §5, OB-031). De
 * drie kostensoorten (Nuts, Servicekosten, Overige) zijn ONDERBOUWING en verschijnen NIET als drie hoofdregels: ze staan als
 * `specificaties` op die ene regel (puur traceerbaarheid — de engine telt ze nooit zelfstandig op).
 *
 * BEDRAG EN VOLLEDIGHEID ("onbekend is geen €0", "bekende bedragen blijven als beste-weten-som zichtbaar"):
 *  - alle drie bekend → één BEKEND-regel `LEEGSTANDSKOSTEN` = Nuts + Servicekosten + Overige;
 *  - een deel bekend → de regel `LEEGSTANDSKOSTEN` is de som van de BEKENDE onderdelen, én een aparte ONBEKEND-regel
 *    `LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL` (zelfde conventie als de bestaande `…_NIET_GECLASSIFICEERD`-regels) maakt de
 *    P&L-uitkomst ONVOLLEDIG en noemt precies welke onderdelen onbekend zijn;
 *  - niets bekend → de regel `LEEGSTANDSKOSTEN` zelf is ONBEKEND.
 * Subtotalen, Totaal kosten en EBITDA worden uitsluitend door `berekenPnLBoom` afgeleid; hier wordt niets opgeteld buiten
 * de ene post zelf.
 *
 * Alleen vertalen: geen GL/OGB/administratie in dit bestand. Kosten komen positief door (identiteit, zoals de overige
 * kosten-adapters).
 */

export const LEEGSTANDSKOSTEN_PNL_SLEUTEL = "LEEGSTANDSKOSTEN";
export const LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL_SLEUTEL = "LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL";
export const LEEGSTANDSKOSTEN_NIET_GECLASSIFICEERD_SLEUTEL = "LEEGSTANDSKOSTEN_NIET_GECLASSIFICEERD";

interface Onderdeel {
  categorie: BgLeegstandCategorie;
  waarde: PnLBronBijdrage;
}

const kostenRegel = (regelSleutel: string, waarde: PnLBronBijdrage, specificaties?: readonly PurePnLSpecificatieRegel[]): PurePnLBovenEbitdaRegel => ({
  regelSleutel,
  boomPositie: "BOVEN_EBITDA",
  groep: "EXPLOITATIE_LASTEN",
  contributieAard: "KOSTEN",
  waarde,
  ...(specificaties !== undefined ? { specificaties } : {}),
});

const isBekend = (w: PnLBronBijdrage): w is { status: "BEKEND" | "NIET_VAN_TOEPASSING"; bedrag: Decimal } => w.status === "BEKEND" || w.status === "NIET_VAN_TOEPASSING";

/** De ene post `Leegstandskosten` uit de drie onderdelen (zie moduledoc). `extra` = aanvullende ONBEKEND-regels (bv. niet-geclassificeerde boekingen). */
function bouwLeegstandRegels(onderdelen: readonly Onderdeel[], extra: readonly PurePnLBovenEbitdaRegel[] = []): PurePnLBovenEbitdaRegel[] {
  const specificaties: PurePnLSpecificatieRegel[] = onderdelen.map((o) => ({ label: o.categorie, waarde: o.waarde }));
  const bekend = onderdelen.filter((o) => isBekend(o.waarde));
  const onbekend = onderdelen.filter((o) => !isBekend(o.waarde));

  if (bekend.length === 0) {
    const eerste = onbekend[0]!.waarde as Extract<PnLBronBijdrage, { status: "ONBEKEND" }>;
    return [
      kostenRegel(
        LEEGSTANDSKOSTEN_PNL_SLEUTEL,
        { status: "ONBEKEND", dekkingReden: eerste.dekkingReden, toelichting: `Leegstandskosten: geen enkel onderdeel bekend — ${onbekend.map((o) => `${o.categorie}: ${(o.waarde as { toelichting: string }).toelichting}`).join(" | ")}` },
        specificaties,
      ),
      ...extra,
    ];
  }

  const som = bekend.reduce((totaal, o) => totaal.plus((o.waarde as { bedrag: Decimal }).bedrag), new Decimal(0));
  const regels = [kostenRegel(LEEGSTANDSKOSTEN_PNL_SLEUTEL, { status: "BEKEND", bedrag: som }, specificaties)];
  if (onbekend.length > 0) {
    const eerste = onbekend[0]!.waarde as Extract<PnLBronBijdrage, { status: "ONBEKEND" }>;
    regels.push(
      kostenRegel(LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL_SLEUTEL, {
        status: "ONBEKEND",
        dekkingReden: eerste.dekkingReden,
        toelichting: `Leegstandskosten: onderdeel/onderdelen onbekend (${onbekend.map((o) => `${o.categorie}: ${(o.waarde as { toelichting: string }).toelichting}`).join(" | ")}) — de post is de som van de bekende onderdelen (beste weten).`,
      }),
    );
  }
  return [...regels, ...extra];
}

// ── Begroting ───────────────────────────────────────────────────────────────

export interface LeegstandBegrotingPnLInvoer {
  perCategorie: readonly { categorie: BgLeegstandCategorie; beoordeeld: boolean; categorieTotaal: Decimal }[];
  controleVereist: readonly { categorie: BgLeegstandCategorie; ernst: string }[];
}

/** Begroting: een kostensoort is BEKEND als zij bewust is beoordeeld (ook met 0 regels = bewuste €0) en geen KRITIEKE controle heeft. */
export function leegstandBegrotingNaarPnLBovenEbitdaRegels(begroting: LeegstandBegrotingPnLInvoer): PurePnLBovenEbitdaRegel[] {
  const onderdelen: Onderdeel[] = LEEGSTAND_CATEGORIEEN.map((categorie) => {
    const c = begroting.perCategorie.find((x) => x.categorie === categorie)!;
    const kritiek = begroting.controleVereist.some((x) => x.categorie === categorie && x.ernst === "KRITIEK");
    const waarde: PnLBronBijdrage =
      c.beoordeeld && !kritiek
        ? { status: "BEKEND", bedrag: c.categorieTotaal }
        : { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: "Begroting niet bewust beoordeeld of kritieke controles." };
    return { categorie, waarde };
  });
  return bouwLeegstandRegels(onderdelen);
}

// ── Werkelijk ───────────────────────────────────────────────────────────────

/**
 * Werkelijk Leegstand (hoofddomein LEEGSTAND, per administratie via de centrale mapping): een kostensoort is alleen BEKEND
 * als de dekking is bevestigd én de administratie voor deze kostensoort een bewezen mapping heeft (`gemapteCategorieen`,
 * `bepaalGemapteCategorieen`). Zonder mapping is het Werkelijk ONBEKEND — geen bevestigde €0. Niet-geclassificeerde
 * boekingen (op een LEEGSTAND-GL zonder bekende OGB) komen als aparte ONBEKEND-regel; zij worden nooit over kostensoorten
 * verdeeld. Servicekosten die volgens de mapping onder het domein Servicekosten eigenaar vallen (GL4350-achtige GL's met een
 * leegstand-OGB) zijn NIET deze categorie en komen hier nooit terecht: een OGB creëert geen ander hoofddomein.
 */
export function leegstandWerkelijkNaarPnLBovenEbitdaRegels(
  resultaat: WerkelijkLeegstandResultaat,
  brondekkingBevestigd: boolean,
  gemapteCategorieen?: ReadonlySet<string>,
): PurePnLBovenEbitdaRegel[] {
  const onderdelen: Onderdeel[] = LEEGSTAND_CATEGORIEEN.map((categorie) => {
    let waarde: PnLBronBijdrage;
    if (!brondekkingBevestigd) {
      waarde = { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: "Bron-/mappingdekking voor Leegstand-Werkelijk is niet expliciet bevestigd door de aanroepende laag." };
    } else if (gemapteCategorieen !== undefined && !gemapteCategorieen.has(categorie)) {
      waarde = { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: `voor deze administratie bestaat geen bewezen bronmapping naar ${categorie} in het domein Leegstand — onbekend, geen bevestigde €0.` };
    } else {
      waarde = { status: "BEKEND", bedrag: resultaat.perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal };
    }
    return { categorie, waarde };
  });

  const extra: PurePnLBovenEbitdaRegel[] = [];
  if (brondekkingBevestigd && !resultaat.nietGeclassificeerdTotaal.isZero()) {
    extra.push(
      kostenRegel(LEEGSTANDSKOSTEN_NIET_GECLASSIFICEERD_SLEUTEL, {
        status: "ONBEKEND",
        dekkingReden: "NIET_GEMAPT",
        toelichting: `Leegstand-Werkelijk heeft ${resultaat.nietGeclassificeerdAantalBoekingen} niet-geclassificeerde boeking(en), totaal ${resultaat.nietGeclassificeerdTotaal.toString()} — niet toe te rekenen aan een kostensoort.`,
      }),
    );
  }
  return bouwLeegstandRegels(onderdelen, extra);
}

// ── Estimated ───────────────────────────────────────────────────────────────

export interface LeegstandEstimatedDekking {
  werkelijkDekkingBevestigd: boolean;
  /** Buiten alle kostensoorten gehouden Werkelijk — een niet-nul waarde betekent dat het Werkelijk-beeld onvolledig is. */
  nietGeclassificeerdTotaal: Decimal;
  gemapteCategorieen?: ReadonlySet<string>;
}

/**
 * Estimated Leegstand: per kostensoort `Werkelijk + handmatige resterende verwachting` (`berekenEstimatedLeegstand`); BEKEND
 * alleen bij bevestigde Werkelijk-dekking, bewezen mapping voor die kostensoort en een ingevulde verwachting (bewust €0 telt
 * als ingevuld). Anders ONBEKEND — het Werkelijk-BRONGAT wordt niet met de verwachting of de Begroting gevuld.
 */
export function leegstandEstimatedNaarPnLBovenEbitdaRegels(estimated: EstimatedLeegstandResultaat, dekking: LeegstandEstimatedDekking): PurePnLBovenEbitdaRegel[] {
  const werkelijkVoldoende = dekking.werkelijkDekkingBevestigd && dekking.nietGeclassificeerdTotaal.isZero();
  const onderdelen: Onderdeel[] = LEEGSTAND_CATEGORIEEN.map((categorie) => {
    const c = estimated.perCategorie.find((x) => x.categorie === categorie)!;
    let waarde: PnLBronBijdrage;
    if (!werkelijkVoldoende) {
      waarde = { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: "Werkelijk-dekking voor de afgesloten periode is niet voldoende bevestigd." };
    } else if (dekking.gemapteCategorieen !== undefined && !dekking.gemapteCategorieen.has(categorie)) {
      waarde = { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: `voor deze administratie bestaat geen bewezen bronmapping naar ${categorie} — Werkelijk onbekend, dus Estimated onbekend.` };
    } else if (c.estimatedTotaal === null) {
      waarde = { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: "resterende verwachting nog niet ingevuld (ook een bewuste €0 moet expliciet zijn)." };
    } else {
      waarde = { status: "BEKEND", bedrag: c.estimatedTotaal };
    }
    return { categorie, waarde };
  });
  return bouwLeegstandRegels(onderdelen);
}
