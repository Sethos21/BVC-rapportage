// `runMigrations`/`MIGRATIONS`/`Migration` (migrations.js) zijn BEWUST niet
// hier publiek herexporteerd — de injecteerbare migratielijst van
// `runMigrations` is uitsluitend een testbaarheidshaak (zie migrations.test.ts,
// die er via het relatieve pad "./migrations.js" bij kan) en geen bedoelde
// business-API. `openOrCreateDatabase` is het enige publieke toegangspunt
// van dit package.
export * from "./database.js";
