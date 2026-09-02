import Decimal from "decimal.js";
import type { BgControleErnst, BgHuurResultaat } from "./begroteHuuropbrengsten.js";

/**
 * Begrote beheersvergoeding — Module 2 (2026-09-01), fase 1C: UITSLUITEND de
 * pure rekenlaag, conform `ONTWERP_BEGROTINGSMODULE.md` (OB-010 t/m OB-012)
 * en het Module-2-brononderzoek (fase 1B, sessie-geschiedenis).
 *
 * Architectuurprincipe (expliciet bevestigd): Module 1 (`begroteHuuropbrengsten.ts`)
 * weet NIETS van beheersvergoeding. Module 2 consumeert uitsluitend de
 * KANT-EN-KLARE `BgHuurResultaat` en groepeert die hier, zelf, op
 * `complexnummer` — geen tweede huurgrondslag, geen wijziging aan Module 1.
 * De afhankelijkheid loopt één kant op: Module 2 → Module 1, nooit andersom.
 *
 * Architectuurgrens (zelfde als Module 1): geen cache/SQLite/Excel/bestanden/
 * klok/IO. Signatuur is uitsluitend: Module-1-uitkomst + expliciete
 * per-complex beheerconfiguratie → berekende Module-2-uitkomst.
 *
 * BEWEZEN BRONREGEL (fase 1B, niet opnieuw interpreteren): de sleutel van
 * zowel het vaste als het variabele deel is `complexnummer` — bevestigd via
 * de 070 Q1-2024-journaalpost (vast+variabel op hetzelfde complex 001,
 * complex 004/PWA apart) én herhaald bewijs bij zes andere administraties.
 * Geen apart "beheercontract"-veld bestaat aantoonbaar in de bron.
 *
 * NIET-BRONFEITEN, EXPLICIETE BEGROTINGSPARAMETERS (fase 1B: "Honorarium
 * vast tarief"/"Honorarium X% van €Y" zijn onderzoeksbewijs dat het
 * mechanisme bestaat, GEEN rekenregel — bij administratie 025 bleek het
 * "vast tarief"-label soms slechts een doorgefactureerd, eerder berekend
 * variabel bedrag te zijn, niet een structureel apart vast bedrag):
 * - `vastBedragJaar`, `vastIndexatiePercentage`, `vastIndexatiedatum` en
 *   `variabelPercentage` zijn per complex een expliciete parameter — nooit
 *   automatisch uit historische boekingen afgeleid, geen parser/regex op
 *   omschrijvingen.
 * - Indexatiedatum/-percentage van het vaste deel zijn GEEN `Verhoging_
 *   datum`-achtig bronfeit. Er is dus bewust GEEN `bronPeildatum`, geen
 *   staleness-toets, geen voorwaartse projectie via een herhalingsinterval
 *   (in tegenstelling tot Module 1) — dat zou een niet-bewezen Module-2-
 *   bronsemantiek verzinnen. Valt de indexatiedatum niet in het
 *   begrotingsjaar van de meegegeven Module-1-uitkomst, dan wordt geen
 *   indexatie toegepast (met een melding), nooit geprojecteerd.
 *
 * VASTGESTELDE BUSINESSREGELS:
 * - Variabele beheersvergoeding = variabel percentage × NETTO begrote
 *   huuropbrengst van HETZELFDE complex, MAAND VOOR MAAND uit Module 1's
 *   `contract.regels[].nettoHuur` (nooit `jaartotaal / 12`) — zo werken
 *   contractstart/-einde, huurindexatie en huurkorting automatisch door,
 *   zonder een tweede jaarformule (som van de 12 maandbedragen = percentage
 *   × jaartotaal, want percentage is constant en optellen is lineair).
 * - Indexatie van het vaste deel werkt op MAANDNIVEAU, exact zoals Module 1's
 *   huurindexatie: valt de indexatiedatum in augustus, dan geldt het nieuwe
 *   vaste bedrag voor de volledige maand augustus — geen dagpro-rata.
 * - Per complex is onafhankelijk mogelijk: alleen vast, alleen variabel,
 *   beide, of geen van beide — GEEN invariant dat beide > 0 moeten zijn.
 * - Een negatief vast-indexatiepercentage is TOEGESTAAN (een tarief kan
 *   contractueel dalen) — dit wordt niet geblokkeerd.
 * - Een negatief vast bedrag of een negatief variabel percentage is
 *   ONGELDIG (KRITIEK) — die component wordt dan niet toegepast, de rest
 *   van de berekening gaat door.
 */

export type BgBeheerControleErnst = BgControleErnst;

export interface BgBeheerControleItem {
  /** `null` = niet aan één specifiek complex toe te wijzen. */
  complexnummer: string | null;
  ernst: BgBeheerControleErnst;
  bericht: string;
}

