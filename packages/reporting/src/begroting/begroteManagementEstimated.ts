import Decimal from "decimal.js";
import type { BgControleErnst } from "./begroteHuuropbrengsten.js";
import type { BgManagementResultaat } from "./begroteManagementvergoeding.js";
import { normaliseerResterendeMaanden } from "./estimatedResterendeMaanden.js";
import { MANAGEMENT_WERKELIJK_CATEGORIEEN, type WerkelijkManagementResultaat } from "./werkelijkManagement.js";
import type { PnLBronBijdrage, PurePnLBovenEbitdaRegel } from "../pnlEngine.js";

/**
 * ESTIMATED MANAGEMENTVERGOEDING (Vervolgtranche 7; FO OB-026/030, Master Contract §6.3):
 *
 *   Estimated = Werkelijk (MANAGEMENTVERGOEDING) t/m afgesloten periode + resterende managementvergoeding
 *
 * GENERIEKE ONDERSTEUNING, GEEN OMZEILING VAN HET WERKELIJK-BRONGAT: OB-026 schrijft voor dat Estimated "realisatie uit de
 * boekhouding plus automatische berekening van de resterende bekende/indexeerbare managementvergoeding" gebruikt. De
 * resterende verwachting komt hier uit de maandregels van de bestaande Begroting-managementvergoeding (alle drie de
 * situaties — bestaand indexeren, bestaand wijzigen, nieuwe vergoeding — zitten al in die calculator).
 * Voor administraties zonder bewezen Werkelijk-mapping (bekend: 070, Master Contract §6.3) blijft de Werkelijk-dekking
 * onbevestigd; dan is `estimatedTotaal` `null` (ONBEKEND) — het ontbrekende Werkelijk wordt NOOIT als €0 behandeld, NOOIT
 * met de Begroting gevuld en NOOIT via een andere GL/OGB omzeild. Het BRONGAT blijft daarmee zichtbaar in de P&L.
 *
 * - Werkelijk exact éénmaal; geen verdeling. Geen persistentie (er is geen handmatige Estimated-invoer; alles is afgeleid).
 * - `begroting = null` (er is voor deze begroting geen managementvergoeding-invoer vastgelegd, of de post is niet actief)
 *   is ONBEKEND — "€0 ≠ niet ingevuld"; een bewuste €0 in de Begroting-invoer blijft een bekende €0.
 * - Een KRITIEKE Begroting-controle → ONBEKEND. Bewust €0 (geen resterende maanden of een €0-vergoeding) blijft bekend.
 * - De Begroting wordt niet gemuteerd.
 */

export interface EstimatedManagementControleItem {
  ernst: BgControleErnst;
  bericht: string;
}

export interface EstimatedManagementResultaat {
  resterendeMaanden: number[];
  /** `false` zodra Werkelijk-dekking niet bevestigd is of er niet-geclassificeerde boekingen zijn. */
  werkelijkVoldoendeBekend: boolean;
  /** `false` zodra er geen Begroting-invoer is of die een KRITIEKE controle heeft. */
  begrotingBetrouwbaar: boolean;
  /** Werkelijk MANAGEMENTVERGOEDING t/m de afgesloten periode (kostenrichting), exact éénmaal. */
  werkelijkTotaal: Decimal;
  /** `null` als de Begroting-basis ontbreekt of onbetrouwbaar is. */
  resterendeVerwachting: Decimal | null;
  /** `null` = onbekend. */
  estimatedTotaal: Decimal | null;
  /** Ongewijzigde doorgifte van de Begroting-jaartotaal; `null` zonder Begroting-invoer. */
  begrotingTotaal: Decimal | null;
  controleVereist: EstimatedManagementControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

export function berekenEstimatedManagement(
  begroting: BgManagementResultaat | null,
  werkelijk: WerkelijkManagementResultaat,
  werkelijkDekkingBevestigd: boolean,
  resterendeMaandenInvoer: readonly number[],
): EstimatedManagementResultaat {
  const resterendeMaanden = normaliseerResterendeMaanden(resterendeMaandenInvoer);
  const werkelijkVoldoendeBekend = werkelijkDekkingBevestigd && werkelijk.nietGeclassificeerdTotaal.isZero();
  const begrotingBetrouwbaar = begroting !== null && !begroting.controleVereist.some((c) => c.ernst === "KRITIEK");

  const werkelijkTotaal = werkelijk.perCategorie.find((c) => c.categorie === MANAGEMENT_WERKELIJK_CATEGORIEEN[0])!.categorieTotaal;
  const resterendeVerwachting = begroting !== null && begrotingBetrouwbaar ? som(begroting.regels.filter((r) => resterendeMaanden.includes(r.maand)).map((r) => r.bedrag)) : null;
  const estimatedTotaal = werkelijkVoldoendeBekend && resterendeVerwachting !== null ? werkelijkTotaal.plus(resterendeVerwachting) : null;

  const controleVereist: EstimatedManagementControleItem[] = [];
  if (!werkelijkVoldoendeBekend) {
    controleVereist.push({
      ernst: "WAARSCHUWING",
      bericht: "Werkelijk Managementvergoeding is niet bevestigd (geen bewezen bronmapping/dekking voor deze administratie) — Estimated onbekend; niet als €0 behandeld en niet met de Begroting gevuld.",
    });
  }
  if (begroting === null) {
    controleVereist.push({ ernst: "WAARSCHUWING", bericht: "Geen Managementvergoeding-invoer in de Begroting — resterende verwachting onbekend (geen bewuste €0)." });
  } else {
    controleVereist.push(...begroting.controleVereist.map((c): EstimatedManagementControleItem => ({ ernst: c.ernst, bericht: c.bericht })));
  }

  return {
    resterendeMaanden,
    werkelijkVoldoendeBekend,
    begrotingBetrouwbaar,
    werkelijkTotaal,
    resterendeVerwachting,
    estimatedTotaal,
    begrotingTotaal: begroting !== null ? begroting.jaartotaal.bedrag : null,
    controleVereist,
  };
}

/** Estimated Managementvergoeding → één P&L-regel MANAGEMENTVERGOEDING (Management en beheer, kosten); ONBEKEND blijft ONBEKEND. */
export function managementEstimatedNaarPnLBovenEbitdaRegels(resultaat: EstimatedManagementResultaat): PurePnLBovenEbitdaRegel[] {
  let waarde: PnLBronBijdrage;
  if (resultaat.estimatedTotaal !== null) {
    waarde = { status: "BEKEND", bedrag: resultaat.estimatedTotaal };
  } else if (!resultaat.werkelijkVoldoendeBekend) {
    waarde = { status: "ONBEKEND", dekkingReden: "NIET_GEMAPT", toelichting: "Estimated Managementvergoeding: Werkelijk-dekking voor de afgesloten periode is niet bevestigd (geen bewezen mapping)." };
  } else {
    waarde = { status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING", toelichting: "Estimated Managementvergoeding: geen (betrouwbare) Begroting-invoer voor de resterende periode." };
  }
  return [{ regelSleutel: MANAGEMENT_WERKELIJK_CATEGORIEEN[0], boomPositie: "BOVEN_EBITDA", groep: "MANAGEMENT_EN_BEHEER", contributieAard: "KOSTEN", waarde }];
}
