import Decimal from "decimal.js";
import type { BgBelastOnbelast, BgControleErnst, BgHuurResultaat } from "./begroteHuuropbrengsten.js";
import { normaliseerResterendeMaanden } from "./estimatedResterendeMaanden.js";
import { HUUR_WERKELIJK_CATEGORIEEN, type HuurWerkelijkCategorie, type WerkelijkHuurResultaat } from "./werkelijkHuur.js";

/**
 * ESTIMATED HUUR (Vervolgtranche 7; FO OB-024/030, Master Contract §4/§6.1):
 *
 *   Estimated = Werkelijk t/m laatst afgesloten periode + verwachting resterende periode
 *
 * - WERKELIJK: de bestaande drie Huur-categorieën uit Boekingen (GL8800 belast, GL8801 onbelast, GL8805 verleende
 *   huurkorting bij 070; per administratie via de centrale mapping), EXACT ÉÉNMAAL meegeteld en nooit verdeeld.
 * - RESTERENDE VERWACHTING: volgens het contract wordt die voor huur AUTOMATISCH uit de bekende contract-/begrotingslogica
 *   berekend (OB-024). Dat is hier de maandregels van de bestaande Begroting-huur (`BgHuurResultaat.contracten[].regels`)
 *   voor de resterende maanden: contractuele indexatiemaand, pro-rata start/einde, huurkorting incl. bronfeit-bewezen
 *   kortingswijzigingen — alles al in die calculator; er is GEEN tweede huurformule en er wordt niets verzonnen (geen
 *   toekomstige huurder, geen indexpercentage, geen einddatum, geen belast/onbelast-status).
 *   De aanroeper bepaalt WELK Begroting-resultaat de basis is (normaal die van de begrotingsversie van het realisatiejaar,
 *   concept of bevroren). De contractstand is die van het bevroren snapshot (`bronPeildatum`, wordt teruggegeven);
 *   contracten of mutaties van ná dat moment zijn niet bekend en worden niet geraden — dat staat als INFORMATIEF in
 *   `controleVereist`.
 * - PER P&L-REGEL, dezelfde vorm als Werkelijk: belast en onbelast ZIJN BRUTO (met indexatie) en de huurkorting is een
 *   AFZONDERLIJKE aftrekpost — zo sluit Estimated regel-voor-regel aan op Werkelijk (GL8800/8801/8805) en telt de korting
 *   precies één keer (niet óók nog in een netto-bedrag). Het netto-totaal (`moduleEstimatedNetto`) = belast + onbelast +
 *   korting.
 * - TEKEN: alle bedragen in P&L-richting (opbrengst positief, korting negatief). Het ruwe Werkelijk-saldo (credit-normaal:
 *   belast/onbelast negatief, korting positief, CAL-FIN-001) wordt hier PRECIES ÉÉN KEER omgedraaid, gestuurd door de vaste
 *   categorie — nooit afgeleid uit het teken van een bedrag en nooit met Math.abs.
 * - BELAST/ONBELAST blijft gescheiden. Een contract met onbekende BTW-classificatie wordt NIET aan belast of onbelast
 *   toegewezen: zijn resterende bruto/korting blijft buiten de drie regels en wordt apart gemeld
 *   (`resterendNettoOnbekendeBtw`) → onbekend, geen gok.
 * - ONBEKEND ≠ €0: `estimatedTotaal` is alleen bekend als Werkelijk-dekking is bevestigd (`werkelijkDekkingBevestigd` én
 *   geen niet-geclassificeerde boekingen) én de Begroting-basis geen KRITIEKE controle heeft. Een bewuste €0 (bv. een
 *   volledig afgesloten jaar, lege resterende maanden) blijft een geldige, bekende waarde.
 * - De Begroting wordt nooit gewijzigd (alleen gelezen); geen persistentie nodig: er is geen handmatige invoer — alles is
 *   afgeleid uit de Begroting en het aangeleverde Werkelijk.
 */

export interface EstimatedHuurControleItem {
  ernst: BgControleErnst;
  bericht: string;
}

export interface EstimatedHuurContractResterend {
  contractnummer: string;
  belastOnbelast: BgBelastOnbelast;
  /** Bruto huur MET indexatie over de resterende maanden. */
  resterendBruto: Decimal;
  resterendHuurkorting: Decimal;
  resterendNetto: Decimal;
}

export interface EstimatedHuurCategorieResultaat {
  categorie: HuurWerkelijkCategorie;
  /** Het Werkelijk-saldo t/m de afgesloten periode in P&L-richting (opbrengst positief, korting negatief). */
  werkelijkTotaal: Decimal;
  /** Resterende verwachting in P&L-richting; `null` als de Begroting-basis niet betrouwbaar is. */
  resterendeVerwachting: Decimal | null;
  /** `null` = onbekend (Werkelijk-dekking niet bevestigd of Begroting-basis onbetrouwbaar). */
  estimatedTotaal: Decimal | null;
}