/**
 * Expliciete, per-complex beheerconfiguratie — begrotingsparameters, geen
 * bronfeiten (zie moduledoc). `null` op `vastBedragJaar`/`variabelPercentage`
 * betekent "niet van toepassing voor dit complex", NIET "0" — `0` is een
 * geldige, expliciete waarde (bv. een variabel percentage van 0%) en wordt
 * bewust anders behandeld dan "niet ingesteld".
 */
export interface BgBeheerComplexConfig {
  complexnummer: string;
  /** `null` = geen vast deel voor dit complex. */
  vastBedragJaar: Decimal | null;
  /** Alleen relevant als `vastBedragJaar` niet `null` is. `null` = geen indexatie van het vaste deel. */
  vastIndexatiePercentage: Decimal | null;
  /** `null` = geen indexatie toegepast (bewuste configuratie, geen fout). */
  vastIndexatiedatum: Date | null;
  /** `null` = geen variabel deel voor dit complex. */
  variabelPercentage: Decimal | null;
}

export interface BgBeheerMaandRegel {
  maand: number; // 1..12
  vastVoorIndexatie: Decimal;
  vastIndexatieEffect: Decimal;
  vastNaIndexatie: Decimal;
  variabeleVergoeding: Decimal;
  totaleVergoeding: Decimal;
}

interface BgBeheerJaartotalen {
  nettoHuurGrondslag: Decimal;
  vastVoorIndexatie: Decimal;
  vastIndexatieEffect: Decimal;
  vastNaIndexatie: Decimal;
  variabeleVergoeding: Decimal;
  totaleVergoeding: Decimal;
}

export interface BgBeheerComplexUitkomst {
  complexnummer: string;
  vastToegepast: boolean;
  variabelToegepast: boolean;
  variabelPercentageGebruikt: Decimal | null;
  regels: BgBeheerMaandRegel[];
  jaartotaal: BgBeheerJaartotalen;
}

export interface BgBeheerPortefeuilleTotalen extends BgBeheerJaartotalen {}

