import Decimal from "decimal.js";
import type { BgControleErnst, BgHuurResultaat } from "./begroteHuuropbrengsten.js";
import type { BgBeheerResultaat } from "./begroteBeheersvergoeding.js";
import { normaliseerResterendeMaanden } from "./estimatedResterendeMaanden.js";
import { BEHEER_WERKELIJK_CATEGORIEEN, type WerkelijkBeheerResultaat } from "./werkelijkBeheer.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * ESTIMATED BEHEERSVERGOEDING (Vervolgtranche 7; FO OB-010/012/024/030, Master Contract §6.2):
 *
 *   Estimated = Werkelijk (BEHEERKOSTEN) t/m laatst afgesloten periode + resterende beheersvergoeding
 *
 * - WERKELIJK: het bestaande Werkelijk-Beheerresultaat (één categorie BEHEERKOSTEN, kostenrichting positief), exact
 *   éénmaal meegeteld; niet verdeeld over vast/variabel of over complexen (de bron heeft die koppeling niet).
 * - RESTERENDE VERWACHTING (automatisch, OB-024): de maandregels van de bestaande Begroting-beheersvergoeding voor de
 *   resterende maanden. VAST = het bestaande vaste bedrag met de bestaande indexeringsregels (maandniveau, alleen als de
 *   configuratie een indexatiedatum in het jaar heeft — er wordt nooit een indexatie geprojecteerd of verzonnen).
 *   VARIABEL = het geconfigureerde percentage × de NETTO HUUR VAN HETZELFDE COMPLEX, maand voor maand — dezelfde
 *   Begroting-huurregels die Estimated Huur (`berekenEstimatedHuur`) voor de resterende maanden als verwachting gebruikt.
 *   De variabele beheersvergoeding sluit daarmee exact aan op de resterende Estimated-huurgrondslag; die grondslag wordt per
 *   complex teruggegeven (`resterendeNettoHuurGrondslag`) zodat de aansluiting controleerbaar is. Percentages en bedragen
 *   komen uitsluitend uit de bestaande configuratie — niets wordt opnieuw ingevoerd of geraden.
 * - Geen persistentie: er is geen handmatige Estimated-invoer voor beheersvergoeding (alles is afgeleid).
 * - ONBEKEND ≠ €0: `estimatedTotaal` is `null` als Werkelijk-dekking niet is bevestigd (of er niet-geclassificeerde
 *   boekingen zijn) of als de Begroting-basis (Beheer of de onderliggende Huur) een KRITIEKE controle heeft. Een complex
 *   met huur maar zonder beheerconfiguratie krijgt — zoals in de Begroting — een WAARSCHUWING en geen vergoeding
 *   ("niet ingesteld ≠ 0%"), geen gemiddeld tarief. Bewust €0 (bv. lege resterende maanden) blijft een bekende waarde.
 * - De Begroting wordt niet gemuteerd.
 */

export interface EstimatedBeheerControleItem {
  ernst: BgControleErnst;
  bericht: string;
}

export interface EstimatedBeheerComplexResterend {
  complexnummer: string;
  resterendVast: Decimal;
  resterendVariabel: Decimal;
  resterendTotaal: Decimal;
  /** Netto begrote huur van dit complex over de resterende maanden — dezelfde basis als Estimated Huur. */
  resterendeNettoHuurGrondslag: Decimal;
}

