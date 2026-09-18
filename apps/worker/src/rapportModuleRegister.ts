import { renderBalansPeriodeBody, renderControlerapportBody, renderHuurdersoverzichtBody, renderKasstroomManagementoverzichtBody, renderPnLPeriodeBody, renderVastgoedKerncijfersBody, type RapportModuleId } from "@bvc/reporting";
import { leesAdministratieConfig } from "./administratie.js";
import { genereerBalansPeriode } from "./genereerBalansPeriode.js";
import { haalControlerapportInvoerOp } from "./genereerControlerapport.js";
import { haalKasstroomManagementoverzichtResultaatOp } from "./genereerKasstroomManagementoverzicht.js";
import { genereerHuurdersoverzicht } from "./genereerHuurdersoverzicht.js";
import { haalPnLPeriodeResultaatOp } from "./genereerPnLPeriode.js";
import { genereerVastgoedKerncijfers } from "./genereerVastgoedKerncijfers.js";

/**
 * DELTA BUILD (2026-09-18) — "Selecteerbare samengestelde rapportgenerator
 * V1": het ENE centrale uitbreidingspunt. Elke rapportmodule levert hier
 * PRECIES ÉÉN registratie: hoe haar bestaande, ONGEWIJZIGDE
 * calculator/orchestrator (`haalPnLPeriodeResultaatOp`/
 * `genereerBalansPeriode`/`genereerHuurdersoverzicht`) wordt aangeroepen,
 * en hoe haar bestaande, ONGEWIJZIGDE Body-renderer
 * (`renderPnLPeriodeBody`/`renderBalansPeriodeBody`/
 * `renderHuurdersoverzichtBody`) de sectie-HTML produceert.
 *
 * GEEN PLUGIN-FRAMEWORK: dit is een platte lookup-tabel (`Record`), geen
 * dynamisch laden, geen dependency injection. `genereerSamengesteldRapport.ts`
 * itereert over `RAPPORT_MODULE_IDS` (vaste, deterministische volgorde) en
 * roept voor elke GESELECTEERDE id `RAPPORT_MODULE_REGISTER[id].genereer(...)`
 * aan — de rest van de generator hoeft nooit te weten welke modules bestaan.
 *
 * ONBESCHIKBAAR VS. FOUT: `genereer` geeft zelf `{status:"ONBESCHIKBAAR"}`
 * terug bij een VOORZIENBAAR ontbrekende verplichte context (bv. geen
 * boekjaar voor P&L/Balans) — dit is een normale, verwachte uitkomst, geen
 * bug. Een ONVERWACHTE fout tijdens het daadwerkelijk genereren (bv.
 * ontbrekend cachebestand) wordt bewust NIET hier opgevangen: die gooit
 * gewoon door, en wordt centraal in `genereerSamengesteldRapport.ts` als
 * `FOUT` afgevangen — zo blijft het onderscheid tussen de twee statussen
 * expliciet in de code zichtbaar, niet stilzwijgend samengevoegd.
 *
 * Huurdersoverzicht heeft GEEN verplichte context (momentopname, eigen
 * peildatum-default) — wordt daarom NOOIT ONBESCHIKBAAR om die reden, exact
 * zoals het standalone `huurdersoverzicht`-commando ook geen boekjaar/
 * periode vereist (zie sectie 4/13 van de opdracht: een module wordt nooit
 * gedwongen context te gebruiken die voor haar niet relevant is).
 */

export interface RapportGenereerContext {
  boekjaar?: number | undefined;
  boekperiodeVan?: string | undefined;
  boekperiodeTotEnMet?: string | undefined;
  /** Uitsluitend relevant voor Huurdersoverzicht — onafhankelijk van boekjaar/periode, zie moduledoc. */
  huurdersPeildatum?: Date | undefined;
}

export type RapportModuleGenereerResultaat =
  | { status: "ONBESCHIKBAAR"; reden: string }
  | { status: "OK"; html: string; onvolledig: boolean; toelichting?: string };

export interface RapportModuleDefinitie {
  id: RapportModuleId;
  naam: string;
  genereer(root: string, administratieId: string, context: RapportGenereerContext): RapportModuleGenereerResultaat;
}

