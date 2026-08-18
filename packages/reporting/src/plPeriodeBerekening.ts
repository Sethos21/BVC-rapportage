import Decimal from "decimal.js";
import type { GrootboekMappingRegel } from "@bvc/config";
import {
  boekingSaldo,
  budgetafwijking,
  budgetafwijkingPct,
  presentatiefactorVoorRegel,
  rapportbedrag,
  rapportregelsom,
  zoekMappingRegel,
  type Boekingsregel,
  type OnbekendOf,
} from "@bvc/domain";

/**
 * P&L-berekening op een expliciet al-geselecteerde periode boekingen (zie
 * `@bvc/cache`'s `periodeSelectie.ts` — periodeselectie gebeurt daar, niet
 * hier) en de goedgekeurde grootboekmapping. Dit is bewust ALLEEN de
 * rekenlaag: geen renderer/HTML, geen eigen periodeselectie- of
 * mappinglogica (die worden hergebruikt uit `@bvc/domain`/`@bvc/cache`,
 * CAL-FIN-002/CAL-FIN-003).
 */

export interface PlPeriodePost {
  rapportagepost: string;
  rapportagecategorie: string;
  /** Rapportregelsom (CAL-FIN-003) — som van rapportbedragen (na tekenconventie) van alle boekingen op deze rapportagepost. */
  bedrag: Decimal;
}

export interface PlPeriodeCategorieTotaal {
  rapportagecategorie: string;
  bedrag: Decimal;
}

export interface PlPeriodeControleVereist {
  grootboekrekening: string;
  /** Rauw saldo (debet - credit), ONGEWIJZIGD — geen tekenconventie toegepast, want die is hier per definitie niet (betrouwbaar) bekend. */
  saldo: Decimal;
  reden: string;
}

export interface PlPeriodeResultaat {
  posten: PlPeriodePost[];
  /**
   * Som per rapportagecategorie, elk met het teken zoals de tekenconventie
   * van de onderliggende rekeningen dat oplevert (bv. zowel Kosten als
   * Opbrengsten kunnen als positief bedrag getoond zijn — dat is een
   * presentatiekeuze per rekening, geen boekhoudkundig +/− voor een
   * nettoresultaat). Deze functie berekent BEWUST geen gecombineerd
   * nettoresultaat over categorieën heen: welke categorieën optellen en
   * welke aftrekken voor een "resultaat"-regel is een indelingsvraag die
   * hier niet geformaliseerd is (rapportagecategorie is vrije tekst — zie
   * packages/config/README.md, "bewust uitgesteld") en dus niet geraden
   * mag worden (CLAUDE.md §6). Dat blijft een latere, expliciete keuze.
   */
  categorieTotalen: PlPeriodeCategorieTotaal[];
  /**
   * Grootboekrekeningen met een niet-nul saldo in de periode die niet in
   * `posten` verwerkt konden worden: onbekende rekening, inactieve mapping,
   * of een nog niet bevestigde tekenconventie. Nooit stilzwijgend op 0
   * gezet of overgeslagen (CLAUDE.md §6, PAR-MAP-001-achtig) — dit
   * P&L-resultaat is pas compleet te noemen als deze lijst leeg is. Een
   * bekende BALANS-regel (soort "BALANS", bv. bank/debiteuren/crediteuren)
   * komt hier bewust NIET in terecht — die is al herkend als terecht buiten
   * de P&L, geen ontbrekende classificatie.
   */
  controleVereist: PlPeriodeControleVereist[];
}

interface ControleAccumulator {
  saldo: Decimal;
  redenen: Set<string>;
}