export interface EstimatedHuurResultaat {
  begrotingsjaar: number;
  /** Het contractstandpunt waarop de resterende verwachting rust — latere contractwijzigingen zijn niet bekend. */
  bronPeildatum: Date;
  /** Gesorteerd, uniek. */
  resterendeMaanden: number[];
  werkelijkVoldoendeBekend: boolean;
  /** `false` zodra de Begroting-huur een KRITIEKE controle heeft. */
  begrotingBetrouwbaar: boolean;
  /** Vaste volgorde: `HUUR_WERKELIJK_CATEGORIEEN`. */
  perCategorie: EstimatedHuurCategorieResultaat[];
  perContract: EstimatedHuurContractResterend[];
  /** Resterend netto van contracten met onbekende BTW-classificatie — niet aan belast/onbelast toegewezen, niet in de drie regels. */
  resterendNettoOnbekendeBtw: Decimal;
  /** Som van de drie categorieën in P&L-richting (netto na korting), t/m de afgesloten periode. */
  moduleWerkelijkNetto: Decimal;
  /** `null` zodra één categorie onbekend is. */
  moduleEstimatedNetto: Decimal | null;
  /** Ongewijzigde doorgifte van de Begroting — Estimated berekent of muteert haar nooit. */
  moduleBegrotingNetto: Decimal;
  controleVereist: EstimatedHuurControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

export function berekenEstimatedHuur(
  begroting: BgHuurResultaat,
  werkelijk: WerkelijkHuurResultaat,
  werkelijkDekkingBevestigd: boolean,
  resterendeMaandenInvoer: readonly number[],
): EstimatedHuurResultaat {
  const resterendeMaanden = normaliseerResterendeMaanden(resterendeMaandenInvoer);
  const werkelijkVoldoendeBekend = werkelijkDekkingBevestigd && werkelijk.nietGeclassificeerdTotaal.isZero();
  const begrotingBetrouwbaar = !begroting.controleVereist.some((c) => c.ernst === "KRITIEK");

  const perContract: EstimatedHuurContractResterend[] = begroting.contracten.map((contract) => {
    const regels = contract.regels.filter((r) => resterendeMaanden.includes(r.maand));
    return {
      contractnummer: contract.contractnummer,
      belastOnbelast: contract.belastOnbelast,
      resterendBruto: som(regels.map((r) => r.brutoHuurMetIndexatie)),
      resterendHuurkorting: som(regels.map((r) => r.huurkorting)),
      resterendNetto: som(regels.map((r) => r.nettoHuur)),
    };
  });

  const van = (soort: BgBelastOnbelast) => perContract.filter((c) => c.belastOnbelast === soort);
  const resterend: Record<HuurWerkelijkCategorie, Decimal> = {
    HUUROPBRENGST_BELAST: som(van("BELAST").map((c) => c.resterendBruto)),
    HUUROPBRENGST_ONBELAST: som(van("ONBELAST").map((c) => c.resterendBruto)),
    // Korting alleen van contracten waarvan de belast/onbelast-status bekend is; die van onbekende contracten hoort bij hun (niet toegewezen) bruto.
    VERLEENDE_HUURKORTING: som([...van("BELAST"), ...van("ONBELAST")].map((c) => c.resterendHuurkorting)).negated(),
  };
  const resterendNettoOnbekendeBtw = som(van("ONBEKEND").map((c) => c.resterendNetto));

  const perCategorie: EstimatedHuurCategorieResultaat[] = HUUR_WERKELIJK_CATEGORIEEN.map((categorie) => {
    // Precies één tekenomkering van het ruwe Werkelijk-saldo (zie moduledoc).
    const werkelijkTotaal = werkelijk.perCategorie.find((c) => c.categorie === categorie)!.categorieTotaal.negated();
    const resterendeVerwachting = begrotingBetrouwbaar ? resterend[categorie] : null;
    const estimatedTotaal = werkelijkVoldoendeBekend && resterendeVerwachting !== null ? werkelijkTotaal.plus(resterendeVerwachting) : null;
    return { categorie, werkelijkTotaal, resterendeVerwachting, estimatedTotaal };
  });

  const controleVereist: EstimatedHuurControleItem[] = [
    {
      ernst: "INFORMATIEF",
      bericht: `Resterende verwachting Huur gebaseerd op de contractstand per ${begroting.bronPeildatum.toISOString().slice(0, 10)} en de begrotingsaannames van jaar ${begroting.begrotingsjaar}; contracten en mutaties van ná dat moment zijn niet bekend en niet meegenomen.`,
    },
  ];
  if (!begrotingBetrouwbaar) {
    controleVereist.push({ ernst: "KRITIEK", bericht: "De Begroting-huur waarop de resterende verwachting rust bevat kritieke controles — Estimated onbekend." });
  }
  if (!resterendNettoOnbekendeBtw.isZero()) {
    controleVereist.push({
      ernst: "WAARSCHUWING",
      bericht: `Resterend netto ${resterendNettoOnbekendeBtw.toString()} van contracten met onbekende belast/onbelast-classificatie — niet aan belast of onbelast toegewezen.`,
    });
  }

  return {
    begrotingsjaar: begroting.begrotingsjaar,
    bronPeildatum: begroting.bronPeildatum,
    resterendeMaanden,
    werkelijkVoldoendeBekend,
    begrotingBetrouwbaar,
    perCategorie,
    perContract,
    resterendNettoOnbekendeBtw,
    moduleWerkelijkNetto: som(perCategorie.map((c) => c.werkelijkTotaal)),
    moduleEstimatedNetto: perCategorie.every((c) => c.estimatedTotaal !== null) ? som(perCategorie.map((c) => c.estimatedTotaal!)) : null,
    moduleBegrotingNetto: begroting.portefeuilleTotalen.nettoHuur,
    controleVereist,
  };
}
