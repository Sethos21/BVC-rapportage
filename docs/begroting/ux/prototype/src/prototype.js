const eur = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });

const modules = [
  { id: 'rent', name: 'Netto huuropbrengsten', description: 'Huurinkomsten na leegstand en kortingen', source: 'Huuradministratie', date: '01-09-2026', previousBudget: 1765000, actuals: 1214000, estimated: 1815000, proposal: 1842000, budget: 1842000, status: 'ready', note: 'Het voorstel is opgebouwd uit actuele contracthuur, bekende indexaties, leegstand en kortingen.' },
  { id: 'beheer', name: 'Beheersvergoeding', description: 'Vaste en variabele vergoeding voor administratief beheer', source: 'Beheerafspraken per complex', date: '01-01-2026', previousBudget: 104000, actuals: 72000, estimated: 108000, proposal: 103940, budget: 103940, status: 'ready', note: 'Vast deel geïndexeerd; variabel deel berekend over de netto begrote huur per complex.' },
  { id: 'management', name: 'Managementvergoeding', description: 'Vaste vergoeding met maandnauwkeurige indexatie of bedragwijziging', source: 'Geen betrouwbare bron', date: 'n.v.t.', previousBudget: null, actuals: null, estimated: null, proposal: null, budget: null, status: 'missing', note: 'Kies bewust hoe de managementvergoeding voor 2027 moet worden opgebouwd.' },
  { id: 'planned', name: 'Gepland onderhoud', description: 'Activiteiten voor rekening van de eigenaar', source: 'Handmatige activiteiten', date: '08-09-2026', previousBudget: 360000, actuals: 248000, estimated: 382000, proposal: null, budget: 395000, status: 'attention', planned: true },
  { id: 'corrective', name: 'Correctief / dagelijks onderhoud', description: 'Kleine en grotendeels onvoorspelbare herstellingen', source: 'Handmatige onderbouwing', date: '08-09-2026', previousBudget: 90000, actuals: 70000, estimated: 102000, proposal: null, budget: 95000, status: 'pending', corrective: true },
  { id: 'insurance', name: 'Verzekeringen', description: 'Opstal, aansprakelijkheid en overige', source: 'Handmatige polisinvoer', date: '08-09-2026', previousBudget: 58500, actuals: 40400, estimated: 60600, proposal: 62300, budget: 62300, status: 'offer', insurance: true, note: 'Het voorstel is berekend uit de handmatig vastgelegde polisregels.' },
  { id: 'municipal', name: 'Gemeentelijke lasten pand', description: 'WOZ, OZB, watersysteem- en rioolheffing als één totaal', source: 'Lasten uit administratie · WOZ handmatig', date: '08-09-2026', previousBudget: 82500, actuals: 79300, estimated: 79300, proposal: null, budget: null, status: 'missing', municipal: true, note: 'Het voorstel kan worden berekend nadat de WOZ-waarden per complex of unit handmatig zijn ingevoerd.' },
  { id: 'canon', name: 'Canon erfpacht', description: 'Jaarcanon per complex, verhoogd met indexering', source: 'Handmatige invoer per complex', date: 'n.v.t.', previousBudget: 0, actuals: 0, estimated: 0, proposal: null, budget: null, status: 'missing', canon: true, note: 'Vul per complex de jaarcanon en indexering in, of leg bewust €0 vast.' },
];

// Illustratieve administratiecodes voor de UX-proef. In productie komen code en
// omschrijving uitsluitend uit de bron; de code blijft de gezaghebbende sleutel.
const ogbKostensoorten = [
  { id: 'HUU-100', code: 'HUU-100', description: 'Contractuele huuropbrengst', group: 'Opbrengsten' },
  { id: 'HUU-110', code: 'HUU-110', description: 'Leegstand en huurderving', group: 'Opbrengsten' },
  { id: 'BEH-210', code: 'BEH-210', description: 'Vaste beheersvergoeding', group: 'Beheer' },
  { id: 'BEH-220', code: 'BEH-220', description: 'Variabele beheersvergoeding', group: 'Beheer' },
  { id: 'MAN-300', code: 'MAN-300', description: 'Managementvergoeding', group: 'Management' },
  { id: 'OND-410', code: 'OND-410', description: 'Dak en gevel', group: 'Onderhoud' },
  { id: 'OND-420', code: 'OND-420', description: 'Gebouwinstallaties', group: 'Onderhoud' },
  { id: 'OND-430', code: 'OND-430', description: 'Dagelijks onderhoud', group: 'Onderhoud' },
  { id: 'OND-440', code: 'OND-440', description: 'Riool en afvoer', group: 'Onderhoud' },
  { id: '4131', code: '4131', description: 'Brand-/opstalverzekering', group: 'Verzekeringen' },
  { id: 'VER-520', code: 'VER-520', description: 'Aansprakelijkheidsverzekering', group: 'Verzekeringen' },
  { id: 'VER-530', code: 'VER-530', description: 'Overige verzekeringen', group: 'Verzekeringen' },
  { id: '4701', code: '4701', description: 'OZB eigenaar', group: 'Gemeentelijke lasten' },
];

// Illustratieve grootboekrekeningen voor de UX-proef. De grootboekrekening is
// altijd leidend; de bestaande grootboekmapping bepaalt op welke P&L-post een
// begrotingsregel en de latere realisatie terechtkomen.
const grootboekrekeningen = [
  { id: '8000', code: '8000', description: 'Huuropbrengsten' },
  { id: '8090', code: '8090', description: 'Leegstand en huurkortingen' },
  { id: '4100', code: '4100', description: 'Beheersvergoeding' },
  { id: '4120', code: '4120', description: 'Managementvergoeding' },
  { id: '4300', code: '4300', description: 'Onderhoud gebouwen' },
  { id: '4330', code: '4330', description: 'Onderhoud terrein' },
  { id: '4340', code: '4340', description: 'Onderhoud installaties' },
  { id: '4130', code: '4130', description: 'Verzekeringen' },
  { id: '4700', code: '4700', description: 'OZB' },
  { id: '4710', code: '4710', description: 'Gemeentelijke heffingen' },
  { id: '4720', code: '4720', description: 'Canon erfpacht' },
];

const rekeningMappings = {
  rent: { accounts: ['8000', '8090'], niveau: 'Contractregels' },
  beheer: { accounts: ['4100'], niveau: 'Complexregels' },
  management: { accounts: [], niveau: 'Vergoedingsregel' },
  planned: { accounts: ['4300', '4330', '4340'], niveau: 'Activiteiten' },
  corrective: { accounts: ['4300', '4330', '4340'], niveau: 'Jaarregels' },
  insurance: { accounts: ['4130'], niveau: 'Polisregels' },
  municipal: { accounts: ['4700', '4710'], niveau: 'Grootboekverdeling' },
  canon: { accounts: ['4720'], niveau: 'Complexregels' },
};

// Alleen ter illustratie van brondata: dezelfde OGB-code mag op meerdere
// grootboekrekeningen voorkomen. Dit is geen keuzebeperking of P&L-mapping.
const observedOgbByAccount = {
  '4300': ['OND-410', 'OND-430'],
  '4330': ['OND-410', 'OND-440'],
  '4340': ['OND-420', 'OND-430'],
  '4130': ['4131', 'VER-520'],
  '4700': ['4701'],
  '4710': [],
  '4720': [],
};

const rentComplexes = [
  { id: 'rz-1-3', name: 'Rooise Zoom 1–3', contracts: 18, contractRent: 790000, indexation: 23700, vacancy: -45700, proposal: 768000, budget: 768000 },
  { id: 'rz-4-6', name: 'Rooise Zoom 4–6', contracts: 15, contractRent: 670000, indexation: 20100, vacancy: -28100, proposal: 662000, budget: 662000 },
  { id: 'rz-7-8', name: 'Rooise Zoom 7–8', contracts: 9, contractRent: 432000, indexation: 12960, vacancy: -32960, proposal: 412000, budget: 412000 },
];

const rentContracts = [
  { unit: '1.01', tenant: 'Van der Aa Advies B.V.', complexId: 'rz-1-3', complex: 'Rooise Zoom 1–3', end: '31-12-2029', rent: 118800, baseNet: 118800, proposal: 122364, overridePct: null },
  { unit: '2.03', tenant: 'Noviq Zorggroep', complexId: 'rz-1-3', complex: 'Rooise Zoom 1–3', end: '30-06-2027', rent: 96000, baseNet: 88000, proposal: 90640, overridePct: null, attention: true },
  { unit: '4.02', tenant: 'Studio Zuid B.V.', complexId: 'rz-4-6', complex: 'Rooise Zoom 4–6', end: '31-12-2030', rent: 84600, baseNet: 84600, proposal: 87138, overridePct: null },
  { unit: '7.01', tenant: 'RZ Accountants', complexId: 'rz-7-8', complex: 'Rooise Zoom 7–8', end: '31-03-2027', rent: 72000, baseNet: 54000, proposal: 55620, overridePct: null, attention: true },
];

const beheerConfigs = [
  { complexId: 'rz-1-3', fixedAnnual: 12000, fixedIndexPct: 3, fixedIndexDate: '2027-01-01', variablePct: 4, contractFixedAnnual: 12000, contractFixedIndexPct: 3, contractFixedIndexDate: '2027-01-01', contractVariablePct: 4 },
  { complexId: 'rz-4-6', fixedAnnual: 10000, fixedIndexPct: 2.5, fixedIndexDate: '2027-07-01', variablePct: 4.25, contractFixedAnnual: 10000, contractFixedIndexPct: 2.5, contractFixedIndexDate: '2027-07-01', contractVariablePct: 4.25 },
  { complexId: 'rz-7-8', fixedAnnual: 8000, fixedIndexPct: 3, fixedIndexDate: '2027-04-01', variablePct: 3.5, contractFixedAnnual: 8000, contractFixedIndexPct: 3, contractFixedIndexDate: '2027-04-01', contractVariablePct: 3.5 },
];

const managementConfig = {
  mode: null,
  existingAmount: 1000,
  existingUnit: 'MONTH',
  indexPct: 3,
  indexDate: '2027-07-01',
  newAmount: 1200,
  newUnit: 'MONTH',
  effectiveDate: '2027-07-01',
};

const plannedActivities = [
  { id: 1, complex: 'Rooise Zoom 1–3', description: 'Vervanging dakbedekking', glAccount: '4300', ogbCode: 'OND-410', source: 'MJOP', sourceDetail: 'MJOP 2026–2035 · regel 14', q1: 0, q2: 120000, q3: 0, q4: 0, status: 'GEPLAND', supplier: 'Dakgroep Zuid', offer: 118500, note: 'Uitvoering combineren met inspectie hemelwaterafvoer.' },
  { id: 2, complex: 'Rooise Zoom 4–6', description: 'Schilderwerk exterieur', glAccount: '4300', ogbCode: '', source: 'OFFERTE', sourceDetail: 'Offerte SCH-2026-184', q1: 0, q2: 0, q3: 150000, q4: 0, status: 'GEPLAND', supplier: 'Schildersbedrijf Van de Ven', offer: 147800, note: '' },
  { id: 3, complex: 'Rooise Zoom 7–8', description: 'Vervangen luchtbehandelingskast', glAccount: '4340', ogbCode: 'OND-420', source: 'INSPECTIE', sourceDetail: 'Technische inspectie 22-08-2026', q1: 0, q2: 0, q3: 0, q4: 125000, status: 'GEPLAND', supplier: '', offer: null, note: 'Offerte wordt in oktober verwacht.' },
];

const plannedPreviousActivities = [
  { id: 'p1', complex: 'Rooise Zoom 1–3', description: 'Dakbedekking fase 1', source: 'MJOP', q1: 0, q2: 160000, q3: 0, q4: 0, status: 'AFGEROND' },
  { id: 'p2', complex: 'Rooise Zoom 4–6', description: 'Schilderwerk exterieur', source: 'MJOP', q1: 0, q2: 0, q3: 120000, q4: 0, status: 'IN_UITVOERING' },
  { id: 'p3', complex: 'Rooise Zoom 7–8', description: 'Vervangen regeltechniek', source: 'INSPECTIE', q1: 0, q2: 0, q3: 0, q4: 80000, status: 'UITGESTELD' },
];

const plannedEstimatedRows = [
  { id: 'e1', complex: 'Rooise Zoom 4–6', description: 'Schilderwerk exterieur', source: 'MJOP', q3: 45000, q4: 45000, status: 'IN_UITVOERING', isNew: false },
  { id: 'e2', complex: 'Rooise Zoom 7–8', description: 'Herstel regeltechniek', source: 'INSPECTIE', q3: 0, q4: 0, status: 'UITGESTELD', isNew: false },
  { id: 'e3', complex: 'Rooise Zoom 1–3', description: 'Aanvullend dakherstel', source: 'OVERIG', q3: 18000, q4: 26000, status: 'ONVOORZIEN', isNew: true },
];

const correctiveRows = [
  { id: 1, complex: 'Rooise Zoom 1–3', description: 'Daklekkages en klein dakherstel', glAccount: '4300', ogbCode: 'OND-410', amount: 40000 },
  { id: 2, complex: 'Rooise Zoom 4–6', description: 'Storingen aan gebouwinstallaties', glAccount: '4340', ogbCode: 'OND-420', amount: 30000 },
  { id: 3, complex: null, description: 'Riool- en overige kleine herstellingen', glAccount: '4330', ogbCode: '', amount: 25000 },
];

const correctiveEstimatedRows = [
  { id: 'ce1', complex: 'Rooise Zoom 1–3', description: 'Lopende lekkages en herstelwerk', amount: 10000, isNew: false },
  { id: 'ce2', complex: 'Rooise Zoom 4–6', description: 'Verwachte storingen installaties', amount: 14000, isNew: false },
  { id: 'ce3', complex: null, description: 'Riool- en overige kleine herstellingen', amount: 8000, isNew: false },
];

const correctivePreviousRows = [
  { id: 'cp1', complex: 'Rooise Zoom 1–3', description: 'Dak- en gevelherstel', amount: 36000 },
  { id: 'cp2', complex: 'Rooise Zoom 4–6', description: 'Storingen gebouwinstallaties', amount: 29000 },
  { id: 'cp3', complex: null, description: 'Overige kleine herstellingen', amount: 25000 },
];

const insurancePolicies = [
  { id: 1, complex: 'Rooise Zoom 1–3', insurer: 'Achmea Corporate', startDate: '2020-04-01', termMonths: 12, glAccount: '4130', ogbCode: '4131', annualPremium: 24000, indexPct: 3, manualOverride: null },
  { id: 2, complex: 'Rooise Zoom 4–6', insurer: 'Nationale-Nederlanden', startDate: '2020-07-01', termMonths: 12, glAccount: '4130', ogbCode: '4131', annualPremium: 20000, indexPct: 3, manualOverride: null },
  { id: 3, complex: 'Rooise Zoom 7–8', insurer: 'Hiscox Nederland', startDate: '2026-03-01', termMonths: 24, glAccount: '4130', ogbCode: 'VER-520', annualPremium: 17460, indexPct: 3, manualOverride: null },
];

const insuranceEstimatedRows = [
  { id: 1, complex: 'Rooise Zoom 1–3', insurer: 'Achmea Corporate', calculatedRemaining: 8000, remainingOverride: null },
  { id: 2, complex: 'Rooise Zoom 4–6', insurer: 'Nationale-Nederlanden', calculatedRemaining: 6700, remainingOverride: null },
  { id: 3, complex: 'Rooise Zoom 7–8', insurer: 'Hiscox Nederland', calculatedRemaining: 5500, remainingOverride: null },
];

const municipalWozObjects = [];

const municipalWozHistory = [];

const municipalLedgerRows = [
  { id: 1, glAccount: '4700', ogbCode: '4701', share: 0.75 },
  { id: 2, glAccount: '4710', ogbCode: '', share: 0.25 },
];

const canonRows = rentComplexes.map(complex => ({
  complexId: complex.id,
  complex: complex.name,
  annualCanon: null,
  indexPct: null,
  glAccount: '4720',
}));

let municipalWozIncreasePct = null;
let municipalRateIncreasePct = null;
let municipalHistoricalCharges = 84000;
let municipalEstimatedCorrection = 0;
let municipalBudgetOverride = null;
let municipalWozSetComplete = false;

let openId = 'rent';
let rentView = 'complexes';
let overallIndexationPct = 3;
let editingContractUnit = null;
let rentUnallocated = 0;
let editingBeheerComplexId = null;
let plannedView = 'budget2027';
let editingPlannedId = null;
let correctiveView = 'budget2027';
let editingCorrectiveId = null;
let insuranceView = 'budget2027';
let editingInsuranceId = null;
let expandedInsuranceMonthsId = null;
let municipalView = 'budget2027';
let editingMunicipalId = null;
let municipalExportOpen = false;
let municipalExportComplex = 'all';
let municipalExportYears = 'all';
let currentPage = 'budget';
let isFinalized = false;
let finalizeModalOpen = false;
let finalNote = '';
let search = '';
let savedAt = '8 september 2026 10:24';
let hiddenPanelOpen = false;
let ogbPanelOpen = false;

const icon = (name, cls = '') => `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
const money = value => `€ ${eur.format(Number(value) || 0)}`;
const displayMoney = (value, emptyLabel = 'Niet beschikbaar') => value === null || value === undefined
  ? `<span class="empty-amount">${emptyLabel}</span>`
  : money(value);
const signedMoney = value => `${value > 0 ? '+' : value < 0 ? '−' : ''} ${money(Math.abs(value))}`;
const statusInfo = status => ({
  ready: { label: 'Gereed', icon: 'circle-check-big', cls: 'ready' },
  zero: { label: 'Gereed · bewust €0', icon: 'circle-check-big', cls: 'ready' },
  attention: { label: 'Aandacht nodig', icon: 'circle-alert', cls: 'attention' },
  pending: { label: 'Nog beoordelen', icon: 'clock-3', cls: 'pending' },
  offer: { label: 'Voorstel beschikbaar', icon: 'info', cls: 'offer' },
  missing: { label: 'Invoer nodig', icon: 'circle-alert', cls: 'missing' },
})[status];
const isReviewed = status => ['ready', 'zero', 'attention'].includes(status);

function statusMarkup(status) {
  const item = statusInfo(status);
  return `<div class="status ${item.cls}">${icon(item.icon)}<span>${item.label}</span></div>`;
}

const activeModules = () => modules.filter(item => !item.hidden);

const ogbById = id => ogbKostensoorten.find(option => option.id === id);
const ogbLabel = id => {
  const option = ogbById(id);
  return option ? `${option.code} · ${option.description}` : 'Geen OGB-kostensoort';
};

const grootboekById = id => grootboekrekeningen.find(option => option.id === id);
const grootboekLabel = id => {
  const option = grootboekById(id);
  return option ? `${option.code} · ${option.description}` : 'Grootboekrekening ontbreekt';
};

function grootboekOptionsMarkup(moduleId, selected) {
  const accounts = rekeningMappings[moduleId]?.accounts || [];
  return `<option value="">Kies grootboekrekening</option>${accounts.map(id => `<option value="${id}" ${selected === id ? 'selected' : ''}>${grootboekLabel(id)}</option>`).join('')}`;
}

function ogbRuleOptionsMarkup(glAccount, selected) {
  if (!glAccount) return '<option value="">Kies eerst een grootboekrekening</option>';
  const observed = observedOgbByAccount[glAccount] || [];
  const options = selected && !observed.includes(selected) ? [...observed, selected] : observed;
  return `<option value="">Geen OGB-kostensoort</option>${options.map(id => `<option value="${id}" ${selected === id ? 'selected' : ''}>${ogbLabel(id)}</option>`).join('')}`;
}

function ogbChipsMarkup(allowed) {
  if (!allowed.length) return '<span class="ogb-empty">Geen OGB in brondata</span>';
  return `<span class="ogb-chip-list">${allowed.map(id => {
    const option = ogbById(id);
    return `<span class="ogb-chip"><b>${option.code}</b><span>${option.description}</span></span>`;
  }).join('')}</span>`;
}

function budgetToolsMarkup() {
  const active = activeModules();
  const mappedPosts = active.filter(item => rekeningMappings[item.id]?.accounts.length).length;
  const accountCount = active.reduce((sum, item) => sum + (rekeningMappings[item.id]?.accounts.length || 0), 0);
  const hidden = modules.filter(item => item.hidden);
  return `<div class="budget-tools">
    <div class="budget-tools-copy"><strong>Begrotingsregels</strong><span>Grootboek is leidend; OGB kan aanvullend worden vastgelegd.</span></div>
    <div class="budget-tools-actions">
      <button class="budget-tool ${mappedPosts < active.length ? 'needs-attention' : ''}" data-ogb-toggle aria-expanded="${ogbPanelOpen}">${icon('list-tree')}<span><strong>Rekeningindeling</strong><small>${accountCount} grootboekrekeningen · P&amp;L volgt automatisch</small></span>${icon('chevron-down')}</button>
      ${hidden.length ? `<button class="budget-tool hidden-tool" data-hidden-toggle aria-expanded="${hiddenPanelOpen}">${icon('eye-off')}<span><strong>${hidden.length} verborgen ${hidden.length === 1 ? 'onderdeel' : 'onderdelen'}</strong><small>Bekijken of herstellen</small></span>${icon('chevron-down')}</button>` : ''}
    </div>
  </div>
  ${ogbPanelOpen ? ogbMappingPanelMarkup() : ''}
  ${hiddenPanelOpen && hidden.length ? hiddenModulesPanelMarkup(hidden) : ''}`;
}

function ogbMappingPanelMarkup() {
  const rows = modules.map(item => {
    const mapping = rekeningMappings[item.id];
    if (item.hidden) {
      return `<div class="ogb-mapping-group"><div class="ogb-mapping-row is-hidden"><span><strong>${item.name}</strong><small>${mapping.niveau}</small></span><span class="ogb-hidden-label">${icon('eye-off')}Verborgen · niet meegenomen</span><span class="ogb-mapping-state muted">Niet van toepassing</span></div></div>`;
    }
    const linked = mapping.accounts.length > 0;
    const accounts = linked ? mapping.accounts.map(accountId => {
      const account = grootboekById(accountId);
      const observed = observedOgbByAccount[accountId] || [];
      return `<div class="ledger-source-row"><span class="ledger-account"><b>${account.code}</b><span>${account.description}</span></span><span class="ledger-arrow">${icon('arrow-right')}</span><span class="ledger-pl">${item.name}</span><span class="ledger-ogb"><small>OGB in realisatie · optioneel</small>${ogbChipsMarkup(observed)}</span></div>`;
    }).join('') : '<span class="ogb-empty">Nog geen betrouwbare grootboekmapping</span>';
    return `<div class="ogb-mapping-group"><div class="ogb-mapping-row ${linked ? '' : 'needs-attention'}"><span><strong>${item.name}</strong><small>${mapping.niveau} · P&amp;L-post volgt uit grootboek</small></span><span class="ledger-list">${accounts}</span><span class="ogb-mapping-state ${linked ? 'linked' : 'attention'}">${icon(linked ? 'circle-check-big' : 'triangle-alert')}${linked ? `${mapping.accounts.length} ${mapping.accounts.length === 1 ? 'rekening' : 'rekeningen'}` : 'Broncontrole nodig'}</span></div></div>`;
  }).join('');
  return `<section class="ogb-panel" aria-label="Rekeningindeling"><div class="tool-panel-heading"><div><strong>Grootboek bepaalt de P&amp;L-post</strong><span>Iedere begrotingsregel krijgt verplicht een grootboekrekening. OGB is een optionele tweede dimensie en verandert de P&amp;L-indeling niet.</span></div><button class="text-button" data-ogb-close>${icon('x')}Sluiten</button></div><div class="ogb-demo-note">${icon('flask-conical')}<span><strong>UX-demodata</strong> De getoonde rekeningen en OGB-codes illustreren de structuur. In productie komen zij uit de administratie en de bestaande grootboekmapping.</span></div><div class="ogb-mapping-head"><span>P&amp;L-post</span><span>Grootboek → P&amp;L · OGB alleen als bronkenmerk</span><span>Mapping</span></div>${rows}<div class="ogb-caveat">${icon('info')}<div><strong>Dezelfde OGB-kostensoort kan op meerdere grootboekrekeningen voorkomen</strong><span>Daarom blijft de combinatie grootboekrekening + eventueel OGB zichtbaar. Voor financiële optelling en vergelijking is de grootboekrekening leidend; zonder OGB blijft de begrotingsregel volledig geldig.</span></div></div></section>`;
}

function hiddenModulesPanelMarkup(hidden) {
  const rows = hidden.map(item => `<div class="hidden-module-row"><span class="hidden-module-icon">${icon('eye-off')}</span><span><strong>${item.name}</strong><small>Verborgen voor administratie 070 · telt niet mee in voortgang, controle of totalen</small></span><button class="secondary-button" data-restore-module="${item.id}" ${isFinalized ? 'disabled' : ''}>${icon('eye')}Weergeven</button></div>`).join('');
  return `<section class="hidden-panel" aria-label="Verborgen begrotingsonderdelen"><div class="tool-panel-heading"><div><strong>Verborgen onderdelen</strong><span>De regels blijven bestaan en kunnen altijd worden teruggezet.</span></div><button class="text-button" data-hidden-close>${icon('x')}Sluiten</button></div>${rows}</section>`;
}

function rentSpecTotal(key) {
  return rentComplexes.reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function formatPercentage(value) {
  return `${Number(value).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
}

