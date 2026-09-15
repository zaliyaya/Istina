const REMAINDER_NAME = '(без детализации)';

// В выгрузке встречается, что «Итого» по категории больше суммы её строк:
// часть позиций система не печатает. Разницу сохраняем отдельной позицией,
// иначе недельные суммы занижаются (по коктейлям за 17.08 — на 52 шт и 27 тыс. ₽).
function addCategoryRemainders(items, categoryTotals) {
  const added = [];
  const listed = new Map();
  for (const it of items) {
    const agg = listed.get(it.category) || { qty: 0, revenue: 0, profit: 0 };
    agg.qty += it.qty || 0;
    agg.revenue += it.revenue || 0;
    agg.profit += it.profit || 0;
    listed.set(it.category, agg);
  }
  const totals = new Map();
  for (const t of categoryTotals) {
    const agg = totals.get(t.category) || { qty: 0, revenue: 0, profit: 0 };
    agg.qty += t.qty || 0;
    agg.revenue += t.revenue || 0;
    agg.profit += t.profit || 0;
    totals.set(t.category, agg);
  }
  for (const [category, total] of totals) {
    const sub = listed.get(category) || { qty: 0, revenue: 0, profit: 0 };
    const diff = {
      qty: Math.round((total.qty - sub.qty) * 100) / 100,
      revenue: Math.round((total.revenue - sub.revenue) * 100) / 100,
      profit: Math.round((total.profit - sub.profit) * 100) / 100,
    };
    if (Math.abs(diff.qty) < 0.5 && Math.abs(diff.revenue) < 1 && Math.abs(diff.profit) < 1) continue;
    items.push({ category, name: REMAINDER_NAME, markup: null, cost: null, ...diff });
    added.push({ category, ...diff });
  }
  return added;
}

const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const SECTION_LABEL = { kitchen: 'Кухня', bar: 'Бар' };

