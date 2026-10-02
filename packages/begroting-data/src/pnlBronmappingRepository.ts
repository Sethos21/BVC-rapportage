import type { DatabaseSync } from "node:sqlite";
import type { PnLBronmappingRegel, PnLEconomischeModule } from "@bvc/reporting";

/**
 * FASE M4 (2026-09-14) — persistence-/repositorylaag voor de centrale
 * P&L-bronmappingarchitectuur. Zie migratie 24 (`migrations.ts`) voor het
 * schema en de volledige motivatie (geen "begroting_"-prefix: deze data is
 * NIET aan een begrotingsversie of CONCEPT/VASTGESTELD-levenscyclus
 * gekoppeld).
 *
 * DOELARCHITECTUUR (M4-opdracht §1): SQLite → deze repository → platte
 * `PnLBronmappingRegel[]` → de bestaande, ONGEWIJZIGDE, pure
 * `resolveerPnLBronmapping` (`@bvc/reporting`'s `pnlBronmapping.ts`) →
 * module-orchestratie (bv. M3b's `berekenWerkelijkRenteViaCentraleMapping`).
 * Deze repository kent GEEN economische rekenlogica en roept de resolver
 * zelf nooit aan — ze levert uitsluitend data. De resolver blijft dus
 * volledig database-onafhankelijk, exact zoals geëist.
 *
 * GEEN MODULE-SPECIFIEKE METHODEN (M4-opdracht §7): `leesPnLBronmappingRegels`
 * kent `economischeModule` uitsluitend als DATA op elke rij, nooit als
 * aparte functie-naam/implementatie (dus geen `leesRenteMappings()` /
 * `leesLeegstandMappings()`). Een aanroeper die specifiek Rente wil, filtert
 * zelf op `economischeModule === "RENTE"` — dat is precies hoe M3b's adapter
 * de resolver ook al aanroept (de resolver filtert intern al op
 * bedrijfsnr+grootboekrekening, een module-filter voegt geen nieuwe
 * businesslogica toe).
 *
 * COMPLETE-HISTORIE-LEZEN, GEEN PERIODEFILTER IN SQL (M4-opdracht §7,
 * "indien nuttig" — hier bewust NIET gebouwd): `leesPnLBronmappingRegels`
 * geeft ALLE mappingregels van een administratie terug, over alle
 * geldigheids-/systeemtijd heen. De periodegevoelige resolutielogica
 * (geldigheidsinterval + `aangemaaktOp`-tiebreak) bestaat al, volledig
 * getest en pure, in `resolveerPnLBronmapping` — die logica in SQL
 * herhalen zou een tweede, potentieel afwijkende implementatie van
 * dezelfde regel betekenen. Voor een enkele administratie is het
 * regelaantal bovendien klein genoeg (tientallen tot enkele honderden) om
 * dit zonder DB-side filtering te lezen.
 *
 * MUTATIE = ÉÉN GECONTROLEERDE INGANG (M4-opdracht §5/§6/§7):
 * `voegPnLBronmappingMutatieToe` is de ENIGE schrijf-ingang. Ze:
 *  1. valideert structureel (periode 01-12, geldigTot > geldigVanaf) mét een
 *     heldere JS-foutmelding VÓÓR enige schrijfactie (de gelijknamige
 *     database-CHECK's in migratie 24 zijn de backstop voor elk ander
 *     schrijfpad, nooit de enige verdedigingslinie hier);
 *  2. valideert de GL-ECONOMISCH-DOMEIN-INVARIANT (aangescherpt in FASE M4b,
 *     2026-09-15 — ziet strenger dan M4's oorspronkelijke, overlap-gebaseerde
 *     check): voor (bedrijfsnr, grootboekrekening) geldt precies ÉÉN
 *     `economischeModule` over de VOLLEDIGE mappinghistorie — ongeacht
 *     `ogbKostensoort`, ONGEACHT overlap, en ongeacht of een bestaande rij
 *     inmiddels gesloten is. M4's eerste versie controleerde uitsluitend
 *     OVERLAPPENDE rijen, wat een loophole opende: een
 *     `NIEUWE_MAPPING_VANAF_PERIODE` kon een GL na het sluiten van de vorige
 *     rij alsnog naar een ANDERE `economischeModule` laten "springen" (bv.
 *     GL4600 RENTE → vanaf periode X LEEGSTAND) — technisch consistent met de
 *     overlapcheck, maar in strijd met de hoofdregel "grootboekrekening
 *     bepaalt het economische hoofddomein". M4b sluit die loophole: de check
 *     kijkt nu naar ALLE rijen van de GL, punt, niet alleen overlappende. Een
 *     bewuste, latere betekeniswijziging van een grootboekrekening zelf is
 *     GEEN gewone mappingmutatie — dat vereist een aparte, expliciete
 *     architectuur-/businessbeslissing met eigen migratie (bewust NIET hier
 *     gebouwd, zie M4b-opdracht §3). Bestaat er nog GEEN enkele rij voor die
 *     GL, dan legt DEZE mutatie het domein vast (Rente-nuance, M4-opdracht
 *     §5: de EERSTE GL+OGB-rij bepaalt het domein, een GL zonder GL-default
 *     is en blijft geldig).
 *  3. schrijft — ALTIJD binnen dezelfde `BEGIN IMMEDIATE`-transactie —
 *     de nieuwe mappingrij, optioneel de sluiting van de vorige rij se
 *     geldigheidsinterval (uitsluitend bij `NIEUWE_MAPPING_VANAF_PERIODE`
 *     mét een opgegeven `vorigeMappingId`), en precies één
 *     wijzigingslogregel. Faalt een van deze stappen, dan rolt de VOLLEDIGE
 *     transactie terug (invariant F/G) — nooit een mapping zonder log, of
 *     een gesloten interval zonder log.
 *
 * TWEE MUTATIEVORMEN (M4-opdracht §6, M1-resolutiesemantiek):
 *  - HISTORISCHE_CORRECTIE: de bestaande rij(en) blijven ONGEWIJZIGD — de
 *    nieuwe rij krijgt bewust een (mogelijk) overlappend geldigheidsinterval,
 *    en de live resolver kiest via `aangemaaktOp` (hoogste wint) automatisch
 *    de nieuwste kennis. Geen enkele UPDATE op een bestaande rij.
 *  - NIEUWE_MAPPING_VANAF_PERIODE: de economische betekenis verandert
 *    werkelijk vanaf een gekozen periode. Is `vorigeMappingId` opgegeven, dan
 *    wordt PRECIES dat ene interval gesloten (`geldig_tot` = deze mutatie se
 *    `geldigVanaf`) — nooit destructief overschreven, uitsluitend het
 *    open/lopende einde van het interval vastgezet. `vorigeMappingId` mag
 *    ontbreken (bv. de allereerste mapping voor een nieuwe GL/OGB-combinatie
 *    — er is dan niets te sluiten).
 *
 * Na elke mutatie geeft `leesPnLBronmappingRegels` + de ongewijzigde
 * `resolveerPnLBronmapping` exact hetzelfde gedrag als de in-memory M1-tests
 * — bewezen in `pnlBronmappingRepository.test.ts`.
 */

