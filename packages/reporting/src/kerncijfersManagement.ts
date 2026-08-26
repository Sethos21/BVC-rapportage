import Decimal from "decimal.js";
import type { OnbekendOf } from "@bvc/domain";
import type { PlPeriodeCategorieTotaal, PlPeriodeResultaat } from "./plPeriodeBerekening.js";
import type { KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";

/**
 * Kerncijfers / Management-KPI's (v1, 2026-08-26) — pure samenstelfunctie:
 * herschikt uitsluitend bedragen die al door bewezen rekenmodules zijn
 * berekend (`berekenPlPeriode`/`berekenNettoResultaat`/
 * `berekenKasstroomManagementoverzicht`/`berekenBalansPeriode`). Rekent
 * zelf niets uit een boeking of saldo — CLAUDE.md §2 ("twee outputs van
 * dezelfde rekenlaag", hier zelfs vier bronnen tot één overzicht).
 *
 * Bewust een APARTE module van de bestaande `kerncijfers.ts` (sectie 01
 * KPI-dashboard: huurinkomen/EBITDA/uitbetalingsratio/bankstand/
 * debiteuren/servicekosten-saldo + bezettingsgraad — een vroege poort van
 * `legacy/index.html`'s `renderOverzicht`, getest tegen fixture "Fergagne
 * BV", nooit aan een Worker-commando of aan echte cachedata gekoppeld).
 * Dit is een ander, smaller concept (management-KPI's rechtstreeks uit
 * pl-periode/balans-periode/kasstroom-managementoverzicht, regressie tegen
 * 070_Rooise_Zoom) — niet vermengd of overschreven, op verzoek gebruiker.
 */

const OPBRENGSTEN_CATEGORIE = "Opbrengsten";
const KOSTEN_CATEGORIE = "Kosten";

export interface KerncijfersManagementResultaat {
  totaleOpbrengsten: Decimal;
  totaleKosten: Decimal;
  resultaatHuidigBoekjaar: OnbekendOf<Decimal>;
  bankstandEindePeriode: Decimal;
  nettoKasstroom: Decimal;
  eigenaarOnttrekkingen: Decimal;
  /**
   * Datakwaliteitsindicator, rechtstreeks van `BalansAansluitingscontrole`
   * (@bvc/reporting's `berekenBalansPeriode`) — geen nieuwe balanslogica,
   * geen van de zes kerncijfers hierboven wordt via de balans herberekend.
   */
  balansSluitBinnenTolerantie: boolean;
}

/**
 * Som van `categorieTotalen[naam].bedrag`, of €0 als de categorie niet
 * voorkomt. Een ontbrekende categorie in een geldige periode betekent hier
 * "geen boekingen in die categorie" (legitiem €0, rapportregelsom van een
 * lege verzameling) — geen datagat. `berekenPlPeriode` heeft voor
 * niet-classificeerbare rekeningen al een aparte `controleVereist`-lijst;
 * die telt bewust NIET mee in dit bedrag (geen gok welke categorie een
 * onbekende rekening zou toebehoren).
 */
function categorieTotaalOf(categorieTotalen: readonly PlPeriodeCategorieTotaal[], rapportagecategorie: string): Decimal {
  const gevonden = categorieTotalen.find((c) => c.rapportagecategorie === rapportagecategorie);
  return gevonden ? gevonden.bedrag : new Decimal(0);
}

export function samenstelKerncijfersManagement(
  plResultaat: PlPeriodeResultaat,
  resultaatHuidigBoekjaar: OnbekendOf<Decimal>,
  kasstroomResultaat: KasstroomManagementoverzichtResultaat,
  balansSluitBinnenTolerantie: boolean,
): KerncijfersManagementResultaat {
  return {
    totaleOpbrengsten: categorieTotaalOf(plResultaat.categorieTotalen, OPBRENGSTEN_CATEGORIE),
    totaleKosten: categorieTotaalOf(plResultaat.categorieTotalen, KOSTEN_CATEGORIE),
    resultaatHuidigBoekjaar,
    bankstandEindePeriode: kasstroomResultaat.bankstandEind,
    nettoKasstroom: kasstroomResultaat.nettoKasstroom,
    eigenaarOnttrekkingen: kasstroomResultaat.eigenaarOnttrekkingen,
    balansSluitBinnenTolerantie,
  };
}
