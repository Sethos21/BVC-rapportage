import { renderBalansPeriodeBody, renderHuurdersoverzichtBody, renderPnLPeriodeBody, type RapportModuleId } from "@bvc/reporting";
import { leesAdministratieConfig } from "./administratie.js";
import { genereerBalansPeriode } from "./genereerBalansPeriode.js";
import { genereerHuurdersoverzicht } from "./genereerHuurdersoverzicht.js";
import { haalPnLPeriodeResultaatOp } from "./genereerPnLPeriode.js";

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

export const RAPPORT_MODULE_REGISTER: Record<RapportModuleId, RapportModuleDefinitie> = {
  PNL: { id: "PNL", naam: "Winst- en verliesrekening", genereer: genereerPnLSectie },
  BALANS: { id: "BALANS", naam: "Balans", genereer: genereerBalansSectie },
  HUURDERS: { id: "HUURDERS", naam: "Huurdersoverzicht", genereer: genereerHuurdersSectie },
};