export interface PnLBronmappingOpgeslagenRegel extends PnLBronmappingRegel {
  id: number;
  grootboekOmschrijving: string | null;
  ogbKostensoortOmschrijving: string | null;
  /** Actor die deze mapping heeft aangemaakt — vrije waarde, geen rollen-/rechtenmodel (zie moduledoc). */
  aangemaaktDoor: string;
}

export type PnLMappingMutatieType = "HISTORISCHE_CORRECTIE" | "NIEUWE_MAPPING_VANAF_PERIODE";

export interface PnLBronmappingMutatieInvoer {
  bedrijfsnr: string;
  grootboekrekening: string;
  /** Uitsluitend informatief — codes zijn leidend, zie moduledoc. */
  grootboekOmschrijving: string | null;
  ogbKostensoort: string | null;
  /** Uitsluitend informatief, betekenisloos als `ogbKostensoort` null is. */
  ogbKostensoortOmschrijving: string | null;
  economischeModule: PnLEconomischeModule;
  economischeCategorie: string;
  geldigVanafBoekjaar: number;
  geldigVanafPeriode: string;
  geldigTotBoekjaar: number | null;
  geldigTotPeriode: string | null;
  type: PnLMappingMutatieType;
  /**
   * Id van de mapping die deze mutatie inhoudelijk vervangt/corrigeert —
   * uitsluitend informatief bij HISTORISCHE_CORRECTIE (geen enkele rij wordt
   * aangepast); bij NIEUWE_MAPPING_VANAF_PERIODE bepaalt een niet-null waarde
   * hier WELKE bestaande rij se geldigheidsinterval wordt gesloten (zie
   * moduledoc). `null` is bij beide types toegestaan.
   */
  vorigeMappingId: number | null;
  gewijzigdOp: Date;
  /** Vrije actorwaarde — geen hardcoded gebruiker, geen rollen-/rechtenmodel (M4-opdracht §10). */
  gebruiker: string;
  wijzigingsreden: string;
}