function genereerPnLSectie(root: string, administratieId: string, context: RapportGenereerContext): RapportModuleGenereerResultaat {
  if (context.boekjaar === undefined || context.boekperiodeTotEnMet === undefined) {
    return { status: "ONBESCHIKBAAR", reden: "boekjaar en periodeTotEnMet zijn verplicht voor de winst- en verliesrekening." };
  }
  const config = leesAdministratieConfig(root, administratieId);
  const { resultaat, nietMeegenomen } = haalPnLPeriodeResultaatOp(root, administratieId, {
    boekjaar: context.boekjaar,
    boekperiodeVan: context.boekperiodeVan,
    boekperiodeTotEnMet: context.boekperiodeTotEnMet,
  });
  const html = renderPnLPeriodeBody({
    administratieNaam: config.weergavenaam,
    bedrijfsnr: config.bedrijfsnr,
    boekjaar: context.boekjaar,
    ...(context.boekperiodeVan !== undefined ? { boekperiodeVan: context.boekperiodeVan } : {}),
    boekperiodeTotEnMet: context.boekperiodeTotEnMet,
    gegenereerdOp: new Date(),
    resultaat,
    nietMeegenomen,
  });
  const onvolledig = resultaat.ebitda.volledigheid.status === "ONVOLLEDIG" || nietMeegenomen.length > 0;
  return onvolledig
    ? { status: "OK", html, onvolledig, toelichting: "EBITDA is niet volledig en/of er zijn boekingen niet meegenomen — zie details in de sectie hierboven." }
    : { status: "OK", html, onvolledig };
}

function genereerBalansSectie(root: string, administratieId: string, context: RapportGenereerContext): RapportModuleGenereerResultaat {
  if (context.boekjaar === undefined || context.boekperiodeTotEnMet === undefined) {
    return { status: "ONBESCHIKBAAR", reden: "boekjaar en periodeTotEnMet zijn verplicht voor de balans." };
  }
  const config = leesAdministratieConfig(root, administratieId);
  const { resultaat } = genereerBalansPeriode(root, administratieId, { boekjaar: context.boekjaar, boekperiodeTotEnMet: context.boekperiodeTotEnMet });
  const html = renderBalansPeriodeBody({
    administratieNaam: config.weergavenaam,
    bedrijfsnr: config.bedrijfsnr,
    boekjaar: context.boekjaar,
    boekperiodeTotEnMet: context.boekperiodeTotEnMet,
    gegenereerdOp: new Date(),
    resultaat,
  });
  const onvolledig = resultaat.controleVereist.length > 0 || !resultaat.aansluiting.sluitBinnenTolerantie;
  return onvolledig
    ? { status: "OK", html, onvolledig, toelichting: "Controle vereist en/of de balans sluit niet binnen tolerantie — zie details in de sectie hierboven." }
    : { status: "OK", html, onvolledig };
}

function genereerHuurdersSectie(root: string, administratieId: string, context: RapportGenereerContext): RapportModuleGenereerResultaat {
  const config = leesAdministratieConfig(root, administratieId);
  const resultaat = genereerHuurdersoverzicht(root, administratieId, context.huurdersPeildatum ?? new Date());
  const html = renderHuurdersoverzichtBody(config.weergavenaam, resultaat);
  const onvolledig = resultaat.controleVereist.some((c) => c.ernst === "KRITIEK");
  return onvolledig
    ? { status: "OK", html, onvolledig, toelichting: "Een of meer kritieke controlemeldingen — zie Controle vereist in de sectie hierboven." }
    : { status: "OK", html, onvolledig };
}

/**
 * DELTA BUILD (2026-09-18) — "Samengestelde rapportgenerator V2": zelfde
 * ONGEWIJZIGDE productieketen als het standalone `kasstroom-managementoverzicht`-
 * commando (`haalKasstroomManagementoverzichtResultaatOp`/
 * `renderKasstroomManagementoverzichtBody`, beide nu apart geëxtraheerd/
 * geëxporteerd — zie die bestanden).
 */
function genereerKasstroomSectie(root: string, administratieId: string, context: RapportGenereerContext): RapportModuleGenereerResultaat {
  if (context.boekjaar === undefined || context.boekperiodeTotEnMet === undefined) {
    return { status: "ONBESCHIKBAAR", reden: "boekjaar en periodeTotEnMet zijn verplicht voor het kasstroom-managementoverzicht." };
  }
  const config = leesAdministratieConfig(root, administratieId);
  const { resultaat, topOverigeUitgaven } = haalKasstroomManagementoverzichtResultaatOp(root, administratieId, { boekjaar: context.boekjaar, boekperiodeTotEnMet: context.boekperiodeTotEnMet });
  const html = renderKasstroomManagementoverzichtBody({
    administratieNaam: config.weergavenaam,
    bedrijfsnr: config.bedrijfsnr,
    boekjaar: context.boekjaar,
    boekperiodeTotEnMet: context.boekperiodeTotEnMet,
    gegenereerdOp: new Date(),
    resultaat,
    topOverigeUitgaven,
  });
  const onvolledig = resultaat.controleVereist.length > 0;
  return onvolledig
    ? { status: "OK", html, onvolledig, toelichting: "Controle vereist — zie details in de sectie hierboven." }
    : { status: "OK", html, onvolledig };
}