export function berekenPlPeriode(
  boekingen: readonly Boekingsregel[],
  mappingRegels: readonly GrootboekMappingRegel[],
): PlPeriodeResultaat {
  const bedragenPerPost = new Map<string, { rapportagecategorie: string; bedragen: Decimal[] }>();
  const controlePerRekening = new Map<string, ControleAccumulator>();

  for (const boeking of boekingen) {
    const saldo = boekingSaldo(boeking);
    const regelResultaat = zoekMappingRegel(mappingRegels, boeking.grootboeknr);
    if (regelResultaat.type === "onbekend") {
      voegControleToe(controlePerRekening, boeking.grootboeknr, saldo, regelResultaat.reden);
      continue;
    }

    if (regelResultaat.waarde.soort === "BALANS") {
      // Bekende, bewust buiten P&L-scope (Srt "Bal" in het bronrekeningschema) — geen post, geen controleVereist.
      continue;
    }

    const factorResultaat = presentatiefactorVoorRegel(regelResultaat.waarde);
    if (factorResultaat.type === "onbekend") {
      voegControleToe(controlePerRekening, boeking.grootboeknr, saldo, factorResultaat.reden);
      continue;
    }

    const bedrag = rapportbedrag(saldo, { presentatiefactor: factorResultaat.waarde });
    const { rapportagepost, rapportagecategorie } = regelResultaat.waarde;
    const bestaand = bedragenPerPost.get(rapportagepost);
    if (bestaand) {
      bestaand.bedragen.push(bedrag);
    } else {
      bedragenPerPost.set(rapportagepost, { rapportagecategorie, bedragen: [bedrag] });
    }
  }

  const posten: PlPeriodePost[] = Array.from(bedragenPerPost.entries()).map(([rapportagepost, { rapportagecategorie, bedragen }]) => ({
    rapportagepost,
    rapportagecategorie,
    bedrag: rapportregelsom(bedragen),
  }));

  const categorieBedragen = new Map<string, Decimal[]>();
  for (const post of posten) {
    const bestaand = categorieBedragen.get(post.rapportagecategorie);
    if (bestaand) bestaand.push(post.bedrag);
    else categorieBedragen.set(post.rapportagecategorie, [post.bedrag]);
  }
  const categorieTotalen: PlPeriodeCategorieTotaal[] = Array.from(categorieBedragen.entries()).map(([rapportagecategorie, bedragen]) => ({
    rapportagecategorie,
    bedrag: rapportregelsom(bedragen),
  }));

  const controleVereist: PlPeriodeControleVereist[] = Array.from(controlePerRekening.entries())
    .filter(([, entry]) => !entry.saldo.isZero())
    .map(([grootboekrekening, entry]) => ({
      grootboekrekening,
      saldo: entry.saldo,
      reden: Array.from(entry.redenen).join(" "),
    }));

  return {
    posten,
    categorieTotalen,
    controleVereist,
  };
}

function voegControleToe(map: Map<string, ControleAccumulator>, grootboekrekening: string, saldo: Decimal, reden: string): void {
  const bestaand = map.get(grootboekrekening);
  if (bestaand) {
    bestaand.saldo = bestaand.saldo.plus(saldo);
    bestaand.redenen.add(reden);
  } else {
    map.set(grootboekrekening, { saldo, redenen: new Set([reden]) });
  }
}

export interface PlPeriodeVergelijkingsregel {
  rapportagepost: string;
  berekend: Decimal;
  verwacht: Decimal;
  verschil: Decimal;
  verschilPct: OnbekendOf<Decimal>;
  sluitBinnenTolerantie: boolean;
}

export interface PlPeriodeVergelijkingsResultaat {
  regels: PlPeriodeVergelijkingsregel[];
  /** Rapportageposten met een verwacht (gereconcilieerd) bedrag, maar zonder berekend bedrag deze periode. */
  ontbrekendInBerekening: string[];
  /** Rapportageposten met een berekend bedrag, maar zonder verwacht (gereconcilieerd) bedrag opgegeven. */
  onverwachtInBerekening: string[];
}

/**
 * Vergelijkt het berekende P&L-resultaat automatisch met eerder handmatig
 * gereconcilieerde bedragen per rapportagepost (bv. uit de bestaande
 * Q2-2026-rapportage). Hergebruikt CAL-FIN-009/010 (budgetafwijking(Pct)) —
 * "verwacht" speelt hier de rol van budget, "berekend" de rol van
 * realisatie. Een ontbrekende kant wordt nooit als 0 ingevuld: die
 * rapportageposten staan apart in `ontbrekendInBerekening`/
 * `onverwachtInBerekening`.
 */
export function vergelijkMetGereconcilieerd(
  resultaat: PlPeriodeResultaat,
  verwachtePerRapportagepost: ReadonlyMap<string, Decimal>,
  toleranceEuro: Decimal,
): PlPeriodeVergelijkingsResultaat {
  const berekendePerPost = new Map(resultaat.posten.map((post) => [post.rapportagepost, post.bedrag]));
  const alleRapportageposten = new Set([...berekendePerPost.keys(), ...verwachtePerRapportagepost.keys()]);

  const regels: PlPeriodeVergelijkingsregel[] = [];
  const ontbrekendInBerekening: string[] = [];
  const onverwachtInBerekening: string[] = [];

  for (const rapportagepost of alleRapportageposten) {
    const berekend = berekendePerPost.get(rapportagepost);
    const verwacht = verwachtePerRapportagepost.get(rapportagepost);

    if (verwacht === undefined) {
      onverwachtInBerekening.push(rapportagepost);
      continue;
    }
    if (berekend === undefined) {
      ontbrekendInBerekening.push(rapportagepost);
      continue;
    }

    const verschil = budgetafwijking(berekend, verwacht);
    regels.push({
      rapportagepost,
      berekend,
      verwacht,
      verschil,
      verschilPct: budgetafwijkingPct(berekend, { type: "bekend", waarde: verwacht }),
      sluitBinnenTolerantie: verschil.abs().lessThanOrEqualTo(toleranceEuro),
    });
  }

  return { regels, ontbrekendInBerekening, onverwachtInBerekening };
}
