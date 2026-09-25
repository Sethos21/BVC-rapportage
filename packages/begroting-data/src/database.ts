import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations } from "./migrations.js";

/**
 * Opent `begrotingen.sqlite` (maakt het bestand + bovenliggende map aan als
 * ze nog niet bestaan), zet de vereiste PRAGMA's en past ontbrekende
 * migraties toe. In tegenstelling tot `packages/cache`'s
 * `openCacheReadonly` (die uitsluitend een BESTAAND, kant-en-klaar bestand
 * read-only opent) is dit hier de enige, schrijfbare toegangsweg tot de
 * Begrotingsmodule-database — bootstrap en toegang zijn hier bewust één
 * functie, omdat elke opening (ook de eerste) zowel de PRAGMA's als de
 * migratiestatus moet garanderen.
 *
 * PRAGMA's worden op ELKE open opnieuw gezet — `foreign_keys` en
 * `busy_timeout` zijn per-connectie-instellingen die SQLite niet in het
 * bestand zelf onthoudt; `journal_mode = WAL` is in theorie persistent na de
 * eerste keer, maar wordt hier voor de duidelijkheid en robuustheid ook
 * altijd expliciet gezet (goedkoop, idempotent).
 *
 * Invariant: deze functie geeft UITSLUITEND een open handle terug als
 * PRAGMA's + migraties volledig zijn geslaagd. Faalt een van beide, dan
 * wordt de zojuist geopende handle eerst gesloten (geen lingering
 * filehandle/lock) vóórdat de oorspronkelijke fout wordt doorgegeven — de
 * aanroeper krijgt in dat geval nooit een `db`-object terug en kan dus zelf
 * ook niet vergeten hem te sluiten.
 */
export function openOrCreateDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    runMigrations(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
