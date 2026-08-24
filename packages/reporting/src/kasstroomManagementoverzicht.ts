import Decimal from "decimal.js";
import type { GrootboekMappingRegel, KasstroomCategorie } from "@bvc/config";
import { boekingSaldo, kasstroomCategorieVoorRegel, liquideMiddelenVoorRegel, rapportregelsom, zoekMappingRegel, type Balansstand, type Boekingsregel, type OnbekendOf } from "@bvc/domain";
import { berekenKasstroomPeriode } from "./kasstroomBerekening.js";

/**
 * Kasstroom-managementoverzicht (2026-08-22) — bouwt voort op de bewezen
 * `berekenKasstroomPeriode` (mutatie bankstand, ONGEWIJZIGD hergebruikt,
 * geen dubbele berekening) met een categorisering van de onderliggende
 * bankmutaties naar huurontvangsten / exploitatie-uitgaven /
 * eigenaaronttrekkingen, plus een kwartaal-uitsplitsing en de
 * uitbetalingsratio.
 *
 * Mechanisme (hergebruik van het al-bewezen boekstukSleutel-concept uit
 * `@bvc/domain`'s `boekstukcontrole`/CAL-FIN-006, niet nieuw): boekingen
 * worden gegroepeerd per boekstuk. Voor elk boekstuk met minstens één
 * regel op een bevestigde liquide-middelen-rekening (generiek via
 * `liquideMiddelenVoorRegel`, nooit een hardcoded rekeningnummer) zijn de
 * OVERIGE regels binnen datzelfde boekstuk de tegenrekening(en). Elke
 * tegenrekening wordt geclassificeerd via het nieuwe, config-gestuurde
 * `kasstroomCategorie`-veld (`@bvc/config`'s `KasstroomCategorieSchema`) —
 * NOOIT via `rapportagecategorie` (vrije tekst, CLAUDE.md §6 zou dat
 * verbieden).
 *
 * Regels voor een boekstuk:
 * - Eén of meer tegenrekeningen, allemaal dezelfde bevestigde categorie:
 *   het volledige liquide-bedrag van dit boekstuk telt mee voor die
 *   categorie (in het kwartaal van de boekdatum van de liquide-regel).
 * - Een onbekende/ongemapte of onbevestigde tegenrekening: het boekstuk
 *   telt NERGENS mee, de tegenrekening komt in `controleVereist` (nooit
 *   geraden).
 * - Tegenrekeningen met VERSCHILLENDE bevestigde categorieën binnen één
 *   boekstuk: niet eenduidig toe te wijzen, komt als geheel in
 *   `controleVereist` — nooit stilzwijgend verdeeld.
 * - Uitsluitend liquide-middelen-regels (bv. overboeking tussen twee
 *   liquide-middelen-rekeningen): geen KPI-categorie van toepassing,
 *   genegeerd (bekend-en-niet-relevant, geen controleVereist).
 *
 * Tekenconventie van de drie uitgave-achtige KPI's: `exploitatieUitgaven`
 * en `eigenaarOnttrekkingen` worden als POSITIEF bedrag gerapporteerd (een
 * bankuitgave is van nature een credit op de bankrekening, dus een
 * negatief `boekingSaldo` — hier bewust omgekeerd zodat "hoeveel is
 * uitgegeven/onttrokken" een leesbaar positief KPI-bedrag is, net als een
 * `tekenconventie: OMGEKEERD`-post in de balans). `huurontvangsten` is van
 * nature al positief (een bankontvangst is een debet). `overig` behoudt
 * bewust het RUWE (ondertekende) bedrag — dat is een technische
 * reconciliatie-bucket, geen KPI om te presenteren.
 */

export interface KasstroomKwartaalRegel {
  kwartaal: 1 | 2 | 3 | 4;
  huurontvangsten: Decimal;
  eigenaarOnttrekkingen: Decimal;
  uitbetalingsratio: OnbekendOf<Decimal>;
}

export interface KasstroomManagementoverzichtControleVereist {
  /** Tegenrekening, of (bij een gemengd boekstuk) een kommagescheiden lijst van tegenrekeningen. */
  grootboekrekening: string;
  saldo: Decimal;
  reden: string;
}