export interface PnLMappingWijzigingLogRegel {
  id: number;
  bedrijfsnr: string;
  type: PnLMappingMutatieType;
  geldigVanafBoekjaar: number;
  geldigVanafPeriode: string;
  vorigeMappingId: number | null;
  nieuweMappingId: number;
  gewijzigdOp: Date;
  gebruiker: string;
  wijzigingsreden: string;
}

export interface PnLBronmappingMutatieResultaat {
  nieuweMapping: PnLBronmappingOpgeslagenRegel;
  wijzigingLog: PnLMappingWijzigingLogRegel;
}

interface PnLBronmappingRow {
  id: number;
  bedrijfsnr: string;
  grootboekrekening: string;
  grootboek_omschrijving: string | null;
  ogb_kostensoort: string | null;
  ogb_kostensoort_omschrijving: string | null;
  economische_module: PnLEconomischeModule;
  economische_categorie: string;
  geldig_vanaf_boekjaar: number;
  geldig_vanaf_periode: string;
  geldig_tot_boekjaar: number | null;
  geldig_tot_periode: string | null;
  aangemaakt_op: string;
  aangemaakt_door: string;
}

function rijNaarRegel(rij: PnLBronmappingRow): PnLBronmappingOpgeslagenRegel {
  return {
    id: rij.id,
    bedrijfsnr: rij.bedrijfsnr,
    grootboekrekening: rij.grootboekrekening,
    grootboekOmschrijving: rij.grootboek_omschrijving,
    ogbKostensoort: rij.ogb_kostensoort,
    ogbKostensoortOmschrijving: rij.ogb_kostensoort_omschrijving,
    economischeModule: rij.economische_module,
    economischeCategorie: rij.economische_categorie,
    geldigVanafBoekjaar: rij.geldig_vanaf_boekjaar,
    geldigVanafPeriode: rij.geldig_vanaf_periode,
    geldigTotBoekjaar: rij.geldig_tot_boekjaar,
    geldigTotPeriode: rij.geldig_tot_periode,
    aangemaaktOp: new Date(rij.aangemaakt_op),
    aangemaaktDoor: rij.aangemaakt_door,
  };
}

function withWriteTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const resultaat = fn();
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

interface Periode {
  boekjaar: number;
  boekperiode: string;
}

/** Zelfde lexicografische (boekjaar, boekperiode)-vergelijking als `@bvc/reporting`'s `pnlBronmapping.ts` — bewust een kleine, losse kopie (tuple-vergelijking, geen businesslogica) i.p.v. een gedeelde util. */
function vergelijkPeriode(a: Periode, b: Periode): number {
  if (a.boekjaar !== b.boekjaar) return a.boekjaar - b.boekjaar;
  return a.boekperiode.localeCompare(b.boekperiode);
}

const PERIODE_PATROON = /^(0[1-9]|1[0-2])$/;

function valideerPeriode(periode: string, veldnaam: string): void {
  if (!PERIODE_PATROON.test(periode)) {
    throw new Error(`Ongeldige ${veldnaam} "${periode}" — moet "01".."12" zijn.`);
  }
}