export interface BgBeheerResultaat {
  begrotingsjaar: number;
  complexen: BgBeheerComplexUitkomst[];
  portefeuilleTotalen: BgBeheerPortefeuilleTotalen;
  controleVereist: BgBeheerControleItem[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

function leegJaartotaal(): BgBeheerJaartotalen {
  return {
    nettoHuurGrondslag: new Decimal(0),
    vastVoorIndexatie: new Decimal(0),
    vastIndexatieEffect: new Decimal(0),
    vastNaIndexatie: new Decimal(0),
    variabeleVergoeding: new Decimal(0),
    totaleVergoeding: new Decimal(0),
  };
}

interface ComplexHuurGrondslag {
  maandNettoHuur: Decimal[]; // lengte 12
  jaarNettoHuur: Decimal;
}

/**
 * Groepeert Module 1's contractuitkomsten op `complexnummer` — de enige plek
 * waar dat gebeurt (zie moduledoc: Module 1 kent geen complexgroepering).
 * Een contract met `complexnummer === null` en niet-nul netto jaarhuur wordt
 * NIET aan een complex toegewezen (nooit gegokt) — dat bedrag ontbreekt dan
 * bewust in elke complexgrondslag, met een expliciete melding.
 */
function bepaalComplexHuurGrondslagen(
  module1: BgHuurResultaat,
): { grondslagPerComplex: Map<string, ComplexHuurGrondslag>; controleVereist: BgBeheerControleItem[] } {
  const controleVereist: BgBeheerControleItem[] = [];
  const grondslagPerComplex = new Map<string, ComplexHuurGrondslag>();

  for (const contract of module1.contracten) {
    if (contract.complexnummer === null) {
      if (!contract.jaartotaal.nettoHuur.isZero()) {
        controleVereist.push({
          complexnummer: null,
          ernst: "WAARSCHUWING",
          bericht: `Contract ${contract.contractnummer}: netto begrote huur (${contract.jaartotaal.nettoHuur.toString()}) heeft geen complexnummer — niet aan een complex toegewezen, ontbreekt daardoor in elke complexgrondslag voor de beheersvergoeding.`,
        });
      }
      continue;
    }

    const bestaand = grondslagPerComplex.get(contract.complexnummer) ?? {
      maandNettoHuur: Array.from({ length: 12 }, () => new Decimal(0)),
      jaarNettoHuur: new Decimal(0),
    };
    for (let i = 0; i < 12; i += 1) {
      bestaand.maandNettoHuur[i] = bestaand.maandNettoHuur[i]!.plus(contract.regels[i]!.nettoHuur);
    }
    bestaand.jaarNettoHuur = som(bestaand.maandNettoHuur);
    grondslagPerComplex.set(contract.complexnummer, bestaand);
  }

  return { grondslagPerComplex, controleVereist };
}

interface OpgelosteComplexConfig {
  vastBedragJaar: Decimal | null;
  vastIndexatiePercentage: Decimal | null;
  vastIndexatiedatum: Date | null;
  variabelPercentage: Decimal | null;
}

/**
 * Valideert en ontdubbelt de invoerconfiguraties. Meerdere configs voor
 * hetzelfde complex worden NOOIT stilzwijgend gereduceerd tot één — dat
 * complex krijgt dan geen opgeloste config (behandeld als ontbrekend voor de
 * berekening), met een KRITIEK-melding. Een negatief vast bedrag of
 * negatief variabel percentage is ongeldig (KRITIEK) — die ENE component
 * vervalt dan naar `null`, de rest van de config (en andere complexen)
 * blijft ongemoeid. Een negatief vast-indexatiepercentage is toegestaan.
 */
function valideerComplexConfigs(
  configs: readonly BgBeheerComplexConfig[],
): { configPerComplex: Map<string, OpgelosteComplexConfig>; controleVereist: BgBeheerControleItem[] } {
  const controleVereist: BgBeheerControleItem[] = [];
  const perComplex = new Map<string, BgBeheerComplexConfig[]>();
  for (const config of configs) {
    const groep = perComplex.get(config.complexnummer) ?? [];
    groep.push(config);
    perComplex.set(config.complexnummer, groep);
  }

  const configPerComplex = new Map<string, OpgelosteComplexConfig>();
  for (const [complexnummer, groep] of perComplex) {
    if (groep.length > 1) {
      controleVereist.push({
        complexnummer,
        ernst: "KRITIEK",
        bericht: `Complex ${complexnummer}: ${groep.length} beheerconfiguraties opgegeven — niet stilzwijgend één gekozen, geen beheersvergoeding berekend voor dit complex.`,
      });
      continue;
    }

    const config = groep[0]!;
    let vastBedragJaar = config.vastBedragJaar;
    if (vastBedragJaar !== null && vastBedragJaar.isNegative()) {
      controleVereist.push({
        complexnummer,
        ernst: "KRITIEK",
        bericht: `Complex ${complexnummer}: vastBedragJaar is negatief (${vastBedragJaar.toString()}) — ongeldig, vast deel niet toegepast.`,
      });
      vastBedragJaar = null;
    }

    let variabelPercentage = config.variabelPercentage;
    if (variabelPercentage !== null && variabelPercentage.isNegative()) {
      controleVereist.push({
        complexnummer,
        ernst: "KRITIEK",
        bericht: `Complex ${complexnummer}: variabelPercentage is negatief (${variabelPercentage.toString()}) — ongeldig, variabel deel niet toegepast.`,
      });
      variabelPercentage = null;
    }

    configPerComplex.set(complexnummer, {
      vastBedragJaar,
      vastIndexatiePercentage: config.vastIndexatiePercentage,
      vastIndexatiedatum: config.vastIndexatiedatum,
      variabelPercentage,
    });
  }

  return { configPerComplex, controleVereist };
}

export function berekenBegroteBeheersvergoeding(
  module1: BgHuurResultaat,
  configs: readonly BgBeheerComplexConfig[],
): BgBeheerResultaat {
  const controleVereist: BgBeheerControleItem[] = [];

  const { grondslagPerComplex, controleVereist: grondslagMeldingen } = bepaalComplexHuurGrondslagen(module1);
  controleVereist.push(...grondslagMeldingen);

  const { configPerComplex, controleVereist: configMeldingen } = valideerComplexConfigs(configs);
  controleVereist.push(...configMeldingen);

  // Complexen met een meervoudige (ongeldige) config blijven bewust buiten configPerComplex — die
  // hebben hun eigen KRITIEK-melding al gehad en mogen niet nogmaals als "config ontbreekt" gemeld worden.
  const complexenMetOngeldigeConfig = new Set(
    configMeldingen.filter((m) => m.bericht.includes("niet stilzwijgend één gekozen")).map((m) => m.complexnummer),
  );

  const alleComplexnummers = new Set([...grondslagPerComplex.keys(), ...configPerComplex.keys()]);

  const complexUitkomsten: BgBeheerComplexUitkomst[] = [...alleComplexnummers].sort().map((complexnummer) => {
    const grondslag = grondslagPerComplex.get(complexnummer) ?? null;
    const config = configPerComplex.get(complexnummer) ?? null;

    if (config === null && grondslag !== null && !complexenMetOngeldigeConfig.has(complexnummer)) {
      controleVereist.push({
        complexnummer,
        ernst: "WAARSCHUWING",
        bericht: `Complex ${complexnummer}: begrote netto huur (${grondslag.jaarNettoHuur.toString()}) aanwezig, maar geen beheerconfiguratie opgegeven — geen beheersvergoeding berekend voor dit complex.`,
      });
    }
    if (config !== null && grondslag === null && config.variabelPercentage !== null) {
      controleVereist.push({
        complexnummer,
        ernst: "INFORMATIEF",
        bericht: `Complex ${complexnummer}: variabel percentage geconfigureerd, maar geen begrote huurgrondslag uit Module 1 aanwezig — variabele vergoeding is € 0 voor dit complex.`,
      });
    }

    const vastToegepast = config?.vastBedragJaar !== null && config?.vastBedragJaar !== undefined;
    const variabelToegepast = config?.variabelPercentage !== null && config?.variabelPercentage !== undefined;

    const vastBedragMaandBasis = vastToegepast ? config!.vastBedragJaar!.dividedBy(12) : new Decimal(0);
    const variabelPercentageGebruikt = variabelToegepast ? config!.variabelPercentage! : null;

    let indexatiemaand: number | null = null;
    if (vastToegepast && config!.vastIndexatiedatum !== null) {
      if (config!.vastIndexatiedatum.getUTCFullYear() === module1.begrotingsjaar) {
        indexatiemaand = config!.vastIndexatiedatum.getUTCMonth() + 1;
      } else {
        controleVereist.push({
          complexnummer,
          ernst: "WAARSCHUWING",
          bericht: `Complex ${complexnummer}: vastIndexatiedatum (${config!.vastIndexatiedatum.toISOString().slice(0, 10)}) valt buiten begrotingsjaar ${module1.begrotingsjaar} — geen indexatie toegepast (Module 2 projecteert nooit, zie moduledoc).`,
        });
      }
    }
    const vastIndexatiePercentage = config?.vastIndexatiePercentage ?? new Decimal(0);

    const maandGrondslag = grondslag?.maandNettoHuur ?? Array.from({ length: 12 }, () => new Decimal(0));

    const regels: BgBeheerMaandRegel[] = [];
    for (let maand = 1; maand <= 12; maand += 1) {
      const vastVoorIndexatie = vastBedragMaandBasis;
      const indexatieActief = indexatiemaand !== null && maand >= indexatiemaand;
      const vastIndexatieEffect = indexatieActief ? vastVoorIndexatie.times(vastIndexatiePercentage).dividedBy(100) : new Decimal(0);
      const vastNaIndexatie = vastVoorIndexatie.plus(vastIndexatieEffect);
      const variabeleVergoeding = variabelToegepast ? maandGrondslag[maand - 1]!.times(variabelPercentageGebruikt!).dividedBy(100) : new Decimal(0);
      const totaleVergoeding = vastNaIndexatie.plus(variabeleVergoeding);

      regels.push({ maand, vastVoorIndexatie, vastIndexatieEffect, vastNaIndexatie, variabeleVergoeding, totaleVergoeding });
    }

    const jaartotaal: BgBeheerJaartotalen = {
      nettoHuurGrondslag: grondslag?.jaarNettoHuur ?? new Decimal(0),
      vastVoorIndexatie: som(regels.map((r) => r.vastVoorIndexatie)),
      vastIndexatieEffect: som(regels.map((r) => r.vastIndexatieEffect)),
      vastNaIndexatie: som(regels.map((r) => r.vastNaIndexatie)),
      variabeleVergoeding: som(regels.map((r) => r.variabeleVergoeding)),
      totaleVergoeding: som(regels.map((r) => r.totaleVergoeding)),
    };

    return { complexnummer, vastToegepast, variabelToegepast, variabelPercentageGebruikt, regels, jaartotaal };
  });

  const portefeuilleTotalen: BgBeheerPortefeuilleTotalen = leegJaartotaal();
  for (const c of complexUitkomsten) {
    portefeuilleTotalen.nettoHuurGrondslag = portefeuilleTotalen.nettoHuurGrondslag.plus(c.jaartotaal.nettoHuurGrondslag);
    portefeuilleTotalen.vastVoorIndexatie = portefeuilleTotalen.vastVoorIndexatie.plus(c.jaartotaal.vastVoorIndexatie);
    portefeuilleTotalen.vastIndexatieEffect = portefeuilleTotalen.vastIndexatieEffect.plus(c.jaartotaal.vastIndexatieEffect);
    portefeuilleTotalen.vastNaIndexatie = portefeuilleTotalen.vastNaIndexatie.plus(c.jaartotaal.vastNaIndexatie);
    portefeuilleTotalen.variabeleVergoeding = portefeuilleTotalen.variabeleVergoeding.plus(c.jaartotaal.variabeleVergoeding);
    portefeuilleTotalen.totaleVergoeding = portefeuilleTotalen.totaleVergoeding.plus(c.jaartotaal.totaleVergoeding);
  }

  return { begrotingsjaar: module1.begrotingsjaar, complexen: complexUitkomsten, portefeuilleTotalen, controleVereist };
}