function normName(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[«»"'.]/g, '')
    // «+ 1 Безлимитный…» в выгрузке и «Плюс 1 Безлимитный…» в старом отчёте —
    // одна и та же позиция, но по буквам они расходятся слишком сильно,
    // чтобы совпасть по схожести
    .replace(/^\+\s*/, 'плюс ')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}
function bigrams(s) { const a = []; for (let i = 0; i < s.length - 1; i++) a.push(s.substr(i, 2)); return a; }
function diceCoeff(a, b) {
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  if (!A.length || !B.length) return 0;
  let matches = 0; const rest = B.slice();
  for (const bg of A) { const idx = rest.indexOf(bg); if (idx >= 0) { matches++; rest.splice(idx, 1); } }
  return (2 * matches) / (A.length + B.length);
}
function fmtRub(n) { return Math.round(n || 0).toLocaleString('ru-RU') + ' \u20BD'; }
function fmtNum(n) { return Math.round(n || 0).toLocaleString('ru-RU'); }
function fmtPct(n) {
  if (n == null || !isFinite(n)) return '—';
  // с одним знаком: иначе 303,5% на сайте и в выгрузке выглядят как разные числа
  return n.toFixed(1).replace('.', ',') + '%';
}
function addDays(iso, d) {
  const dt = new Date(iso + 'T00:00:00');
  dt.setDate(dt.getDate() + d);
  return dt;
}
function isoLocal(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function fmtCompact(n) {
  n = Math.round(n || 0);
  if (Math.abs(n) >= 1000) return Math.round(n / 1000) + 'k ₽';
  return n + ' ₽';
}
function fmtDay(iso) {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function pluralWeeks(n) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'неделя';
  if ([2, 3, 4].includes(n10) && ![12, 13, 14].includes(n100)) return 'недели';
  return 'недель';
}
function weekLabel(iso) {
  const start = addDays(iso, 0);
  const end = addDays(iso, 6);
  const sM = MONTHS[start.getMonth()], eM = MONTHS[end.getMonth()];
  if (sM === eM) return `${start.getDate()}–${end.getDate()} ${eM}`;
  return `${start.getDate()} ${sM} – ${end.getDate()} ${eM}`;
}

class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.fileInputRef = React.createRef();
    this.importInputRef = React.createRef();
    this.state = {
      tab: 'dashboard',
      section: 'all',
      period: (props.defaultPeriod || 'last8'),
      category: '',
      categoryFilter: [],
      groupFilter: '',
      categoryDropdownOpen: false,
      search: '',
      sortBy: 'value',
      sortDir: 'desc',
      itemSortBy: 'value',
      itemSortDir: 'desc',
      customFrom: '',
      customTo: '',
      trendScope: 'total',
      tableMetric: 'revenue',
      banquetForm: { weekIso: '', totalRevenue: '', kitchenRevenue: '', barRevenue: '', kitchenProfit: '', barProfit: '' },
      expanded: {},
      messages: [],
      importError: '',
      // База готовится сразу, а не в componentDidMount: списки в шаблоне
      // строятся при первом рендере и потом уже не пересобираются.
      db: this.initialDb(),
    };
  }

  seedVersion() {
    const el = document.getElementById('seed-version');
    return el ? el.textContent.trim() : '';
  }

  // Недели раньше этой даты в отчёте не ведутся
  seedCutoff() {
    const el = document.getElementById('seed-cutoff');
    return el ? el.textContent.trim() : '';
  }

  dropWeeksBefore(db, cutoff) {
    if (!cutoff) return 0;
    let n = 0;
    for (const wk of Object.keys(db.weeks)) {
      if (wk >= cutoff) continue;
      delete db.weeks[wk];
      delete db.stamps[wk + '|kitchen'];
      delete db.stamps[wk + '|bar'];
      n++;
    }
    db.banquets = (db.banquets || []).filter(b => b.weekIso >= cutoff);
    return n;
  }

  // База, собранная из данных, вшитых в файл отчёта
  seedDb() {
    const db = this.emptyDb();
    const seedEl = document.getElementById('seed-data');
    if (seedEl) {
      try {
        const seed = JSON.parse(seedEl.textContent);
        for (const wk of Object.keys(seed).sort()) {
          for (const section of ['kitchen', 'bar']) {
            if (!seed[wk][section]) continue;
            this.mergeUpload(db, wk, section, seed[wk][section], []);
            // отметка «0»: всё, что вы загрузили сами, считается свежее
            db.stamps[wk + '|' + section] = 0;
          }
        }
      } catch (e) { /* без исходных данных просто откроется пустой отчёт */ }
    }
    const groupEl = document.getElementById('group-seed');
    if (groupEl) {
      try { db.groups = JSON.parse(groupEl.textContent) || {}; } catch (e) { /* не критично */ }
    }
    this.dropWeeksBefore(db, this.seedCutoff());
    db.seedVersion = this.seedVersion();
    return db;
  }

  /**
   * Подмешивает данные, вшитые в файл отчёта, в уже накопленную базу.
   * Правило простое: то, что пришло из прошлой версии файла (отметка 0),
   * заменяется свежим; то, что человек загрузил сам (отметка со временем),
   * остаётся нетронутым.
   */
  applySeed(stored, seed) {
    let replaced = 0;
    for (const wk of Object.keys(seed.weeks)) {
      for (const section of ['kitchen', 'bar']) {
        const incoming = seed.weeks[wk] && seed.weeks[wk][section];
        if (!incoming) continue;
        const key = wk + '|' + section;
        if ((stored.stamps || {})[key] > 0) continue; // это загрузил пользователь
        if (!stored.weeks[wk]) stored.weeks[wk] = {};
        stored.weeks[wk][section] = incoming;
        stored.stamps[key] = 0;
        replaced++;
      }
    }
    // справочники из файла не должны затирать ручные правки
    for (const sec of ['kitchen', 'bar']) {
      stored.registry[sec] = { ...seed.registry[sec], ...stored.registry[sec] };
      stored.itemCategory[sec] = { ...seed.itemCategory[sec], ...stored.itemCategory[sec] };
    }
    stored.groups = { ...(seed.groups || {}), ...(stored.groups || {}) };
    return replaced;
  }

  initialDb() {
    const stored = this.loadPersisted();
    if (!stored || !Object.keys(stored.weeks).length) {
      const db = this.seedDb();
      this.persist(db);
      return db;
    }
    // Файл отчёта обновили — подмешиваем новые недели к тому, что уже есть.
    // Ваши загрузки при этом не трогаются: у них отметка свежее.
    if (stored.seedVersion !== this.seedVersion()) {
      if (!stored.stamps) stored.stamps = {};
      this.applySeed(stored, this.seedDb());
      // старые недели, которые больше не ведутся, убираем и у тех,
      // кто открывал прошлые версии файла
      this.dropWeeksBefore(stored, this.seedCutoff());
      stored.seedVersion = this.seedVersion();
      this.persist(stored);
      return stored;
    }
    // отсечку применяем при каждом открытии: старые недели могут вернуться
    // из чужой базы или остаться с прошлых версий файла
    if (this.dropWeeksBefore(stored, this.seedCutoff())) this.persist(stored);
    return stored;
  }

  emptyDb() { return { weeks: {}, registry: { kitchen: {}, bar: {} }, itemCategory: { kitchen: {}, bar: {} }, banquets: [], groups: {}, stamps: {}, baseline: {} }; }

  loadPersisted() {
    try {
      const raw = localStorage.getItem('istina-sales-db-v2');
      if (!raw) return null;
      const db = JSON.parse(raw);
      if (!db.banquets) db.banquets = [];
      if (!db.groups) db.groups = {};
      if (!db.stamps) db.stamps = {};
      if (!db.baseline) db.baseline = {};
      return db;
    } catch (e) { return null; }
  }
  persist(db) {
    try { localStorage.setItem('istina-sales-db-v2', JSON.stringify(db)); } catch (e) { /* full storage */ }
  }

  threshold() { return (this.props.similarityThreshold ?? 90) / 100; }

  mergeUpload(db, weekIso, section, items, messages) {
    const registry = db.registry[section];
    const catMap = db.itemCategory[section];
    const th = this.threshold();
    const out = [];
    for (const raw of items) {
      const norm = normName(raw.name);
      let canonical = registry[norm];
      if (!canonical) {
        let best = null, bestScore = 0;
        for (const key of Object.keys(registry)) {
          const s = diceCoeff(norm, key);
          if (s > bestScore) { bestScore = s; best = key; }
        }
        if (best && bestScore >= th) {
          canonical = registry[best];
          registry[norm] = canonical;
          messages.push(`«${raw.name}» распознано как «${canonical}» (совпадение ${Math.round(bestScore * 100)}%)`);
        } else {
          canonical = raw.name;
          registry[norm] = canonical;
        }
      }
      catMap[canonical] = raw.category;
      out.push({ category: raw.category, name: canonical, markup: raw.markup, cost: raw.cost, qty: raw.qty || 0, revenue: raw.revenue || 0, profit: raw.profit || 0 });
    }
    db.weeks[weekIso] = db.weeks[weekIso] || {};
    db.weeks[weekIso][section] = out;
  }

  parseSheetRows(rows) {
    const periodLine = String((rows[1] && rows[1][0]) || '');
    const m = periodLine.match(/(\d{2}\.\d{2}\.\d{4})\s*по\s*(\d{2}\.\d{2}\.\d{4})/);
    const startIso = m ? m[1].split('.').reverse().join('-') : null;
    const whLine = String((rows[2] && rows[2][0]) || '');
    const section = /кухня/i.test(whLine) ? 'kitchen' : (/бар/i.test(whLine) ? 'bar' : null);
    const items = [];
    const categoryTotals = [];
    let category = '';
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i] || [];
      const a = String(r[0] || '').trim();
      const b = String(r[1] || '').trim();
      if (/^Категория:/i.test(a)) { category = a.replace(/^Категория:\s*/i, '').trim(); continue; }
      if (/^итого/i.test(b) || /^итого/i.test(a)) {
        if (/^итого/i.test(b) && category) {
          categoryTotals.push({
            category,
            qty: r[4] === '' || r[4] == null ? 0 : Number(r[4]),
            revenue: r[5] === '' || r[5] == null ? 0 : Number(r[5]),
            profit: r[6] === '' || r[6] == null ? 0 : Number(r[6]),
          });
        }
        continue;
      }
      if (!b) continue;
      const qty = r[4] === '' || r[4] == null ? null : Number(r[4]);
      const revenue = r[5] === '' || r[5] == null ? null : Number(r[5]);
      const profit = r[6] === '' || r[6] == null ? null : Number(r[6]);
      if (qty == null && revenue == null && profit == null) continue;
      items.push({
        category: category || '(без категории)', name: b,
        markup: r[2] === '' ? null : Number(r[2]),
        cost: r[3] === '' ? null : Number(r[3]),
        qty, revenue, profit,
      });
    }
    const remainders = addCategoryRemainders(items, categoryTotals);
    return { startIso, section, items, remainders };
  }

  handleWorkbook(wb, fileName, messages) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const { startIso, section, items, remainders } = this.parseSheetRows(rows);
    if (!startIso || !section) {
      messages.push(`Не удалось распознать файл «${fileName}» — проверьте формат выгрузки.`);
      return null;
    }
    return { startIso, section, items, remainders };
  }

  onFilesSelected = (e) => {
    const files = Array.from(e.target.files || []);
    this.processFiles(files);
    e.target.value = '';
  };
  onDrop = (e) => {
    e.preventDefault();
    const all = Array.from(e.dataTransfer.files || []);
    const base = all.find(f => /\.json$/i.test(f.name));
    // файл общей базы можно просто бросить сюда же — он сольётся с текущей
    if (base) this.mergeFromFile(base);
    const sheets = all.filter(f => /\.xlsx$/i.test(f.name));
    if (sheets.length) this.processFiles(sheets);
  };
  onDragOver = (e) => { e.preventDefault(); };
  openFileDialog = () => { this.fileInputRef.current && this.fileInputRef.current.click(); };

  processFiles(files) {
    if (!files.length) return;
    const db = this.state.db || this.emptyDb();
    const messages = [];
    let pending = files.length;
    const done = () => {
      pending--;
      if (pending === 0) {
        this.persist(db);
        this.setState({ db, messages: messages.length ? messages : ['Готово: данные загружены.'] });
      }
    };
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: 'array' });
          const parsed = this.handleWorkbook(wb, file.name, messages);
          if (parsed) {
            this.mergeUpload(db, parsed.startIso, parsed.section, parsed.items, messages);
            this.stampSection(db, parsed.startIso, parsed.section);
            messages.push(`${file.name}: ${SECTION_LABEL[parsed.section]}, неделя ${weekLabel(parsed.startIso)} — ${parsed.items.length} позиций.`);
            if (parsed.remainders && parsed.remainders.length) {
              const list = parsed.remainders
                .map(r => `${r.category} (не хватает ${fmtNum(r.qty)} шт, ${fmtRub(r.revenue)})`)
                .join('; ');
              messages.push(`⚠ В этом файле итог по категории больше суммы напечатанных строк: ${list}. Разница записана строкой «${REMAINDER_NAME}». Если нужны сами позиции — выгрузите эту неделю из учётной системы заново.`);
            }
          }
        } catch (err) {
          messages.push(`Ошибка при чтении «${file.name}»: ${err.message}`);
        }
        done();
      };
      reader.onerror = () => { messages.push(`Не удалось прочитать «${file.name}».`); done(); };
      reader.readAsArrayBuffer(file);
    });
  }

  // Когда какой раздел недели записан — по этим отметкам сливаются базы
  stampSection(db, weekIso, section) {
    if (!db.stamps) db.stamps = {};
    db.stamps[weekIso + '|' + section] = Date.now();
  }

  // Базовые значения наценки и себестоимости шеф вписывает руками.
  // На расчёты они не влияют — это ориентир для сравнения.
  baselineKey(metric, section, category, name) {
    return [metric, section, category, name || ''].join('|');
  }
  getBaseline(metric, section, category, name) {
    const v = (this.state.db.baseline || {})[this.baselineKey(metric, section, category, name)];
    return v == null ? '' : String(v);
  }
  setBaseline(metric, section, category, name, raw) {
    const db = this.state.db;
    if (!db.baseline) db.baseline = {};
    const key = this.baselineKey(metric, section, category, name);
    const text = String(raw == null ? '' : raw).replace(',', '.').trim();
    if (!text) delete db.baseline[key];
    else {
      const num = Number(text);
      if (!isFinite(num)) return;
      db.baseline[key] = num;
    }
    this.persist(db);
    this.setState({ db });
  }

  deleteWeekSection(weekIso, section) {
    const db = this.state.db;
    if (!db.weeks[weekIso]) return;
    delete db.weeks[weekIso][section];
    if (!db.weeks[weekIso].kitchen && !db.weeks[weekIso].bar) delete db.weeks[weekIso];
    this.persist(db);
    this.setState({ db });
  }

  /**
   * Сливает чужую базу со своей. Недели независимы, поэтому конфликтов почти
   * нет: если один и тот же раздел недели есть у обоих, побеждает тот, что
   * записан позже. Всё остальное — справочники, банкеты — объединяется.
   */
  mergeDbs(mine, theirs) {
    const out = JSON.parse(JSON.stringify(mine));
    if (!out.stamps) out.stamps = {};
    const theirStamps = theirs.stamps || {};
    let added = 0, replaced = 0, kept = 0;

    for (const wk of Object.keys(theirs.weeks || {})) {
      for (const section of ['kitchen', 'bar']) {
        const incoming = theirs.weeks[wk] && theirs.weeks[wk][section];
        if (!incoming) continue;
        const existing = out.weeks[wk] && out.weeks[wk][section];
        if (!out.weeks[wk]) out.weeks[wk] = {};
        if (!existing) {
          out.weeks[wk][section] = incoming;
          added++;
        } else {
          const key = wk + '|' + section;
          // без отметки считаем данные старыми и своё не трогаем
          if ((theirStamps[key] || 0) > (out.stamps[key] || 0)) {
            out.weeks[wk][section] = incoming;
            replaced++;
          } else {
            kept++;
          }
        }
        const key = wk + '|' + section;
        if ((theirStamps[key] || 0) > (out.stamps[key] || 0)) out.stamps[key] = theirStamps[key];
      }
    }

    // справочники: своё в приоритете, чужое добавляется
    for (const section of ['kitchen', 'bar']) {
      out.registry[section] = { ...(theirs.registry && theirs.registry[section]), ...out.registry[section] };
      out.itemCategory[section] = { ...(theirs.itemCategory && theirs.itemCategory[section]), ...out.itemCategory[section] };
    }
    out.groups = { ...(theirs.groups || {}), ...(out.groups || {}) };
    out.baseline = { ...(theirs.baseline || {}), ...(out.baseline || {}) };

    const seen = new Set((out.banquets || []).map(b => b.id));
    let banquets = 0;
    for (const b of theirs.banquets || []) {
      if (seen.has(b.id)) continue;
      out.banquets.push(b);
      seen.add(b.id);
      banquets++;
    }
    return { db: out, added, replaced, kept, banquets };
  };

  onExport = () => {
    const blob = new Blob([JSON.stringify(this.state.db)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    // имя постоянное: в общей папке файл должен заменять сам себя
    a.href = url; a.download = 'истина-база.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  openImportDialog = () => { this.importInputRef.current && this.importInputRef.current.click(); };
  onImportFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) this.mergeFromFile(file);
  };
  mergeFromFile = (file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.weeks || !parsed.registry) throw new Error('неверный формат файла');
        const res = this.mergeDbs(this.state.db, parsed);
        const parts = [];
        if (res.added) parts.push(`добавлено разделов недель: ${res.added}`);
        if (res.replaced) parts.push(`обновлено более свежими: ${res.replaced}`);
        if (res.kept) parts.push(`оставлено своих (они новее): ${res.kept}`);
        if (res.banquets) parts.push(`банкетов: ${res.banquets}`);
        const summary = parts.length ? parts.join(', ') : 'нового в файле не оказалось';
        if (!window.confirm(`Объединить базы?\n\n${summary}.\n\nВаши данные не пропадут: недели, которых нет в файле, останутся на месте.`)) return;
        this.dropWeeksBefore(res.db, this.seedCutoff());
        this.persist(res.db);
        this.setState({ db: res.db, importError: '', uploadLog: [`База объединена с файлом «${file.name}»: ${summary}.`] });
      } catch (err) {
        this.setState({ importError: 'Не удалось прочитать файл базы: ' + err.message });
      }
    };
    reader.readAsText(file);
  };
  onClearAll = () => {
    if (!window.confirm('Удалить все загруженные данные без возможности восстановления?')) return;
    const db = this.emptyDb();
    this.persist(db);
    this.setState({ db, messages: [] });
  };

  onBanquetFieldChange = (field, e) => { const v = e.target.value; this.setState(s => ({ banquetForm: { ...s.banquetForm, [field]: v } })); };
  addBanquet = () => {
    const f = this.state.banquetForm;
    if (!f.weekIso) { window.alert('Выберите неделю банкета.'); return; }
    const num = (v) => Number(String(v).replace(',', '.')) || 0;
    const record = {
      id: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      weekIso: f.weekIso,
      totalRevenue: num(f.totalRevenue),
      kitchenRevenue: num(f.kitchenRevenue),
      barRevenue: num(f.barRevenue),
      kitchenProfit: num(f.kitchenProfit),
      barProfit: num(f.barProfit),
    };
    const db = this.state.db;
    db.banquets = db.banquets || [];
    db.banquets.push(record);
    this.persist(db);
    this.setState({ db, banquetForm: { weekIso: '', totalRevenue: '', kitchenRevenue: '', barRevenue: '', kitchenProfit: '', barProfit: '' } });
  };
  deleteBanquet = (id) => {
    const db = this.state.db;
    db.banquets = (db.banquets || []).filter(b => b.id !== id);
    this.persist(db);
    this.setState({ db });
  };

  weekAggregate(db, wk, section) {
    const rows = this.flatten(db, [wk], section);
    const agg = this.aggregate(rows);
    const banquets = this.state.groupFilter ? [] : (db.banquets || []).filter(b => b.weekIso === wk);
    for (const b of banquets) {
      if (section === 'all') { agg.revenue += (b.kitchenRevenue || 0) + (b.barRevenue || 0); agg.profit += (b.kitchenProfit || 0) + (b.barProfit || 0); }
      else if (section === 'kitchen') { agg.revenue += b.kitchenRevenue || 0; agg.profit += b.kitchenProfit || 0; }
      else if (section === 'bar') { agg.revenue += b.barRevenue || 0; agg.profit += b.barProfit || 0; }
    }
    return agg;
  }
  rangeAggregate(db, weeksList, section) {
    const total = { qty: 0, revenue: 0, profit: 0, costTotal: 0 };
    for (const wk of weeksList) {
      const a = this.weekAggregate(db, wk, section);
      total.qty += a.qty; total.revenue += a.revenue; total.profit += a.profit; total.costTotal += a.costTotal;
    }
    total.costTotal = total.revenue - total.profit;
    total.markup = total.costTotal > 0 ? (total.profit / total.costTotal) * 100 : null;
    return total;
  }

  goDashboard = () => this.setState({ tab: 'dashboard' });
  goTable = () => this.setState((s) => ({ tab: 'table', section: s.section === 'all' ? 'kitchen' : s.section }));
  goData = () => this.setState({ tab: 'data' });
  setTableMetric = (key) => this.setState({ tableMetric: key });
  setTrendTotal = () => this.setState({ trendScope: 'total' });
  setTrendKitchen = () => this.setState({ trendScope: 'kitchen' });
  setTrendBar = () => this.setState({ trendScope: 'bar' });
  setSectionAll = () => this.setState({ section: 'all', category: '', trendScope: 'total' });
  setSectionKitchen = () => this.setState({ section: 'kitchen', category: '', groupFilter: '', trendScope: 'kitchen' });
  setSectionBar = () => this.setState({ section: 'bar', category: '', trendScope: 'bar' });
  onPeriodChange = (e) => this.setState({ period: e.target.value });
  onCustomFromChange = (e) => this.setState({ customFrom: e.target.value });
  onCustomToChange = (e) => this.setState({ customTo: e.target.value });
  onCategoryChange = (e) => this.setState({ category: e.target.value });
  toggleCategoryDropdown = () => this.setState(s => ({ categoryDropdownOpen: !s.categoryDropdownOpen }));
  toggleCategoryOption = (name) => this.setState(s => {
    const set = new Set(s.categoryFilter);
    if (set.has(name)) set.delete(name); else set.add(name);
    return { categoryFilter: Array.from(set) };
  });
  clearCategoryFilter = () => this.setState({ categoryFilter: [] });
  onGroupChange = (e) => this.setState({ groupFilter: e.target.value });
  setCategoryGroup = (category, group) => {
    const db = this.state.db;
    db.groups = { ...(db.groups || {}) };
    if (group) db.groups[category] = group; else delete db.groups[category];
    this.persist(db);
    this.setState({ db });
  };
  onSearchChange = (e) => this.setState({ search: e.target.value });
  toggleCategory = (key) => this.setState({ expanded: { ...this.state.expanded, [key]: !this.state.expanded[key] } });
  setSort = (key) => {
    if (this.state.sortBy === key) this.setState({ sortDir: this.state.sortDir === 'desc' ? 'asc' : 'desc' });
    else this.setState({ sortBy: key, sortDir: key === 'name' ? 'asc' : 'desc' });
  };
  // Позиции внутри категории сортируются отдельно от самих категорий
  setItemSort = (key) => {
    if (this.state.itemSortBy === key) this.setState({ itemSortDir: this.state.itemSortDir === 'desc' ? 'asc' : 'desc' });
    else this.setState({ itemSortBy: key, itemSortDir: key === 'name' ? 'asc' : 'desc' });
  };

  selectedWeeks(db) {
    const all = Object.keys(db.weeks).sort();
    if (this.state.period === 'custom') {
      const from = this.state.customFrom || (all[0] || '');
      const to = this.state.customTo || (all.length ? isoLocal(addDays(all[all.length - 1], 6)) : '');
      return all.filter(wk => wk <= to && isoLocal(addDays(wk, 6)) >= from);
    }
    // «Предыдущая неделя» — предпоследняя из загруженных
    if (this.state.period === 'prev') return all.length > 1 ? [all[all.length - 2]] : all.slice(-1);
    const n = { w1: 1, last4: 4, last8: 8, last15: 15, last26: 26 }[this.state.period] || 8;
    return all.slice(-n);
  }
  previousWeeks(db, current) {
    if (!current.length || this.state.period === 'custom') return [];
    const all = Object.keys(db.weeks).sort();
    const idx = all.indexOf(current[0]);
    if (idx <= 0) return [];
    return all.slice(Math.max(0, idx - current.length), idx);
  }

  flatten(db, weekIsos, sectionFilter) {
    const out = [];
    const groupFilter = this.state.groupFilter;
    const groups = db.groups || {};
    for (const wk of weekIsos) {
      const w = db.weeks[wk];
      if (!w) continue;
      for (const section of ['kitchen', 'bar']) {
        if (sectionFilter !== 'all' && sectionFilter !== section) continue;
        const items = w[section];
        if (!items) continue;
        for (const it of items) {
          if (groupFilter && !(section === 'bar' && groups[it.category] === groupFilter)) continue;
          out.push({ ...it, week: wk, section });
        }
      }
    }
    return out;
  }

  aggregate(rows) {
    let qty = 0, revenue = 0, profit = 0;
    for (const r of rows) {
      qty += r.qty || 0; revenue += r.revenue || 0; profit += r.profit || 0;
    }
    // Себестоимость по определению = выручка − валовая прибыль. Именно так
    // считает «Итого» в выгрузке. Сумма «цена за единицу × количество» даёт
    // другую цифру: цена округлена до копеек, а у части строк её нет вовсе.
    const costTotal = revenue - profit;
    const markup = costTotal > 0 ? (profit / costTotal) * 100 : null;
    return { qty, revenue, profit, costTotal, markup };
  }

  buildAreaChart(items) {
    const baselineY = 158, plotH = 128, height = 180;
    const n = Math.max(1, items.length);
    const max = Math.max(1, ...items.map(it => Math.max(it.a, it.b)));
    const points = items.map((it, i) => {
      const x = ((i + 0.5) / n) * 1000;
      const yA = baselineY - (it.a / max) * plotH;
      const yB = baselineY - (it.b / max) * plotH;
      return { x, xPct: ((i + 0.5) / n * 100).toFixed(2), widthPct: (100 / n).toFixed(2), yA: yA.toFixed(1), yB: yB.toFixed(1), labelA: fmtCompact(it.a), labelB: fmtCompact(it.b), weekLabel: it.label };
    });
    const path = (key) => {
      if (!points.length) return '';
      const first = points[0], last = points[points.length - 1];
      return `M ${first.x},${baselineY} ` + points.map(p => `L ${p.x},${p[key]}`).join(' ') + ` L ${last.x},${baselineY} Z`;
    };
    const line = (key) => points.map(p => `${p.x},${p[key]}`).join(' ');
    return { height, wrapperHeight: height + 26, areaA: path('yA'), areaB: path('yB'), lineA: line('yA'), lineB: line('yB'), points };
  }

  byName(rows) {
    const map = new Map();
    for (const r of rows) {
      const key = r.section + '|' + r.name;
      let agg = map.get(key);
      if (!agg) { agg = { name: r.name, section: r.section, category: r.category, qty: 0, revenue: 0, profit: 0, costTotal: 0 }; map.set(key, agg); }
      agg.qty += r.qty || 0; agg.revenue += r.revenue || 0; agg.profit += r.profit || 0;
      agg.costTotal += (r.cost || 0) * (r.qty || 0);
      agg.category = r.category;
    }
    return Array.from(map.values());
  }

  byCategory(rows) {
    const map = new Map();
    for (const r of rows) {
      const key = r.section + '|' + r.category;
      let agg = map.get(key);
      if (!agg) { agg = { key, name: r.category, section: r.section, qty: 0, revenue: 0, profit: 0, costTotal: 0, items: new Map() }; map.set(key, agg); }
      agg.qty += r.qty || 0; agg.revenue += r.revenue || 0; agg.profit += r.profit || 0;
      agg.costTotal += (r.cost || 0) * (r.qty || 0);
      const ik = r.name;
      let item = agg.items.get(ik);
      if (!item) { item = { name: r.name, qty: 0, revenue: 0, profit: 0, costTotal: 0 }; agg.items.set(ik, item); }
      item.qty += r.qty || 0; item.revenue += r.revenue || 0; item.profit += r.profit || 0;
      item.costTotal += (r.cost || 0) * (r.qty || 0);
    }
    return Array.from(map.values());
  }

  renderVals() {
    const db = this.state.db;
    if (!db) return {};
    const { tab, section, period, category, search, sortBy } = this.state;

    const weeksAll = Object.keys(db.weeks).sort();
    const weeksSel = this.selectedWeeks(db);
    const weeksPrev = this.previousWeeks(db, weeksSel);

    const rowsSel = this.flatten(db, weeksSel, section);
    const rowsPrev = this.flatten(db, weeksPrev, section);
    const cur = this.rangeAggregate(db, weeksSel, section);
    const prev = this.rangeAggregate(db, weeksPrev, section);

    const delta = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
    const deltaInfo = (val) => {
      if (val == null || !isFinite(val)) return { label: weeksPrev.length ? '—' : 'нет данных для сравнения', color: '#8a8579' };
      const good = val >= 0;
      return { label: `${good ? '+' : ''}${val.toFixed(1)}% к пред. периоду`, color: good ? '#3f7a4f' : '#b23b3b' };
    };

    const makeKpiCards = (curA, prevA) => [
      { label: 'Выручка', value: fmtRub(curA.revenue), ...(() => { const d = deltaInfo(delta(curA.revenue, prevA.revenue)); return { deltaLabel: d.label, deltaColor: d.color }; })() },
      { label: 'Прибыль', value: fmtRub(curA.profit), ...(() => { const d = deltaInfo(delta(curA.profit, prevA.profit)); return { deltaLabel: d.label, deltaColor: d.color }; })() },
      { label: 'Продажи, шт', value: fmtNum(curA.qty), ...(() => { const d = deltaInfo(delta(curA.qty, prevA.qty)); return { deltaLabel: d.label, deltaColor: d.color }; })() },
      { label: 'Средняя наценка', value: fmtPct(curA.markup), deltaLabel: '', deltaColor: '#8a8579' },
    ];

    const rowsSelAll = this.flatten(db, weeksSel, 'all');
    const rowsPrevAll = this.flatten(db, weeksPrev, 'all');
    const allKpiGroups = [
      { key: 'kitchen', title: 'Кухня', color: '#a86b1f', highlight: false, cards: makeKpiCards(this.rangeAggregate(db, weeksSel, 'kitchen'), this.rangeAggregate(db, weeksPrev, 'kitchen')) },
      { key: 'bar', title: 'Бар', color: '#3d5a80', highlight: false, cards: makeKpiCards(this.rangeAggregate(db, weeksSel, 'bar'), this.rangeAggregate(db, weeksPrev, 'bar')) },
      { key: 'all', title: 'Общее', color: '#20201d', highlight: false, cards: makeKpiCards(this.rangeAggregate(db, weeksSel, 'all'), this.rangeAggregate(db, weeksPrev, 'all')) },
    ];
    const totalGroup = allKpiGroups.find(g => g.key === 'all');
    const kpiGroups = section === 'all'
      ? [{ ...totalGroup, highlight: true, title: 'Общее по предприятию' }, ...allKpiGroups.filter(g => g.key !== 'all')]
      : allKpiGroups.filter(g => g.key === section);
    for (const g of kpiGroups) {
      g.wrapBg = g.highlight ? '#20201d' : 'transparent';
      g.wrapPad = g.highlight ? '16px 16px 4px' : '0';
      g.wrapRadius = g.highlight ? '14px' : '0';
      g.titleColor = g.highlight ? '#e8c896' : g.color;
      g.marginBottom = g.highlight ? '18px' : '14px';
    }

    const kAgg = this.rangeAggregate(db, weeksSel, 'kitchen');
    const bAgg = this.rangeAggregate(db, weeksSel, 'bar');
    const splitRow = (label, kVal, bVal, fmt) => {
      const tot = kVal + bVal;
      const kPct = tot > 0 ? (kVal / tot) * 100 : 0;
      return { label, kitchenPct: kPct.toFixed(1), barPct: (100 - kPct).toFixed(1), kitchenLabel: `${fmt(kVal)} · ${fmtPct(kPct)}`, barLabel: `${fmtPct(100 - kPct)} · ${fmt(bVal)}` };
    };
    const splitRows = [
      splitRow('Выручка', kAgg.revenue, bAgg.revenue, fmtRub),
      splitRow('Прибыль', kAgg.profit, bAgg.profit, fmtRub),
      splitRow('Количество', kAgg.qty, bAgg.qty, fmtNum),
    ];

    // trend (independent of the section toggle — has its own scope switch)
    const trendScope = this.state.trendScope;
    const trendRows = weeksSel.map(wk => ({ wk, agg: this.weekAggregate(db, wk, trendScope === 'total' ? 'all' : trendScope) }));
    const maxRev = Math.max(1, ...trendRows.map(t => t.agg.revenue));
    const trendPoints = trendRows.map(t => ({
      label: weekLabel(t.wk),
      revH: Math.max(2, (t.agg.revenue / maxRev) * 100).toFixed(1),
      profH: Math.max(1, (t.agg.profit / maxRev) * 100).toFixed(1),
      revLabel: fmtCompact(t.agg.revenue),
      profLabel: fmtCompact(t.agg.profit),
      revTitle: `Выручка: ${fmtRub(t.agg.revenue)}`,
      profTitle: `Прибыль: ${fmtRub(t.agg.profit)}`,
    }));
    const trendActiveStyle = (v) => v ? { bg: '#20201d', color: '#f7f5f0' } : { bg: 'transparent', color: '#5b5850' };
    const tT = trendActiveStyle(trendScope === 'total'), tK = trendActiveStyle(trendScope === 'kitchen'), tB = trendActiveStyle(trendScope === 'bar');
    const trendChart = this.buildAreaChart(trendRows.map(t => ({ label: weekLabel(t.wk), a: t.agg.revenue, b: t.agg.profit })));
    const dashboardTopCols = weeksSel.length <= 8 ? 'repeat(auto-fit,minmax(360px,1fr))' : '1fr';

    // kitchen vs bar comparison per week
    const kBarRows = weeksSel.map(wk => ({
      wk,
      k: this.weekAggregate(db, wk, 'kitchen'),
      b: this.weekAggregate(db, wk, 'bar'),
    }));
    const compareRevChart = this.buildAreaChart(kBarRows.map(r => ({ label: weekLabel(r.wk), a: r.k.revenue, b: r.b.revenue })));
    const compareProfitChart = this.buildAreaChart(kBarRows.map(r => ({ label: weekLabel(r.wk), a: r.k.profit, b: r.b.profit })));

    // top panels
    const topPanel = (sec, color, title) => {
      const names = this.byName(rowsSelAll.filter(r => r.section === sec));
      const byQty = names.slice().sort((a, b) => b.qty - a.qty).slice(0, 3).map((n, i) => ({ rank: i + 1, name: n.name, value: fmtNum(n.qty) + ' шт' }));
      const byProfit = names.slice().sort((a, b) => b.profit - a.profit).slice(0, 3).map((n, i) => ({ rank: i + 1, name: n.name, value: fmtRub(n.profit) }));
      return { title, color, byQty, byProfit };
    };
    const topPanels = [];
    if (section !== 'bar') topPanels.push(topPanel('kitchen', '#a86b1f', 'Топ-3 кухни'));
    if (section !== 'kitchen') topPanels.push(topPanel('bar', '#3d5a80', 'Топ-3 бара'));

    // category options for filter (depends on section)
    const catSet = new Set();
    for (const wk of weeksAll) {
      for (const sec of ['kitchen', 'bar']) {
        if (section !== 'all' && section !== sec) continue;
        const items = db.weeks[wk] && db.weeks[wk][sec];
        if (items) for (const it of items) catSet.add(it.category);
      }
    }
    const categoryFilter = this.state.categoryFilter;
    const categoryCheckboxes = Array.from(catSet).sort((a, b) => a.localeCompare(b, 'ru')).map(name => ({
      name, checked: categoryFilter.includes(name), onToggle: () => this.toggleCategoryOption(name),
    }));
    const categoryButtonLabel = categoryFilter.length ? `Категории (${categoryFilter.length})` : 'Все категории';

    // table rows — pivoted by week
    let tableRows = rowsSel;
    if (categoryFilter.length) tableRows = tableRows.filter(r => categoryFilter.includes(r.category));
    const searchNorm = normName(search);
    const tableMetric = this.state.tableMetric;
    // столбец с базовым значением нужен только там, где шеф с ним сравнивает
    const showBaseline = tableMetric === 'markup' || tableMetric === 'cost';
    const emptyAgg = () => ({ qty: 0, revenue: 0, profit: 0, costTotal: 0 });
    const addAgg = (a, b) => { a.qty += b.qty || 0; a.revenue += b.revenue || 0; a.profit += b.profit || 0; a.costTotal += b.costTotal || 0; };
    const metricValue = (agg, metric) => {
      if (metric === 'qty') return fmtNum(agg.qty);
      if (metric === 'revenue') return fmtRub(agg.revenue);
      if (metric === 'profit') return fmtRub(agg.profit);
      if (metric === 'cost') return agg.qty > 0 ? fmtRub(agg.costTotal / agg.qty) : '—';
      return agg.costTotal > 0 ? fmtPct((agg.profit / agg.costTotal) * 100) : '—';
    };
    const sortMetricVal = (agg, metric) => {
      if (metric === 'qty') return agg.qty;
      if (metric === 'revenue') return agg.revenue;
      if (metric === 'profit') return agg.profit;
      if (metric === 'cost') return agg.qty > 0 ? agg.costTotal / agg.qty : -1;
      return agg.costTotal > 0 ? agg.profit / agg.costTotal : -1;
    };

    const catMap = new Map();
    for (const r of tableRows) {
      if (!catMap.has(r.category)) catMap.set(r.category, new Map());
      const itemsMap = catMap.get(r.category);
      if (!itemsMap.has(r.name)) itemsMap.set(r.name, new Map());
      const weekMap = itemsMap.get(r.name);
      if (!weekMap.has(r.week)) weekMap.set(r.week, emptyAgg());
      const agg = weekMap.get(r.week);
      agg.qty += r.qty || 0; agg.revenue += r.revenue || 0; agg.profit += r.profit || 0; agg.costTotal += (r.cost || 0) * (r.qty || 0);
    }

    let catEntries = Array.from(catMap.entries()).map(([catName, itemsMap]) => {
      let itemEntries = Array.from(itemsMap.entries());
      if (searchNorm) itemEntries = itemEntries.filter(([name]) => normName(name).includes(searchNorm));
      const items = itemEntries.map(([name, weekMap]) => {
        const total = emptyAgg();
        for (const agg of weekMap.values()) addAgg(total, agg);
        return { name, weekMap, total };
      });
      const catTotal = emptyAgg();
      const catByWeek = new Map();
      for (const it of items) {
        addAgg(catTotal, it.total);
        for (const [wk, agg] of it.weekMap.entries()) {
          if (!catByWeek.has(wk)) catByWeek.set(wk, emptyAgg());
          addAgg(catByWeek.get(wk), agg);
        }
      }
      return { key: catName, name: catName, items, total: catTotal, byWeek: catByWeek };
    }).filter(c => c.items.length > 0);

    const sortDir = this.state.sortDir === 'asc' ? 1 : -1;
    const compareEntries = (a, b) => {
      if (this.state.sortBy === 'name') return sortDir * a.name.localeCompare(b.name, 'ru');
      return sortDir * (sortMetricVal(a.total, tableMetric) - sortMetricVal(b.total, tableMetric));
    };
    catEntries.sort(compareEntries);

    const itemSortDir = this.state.itemSortDir === 'asc' ? 1 : -1;
    const compareItems = (a, b) => {
      if (this.state.itemSortBy === 'name') return itemSortDir * a.name.localeCompare(b.name, 'ru');
      return itemSortDir * (sortMetricVal(a.total, tableMetric) - sortMetricVal(b.total, tableMetric));
    };

    const weekColumns = weeksSel.map(wk => ({ label: weekLabel(wk) }));
    const categoryRows = catEntries.map(c => {
      const expanded = searchNorm ? true : !!this.state.expanded[c.key];
      const items = c.items.slice().sort(compareItems);
      return {
        key: c.key,
        name: c.name,
        color: section === 'kitchen' ? '#a86b1f' : '#3d5a80',
        expanded,
        arrow: expanded ? '▾' : '▸',
        onToggle: () => this.toggleCategory(c.key),
        baseline: showBaseline ? this.getBaseline(tableMetric, section, c.name, null) : '',
        onBaselineChange: (e) => this.setBaseline(tableMetric, section, c.name, null, e.target.value),
        // клик по полю не должен сворачивать категорию
        onBaselineClick: (e) => e.stopPropagation(),
        // Нет записи за неделю — значит данных нет, а не продано на ноль
        weekCells: weeksSel.map(wk => (c.byWeek.has(wk) ? metricValue(c.byWeek.get(wk), tableMetric) : '—')),
        totalCell: metricValue(c.total, tableMetric),
        items: items.map(it => ({
          name: it.name,
          baseline: showBaseline ? this.getBaseline(tableMetric, section, c.name, it.name) : '',
          onBaselineChange: (e) => this.setBaseline(tableMetric, section, c.name, it.name, e.target.value),
          weekCells: weeksSel.map(wk => (it.weekMap.has(wk) ? metricValue(it.weekMap.get(wk), tableMetric) : '—')),
          totalCell: metricValue(it.total, tableMetric),
        })),
      };
    });
    const grandByWeek = new Map();
    const grandTotalAgg = emptyAgg();
    for (const c of catEntries) {
      addAgg(grandTotalAgg, c.total);
      for (const [wk, agg] of c.byWeek.entries()) {
        if (!grandByWeek.has(wk)) grandByWeek.set(wk, emptyAgg());
        addAgg(grandByWeek.get(wk), agg);
      }
    }
    const grandTotalCells = weeksSel.map(wk => (grandByWeek.has(wk) ? metricValue(grandByWeek.get(wk), tableMetric) : '—'));
    const grandTotalCell = metricValue(grandTotalAgg, tableMetric);
    const tableGridCols = showBaseline
      ? `minmax(220px,260px) 96px repeat(${weeksSel.length}, 100px) 110px`
      : `minmax(220px,260px) repeat(${weeksSel.length}, 100px) 110px`;

    const metricDefs = [
      { key: 'markup', label: 'Наценка' },
      { key: 'cost', label: 'Себестоимость' },
      { key: 'qty', label: 'Количество' },
      { key: 'revenue', label: 'Выручка' },
      { key: 'profit', label: 'Прибыль' },
    ];
    const metricTags = metricDefs.map(m => {
      const active = tableMetric === m.key;
      return { label: m.label, onClick: () => this.setTableMetric(m.key), bg: active ? '#20201d' : 'transparent', color: active ? '#f7f5f0' : '#5b5850' };
    });

    // data tab weeks list
    const weeksList = weeksAll.slice().reverse().map(wk => {
      const has = (s) => !!(db.weeks[wk] && db.weeks[wk][s]);
      return {
        label: weekLabel(wk),
        kitchenBg: has('kitchen') ? 'rgba(168,107,31,0.14)' : '#f2efe8',
        kitchenColor: has('kitchen') ? '#a86b1f' : '#b3ada0',
        kitchenMark: has('kitchen') ? ' ✓' : '',
        barBg: has('bar') ? 'rgba(61,90,128,0.14)' : '#f2efe8',
        barColor: has('bar') ? '#3d5a80' : '#b3ada0',
        barMark: has('bar') ? ' ✓' : '',
        // Разделы удаляются по отдельности: бар можно перезалить, не трогая кухню
        kitchenCursor: has('kitchen') ? 'pointer' : 'default',
        kitchenTitle: has('kitchen') ? 'Удалить данные кухни за эту неделю' : 'Данных по кухне нет',
        onDeleteKitchen: () => {
          if (!has('kitchen')) return;
          if (window.confirm(`Удалить данные кухни за ${weekLabel(wk)}?`)) this.deleteWeekSection(wk, 'kitchen');
        },
        barCursor: has('bar') ? 'pointer' : 'default',
        barTitle: has('bar') ? 'Удалить данные бара за эту неделю' : 'Данных по бару нет',
        onDeleteBar: () => {
          if (!has('bar')) return;
          if (window.confirm(`Удалить данные бара за ${weekLabel(wk)}?`)) this.deleteWeekSection(wk, 'bar');
        },
        onDelete: () => { if (window.confirm(`Удалить неделю ${weekLabel(wk)} целиком — и кухню, и бар?`)) { this.deleteWeekSection(wk, 'kitchen'); this.deleteWeekSection(wk, 'bar'); } },
      };
    });

    const periodOptions = [
      { value: 'w1', label: 'Последняя неделя' },
      { value: 'prev', label: 'Предыдущая неделя' },
      { value: 'last4', label: 'Последние 4 недели' },
      { value: 'last8', label: 'Последние 8 недель' },
      { value: 'last15', label: 'Последние 15 недель' },
      { value: 'last26', label: 'Последние полгода' },
      { value: 'custom', label: 'Свой период' },
    ];

    const activeStyle = (v) => v ? { bg: '#20201d', color: '#f7f5f0' } : { bg: 'transparent', color: '#5b5850' };
    const sA = activeStyle(section === 'all'), sK = activeStyle(section === 'kitchen'), sB = activeStyle(section === 'bar');

    const banquetWeekOptions = [{ value: '', label: 'Выберите неделю' }].concat(
      weeksAll.slice().reverse().map(wk => ({ value: wk, label: weekLabel(wk) }))
    );
    const banquetList = (db.banquets || []).slice().sort((a, b) => b.weekIso.localeCompare(a.weekIso)).map(b => ({
      id: b.id,
      weekLabel: weekLabel(b.weekIso),
      totalRevenue: fmtRub(b.totalRevenue),
      kitchenRevenue: fmtRub(b.kitchenRevenue),
      barRevenue: fmtRub(b.barRevenue),
      kitchenProfit: fmtRub(b.kitchenProfit),
      barProfit: fmtRub(b.barProfit),
      onDelete: () => { if (window.confirm('Удалить эту запись о банкете?')) this.deleteBanquet(b.id); },
    }));

    // Группы бара задаются вручную: в выгрузке их нет, только категории.
    const groups = db.groups || {};
    const barCategories = new Set();
    for (const wk of weeksAll) {
      const items = (db.weeks[wk] || {}).bar || [];
      for (const it of items) barCategories.add(it.category);
    }
    for (const c of Object.keys(groups)) barCategories.add(c);
    const groupNames = Array.from(new Set(Object.values(groups).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'));
    const groupOptions = [{ value: '', label: 'Все группы бара' }].concat(groupNames.map(g => ({ value: g, label: g })));
    const groupRows = Array.from(barCategories).sort((a, b) => a.localeCompare(b, 'ru')).map(cat => ({
      category: cat,
      group: groups[cat] || '',
      options: [{ value: '', label: '— без группы —' }].concat(groupNames.map(g => ({ value: g, label: g }))),
      onChange: (e) => {
        const v = e.target.value;
        if (v === '__new') {
          const name = window.prompt('Название новой группы:');
          if (name && name.trim()) this.setCategoryGroup(cat, name.trim());
          return;
        }
        this.setCategoryGroup(cat, v);
      },
    }));
    for (const r of groupRows) r.options.push({ value: '__new', label: '＋ новая группа…' });

    // Неполные недели: загружен только один раздел из двух.
    const gaps = weeksSel.filter(wk => {
      const w = db.weeks[wk] || {};
      return !w.kitchen || !w.bar;
    }).map(wk => {
      const w = db.weeks[wk] || {};
      const missing = [!w.kitchen && 'кухни', !w.bar && 'бара'].filter(Boolean).join(' и ');
      return `${weekLabel(wk)} — нет выгрузки ${missing}`;
    });

    return {
      groupOptions,
      groupFilter: this.state.groupFilter,
      onGroupChange: this.onGroupChange,
      showGroupFilter: groupNames.length > 0 && section !== 'kitchen',
      groupRows,
      hasGroupRows: groupRows.length > 0,
      gapsLabel: gaps.length ? `Неполные недели в срезе: ${gaps.join('; ')}. Считаются по тому, что есть, а не нулём.` : '',
      hasGaps: gaps.length > 0,
      weeksCountLabel: weeksAll.length ? `${weeksAll.length} ${pluralWeeks(weeksAll.length)} в базе` : 'Нет данных',
      tabIsDashboard: tab === 'dashboard', tabIsTable: tab === 'table', tabIsData: tab === 'data',
      showFilterBar: tab === 'dashboard' || tab === 'table',
      goDashboard: this.goDashboard, goTable: this.goTable, goData: this.goData,
      period, periodOptions,
      periodIsCustom: period === 'custom',
      customFrom: this.state.customFrom || (weeksSel[0] || ''),
      customTo: this.state.customTo || (weeksSel.length ? isoLocal(addDays(weeksSel[weeksSel.length - 1], 6)) : ''),
      onCustomFromChange: this.onCustomFromChange, onCustomToChange: this.onCustomToChange,
      periodRangeLabel: weeksSel.length ? `${fmtDay(weeksSel[0])} — ${fmtDay(isoLocal(addDays(weeksSel[weeksSel.length - 1], 6)))}` : '',
      onPeriodChange: this.onPeriodChange,
      setSectionAll: this.setSectionAll, setSectionKitchen: this.setSectionKitchen, setSectionBar: this.setSectionBar,
      sectionAllBg: sA.bg, sectionAllColor: sA.color, sectionKitchenBg: sK.bg, sectionKitchenColor: sK.color, sectionBarBg: sB.bg, sectionBarColor: sB.color,
      categoryCheckboxes, categoryButtonLabel, hasCategoryFilter: categoryFilter.length > 0,
      categoryDropdownOpen: this.state.categoryDropdownOpen,
      onToggleCategoryDropdown: this.toggleCategoryDropdown, onClearCategoryFilter: this.clearCategoryFilter,
      search, onSearchChange: this.onSearchChange,
      itemSortByNameClick: () => this.setItemSort('name'), itemSortByValueClick: () => this.setItemSort('value'),
      itemSortByNameBg: this.state.itemSortBy === 'name' ? '#20201d' : 'transparent',
      itemSortByNameColor: this.state.itemSortBy === 'name' ? '#f7f5f0' : '#5b5850',
      itemSortByValueBg: this.state.itemSortBy === 'value' ? '#20201d' : 'transparent',
      itemSortByValueColor: this.state.itemSortBy === 'value' ? '#f7f5f0' : '#5b5850',
      itemSortByNameArrow: this.state.itemSortBy === 'name' ? (this.state.itemSortDir === 'asc' ? '↑' : '↓') : '',
      itemSortByValueArrow: this.state.itemSortBy === 'value' ? (this.state.itemSortDir === 'asc' ? '↑' : '↓') : '',
      hasNoDetail: catEntries.some(c => c.items.some(it => it.name === REMAINDER_NAME)),
      sortByNameClick: () => this.setSort('name'), sortByValueClick: () => this.setSort('value'),
      sortByNameBg: this.state.sortBy === 'name' ? '#20201d' : 'transparent', sortByNameColor: this.state.sortBy === 'name' ? '#f7f5f0' : '#5b5850',
      sortByNameArrow: this.state.sortBy === 'name' ? (this.state.sortDir === 'asc' ? '↑' : '↓') : '',
      sortByValueBg: this.state.sortBy === 'value' ? '#20201d' : 'transparent', sortByValueColor: this.state.sortBy === 'value' ? '#f7f5f0' : '#5b5850',
      sortByValueArrow: this.state.sortBy === 'value' ? (this.state.sortDir === 'asc' ? '↑' : '↓') : '',
      kpiGroups,
      splitRows,
      hasTrend: trendPoints.length > 0, noTrend: trendPoints.length === 0,
      dashboardTopCols,
      trendChart,
      trendScopeTitle: trendScope === 'total' ? 'общее' : trendScope === 'kitchen' ? 'кухня' : 'бар',
      setTrendTotal: this.setTrendTotal, setTrendKitchen: this.setTrendKitchen, setTrendBar: this.setTrendBar,
      trendTotalBg: tT.bg, trendTotalColor: tT.color, trendKitchenBg: tK.bg, trendKitchenColor: tK.color, trendBarBg: tB.bg, trendBarColor: tB.color,
      compareRevChart, compareProfitChart,
      topPanels,
      tableGridCols, showBaseline,
      baselineHeader: tableMetric === 'markup' ? 'База, %' : 'База, ₽',
      weekColumns,
      metricTags,
      categoryRows, noCategoryRows: categoryRows.length === 0,
      grandTotalCells, grandTotalCell,
      fileInputRef: this.fileInputRef, importInputRef: this.importInputRef,
      openFileDialog: this.openFileDialog, onFilesSelected: this.onFilesSelected,
      onDragOver: this.onDragOver, onDrop: this.onDrop,
      hasMessages: this.state.messages.length > 0, messages: this.state.messages,
      weeksList, noWeeks: weeksList.length === 0,
      onExport: this.onExport, openImportDialog: this.openImportDialog, onImportFile: this.onImportFile,
      importError: this.state.importError,
      onClearAll: this.onClearAll,
      banquetWeekOptions, banquetForm: this.state.banquetForm,
      onBanquetWeekChange: (e) => this.onBanquetFieldChange('weekIso', e),
      onBanquetTotalChange: (e) => this.onBanquetFieldChange('totalRevenue', e),
      onBanquetKitchenRevChange: (e) => this.onBanquetFieldChange('kitchenRevenue', e),
      onBanquetBarRevChange: (e) => this.onBanquetFieldChange('barRevenue', e),
      onBanquetKitchenProfitChange: (e) => this.onBanquetFieldChange('kitchenProfit', e),
      onBanquetBarProfitChange: (e) => this.onBanquetFieldChange('barProfit', e),
      onAddBanquet: this.addBanquet,
      banquetList, noBanquets: banquetList.length === 0,
    };
  }
}
