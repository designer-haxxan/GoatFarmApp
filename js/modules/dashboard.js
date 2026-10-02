import * as UI from '../core/ui.js';
import { esc, fmtNum, fmtDate, today, monthStart } from '../core/utils.js';
import * as idb from '../db/idb.js';
import * as Posting from '../services/posting.js';
import * as Catalog from '../services/catalog.js';
import { t } from '../i18n.js';
import { getSettings } from '../core/settings.js';

const $ = window.jQuery;
const cur = () => getSettings().currency;
const money = (n) => `${esc(cur())} ${fmtNum(n, 0)}`;

// ── SVG donut chart ────────────────────────────────────────────────────────────
function donutSVG(segs, size = 108) {
  const total = segs.reduce((s, d) => s + d.v, 0);
  if (!total) return `<div class="chart-empty text-body-secondary small">No data</div>`;
  const cx = size / 2, cy = size / 2, R = size * 0.41, r = size * 0.26;
  let a = -Math.PI / 2;
  const paths = segs.map(({ v, color }) => {
    const sweep = Math.min((v / total) * 2 * Math.PI, 2 * Math.PI - 0.001);
    const x1 = cx + R * Math.cos(a), y1 = cy + R * Math.sin(a);
    const x2 = cx + R * Math.cos(a + sweep), y2 = cy + R * Math.sin(a + sweep);
    const xi1 = cx + r * Math.cos(a + sweep), yi1 = cy + r * Math.sin(a + sweep);
    const xi2 = cx + r * Math.cos(a), yi2 = cy + r * Math.sin(a);
    const lg = sweep > Math.PI ? 1 : 0;
    const p = `M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${lg},1 ${x2.toFixed(2)},${y2.toFixed(2)} L${xi1.toFixed(2)},${yi1.toFixed(2)} A${r},${r} 0 ${lg},0 ${xi2.toFixed(2)},${yi2.toFixed(2)} Z`;
    a += sweep;
    return `<path d="${p}" fill="${color}"/>`;
  });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="flex-shrink:0">${paths.join('')}</svg>`;
}

// ── Horizontal bar rows ────────────────────────────────────────────────────────
function hBars(rows, maxVal) {
  if (!rows.length || !maxVal) return `<div class="chart-empty text-body-secondary small">No data</div>`;
  return rows.map(({ label, value, color }) => `
    <div class="dbar-row">
      <div class="dbar-label">${label}</div>
      <div class="dbar-track"><div class="dbar-fill" style="width:${(value / maxVal * 100).toFixed(1)}%;background:${color}"></div></div>
      <div class="dbar-val">${fmtNum(value)}</div>
    </div>`).join('');
}

// ── Vertical bar chart (trend) ─────────────────────────────────────────────────
function vBars(cols, color = 'var(--bs-primary)') {
  if (!cols.length) return `<div class="chart-empty text-body-secondary small text-center">No data</div>`;
  const max = Math.max(...cols.map(c => c.value), 1);
  return `<div class="vchart">${cols.map(({ label, value }) => `
    <div class="vchart-col">
      <div class="vchart-bar-wrap"><div class="vchart-bar" style="height:${(value / max * 100).toFixed(1)}%;background:${color}"></div></div>
      <div class="vchart-val">${value > 0 ? value : ''}</div>
      <div class="vchart-lbl">${label}</div>
    </div>`).join('')}</div>`;
}

// ── Legend item ────────────────────────────────────────────────────────────────
function legendDot(color, label, value) {
  return `<div class="dash-legend-item"><span class="dash-legend-dot" style="background:${color}"></span><span class="flex-grow-1">${label}</span><strong>${typeof value === 'string' ? value : fmtNum(value)}</strong></div>`;
}

// ── Chart card wrapper ─────────────────────────────────────────────────────────
function card(title, body, extra = '') {
  return `<div class="dash-chart-card">${extra}<div class="dash-chart-title">${title}</div>${body}</div>`;
}

// ── Build last-N-months counts ─────────────────────────────────────────────────
function lastMonths(records, getValue, n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (n - 1 - i));
    const prefix = d.toISOString().slice(0, 7);
    const label = d.toLocaleString('default', { month: 'short' });
    const value = records.filter(r => r.date?.startsWith(prefix)).reduce((s, r) => s + getValue(r), 0);
    return { label, value };
  });
}

// ── Build last-N-days counts ───────────────────────────────────────────────────
function lastDays(records, getValue, n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (n - 1 - i));
    const dateStr = d.toISOString().slice(0, 10);
    const label = i === n - 1 ? 'Today' : d.toLocaleString('default', { weekday: 'short' });
    const value = +records.filter(r => r.date === dateStr).reduce((s, r) => s + getValue(r), 0).toFixed(1);
    return { label, value };
  });
}

// ── Load all dashboard data ────────────────────────────────────────────────────
async function loadData() {
  const animals = Catalog.allAnimals();
  const active  = animals.filter(a => a.status === 'active');
  const males   = active.filter(a => a.gender === 'male').length;
  const females = active.filter(a => a.gender === 'female').length;
  const unknown = active.length - males - females;

  // Species breakdown
  const bySpecies = {};
  for (const a of active) {
    const sp = a.species || 'goat';
    bySpecies[sp] = (bySpecies[sp] || 0) + 1;
  }

  // Status breakdown (all animals, not just active)
  const byStatus = {};
  for (const a of animals) byStatus[a.status] = (byStatus[a.status] || 0) + 1;

  // Kidding records
  const mStart = monthStart();
  const [allKidding, allMilk, allMilkSales, allHealth, allExpenses] = await Promise.all([
    idb.getAll('kiddingRecords'),
    idb.getAll('milkRecords'),
    idb.getAll('milkSales'),
    idb.getAll('healthEvents'),
    idb.getAll('farmExpenses'),
  ]);

  const kiddingThisMonth = allKidding.filter(r => r.date >= mStart);
  const kidsThisMonth      = kiddingThisMonth.reduce((s, r) => s + (r.kidsAlive  || 0), 0);
  const maleKidsThisMonth  = kiddingThisMonth.reduce((s, r) => s + (r.maleKids   || 0), 0);
  const femaleKidsThisMonth = kiddingThisMonth.reduce((s, r) => s + (r.femaleKids || 0), 0);

  // Monthly trends
  const monthlyKids = lastMonths(allKidding, r => r.kidsAlive || 0, 6);
  const monthlyMilk = lastMonths(allMilk,    r => r.total || 0, 6);
  const dailyMilk   = lastDays(allMilk,      r => r.total || 0, 7);

  // Health event types
  const byEvtType = {};
  for (const h of allHealth) byEvtType[h.type] = (byEvtType[h.type] || 0) + 1;

  // Due vaccinations (next 14 days)
  const future14 = new Date(); future14.setDate(future14.getDate() + 14);
  const future14Str = future14.toISOString().slice(0, 10);
  const todayStr = today();
  const dueVax = allHealth.filter(h => h.nextDue && h.nextDue >= todayStr && h.nextDue <= future14Str);

  // Financials
  const bal = await Posting.allBalances();
  let buyerBal = 0, sellerBal = 0;
  for (const [id, b] of bal) {
    if (id.startsWith('B:')) buyerBal += b.balance;
    else if (id.startsWith('S:')) sellerBal -= b.balance;
  }
  const expMonth  = allExpenses.filter(e => e.date >= mStart).reduce((s, e) => s + (e.amount || 0), 0);
  const milkRevMonth = allMilkSales.filter(s => s.date >= mStart).reduce((s, r) => s + (r.total || 0), 0);

  // Recent kidding (last 6)
  const recentKidding = [...allKidding].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  return {
    total: animals.length, active: active.length,
    males, females, unknown,
    bySpecies, byStatus,
    kidsThisMonth, maleKidsThisMonth, femaleKidsThisMonth,
    monthlyKids, monthlyMilk, dailyMilk,
    byEvtType, dueVax,
    buyerBal, sellerBal, expMonth, milkRevMonth,
    recentKidding,
  };
}

// ── Render ─────────────────────────────────────────────────────────────────────
export default {
  async render(el) {
    const $el = $(el);
    $el.html(UI.pageHeader(t('dashboard')) + `
      <div class="stat-grid mb-3" id="ds-tiles">${UI.spinner('')}</div>
      <div class="dash-charts" id="ds-charts">${UI.spinner()}</div>
      <div class="row g-3" id="ds-bottom"></div>`);

    try {
      const s = await loadData();

      // ── Stat tiles ──────────────────────────────────────────────────────────
      const totalKids = s.monthlyKids.reduce((a, m) => a + m.value, 0);
      $('#ds-tiles').html(`
        <div class="stat-tile">
          <div class="st-icon">🐐</div>
          <div class="st-val">${s.active}</div>
          <div class="st-lbl">Active Animals</div>
        </div>
        <div class="stat-tile">
          <div class="st-icon" style="color:#1565c0">♂</div>
          <div class="st-val" style="color:#1565c0">${s.males}</div>
          <div class="st-lbl">Males</div>
        </div>
        <div class="stat-tile">
          <div class="st-icon text-pink">♀</div>
          <div class="st-val text-pink">${s.females}</div>
          <div class="st-lbl">Females</div>
        </div>
        <div class="stat-tile">
          <div class="st-icon">🍼</div>
          <div class="st-val text-success">${totalKids}</div>
          <div class="st-lbl">Total Kids Born</div>
        </div>`);

      // ── Gender donut ────────────────────────────────────────────────────────
      const gSegs = [
        { v: s.males,   color: '#1565c0', label: '♂ Male'    },
        { v: s.females, color: '#e91e63', label: '♀ Female'  },
        ...(s.unknown > 0 ? [{ v: s.unknown, color: '#9e9e9e', label: '? Unknown' }] : []),
      ];
      const genderCard = card('Gender Split',
        `<div class="dash-donut-wrap">
          ${donutSVG(gSegs)}
          <div class="dash-legend">
            ${gSegs.map(g => legendDot(g.color, g.label, g.v)).join('')}
            <div class="dash-legend-item mt-1 border-top pt-1"><span class="flex-grow-1" style="color:var(--bs-secondary-color)">Total active</span><strong>${s.active}</strong></div>
          </div>
        </div>`);

      // ── Species bars ────────────────────────────────────────────────────────
      const spColors  = { goat: '#2e7d32', sheep: '#66bb6a', cattle: '#bf8c40', buffalo: '#5d4037' };
      const spLabels  = { goat: '🐐 Goat', sheep: '🐑 Sheep', cattle: '🐄 Cattle', buffalo: '🐃 Buffalo' };
      const spRows    = Object.entries(s.bySpecies)
        .sort((a, b) => b[1] - a[1])
        .map(([sp, cnt]) => ({ label: spLabels[sp] || sp, value: cnt, color: spColors[sp] || '#607d8b' }));
      const speciesCard = card('By Species', hBars(spRows, Math.max(...spRows.map(r => r.value), 1)));

      // ── Kids monthly trend ──────────────────────────────────────────────────
      const kidsCard = card('Kids Born – Last 6 Months',
        vBars(s.monthlyKids, '#4caf50'));

      // ── Herd status ─────────────────────────────────────────────────────────
      const stColors = { active: '#4caf50', sold: '#2196f3', dead: '#9e9e9e', culled: '#ff9800', pregnant: '#e91e63' };
      const stRows = Object.entries(s.byStatus)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([st, cnt]) => ({ label: st.charAt(0).toUpperCase() + st.slice(1), value: cnt, color: stColors[st] || '#888' }));
      const statusCard = card('Herd Status', hBars(stRows, Math.max(...stRows.map(r => r.value), 1)));

      // ── Daily milk trend ────────────────────────────────────────────────────
      const milkCard = card('Milk (L) – Last 7 Days', vBars(s.dailyMilk, '#1565c0'));

      // ── Health events ────────────────────────────────────────────────────────
      const evtColors = { vaccination: '#1565c0', treatment: '#b71c1c', checkup: '#2e7d32', deworming: '#6a1b9a', vitamin: '#e65100' };
      const evtRows = Object.entries(s.byEvtType)
        .sort((a, b) => b[1] - a[1])
        .map(([tp, cnt]) => ({ label: tp.charAt(0).toUpperCase() + tp.slice(1), value: cnt, color: evtColors[tp] || '#607d8b' }));
      const healthCard = card('Health Events',
        evtRows.length
          ? hBars(evtRows, Math.max(...evtRows.map(r => r.value), 1))
          : `<div class="chart-empty text-body-secondary small">No health events</div>`);

      // ── Financials ───────────────────────────────────────────────────────────
      const finCard = card('Financials',
        `${legendDot('#4caf50', 'Buyer Balance',     money(s.buyerBal))}
         ${legendDot('#e91e63', 'Seller Balance',    money(s.sellerBal))}
         ${legendDot('#ff9800', 'Expenses (Month)',  money(s.expMonth))}
         ${legendDot('#1565c0', 'Milk Revenue (Mo)', money(s.milkRevMonth))}
         ${s.dueVax.length ? `<div class="mt-2 small text-warning"><i class="bi bi-heart-pulse me-1"></i>${s.dueVax.length} vaccination${s.dueVax.length > 1 ? 's' : ''} due in 14 days — <a href="#/health">view</a></div>` : ''}`);

      $('#ds-charts').html(genderCard + speciesCard + kidsCard + statusCard + milkCard + healthCard + finCard);

      // ── Bottom: recent breeding + kids this month breakdown ─────────────────
      const recentHtml = s.recentKidding.length
        ? s.recentKidding.map(r => {
            const dam   = Catalog.animal(r.damId);
            const alive = r.kidsAlive  || 0;
            const m     = r.maleKids   || 0;
            const f     = r.femaleKids || 0;
            return `<div class="list-row">
              <div class="thumb"><i class="bi bi-hearts text-danger"></i></div>
              <div class="main">
                <div class="title">${dam ? esc(dam.tagNo + (dam.name ? ' — ' + dam.name : '')) : '(unknown)'}</div>
                <div class="sub">${fmtDate(r.date)}${r.crossingDate ? ' · Mated ' + fmtDate(r.crossingDate) : ''} · Litter ${r.litterSize || 0}</div>
              </div>
              <div class="end text-center" style="min-width:80px">
                <div class="fw-bold text-success">${alive} alive</div>
                <div class="small"><span style="color:#1565c0">♂${m}</span> <span class="text-pink">♀${f}</span></div>
              </div>
            </div>`;
          }).join('')
        : UI.emptyState('No breeding records yet', 'hearts', `<a href="#/kidding" class="btn btn-success btn-sm mt-2">Add first record</a>`);

      const kidsDetailHtml = s.kidsThisMonth === 0
        ? `<div class="chart-empty text-body-secondary small text-center py-3">No kids born this month</div>`
        : `<div class="stat-grid mb-3" style="grid-template-columns:repeat(3,1fr)">
            <div class="stat-tile">
              <div class="st-icon">🍼</div>
              <div class="st-val text-success">${s.kidsThisMonth}</div>
              <div class="st-lbl">Total Alive</div>
            </div>
            <div class="stat-tile">
              <div class="st-icon" style="color:#1565c0">♂</div>
              <div class="st-val" style="color:#1565c0">${s.maleKidsThisMonth}</div>
              <div class="st-lbl">Male Kids</div>
            </div>
            <div class="stat-tile">
              <div class="st-icon text-pink">♀</div>
              <div class="st-val text-pink">${s.femaleKidsThisMonth}</div>
              <div class="st-lbl">Female Kids</div>
            </div>
          </div>
          <div class="dash-chart-title">Kids Born – This Month</div>
          ${donutSVG([
            { v: s.maleKidsThisMonth,   color: '#1565c0' },
            { v: s.femaleKidsThisMonth, color: '#e91e63' },
            { v: s.kidsThisMonth - s.maleKidsThisMonth - s.femaleKidsThisMonth, color: '#9e9e9e' },
          ].filter(seg => seg.v > 0), 90)}`;

      const vaxHtml = s.dueVax.length
        ? `<div class="mt-3">
            <div class="dash-chart-title">Vaccinations Due (14 days)</div>
            ${s.dueVax.slice(0, 4).map(h => {
              const a = Catalog.animal(h.animalId);
              return `<div class="list-row py-1">
                <div class="thumb" style="width:32px;height:32px"><i class="bi bi-heart-pulse text-info"></i></div>
                <div class="main">
                  <div class="title" style="font-size:.85rem">${a ? esc(a.tagNo + (a.name ? ' – ' + a.name : '')) : '—'}</div>
                  <div class="sub">${esc(h.type || '')} · Due ${fmtDate(h.nextDue)}</div>
                </div>
              </div>`;
            }).join('')}
          </div>`
        : '';

      $('#ds-bottom').html(`
        <div class="col-lg-7">
          <div class="h6 mb-2">Recent Breeding Records</div>
          <div class="list-card">${recentHtml}</div>
        </div>
        <div class="col-lg-5">
          <div class="h6 mb-2">Kids This Month</div>
          <div class="dash-chart-card">
            ${kidsDetailHtml}
            ${vaxHtml}
          </div>
        </div>`);

    } catch (e) {
      $('#ds-tiles').html(UI.errorState(e));
      $('#ds-charts').html('');
      $('#ds-bottom').html('');
    }
  },
};
