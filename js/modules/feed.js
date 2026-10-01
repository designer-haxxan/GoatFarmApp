// Feed management: record daily feed given to the herd or individual animals.
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtNum, fmtQty, today, uuid, nowISO, num, clean } from '../core/utils.js';
import * as idb from '../db/idb.js';
import * as Catalog from '../services/catalog.js';
import { t } from '../i18n.js';
import { dateFilter, bindDateFilter, rangeFor, pager, money } from '../core/views.js';

const $ = window.jQuery;

const FEED_TYPES = ['hay', 'concentrates', 'greenFodder', 'grain', 'dryFodder', 'otherFeed'];

async function addFeedModal(prefill = null) {
  const rec = prefill || {};
  const animals = Catalog.searchAnimals('', { status: 'active' });
  const animalOpts = `<option value="">— ${t('herdWide')} —</option>` +
    animals.map((a) => `<option value="${esc(a.id)}" ${a.id === rec.animalId ? 'selected' : ''}>${esc(a.tagNo)}${a.name ? ' — ' + esc(a.name) : ''}</option>`).join('');

  return UI.formModal({
    title: t('addFeedRecord'),
    body: `<div class="row g-2">
      <div class="col-6"><label class="form-label">${t('date')} *</label>
        <input type="date" name="date" class="form-control" value="${esc(rec.date || today())}" max="${today()}" required></div>
      <div class="col-6"><label class="form-label">${t('animal')}</label>
        <select name="animalId" class="form-select">${animalOpts}</select></div>
      <div class="col-6"><label class="form-label">${t('feedType')}</label>
        <select name="feedType" class="form-select">
          ${FEED_TYPES.map((ft) => `<option value="${ft}" ${ft === rec.feedType ? 'selected' : ''}>${esc(t(ft))}</option>`).join('')}
        </select></div>
      <div class="col-6"><label class="form-label">${t('feedQty')} *</label>
        <input type="number" name="qty" class="form-control" min="0.1" step="0.1" value="${esc(rec.qty || '')}" required></div>
      <div class="col-6"><label class="form-label">${t('cost')}</label>
        <input type="number" name="cost" class="form-control" min="0" step="1" value="${esc(rec.cost || '')}"></div>
      <div class="col-12"><label class="form-label">${t('notes')}</label>
        <textarea name="notes" class="form-control" rows="2">${esc(rec.notes || '')}</textarea></div>
    </div>`,
    submitLabel: t('save'),
    submitClass: 'btn-success',
    onSubmit: async (v) => {
      if (!num(v.qty)) throw new Error('Enter quantity (kg).');
      const now = nowISO();
      await idb.write(['feedRecords'], async (tx) => {
        await tx.add('feedRecords', {
          id: uuid(),
          date: v.date || today(),
          animalId: v.animalId || null,
          feedType: v.feedType || 'hay',
          qty: num(v.qty),
          cost: num(v.cost),
          notes: clean(v.notes, 300),
          createdAt: now, updatedAt: now,
        });
      });
      document.dispatchEvent(new CustomEvent('data:changed'));
      return true;
    },
  });
}

export default {
  async render(el) {
    const $el = $(el);
    const [from, to] = rangeFor('month');

    $el.html(UI.pageHeader(t('feed'),
      `<button class="btn btn-success btn-sm btn-add"><i class="bi bi-plus-lg"></i> ${t('addFeedRecord')}</button>`) +
      dateFilter(from, to,
        `<select name="fftype" class="form-select form-select-sm" style="max-width:150px">
          <option value="">All types</option>
          ${FEED_TYPES.map((ft) => `<option value="${ft}">${esc(t(ft))}</option>`).join('')}
        </select>`) +
      `<div class="small text-body-secondary mb-2 summary"></div>
       <div class="list-card feed-list"></div>`);

    const draw = async (f = from, t2 = to, extra = {}) => {
      let all = await idb.read(['feedRecords'], (tx) =>
        tx.getAllByIndex('feedRecords', 'date', IDBKeyRange.bound(f, t2 + '￿')));
      if (extra.fftype) all = all.filter((r) => r.feedType === extra.fftype);
      all.sort((a, b) => b.date.localeCompare(a.date));

      const totalQty = all.reduce((s, r) => s + (r.qty || 0), 0);
      const totalCost = all.reduce((s, r) => s + (r.cost || 0), 0);
      $el.find('.summary').text(
        `${all.length} records · ${fmtQty(totalQty)} kg total` +
        (totalCost ? ` · ${money(totalCost)} cost` : ''));

      pager($el.find('.feed-list'), all, (r) => {
        const a = r.animalId ? Catalog.animal(r.animalId) : null;
        return `<div class="list-row" data-id="${esc(r.id)}">
          <div class="thumb"><i class="bi bi-basket2 text-success"></i></div>
          <div class="main">
            <div class="title">${esc(t(r.feedType))}${a ? ' — ' + esc(a.tagNo + (a.name ? ' ' + a.name : '')) : ' — ' + t('herdWide')}</div>
            <div class="sub">${fmtDate(r.date)}${r.notes ? ' · ' + esc(r.notes.slice(0, 50)) : ''}</div>
          </div>
          <div class="end text-end">
            <div class="fw-semibold">${fmtQty(r.qty)} kg</div>
            ${r.cost ? `<div class="small text-body-secondary">${money(r.cost)}</div>` : ''}
          </div>
        </div>`;
      }, 60, UI.emptyState(t('noRecords'), 'basket2',
        `<button class="btn btn-success btn-sm mt-3 btn-add">${t('addFeedRecord')}</button>`));
    };

    bindDateFilter($el, draw);
    await draw();
    $el.on('click', '.btn-add', async () => { await addFeedModal(); await draw(); });
  },
};