/**
 * DELTA BUILD (2026-09-18) — VASTGOED_KPI. CONCRETE INCOMPATIBILITEIT
 * GEVONDEN (zie sectie 1 van de opdracht: "architectuur niet wijzigen tenzij
 * een concrete incompatibiliteit wordt gevonden"): de eerder aangewezen
 * `renderKerncijfersHtml`/`KerncijfersInvoer` (`renderKerncijfers.ts`) heeft
 * GEEN enkele productie-aanroeper — geen enkel bestand in `apps/worker`
 * bouwt ooit een `KerncijfersInvoer`, en het bestaande, WEL productie-
 * aangesloten `genereerKerncijfers.ts` levert een ANDER type
 * (`KerncijfersManagementResultaat`, financieel-KPI-gericht) dat niet
 * compatibel is met `KerncijfersInvoer` (huurinkomen/EBITDA/uitbetalings-
 * ratio-kaarten). Een Body-extractie van `renderKerncijfersHtml` zou dus
 * een module registreren die NOOIT écht data kan tonen — dat zou "ontbrekende
 * KPI's invullen"/een nieuwe koppeling verzinnen zijn, expliciet buiten scope.
 *
 * IN PLAATS DAARVAN: hergebruikt de WEL volledig productie-aangesloten,
 * 070-bewezen `genereerVastgoedKerncijfers.ts` (bezettingsgraad/leegstand per
 * complex + portefeuille) — dit resultaat werd al gerenderd, maar uitsluitend
 * intern in `renderManagementRapport.ts`'s `renderVastgoed`, hard gekoppeld
 * aan het volledige `ManagementRapportResultaat`. Die functie is nu ontkoppeld
 * en geëxporteerd als `renderVastgoedKerncijfersBody(resultaat: VastgoedKerncijfersResultaat)`
 * — exact dezelfde mechanische Body-extractie als bij Kasstroom/Controles,
 * alleen op de daadwerkelijk werkende vastgoed-KPI-keten toegepast.
 * `renderKerncijfers.ts`/`KerncijfersInvoer` blijven ongewijzigd, orphaned,
 * geen onderdeel van deze Delta Build.
 */
function genereerVastgoedKpiSectie(root: string, administratieId: string): RapportModuleGenereerResultaat {
  const resultaat = genereerVastgoedKerncijfers(root, administratieId);
  const html = renderVastgoedKerncijfersBody(resultaat);
  const onvolledig = resultaat.controleVereist.some((c) => c.ernst === "KRITIEK");
  return onvolledig
    ? { status: "OK", html, onvolledig, toelichting: "Een of meer kritieke controlemeldingen — zie Per complex in de sectie hierboven." }
    : { status: "OK", html, onvolledig };
}

/**
 * DELTA BUILD (2026-09-18) — zelfde ONGEWIJZIGDE productieketen als het
 * standalone `controlerapport`-commando (`haalControlerapportInvoerOp`/
 * `renderControlerapportBody`, beide nu apart geëxtraheerd/geëxporteerd).
 * Het Controlerapport kent zelf geen "onvolledig"-completeness-begrip (het
 * IS per ontwerp een rauw brondata-overzicht, geen KPI-uitkomst) — daarom
 * altijd `onvolledig: false`; de bestaande statusbanner/meldingen in de
 * sectie-inhoud zelf blijven ongewijzigd zichtbaar.
 */
function genereerControlesSectie(root: string, administratieId: string): RapportModuleGenereerResultaat {
  const invoer = haalControlerapportInvoerOp(root, administratieId);
  const html = renderControlerapportBody(invoer);
  return { status: "OK", html, onvolledig: false };
}

export const RAPPORT_MODULE_REGISTER: Record<RapportModuleId, RapportModuleDefinitie> = {
  PNL: { id: "PNL", naam: "Winst- en verliesrekening", genereer: genereerPnLSectie },
  BALANS: { id: "BALANS", naam: "Balans", genereer: genereerBalansSectie },
  HUURDERS: { id: "HUURDERS", naam: "Huurdersoverzicht", genereer: genereerHuurdersSectie },
  KASSTROOM: { id: "KASSTROOM", naam: "Kasstroom-managementoverzicht", genereer: genereerKasstroomSectie },
  VASTGOED_KPI: { id: "VASTGOED_KPI", naam: "Vastgoed-KPI's", genereer: genereerVastgoedKpiSectie },
  CONTROLES: { id: "CONTROLES", naam: "Controlerapport", genereer: genereerControlesSectie },
};