function applyOverallIndexation() {
  rentComplexes.forEach(row => {
    row.indexation = Math.round(row.contractRent * overallIndexationPct / 100);
    row.proposal = row.contractRent + row.indexation + row.vacancy;
  });
  rentContracts.forEach(row => {
    const appliedPct = row.overridePct ?? overallIndexationPct;
    row.proposal = Math.round(row.baseNet * (1 + appliedPct / 100));
    if (row.overridePct !== null) {
      const adjustment = Math.round(row.baseNet * (row.overridePct - overallIndexationPct) / 100);
      const complex = rentComplexes.find(complexRow => complexRow.id === row.complexId);
      complex.indexation += adjustment;
      complex.proposal += adjustment;
    }
  });
  modules.find(row => row.id === 'rent').proposal = rentSpecTotal('proposal');
}

function recalculateBeheerProposal(markPending = false) {
  const beheer = modules.find(row => row.id === 'beheer');
  beheer.proposal = beheerTotals().total;
  if (markPending) beheer.status = 'pending';
}

function beheerActiveMonths(indexDate) {
  if (!indexDate) return 0;
  const [year, month] = indexDate.split('-').map(Number);
  if (year !== 2027 || month < 1 || month > 12) return 0;
  return 13 - month;
}

function beheerDateLabel(value) {
  if (!value) return 'geen indexatie';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: year === 2027 ? undefined : 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function beheerIsOverride(config) {
  return config.fixedAnnual !== config.contractFixedAnnual
    || config.fixedIndexPct !== config.contractFixedIndexPct
    || config.fixedIndexDate !== config.contractFixedIndexDate
    || config.variablePct !== config.contractVariablePct;
}

function beheerCalculation(config) {
  const rent = rentComplexes.find(row => row.id === config.complexId);
  const activeMonths = beheerActiveMonths(config.fixedIndexDate);
  const fixedIndexEffect = Math.round(config.fixedAnnual * config.fixedIndexPct / 100 * activeMonths / 12);
  const fixedTotal = config.fixedAnnual + fixedIndexEffect;
  const variableTotal = Math.round(rent.budget * config.variablePct / 100);
  return { rent, activeMonths, fixedIndexEffect, fixedTotal, variableTotal, total: fixedTotal + variableTotal };
}

function beheerTotals() {
  return beheerConfigs.reduce((totals, config) => {
    const calc = beheerCalculation(config);
    totals.fixedBase += config.fixedAnnual;
    totals.fixedIndexEffect += calc.fixedIndexEffect;
    totals.fixedTotal += calc.fixedTotal;
    totals.variableTotal += calc.variableTotal;
    totals.total += calc.total;
    return totals;
  }, { fixedBase: 0, fixedIndexEffect: 0, fixedTotal: 0, variableTotal: 0, total: 0 });
}

function managementAmountToMonthly(amount, unit) {
  return unit === 'YEAR' ? amount / 12 : amount;
}

function managementUnitLabel(unit) {
  return unit === 'YEAR' ? 'per jaar' : 'per maand';
}

function managementOtherUnit(amount, unit) {
  return unit === 'YEAR'
    ? `${money(amount / 12)} per maand`
    : `${money(amount * 12)} per jaar`;
}

function managementStartMonth(date, mode) {
  if (!date) return mode === 'NEW' ? 1 : null;
  const [year, month] = date.split('-').map(Number);
  if (mode === 'INDEX') return year === 2027 ? month : null;
  if (year < 2027) return 1;
  if (year > 2027) return null;
  return month;
}

function managementCalculation() {
  const mode = managementConfig.mode;
  if (!mode) return null;
  const existingMonthly = managementAmountToMonthly(managementConfig.existingAmount, managementConfig.existingUnit);
  const newMonthly = managementAmountToMonthly(managementConfig.newAmount, managementConfig.newUnit);
  const date = mode === 'INDEX' ? managementConfig.indexDate : managementConfig.effectiveDate;
  const startMonth = managementStartMonth(date, mode);
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    if (mode === 'INDEX') {
      const basis = existingMonthly;
      const effect = startMonth !== null && month >= startMonth ? basis * managementConfig.indexPct / 100 : 0;
      return { month, basis, effect, amount: basis + effect };
    }
    if (mode === 'CHANGE') {
      const basis = existingMonthly;
      const effect = startMonth !== null && month >= startMonth ? newMonthly - existingMonthly : 0;
      return { month, basis, effect, amount: basis + effect };
    }
    const effect = startMonth !== null && month >= startMonth ? newMonthly : 0;
    return { month, basis: 0, effect, amount: effect };
  });
  const baseTotal = months.reduce((sum, row) => sum + row.basis, 0);
  const effectTotal = months.reduce((sum, row) => sum + row.effect, 0);
  return {
    mode,
    startMonth,
    months,
    baseTotal: Math.round(baseTotal),
    effectTotal: Math.round(effectTotal),
    total: Math.round(baseTotal + effectTotal),
  };
}

function recalculateManagementProposal(markPending = true) {
  const item = modules.find(row => row.id === 'management');
  const calculation = managementCalculation();
  item.proposal = calculation ? calculation.total : null;
  if (markPending) item.status = calculation ? 'pending' : 'missing';
}

function managementModeLabel(mode) {
  return ({ INDEX: 'Bestaand bedrag indexeren', CHANGE: 'Bestaand bedrag wijzigen', NEW: 'Nieuwe vergoeding starten' })[mode];
}

