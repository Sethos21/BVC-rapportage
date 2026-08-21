import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { openCacheReadonly, selecteerBoekingen, type BalansstandRow, type BoekingRow } from "@bvc/cache";
import { resolveerGrootboekMapping, type Balansstand, type Boekingsregel } from "@bvc/domain";
import {
  berekenBalansPeriode,
  berekenNettoResultaat,
  berekenPlPeriode,
  renderRapportPeriodeHtml,
  type BalansPeriodeResultaat,
  type NettoResultaatTeken,
  type PlPeriodeResultaat,
  type RapportPeriodeInvoer,
} from "@bvc/reporting";
import { administratieCachePad, administratieRapportenDir } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";
import { STANDAARD_TEKEN_PER_CATEGORIE } from "./genereerBalansPeriode.js";
import { leesGrootboekMappingGesplitst } from "./grootboekmapping.js";
import { naarBalansstand, naarBoekingsregel } from "./rowMappers.js";

/**
 * Bouwt het gecombineerde periode-rapport (resultatenrekening + balans van
 * dezelfde periode in één document, zie @bvc/reporting's
 * `renderRapportPeriodeHtml`) uit de al-herbouwde cache van één
 * administratie, en schrijft het weg naar `rapporten/`. Draait dezelfde
 * berekeningen als `pl-periode`/`balans-periode` (geen parallelle
 * rekenlaag, CLAUDE.md §2) — dit commando levert voor het eerst één
 * bruikbaar HTML-rapport i.p.v. twee losse CLI-JSON-uitvoeren die de
 * gebruiker zelf naast elkaar moet leggen.
 */

export interface GenereerRapportPeriodeOpties {
  boekjaar: number;
  boekperiodeTotEnMet: string;
  /** Standaard €0,01 (PAR-CTRL-002 pilot-startwaarde), zie genereerBalansPeriode.ts. */
  toleranceEuro?: Decimal | undefined;
  /** Zie genereerBalansPeriode.ts's toelichting bij hetzelfde optie-veld. */
  tekenPerCategorie?: ReadonlyMap<string, NettoResultaatTeken> | undefined;
}

export interface GenereerRapportPeriodeResultaat {
  html: string;
  pad: string;
  /** Apart teruggegeven (naast de gerenderde HTML) zodat een aanroeper (bv. de CLI) op controleVereist/aansluiting kan reageren zonder de HTML te parsen. */
  plResultaat: PlPeriodeResultaat;
  balansResultaat: BalansPeriodeResultaat;
}

export function genereerRapportPeriode(root: string, administratieId: string, opties: GenereerRapportPeriodeOpties): GenereerRapportPeriodeResultaat {
  const config = leesAdministratieConfig(root, administratieId);
  const mapping = leesGrootboekMappingGesplitst(root, administratieId);
  const mappingRegels = resolveerGrootboekMapping(mapping.master, mapping.override);
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  try {
    const boekjaarRijen = db
      .prepare("SELECT * FROM boekingen WHERE bedrijfsnr = ? AND boekjaar = ?")
      .all(config.bedrijfsnr, opties.boekjaar) as unknown as BoekingRow[];
    const geselecteerd = selecteerBoekingen(boekjaarRijen, {
      bedrijfsnr: config.bedrijfsnr,
      boekjaar: opties.boekjaar,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    });
    const boekingsregels: Boekingsregel[] = geselecteerd.map(naarBoekingsregel);

    const balansstandRijen = db
      .prepare("SELECT * FROM balansstanden WHERE bedrijfsnr = ? AND jaar = ?")
      .all(config.bedrijfsnr, opties.boekjaar) as unknown as BalansstandRow[];
    const balansstanden: Balansstand[] = balansstandRijen.map(naarBalansstand);

    const plResultaat = berekenPlPeriode(boekingsregels, mappingRegels);
    const resultaatHuidigBoekjaar = berekenNettoResultaat(plResultaat.categorieTotalen, opties.tekenPerCategorie ?? STANDAARD_TEKEN_PER_CATEGORIE);
    const balansResultaat = berekenBalansPeriode(
      balansstanden,
      boekingsregels,
      mapping.master,
      mapping.override,
      resultaatHuidigBoekjaar,
      opties.toleranceEuro ?? new Decimal("0.01"),
    );

    const invoer: RapportPeriodeInvoer = {
      administratieNaam: config.weergavenaam,
      bedrijfsnr: config.bedrijfsnr,
      boekjaar: opties.boekjaar,
      boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
      gegenereerdOp: new Date(),
      plResultaat,
      balansResultaat,
    };

    const html = renderRapportPeriodeHtml(invoer);
    const rapportenDir = administratieRapportenDir(root, administratieId);
    mkdirSync(rapportenDir, { recursive: true });
    const tijdstempel = new Date().toISOString().replace(/[:.]/g, "-");
    const pad = join(rapportenDir, `rapport-periode-${opties.boekjaar}-${opties.boekperiodeTotEnMet}-${tijdstempel}.html`);
    writeFileSync(pad, html, "utf-8");

    return { html, pad, plResultaat, balansResultaat };
  } finally {
    db.close();
  }
}