export interface EstimatedBeheerResultaat {
  begrotingsjaar: number;
  resterendeMaanden: number[];
  werkelijkVoldoendeBekend: boolean;
  begrotingBetrouwbaar: boolean;
  /** Werkelijk BEHEERKOSTEN t/m de afgesloten periode (kostenrichting, positief), exact éénmaal. */
  werkelijkTotaal: Decimal;
  resterendVast: Decimal;
  resterendVariabel: Decimal;
  /** `null` als de Begroting-basis niet betrouwbaar is. */
  resterendeVerwachting: Decimal | null;
  /** `null` = onbekend. */
  estimatedTotaal: Decimal | null;
  /** Ongewijzigde doorgifte van de Begroting — Estimated berekent of muteert haar nooit. */
  begrotingTotaal: Decimal;
  perComplex: EstimatedBeheerComplexResterend[];
  controleVereist: EstimatedBeheerControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

export function berekenEstimatedBeheer(
  huurBegroting: BgHuurResultaat,
  begroting: BgBeheerResultaat,
  werkelijk: WerkelijkBeheerResultaat,
  werkelijkDekkingBevestigd: boolean,
  resterendeMaandenInvoer: readonly number[],
): EstimatedBeheerResultaat {
  const resterendeMaanden = normaliseerResterendeMaanden(resterendeMaandenInvoer);
  const werkelijkVoldoendeBekend = werkelijkDekkingBevestigd && werkelijk.nietGeclassificeerdTotaal.isZero();
  const begrotingBetrouwbaar = ![...begroting.controleVereist, ...huurBegroting.controleVereist].some((c) => c.ernst === "KRITIEK");

  const perComplex: EstimatedBeheerComplexResterend[] = begroting.complexen.map((complex) => {
    const regels = complex.regels.filter((r) => resterendeMaanden.includes(r.maand));
    const grondslag = som(
      huurBegroting.contracten
        .filter((c) => c.complexnummer === complex.complexnummer)
        .flatMap((c) => c.regels.filter((r) => resterendeMaanden.includes(r.maand)).map((r) => r.nettoHuur)),
    );
    return {
      complexnummer: complex.complexnummer,
      resterendVast: som(regels.map((r) => r.vastNaIndexatie)),
      resterendVariabel: som(regels.map((r) => r.variabeleVergoeding)),
      resterendTotaal: som(regels.map((r) => r.totaleVergoeding)),
      resterendeNettoHuurGrondslag: grondslag,
    };
  });

  const resterendVast = som(perComplex.map((c) => c.resterendVast));
  const resterendVariabel = som(perComplex.map((c) => c.resterendVariabel));
  const resterendeVerwachting = begrotingBetrouwbaar ? resterendVast.plus(resterendVariabel) : null;
  const werkelijkTotaal = werkelijk.perCategorie.find((c) => c.categorie === BEHEER_WERKELIJK_CATEGORIEEN[0])!.categorieTotaal;
  const estimatedTotaal = werkelijkVoldoendeBekend && resterendeVerwachting !== null ? werkelijkTotaal.plus(resterendeVerwachting) : null;

  const controleVereist: EstimatedBeheerControleItem[] = [
    ...begroting.controleVereist.map((c): EstimatedBeheerControleItem => ({ ernst: c.ernst, bericht: c.bericht })),
    {
      ernst: "INFORMATIEF",
      bericht: `Resterende beheersvergoeding gebaseerd op de Begroting-beheerconfiguratie en de Begroting-huurgrondslag (contractstand per ${huurBegroting.bronPeildatum.toISOString().slice(0, 10)}); latere contractwijzigingen zijn niet meegenomen.`,
    },
  ];
  if (huurBegroting.controleVereist.some((c) => c.ernst === "KRITIEK")) {
    controleVereist.push({ ernst: "KRITIEK", bericht: "De Begroting-huur (grondslag van de variabele vergoeding) bevat kritieke controles — Estimated onbekend." });
  }

  return {
    begrotingsjaar: begroting.begrotingsjaar,
    resterendeMaanden,
    werkelijkVoldoendeBekend,
    begrotingBetrouwbaar,
    werkelijkTotaal,
    resterendVast,
    resterendVariabel,
    resterendeVerwachting,
    estimatedTotaal,
    begrotingTotaal: begroting.portefeuilleTotalen.totaleVergoeding,
    perComplex,
    controleVereist,
  };
}

/**
 * Estimated Beheersvergoeding → één P&L-regel BEHEERKOSTEN (MANAGEMENT_EN_BEHEER, kosten) — dezelfde sleutel als Werkelijk
 * en Begroting. Vast en variabel blijven afzonderlijk zichtbaar in het resultaat; de P&L kent één post. ONBEKEND blijft
 * ONBEKEND (onbevestigde dekking → NIET_GEMAPT, onbetrouwbare basis → GEEN_BEOORDELING).
 */
export function beheerEstimatedNaarPnLBovenEbitdaRegels(resultaat: EstimatedBeheerResultaat): PurePnLBovenEbitdaRegel[] {
  let waarde: PnLBronBijdrage;
  if (resultaat.estimatedTotaal !== null) {
    waarde = { status: "BEKEND", bedrag: resultaat.estimatedTotaal };
  } else if (!resultaat.werkelijkVoldoendeBekend) {
    waarde = { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: "Estimated Beheersvergoeding: Werkelijk-dekking voor de afgesloten periode is niet voldoende bevestigd." };
  } else {
    waarde = { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: "Estimated Beheersvergoeding: de Begroting-basis (beheer of onderliggende huur) is niet betrouwbaar." };
  }
  return [{ regelSleutel: BEHEER_WERKELIJK_CATEGORIEEN[0], boomPositie: "BOVEN_EBITDA", groep: "MANAGEMENT_EN_BEHEER", contributieAard: "KOSTEN", waarde }];
}