function managementDateLabel(date) {
  if (!date) return 'januari 2027';
  const [year, month] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function rentDetailMarkup(item) {
  const tabs = `<div class="detail-tabs" role="tablist" aria-label="Weergave huuropbrengsten"><button role="tab" aria-selected="${rentView === 'complexes'}" class="detail-tab ${rentView === 'complexes' ? 'active' : ''}" data-rent-view="complexes">Per complex</button><button role="tab" aria-selected="${rentView === 'contracts'}" class="detail-tab ${rentView === 'contracts' ? 'active' : ''}" data-rent-view="contracts">Per contract</button></div>`;
  const overallIndexation = `<div class="overall-indexation"><div><label for="overall-indexation">Algemeen indexatiepercentage 2027</label><span>Wordt toegepast op alle 42 contracten. Uitzonderingen stel je zo nodig per contract bij.</span></div><label class="overall-indexation-input"><input id="overall-indexation" inputmode="decimal" aria-label="Algemeen indexatiepercentage 2027" value="${overallIndexationPct.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}" ${isFinalized ? 'disabled' : ''}><span>%</span></label></div>`;
  const summary = `<div class="rent-summary" aria-label="Opbouw huurvoorstel">
    <div class="rent-metric"><span>Contracthuur</span><strong>${money(rentSpecTotal('contractRent'))}</strong></div>
    <div class="rent-metric"><span>Verwachte indexatie</span><strong class="positive">+ ${money(rentSpecTotal('indexation'))}</strong></div>
    <div class="rent-metric"><span>Leegstand &amp; korting</span><strong class="negative">− ${money(Math.abs(rentSpecTotal('vacancy')))}</strong></div>
    <div class="rent-metric total"><span>Netto voorstel</span><strong>${money(item.proposal)}</strong></div>
  </div>`;
  const complexRows = rentComplexes.map(row => `<div class="rent-spec-row">
    <div><strong>${row.name}</strong><small>${row.contracts} huurcontracten</small></div>
    <span class="numeric">${money(row.contractRent)}</span>
    <span class="numeric positive">+ ${money(row.indexation)}</span>
    <span class="numeric negative">− ${money(Math.abs(row.vacancy))}</span>
    <span class="numeric proposal-cell">${money(row.proposal)}</span>
    <label class="rent-input-wrap"><span>€</span><input class="rent-budget-input" data-complex-id="${row.id}" inputmode="numeric" aria-label="Begroting ${row.name}" value="${eur.format(row.budget)}" ${isFinalized ? 'disabled' : ''}></label>
  </div>`).join('');
  const unallocated = rentUnallocated ? `<div class="rent-unallocated"><div>${icon('circle-alert')}<span>Nog niet verdeeld over complexen</span></div><strong>${money(rentUnallocated)}</strong><button class="text-button" data-rent-distribute>Verdelen</button></div>` : '';
  const complexTable = `<div class="rent-spec-table">
    <div class="rent-spec-row head"><span>Complex</span><span>Contracthuur</span><span>Indexatie</span><span>Leegstand / korting</span><span>Voorstel</span><span>Jouw begroting</span></div>
    ${complexRows}
    ${unallocated}
    <div class="rent-spec-row footer"><strong>Totaal</strong><strong class="numeric">${money(rentSpecTotal('contractRent'))}</strong><strong class="numeric positive">+ ${money(rentSpecTotal('indexation'))}</strong><strong class="numeric negative">− ${money(Math.abs(rentSpecTotal('vacancy')))}</strong><strong class="numeric">${money(item.proposal)}</strong><strong class="numeric">${money(item.budget)}</strong></div>
  </div>`;
  const contractRows = rentContracts.map(row => {
    const appliedPct = row.overridePct ?? overallIndexationPct;
    const indexation = editingContractUnit === row.unit
      ? `<label class="contract-indexation-input"><input data-contract-indexation-input="${row.unit}" inputmode="decimal" aria-label="Afwijkend indexatiepercentage voor ${row.tenant}" value="${appliedPct.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}"><span>%</span></label>`
      : `<span class="inherited-indexation ${row.overridePct !== null ? 'is-override' : ''}">${formatPercentage(appliedPct)} <small>${row.overridePct !== null ? 'afwijkend' : 'algemeen'}</small></span>${isFinalized ? '' : `<button class="contract-indexation-action" data-contract-indexation-${row.overridePct !== null ? 'reset' : 'edit'}="${row.unit}">${row.overridePct !== null ? 'Herstellen' : 'Aanpassen'}</button>`}`;
    return `<div class="contract-row ${row.attention ? 'has-attention' : ''}"><span><strong>${row.unit}</strong><small>${row.complex}</small></span><span>${row.tenant}</span><span>${row.end}${row.attention ? '<small class="expiry-note">Loopt af in 2027</small>' : ''}</span><span class="numeric">${money(row.rent)}</span><div class="numeric indexation-cell">${indexation}</div><span class="numeric proposal-cell">${money(row.proposal)}</span></div>`;
  }).join('');
  const contractTable = `<div class="contract-helper">${icon('sliders-horizontal')}<span>Alle contracten volgen standaard ${formatPercentage(overallIndexationPct)}. Kies <strong>Aanpassen</strong> alleen voor een uitzondering.</span></div><div class="contract-table"><div class="contract-row head"><span>Unit / complex</span><span>Huurder</span><span>Einddatum</span><span>Jaarhuur</span><span>Indexatie 2027</span><span>Voorstel 2027</span></div>${contractRows}<div class="contract-more">38 overige contracten zijn meegenomen in het voorstel.</div></div>`;
  const warning = `<div class="warning rent-warning">${icon('triangle-alert')}<div><strong>2 contracten lopen af in 2027.</strong><p>De verwachte leegstand is in het voorstel verwerkt. Controleer alleen of de gehanteerde einddatum of mutatie afwijkt.</p></div>${rentView === 'complexes' ? `<button class="warning-link" data-rent-view="contracts">Contracten bekijken ${icon('chevron-right')}</button>` : ''}</div>`;
  return `<div class="detail-panel rent-detail ${openId === item.id ? 'open' : ''}" id="detail-${item.id}">
    <div class="detail-panel-inner">
      <div class="rent-detail-top"><div><div class="detail-title">Specificatie netto huuropbrengsten</div><p>Van brongegevens naar een controleerbaar voorstel voor 2027.</p></div><div class="detail-actions"><button class="text-button" data-rent-reset ${isFinalized ? 'disabled' : ''}>${icon('rotate-ccw')}Voorstel overnemen</button><button class="secondary-button review-module" data-id="${item.id}" ${isFinalized ? 'disabled' : ''}>${icon('square-check-big')}Onderdeel beoordelen</button></div></div>
      <div class="source-summary"><div>${icon('database')}<span><strong>Huuradministratie</strong> bijgewerkt op 1 september 2026</span></div><span>42 contracten</span><span>8 units leegstand</span><span>Brondekking 100%</span></div>
      ${overallIndexation}
      ${summary}
      <div class="rent-toolbar">${tabs}<span class="rent-hint">Bedragen zijn op jaarbasis en exclusief btw.</span></div>
      ${rentView === 'complexes' ? complexTable : contractTable}
      ${warning}
    </div>
  </div>`;
}

function beheerDetailMarkup(item) {
  const totals = beheerTotals();
  const overrideCount = beheerConfigs.filter(beheerIsOverride).length;
  const complexRows = beheerConfigs.map(config => {
    const calc = beheerCalculation(config);
    const isEditing = editingBeheerComplexId === config.complexId;
    const isOverride = beheerIsOverride(config);
    const indexCopy = calc.activeMonths
      ? `${formatPercentage(config.fixedIndexPct)} vanaf ${beheerDateLabel(config.fixedIndexDate)} · ${calc.activeMonths} mnd`
      : 'Geen indexatie in 2027';
    const editor = isEditing ? `<div class="fee-config-editor" id="beheer-editor-${config.complexId}">
      <div class="fee-editor-copy"><strong>Beheerafspraak ${calc.rent.name}</strong><span>Een wijziging geldt als traceerbare afwijking voor deze begrotingsversie; de vastgelegde overeenkomst blijft intact.</span></div>
      <label><span>Vast jaarbedrag</span><div class="fee-field money-field"><span>€</span><input data-beheer-field="fixedAnnual" data-complex-id="${config.complexId}" inputmode="numeric" value="${eur.format(config.fixedAnnual)}"></div></label>
      <label><span>Indexatie vast</span><div class="fee-field percent-field"><input data-beheer-field="fixedIndexPct" data-complex-id="${config.complexId}" inputmode="decimal" value="${config.fixedIndexPct.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}"><span>%</span></div></label>
      <label><span>Indexatiedatum</span><div class="fee-field"><input type="date" data-beheer-field="fixedIndexDate" data-complex-id="${config.complexId}" value="${config.fixedIndexDate}"></div></label>
      <label><span>Variabel contracttarief</span><div class="fee-field percent-field"><input data-beheer-field="variablePct" data-complex-id="${config.complexId}" inputmode="decimal" value="${config.variablePct.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}"><span>%</span></div></label>
      <div class="fee-editor-actions">${isOverride ? `<button class="text-button" data-beheer-restore="${config.complexId}">${icon('rotate-ccw')}Terug naar overeenkomst</button>` : ''}<button class="secondary-button" data-beheer-close="${config.complexId}">Gereed</button></div>
    </div>` : '';
    return `<div class="fee-complex-group ${isOverride ? 'is-override' : ''}">
      <div class="fee-complex-row">
        <div class="fee-complex-name"><strong>${calc.rent.name}</strong><small>${calc.rent.contracts} huurcontracten · ${isOverride ? 'Afwijking vastgelegd' : 'Volgens overeenkomst'}</small></div>
        <div class="fee-component"><span>Vast contractbedrag</span><small>${money(config.fixedAnnual)} ${signedMoney(calc.fixedIndexEffect)} indexatie</small><strong>${money(calc.fixedTotal)}</strong></div>
        <div class="fee-component"><span>Variabel over netto huur</span><small>${money(calc.rent.budget)} × ${formatPercentage(config.variablePct)}</small><strong>${money(calc.variableTotal)}</strong></div>
        <strong class="numeric fee-row-total">${money(calc.total)}</strong>
        ${isFinalized ? `<span class="fee-locked">${icon('lock-keyhole')}Vastgelegd</span>` : `<button class="fee-edit-action" data-beheer-edit="${config.complexId}" aria-expanded="${isEditing}" aria-controls="beheer-editor-${config.complexId}" aria-label="Beheerafspraak ${calc.rent.name} ${isEditing ? 'sluiten' : 'aanpassen'}">${isEditing ? 'Sluiten' : 'Afspraak aanpassen'}</button>`}
      </div>
      <div class="fee-index-note">${icon('calendar-days')}<span>Vast deel: ${indexCopy}. Variabel tarief: ${formatPercentage(config.variablePct)} en wordt niet geïndexeerd.</span></div>
      ${editor}
    </div>`;
  }).join('');
  const unallocatedWarning = rentUnallocated ? `<div class="warning fee-warning">${icon('triangle-alert')}<div><strong>${money(rentUnallocated)} netto huur is nog niet aan een complex toegewezen.</strong><p>Daarover wordt nog geen variabele beheersvergoeding berekend. Verdeel dit bedrag eerst in de huurmodule.</p></div><button class="warning-link" data-open-module="rent">Naar huurverdeling ${icon('chevron-right')}</button></div>` : '';
  return `<div class="detail-panel beheer-detail ${openId === item.id ? 'open' : ''}" id="detail-${item.id}">
    <div class="detail-panel-inner">
      <div class="rent-detail-top"><div><div class="detail-title">Specificatie beheersvergoeding</div><p>Van beheerafspraak per complex naar een controleerbaar voorstel voor 2027.</p></div><div class="detail-actions"><button class="text-button" data-beheer-reset ${isFinalized ? 'disabled' : ''}>${icon('rotate-ccw')}Voorstel overnemen</button><button class="secondary-button review-module" data-id="${item.id}" ${isFinalized ? 'disabled' : ''}>${icon('square-check-big')}Onderdeel beoordelen</button></div></div>
      <div class="source-summary"><div>${icon('file-text')}<span><strong>Beheerafspraken per complex</strong> geldig vanaf 1 januari 2026</span></div><span>3 complexen</span><span>Grondslag: netto begrote huur</span><button class="source-document" data-action="beheer-agreement">Overeenkomst bekijken ${icon('external-link')}</button></div>
      <div class="fee-rule-card"><div class="fee-rule-icon">${icon('split')}</div><div><strong>Vast en variabel worden apart berekend</strong><span>Alleen het vaste deel wordt geïndexeerd. Het variabele tarief blijft gelijk en rekent mee met de maandbedragen uit de huurmodule.</span></div><span class="fee-rule-badge">Per complex</span></div>
      <div class="rent-summary fee-summary" aria-label="Opbouw beheersvergoeding">
        <div class="rent-metric"><span>Vast deel 2027</span><strong>${money(totals.fixedTotal)}</strong><small>${money(totals.fixedBase)} ${signedMoney(totals.fixedIndexEffect)} indexatie</small></div>
        <div class="rent-metric"><span>Variabel deel 2027</span><strong>${money(totals.variableTotal)}</strong><small>Percentage × netto huur per complex</small></div>
        <div class="rent-metric"><span>Automatisch voorstel</span><strong>${money(item.proposal)}</strong><small>Vast + variabel</small></div>
        <div class="rent-metric total"><span>Jouw begroting</span><strong>${money(item.budget)}</strong><small>${item.budget === item.proposal ? 'Sluit aan op voorstel' : `${signedMoney(item.budget - item.proposal)} t.o.v. voorstel`}</small></div>
      </div>
      <div class="fee-table-heading"><div><strong>Beheerafspraken per complex</strong><span>Ieder complex kan een eigen vast bedrag, indexatiemoment en variabel tarief hebben.</span></div><span>Bedragen per jaar · exclusief btw</span></div>
      <div class="fee-complex-table"><div class="fee-complex-row head"><span>Complex</span><span>Vast deel 2027</span><span>Variabel deel 2027</span><span>Totaal</span><span></span></div>${complexRows}<div class="fee-complex-row footer"><strong>Totaal</strong><strong class="numeric">${money(totals.fixedTotal)}</strong><strong class="numeric">${money(totals.variableTotal)}</strong><strong class="numeric">${money(totals.total)}</strong><span></span></div></div>
      <div class="fee-info ${overrideCount ? 'attention' : ''}">${icon(overrideCount ? 'triangle-alert' : 'info')}<div><strong>${overrideCount ? `${overrideCount} ${overrideCount === 1 ? 'afwijkende beheerafspraak' : 'afwijkende beheerafspraken'}` : 'Tarieven sluiten aan op de overeenkomsten'}</strong><p>${overrideCount ? 'De oorspronkelijke contractwaarden blijven zichtbaar en intact; beoordeel de afwijking voordat je vaststelt.' : 'De variabele tarieven worden niet automatisch geïndexeerd en wijzigen alleen na een expliciete aanpassing.'}</p></div></div>
      ${unallocatedWarning}
    </div>
  </div>`;
}

function managementAmountField(label, field, unitField, amount, unit) {
  const shown = Number(amount).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `<label class="management-field"><span>${label}</span><div class="management-amount-control"><span>€</span><input data-management-field="${field}" inputmode="decimal" aria-label="${label}" value="${shown}" ${isFinalized ? 'disabled' : ''}><select data-management-unit="${unitField}" aria-label="Eenheid ${label}" ${isFinalized ? 'disabled' : ''}><option value="MONTH" ${unit === 'MONTH' ? 'selected' : ''}>per maand</option><option value="YEAR" ${unit === 'YEAR' ? 'selected' : ''}>per jaar</option></select></div><small>Afgeleid: ${managementOtherUnit(amount, unit)}</small></label>`;
}

function managementDetailMarkup(item) {
  const calculation = managementCalculation();
  const modes = [
    { id: 'INDEX', icon: 'percent', title: 'Bestaand indexeren', text: 'Huidig bedrag blijft gelden en wordt vanaf één maand geïndexeerd.' },
    { id: 'CHANGE', icon: 'replace', title: 'Bestaand wijzigen', text: 'Huidig bedrag blijft gelden tot een nieuw absoluut bedrag ingaat.' },
    { id: 'NEW', icon: 'calendar-plus', title: 'Nieuwe vergoeding', text: 'Vóór de ingangsmaand bestond deze vergoeding nog niet.' },
  ];
  const modeChoices = modes.map(mode => `<button class="management-mode ${managementConfig.mode === mode.id ? 'active' : ''}" data-management-mode="${mode.id}" aria-pressed="${managementConfig.mode === mode.id}" ${isFinalized ? 'disabled' : ''}><span class="management-mode-icon">${icon(mode.icon)}</span><span><strong>${mode.title}</strong><small>${mode.text}</small></span>${managementConfig.mode === mode.id ? icon('circle-check-big', 'management-mode-check') : ''}</button>`).join('');

  let form = '';
  if (managementConfig.mode === 'INDEX') {
    form = `<div class="management-form">
      ${managementAmountField('Bestaand bedrag', 'existingAmount', 'existingUnit', managementConfig.existingAmount, managementConfig.existingUnit)}
      <label class="management-field"><span>Indexatiepercentage</span><div class="management-simple-control suffix"><input data-management-field="indexPct" inputmode="decimal" aria-label="Indexatiepercentage managementvergoeding" value="${managementConfig.indexPct.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}" ${isFinalized ? 'disabled' : ''}><span>%</span></div><small>Een negatief percentage is toegestaan.</small></label>
      <label class="management-field"><span>Indexatiedatum</span><div class="management-simple-control"><input type="date" data-management-field="indexDate" aria-label="Indexatiedatum managementvergoeding" value="${managementConfig.indexDate}" ${isFinalized ? 'disabled' : ''}></div><small>De volledige indexatiemaand telt mee.</small></label>
    </div>`;
  }
  if (managementConfig.mode === 'CHANGE') {
    form = `<div class="management-form three-amounts">
      ${managementAmountField('Bestaand bedrag', 'existingAmount', 'existingUnit', managementConfig.existingAmount, managementConfig.existingUnit)}
      ${managementAmountField('Nieuw bedrag', 'newAmount', 'newUnit', managementConfig.newAmount, managementConfig.newUnit)}
      <label class="management-field"><span>Ingangsdatum nieuw bedrag</span><div class="management-simple-control"><input type="date" data-management-field="effectiveDate" aria-label="Ingangsdatum nieuw managementbedrag" value="${managementConfig.effectiveDate}" ${isFinalized ? 'disabled' : ''}></div><small>Bestaand bedrag blijft gelden tot deze maand.</small></label>
    </div>`;
  }
  if (managementConfig.mode === 'NEW') {
    form = `<div class="management-form new-fee-form">
      ${managementAmountField('Nieuwe vergoeding', 'newAmount', 'newUnit', managementConfig.newAmount, managementConfig.newUnit)}
      <label class="management-field"><span>Ingangsdatum <em>optioneel</em></span><div class="management-simple-control"><input type="date" data-management-field="effectiveDate" aria-label="Ingangsdatum nieuwe managementvergoeding" value="${managementConfig.effectiveDate}" ${isFinalized ? 'disabled' : ''}></div><small>Leeg betekent: vanaf januari 2027.</small></label>
    </div>`;
  }

  const monthNames = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
  const monthFlow = calculation ? `<div class="management-month-section"><div class="fee-table-heading"><div><strong>Maandverloop 2027</strong><span>De gekozen datum werkt vanaf de volledige ingangsmaand.</span></div><span>Bedragen per maand · exclusief btw</span></div><div class="management-months">${calculation.months.map((row, index) => `<div class="management-month ${row.effect !== 0 ? 'has-effect' : ''}"><span>${monthNames[index]}</span><strong>${money(row.amount)}</strong></div>`).join('')}</div><div class="management-legend"><span><i></i>Basisbedrag</span><span class="effect"><i></i>Effect actief</span></div></div>` : '';

  const configuredContent = calculation ? `<div class="rent-summary fee-summary management-summary" aria-label="Opbouw managementvergoeding">
      <div class="rent-metric"><span>Basis in 2027</span><strong>${money(calculation.baseTotal)}</strong><small>${managementConfig.mode === 'NEW' ? 'Geen bestaand bedrag' : `${money(managementAmountToMonthly(managementConfig.existingAmount, managementConfig.existingUnit))} per maand`}</small></div>
      <div class="rent-metric"><span>Effect in 2027</span><strong class="${calculation.effectTotal < 0 ? 'negative' : 'positive'}">${signedMoney(calculation.effectTotal)}</strong><small>Vanaf ${managementDateLabel(managementConfig.mode === 'INDEX' ? managementConfig.indexDate : managementConfig.effectiveDate)}</small></div>
      <div class="rent-metric"><span>Automatisch voorstel</span><strong>${money(calculation.total)}</strong><small>${managementModeLabel(managementConfig.mode)}</small></div>
      <div class="rent-metric total"><span>Jouw begroting</span><strong>${displayMoney(item.budget, 'Nog niet overgenomen')}</strong><small>${item.budget === null ? 'Neem het voorstel over' : item.budget === item.proposal ? 'Sluit aan op voorstel' : `${signedMoney(item.budget - item.proposal)} t.o.v. voorstel`}</small></div>
    </div>${monthFlow}` : `<div class="management-empty"><div class="management-empty-icon">${icon('mouse-pointer-click')}</div><div><strong>Kies eerst welke situatie voor 2027 geldt</strong><p>Er is geen betrouwbaar bronbedrag. Daarom maken we niet automatisch €0 van deze post.</p></div><button class="text-button" data-management-zero>${icon('circle-check')}Bewust geen managementvergoeding</button></div>`;

  const modeNote = calculation ? ({
    INDEX: 'Het bestaande bedrag geldt vóór de indexatiemaand. Alleen de gekozen indexatiestap wordt toegepast; er wordt niets uit historische boekingen afgeleid.',
    CHANGE: 'Het bestaande bedrag blijft doorlopen tot de ingangsmaand. Vanaf die maand vervangt het nieuwe absolute bedrag de oude vergoeding.',
    NEW: 'Vóór de ingangsmaand is de vergoeding €0 omdat zij toen nog niet bestond. Dit is iets anders dan een onbekend bronbedrag.',
  })[managementConfig.mode] : 'Zonder gekozen invoerwijze blijft de post zichtbaar als Niet ingevuld. Een echte waarde €0 vraagt altijd om een bewuste bevestiging.';

  return `<div class="detail-panel management-detail ${openId === item.id ? 'open' : ''}" id="detail-${item.id}"><div class="detail-panel-inner">
    <div class="rent-detail-top"><div><div class="detail-title">Specificatie managementvergoeding</div><p>Kies de situatie, vul de bedragen in en controleer het maandverloop.</p></div><div class="detail-actions"><button class="text-button" data-management-reset ${!calculation || isFinalized ? 'disabled' : ''}>${icon('rotate-ccw')}Voorstel overnemen</button><button class="secondary-button review-module" data-id="${item.id}" ${item.budget === null || isFinalized ? 'disabled' : ''}>${icon('square-check-big')}Onderdeel beoordelen</button></div></div>
    <div class="source-summary management-source"><div>${icon('database')}<span><strong>Geen betrouwbare bron voor administratie 070</strong> · handmatige begrotingsinvoer nodig</span></div><span>Geen grootboekmapping</span><span>Geen bewezen complexverdeling</span></div>
    <div class="fee-rule-card management-rule"><div class="fee-rule-icon">${icon('route')}</div><div><strong>Drie situaties, ieder met een ander maandverloop</strong><span>Indexeren, een bestaand bedrag vervangen en een werkelijk nieuwe vergoeding blijven inhoudelijk gescheiden.</span></div><span class="fee-rule-badge">Maandnauwkeurig</span></div>
    <div class="management-mode-grid" role="group" aria-label="Kies invoerwijze managementvergoeding">${modeChoices}</div>
    ${form}
    ${configuredContent}
    <div class="fee-info ${calculation ? '' : 'attention'}">${icon(calculation ? 'info' : 'triangle-alert')}<div><strong>${calculation ? managementModeLabel(managementConfig.mode) : item.status === 'zero' ? 'Bewust €0 vastgelegd' : 'Nog niet ingevuld is geen €0'}</strong><p>${item.status === 'zero' && !calculation ? 'Voor 2027 is bewust bevestigd dat geen managementvergoeding wordt begroot. Kies hierboven een invoerwijze om alsnog een voorstel op te bouwen.' : modeNote}</p></div></div>
  </div></div>`;
}

const plannedSourceLabel = source => ({
  MJOP: 'MJOP', INSPECTIE: 'Inspectie', OFFERTE: 'Offerte', ERVARING_BEHEERDER: 'Ervaring beheerder', OVERIG: 'Overig',
})[source] || 'Kies bron';

const plannedStatusLabel = status => ({
  GEPLAND: 'Gepland', IN_UITVOERING: 'In uitvoering', UITGESTELD: 'Uitgesteld', VERVALLEN: 'Vervallen', AFGEROND: 'Afgerond', ONVOORZIEN: 'Onvoorzien',
})[status] || 'Kies status';

const plannedActivityTotal = activity => ['q1', 'q2', 'q3', 'q4'].reduce((sum, key) => sum + Number(activity[key] || 0), 0);
const plannedBudgetTotal = () => plannedActivities.reduce((sum, activity) => sum + plannedActivityTotal(activity), 0);
const plannedRemainingTotal = () => plannedEstimatedRows.reduce((sum, row) => sum + Number(row.q3 || 0) + Number(row.q4 || 0), 0);
const plannedHasCritical = activity => !activity.complex.trim() || !activity.description.trim() || !activity.glAccount || !activity.source || !activity.sourceDetail.trim() || !activity.status;

function recalculatePlannedBudget(markPending = true) {
  const item = modules.find(row => row.id === 'planned');
  item.budget = plannedBudgetTotal();
  if (markPending) item.status = plannedActivities.some(plannedHasCritical) ? 'missing' : 'pending';
}

function recalculatePlannedEstimated() {
  const item = modules.find(row => row.id === 'planned');
  item.estimated = Number(item.actuals || 0) + plannedRemainingTotal();
}

function plannedEditorMarkup(activity) {
  const sourceOptions = ['MJOP', 'INSPECTIE', 'OFFERTE', 'ERVARING_BEHEERDER', 'OVERIG']
    .map(value => `<option value="${value}" ${activity.source === value ? 'selected' : ''}>${plannedSourceLabel(value)}</option>`).join('');
  const statusOptions = ['GEPLAND', 'IN_UITVOERING', 'UITGESTELD', 'VERVALLEN', 'AFGEROND', 'ONVOORZIEN']
    .map(value => `<option value="${value}" ${activity.status === value ? 'selected' : ''}>${plannedStatusLabel(value)}</option>`).join('');
  return `<div class="planned-editor" id="planned-editor-${activity.id}">
    <div class="planned-editor-heading"><div><strong>Activiteit aanpassen</strong><span>De grootboekrekening is verplicht en bepaalt de P&amp;L-post. OGB is optioneel.</span></div><div class="planned-editor-heading-actions"><button class="text-button danger" data-planned-delete="${activity.id}" ${isFinalized ? 'disabled' : ''}>${icon('trash-2')}Verwijderen</button><button class="text-button" data-planned-close>${icon('x')}Sluiten</button></div></div>
    <div class="planned-editor-grid">
      <label><span>Complex *</span><select data-planned-field="complex" ${isFinalized ? 'disabled' : ''}><option value="">Kies complex</option>${rentComplexes.map(row => `<option value="${row.name}" ${activity.complex === row.name ? 'selected' : ''}>${row.name}</option>`).join('')}</select></label>
      <label class="wide"><span>Omschrijving *</span><input data-planned-field="description" value="${activity.description}" ${isFinalized ? 'disabled' : ''}></label>
      <label><span>Bron / aanleiding *</span><select data-planned-field="source" ${isFinalized ? 'disabled' : ''}><option value="">Kies bron</option>${sourceOptions}</select></label>
      <label class="wide"><span>Toelichting bron *</span><input data-planned-field="sourceDetail" value="${activity.sourceDetail}" placeholder="Bijv. MJOP-regel of offertenaam" ${isFinalized ? 'disabled' : ''}></label>
      <label><span>Grootboekrekening *</span><select data-planned-field="glAccount" ${isFinalized ? 'disabled' : ''}>${grootboekOptionsMarkup('planned', activity.glAccount)}</select></label>
      <label class="ogb-field"><span>OGB-kostensoort <em>optioneel</em></span><select data-planned-field="ogbCode" ${isFinalized || !activity.glAccount ? 'disabled' : ''}>${ogbRuleOptionsMarkup(activity.glAccount, activity.ogbCode)}</select></label>
      <label><span>Status *</span><select data-planned-field="status" ${isFinalized ? 'disabled' : ''}><option value="">Kies status</option>${statusOptions}</select></label>
    </div>
    <div class="planned-quarter-editor">${['q1', 'q2', 'q3', 'q4'].map(key => `<label><span>${key.toUpperCase()}</span><div><span>€</span><input data-planned-field="${key}" inputmode="numeric" value="${eur.format(activity[key])}" ${isFinalized ? 'disabled' : ''}></div></label>`).join('')}<div class="planned-year-total"><span>Jaartotaal</span><strong>${money(plannedActivityTotal(activity))}</strong></div><button class="text-button" data-planned-distribute="${activity.id}" ${isFinalized ? 'disabled' : ''}>${icon('columns-3')}Gelijk verdelen</button></div>
    <details class="planned-optional" ${activity.supplier || activity.offer !== null || activity.note ? 'open' : ''}><summary>Leverancier, offertebedrag en notitie <span>optioneel</span></summary><div><label><span>Leverancier</span><input data-planned-field="supplier" value="${activity.supplier}" ${isFinalized ? 'disabled' : ''}></label><label><span>Offertebedrag</span><div class="planned-money-field"><span>€</span><input data-planned-field="offer" inputmode="numeric" value="${activity.offer === null ? '' : eur.format(activity.offer)}" placeholder="Niet ingevuld" ${isFinalized ? 'disabled' : ''}></div></label><label class="wide"><span>Korte notitie</span><input data-planned-field="note" value="${activity.note}" ${isFinalized ? 'disabled' : ''}></label></div></details>
    ${plannedHasCritical(activity) ? `<div class="planned-critical">${icon('circle-alert')}Vul complex, omschrijving, grootboekrekening, bron met toelichting en status in voordat je dit onderdeel beoordeelt.</div>` : ''}
  </div>`;
}

function plannedBudgetRowsMarkup() {
  return plannedActivities.map(activity => {
    const negative = ['q1', 'q2', 'q3', 'q4'].some(key => Number(activity[key]) < 0);
    return `<div class="planned-activity-group ${plannedHasCritical(activity) ? 'has-critical' : negative ? 'has-warning' : ''}"><div class="planned-row">
      <span><strong>${activity.complex || 'Complex ontbreekt'}</strong><small>${activity.sourceDetail || 'Bronverwijzing ontbreekt'}</small></span>
      <span><strong>${activity.description || 'Omschrijving ontbreekt'}</strong><small>${activity.glAccount ? grootboekLabel(activity.glAccount) : 'Grootboek ontbreekt'} · ${activity.ogbCode ? ogbLabel(activity.ogbCode) : 'Geen OGB (optioneel)'}</small></span>
      ${['q1', 'q2', 'q3', 'q4'].map(key => `<span class="numeric ${Number(activity[key]) < 0 ? 'negative' : ''}">${money(activity[key])}</span>`).join('')}
      <strong class="numeric">${money(plannedActivityTotal(activity))}</strong>
      <span class="planned-status ${activity.status.toLowerCase()}">${plannedStatusLabel(activity.status)}</span>
      ${isFinalized ? icon('lock-keyhole') : `<button class="planned-row-action" data-planned-edit="${activity.id}" aria-label="Activiteit aanpassen">${icon('pencil')}</button>`}
    </div>${editingPlannedId === activity.id ? plannedEditorMarkup(activity) : ''}</div>`;
  }).join('');
}

function plannedEstimatedMarkup(item) {
  const rows = plannedEstimatedRows.map(row => {
    const complexCell = row.isNew
      ? `<select class="estimated-meta" data-estimated-meta="complex" data-estimated-id="${row.id}" ${isFinalized ? 'disabled' : ''}>${rentComplexes.map(complex => `<option value="${complex.name}" ${row.complex === complex.name ? 'selected' : ''}>${complex.name}</option>`).join('')}</select>`
      : `<span><strong>${row.complex || 'NTB'}</strong><small>${plannedSourceLabel(row.source)}</small></span>`;
    const activityCell = row.isNew
      ? `<span class="estimated-new-activity"><input class="estimated-meta" data-estimated-meta="description" data-estimated-id="${row.id}" value="${row.description}" ${isFinalized ? 'disabled' : ''}><small class="new-estimated-badge">Nieuw in Estimated</small></span>`
      : `<span><strong>${row.description}</strong><small>${plannedStatusLabel(row.status)}</small></span>`;
    return `<div class="estimated-row ${row.isNew ? 'is-new' : ''}">${complexCell}${activityCell}<label><span>€</span><input data-estimated-field="q3" data-estimated-id="${row.id}" value="${eur.format(row.q3)}" inputmode="numeric" ${isFinalized ? 'disabled' : ''}></label><label><span>€</span><input data-estimated-field="q4" data-estimated-id="${row.id}" value="${eur.format(row.q4)}" inputmode="numeric" ${isFinalized ? 'disabled' : ''}></label><strong class="numeric">${money(Number(row.q3) + Number(row.q4))}</strong><span>${plannedStatusLabel(row.status)}</span></div>`;
  }).join('');
  return `<div class="planned-estimated-summary"><div><span>Realisatie t/m periode 8</span><strong>${money(item.actuals)}</strong><small>Financieel totaal; niet kunstmatig verdeeld over activiteiten</small></div><div>${icon('plus')}<span>Resterende verwachting</span><strong>${money(plannedRemainingTotal())}</strong><small>Handmatig per activiteit voor Q3 en Q4</small></div><div class="total"><span>Estimated 2026</span><strong>${money(item.estimated)}</strong><small>Realisatie + resterende verwachting</small></div></div>
    <div class="planned-table-heading"><div><strong>Resterende verwachting per activiteit</strong><span>De oorspronkelijke begroting blijft intact. Werk alleen de resterende verwachting bij.</span></div>${isFinalized ? '' : `<button class="text-button" data-estimated-add>${icon('plus')}Estimated-only regel</button>`}</div>
    <div class="estimated-table"><div class="estimated-row head"><span>Complex</span><span>Activiteit</span><span>Q3 verwachting</span><span>Q4 verwachting</span><span>Resterend</span><span>Status</span></div>${rows}<div class="estimated-row footer"><strong>Resterende verwachting</strong><span></span><strong class="numeric">${money(plannedEstimatedRows.reduce((sum,row)=>sum+Number(row.q3||0),0))}</strong><strong class="numeric">${money(plannedEstimatedRows.reduce((sum,row)=>sum+Number(row.q4||0),0))}</strong><strong class="numeric">${money(plannedRemainingTotal())}</strong><span></span></div></div>
    <div class="fee-info">${icon('info')}<div><strong>Geen automatische boeking-naar-activiteit-koppeling</strong><p>De gerealiseerde € ${eur.format(item.actuals)} blijft daarom op moduleniveau zichtbaar. De gebruiker bepaalt alleen wat in de resterende perioden nog wordt verwacht.</p></div></div>`;
}

function plannedPreviousMarkup() {
  const rows = plannedPreviousActivities.map(activity => `<div class="planned-row previous"><span><strong>${activity.complex}</strong><small>${plannedSourceLabel(activity.source)}</small></span><span><strong>${activity.description}</strong><small>${plannedStatusLabel(activity.status)}</small></span>${['q1','q2','q3','q4'].map(key => `<span class="numeric">${money(activity[key])}</span>`).join('')}<strong class="numeric">${money(plannedActivityTotal(activity))}</strong><span class="planned-status ${activity.status.toLowerCase()}">${plannedStatusLabel(activity.status)}</span>${isFinalized ? '<span></span>' : `<button class="planned-row-action copy" data-planned-copy="${activity.id}" aria-label="Kopiëren naar 2027">${icon('copy-plus')}</button>`}</div>`).join('');
  return `<div class="planned-reference-note">${icon('history')}<div><strong>Begroting 2026 is alleen een referentie</strong><span>Niets wordt automatisch doorgeschoven. Gebruik kopiëren alleen als je een activiteit bewust opnieuw wilt begroten voor 2027.</span></div></div><div class="planned-table"><div class="planned-row head"><span>Complex / bron</span><span>Activiteit</span><span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span><span>Totaal</span><span>Status</span><span></span></div>${rows}<div class="planned-row footer"><strong>Totaal Begroting 2026</strong><span></span><strong class="numeric">${money(0)}</strong><strong class="numeric">${money(160000)}</strong><strong class="numeric">${money(120000)}</strong><strong class="numeric">${money(80000)}</strong><strong class="numeric">${money(360000)}</strong><span></span><span></span></div></div>`;
}

function plannedDetailMarkup(item) {
  const tabs = [['budget2027', 'Begroting 2027'], ['estimated2026', 'Estimated 2026'], ['budget2026', 'Begroting 2026']]
    .map(([id, label]) => `<button class="detail-tab ${plannedView === id ? 'active' : ''}" role="tab" aria-selected="${plannedView === id}" data-planned-view="${id}">${label}</button>`).join('');
  const budgetContent = `<div class="planned-table-heading"><div><strong>Activiteiten voor 2027</strong><span>Elke regel krijgt verplicht een grootboekrekening. OGB kan aanvullend worden ingevuld; bedragen staan per kwartaal.</span></div>${isFinalized ? '' : `<button class="secondary-button" data-planned-add>${icon('plus')}Activiteit toevoegen</button>`}</div><div class="planned-table"><div class="planned-row head"><span>Complex / bron</span><span>Activiteit / rekening</span><span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span><span>Totaal</span><span>Status</span><span></span></div>${plannedBudgetRowsMarkup()}<div class="planned-row footer"><strong>Totaal Begroting 2027</strong><span></span>${['q1','q2','q3','q4'].map(key => `<strong class="numeric">${money(plannedActivities.reduce((sum,row)=>sum+Number(row[key]||0),0))}</strong>`).join('')}<strong class="numeric">${money(plannedBudgetTotal())}</strong><span></span><span></span></div></div><div class="planned-reference-note compact">${icon('info')}<div><strong>Grootboek leidend, OGB aanvullend</strong><span>De grootboekrekening bepaalt de P&amp;L en vergelijking met realisatie. OGB verfijnt alleen de analyse wanneer die code beschikbaar is en bepaalt nooit Gepland versus Correctief.</span></div></div>`;
  return `<div class="detail-panel planned-detail ${openId === item.id ? 'open' : ''}" id="detail-${item.id}"><div class="detail-panel-inner">
    <div class="rent-detail-top"><div><div class="detail-title">Specificatie gepland onderhoud</div><p>Eigenaarsexploitatie per activiteit en kwartaal; eventuele huurdersdoorbelasting hoort later bij Servicekosten.</p></div><div class="detail-actions"><button class="secondary-button review-module" data-id="${item.id}" ${isFinalized ? 'disabled' : ''}>${icon('square-check-big')}Onderdeel beoordelen</button></div></div>
    <div class="source-summary"><div>${icon('clipboard-list')}<span><strong>Handmatige activiteiten</strong> · laatst bijgewerkt 8 september 2026</span></div><span>${plannedActivities.length} activiteiten</span><span>${new Set(plannedActivities.map(row => row.complex).filter(Boolean)).size} complexen</span><span>Q1–Q4</span></div>
    <div class="rent-summary planned-summary"><div class="rent-metric"><span>Begroting 2026</span><strong>${money(item.previousBudget)}</strong><small>Alleen ter referentie</small></div><div class="rent-metric"><span>Realisatie 2026</span><strong>${money(item.actuals)}</strong><small>T/m afgesloten periode 8</small></div><div class="rent-metric"><span>Estimated 2026</span><strong>${money(item.estimated)}</strong><small>Incl. resterende verwachting</small></div><div class="rent-metric total"><span>Jouw begroting 2027</span><strong>${money(item.budget)}</strong><small>Som van ${plannedActivities.length} activiteiten</small></div></div>
    <div class="rent-toolbar"><div class="detail-tabs" role="tablist" aria-label="Periode gepland onderhoud">${tabs}</div><span class="rent-hint">Bedragen exclusief btw · geen maandniveau</span></div>
    ${plannedView === 'budget2027' ? budgetContent : plannedView === 'estimated2026' ? plannedEstimatedMarkup(item) : plannedPreviousMarkup()}
  </div></div>`;
}

const correctiveComplexLabel = complex => complex || 'NTB';
const correctiveHasCritical = row => !row.description.trim() || !row.glAccount || row.amount === null || !Number.isFinite(Number(row.amount));
const correctiveHasWarning = row => row.amount !== null && Number(row.amount) < 0;
const correctiveTotal = () => correctiveRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
const correctiveRemainingTotal = () => correctiveEstimatedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

function recalculateCorrectiveBudget(markPending = true) {
  const item = modules.find(row => row.id === 'corrective');
  item.budget = correctiveTotal();
  if (markPending) item.status = correctiveRows.some(correctiveHasCritical) ? 'missing' : 'pending';
}

function recalculateCorrectiveEstimated() {
  const item = modules.find(row => row.id === 'corrective');
  item.estimated = Number(item.actuals || 0) + correctiveRemainingTotal();
}

function correctiveComplexOptions(selected) {
  return `<option value="" ${selected === null ? 'selected' : ''}>NTB · nader te bepalen</option>${rentComplexes.map(complex => `<option value="${complex.name}" ${selected === complex.name ? 'selected' : ''}>${complex.name}</option>`).join('')}`;
}

function correctiveEditorMarkup(row) {
  return `<div class="corrective-editor" id="corrective-editor-${row.id}">
    <div class="planned-editor-heading"><div><strong>Begrotingsregel aanpassen</strong><span>Een complex mag NTB blijven. Grootboek is verplicht; OGB is aanvullende, optionele informatie.</span></div><div class="planned-editor-heading-actions"><button class="text-button danger" data-corrective-delete="${row.id}" ${isFinalized ? 'disabled' : ''}>${icon('trash-2')}Verwijderen</button><button class="text-button" data-corrective-close>${icon('x')}Sluiten</button></div></div>
    <div class="corrective-editor-grid">
      <label><span>Complex</span><select data-corrective-field="complex" ${isFinalized ? 'disabled' : ''}>${correctiveComplexOptions(row.complex)}</select></label>
      <label class="wide"><span>Omschrijving *</span><input data-corrective-field="description" value="${row.description}" placeholder="Bijv. kleine installatiestoringen" ${isFinalized ? 'disabled' : ''}></label>
      <label><span>Grootboekrekening *</span><select data-corrective-field="glAccount" ${isFinalized ? 'disabled' : ''}>${grootboekOptionsMarkup('corrective', row.glAccount)}</select></label>
      <label class="ogb-field"><span>OGB-kostensoort <em>optioneel</em></span><select data-corrective-field="ogbCode" ${isFinalized || !row.glAccount ? 'disabled' : ''}>${ogbRuleOptionsMarkup(row.glAccount, row.ogbCode)}</select></label>
      <label><span>Jaarbedrag *</span><div class="planned-money-field"><span>€</span><input data-corrective-field="amount" inputmode="numeric" value="${row.amount === null ? '' : eur.format(row.amount)}" placeholder="Niet ingevuld" ${isFinalized ? 'disabled' : ''}></div></label>
    </div>
    ${correctiveHasCritical(row) ? `<div class="planned-critical">${icon('circle-alert')}Vul een omschrijving, grootboekrekening en jaarbedrag in voordat je dit onderdeel beoordeelt.</div>` : correctiveHasWarning(row) ? `<div class="corrective-warning">${icon('triangle-alert')}Negatief bedrag is toegestaan en telt volledig mee; controleer of dit bewust is.</div>` : ''}
  </div>`;
}

function correctiveBudgetMarkup() {
  const rows = correctiveRows.map(row => `<div class="corrective-row-group ${correctiveHasCritical(row) ? 'has-critical' : correctiveHasWarning(row) ? 'has-warning' : ''}"><div class="corrective-row budget">
    <span><strong>${correctiveComplexLabel(row.complex)}</strong><small>${row.complex ? 'Gekoppeld aan complex' : 'Later aan een complex toe te wijzen'}</small></span>
    <span><strong>${row.description || 'Omschrijving ontbreekt'}</strong><small>Handmatige begrotingsregel</small></span>
    <span class="ledger-rule-cell ${row.glAccount ? '' : 'missing'}"><strong>${row.glAccount || 'Niet gekozen'}</strong><small>${row.glAccount ? grootboekById(row.glAccount)?.description : 'Grootboekrekening ontbreekt'}</small></span>
    <span class="ogb-rule-cell optional"><strong>${row.ogbCode || 'Geen OGB'}</strong><small>${row.ogbCode ? ogbById(row.ogbCode)?.description : 'Optioneel'}</small></span>
    <strong class="numeric ${correctiveHasWarning(row) ? 'negative' : ''}">${row.amount === null ? '<span class="empty-amount">Niet ingevuld</span>' : money(row.amount)}</strong>
    ${isFinalized ? icon('lock-keyhole') : `<button class="planned-row-action" data-corrective-edit="${row.id}" aria-label="Begrotingsregel aanpassen">${icon('pencil')}</button>`}
  </div>${editingCorrectiveId === row.id ? correctiveEditorMarkup(row) : ''}</div>`).join('');
  return `<div class="planned-table-heading"><div><strong>Onderbouwing Begroting 2027</strong><span>Grootboekrekening is verplicht; OGB-kostensoort is optioneel en complex mag NTB blijven.</span></div>${isFinalized ? '' : `<button class="secondary-button" data-corrective-add>${icon('plus')}Begrotingsregel toevoegen</button>`}</div>
    <div class="corrective-table"><div class="corrective-row budget head"><span>Complex</span><span>Omschrijving</span><span>Grootboekrekening</span><span>OGB <small>optioneel</small></span><span>Jaarbedrag</span><span></span></div>${rows}<div class="corrective-row budget footer"><strong>Totaal Begroting 2027</strong><span></span><span></span><span></span><strong class="numeric">${money(correctiveTotal())}</strong><span></span></div></div>
    <div class="planned-reference-note compact">${icon('list-tree')}<div><strong>Grootboek bepaalt waar de regel landt</strong><span>Dezelfde OGB-kostensoort mag bij meerdere grootboekrekeningen voorkomen. Zonder OGB blijft de regel geldig en vergelijkbaar op grootboek- en P&amp;L-niveau.</span></div></div>`;
}

function correctiveEstimatedMarkup(item) {
  const rows = correctiveEstimatedRows.map(row => `<div class="corrective-estimated-row ${row.isNew ? 'is-new' : ''}">
    <select data-corrective-estimated-field="complex" data-corrective-estimated-id="${row.id}" ${isFinalized ? 'disabled' : ''}>${correctiveComplexOptions(row.complex)}</select>
    <span class="corrective-estimated-description"><input data-corrective-estimated-field="description" data-corrective-estimated-id="${row.id}" value="${row.description}" placeholder="Omschrijving" ${isFinalized ? 'disabled' : ''}>${row.isNew ? '<small class="new-estimated-badge">Nieuw in Estimated</small>' : '<small>Resterende verwachting</small>'}</span>
    <label><span>€</span><input data-corrective-estimated-field="amount" data-corrective-estimated-id="${row.id}" value="${row.amount === null ? '' : eur.format(row.amount)}" placeholder="Niet ingevuld" inputmode="numeric" ${isFinalized ? 'disabled' : ''}></label>
    ${isFinalized || !row.isNew ? '<span></span>' : `<button class="planned-row-action" data-corrective-estimated-delete="${row.id}" aria-label="Estimated-only regel verwijderen">${icon('trash-2')}</button>`}
  </div>`).join('');
  return `<div class="planned-estimated-summary"><div><span>Realisatie t/m periode 8</span><strong>${money(item.actuals)}</strong><small>Feitelijk totaal uit de administratie</small></div><div>${icon('plus')}<span>Resterende verwachting</span><strong>${money(correctiveRemainingTotal())}</strong><small>Handmatig per specificatieonderdeel</small></div><div class="total"><span>Estimated 2026</span><strong>${money(item.estimated)}</strong><small>Realisatie + resterende verwachting</small></div></div>
    <div class="planned-table-heading"><div><strong>Resterende verwachting</strong><span>€0 betekent dat voor een onderdeel geen aanvullende kosten meer worden verwacht.</span></div>${isFinalized ? '' : `<button class="text-button" data-corrective-estimated-add>${icon('plus')}Estimated-only regel</button>`}</div>
    <div class="corrective-estimated-table"><div class="corrective-estimated-row head"><span>Complex</span><span>Onderdeel</span><span>Resterend jaar</span><span></span></div>${rows}<div class="corrective-estimated-row footer"><strong>Resterende verwachting</strong><span></span><strong class="numeric">${money(correctiveRemainingTotal())}</strong><span></span></div></div>
    <div class="fee-info">${icon('info')}<div><strong>Realisatie blijft één financieel totaal</strong><p>Boekingen worden niet kunstmatig verdeeld over deze regels of tussen gepland en correctief onderhoud.</p></div></div>`;
}

function correctivePreviousMarkup() {
  const rows = correctivePreviousRows.map(row => `<div class="corrective-row previous"><span><strong>${correctiveComplexLabel(row.complex)}</strong><small>${row.complex ? 'Complexreferentie' : 'Niet toegewezen'}</small></span><span><strong>${row.description}</strong><small>Begroting 2026</small></span><strong class="numeric">${money(row.amount)}</strong><span></span></div>`).join('');
  return `<div class="planned-reference-note">${icon('history')}<div><strong>Begroting 2026 is alleen achtergrondinformatie</strong><span>Het systeem berekent geen historisch gemiddelde en schuift deze bedragen niet automatisch door naar 2027.</span></div></div><div class="corrective-table"><div class="corrective-row head"><span>Complex</span><span>Omschrijving</span><span>Jaarbedrag 2026</span><span></span></div>${rows}<div class="corrective-row footer"><strong>Totaal Begroting 2026</strong><span></span><strong class="numeric">${money(correctivePreviousRows.reduce((sum,row)=>sum+row.amount,0))}</strong><span></span></div></div>`;
}

function correctiveDetailMarkup(item) {
  const tabs = [['budget2027', 'Begroting 2027'], ['estimated2026', 'Estimated 2026'], ['budget2026', 'Begroting 2026']]
    .map(([id, label]) => `<button class="detail-tab ${correctiveView === id ? 'active' : ''}" role="tab" aria-selected="${correctiveView === id}" data-corrective-view="${id}">${label}</button>`).join('');
  const ntbCount = correctiveRows.filter(row => row.complex === null).length;
  return `<div class="detail-panel corrective-detail ${openId === item.id ? 'open' : ''}" id="detail-${item.id}"><div class="detail-panel-inner">
    <div class="rent-detail-top"><div><div class="detail-title">Specificatie correctief / dagelijks onderhoud</div><p>Kleine, grotendeels onvoorspelbare herstellingen; compact begroot op jaarbasis.</p></div><div class="detail-actions"><button class="secondary-button review-module" data-id="${item.id}" ${isFinalized ? 'disabled' : ''}>${icon('square-check-big')}Onderdeel beoordelen</button></div></div>
    <div class="source-summary corrective-source"><div>${icon('clipboard-pen-line')}<span><strong>Handmatige beheerinschatting</strong> · laatst bijgewerkt 8 september 2026</span></div><span>${correctiveRows.length} regels</span><span>${ntbCount} × NTB</span><span>Jaarbedragen</span></div>
    <div class="rent-summary planned-summary"><div class="rent-metric"><span>Begroting 2026</span><strong>${money(item.previousBudget)}</strong><small>Alleen ter referentie</small></div><div class="rent-metric"><span>Realisatie 2026</span><strong>${money(item.actuals)}</strong><small>T/m afgesloten periode 8</small></div><div class="rent-metric"><span>Estimated 2026</span><strong>${money(item.estimated)}</strong><small>Incl. resterende verwachting</small></div><div class="rent-metric total"><span>Jouw begroting 2027</span><strong>${money(item.budget)}</strong><small>Som van ${correctiveRows.length} regels</small></div></div>
    <div class="rent-toolbar"><div class="detail-tabs" role="tablist" aria-label="Periode correctief dagelijks onderhoud">${tabs}</div><span class="rent-hint">Bedragen exclusief btw · geen kwartaal- of maandinvoer</span></div>
    ${correctiveView === 'budget2027' ? correctiveBudgetMarkup() : correctiveView === 'estimated2026' ? correctiveEstimatedMarkup(item) : correctivePreviousMarkup()}
  </div></div>`;
}

const insuranceComplexOptions = selected => `<option value="">Kies complex</option>${rentComplexes.map(complex => `<option value="${complex.name}" ${selected === complex.name ? 'selected' : ''}>${complex.name}</option>`).join('')}`;

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMonthsClamped(date, months) {
  const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

function insuranceRenewals(policy, year = 2027) {
  const start = parseIsoDate(policy.startDate);
  const term = Number(policy.termMonths);
  if (!start || !Number.isInteger(term) || term <= 0) return [];
  const result = [];
  for (let k = 1; k < 2000; k += 1) {
    const renewal = addMonthsClamped(start, k * term);
    if (renewal.getUTCFullYear() > year) break;
    if (renewal.getUTCFullYear() === year) result.push(renewal);
  }
  return result;
}

function insuranceCalculation(policy) {
  const start = parseIsoDate(policy.startDate);
  const term = Number(policy.termMonths);
  const premium = policy.annualPremium;
  const indexPct = policy.indexPct;
  const overrideValid = policy.manualOverride !== null && Number.isFinite(Number(policy.manualOverride));
  const coreValid = start && Number.isInteger(term) && term > 0 && premium !== null && Number.isFinite(Number(premium)) && indexPct !== null && Number.isFinite(Number(indexPct));
  if (!coreValid) {
    const effective = overrideValid ? Number(policy.manualOverride) : 0;
    const effectivePerMonth = effective / 12;
    return { calculated: 0, effective, renewals: [], firstRenewal: null, months: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, calculated: 0, effective: effectivePerMonth, active: false, indexed: false })), quarters: Array(4).fill(effective / 4), overrideDistributed: overrideValid };
  }
  const renewals = insuranceRenewals(policy);
  const firstRenewal = renewals[0] || null;
  const indexedFromMonth = firstRenewal ? firstRenewal.getUTCMonth() + 1 : null;
  const months = [];
  for (let month = 1; month <= 12; month += 1) {
    const notStarted = start.getUTCFullYear() > 2027 || (start.getUTCFullYear() === 2027 && month < start.getUTCMonth() + 1);
    const indexed = !notStarted && indexedFromMonth !== null && month >= indexedFromMonth;
    const calculatedMonth = notStarted ? 0 : Number(premium) * (indexed ? 1 + Number(indexPct) / 100 : 1) / 12;
    months.push({ month, calculated: calculatedMonth, effective: calculatedMonth, active: !notStarted, indexed });
  }
  const calculated = months.reduce((sum, month) => sum + month.calculated, 0);
  const effective = overrideValid ? Number(policy.manualOverride) : calculated;
  if (overrideValid) {
    const distributionBase = calculated !== 0 ? calculated : months.filter(month => month.active).length || 12;
    months.forEach(month => {
      month.effective = calculated !== 0 ? month.calculated * effective / distributionBase : (month.active || months.every(candidate => !candidate.active) ? effective / distributionBase : 0);
    });
  }
  const quarters = [0, 1, 2, 3].map(quarter => months.slice(quarter * 3, quarter * 3 + 3).reduce((sum, month) => sum + month.effective, 0));
  return { calculated, effective, renewals, firstRenewal, months, quarters, overrideDistributed: overrideValid };
}