export interface KasstroomManagementoverzichtResultaat {
  bankstandBegin: Decimal;
  bankstandEind: Decimal;
  /** = bankstandEind - bankstandBegin (rechtstreeks van `berekenKasstroomPeriode`, niet herberekend). */
  nettoKasstroom: Decimal;
  huurontvangsten: Decimal;
  exploitatieUitgaven: Decimal;
  eigenaarOnttrekkingen: Decimal;
  /** Kasstroom-relevante mutaties met een bevestigde `kasstroomCategorie: "OVERIG"` — reconciliatie, geen gepresenteerde KPI. */
  overig: Decimal;
  streefwaardeBankstand: OnbekendOf<Decimal>;
  /** eigenaarOnttrekkingen / huurontvangsten. */
  uitbetalingsratio: OnbekendOf<Decimal>;
  perKwartaal: KasstroomKwartaalRegel[];
  controleVereist: KasstroomManagementoverzichtControleVereist[];
}

interface ControleAccumulator {
  saldo: Decimal;
  redenen: Set<string>;
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

function kwartaalVanDatum(datum: Date): 1 | 2 | 3 | 4 {
  return (Math.floor(datum.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;
}

function berekenUitbetalingsratio(eigenaarOnttrekkingen: Decimal, huurontvangsten: Decimal): OnbekendOf<Decimal> {
  if (huurontvangsten.isZero()) {
    return { type: "onbekend", reden: "Huurontvangsten zijn nul in deze periode — uitbetalingsratio niet te bepalen." };
  }
  return { type: "bekend", waarde: eigenaarOnttrekkingen.dividedBy(huurontvangsten) };
}

export function berekenKasstroomManagementoverzicht(
  balansstanden: readonly Balansstand[],
  boekingen: readonly Boekingsregel[],
  mappingRegels: readonly GrootboekMappingRegel[],
  streefwaardeBankstand: Decimal | null,
): KasstroomManagementoverzichtResultaat {
  const kasstroomPeriode = berekenKasstroomPeriode(balansstanden, boekingen, mappingRegels);

  const liquideRekeningen = new Set<string>();
  for (const regel of mappingRegels) {
    if (regel.soort !== "BALANS") continue;
    const liquideResultaat = liquideMiddelenVoorRegel(regel);
    if (liquideResultaat.type === "bekend" && liquideResultaat.waarde) liquideRekeningen.add(regel.grootboekrekening);
  }

  const boekingenPerBoekstuk = new Map<string, Boekingsregel[]>();
  for (const boeking of boekingen) {
    const key = `${boeking.bedrijfsnr}::${boeking.boekstukSleutel}`;
    const bestaand = boekingenPerBoekstuk.get(key);
    if (bestaand) bestaand.push(boeking);
    else boekingenPerBoekstuk.set(key, [boeking]);
  }

  let huurontvangsten = new Decimal(0);
  let exploitatieUitgaven = new Decimal(0);
  let eigenaarOnttrekkingen = new Decimal(0);
  let overig = new Decimal(0);
  const perCategorieEnKwartaal = new Map<string, Decimal>();
  const controleAccumulator = new Map<string, ControleAccumulator>();
  const gemengdeBoekstukken: KasstroomManagementoverzichtControleVereist[] = [];

  for (const regels of boekingenPerBoekstuk.values()) {
    const liquideRegels = regels.filter((r) => liquideRekeningen.has(r.grootboeknr));
    if (liquideRegels.length === 0) continue;

    const tegenRegels = regels.filter((r) => !liquideRekeningen.has(r.grootboeknr));
    if (tegenRegels.length === 0) continue; // uitsluitend liquide-middelen-regels (bv. overboeking) -- geen KPI van toepassing

    const liquideBedrag = rapportregelsom(liquideRegels.map((r) => boekingSaldo(r)));

    const categorieen: (KasstroomCategorie | undefined)[] = [];
    let heeftOnbekende = false;
    for (const tegenRegel of tegenRegels) {
      const mappingResultaat = zoekMappingRegel(mappingRegels, tegenRegel.grootboeknr);
      if (mappingResultaat.type === "onbekend") {
        voegControleToe(controleAccumulator, tegenRegel.grootboeknr, boekingSaldo(tegenRegel), mappingResultaat.reden);
        heeftOnbekende = true;
        continue;
      }
      const categorieResultaat = kasstroomCategorieVoorRegel(mappingResultaat.waarde);
      if (categorieResultaat.type === "onbekend") {
        voegControleToe(controleAccumulator, tegenRegel.grootboeknr, boekingSaldo(tegenRegel), categorieResultaat.reden);
        heeftOnbekende = true;
        continue;
      }
      categorieen.push(categorieResultaat.waarde);
    }

    if (heeftOnbekende) continue; // al gerapporteerd in controleVereist hierboven

    const unieke = new Set(categorieen);
    if (unieke.size > 1) {
      gemengdeBoekstukken.push({
        grootboekrekening: tegenRegels.map((r) => r.grootboeknr).join(", "),
        saldo: liquideBedrag,
        reden: `Boekstuk bevat tegenrekeningen met verschillende kasstroomcategorieën (${Array.from(unieke).join(", ")}) — niet eenduidig aan één KPI toe te wijzen.`,
      });
      continue;
    }

    const categorie = [...unieke][0]!;
    const kwartaal = kwartaalVanDatum(liquideRegels[0]!.boekdatum);

    if (categorie === "HUURONTVANGST") {
      huurontvangsten = huurontvangsten.plus(liquideBedrag);
      perCategorieEnKwartaal.set(`HUUR::${kwartaal}`, (perCategorieEnKwartaal.get(`HUUR::${kwartaal}`) ?? new Decimal(0)).plus(liquideBedrag));
    } else if (categorie === "EXPLOITATIE_UITGAVE") {
      exploitatieUitgaven = exploitatieUitgaven.plus(liquideBedrag.negated());
    } else if (categorie === "EIGENAARONTTREKKING") {
      const bedrag = liquideBedrag.negated();
      eigenaarOnttrekkingen = eigenaarOnttrekkingen.plus(bedrag);
      perCategorieEnKwartaal.set(`ONTTREKKING::${kwartaal}`, (perCategorieEnKwartaal.get(`ONTTREKKING::${kwartaal}`) ?? new Decimal(0)).plus(bedrag));
    } else {
      overig = overig.plus(liquideBedrag);
    }
  }

  const perKwartaal: KasstroomKwartaalRegel[] = ([1, 2, 3, 4] as const).map((kwartaal) => {
    const huur = perCategorieEnKwartaal.get(`HUUR::${kwartaal}`) ?? new Decimal(0);
    const onttrekking = perCategorieEnKwartaal.get(`ONTTREKKING::${kwartaal}`) ?? new Decimal(0);
    return { kwartaal, huurontvangsten: huur, eigenaarOnttrekkingen: onttrekking, uitbetalingsratio: berekenUitbetalingsratio(onttrekking, huur) };
  });

  const controleVereist: KasstroomManagementoverzichtControleVereist[] = [
    ...Array.from(controleAccumulator.entries()).map(([grootboekrekening, entry]) => ({
      grootboekrekening,
      saldo: entry.saldo,
      reden: Array.from(entry.redenen).join(" "),
    })),
    ...gemengdeBoekstukken,
  ].sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));

  return {
    bankstandBegin: kasstroomPeriode.beginstandTotaal,
    bankstandEind: kasstroomPeriode.eindstandTotaal,
    nettoKasstroom: kasstroomPeriode.mutatieTotaal,
    huurontvangsten,
    exploitatieUitgaven,
    eigenaarOnttrekkingen,
    overig,
    streefwaardeBankstand:
      streefwaardeBankstand === null
        ? { type: "onbekend", reden: "Geen streefwaarde bankstand geconfigureerd voor deze administratie." }
        : { type: "bekend", waarde: streefwaardeBankstand },
    uitbetalingsratio: berekenUitbetalingsratio(eigenaarOnttrekkingen, huurontvangsten),
    perKwartaal,
    controleVereist,
  };
}
