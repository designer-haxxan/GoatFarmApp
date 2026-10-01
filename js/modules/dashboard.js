import * as UI from '../core/ui.js';
import { esc, fmtNum, fmtDate, today, monthStart } from '../core/utils.js';
import * as idb from '../db/idb.js';
import * as Posting from '../services/posting.js';
import * as Catalog from '../services/catalog.js';
import { t } from '../i18n.js';
import { getSettings } from '../core/settings.js';

const $ = window.jQuery;
const cur = () => getSettings().currency;
const money = (n) => `${esc(cur())} ${fmtNum(n)}`;

async function loadStats() {
  const animals = Catalog.allAnimals();
  const active = animals.filter((a) => a.status === 'active');
  const females = active.filter((a) => a.gender === 'female');
  const males = active.filter((a) => a.gender === 'male');

  // Kids born this month
  const mStart = monthStart();
  const kiddingThisMonth = await idb.read(['kiddingRecords'], (tx) =>
    tx.getAllByIndex('kiddingRecords', 'date', IDBKeyRange.bound(mStart, today() + '￿')));
  const kidsThisMonth = kiddingThisMonth.reduce((s, r) => s + (r.kidsAlive || 0), 0);

  // Buyer balances
  const bal = await Posting.allBalances();
  let buyerBal = 0; let sellerBal = 0;
  for (const [id, b] of bal) {
    if (id.startsWith('B:')) buyerBal += b.balance;
    else if (id.startsWith('S:')) sellerBal -= b.balance;
  }

  // Due for delivery in next 30 days (from crossing date + gestation)
  const allKidding = await idb.getAll('kiddingRecords');
  const future30 = new Date(); future30.setDate(future30.getDate() + 30);
  const future30Str = future30.toISOString().slice(0, 10);
  const todayStr = today();

  // Also check breedingRecords for pregnant animals
  const pregnantRecs = await idb.read(['breedingRecords'], (tx) =>
    tx.getAllByIndex('breedingRecords', 'pregnancyStatus', 'pregnant'));
  const dueSoon = pregnantRecs.filter(
    (r) => r.expectedCalving && r.expectedCalving >= todayStr && r.expectedCalving <= future30Str).length;

  // Upcoming vaccinations (next 14 days)
  const allHealth = await idb.getAll('healthEvents');
  const future14 = new Date(); future14.setDate(future14.getDate() + 14);
  const future14Str = future14.toISOString().slice(0, 10);
  const dueVax = allHealth.filter(
    (h) => h.nextDue && h.nextDue >= todayStr && h.nextDue <= future14Str).length;

  return {
    total: animals.length, active: active.length,
    females: females.length, males: males.length,
    kidsThisMonth, buyerBal, sellerBal, dueSoon, dueVax,
  };
}

export default {
  async render(el) {
    const $el = $(el);
    $el.html(UI.pageHeader(t('dashboard')) + `
      <div class="stat-grid" id="dash-stats">${UI.spinner('')}</div>
      <div class="row g-3">
        <div class="col-lg-6">
          <h2 class="h6 mb-2">${t('quickActions')}</h2>
          <div class="row g-2 mb-3">
            <div class="col-6">
              <a href="#/kidding" class="quick-action text-decoration-none">
                <i class="bi bi-hearts text-danger"></i>
                <span>${t('recordBreeding')}</span>
              </a>
            </div>
            <div class="col-6">
              <a href="#/animals" class="quick-action text-decoration-none">
                <i class="bi bi-plus-circle text-success"></i>
                <span>${t('addAnimal')}</span>
              </a>
            </div>
            <div class="col-6">
              <a href="#/health" class="quick-action text-decoration-none">
                <i class="bi bi-heart-pulse text-danger"></i>
                <span>${t('addHealthEvent')}</span>
              </a>
            </div>
            <div class="col-6">
              <a href="#/milkSales" class="quick-action text-decoration-none">
                <i class="bi bi-bag-check text-warning"></i>
                <span>${t('milkSale')}</span>
              </a>
            </div>
          </div>
          <div id="dash-alerts"></div>
        </div>
        <div class="col-lg-6">
          <h2 class="h6 mb-2">${t('recentActivity')}</h2>
          <div class="list-card" id="dash-recent">${UI.spinner()}</div>
        </div>
      </div>`);

    // Stats
    try {
      const s = await loadStats();
      $('#dash-stats').html(`
        <div class="stat-tile">
          <div class="st-icon">🐐</div>
          <div class="st-val">${s.active}</div>
          <div class="st-lbl">${t('activeCows')}</div>
        </div>
        <div class="stat-tile">
          <div class="st-icon">🐏</div>
          <div class="st-val">${s.males}</div>
          <div class="st-lbl">${t('totalBulls')}</div>
        </div>
        <div class="stat-tile">
          <div class="st-icon">🍼</div>
          <div class="st-val">${s.kidsThisMonth}</div>
          <div class="st-lbl">${t('kidsThisMonth')}</div>
        </div>
        <div class="stat-tile">
          <div class="st-icon">💰</div>
          <div class="st-val text-success">${money(s.buyerBal)}</div>
          <div class="st-lbl">${t('buyerBalance')}</div>
        </div>`);

      let alerts = '';
      if (s.dueSoon > 0)
        alerts += `<div class="alert alert-warning py-2 small mb-2">
          <i class="bi bi-calendar-heart me-2"></i>${s.dueSoon} animal(s) due for delivery in the next 30 days.
          <a href="#/breeding">View</a></div>`;
      if (s.dueVax > 0)
        alerts += `<div class="alert alert-info py-2 small mb-2">
          <i class="bi bi-heart-pulse me-2"></i>${s.dueVax} vaccination(s) due in the next 14 days.
          <a href="#/health">View</a></div>`;
      if (s.buyerBal > 0)
        alerts += `<div class="alert alert-success py-2 small mb-2">
          <i class="bi bi-cash-coin me-2"></i>Buyers owe you ${money(s.buyerBal)}.
          <a href="#/buyers">View ledgers</a></div>`;
      $('#dash-alerts').html(alerts || `<div class="text-body-secondary small">No alerts.</div>`);
    } catch (e) {
      $('#dash-stats').html(UI.errorState(e));
    }

    // Recent breeding records
    try {
      const recent = (await idb.getAll('kiddingRecords'))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 8);

      if (!recent.length) {
        $('#dash-recent').html(UI.emptyState('No breeding records yet', 'hearts'));
      } else {
        $('#dash-recent').html(recent.map((r) => {
          const dam = Catalog.animal(r.damId);
          const alive = r.kidsAlive || 0;
          return `<a class="list-row" href="#/kidding">
            <div class="thumb"><i class="bi bi-hearts text-danger"></i></div>
            <div class="main">
              <div class="title">${dam ? esc(dam.tagNo + (dam.name ? ' — ' + dam.name : '')) : '—'}</div>
              <div class="sub">${fmtDate(r.date)}${r.crossingDate ? ' · Mated ' + fmtDate(r.crossingDate) : ''} · Litter ${r.litterSize || 0}</div>
            </div>
            <div class="end fw-semibold text-success">${alive} alive</div>
          </a>`;
        }).join(''));
      }
    } catch (e) {
      $('#dash-recent').html(UI.errorState(e));
    }
  },
};