const insuranceHasCritical = policy => !policy.complex.trim() || !policy.insurer.trim() || !policy.glAccount || !parseIsoDate(policy.startDate) || !Number.isInteger(Number(policy.termMonths)) || Number(policy.termMonths) <= 0 || policy.annualPremium === null || !Number.isFinite(Number(policy.annualPremium)) || policy.indexPct === null || !Number.isFinite(Number(policy.indexPct));
const insuranceHasWarning = policy => Number(policy.annualPremium) < 0 || Number(policy.indexPct) < 0 || (policy.manualOverride !== null && Number(policy.manualOverride) < 0);
const insuranceBudgetTotal = () => insurancePolicies.reduce((sum, policy) => sum + insuranceCalculation(policy).effective, 0);
const insuranceRemainingTotal = () => insuranceEstimatedRows.reduce((sum, row) => sum + (row.remainingOverride === null ? Number(row.calculatedRemaining || 0) : Number(row.remainingOverride || 0)), 0);

function formatDateNl(date) {
  if (!date) return 'Geen verlenging in 2027';
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function recalculateInsuranceBudget(markPending = true) {
  const item = modules.find(row => row.id === 'insurance');
  item.proposal = insurancePolicies.reduce((sum, policy) => sum + insuranceCalculation({ ...policy, manualOverride: null }).calculated, 0);
  item.budget = insuranceBudgetTotal();
  if (markPending) item.status = insurancePolicies.some(insuranceHasCritical) ? 'missing' : 'pending';
}

function recalculateInsuranceEstimated() {
  const item = modules.find(row => row.id === 'insurance');
  item.estimated = Number(item.actuals || 0) + insuranceRemainingTotal();
}

function insuranceEditorMarkup(policy) {
  const calculation = insuranceCalculation(policy);
  const overrideActive = policy.manualOverride !== null;
  return `<div class="insurance-editor" id="insurance-editor-${policy.id}">
    <div class="planned-editor-heading"><div><strong>Polis aanpassen</strong><span>Vul de huidige jaarpremie in. De looptijd bepaalt alleen wanneer de polis verlengt, niet de financiële periode.</span></div><div class="planned-editor-heading-actions"><button class="text-button danger" data-insurance-delete="${policy.id}" ${isFinalized ? 'disabled' : ''}>${icon('trash-2')}Verwijderen</button><button class="text-button" data-insurance-close>${icon('x')}Sluiten</button></div></div>
    <div class="insurance-editor-grid">
      <label><span>Complex *</span><select data-insurance-field="complex" ${isFinalized ? 'disabled' : ''}>${insuranceComplexOptions(policy.complex)}</select></label>
      <label><span>Verzekeraar *</span><input data-insurance-field="insurer" value="${policy.insurer}" placeholder="Naam verzekeraar" ${isFinalized ? 'disabled' : ''}></label>
      <label><span>Ingangsdatum *</span><input type="date" data-insurance-field="startDate" value="${policy.startDate}" ${isFinalized ? 'disabled' : ''}></label>
      <label><span>Looptijd *</span><div class="insurance-unit-field"><input data-insurance-field="termMonths" inputmode="numeric" value="${policy.termMonths ?? ''}" placeholder="12" ${isFinalized ? 'disabled' : ''}><span>mnd</span></div></label>
      <label><span>Grootboekrekening *</span><select data-insurance-field="glAccount" ${isFinalized ? 'disabled' : ''}>${grootboekOptionsMarkup('insurance', policy.glAccount)}</select></label>
      <label><span>OGB-kostensoort <em>optioneel</em></span><select data-insurance-field="ogbCode" ${isFinalized || !policy.glAccount ? 'disabled' : ''}>${ogbRuleOptionsMarkup(policy.glAccount, policy.ogbCode)}</select></label>
      <label><span>Huidige jaarpremie *</span><div class="planned-money-field"><span>€</span><input data-insurance-field="annualPremium" inputmode="decimal" value="${policy.annualPremium === null ? '' : eur.format(policy.annualPremium)}" placeholder="Niet ingevuld" ${isFinalized ? 'disabled' : ''}></div></label>
      <label><span>Index 2027 *</span><div class="insurance-unit-field percentage"><input data-insurance-field="indexPct" inputmode="decimal" value="${policy.indexPct === null ? '' : String(policy.indexPct).replace('.', ',')}" placeholder="0,0" ${isFinalized ? 'disabled' : ''}><span>%</span></div></label>
    </div>
    <div class="insurance-calculation-strip"><div>${icon('calendar-sync')}<span><strong>${formatDateNl(calculation.firstRenewal)}</strong><small>${calculation.renewals.length > 1 ? `${calculation.renewals.length} verlengmomenten; alleen het eerste indexeert` : calculation.firstRenewal ? 'Indexatie geldt vanaf deze volledige maand' : 'De huidige premie geldt heel 2027'}</small></span></div><div><span>Berekend voorstel</span><strong>${money(calculation.calculated)}</strong></div><label class="insurance-override-switch"><input type="checkbox" data-insurance-override-toggle="${policy.id}" ${overrideActive ? 'checked' : ''} ${isFinalized ? 'disabled' : ''}><span>Begroot bedrag aanpassen</span></label><div class="insurance-override-field ${overrideActive ? 'active' : ''}"><span>€</span><input data-insurance-field="manualOverride" inputmode="decimal" value="${overrideActive ? eur.format(policy.manualOverride) : ''}" placeholder="${eur.format(calculation.calculated)}" ${!overrideActive || isFinalized ? 'disabled' : ''}></div></div>
    ${insuranceHasCritical(policy) ? `<div class="planned-critical">${icon('circle-alert')}Maak complex, verzekeraar, ingangsdatum, looptijd, premie, index en grootboek compleet voordat je beoordeelt.</div>` : insuranceHasWarning(policy) ? `<div class="corrective-warning">${icon('triangle-alert')}Een negatieve premie, index of override is toegestaan, maar vraagt extra controle.</div>` : ''}
  </div>`;
}

function insuranceQuarterMarkup(policy, calculation) {
  return `<div class="insurance-quarter-strip"><span class="insurance-period-label"><strong>Verdeling 2027</strong><small>${calculation.overrideDistributed ? 'Jaaroverride naar verhouding verdeeld' : 'Automatisch uit polisgegevens'}</small></span>${calculation.quarters.map((amount, index) => `<span class="insurance-quarter"><small>Q${index + 1}</small><strong>${money(amount)}</strong></span>`).join('')}<button class="text-button insurance-month-button" data-insurance-months="${policy.id}" aria-expanded="${expandedInsuranceMonthsId === policy.id}">${icon('calendar-days')}${expandedInsuranceMonthsId === policy.id ? 'Maanden sluiten' : 'Maandverloop'}</button></div>`;
}

function insuranceMonthsMarkup(policy, calculation) {
  const monthNames = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const renewalMonth = calculation.firstRenewal ? calculation.firstRenewal.getUTCMonth() + 1 : null;
  return `<div class="insurance-month-panel"><div class="insurance-month-heading"><div>${icon('calendar-range')}<span><strong>Maandverloop · ${policy.insurer || 'Nieuwe polis'}</strong><small>${calculation.overrideDistributed ? 'Het handmatig aangepaste jaartotaal is naar verhouding verdeeld over hetzelfde maandprofiel.' : 'Automatisch berekend vanuit ingangsdatum, huidige jaarpremie en het eerste verlengmoment.'}</small></span></div><strong>${money(calculation.effective)} totaal</strong></div><div class="insurance-month-grid">${calculation.months.map((month, index) => `<div class="insurance-month ${month.month === renewalMonth ? 'is-renewal' : ''} ${!month.active ? 'is-inactive' : ''}"><span>${monthNames[index]}</span><strong>${money(month.effective)}</strong>${month.month === renewalMonth ? '<small>Indexatie</small>' : !month.active ? '<small>Niet actief</small>' : '<small>&nbsp;</small>'}</div>`).join('')}</div><div class="insurance-month-legend">${renewalMonth ? `${icon('calendar-check')}Indexatie geldt vanaf ${monthNames[renewalMonth - 1]} voor de volledige maand.` : `${icon('circle-check')}Geen indexatiemoment in 2027; de huidige premie blijft van toepassing.`}</div></div>`;
}

function insuranceBudgetMarkup() {
  const rows = insurancePolicies.map(policy => {
    const calculation = insuranceCalculation(policy);
    return `<div class="insurance-row-group ${insuranceHasCritical(policy) ? 'has-critical' : insuranceHasWarning(policy) ? 'has-warning' : ''}"><div class="insurance-row">
      <span><strong>${policy.complex || 'Complex ontbreekt'}</strong><small>Verplicht voor vaststellen</small></span>
      <span><strong>${policy.insurer || 'Verzekeraar ontbreekt'}</strong><small>${policy.startDate ? `Sinds ${formatDateNl(parseIsoDate(policy.startDate))}` : 'Ingangsdatum ontbreekt'} · ${policy.termMonths || '–'} mnd</small></span>
      <span><strong>${grootboekLabel(policy.glAccount)}</strong><small>Bepaalt P&amp;L-post</small></span>
      <span><strong>${ogbLabel(policy.ogbCode)}</strong><small>${policy.ogbCode ? 'Aanvullende referentie' : 'Optioneel'}</small></span>
      <span class="numeric"><strong>${policy.annualPremium === null ? '<span class="empty-amount">Niet ingevuld</span>' : money(policy.annualPremium)}</strong><small>${policy.indexPct === null ? 'Index ontbreekt' : `${String(policy.indexPct).replace('.', ',')}% index`}</small></span>
      <span class="numeric"><strong>${money(calculation.effective)}</strong><small>${policy.manualOverride !== null ? `Handmatig · berekend ${money(calculation.calculated)}` : formatDateNl(calculation.firstRenewal)}</small></span>
      ${isFinalized ? icon('lock-keyhole') : `<button class="planned-row-action" data-insurance-edit="${policy.id}" aria-label="Polis aanpassen">${icon('pencil')}</button>`}
    </div>${insuranceQuarterMarkup(policy, calculation)}${expandedInsuranceMonthsId === policy.id ? insuranceMonthsMarkup(policy, calculation) : ''}${editingInsuranceId === policy.id ? insuranceEditorMarkup(policy) : ''}</div>`;
  }).join('');
  const criticalCount = insurancePolicies.filter(insuranceHasCritical).length;
  return `<div class="planned-table-heading"><div><strong>Polissen voor Begroting 2027</strong><span>De huidige jaarpremie wordt vanaf het eerste verlengmoment in 2027 geïndexeerd.</span></div>${isFinalized ? '' : `<button class="secondary-button" data-insurance-add>${icon('plus')}Polis toevoegen</button>`}</div>
    <div class="insurance-table"><div class="insurance-row head"><span>Complex</span><span>Verzekeraar / contract</span><span>Grootboekrekening</span><span>OGB <small>optioneel</small></span><span>Premie / index</span><span>Begroot 2027</span><span></span></div>${rows}<div class="insurance-row footer"><strong>Totaal Begroting 2027</strong><span></span><span></span><span></span><span></span><strong class="numeric">${money(insuranceBudgetTotal())}</strong><span></span></div></div>
    <div class="planned-reference-note compact">${icon('calendar-range')}<div><strong>Looptijd bepaalt het verlengritme</strong><span>De ingangsdatum zelf is nooit een verlenging. Ook bij meerdere verlengmomenten in 2027 wordt het indexpercentage maar één keer toegepast.</span></div></div>
    ${criticalCount ? `<div class="insurance-module-warning">${icon('circle-alert')}<strong>${criticalCount} ${criticalCount === 1 ? 'polis is' : 'polissen zijn'} nog niet compleet.</strong><span>De conceptbegroting blijft opslaanbaar; vaststellen kan pas na aanvulling.</span></div>` : ''}`;
}

function insuranceEstimatedMarkup(item) {
  const rows = insuranceEstimatedRows.map(row => {
    const effective = row.remainingOverride === null ? row.calculatedRemaining : row.remainingOverride;
    return `<div class="insurance-estimated-row"><span><strong>${row.complex}</strong><small>${row.insurer}</small></span><strong class="numeric">${money(row.calculatedRemaining)}</strong><label><span>€</span><input data-insurance-estimated-id="${row.id}" value="${row.remainingOverride === null ? '' : eur.format(row.remainingOverride)}" placeholder="Automatisch" inputmode="decimal" ${isFinalized ? 'disabled' : ''}></label><strong class="numeric">${money(effective)}</strong></div>`;
  }).join('');
  return `<div class="planned-estimated-summary"><div><span>Realisatie t/m periode 8</span><strong>${money(item.actuals)}</strong><small>Feitelijk totaal uit de administratie</small></div><div>${icon('plus')}<span>Resterende premie</span><strong>${money(insuranceRemainingTotal())}</strong><small>Automatisch per polis, handmatig aanpasbaar</small></div><div class="total"><span>Estimated 2026</span><strong>${money(item.estimated)}</strong><small>Realisatie + resterende verwachting</small></div></div>
    <div class="planned-table-heading"><div><strong>Resterende verwachting per polis</strong><span>Laat het veld leeg om de automatische berekening te gebruiken. Vul 0 in voor bewust geen resterende premie.</span></div></div>
    <div class="insurance-estimated-table"><div class="insurance-estimated-row head"><span>Complex / verzekeraar</span><span>Automatisch resterend</span><span>Jouw aanpassing</span><span>Effectief</span></div>${rows}<div class="insurance-estimated-row footer"><strong>Resterende verwachting</strong><span></span><span></span><strong class="numeric">${money(insuranceRemainingTotal())}</strong></div></div>`;
}

function insurancePreviousMarkup(item) {
  return `<div class="planned-reference-note">${icon('history')}<div><strong>Van 2026 is alleen het vastgestelde totaal betrouwbaar beschikbaar</strong><span>De oude polisspecificatie wordt niet gereconstrueerd uit boekingen. Het bedrag blijft wel zichtbaar als referentie naast 2027.</span></div></div>
    <div class="insurance-previous-card"><div><span>P&amp;L-post</span><strong>Verzekeringen</strong><small>Grootboekrekening 4130</small></div><div><span>Begroting 2026</span><strong>${money(item.previousBudget)}</strong><small>Vastgesteld bedrag · alleen-lezen</small></div></div>`;
}

function insuranceDetailMarkup(item) {
  const tabs = [['budget2027', 'Begroting 2027'], ['estimated2026', 'Estimated 2026'], ['budget2026', 'Begroting 2026']]
    .map(([id, label]) => `<button class="detail-tab ${insuranceView === id ? 'active' : ''}" role="tab" aria-selected="${insuranceView === id}" data-insurance-view="${id}">${label}</button>`).join('');
  const criticalCount = insurancePolicies.filter(insuranceHasCritical).length;
  return `<div class="detail-panel insurance-detail ${openId === item.id ? 'open' : ''}" id="detail-${item.id}"><div class="detail-panel-inner">
    <div class="rent-detail-top"><div><div class="detail-title">Specificatie verzekeringen</div><p>Leg iedere polis apart vast en controleer wanneer indexatie in het begrotingsjaar ingaat.</p></div><div class="detail-actions"><button class="secondary-button review-module" data-id="${item.id}" ${isFinalized ? 'disabled' : ''}>${icon('square-check-big')}Onderdeel beoordelen</button></div></div>
    <div class="source-summary insurance-source"><div>${icon('file-pen-line')}<span><strong>Geen betrouwbare polisbron in de administratie</strong> · handmatige polisinvoer</span></div><span>${insurancePolicies.length} polissen</span><span>${criticalCount ? `${criticalCount} onvolledig` : 'Alle compleet'}</span><span>Grootboek 4130</span></div>
    <div class="rent-summary planned-summary"><div class="rent-metric"><span>Begroting 2026</span><strong>${money(item.previousBudget)}</strong><small>Alleen ter referentie</small></div><div class="rent-metric"><span>Realisatie 2026</span><strong>${money(item.actuals)}</strong><small>T/m afgesloten periode 8</small></div><div class="rent-metric"><span>Estimated 2026</span><strong>${money(item.estimated)}</strong><small>Incl. resterende premie</small></div><div class="rent-metric total"><span>Jouw begroting 2027</span><strong>${money(item.budget)}</strong><small>Som van ${insurancePolicies.length} polissen</small></div></div>
    <div class="rent-toolbar"><div class="detail-tabs" role="tablist" aria-label="Periode verzekeringen">${tabs}</div><span class="rent-hint">Premies exclusief btw · maandnauwkeurig berekend</span></div>
    ${insuranceView === 'budget2027' ? insuranceBudgetMarkup() : insuranceView === 'estimated2026' ? insuranceEstimatedMarkup(item) : insurancePreviousMarkup(item)}
  </div></div>`;
}

const municipalActualWozTotal = () => municipalWozObjects.reduce((sum, row) => sum + Number(row.actualWoz || 0), 0);
const municipalHistoricalRate = () => municipalWozSetComplete && municipalActualWozTotal() > 0 ? municipalHistoricalCharges / municipalActualWozTotal() : null;
const municipalAdjustedRate = () => municipalHistoricalRate() === null || municipalRateIncreasePct === null ? null : municipalHistoricalRate() * (1 + Number(municipalRateIncreasePct) / 100);

function municipalObjectCalculation(row) {
  const automaticWoz = municipalWozIncreasePct === null ? null : Number(row.actualWoz || 0) * (1 + Number(municipalWozIncreasePct) / 100);
  const expectedWoz = row.expectedOverride === null ? automaticWoz : Number(row.expectedOverride || 0);
  const charge = expectedWoz === null || municipalAdjustedRate() === null ? null : expectedWoz * municipalAdjustedRate();
  return { automaticWoz, expectedWoz, charge };
}

const municipalProposalTotal = () => !municipalWozObjects.length || !municipalWozSetComplete || municipalWozObjects.some(municipalObjectHasCritical) || municipalWozIncreasePct === null || municipalRateIncreasePct === null
  ? null
  : municipalWozObjects.reduce((sum, row) => sum + Number(municipalObjectCalculation(row).charge || 0), 0);
const municipalLedgerShareTotal = () => municipalLedgerRows.reduce((sum, row) => sum + Number(row.share || 0), 0);
function municipalObjectHasCritical(row) {
  return !(row.complex || '').trim() || !(row.unit || '').trim() || !Number.isInteger(Number(row.assessmentYear)) || !parseIsoDate(row.valueDate) || row.actualWoz === null || !Number.isFinite(Number(row.actualWoz)) || Number(row.actualWoz) <= 0;
}
const municipalHasCritical = () => !municipalWozObjects.length || !municipalWozSetComplete || municipalWozObjects.some(municipalObjectHasCritical) || municipalWozIncreasePct === null || !Number.isFinite(Number(municipalWozIncreasePct)) || municipalRateIncreasePct === null || !Number.isFinite(Number(municipalRateIncreasePct)) || municipalLedgerRows.some(row => !row.glAccount) || Math.abs(municipalLedgerShareTotal() - 1) > 0.0001;

function recalculateMunicipalBudget(markPending = true) {
  const item = modules.find(row => row.id === 'municipal');
  item.proposal = municipalProposalTotal();
  item.budget = municipalBudgetOverride === null ? item.proposal : municipalBudgetOverride;
  if (markPending) item.status = municipalHasCritical() ? 'missing' : 'pending';
}

function recalculateMunicipalEstimated() {
  const item = modules.find(row => row.id === 'municipal');
  item.estimated = Number(item.actuals || 0) + Number(municipalEstimatedCorrection || 0);
}

function municipalUnitOptions(complex, selected) {
  if (!complex) return '<option value="">Kies eerst een complex</option>';
  const units = rentContracts.filter(contract => contract.complex === complex).map(contract => contract.unit);
  return `<option value="">Kies complex of unit</option><option value="Geheel complex" ${selected === 'Geheel complex' ? 'selected' : ''}>Geheel complex</option>${units.map(unit => `<option value="${unit}" ${selected === unit ? 'selected' : ''}>Unit ${unit}</option>`).join('')}`;
}

function municipalEditorMarkup(row) {
  return `<div class="municipal-editor" id="municipal-editor-${row.id}">
    <div class="planned-editor-heading"><div><strong>WOZ-waarde aanpassen</strong><span>Kies het complex en de unit uit de bestaande administratie. Gebruik Geheel complex wanneer de beschikking niet per unit is uitgesplitst.</span></div><div class="planned-editor-heading-actions"><button class="text-button danger" data-municipal-delete="${row.id}" ${isFinalized ? 'disabled' : ''}>${icon('trash-2')}Verwijderen</button><button class="text-button" data-municipal-close>${icon('x')}Sluiten</button></div></div>
    <div class="municipal-editor-grid">
      <label><span>Complex *</span><select data-municipal-field="complex" ${isFinalized ? 'disabled' : ''}>${insuranceComplexOptions(row.complex)}</select></label>
      <label><span>Unit of geheel complex *</span><select data-municipal-field="unit" ${isFinalized || !row.complex ? 'disabled' : ''}>${municipalUnitOptions(row.complex, row.unit)}</select></label>
      <label><span>Aanslagjaar *</span><input data-municipal-field="assessmentYear" inputmode="numeric" value="${row.assessmentYear || ''}" placeholder="2026" ${isFinalized ? 'disabled' : ''}></label>
      <label><span>Waardepeildatum *</span><input type="date" data-municipal-field="valueDate" value="${row.valueDate}" ${isFinalized ? 'disabled' : ''}></label>
      <label><span>Werkelijke WOZ *</span><div class="planned-money-field"><span>€</span><input data-municipal-field="actualWoz" inputmode="numeric" value="${row.actualWoz === null ? '' : eur.format(row.actualWoz)}" placeholder="Niet ingevuld" ${isFinalized ? 'disabled' : ''}></div></label>
    </div>
    ${municipalObjectHasCritical(row) ? `<div class="planned-critical">${icon('circle-alert')}Maak complex, unit of geheel complex, aanslagjaar, waardepeildatum en werkelijke WOZ compleet.</div>` : ''}
  </div>`;
}

function municipalLedgerMarkup(total) {
  const rows = municipalLedgerRows.map(row => `<div class="municipal-ledger-row">
    <span class="ledger-rule-cell"><strong>${grootboekLabel(row.glAccount)}</strong><small>Verplicht · bepaalt P&amp;L-post</small></span>
    <span class="ogb-rule-cell ${row.ogbCode ? '' : 'optional'}"><strong>${ogbLabel(row.ogbCode)}</strong><small>${row.ogbCode ? 'Aanvullende referentie' : 'Geen OGB nodig'}</small></span>
    <label class="municipal-share"><input data-municipal-ledger-share="${row.id}" value="${String(Number(row.share || 0) * 100).replace('.', ',')}" inputmode="decimal" ${isFinalized ? 'disabled' : ''}><span>%</span></label>
    <strong class="numeric">${total === null ? '<span class="empty-amount">Nog niet berekenbaar</span>' : money(total * Number(row.share || 0))}</strong>
  </div>`).join('');
  const shareTotal = municipalLedgerShareTotal();
  return `<div class="planned-table-heading municipal-ledger-heading"><div><strong>Verdeling naar grootboek</strong><span>De P&amp;L blijft één post. Voor vergelijking met realisatie wordt het totaal wel verdeeld over verplichte grootboekrekeningen.</span></div><span>Voorgesteld vanuit verhouding realisatie 2026</span></div>
    <div class="municipal-ledger-table"><div class="municipal-ledger-row head"><span>Grootboekrekening</span><span>OGB-kostensoort <small>optioneel</small></span><span>Verdeling</span><span>Begroot 2027</span></div>${rows}<div class="municipal-ledger-row footer"><strong>Totaal gemeentelijke lasten</strong><span></span><strong class="numeric ${Math.abs(shareTotal - 1) > 0.0001 ? 'negative' : ''}">${formatPercentage(shareTotal * 100)}</strong><strong class="numeric">${total === null ? '<span class="empty-amount">Nog niet berekenbaar</span>' : money(total * shareTotal)}</strong></div></div>
    ${Math.abs(shareTotal - 1) > 0.0001 ? `<div class="planned-critical">${icon('circle-alert')}De grootboekverdeling moet samen precies 100% zijn voordat je dit onderdeel kunt beoordelen.</div>` : `<div class="planned-reference-note compact municipal-ledger-note">${icon('list-checks')}<div><strong>Grootboek is verplicht; OGB blijft optioneel</strong><span>De verdeling verandert de WOZ-berekening niet. Zij zorgt alleen dat begroting en latere realisatie op dezelfde grootboekrekeningen vergelijkbaar blijven.</span></div></div>`}`;
}

function municipalBudgetMarkup() {
  const historicalRate = municipalHistoricalRate();
  const adjustedRate = municipalAdjustedRate();
  const total = municipalProposalTotal();
  const effectiveBudget = modules.find(row => row.id === 'municipal').budget;
  const rows = municipalWozObjects.map(row => {
    const calculation = municipalObjectCalculation(row);
    return `<div class="municipal-object-group ${municipalObjectHasCritical(row) ? 'has-critical' : row.expectedOverride !== null ? 'has-override' : ''}"><div class="municipal-object-row">
      <span><strong>${row.complex || 'Complex ontbreekt'}</strong><small>${row.unit ? (row.unit === 'Geheel complex' ? 'Geheel complex' : `Unit ${row.unit}`) : 'Unit ontbreekt'}</small></span>
      <span><strong>${row.actualWoz === null ? '<span class="empty-amount">Niet ingevuld</span>' : money(row.actualWoz)}</strong><small>Aanslag ${row.assessmentYear || '–'} · peildatum ${row.valueDate ? formatDateNl(parseIsoDate(row.valueDate)) : 'ontbreekt'}</small></span>
      <span class="numeric"><strong>${calculation.automaticWoz === null ? '<span class="empty-amount">Aanname ontbreekt</span>' : money(calculation.automaticWoz)}</strong><small>${municipalWozIncreasePct === null ? 'Vul algemene stijging in' : `${formatPercentage(municipalWozIncreasePct)} algemene stijging`}</small></span>
      <label class="municipal-override"><span>€</span><input data-municipal-override="${row.id}" value="${row.expectedOverride === null ? '' : eur.format(row.expectedOverride)}" placeholder="Automatisch" inputmode="numeric" ${isFinalized ? 'disabled' : ''}></label>
      <span class="numeric"><strong>${calculation.expectedWoz === null ? '<span class="empty-amount">Niet berekenbaar</span>' : money(calculation.expectedWoz)}</strong><small>${row.expectedOverride === null ? 'Automatisch' : 'Handmatig aangepast'}</small></span>
      <span class="numeric"><strong>${calculation.charge === null ? '<span class="empty-amount">Niet berekenbaar</span>' : money(calculation.charge)}</strong><small>${adjustedRate === null ? 'Lastenpercentage ontbreekt' : `${(adjustedRate * 100).toLocaleString('nl-NL', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}% lastenpercentage`}</small></span>
      ${isFinalized ? icon('lock-keyhole') : `<button class="planned-row-action" data-municipal-edit="${row.id}" aria-label="WOZ-waarde aanpassen">${icon('pencil')}</button>`}
    </div>${editingMunicipalId === row.id ? municipalEditorMarkup(row) : ''}</div>`;
  }).join('');
  return `<div class="municipal-assumptions">
      <div class="municipal-assumption fixed">${icon('calculator')}<span><small>Historisch lastenpercentage</small><strong>${historicalRate === null ? 'Nog niet berekenbaar' : `${(historicalRate * 100).toLocaleString('nl-NL', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`}</strong><em>${money(municipalHistoricalCharges)} laatste volledige jaar / ${municipalActualWozTotal() ? `${money(municipalActualWozTotal())} WOZ` : 'WOZ nog invoeren'}</em></span></div>
      <label class="municipal-assumption"><span><small>Verwachte WOZ-stijging 2027</small><strong>Algemene aanname voor alle complexen en units</strong></span><div><input id="municipal-woz-increase" value="${municipalWozIncreasePct === null ? '' : String(municipalWozIncreasePct).replace('.', ',')}" inputmode="decimal" ${isFinalized ? 'disabled' : ''}><b>%</b></div></label>
      <label class="municipal-assumption"><span><small>Stijging lastenpercentage 2027</small><strong>Onafhankelijk van WOZ-stijging</strong></span><div><input id="municipal-rate-increase" value="${municipalRateIncreasePct === null ? '' : String(municipalRateIncreasePct).replace('.', ',')}" inputmode="decimal" ${isFinalized ? 'disabled' : ''}><b>%</b></div></label>
      <div class="municipal-assumption result">${icon('arrow-right')}<span><small>Nieuw gemiddeld lastenpercentage</small><strong>${adjustedRate === null ? 'Nog niet berekenbaar' : `${(adjustedRate * 100).toLocaleString('nl-NL', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`}</strong><em>Toegepast op verwachte WOZ</em></span></div>
    </div>
    <div class="planned-table-heading"><div><strong>WOZ-waarden per complex en unit</strong><span>Kies het hele complex of een afzonderlijke unit en neem daarna de werkelijke WOZ handmatig over van de beschikking.</span></div>${isFinalized ? '' : `<button class="secondary-button" data-municipal-add>${icon('plus')}WOZ-waarde toevoegen</button>`}</div>
    ${municipalWozObjects.length ? `<div class="municipal-object-table"><div class="municipal-object-row head"><span>Complex / unit</span><span>Werkelijke WOZ</span><span>Automatisch verwacht</span><span>Jouw WOZ 2027</span><span>Effectieve WOZ</span><span>Gemeentelijke lasten</span><span></span></div>${rows}<div class="municipal-object-row footer"><strong>Totaal</strong><strong>${money(municipalActualWozTotal())}</strong><span></span><span></span><strong class="numeric">${total === null ? '<span class="empty-amount">Niet berekenbaar</span>' : money(municipalWozObjects.reduce((sum, row) => sum + Number(municipalObjectCalculation(row).expectedWoz || 0), 0))}</strong><strong class="numeric">${total === null ? '<span class="empty-amount">Niet berekenbaar</span>' : money(total)}</strong><span></span></div></div><label class="municipal-complete-check ${municipalWozSetComplete ? 'is-complete' : ''}"><input type="checkbox" id="municipal-set-complete" ${municipalWozSetComplete ? 'checked' : ''} ${isFinalized ? 'disabled' : ''}><span>${icon(municipalWozSetComplete ? 'circle-check-big' : 'circle-dashed')}<span><strong>Alle WOZ-waarden uit de beschikkingen zijn ingevoerd</strong><small>Bevestig dit pas nadat alle complexen en units zijn gecontroleerd. Daarna berekent het systeem het historische lastenpercentage.</small></span></span></label>` : `<div class="municipal-empty"><span class="municipal-empty-icon">${icon('land-plot')}</span><div><strong>Nog geen WOZ-waarden ingevoerd</strong><p>Selecteer een complex en vervolgens Geheel complex of een unit. Vul daarna de waarde van de werkelijke WOZ-beschikking handmatig in.</p></div>${isFinalized ? '' : `<button class="button primary" data-municipal-add>Eerste WOZ-waarde invoeren ${icon('arrow-right')}</button>`}</div>`}
    <div class="municipal-source-warning">${icon('file-warning')}<div><strong>WOZ-gegevens komen niet betrouwbaar uit de boekhouding</strong><span>Voer de werkelijke WOZ jaarlijks over vanuit de beschikking. Daarna wordt deze waarde de historische bron voor de volgende begroting.</span></div></div>
    ${municipalBudgetOverride !== null ? `<div class="municipal-zero-note">${icon('badge-check')}<div><strong>Bewust ${money(municipalBudgetOverride)} begroot</strong><span>Het berekende voorstel van ${money(total)} blijft zichtbaar als referentie. Een wijziging in de WOZ-aannames herstelt de berekende begroting.</span></div></div>` : ''}
    ${municipalLedgerMarkup(effectiveBudget)}`;
}

function municipalEstimatedMarkup(item) {
  return `<div class="planned-estimated-summary municipal-estimated-summary"><div><span>Realisatie t/m periode 8</span><strong>${money(item.actuals)}</strong><small>Werkelijke gemeentelijke lasten uit de administratie</small></div><div>${icon('plus')}<span>Nog verwachte aanslag of correctie</span><label class="municipal-correction"><span>€</span><input id="municipal-estimated-correction" value="${eur.format(municipalEstimatedCorrection)}" inputmode="numeric" ${isFinalized ? 'disabled' : ''}></label><small>Handmatig aanpasbaar; €0 als alles is geboekt</small></div><div class="total"><span>Estimated 2026</span><strong>${money(item.estimated)}</strong><small>Realisatie + verwachte correctie</small></div></div>
    <div class="planned-reference-note compact">${icon('circle-check')}<div><strong>Geen kunstmatige extrapolatie</strong><span>Rond einde Q3 of begin Q4 is Estimated in beginsel gelijk aan de geboekte lasten. Alleen een bekende aanvullende aanslag of correctie wordt nog toegevoegd.</span></div></div>`;
}

function municipalHistoryRows() {
  const confirmedCurrent = municipalWozSetComplete
    ? municipalWozObjects.filter(row => !municipalObjectHasCritical(row)).map(row => ({ ...row, source: 'Bevestigd in concept' }))
    : [];
  const byObjectAndYear = new Map();
  [...municipalWozHistory, ...confirmedCurrent].forEach(row => {
    byObjectAndYear.set(`${row.complex}|${row.unit}|${row.assessmentYear}`, row);
  });
  return [...byObjectAndYear.values()].sort((a, b) =>
    a.complex.localeCompare(b.complex, 'nl') || a.unit.localeCompare(b.unit, 'nl') || Number(a.assessmentYear) - Number(b.assessmentYear));
}

function municipalHistoryWithChanges(rows = municipalHistoryRows()) {
  const previousByObject = new Map();
  return rows.map(row => {
    const key = `${row.complex}|${row.unit}`;
    const previous = previousByObject.get(key) || null;
    const changeAmount = previous ? Number(row.actualWoz) - Number(previous.actualWoz) : null;
    const changePct = previous && Number(previous.actualWoz) ? changeAmount / Number(previous.actualWoz) : null;
    previousByObject.set(key, row);
    return { ...row, previousWoz: previous?.actualWoz ?? null, changeAmount, changePct };
  });
}

function municipalFilteredExportRows() {
  const rows = municipalHistoryWithChanges();
  const newestYear = rows.reduce((year, row) => Math.max(year, Number(row.assessmentYear) || 0), 0);
  return rows.filter(row => {
    const matchesComplex = municipalExportComplex === 'all' || row.complex === municipalExportComplex;
    const years = municipalExportYears === 'last3' ? Number(row.assessmentYear) >= newestYear - 2 : true;
    return matchesComplex && years;
  });
}

function municipalHistoryMarkup() {
  const history = municipalHistoryWithChanges();
  const rows = history.map(row => `<div class="municipal-history-row"><span><strong>${row.complex}</strong><small>${row.unit === 'Geheel complex' ? 'Geheel complex' : `Unit ${row.unit}`}</small></span><span>${row.assessmentYear}</span><span>${formatDateNl(parseIsoDate(row.valueDate))}</span><strong class="numeric">${money(row.actualWoz)}</strong><span class="numeric"><strong>${row.changePct === null ? 'Eerste meting' : `${row.changePct >= 0 ? '+' : ''}${formatPercentage(row.changePct * 100)}`}</strong><small>${row.changeAmount === null ? 'Nog geen vorig jaar' : signedMoney(row.changeAmount)}</small></span></div>`).join('');
  return `<div class="municipal-history-heading"><div class="planned-reference-note compact">${icon('history')}<div><strong>WOZ-historie per complex en unit</strong><span>Aanslagjaar en waardepeildatum blijven apart bewaard. De ontwikkeling wordt steeds vergeleken met het vorige beschikbare jaar van hetzelfde complex of dezelfde unit.</span></div></div><button class="secondary-button" id="open-municipal-export" ${history.length ? '' : 'disabled'}>${icon('download')}WOZ-ontwikkeling exporteren</button></div>${history.length ? `<div class="municipal-history-table"><div class="municipal-history-row head"><span>Complex / unit</span><span>Aanslagjaar</span><span>Waardepeildatum</span><span>Werkelijke WOZ</span><span>Ontwikkeling</span></div>${rows}</div>` : `<div class="municipal-history-empty">${icon('archive')}<div><strong>Nog geen WOZ-historie beschikbaar</strong><span>Na de eerste bevestigde jaarset ontstaat hier de historie. Vanaf het tweede aanslagjaar toont de module automatisch het verschil in euro's en procenten en kan de reeks worden geëxporteerd.</span></div></div>`}`;
}

function municipalExportModalMarkup() {
  if (!municipalExportOpen) return '';
  const allRows = municipalHistoryRows();
  const rows = municipalFilteredExportRows();
  const complexes = [...new Set(allRows.map(row => row.complex))].sort((a, b) => a.localeCompare(b, 'nl'));
  const preview = rows.slice(0, 5).map(row => `<div class="municipal-export-row"><span><strong>${row.complex}</strong><small>${row.unit === 'Geheel complex' ? 'Geheel complex' : `Unit ${row.unit}`}</small></span><span>${row.assessmentYear}</span><strong class="numeric">${money(row.actualWoz)}</strong><span class="numeric">${row.changePct === null ? 'Eerste meting' : `${row.changePct >= 0 ? '+' : ''}${formatPercentage(row.changePct * 100)}`}</span></div>`).join('');
  return `<div class="overlay open" id="municipal-export-overlay"><section class="municipal-export-dialog" role="dialog" aria-modal="true" aria-labelledby="municipal-export-title">
    <div class="municipal-export-title"><span>${icon('file-spreadsheet')}</span><div><h2 id="municipal-export-title">WOZ-ontwikkeling exporteren</h2><p>Maak een tijdreeks per complex of unit, inclusief de mutatie ten opzichte van het vorige beschikbare aanslagjaar.</p></div><button class="icon-button" id="close-municipal-export" aria-label="Sluiten">${icon('x')}</button></div>
    <div class="municipal-export-filters"><label><span>Complex</span><select id="municipal-export-complex"><option value="all">Alle complexen</option>${complexes.map(complex => `<option value="${complex}" ${municipalExportComplex === complex ? 'selected' : ''}>${complex}</option>`).join('')}</select></label><label><span>Periode</span><select id="municipal-export-years"><option value="all" ${municipalExportYears === 'all' ? 'selected' : ''}>Alle aanslagjaren</option><option value="last3" ${municipalExportYears === 'last3' ? 'selected' : ''}>Laatste 3 aanslagjaren</option></select></label><div><span>Bestandsindeling</span><strong>CSV voor Excel</strong><small>Met Nederlandse kolomnamen en scheidingsteken</small></div></div>
    <div class="municipal-export-includes">${icon('list-checks')}<div><strong>Vaste exportkolommen</strong><span>Complex, unit/geheel complex, aanslagjaar, waardepeildatum, werkelijke WOZ, vorige WOZ, mutatie €, mutatie %.</span></div></div>
    <div class="municipal-export-preview"><div class="municipal-export-preview-head"><strong>Voorbeeld</strong><span>${rows.length} ${rows.length === 1 ? 'regel' : 'regels'} in export</span></div><div class="municipal-export-table"><div class="municipal-export-row head"><span>Complex / unit</span><span>Jaar</span><span>Werkelijke WOZ</span><span>Mutatie</span></div>${preview || '<div class="municipal-export-no-rows">Geen regels binnen deze selectie.</div>'}</div>${rows.length > 5 ? `<small class="municipal-export-more">+ ${rows.length - 5} aanvullende regels in het bestand</small>` : ''}</div>
    <div class="municipal-export-actions"><button class="button secondary" id="cancel-municipal-export">Annuleren</button><button class="button primary" id="download-municipal-export" ${rows.length ? '' : 'disabled'}>${icon('download')}CSV downloaden</button></div>
  </section></div>`;
}

function downloadMunicipalExport() {
  const rows = municipalFilteredExportRows();
  if (!rows.length) return;
  const headers = ['Complex', 'Unit / geheel complex', 'Aanslagjaar', 'Waardepeildatum', 'Werkelijke WOZ', 'Vorige WOZ', 'Mutatie euro', 'Mutatie procent'];
  const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [headers, ...rows.map(row => [row.complex, row.unit, row.assessmentYear, row.valueDate, row.actualWoz, row.previousWoz, row.changeAmount, row.changePct === null ? '' : (row.changePct * 100).toFixed(2).replace('.', ',')])];
  const blob = new Blob([`\uFEFF${lines.map(line => line.map(csvCell).join(';')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'WOZ-ontwikkeling-Rooise-Zoom.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  municipalExportOpen = false;
  render();
  toast('WOZ-ontwikkeling is geëxporteerd voor Excel.');
}

function municipalDetailMarkup(item) {
  const tabs = [['budget2027', 'Begroting 2027'], ['estimated2026', 'Estimated 2026'], ['history', 'WOZ-historie']]
    .map(([id, label]) => `<button class="detail-tab ${municipalView === id ? 'active' : ''}" role="tab" aria-selected="${municipalView === id}" data-municipal-view="${id}">${label}</button>`).join('');
  const overrideCount = municipalWozObjects.filter(row => row.expectedOverride !== null).length;
  return `<div class="detail-panel municipal-detail ${openId === item.id ? 'open' : ''}" id="detail-${item.id}"><div class="detail-panel-inner">
    <div class="rent-detail-top"><div><div class="detail-title">Specificatie gemeentelijke lasten en WOZ</div><p>Bereken één totaalbedrag vanuit handmatig ingevoerde WOZ-waarden per complex of unit en twee onafhankelijke aannames.</p></div><div class="detail-actions"><button class="secondary-button review-module" data-id="${item.id}" ${isFinalized ? 'disabled' : ''}>${icon('square-check-big')}Onderdeel beoordelen</button></div></div>
    <div class="source-summary municipal-source"><div>${icon('landmark')}<span><strong>WOZ handmatig · lasten uit administratie</strong> · laatst bijgewerkt 8 september 2026</span></div><span>${municipalWozObjects.length} WOZ-waarden</span><span>${overrideCount} handmatige aanpassing</span><span>GL 4700 + 4710</span></div>
    <div class="rent-summary planned-summary"><div class="rent-metric"><span>Begroting 2026</span><strong>${money(item.previousBudget)}</strong><small>Alleen ter referentie</small></div><div class="rent-metric"><span>Realisatie 2026</span><strong>${money(item.actuals)}</strong><small>T/m afgesloten periode 8</small></div><div class="rent-metric"><span>Estimated 2026</span><strong>${money(item.estimated)}</strong><small>Geen aanvullende aanslag verwacht</small></div><div class="rent-metric total"><span>Jouw begroting 2027</span><strong>${displayMoney(item.budget, 'Nog niet berekenbaar')}</strong><small>${item.budget === null ? 'Vul eerst WOZ per complex of unit in' : 'Afgeleid uit WOZ-specificatie'}</small></div></div>
    <div class="rent-toolbar"><div class="detail-tabs" role="tablist" aria-label="Gemeentelijke lasten en WOZ">${tabs}</div><span class="rent-hint">OZB, watersysteem- en rioolheffing samen als één P&amp;L-totaal</span></div>
    ${municipalView === 'budget2027' ? municipalBudgetMarkup() : municipalView === 'estimated2026' ? municipalEstimatedMarkup(item) : municipalHistoryMarkup()}
  </div></div>`;
}

function canonRowBudget(row) {
  if (row.annualCanon === null || row.annualCanon === undefined) return null;
  if (Number(row.annualCanon) === 0) return 0;
  if (row.indexPct === null || row.indexPct === undefined) return null;
  return Number(row.annualCanon) * (1 + Number(row.indexPct) / 100);
}

const canonHasCritical = () => canonRows.some(row => row.annualCanon === null || row.annualCanon === undefined || (Number(row.annualCanon) !== 0 && (row.indexPct === null || row.indexPct === undefined)) || !row.glAccount);

function recalculateCanon(markPending = false) {
  const item = modules.find(row => row.id === 'canon');
  const total = canonHasCritical() ? null : canonRows.reduce((sum, row) => sum + Number(canonRowBudget(row) || 0), 0);
  item.proposal = total;
  item.budget = total;
  if (markPending) item.status = total === null ? 'missing' : 'pending';
}

function canonDetailMarkup(item) {
  const rows = canonRows.map(row => {
    const budget = canonRowBudget(row);
    const needsIndex = row.annualCanon !== null && Number(row.annualCanon) !== 0 && row.indexPct === null;
    return `<div class="canon-row ${row.annualCanon === null || needsIndex ? 'has-critical' : ''}">
      <span><strong>${row.complex}</strong><small>${grootboekLabel(row.glAccount)} · OGB niet nodig</small></span>
      <label class="canon-money"><span>€</span><input data-canon-field="annualCanon" data-canon-complex="${row.complexId}" inputmode="numeric" value="${row.annualCanon === null ? '' : eur.format(row.annualCanon)}" placeholder="Niet ingevuld" ${isFinalized ? 'disabled' : ''}></label>
      <label class="canon-index"><input data-canon-field="indexPct" data-canon-complex="${row.complexId}" inputmode="decimal" value="${row.indexPct === null ? '' : String(row.indexPct).replace('.', ',')}" placeholder="${row.annualCanon === null ? 'Eerst jaarcanon' : Number(row.annualCanon) === 0 ? 'Niet nodig' : '0,0'}" ${isFinalized || row.annualCanon === null || Number(row.annualCanon) === 0 ? 'disabled' : ''}><span>%</span></label>
      <span class="numeric"><strong>${budget === null ? '<span class="empty-amount">Nog niet berekenbaar</span>' : money(budget)}</strong><small>${row.annualCanon === null ? 'Vul jaarcanon in' : Number(row.annualCanon) === 0 ? 'Bewust geen erfpacht' : row.indexPct === null ? 'Vul indexering in' : `${formatPercentage(row.indexPct)} indexering`}</small></span>
    </div>`;
  }).join('');
  const enteredCount = canonRows.filter(row => row.annualCanon !== null).length;
  return `<div class="detail-panel canon-detail ${openId === item.id ? 'open' : ''}" id="detail-${item.id}"><div class="detail-panel-inner">
    <div class="rent-detail-top"><div><div class="detail-title">Specificatie canon erfpacht</div><p>Vul per complex één jaarbedrag en het indexatiepercentage in. Het begrote bedrag wordt automatisch berekend.</p></div><div class="detail-actions"><button class="secondary-button review-module" data-id="${item.id}" ${isFinalized ? 'disabled' : ''}>${icon('square-check-big')}Onderdeel beoordelen</button></div></div>
    <div class="source-summary canon-source"><div>${icon('land-plot')}<span><strong>Handmatige invoer per complex</strong> · geen automatische contractbron</span></div><span>${enteredCount} van ${canonRows.length} ingevuld</span><span>GL 4720 verplicht</span><span>OGB optioneel</span></div>
    <div class="rent-summary planned-summary"><div class="rent-metric"><span>Begroting 2026</span><strong>${money(item.previousBudget)}</strong><small>Alleen ter referentie</small></div><div class="rent-metric"><span>Realisatie 2026</span><strong>${money(item.actuals)}</strong><small>T/m afgesloten periode 8</small></div><div class="rent-metric"><span>Estimated 2026</span><strong>${money(item.estimated)}</strong><small>Geen canon geboekt</small></div><div class="rent-metric total"><span>Jouw begroting 2027</span><strong>${displayMoney(item.budget, 'Nog niet berekenbaar')}</strong><small>${item.budget === null ? 'Maak ieder complex compleet' : 'Som van de complexregels'}</small></div></div>
    <div class="planned-table-heading"><div><strong>Canon per complex</strong><span>Een bedrag van €0 legt bewust vast dat voor het complex geen erfpacht wordt begroot; indexering is dan niet nodig.</span></div><span>Volledig jaar · exclusief btw</span></div>
    <div class="canon-table"><div class="canon-row head"><span>Complex</span><span>Jaarcanon</span><span>Indexering</span><span>Begroot 2027</span></div>${rows}<div class="canon-row footer"><strong>Totaal canon erfpacht</strong><span></span><span></span><strong class="numeric">${displayMoney(item.budget, 'Nog niet berekenbaar')}</strong></div></div>
    <div class="planned-reference-note compact canon-note">${icon('calculator')}<div><strong>Eenvoudige berekening per complex</strong><span>Jaarcanon × (1 + indexering). Er is geen maandverdeling, looptijd of aanvullende specificatie nodig.</span></div></div>
  </div></div>`;
}

function detailMarkup(item) {
  if (item.id === 'rent') return rentDetailMarkup(item);
  if (item.id === 'beheer') return beheerDetailMarkup(item);
  if (item.id === 'management') return managementDetailMarkup(item);
  if (item.planned) return plannedDetailMarkup(item);
  if (item.corrective) return correctiveDetailMarkup(item);
  if (item.insurance) return insuranceDetailMarkup(item);
  if (item.municipal) return municipalDetailMarkup(item);
  if (item.canon) return canonDetailMarkup(item);
  return `<div class="detail-panel ${openId === item.id ? 'open' : ''}" id="detail-${item.id}"><div class="detail-panel-inner simple-detail"><p>${item.note}</p><button class="secondary-button review-module" data-id="${item.id}" ${isFinalized ? 'disabled' : ''}>${icon('square-check-big')}Als beoordeeld markeren</button></div></div>`;
}

function rowMarkup(item) {
  const opened = openId === item.id;
  const manualDetail = item.id === 'planned' || item.id === 'corrective' || item.id === 'canon';
  const specificationDetail = manualDetail || item.id === 'insurance' || item.id === 'municipal';
  const amountInputDisabled = isFinalized || specificationDetail || (item.id === 'management' && item.proposal === null && item.status !== 'zero');
  const budgetValue = item.budget === null || item.budget === undefined ? '' : eur.format(item.budget);
  const proposalValue = manualDetail ? '<span class="manual-proposal">Handmatig opgebouwd</span>' : displayMoney(item.proposal, 'Niet ingevuld');
  const budgetCell = specificationDetail
    ? `<div class="budget-derived"><strong>${displayMoney(item.budget, 'Niet ingevuld')}</strong><small>${item.id === 'municipal' && item.budget === null ? 'WOZ invoeren' : 'Uit specificatie'}</small></div>`
    : `<div class="budget-input-wrap ${budgetValue === '' ? 'is-empty' : ''}"><span>€</span><input class="budget-input" inputmode="numeric" aria-label="Jouw begroting voor ${item.name}" data-id="${item.id}" value="${budgetValue}" placeholder="Niet ingevuld" ${amountInputDisabled ? 'disabled' : ''}></div>`;
  return `<div class="module-block" data-module="${item.id}">
    <div class="budget-row ${opened ? 'is-open' : ''}">
      <div class="row-title"><button class="expand-btn" data-id="${item.id}" aria-expanded="${opened}" aria-controls="detail-${item.id}" aria-label="Details ${item.name}">${icon('chevron-right')}</button><div><div class="name">${item.name}</div><div class="description">${item.description}</div><div class="row-source">${item.source} · bijgewerkt ${item.date}</div></div></div>
      <div class="historical">${displayMoney(item.previousBudget)}</div>
      <div class="historical actuals">${displayMoney(item.actuals)}</div>
      <div class="historical estimated">${displayMoney(item.estimated)}</div>
      <div class="proposal">${proposalValue}</div>
      ${budgetCell}
      ${statusMarkup(item.status)}
      <div class="row-menu">${isFinalized ? icon('lock-keyhole') : `<button class="more-btn" data-id="${item.id}" aria-label="Meer acties voor ${item.name}" aria-expanded="false">${icon('ellipsis-vertical')}</button><div class="popover" data-menu="${item.id}"><button data-action="proposal" data-id="${item.id}">${specificationDetail ? 'Specificatie openen' : 'Voorstel overnemen'}</button><button data-action="zero" data-id="${item.id}">Bewust €0 begroten</button>${['corrective', 'insurance'].includes(item.id) ? '' : `<button data-action="note" data-id="${item.id}">Opmerking toevoegen</button>`}${['management', 'canon'].includes(item.id) ? `<button class="hide-action" data-action="hide" data-id="${item.id}">${icon('eye-off')}Verbergen</button>` : ''}</div>`}</div>
    </div>
    ${detailMarkup(item)}
  </div>`;
}

function managementSubtotalMarkup() {
  const beheer = modules.find(item => item.id === 'beheer');
  const management = modules.find(item => item.id === 'management');
  const subtotal = key => management.hidden ? beheer[key] : management[key] === null || management[key] === undefined ? null : beheer[key] + management[key];
  const note = management.hidden ? 'Managementvergoeding verborgen · subtotaal is gelijk aan beheersvergoeding' : management.budget === null ? 'Managementvergoeding nog niet ingevuld' : 'Beheersvergoeding + managementvergoeding';
  return `<div class="management-subtotal ${management.hidden ? 'has-hidden-module' : ''}"><span><strong>Subtotaal Management en beheer</strong><small>${note}</small></span><span>${displayMoney(subtotal('previousBudget'), 'Onvolledig')}</span><span>${displayMoney(subtotal('actuals'), 'Onvolledig')}</span><span>${displayMoney(subtotal('estimated'), 'Onvolledig')}</span><span>${displayMoney(subtotal('proposal'), 'Onvolledig')}</span><span>${displayMoney(subtotal('budget'), 'Onvolledig')}</span><span></span><span></span></div>`;
}

function reviewPageMarkup() {
  const includedModules = activeModules();
  const hiddenCount = modules.length - includedModules.length;
  const reviewed = includedModules.filter(m => isReviewed(m.status)).length;
  const remaining = includedModules.length - reviewed;
  const management = modules.find(m => m.id === 'management');
  const managementMissing = !management.hidden && management.status === 'missing';
  const attentionCount = 2 + (managementMissing ? 1 : 0);
  const estimatedCosts = includedModules.filter(m => m.id !== 'rent').reduce((sum, m) => sum + Number(m.estimated || 0), 0);
  const rent = modules.find(m => m.id === 'rent');
  const budgetResult = rent.budget - totalCosts();
  const estimatedResult = rent.estimated - estimatedCosts;
  const percentage = Math.round((reviewed / includedModules.length) * 100);
  const rows = includedModules.map(item => `<button class="review-page-row" data-open-module="${item.id}">
    <span><strong>${item.name}</strong><small>${item.source}</small></span>
    <span class="numeric">${displayMoney(item.previousBudget)}</span>
    <span class="numeric">${displayMoney(item.actuals)}</span>
    <span class="numeric">${displayMoney(item.estimated)}</span>
    <span class="numeric">${displayMoney(item.budget, 'Niet ingevuld')}</span>
    <span class="numeric review-delta ${item.budget !== null && item.estimated !== null && item.budget - item.estimated < 0 ? 'negative' : item.budget !== null && item.estimated !== null && item.budget - item.estimated > 0 ? 'positive' : ''}">${item.budget === null || item.estimated === null ? '<span class="empty-amount">Niet vergelijkbaar</span>' : signedMoney(item.budget - item.estimated)}</span>
    ${statusMarkup(item.status)}${icon('chevron-right')}
  </button>`).join('');
  return `<main class="main review-main">
    <button class="back-link" id="back-to-budget">${icon('arrow-left')}Terug naar begroting</button>
    <section class="page-heading review-heading"><div><div class="title-line"><h1>Controle begroting 2027 – Rooise Zoom</h1><span class="concept ${isFinalized ? 'final' : ''}">${isFinalized ? 'Vastgesteld' : 'Concept'}</span></div><p class="subtitle">${isFinalized ? 'Definitieve begroting, inclusief de gehanteerde uitgangspunten en aandachtspunten.' : 'Controleer de totalen, afwijkingen en aandachtspunten voordat je de begroting vaststelt.'}</p></div><div class="progress-card"><div class="progress-copy"><span>${reviewed} van ${includedModules.length} onderdelen beoordeeld</span><strong>${percentage}%</strong></div><div class="progress-track"><div class="progress-bar" style="width:${percentage}%"></div></div></div></section>
    ${isFinalized ? `<div class="finalized-banner">${icon('badge-check')}<div><strong>Begroting vastgesteld</strong><span>Vastgesteld op 8 september 2026${finalNote ? ` · ${finalNote}` : ''}</span></div></div>` : ''}
    <section class="review-metrics" aria-label="Samenvatting begroting">
      <div><span>Exploitatieresultaat</span><strong>${money(estimatedResult)}</strong><small>Estimated 2026${!management.hidden && management.estimated === null ? ' · excl. managementvergoeding' : ''}</small></div>
      <div><span>Operationele kosten</span><strong>${money(totalCosts())}</strong><small>Begroting 2027</small></div>
      <div class="result"><span>Exploitatieresultaat</span><strong>${money(budgetResult)}</strong><small>Begroting 2027</small></div>
      <div><span>Verschil t.o.v. Estimated 2026</span><strong class="${budgetResult - estimatedResult >= 0 ? 'positive' : 'negative'}">${signedMoney(budgetResult - estimatedResult)}</strong><small>Effect op exploitatieresultaat</small></div>
    </section>
    <section class="review-page-layout">
      <div class="review-modules-card">
        <div class="review-card-heading"><div><h2>Begrotingsonderdelen</h2><p>Klik op een onderdeel om de invoer en onderbouwing terug te kijken.</p></div><span>${reviewed}/${includedModules.length} beoordeeld</span></div>
        ${hiddenCount ? `<div class="review-hidden-note">${icon('eye-off')}<span><strong>${hiddenCount} verborgen ${hiddenCount === 1 ? 'onderdeel' : 'onderdelen'}</strong><small>Niet van toepassing voor deze administratie en daarom uitgesloten van controle en totalen.</small></span></div>` : ''}
        <div class="review-page-table"><div class="review-page-head"><span>Onderdeel</span><span>Begroting 2026</span><span>Realisatie 2026</span><span>Estimated 2026</span><span>Begroting 2027</span><span>Verschil vs. estimated</span><span>Beoordeling</span><span></span></div>${rows}</div>
      </div>
      <aside class="final-check-card">
        <div class="review-card-heading"><div><h2>Eindcontrole</h2><p>Wat nog nodig is voor vaststelling.</p></div></div>
        <div class="check-list">
          <div class="check-item ${remaining ? 'pending' : 'complete'}">${icon(remaining ? 'clock-3' : 'circle-check-big')}<div><strong>${remaining ? `${remaining} ${remaining === 1 ? 'onderdeel' : 'onderdelen'} nog beoordelen` : 'Alle onderdelen beoordeeld'}</strong><span>${remaining ? 'Open het onderdeel en bevestig dat je het hebt bekeken.' : 'Alle invoer is bewust gecontroleerd.'}</span></div></div>
          <div class="check-item complete">${icon('circle-check-big')}<div><strong>Huurverdeling sluit aan</strong><span>Geen onverdeeld bedrag over de complexen.</span></div></div>
          <div class="check-item attention">${icon('triangle-alert')}<div><strong>${attentionCount} aandachtspunten zichtbaar</strong><span>${managementMissing ? 'De ontbrekende managementinvoer moet nog bewust worden afgehandeld.' : 'Deze blokkeren de vaststelling niet.'}</span></div></div>
        </div>
        <div class="attention-list"><strong>Aandachtspunten</strong><ul>${managementMissing ? '<li>Managementvergoeding is nog niet ingevuld.</li>' : ''}<li>2 huurcontracten lopen af in 2027.</li><li>Voor één geplande onderhoudsactiviteit wordt de offerte in oktober verwacht.</li></ul></div>
        <label class="final-note"><span>Toelichting bij vaststelling <small>optioneel</small></span><textarea id="final-note" rows="3" placeholder="Bijvoorbeeld: akkoord na bespreking met eigenaar" ${isFinalized ? 'disabled' : ''}>${finalNote}</textarea></label>
      </aside>
    </section>
  </main>`;
}

function finalizationModalMarkup() {
  if (!finalizeModalOpen) return '';
  return `<div class="overlay open" id="finalize-overlay"><section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <div class="confirm-icon">${icon('stamp')}</div><h2 id="confirm-title">Begroting definitief vaststellen?</h2><p>Hiermee leg je Begroting 2027 – Rooise Zoom vast. Bedragen zijn daarna alleen via een nieuwe versie te wijzigen.</p>
    <div class="confirm-total"><span>Begroot exploitatieresultaat</span><strong>${money(modules.find(m => m.id === 'rent').budget - totalCosts())}</strong></div>
    <div class="confirm-actions"><button class="button secondary" id="cancel-finalize">Nog even controleren</button><button class="button primary" id="confirm-finalize">Definitief vaststellen ${icon('check')}</button></div>
  </section></div>`;
}

function totalCosts() {
  return activeModules().filter(m => m.id !== 'rent').reduce((sum, m) => sum + Number(m.budget || 0), 0);
}

function render() {
  const includedModules = activeModules();
  const reviewed = includedModules.filter(m => isReviewed(m.status)).length;
  const percentage = Math.round((reviewed / includedModules.length) * 100);
  const query = search.trim().toLowerCase();
  const visible = includedModules.filter(m => [m.name, m.description, m.source].join(' ').toLowerCase().includes(query));
  const managementHidden = modules.find(item => item.id === 'management').hidden;
  const visibleRows = visible.map(item => `${rowMarkup(item)}${item.id === 'management' || (item.id === 'beheer' && managementHidden) ? managementSubtotalMarkup() : ''}`).join('');
  const includedCosts = includedModules.filter(m => m.id !== 'rent');
  const missingCostCount = includedCosts.filter(m => m.budget === null).length;
  const budgetPage = `<main class="main">
        <section class="page-heading"><div><div class="title-line"><h1>Begroting 2027 – Rooise Zoom</h1><span class="concept ${isFinalized ? 'final' : ''}">${isFinalized ? 'Vastgesteld' : 'Concept'}</span></div><p class="subtitle">${isFinalized ? 'Vastgestelde begroting voor boekjaar 2027. Bedragen zijn alleen-lezen.' : 'Conceptbegroting voor boekjaar 2027. Controleer en completeer alle onderdelen voor definitieve goedkeuring.'}</p></div><div class="progress-card"><div class="progress-copy"><span><span id="reviewed-count">${reviewed}</span> van ${includedModules.length} onderdelen beoordeeld</span><strong id="reviewed-percentage">${percentage}%</strong></div><div class="progress-track"><div class="progress-bar" style="width:${percentage}%"></div></div></div></section>
        <section class="budget-card" aria-label="Begrotingsonderdelen">
          ${budgetToolsMarkup()}
          <div class="table-head"><span>Onderdeel</span><span class="right">Begroting 2026</span><span class="right"><span>Realisatie 2026</span><small>t/m periode 8</small></span><span class="right">Estimated 2026</span><span class="right">Voorstel 2027</span><span>Jouw begroting 2027</span><span>Beoordeling</span><span></span></div>
          <div id="rows">${visibleRows}</div>
          <div class="empty-search" style="display:${visible.length ? 'none' : 'block'}">Geen begrotingsonderdelen gevonden.</div>
          <div class="total-row ${missingCostCount ? 'is-incomplete' : ''}"><span>Totaal operationele kosten <small>${missingCostCount ? `${missingCostCount} post nog niet ingevuld` : 'excl. huuropbrengsten'}</small></span><span>${money(includedCosts.reduce((s,m)=>s+Number(m.previousBudget || 0),0))}</span><span>${money(includedCosts.reduce((s,m)=>s+Number(m.actuals || 0),0))}</span><span>${money(includedCosts.reduce((s,m)=>s+Number(m.estimated || 0),0))}</span><span>${money(includedCosts.reduce((s,m)=>s+Number(m.proposal || 0),0))}</span><span>${money(totalCosts())}</span><span></span><span></span></div>
        </section>
      </main>`;
  const footer = currentPage === 'budget'
    ? `<footer class="bottom-bar"><div class="save-state">${icon('circle-check-big')}<span>${isFinalized ? 'Vastgesteld op 8 september 2026' : `Laatst opgeslagen: ${savedAt}`}</span></div><div class="actions">${isFinalized ? '' : '<button class="button secondary" id="save-close">Opslaan en sluiten</button>'}<button class="button primary" id="to-review">${isFinalized ? 'Terug naar controle' : 'Naar controle'} ${icon('chevron-right')}</button></div></footer>`
    : `<footer class="bottom-bar review-bottom"><div class="save-state">${icon(isFinalized ? 'badge-check' : 'shield-check')}<span>${isFinalized ? 'Definitief vastgesteld' : remainingForFooter(reviewed)}</span></div><div class="actions"><button class="button secondary" id="back-to-budget-footer">${isFinalized ? 'Begroting terugkijken' : 'Terug naar begroting'}</button>${isFinalized ? '<button class="button primary" id="new-version">Nieuwe versie maken</button>' : (reviewed < includedModules.length ? `<button class="button primary" id="first-open-page">Open eerste openstaande ${icon('arrow-right')}</button>` : `<button class="button primary" id="open-finalize">Begroting vaststellen ${icon('check')}</button>`)}</div></footer>`;
  document.querySelector('#app').innerHTML = `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">${icon('building-2')}</div><div><div class="brand-title">VastgoedPro</div><div class="brand-subtitle">Property &amp; Asset Management</div></div></div>
      <nav class="nav" aria-label="Hoofdnavigatie">
        <button class="nav-item">${icon('house')}Dashboard</button><button class="nav-item">${icon('chart-no-axes-column-increasing')}Rapportages</button><button class="nav-item active">${icon('file-text')}Begroting</button><button class="nav-item">${icon('wrench')}Onderhoud</button><button class="nav-item">${icon('circle-check')}Controles</button>
      </nav>
      <button class="collapse">${icon('chevron-left')}Terugvouwen</button>
    </aside>
    <div class="workspace">
      <header class="topbar"><select class="portfolio-select" aria-label="Selecteer complex"><option>Rooise Zoom</option><option>Parkstaete</option><option>De Linie</option></select><div class="search-wrap">${icon('search')}<input class="search" id="search" placeholder="Zoeken naar complex, onderdeel of referentie…" value="${search}"></div><div class="user-tools"><button class="icon-button" aria-label="Help">${icon('circle-help')}</button><span class="divider"></span><div class="avatar">EV</div><div class="user-copy"><div class="user-name">Eva van Dijk</div><div class="user-role">Property manager</div></div>${icon('chevron-down')}</div></header>
      ${currentPage === 'budget' ? budgetPage : reviewPageMarkup()}
      ${footer}
    </div>
    ${finalizationModalMarkup()}
    ${municipalExportModalMarkup()}
    <div class="toast" id="toast" role="status"></div>
  </div>`;
  window.lucide?.createIcons();
  bindEvents();
}

function remainingForFooter(reviewed) {
  const remaining = activeModules().length - reviewed;
  return remaining ? `${remaining} ${remaining === 1 ? 'onderdeel staat' : 'onderdelen staan'} nog open` : 'Klaar om vast te stellen';
}

function bindEvents() {
  document.querySelector('[data-ogb-toggle]')?.addEventListener('click', event => {
    event.stopPropagation();
    ogbPanelOpen = !ogbPanelOpen;
    hiddenPanelOpen = false;
    render();
  });
  document.querySelector('[data-hidden-toggle]')?.addEventListener('click', event => {
    event.stopPropagation();
    hiddenPanelOpen = !hiddenPanelOpen;
    ogbPanelOpen = false;
    render();
  });
  document.querySelector('[data-ogb-close]')?.addEventListener('click', () => { ogbPanelOpen = false; render(); });
  document.querySelector('[data-hidden-close]')?.addEventListener('click', () => { hiddenPanelOpen = false; render(); });
  document.querySelectorAll('[data-restore-module]').forEach(button => button.addEventListener('click', () => {
    const item = modules.find(module => module.id === button.dataset.restoreModule);
    item.hidden = false;
    hiddenPanelOpen = false;
    openId = item.id;
    render();
    document.querySelector(`[data-module="${item.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast(`${item.name} is weer zichtbaar en telt opnieuw mee.`);
  }));
  document.querySelectorAll('.expand-btn').forEach(button => button.addEventListener('click', () => {
    openId = openId === button.dataset.id ? null : button.dataset.id;
    render();
    if (openId) document.querySelector(`[data-module="${openId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }));
  document.querySelectorAll('.budget-input').forEach(input => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('blur', () => {
      const item = modules.find(m => m.id === input.dataset.id);
      const parsed = Number(input.value.replace(/[^0-9-]/g, ''));
      if (parsed === item.budget) return;
      if (item.id === 'management' && !managementConfig.mode && parsed !== 0) {
        openId = 'management';
        render();
        toast('Kies eerst hoe de managementvergoeding wordt opgebouwd.');
        return;
      }
      item.budget = Number.isFinite(parsed) ? parsed : 0;
      if (item.id === 'rent') {
        rentUnallocated = item.budget - rentSpecTotal('budget');
        recalculateBeheerProposal(true);
      }
      item.status = 'pending';
      openId = item.id;
      render();
      toast(`${item.name} is gewijzigd en moet opnieuw beoordeeld worden.`);
    });
  });
  document.querySelectorAll('.review-module').forEach(button => button.addEventListener('click', () => {
    const item = modules.find(m => m.id === button.dataset.id);
    if (item.id === 'rent' && rentUnallocated !== 0) {
      toast('Verdeel eerst het verschil over de complexen.');
      return;
    }
    if (item.id === 'management' && item.budget === null) {
      toast('Kies eerst een invoerwijze of bevestig bewust €0.');
      return;
    }
    if (item.id === 'planned' && plannedActivities.some(plannedHasCritical)) {
      toast('Vul eerst alle verplichte velden en grootboekrekeningen van de onderhoudsactiviteiten in.');
      return;
    }
    if (item.id === 'corrective' && correctiveRows.some(correctiveHasCritical)) {
      toast('Vul eerst de ontbrekende omschrijvingen, grootboekrekeningen en jaarbedragen in.');
      return;
    }
    if (item.id === 'insurance' && insurancePolicies.some(insuranceHasCritical)) {
      toast('Maak eerst alle verplichte polisvelden en grootboekrekeningen compleet.');
      return;
    }
    if (item.id === 'municipal' && municipalHasCritical()) {
      toast('Maak eerst de WOZ-objecten en de grootboekverdeling compleet.');
      return;
    }
    if (item.id === 'canon' && canonHasCritical()) {
      toast('Vul per complex de jaarcanon in en, zodra het bedrag niet €0 is, ook de indexering.');
      return;
    }
    const plannedWarning = item.id === 'planned' && plannedActivities.some(activity => ['q1', 'q2', 'q3', 'q4'].some(key => Number(activity[key]) < 0));
    const correctiveWarning = item.id === 'corrective' && correctiveRows.some(correctiveHasWarning);
    const insuranceWarning = item.id === 'insurance' && insurancePolicies.some(insuranceHasWarning);
    const reviewedZero = item.id === 'corrective'
      ? correctiveRows.length === 0 || correctiveRows.every(row => Number(row.amount || 0) === 0)
      : item.id === 'insurance'
        ? insurancePolicies.length === 0 || insuranceBudgetTotal() === 0
      : item.budget === 0;
    item.status = plannedWarning || correctiveWarning || insuranceWarning ? 'attention' : reviewedZero ? 'zero' : 'ready';
    render();
    toast(plannedWarning || correctiveWarning || insuranceWarning ? `${item.name} is beoordeeld met een waarschuwing.` : `${item.name} is beoordeeld.`);
  }));
  document.querySelectorAll('.more-btn').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const menu = document.querySelector(`[data-menu="${button.dataset.id}"]`);
    const wasOpen = menu.classList.contains('open');
    document.querySelectorAll('.popover').forEach(p => p.classList.remove('open'));
    if (!wasOpen) menu.classList.add('open');
    button.setAttribute('aria-expanded', String(!wasOpen));
  }));
  document.querySelectorAll('.popover button').forEach(button => button.addEventListener('click', () => {
    const item = modules.find(m => m.id === button.dataset.id);
    if (button.dataset.action === 'hide') {
      item.hidden = true;
      openId = null;
      hiddenPanelOpen = true;
      ogbPanelOpen = false;
      render();
      toast(`${item.name} is verborgen voor deze administratie. De regel blijft herstelbaar.`);
      return;
    }
    if (button.dataset.action === 'proposal') {
      if (item.id === 'planned') { openId = 'planned'; plannedView = 'budget2027'; render(); toast('Deze post wordt bewust per activiteit opgebouwd.'); return; }
      if (item.id === 'corrective') { openId = 'corrective'; correctiveView = 'budget2027'; render(); toast('Deze post wordt bewust met jaarbedragen onderbouwd.'); return; }
      if (item.id === 'insurance') { openId = 'insurance'; insuranceView = 'budget2027'; render(); toast('Deze post wordt per polis berekend.'); return; }
      if (item.id === 'municipal') { openId = 'municipal'; municipalView = 'budget2027'; render(); toast('Deze post wordt vanuit WOZ-objecten en twee aannames berekend.'); return; }
      if (item.id === 'canon') { openId = 'canon'; render(); toast('Deze post wordt per complex met één jaarcanon en indexering opgebouwd.'); return; }
      if (item.proposal === null) { openId = item.id; render(); toast('Stel eerst de managementvergoeding samen.'); return; }
      item.budget = item.proposal;
      if (item.id === 'rent') { rentComplexes.forEach(row => row.budget = row.proposal); rentUnallocated = 0; }
      item.status = 'pending'; openId = item.id; render(); toast('Voorstel overgenomen. Beoordeel het onderdeel nog even.');
    }
    if (button.dataset.action === 'zero') {
      if (item.id === 'planned') plannedActivities.forEach(activity => { activity.q1 = 0; activity.q2 = 0; activity.q3 = 0; activity.q4 = 0; });
      if (item.id === 'corrective') correctiveRows.forEach(row => { row.amount = 0; });
      if (item.id === 'insurance') insurancePolicies.forEach(policy => { policy.manualOverride = 0; });
      if (item.id === 'municipal') municipalBudgetOverride = 0;
      if (item.id === 'canon') canonRows.forEach(row => { row.annualCanon = 0; row.indexPct = null; });
      item.budget = 0;
      if (item.id === 'canon') item.proposal = 0;
      item.status = 'zero';
      if (item.id === 'management' || item.id === 'planned' || item.id === 'corrective' || item.id === 'insurance' || item.id === 'municipal' || item.id === 'canon') openId = item.id;
      render();
      toast(`${item.name} is bewust op €0 gezet.`);
    }
    if (button.dataset.action === 'note') { openId = item.id; render(); toast('Toelichting geopend.'); }
  }));
  document.querySelectorAll('[data-rent-view]').forEach(button => button.addEventListener('click', () => { rentView = button.dataset.rentView; openId = 'rent'; render(); document.querySelector('#detail-rent')?.scrollIntoView({ block: 'center' }); }));
  document.querySelectorAll('.rent-budget-input').forEach(input => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('blur', () => {
      const row = rentComplexes.find(complex => complex.id === input.dataset.complexId);
      const parsed = Number(input.value.replace(/[^0-9-]/g, ''));
      if (parsed === row.budget) return;
      row.budget = Number.isFinite(parsed) ? parsed : 0;
      modules.find(item => item.id === 'rent').budget = rentSpecTotal('budget') + rentUnallocated;
      modules.find(item => item.id === 'rent').status = 'pending';
      recalculateBeheerProposal(true);
      openId = 'rent';
      render();
      toast(`${row.name} is gewijzigd. Beoordeel de huuropbrengsten opnieuw.`);
    });
  });
  document.querySelector('#overall-indexation')?.addEventListener('focus', event => event.target.select());
  document.querySelector('#overall-indexation')?.addEventListener('blur', event => {
      const input = event.target;
      const raw = input.value.trim().replace(',', '.');
      const parsed = Number(raw);
      if (raw === '' || !Number.isFinite(parsed) || parsed < 0 || parsed > 20) {
        toast('Vul een indexatiepercentage tussen 0% en 20% in.');
        input.value = String(overallIndexationPct).replace('.', ',');
        input.focus();
        return;
      }
      if (parsed === overallIndexationPct) return;
      overallIndexationPct = parsed;
      applyOverallIndexation();
      modules.find(row => row.id === 'rent').status = 'pending';
      openId = 'rent';
      render();
      toast(`Indexatie ${formatPercentage(parsed)} toegepast op alle contracten.`);
  });
  document.querySelectorAll('[data-contract-indexation-edit]').forEach(button => button.addEventListener('click', () => {
    editingContractUnit = button.dataset.contractIndexationEdit;
    rentView = 'contracts';
    openId = 'rent';
    render();
    document.querySelector(`[data-contract-indexation-input="${editingContractUnit}"]`)?.focus();
  }));
  document.querySelectorAll('[data-contract-indexation-reset]').forEach(button => button.addEventListener('click', () => {
    const contract = rentContracts.find(row => row.unit === button.dataset.contractIndexationReset);
    contract.overridePct = null;
    editingContractUnit = null;
    applyOverallIndexation();
    modules.find(row => row.id === 'rent').status = 'pending';
    render();
    toast(`${contract.tenant} volgt weer het algemene percentage.`);
  }));
  document.querySelectorAll('[data-contract-indexation-input]').forEach(input => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') event.target.blur();
      if (event.key === 'Escape') {
        editingContractUnit = null;
        render();
      }
    });
    input.addEventListener('blur', () => {
      const contract = rentContracts.find(row => row.unit === input.dataset.contractIndexationInput);
      const raw = input.value.trim().replace(',', '.');
      const parsed = Number(raw);
      if (raw === '' || !Number.isFinite(parsed) || parsed < 0 || parsed > 20) {
        toast('Vul een indexatiepercentage tussen 0% en 20% in.');
        input.focus();
        return;
      }
      contract.overridePct = parsed === overallIndexationPct ? null : parsed;
      editingContractUnit = null;
      applyOverallIndexation();
      modules.find(row => row.id === 'rent').status = 'pending';
      render();
      toast(contract.overridePct === null ? `${contract.tenant} volgt het algemene percentage.` : `${formatPercentage(parsed)} ingesteld als uitzondering voor ${contract.tenant}.`);
    });
  });
  document.querySelector('[data-rent-reset]')?.addEventListener('click', () => {
    rentComplexes.forEach(row => row.budget = row.proposal);
    rentUnallocated = 0;
    const rent = modules.find(item => item.id === 'rent');
    rent.budget = rent.proposal;
    rent.status = 'pending';
    recalculateBeheerProposal(true);
    render();
    toast('Het huurvoorstel is overgenomen. Beoordeel het onderdeel nog even.');
  });
  document.querySelector('[data-rent-distribute]')?.addEventListener('click', () => {
    const perComplex = Math.trunc(rentUnallocated / rentComplexes.length);
    let remainder = rentUnallocated - (perComplex * rentComplexes.length);
    rentComplexes.forEach((row, index) => { row.budget += perComplex + (index === rentComplexes.length - 1 ? remainder : 0); });
    rentUnallocated = 0;
    modules.find(item => item.id === 'rent').budget = rentSpecTotal('budget');
    recalculateBeheerProposal(true);
    render();
    toast('Het verschil is gelijkmatig over de complexen verdeeld.');
  });
  document.querySelectorAll('[data-beheer-edit]').forEach(button => button.addEventListener('click', () => {
    editingBeheerComplexId = editingBeheerComplexId === button.dataset.beheerEdit ? null : button.dataset.beheerEdit;
    openId = 'beheer';
    render();
    if (editingBeheerComplexId) document.querySelector(`[data-beheer-field="fixedAnnual"][data-complex-id="${editingBeheerComplexId}"]`)?.focus();
  }));
  document.querySelectorAll('[data-beheer-close]').forEach(button => button.addEventListener('click', () => {
    editingBeheerComplexId = null;
    render();
  }));
  document.querySelectorAll('[data-beheer-restore]').forEach(button => button.addEventListener('click', () => {
    const config = beheerConfigs.find(row => row.complexId === button.dataset.beheerRestore);
    config.fixedAnnual = config.contractFixedAnnual;
    config.fixedIndexPct = config.contractFixedIndexPct;
    config.fixedIndexDate = config.contractFixedIndexDate;
    config.variablePct = config.contractVariablePct;
    recalculateBeheerProposal(true);
    render();
    toast('De beheerafspraak volgt weer de overeenkomst. Beoordeel het onderdeel opnieuw.');
  }));
  document.querySelectorAll('[data-beheer-field]').forEach(input => {
    if (input.type !== 'date') input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input.addEventListener('blur', () => {
      const config = beheerConfigs.find(row => row.complexId === input.dataset.complexId);
      const field = input.dataset.beheerField;
      if (field === 'fixedIndexDate') {
        if (!input.value) { toast('Kies een indexatiedatum voor het vaste deel.'); return; }
        config.fixedIndexDate = input.value;
      } else {
        const normalized = field === 'fixedAnnual'
          ? input.value.replace(/[^0-9-]/g, '')
          : input.value.trim().replace(',', '.');
        const parsed = Number(normalized);
        const valid = Number.isFinite(parsed)
          && (field === 'fixedIndexPct' ? parsed >= -20 && parsed <= 20 : parsed >= 0 && (field !== 'variablePct' || parsed <= 20));
        if (!valid) {
          toast(field === 'fixedIndexPct' ? 'Vul een indexatie tussen −20% en 20% in.' : 'Vul een geldig positief bedrag of tarief in.');
          render();
          return;
        }
        config[field] = parsed;
      }
      recalculateBeheerProposal(true);
      openId = 'beheer';
      render();
      toast('De beheerafspraak is aangepast. Neem het voorstel over en beoordeel het onderdeel opnieuw.');
    });
  });
  document.querySelector('[data-beheer-reset]')?.addEventListener('click', () => {
    const beheer = modules.find(item => item.id === 'beheer');
    beheer.budget = beheer.proposal;
    beheer.status = 'pending';
    openId = 'beheer';
    render();
    toast('Het voorstel voor de beheersvergoeding is overgenomen. Beoordeel het onderdeel nog even.');
  });
  document.querySelector('[data-action="beheer-agreement"]')?.addEventListener('click', () => toast('In de uiteindelijke applicatie opent hier de beheerovereenkomst.'));
  document.querySelectorAll('[data-management-mode]').forEach(button => button.addEventListener('click', () => {
    managementConfig.mode = button.dataset.managementMode;
    const management = modules.find(item => item.id === 'management');
    management.budget = null;
    recalculateManagementProposal(true);
    openId = 'management';
    render();
    toast(`${managementModeLabel(managementConfig.mode)} geselecteerd. Controleer de invoer.`);
  }));
  document.querySelectorAll('[data-management-field]').forEach(input => {
    if (input.type !== 'date') input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input.addEventListener('blur', () => {
      const field = input.dataset.managementField;
      if (input.type === 'date') {
        if (!input.value && managementConfig.mode !== 'NEW') { toast('Kies een datum binnen of buiten het begrotingsjaar.'); render(); return; }
        managementConfig[field] = input.value;
      } else {
        const normalized = field === 'indexPct'
          ? input.value.trim().replace(',', '.')
          : input.value.trim().replace(/\./g, '').replace(',', '.');
        const parsed = Number(normalized);
        const valid = Number.isFinite(parsed) && (field === 'indexPct' ? parsed >= -20 && parsed <= 20 : parsed >= 0);
        if (!valid) { toast(field === 'indexPct' ? 'Vul een indexatie tussen −20% en 20% in.' : 'Vul een geldig bedrag van €0 of hoger in.'); render(); return; }
        managementConfig[field] = parsed;
      }
      recalculateManagementProposal(true);
      openId = 'management';
      render();
      toast('Het managementvoorstel is herberekend. Neem het voorstel over en beoordeel opnieuw.');
    });
  });
  document.querySelectorAll('[data-management-unit]').forEach(select => select.addEventListener('change', () => {
    managementConfig[select.dataset.managementUnit] = select.value;
    recalculateManagementProposal(true);
    openId = 'management';
    render();
    toast('De invoereenheid is gewijzigd; maand- en jaarbedrag zijn opnieuw afgeleid.');
  }));
  document.querySelector('[data-management-reset]')?.addEventListener('click', () => {
    const management = modules.find(item => item.id === 'management');
    if (management.proposal === null) { toast('Kies eerst een invoerwijze.'); return; }
    management.budget = management.proposal;
    management.status = 'pending';
    openId = 'management';
    render();
    toast('Het voorstel voor de managementvergoeding is overgenomen. Beoordeel het onderdeel nog even.');
  });
  document.querySelector('[data-management-zero]')?.addEventListener('click', () => {
    const management = modules.find(item => item.id === 'management');
    management.budget = 0;
    management.status = 'zero';
    openId = 'management';
    render();
    toast('Managementvergoeding is bewust op €0 gezet.');
  });
  document.querySelectorAll('[data-planned-view]').forEach(button => button.addEventListener('click', () => {
    plannedView = button.dataset.plannedView;
    editingPlannedId = null;
    openId = 'planned';
    render();
    document.querySelector('#detail-planned')?.scrollIntoView({ block: 'center' });
  }));
  document.querySelectorAll('[data-planned-edit]').forEach(button => button.addEventListener('click', () => {
    editingPlannedId = editingPlannedId === Number(button.dataset.plannedEdit) ? null : Number(button.dataset.plannedEdit);
    openId = 'planned';
    render();
    if (editingPlannedId !== null) document.querySelector(`#planned-editor-${editingPlannedId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }));
  document.querySelector('[data-planned-close]')?.addEventListener('click', () => {
    editingPlannedId = null;
    render();
  });
  document.querySelector('[data-planned-add]')?.addEventListener('click', () => {
    const id = Math.max(0, ...plannedActivities.map(activity => Number(activity.id))) + 1;
    plannedActivities.push({ id, complex: '', description: '', glAccount: '', ogbCode: '', source: '', sourceDetail: '', q1: 0, q2: 0, q3: 0, q4: 0, status: '', supplier: '', offer: null, note: '' });
    editingPlannedId = id;
    recalculatePlannedBudget(true);
    render();
    document.querySelector(`#planned-editor-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    document.querySelector(`#planned-editor-${id} [data-planned-field="complex"]`)?.focus();
  });
  document.querySelectorAll('[data-planned-copy]').forEach(button => button.addEventListener('click', () => {
    const previous = plannedPreviousActivities.find(activity => String(activity.id) === button.dataset.plannedCopy);
    if (!previous) return;
    const id = Math.max(0, ...plannedActivities.map(activity => Number(activity.id))) + 1;
    plannedActivities.push({ ...previous, id, glAccount: '', ogbCode: '', sourceDetail: 'Overgenomen uit Begroting 2026 · bewust opnieuw gepland', status: 'GEPLAND', supplier: '', offer: null, note: '' });
    plannedView = 'budget2027';
    editingPlannedId = id;
    recalculatePlannedBudget(true);
    render();
    document.querySelector(`#planned-editor-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast('Activiteit bewust naar 2027 gekopieerd; controleer de gegevens en kwartaalbedragen.');
  }));
  document.querySelectorAll('[data-planned-field]').forEach(input => {
    if (input.tagName === 'INPUT') input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'blur', () => {
      const activity = plannedActivities.find(row => row.id === editingPlannedId);
      if (!activity) return;
      const field = input.dataset.plannedField;
      if (['q1', 'q2', 'q3', 'q4', 'offer'].includes(field)) {
        const raw = input.value.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
        const parsed = Number(raw);
        if (field === 'offer' && raw === '') activity.offer = null;
        else if (!Number.isFinite(parsed)) { toast('Vul een geldig bedrag in.'); render(); return; }
        else if (field === 'offer' && parsed < 0) { toast('Een offertebedrag kan niet negatief zijn.'); render(); return; }
        else activity[field] = parsed;
      } else if (field === 'glAccount') {
        activity.glAccount = input.value;
        const availableOgb = observedOgbByAccount[activity.glAccount] || [];
        if (activity.ogbCode && !availableOgb.includes(activity.ogbCode)) activity.ogbCode = '';
      } else {
        activity[field] = input.value;
      }
      const hasNegativeQuarter = ['q1', 'q2', 'q3', 'q4'].some(key => Number(activity[key]) < 0);
      recalculatePlannedBudget(true);
      openId = 'planned';
      render();
      if (hasNegativeQuarter) toast('Negatief kwartaalbedrag opgeslagen met waarschuwing; beoordeling blijft mogelijk.');
    });
  });
  document.querySelector('[data-planned-distribute]')?.addEventListener('click', buttonEvent => {
    const activity = plannedActivities.find(row => row.id === Number(buttonEvent.currentTarget.dataset.plannedDistribute));
    if (!activity) return;
    const total = plannedActivityTotal(activity);
    const base = Math.trunc(total / 4);
    activity.q1 = base;
    activity.q2 = base;
    activity.q3 = base;
    activity.q4 = total - (base * 3);
    recalculatePlannedBudget(true);
    render();
    toast('Het jaartotaal is zo gelijk mogelijk over Q1–Q4 verdeeld.');
  });
  document.querySelector('[data-planned-delete]')?.addEventListener('click', event => {
    const id = Number(event.currentTarget.dataset.plannedDelete);
    const index = plannedActivities.findIndex(row => row.id === id);
    if (index < 0) return;
    plannedActivities.splice(index, 1);
    editingPlannedId = null;
    recalculatePlannedBudget(true);
    render();
    toast('Onderhoudsactiviteit verwijderd uit het concept.');
  });
  document.querySelectorAll('[data-estimated-field]').forEach(input => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('blur', () => {
      const row = plannedEstimatedRows.find(activity => activity.id === input.dataset.estimatedId);
      const raw = input.value.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
      const parsed = Number(raw);
      if (!row || !Number.isFinite(parsed)) { toast('Vul een geldig bedrag in.'); render(); return; }
      row[input.dataset.estimatedField] = parsed;
      recalculatePlannedEstimated();
      render();
      if (parsed < 0) toast('Negatieve verwachting opgeslagen met waarschuwing.');
    });
  });
  document.querySelectorAll('[data-estimated-meta]').forEach(input => {
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'blur', () => {
      const row = plannedEstimatedRows.find(activity => activity.id === input.dataset.estimatedId);
      if (!row) return;
      row[input.dataset.estimatedMeta] = input.value.trim();
      render();
    });
  });
  document.querySelector('[data-estimated-add]')?.addEventListener('click', () => {
    const id = `e${plannedEstimatedRows.length + 1}`;
    plannedEstimatedRows.push({ id, complex: 'Rooise Zoom 7–8', description: 'Nieuwe activiteit', source: 'OVERIG', q3: 0, q4: 0, status: 'ONVOORZIEN', isNew: true });
    recalculatePlannedEstimated();
    render();
    toast('Nieuwe Estimated-only activiteit toegevoegd.');
  });
  document.querySelectorAll('[data-corrective-view]').forEach(button => button.addEventListener('click', () => {
    correctiveView = button.dataset.correctiveView;
    editingCorrectiveId = null;
    openId = 'corrective';
    render();
    document.querySelector('#detail-corrective')?.scrollIntoView({ block: 'center' });
  }));
  document.querySelectorAll('[data-corrective-edit]').forEach(button => button.addEventListener('click', () => {
    const id = Number(button.dataset.correctiveEdit);
    editingCorrectiveId = editingCorrectiveId === id ? null : id;
    openId = 'corrective';
    render();
    if (editingCorrectiveId !== null) document.querySelector(`#corrective-editor-${editingCorrectiveId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }));
  document.querySelector('[data-corrective-close]')?.addEventListener('click', () => {
    editingCorrectiveId = null;
    render();
  });
  document.querySelector('[data-corrective-add]')?.addEventListener('click', () => {
    const id = Math.max(0, ...correctiveRows.map(row => Number(row.id))) + 1;
    correctiveRows.push({ id, complex: null, description: '', glAccount: '', ogbCode: '', amount: null });
    editingCorrectiveId = id;
    recalculateCorrectiveBudget(true);
    render();
    document.querySelector(`#corrective-editor-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    document.querySelector(`#corrective-editor-${id} [data-corrective-field="description"]`)?.focus();
  });
  document.querySelectorAll('[data-corrective-field]').forEach(input => {
    if (input.tagName === 'INPUT') input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'blur', () => {
      const row = correctiveRows.find(candidate => candidate.id === editingCorrectiveId);
      if (!row) return;
      const field = input.dataset.correctiveField;
      if (field === 'amount') {
        const raw = input.value.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
        row.amount = raw === '' ? null : Number(raw);
        if (row.amount !== null && !Number.isFinite(row.amount)) { row.amount = null; toast('Vul een geldig jaarbedrag in.'); }
      } else if (field === 'complex') {
        row.complex = input.value || null;
      } else if (field === 'glAccount') {
        row.glAccount = input.value;
        const availableOgb = observedOgbByAccount[row.glAccount] || [];
        if (row.ogbCode && !availableOgb.includes(row.ogbCode)) row.ogbCode = '';
      } else {
        row[field] = input.value;
      }
      recalculateCorrectiveBudget(true);
      openId = 'corrective';
      render();
      if (correctiveHasWarning(row)) toast('Negatief jaarbedrag opgeslagen met waarschuwing; beoordeling blijft mogelijk.');
    });
  });
  document.querySelector('[data-corrective-delete]')?.addEventListener('click', event => {
    const id = Number(event.currentTarget.dataset.correctiveDelete);
    const index = correctiveRows.findIndex(row => row.id === id);
    if (index < 0) return;
    correctiveRows.splice(index, 1);
    editingCorrectiveId = null;
    recalculateCorrectiveBudget(true);
    render();
    toast('Begrotingsregel verwijderd uit het concept.');
  });
  document.querySelectorAll('[data-corrective-estimated-field]').forEach(input => {
    if (input.tagName === 'INPUT') input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'blur', () => {
      const row = correctiveEstimatedRows.find(candidate => candidate.id === input.dataset.correctiveEstimatedId);
      if (!row) return;
      const field = input.dataset.correctiveEstimatedField;
      if (field === 'amount') {
        const raw = input.value.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
        row.amount = raw === '' ? null : Number(raw);
        if (row.amount !== null && !Number.isFinite(row.amount)) { row.amount = null; toast('Vul een geldig resterend bedrag in.'); }
      } else if (field === 'complex') {
        row.complex = input.value || null;
      } else {
        row[field] = input.value;
      }
      recalculateCorrectiveEstimated();
      render();
      if (row.amount !== null && row.amount < 0) toast('Negatieve verwachting opgeslagen met waarschuwing.');
    });
  });
  document.querySelector('[data-corrective-estimated-add]')?.addEventListener('click', () => {
    const id = `ce${Date.now()}`;
    correctiveEstimatedRows.push({ id, complex: null, description: '', amount: null, isNew: true });
    recalculateCorrectiveEstimated();
    render();
    document.querySelector(`[data-corrective-estimated-field="description"][data-corrective-estimated-id="${id}"]`)?.focus();
    toast('Nieuwe Estimated-only regel toegevoegd.');
  });
  document.querySelectorAll('[data-corrective-estimated-delete]').forEach(button => button.addEventListener('click', () => {
    const index = correctiveEstimatedRows.findIndex(row => row.id === button.dataset.correctiveEstimatedDelete);
    if (index < 0) return;
    correctiveEstimatedRows.splice(index, 1);
    recalculateCorrectiveEstimated();
    render();
    toast('Estimated-only regel verwijderd.');
  }));
  document.querySelectorAll('[data-insurance-view]').forEach(button => button.addEventListener('click', () => {
    insuranceView = button.dataset.insuranceView;
    editingInsuranceId = null;
    expandedInsuranceMonthsId = null;
    openId = 'insurance';
    render();
    document.querySelector('#detail-insurance')?.scrollIntoView({ block: 'center' });
  }));
  document.querySelectorAll('[data-insurance-edit]').forEach(button => button.addEventListener('click', () => {
    const id = Number(button.dataset.insuranceEdit);
    editingInsuranceId = editingInsuranceId === id ? null : id;
    expandedInsuranceMonthsId = null;
    openId = 'insurance';
    render();
    if (editingInsuranceId !== null) document.querySelector(`#insurance-editor-${editingInsuranceId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }));
  document.querySelector('[data-insurance-close]')?.addEventListener('click', () => {
    editingInsuranceId = null;
    render();
  });
  document.querySelector('[data-insurance-add]')?.addEventListener('click', () => {
    const id = Math.max(0, ...insurancePolicies.map(policy => Number(policy.id))) + 1;
    insurancePolicies.push({ id, complex: '', insurer: '', startDate: '', termMonths: null, glAccount: '4130', ogbCode: '', annualPremium: null, indexPct: null, manualOverride: null });
    editingInsuranceId = id;
    expandedInsuranceMonthsId = null;
    recalculateInsuranceBudget(true);
    render();
    document.querySelector(`#insurance-editor-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    document.querySelector(`#insurance-editor-${id} [data-insurance-field="complex"]`)?.focus();
  });
  document.querySelectorAll('[data-insurance-months]').forEach(button => button.addEventListener('click', () => {
    const id = Number(button.dataset.insuranceMonths);
    expandedInsuranceMonthsId = expandedInsuranceMonthsId === id ? null : id;
    editingInsuranceId = null;
    openId = 'insurance';
    render();
    if (expandedInsuranceMonthsId !== null) document.querySelector(`[data-insurance-months="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }));
  document.querySelectorAll('[data-insurance-field]').forEach(input => {
    if (input.tagName === 'INPUT' && input.type !== 'date') input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input.addEventListener(input.tagName === 'SELECT' || input.type === 'date' ? 'change' : 'blur', () => {
      const policy = insurancePolicies.find(candidate => candidate.id === editingInsuranceId);
      if (!policy) return;
      const field = input.dataset.insuranceField;
      if (['termMonths', 'annualPremium', 'indexPct', 'manualOverride'].includes(field)) {
        const raw = input.value.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
        const parsed = Number(raw);
        policy[field] = raw === '' || !Number.isFinite(parsed) ? null : parsed;
        if (raw !== '' && !Number.isFinite(parsed)) toast('Vul een geldig getal in.');
      } else if (field === 'glAccount') {
        policy.glAccount = input.value;
        const availableOgb = observedOgbByAccount[policy.glAccount] || [];
        if (policy.ogbCode && !availableOgb.includes(policy.ogbCode)) policy.ogbCode = '';
      } else {
        policy[field] = input.value;
      }
      recalculateInsuranceBudget(true);
      openId = 'insurance';
      render();
      if (insuranceHasWarning(policy)) toast('Negatieve poliswaarde opgeslagen met waarschuwing; beoordeling blijft mogelijk.');
    });
  });
  document.querySelectorAll('[data-insurance-override-toggle]').forEach(input => input.addEventListener('change', () => {
    const policy = insurancePolicies.find(candidate => candidate.id === Number(input.dataset.insuranceOverrideToggle));
    if (!policy) return;
    policy.manualOverride = input.checked ? insuranceCalculation({ ...policy, manualOverride: null }).calculated : null;
    recalculateInsuranceBudget(true);
    editingInsuranceId = policy.id;
    render();
    if (input.checked) document.querySelector(`#insurance-editor-${policy.id} [data-insurance-field="manualOverride"]`)?.focus();
  }));
  document.querySelector('[data-insurance-delete]')?.addEventListener('click', event => {
    const id = Number(event.currentTarget.dataset.insuranceDelete);
    const index = insurancePolicies.findIndex(policy => policy.id === id);
    if (index < 0) return;
    insurancePolicies.splice(index, 1);
    editingInsuranceId = null;
    expandedInsuranceMonthsId = null;
    recalculateInsuranceBudget(true);
    render();
    toast('Polis verwijderd uit het concept.');
  });
  document.querySelectorAll('[data-insurance-estimated-id]').forEach(input => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input.addEventListener('blur', () => {
      const row = insuranceEstimatedRows.find(candidate => candidate.id === Number(input.dataset.insuranceEstimatedId));
      if (!row) return;
      const raw = input.value.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
      const parsed = Number(raw);
      row.remainingOverride = raw === '' || !Number.isFinite(parsed) ? null : parsed;
      recalculateInsuranceEstimated();
      openId = 'insurance';
      render();
      if (row.remainingOverride !== null && row.remainingOverride < 0) toast('Negatieve resterende premie opgeslagen met waarschuwing.');
    });
  });
  document.querySelectorAll('[data-municipal-view]').forEach(button => button.addEventListener('click', () => {
    municipalView = button.dataset.municipalView;
    editingMunicipalId = null;
    openId = 'municipal';
    render();
    document.querySelector('#detail-municipal')?.scrollIntoView({ block: 'center' });
  }));
  document.querySelector('#open-municipal-export')?.addEventListener('click', () => { municipalExportOpen = true; render(); });
  document.querySelectorAll('#close-municipal-export, #cancel-municipal-export').forEach(button => button.addEventListener('click', () => { municipalExportOpen = false; render(); }));
  document.querySelector('#municipal-export-overlay')?.addEventListener('click', event => { if (event.target.id === 'municipal-export-overlay') { municipalExportOpen = false; render(); } });
  document.querySelector('#municipal-export-complex')?.addEventListener('change', event => { municipalExportComplex = event.target.value; render(); });
  document.querySelector('#municipal-export-years')?.addEventListener('change', event => { municipalExportYears = event.target.value; render(); });
  document.querySelector('#download-municipal-export')?.addEventListener('click', downloadMunicipalExport);
  document.querySelectorAll('[data-municipal-add]').forEach(button => button.addEventListener('click', () => {
    const id = Math.max(0, ...municipalWozObjects.map(row => Number(row.id))) + 1;
    municipalWozObjects.push({ id, complex: '', unit: '', assessmentYear: 2026, valueDate: '2025-01-01', actualWoz: null, expectedOverride: null });
    editingMunicipalId = id;
    municipalWozSetComplete = false;
    municipalBudgetOverride = null;
    recalculateMunicipalBudget(true);
    openId = 'municipal';
    render();
    document.querySelector(`#municipal-editor-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    document.querySelector(`#municipal-editor-${id} [data-municipal-field="complex"]`)?.focus();
  }));
  document.querySelectorAll('[data-municipal-edit]').forEach(button => button.addEventListener('click', () => {
    const id = Number(button.dataset.municipalEdit);
    editingMunicipalId = editingMunicipalId === id ? null : id;
    openId = 'municipal';
    render();
    if (editingMunicipalId !== null) document.querySelector(`#municipal-editor-${editingMunicipalId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }));
  document.querySelector('[data-municipal-close]')?.addEventListener('click', () => {
    editingMunicipalId = null;
    render();
  });
  document.querySelectorAll('[data-municipal-field]').forEach(input => {
    if (input.tagName === 'INPUT' && input.type !== 'date') input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input.addEventListener(input.tagName === 'SELECT' || input.type === 'date' ? 'change' : 'blur', () => {
      const row = municipalWozObjects.find(candidate => candidate.id === editingMunicipalId);
      if (!row) return;
      const field = input.dataset.municipalField;
      if (field === 'actualWoz' || field === 'assessmentYear') {
        const raw = input.value.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
        const parsed = Number(raw);
        row[field] = raw === '' || !Number.isFinite(parsed) ? null : parsed;
      } else if (field === 'complex') {
        row.complex = input.value;
        row.unit = '';
      } else {
        row[field] = input.value;
      }
      municipalWozSetComplete = false;
      municipalBudgetOverride = null;
      recalculateMunicipalBudget(true);
      openId = 'municipal';
      render();
    });
  });
  document.querySelector('[data-municipal-delete]')?.addEventListener('click', event => {
    const id = Number(event.currentTarget.dataset.municipalDelete);
    const index = municipalWozObjects.findIndex(row => row.id === id);
    if (index < 0) return;
    municipalWozObjects.splice(index, 1);
    editingMunicipalId = null;
    municipalWozSetComplete = false;
    municipalBudgetOverride = null;
    recalculateMunicipalBudget(true);
    render();
    toast('WOZ-waarde verwijderd uit het concept.');
  });
  document.querySelectorAll('[data-municipal-override]').forEach(input => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input.addEventListener('blur', () => {
      const row = municipalWozObjects.find(candidate => candidate.id === Number(input.dataset.municipalOverride));
      if (!row) return;
      const raw = input.value.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
      const parsed = Number(raw);
      row.expectedOverride = raw === '' || !Number.isFinite(parsed) ? null : parsed;
      municipalBudgetOverride = null;
      recalculateMunicipalBudget(true);
      openId = 'municipal';
      render();
      if (row.expectedOverride !== null) toast('Handmatige WOZ-verwachting opgeslagen; de automatische waarde blijft als referentie zichtbaar.');
    });
  });
  document.querySelector('#municipal-set-complete')?.addEventListener('change', event => {
    if (event.target.checked && municipalWozObjects.some(municipalObjectHasCritical)) {
      municipalWozSetComplete = false;
      render();
      toast('Maak eerst alle WOZ-regels compleet.');
      return;
    }
    municipalWozSetComplete = event.target.checked;
    municipalBudgetOverride = null;
    recalculateMunicipalBudget(true);
    openId = 'municipal';
    render();
    toast(municipalWozSetComplete ? 'Volledige WOZ-set bevestigd; het historische lastenpercentage kan nu worden berekend.' : 'WOZ-set opnieuw geopend voor controle.');
  });
  [['#municipal-woz-increase', 'woz'], ['#municipal-rate-increase', 'rate']].forEach(([selector, type]) => {
    const input = document.querySelector(selector);
    input?.addEventListener('focus', () => input.select());
    input?.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input?.addEventListener('blur', () => {
      const raw = input.value.trim().replace(',', '.').replace(/[^0-9.-]/g, '');
      const parsed = Number(raw);
      const value = raw === '' || !Number.isFinite(parsed) ? null : parsed;
      if (type === 'woz') municipalWozIncreasePct = value;
      else municipalRateIncreasePct = value;
      municipalBudgetOverride = null;
      recalculateMunicipalBudget(true);
      openId = 'municipal';
      render();
      toast('Aanname opgeslagen; het voorstel is opnieuw berekend zodra de WOZ-gegevens compleet zijn.');
    });
  });
  document.querySelectorAll('[data-municipal-ledger-share]').forEach(input => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input.addEventListener('blur', () => {
      const row = municipalLedgerRows.find(candidate => candidate.id === Number(input.dataset.municipalLedgerShare));
      if (!row) return;
      const raw = input.value.trim().replace(',', '.').replace(/[^0-9.-]/g, '');
      const parsed = Number(raw);
      row.share = raw === '' || !Number.isFinite(parsed) ? 0 : parsed / 100;
      recalculateMunicipalBudget(true);
      openId = 'municipal';
      render();
      if (Math.abs(municipalLedgerShareTotal() - 1) > 0.0001) toast('De grootboekverdeling moet samen 100% zijn.');
    });
  });
  document.querySelector('#municipal-estimated-correction')?.addEventListener('focus', event => event.target.select());
  document.querySelector('#municipal-estimated-correction')?.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
  document.querySelector('#municipal-estimated-correction')?.addEventListener('blur', event => {
    const raw = event.target.value.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    const parsed = Number(raw);
    municipalEstimatedCorrection = raw === '' || !Number.isFinite(parsed) ? 0 : parsed;
    recalculateMunicipalEstimated();
    openId = 'municipal';
    render();
    toast('Estimated 2026 is bijgewerkt.');
  });
  document.querySelectorAll('[data-canon-field]').forEach(input => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
    input.addEventListener('blur', () => {
      const row = canonRows.find(candidate => candidate.complexId === input.dataset.canonComplex);
      if (!row) return;
      const raw = input.value.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
      const parsed = Number(raw);
      row[input.dataset.canonField] = raw === '' || !Number.isFinite(parsed) ? null : parsed;
      if (input.dataset.canonField === 'annualCanon' && Number(row.annualCanon) === 0) row.indexPct = null;
      recalculateCanon(true);
      openId = 'canon';
      render();
      toast('Canon erfpacht is opnieuw berekend.');
    });
  });
  document.addEventListener('click', closeMenus, { once: true });
  document.querySelector('#search').addEventListener('input', event => { search = event.target.value; const pos = event.target.selectionStart; render(); const next = document.querySelector('#search'); next.focus(); next.setSelectionRange(pos, pos); });
  document.querySelector('#save-close')?.addEventListener('click', () => { savedAt = 'zojuist'; render(); toast('Conceptbegroting opgeslagen.'); });
  document.querySelector('#to-review')?.addEventListener('click', () => { currentPage = 'review'; openId = null; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  document.querySelectorAll('#back-to-budget, #back-to-budget-footer').forEach(button => button.addEventListener('click', () => { currentPage = 'budget'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  document.querySelectorAll('[data-open-module]').forEach(button => button.addEventListener('click', () => { currentPage = 'budget'; openId = button.dataset.openModule; render(); document.querySelector(`[data-module="${openId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }));
  document.querySelector('#first-open-page')?.addEventListener('click', () => { const first = activeModules().find(m => !isReviewed(m.status)); currentPage = 'budget'; openId = first.id; render(); document.querySelector(`[data-module="${first.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  document.querySelector('#open-finalize')?.addEventListener('click', () => { finalizeModalOpen = true; render(); });
  document.querySelector('#cancel-finalize')?.addEventListener('click', () => { finalizeModalOpen = false; render(); });
  document.querySelector('#finalize-overlay')?.addEventListener('click', event => { if (event.target.id === 'finalize-overlay') { finalizeModalOpen = false; render(); } });
  document.querySelector('#confirm-finalize')?.addEventListener('click', () => { isFinalized = true; finalizeModalOpen = false; savedAt = 'zojuist'; currentPage = 'review'; render(); toast('Begroting 2027 is definitief vastgesteld.'); });
  document.querySelector('#final-note')?.addEventListener('input', event => { finalNote = event.target.value; });
  document.querySelector('#new-version')?.addEventListener('click', () => toast('In de uiteindelijke applicatie wordt hier een nieuwe conceptversie gestart.'));
  document.querySelector('[data-action="maintenance"]')?.addEventListener('click', () => toast('In de uiteindelijke applicatie opent hier Onderhoud voor complex 7–8.'));
}

function closeMenus() { document.querySelectorAll('.popover').forEach(p => p.classList.remove('open')); }
function closeReview() { document.querySelector('#review-overlay')?.classList.remove('open'); }
let toastTimer;
function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

render();