/** Leest ALLE mappingregels van één administratie, over alle geldigheids-/systeemtijd heen — zie moduledoc voor waarom er bewust geen periodefilter in SQL zit. */
export function leesPnLBronmappingRegels(db: DatabaseSync, bedrijfsnr: string): readonly PnLBronmappingOpgeslagenRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, bedrijfsnr, grootboekrekening, grootboek_omschrijving, ogb_kostensoort, ogb_kostensoort_omschrijving,
              economische_module, economische_categorie, geldig_vanaf_boekjaar, geldig_vanaf_periode,
              geldig_tot_boekjaar, geldig_tot_periode, aangemaakt_op, aangemaakt_door
       FROM pnl_bronmapping
       WHERE bedrijfsnr = ?
       ORDER BY id`,
    )
    .all(bedrijfsnr) as unknown as PnLBronmappingRow[];
  return rijen.map(rijNaarRegel);
}

function leesPnLBronmappingRegelById(db: DatabaseSync, id: number): PnLBronmappingOpgeslagenRegel | null {
  const rij = db
    .prepare(
      `SELECT id, bedrijfsnr, grootboekrekening, grootboek_omschrijving, ogb_kostensoort, ogb_kostensoort_omschrijving,
              economische_module, economische_categorie, geldig_vanaf_boekjaar, geldig_vanaf_periode,
              geldig_tot_boekjaar, geldig_tot_periode, aangemaakt_op, aangemaakt_door
       FROM pnl_bronmapping
       WHERE id = ?`,
    )
    .get(id) as unknown as PnLBronmappingRow | undefined;
  return rij === undefined ? null : rijNaarRegel(rij);
}

/** Leest het volledige, append-only wijzigingslog voor één administratie — voor tests/latere UI/audit (M4-opdracht §7). */
export function leesPnLMappingWijzigingLog(db: DatabaseSync, bedrijfsnr: string): readonly PnLMappingWijzigingLogRegel[] {
  const rijen = db
    .prepare(
      `SELECT id, bedrijfsnr, type, geldig_vanaf_boekjaar, geldig_vanaf_periode, vorige_mapping_id, nieuwe_mapping_id, gewijzigd_op, gebruiker, wijzigingsreden
       FROM pnl_mapping_wijziging_log
       WHERE bedrijfsnr = ?
       ORDER BY id`,
    )
    .all(bedrijfsnr) as unknown as {
    id: number;
    bedrijfsnr: string;
    type: PnLMappingMutatieType;
    geldig_vanaf_boekjaar: number;
    geldig_vanaf_periode: string;
    vorige_mapping_id: number | null;
    nieuwe_mapping_id: number;
    gewijzigd_op: string;
    gebruiker: string;
    wijzigingsreden: string;
  }[];
  return rijen.map((rij) => ({
    id: rij.id,
    bedrijfsnr: rij.bedrijfsnr,
    type: rij.type,
    geldigVanafBoekjaar: rij.geldig_vanaf_boekjaar,
    geldigVanafPeriode: rij.geldig_vanaf_periode,
    vorigeMappingId: rij.vorige_mapping_id,
    nieuweMappingId: rij.nieuwe_mapping_id,
    gewijzigdOp: new Date(rij.gewijzigd_op),
    gebruiker: rij.gebruiker,
    wijzigingsreden: rij.wijzigingsreden,
  }));
}

/**
 * De ENIGE gecontroleerde schrijf-ingang voor de centrale P&L-bronmapping.
 * Zie moduledoc voor de volledige flow/invarianten. Atomair: mapping +
 * (optionele sluiting van de vorige rij) + wijzigingslog slagen samen, of
 * rollen samen terug (invariant G).
 */
export function voegPnLBronmappingMutatieToe(db: DatabaseSync, invoer: PnLBronmappingMutatieInvoer): PnLBronmappingMutatieResultaat {
  valideerPeriode(invoer.geldigVanafPeriode, "geldigVanafPeriode");
  if (invoer.geldigTotBoekjaar !== null || invoer.geldigTotPeriode !== null) {
    if (invoer.geldigTotBoekjaar === null || invoer.geldigTotPeriode === null) {
      throw new Error("geldigTotBoekjaar en geldigTotPeriode moeten beide null zijn, of beide gevuld — nooit één van beide.");
    }
    valideerPeriode(invoer.geldigTotPeriode, "geldigTotPeriode");
    const vanaf: Periode = { boekjaar: invoer.geldigVanafBoekjaar, boekperiode: invoer.geldigVanafPeriode };
    const tot: Periode = { boekjaar: invoer.geldigTotBoekjaar, boekperiode: invoer.geldigTotPeriode };
    if (vergelijkPeriode(tot, vanaf) <= 0) {
      throw new Error(
        `Ongeldig geldigheidsinterval: geldigTot (${invoer.geldigTotBoekjaar}-${invoer.geldigTotPeriode}) moet ná geldigVanaf (${invoer.geldigVanafBoekjaar}-${invoer.geldigVanafPeriode}) liggen.`,
      );
    }
  }
  if (invoer.bedrijfsnr === "" || invoer.grootboekrekening === "") {
    throw new Error("bedrijfsnr en grootboekrekening zijn verplicht.");
  }

  return withWriteTransaction(db, () => {
    const nieuweVanaf: Periode = { boekjaar: invoer.geldigVanafBoekjaar, boekperiode: invoer.geldigVanafPeriode };

    // Optioneel EERST: sluit het geldigheidsinterval van de vorige mapping (uitsluitend
    // NIEUWE_MAPPING_VANAF_PERIODE mét een opgegeven vorigeMappingId — zie moduledoc). Geen enkele
    // andere update op een bestaande rij.
    if (invoer.type === "NIEUWE_MAPPING_VANAF_PERIODE" && invoer.vorigeMappingId !== null) {
      const vorige = leesPnLBronmappingRegelById(db, invoer.vorigeMappingId);
      if (vorige === null) {
        throw new Error(`vorigeMappingId ${invoer.vorigeMappingId} bestaat niet.`);
      }
      if (vorige.bedrijfsnr !== invoer.bedrijfsnr || vorige.grootboekrekening !== invoer.grootboekrekening || vorige.ogbKostensoort !== invoer.ogbKostensoort) {
        throw new Error(
          `vorigeMappingId ${invoer.vorigeMappingId} hoort bij een andere (bedrijfsnr, grootboekrekening, ogbKostensoort)-combinatie dan deze mutatie — kan niet als "vorige mapping" worden gesloten.`,
        );
      }
      const vorigeVanaf: Periode = { boekjaar: vorige.geldigVanafBoekjaar, boekperiode: vorige.geldigVanafPeriode };
      if (vergelijkPeriode(vorigeVanaf, nieuweVanaf) >= 0) {
        throw new Error(`vorigeMappingId ${invoer.vorigeMappingId} (geldig vanaf ${vorige.geldigVanafBoekjaar}-${vorige.geldigVanafPeriode}) ligt niet vóór de nieuwe mapping (vanaf ${invoer.geldigVanafBoekjaar}-${invoer.geldigVanafPeriode}).`);
      }
      if (vorige.geldigTotBoekjaar !== null) {
        const vorigeTot: Periode = { boekjaar: vorige.geldigTotBoekjaar, boekperiode: vorige.geldigTotPeriode! };
        if (vergelijkPeriode(vorigeTot, nieuweVanaf) <= 0) {
          throw new Error(
            `vorigeMappingId ${invoer.vorigeMappingId} is al gesloten per ${vorige.geldigTotBoekjaar}-${vorige.geldigTotPeriode}, vóór de nieuwe geldigVanaf (${invoer.geldigVanafBoekjaar}-${invoer.geldigVanafPeriode}) — kan een reeds gesloten interval niet verplaatsen.`,
          );
        }
      }
      db.prepare(`UPDATE pnl_bronmapping SET geldig_tot_boekjaar = ?, geldig_tot_periode = ? WHERE id = ?`).run(
        invoer.geldigVanafBoekjaar,
        invoer.geldigVanafPeriode,
        invoer.vorigeMappingId,
      );
    }

    // GL-ECONOMISCH-DOMEIN-INVARIANT (FASE M4b, aangescherpt t.o.v. M4): voor (bedrijfsnr,
    // grootboekrekening) geldt precies ÉÉN economischeModule over de VOLLEDIGE mappinghistorie —
    // ongeacht ogbKostensoort, ongeacht overlap, ongeacht of een rij inmiddels gesloten is (zie
    // moduledoc "GL-economisch-domein" hierboven). Bestaat er nog geen enkele rij voor deze GL, dan
    // legt DEZE mutatie het domein vast (geen check nodig — dit is precies hoe Rente zonder
    // GL-default werkt: de eerste GL+OGB-rij bepaalt het domein voor alle latere rijen).
    const afwijkendeModuleRij = db
      .prepare(`SELECT id, economische_module FROM pnl_bronmapping WHERE bedrijfsnr = ? AND grootboekrekening = ? AND economische_module <> ? LIMIT 1`)
      .get(invoer.bedrijfsnr, invoer.grootboekrekening, invoer.economischeModule) as { id: number; economische_module: PnLEconomischeModule } | undefined;

    if (afwijkendeModuleRij !== undefined) {
      throw new Error(
        `Bedrijfsnr ${invoer.bedrijfsnr}, GL ${invoer.grootboekrekening}: deze grootboekrekening is al vastgelegd met economischeModule "${afwijkendeModuleRij.economische_module}" (mapping id=${afwijkendeModuleRij.id}) — een grootboekrekening mag nooit van economische module wisselen via een gewone mappingmutatie (GL-default, GL+OGB, historische correctie of nieuwe mapping vanaf periode — ongeacht overlap, ook een reeds afgesloten rij blijft het domein bepalen). Een echte betekeniswijziging van de grootboekrekening zelf vereist een aparte, expliciete architectuur-/businessbeslissing met eigen migratie, geen gewone mappingmutatie.`,
      );
    }

    const aangemaaktOpIso = invoer.gewijzigdOp.toISOString();
    const insertResultaat = db
      .prepare(
        `INSERT INTO pnl_bronmapping
           (bedrijfsnr, grootboekrekening, grootboek_omschrijving, ogb_kostensoort, ogb_kostensoort_omschrijving,
            economische_module, economische_categorie, geldig_vanaf_boekjaar, geldig_vanaf_periode,
            geldig_tot_boekjaar, geldig_tot_periode, aangemaakt_op, aangemaakt_door)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        invoer.bedrijfsnr,
        invoer.grootboekrekening,
        invoer.grootboekOmschrijving,
        invoer.ogbKostensoort,
        invoer.ogbKostensoortOmschrijving,
        invoer.economischeModule,
        invoer.economischeCategorie,
        invoer.geldigVanafBoekjaar,
        invoer.geldigVanafPeriode,
        invoer.geldigTotBoekjaar,
        invoer.geldigTotPeriode,
        aangemaaktOpIso,
        invoer.gebruiker,
      );
    const nieuweMappingId = Number(insertResultaat.lastInsertRowid);

    const logResultaat = db
      .prepare(
        `INSERT INTO pnl_mapping_wijziging_log
           (bedrijfsnr, type, geldig_vanaf_boekjaar, geldig_vanaf_periode, vorige_mapping_id, nieuwe_mapping_id, gewijzigd_op, gebruiker, wijzigingsreden)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        invoer.bedrijfsnr,
        invoer.type,
        invoer.geldigVanafBoekjaar,
        invoer.geldigVanafPeriode,
        invoer.vorigeMappingId,
        nieuweMappingId,
        invoer.gewijzigdOp.toISOString(),
        invoer.gebruiker,
        invoer.wijzigingsreden,
      );
    const logId = Number(logResultaat.lastInsertRowid);

    const nieuweMapping = leesPnLBronmappingRegelById(db, nieuweMappingId);
    if (nieuweMapping === null) {
      throw new Error(`Interne fout: mapping ${nieuweMappingId} kon direct na aanmaak niet worden teruggelezen.`);
    }

    return {
      nieuweMapping,
      wijzigingLog: {
        id: logId,
        bedrijfsnr: invoer.bedrijfsnr,
        type: invoer.type,
        geldigVanafBoekjaar: invoer.geldigVanafBoekjaar,
        geldigVanafPeriode: invoer.geldigVanafPeriode,
        vorigeMappingId: invoer.vorigeMappingId,
        nieuweMappingId,
        gewijzigdOp: invoer.gewijzigdOp,
        gebruiker: invoer.gebruiker,
        wijzigingsreden: invoer.wijzigingsreden,
      },
    };
  });
}
