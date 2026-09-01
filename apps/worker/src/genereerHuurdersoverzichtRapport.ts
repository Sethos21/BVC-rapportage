import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderHuurdersoverzichtHtml, type HuurdersoverzichtResultaat } from "@bvc/reporting";
import { administratieRapportenDir } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { genereerHuurdersoverzicht } from "./genereerHuurdersoverzicht.js";

/**
 * Huurdersoverzicht v1 — zelfstandig HTML-rapport (2026-08-27). Rendert
 * UITSLUITEND het al-bewezen `HuurdersoverzichtResultaat`
 * (`genereerHuurdersoverzicht.ts`, ongewijzigd hergebruikt) via
 * `renderHuurdersoverzichtHtml` (`@bvc/reporting`) — geen nieuwe
 * rekenlogica. Bewust een EIGEN rapportbestand/CLI-commando, los van
 * `management-rapport`: eerst zelfstandig tegen echte 070-data visueel
 * beoordelen, vóórdat besloten wordt of dit een sectie in het lange
 * rapport wordt of een aparte UI-tab.
 */

export interface GenereerHuurdersoverzichtRapportResultaat {
  html: string;
  pad: string;
  resultaat: HuurdersoverzichtResultaat;
}

export function genereerHuurdersoverzichtRapport(root: string, administratieId: string): GenereerHuurdersoverzichtRapportResultaat {
  const config = leesAdministratieConfig(root, administratieId);
  const resultaat = genereerHuurdersoverzicht(root, administratieId);
  const html = renderHuurdersoverzichtHtml(config.weergavenaam, resultaat);

  const rapportenDir = administratieRapportenDir(root, administratieId);
  mkdirSync(rapportenDir, { recursive: true });
  const tijdstempel = new Date().toISOString().replace(/[:.]/g, "-");
  const pad = join(rapportenDir, `huurdersoverzicht-${tijdstempel}.html`);
  writeFileSync(pad, html, "utf-8");

  return { html, pad, resultaat };
}
