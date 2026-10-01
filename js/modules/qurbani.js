// Qurbani (Eid sacrifice) order management — customer bookings, animal assignment, payment tracking.
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtNum, today, uuid, nowISO, num, clean } from '../core/utils.js';
import * as idb from '../db/idb.js';
import * as Catalog from '../services/catalog.js';
import { t } from '../i18n.js';
import { pager, money } from '../core/views.js';

const $ = window.jQuery;

const STATUSES = ['booked', 'ready', 'delivered', 'cancelled'];
const STATUS_CLS = {
  booked: 'bg-primary',
  ready: 'bg-warning text-dark',
  delivered: 'bg-success',
  cancelled: 'bg-secondary',
};
const SPECIES = ['goat', 'sheep', 'cattle', 'buffalo', 'other'];

async function nextNumber(tx) {
  const key = 'seq:qurbaniOrder';
  const rec = (await tx.get('meta', key)) || { key, value: 0 };
  const n = rec.value + 1;
  await tx.put('meta', { key, value: n });
  return `QRB-${String(n).padStart(5, '0')}`;
}

async function addOrderModal(existing = null) {
  const rec = existing || {};
  const isEdit = !!existing;
  const animals = Catalog.searchAnimals('', { status: 'active' });
  const animalOpts = `<option value="">— Unassigned —</option>` +
    animals.map((a) =>
      `<option value="${esc(a.id)}" ${a.id === rec.animalId ? 'selected' : ''}>
        ${esc(a.tagNo)}${a.name ? ' — ' + esc(a.name) : ''} (${esc(t(a.species))})
       </option>`).join('');
  const speciesOpts = SPECIES.map((s) =>
    `<option value="${s}" ${s === (rec.species || 'goat') ? 'selected' : ''}>${esc(t(s))}</option>`).join('');
  const statusOpts = STATUSES.map((s) =>
    `<option value="${s}" ${s === (rec.status || 'booked') ? 'selected' : ''}>${esc(t(s))}</option>`).join('');

  return UI.formModal({
    title: isEdit ? `${t('qurbaniOrder')} #${esc(rec.number || '')}` : t('addQurbaniOrder'),
    size: 'lg',
    body: `<div class="row g-2">
      <div class="col-6"><label class="form-label">${t('date')} *</label>
        <input type="date" name="date" class="form-control" value="${esc(rec.date || today())}" required></div>
      <div class="col-6"><label class="form-label">${t('deliveryDate')}</label>
        <input type="date" name="deliveryDate" class="form-control" value="${esc(rec.deliveryDate || '')}"></div>
      <div class="col-12"><label class="form-label">${t('customerName')} *</label>
        <input name="customerName" class="form-control" required maxlength="100" value="${esc(rec.customerName || '')}"></div>
      <div class="col-6"><label class="form-label">${t('phone')}</label>
        <input name="phone" class="form-control" maxlength="20" value="${esc(rec.phone || '')}"></div>
      <div class="col-6"><label class="form-label">${t('species')}</label>
        <select name="species" class="form-select">${speciesOpts}</select></div>
      <div class="col-12"><label class="form-label">Assign Animal <span class="text-body-secondary">(optional)</span></label>
        <select name="animalId" class="form-select">${animalOpts}</select></div>
      <div class="col-4"><label class="form-label">${t('weight')} (kg)</label>
        <input type="number" name="weight" class="form-control weight-in" min="0" step="0.5" value="${esc(rec.weight || '')}"></div>
      <div class="col-4"><label class="form-label">Rate / kg (PKR)</label>
        <input type="number" name="pricePerKg" class="form-control rate-in" min="0" step="1" value="${esc(rec.pricePerKg || '')}"></div>
      <div class="col-4"><label class="form-label">${t('totalAmount')}</label>
        <input type="number" name="totalPrice" class="form-control" min="0" step="1" value="${esc(rec.totalPrice || '')}"></div>
      <div class="col-6"><label class="form-label">${t('advanceAmount')}</label>
        <input type="number" name="advance" class="form-control" min="0" step="1" value="${esc(rec.advance || '')}"></div>
      <div class="col-6"><label class="form-label">${t('orderStatus')}</label>
        <select name="status" class="form-select">${statusOpts}</select></div>
      <div class="col-12"><label class="form-label">${t('notes')}</label>
        <textarea name="notes" class="form-control" rows="2">${esc(rec.notes || '')}</textarea></div>
    </div>`,
    submitLabel: t('save'),
    submitClass: 'btn-success',
    onShown: ($m) => {
      const recalc = () => {
        const w = num($m.find('.weight-in').val());
        const r = num($m.find('.rate-in').val());
        if (w > 0 && r > 0) $m.find('[name=totalPrice]').val((w * r).toFixed(0));
      };
      $m.on('input', '.weight-in, .rate-in', recalc);
    },
    onSubmit: async (v) => {
      if (!v.customerName?.trim()) throw new Error('Enter customer name.');
      const now = nowISO();
      const totalPrice = num(v.totalPrice) || Math.round(num(v.weight) * num(v.pricePerKg));
      await idb.write(['meta', 'qurbaniOrders'], async (tx) => {
        const number = isEdit ? rec.number : await nextNumber(tx);
        await tx.put('qurbaniOrders', {
          id: rec.id || uuid(),
          number,
          date: v.date || today(),
          deliveryDate: v.deliveryDate || '',
          customerName: clean(v.customerName, 100),
          phone: clean(v.phone, 20),
          species: v.species || 'goat',
          animalId: v.animalId || null,
          weight: num(v.weight),
          pricePerKg: num(v.pricePerKg),
          totalPrice,
          advance: num(v.advance),
          status: v.status || 'booked',
          notes: clean(v.notes, 300),
          createdAt: rec.createdAt || now,
          updatedAt: now,
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

    $el.html(UI.pageHeader(t('qurbani'),
      `<button class="btn btn-success btn-sm btn-add"><i class="bi bi-plus-lg"></i> ${t('addQurbaniOrder')}</button>`) +
      `<div class="filters mb-2 d-flex gap-2 flex-wrap align-items-end">
        <div>
          <label class="form-label small mb-0">${t('orderStatus')}</label>
          <select class="form-select form-select-sm status-filter" style="max-width:160px">
            <option value="">All</option>
            ${STATUSES.map((s) => `<option value="${s}">${esc(t(s))}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label small mb-0">${t('species')}</label>
          <select class="form-select form-select-sm species-filter" style="max-width:130px">
            <option value="">All</option>
            ${SPECIES.map((s) => `<option value="${s}">${esc(t(s))}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="row g-2 mb-2 stat-row"></div>
      <div class="list-card qurbani-list"></div>`);

    const draw = async () => {
      const fStatus = $el.find('.status-filter').val();
      const fSpecies = $el.find('.species-filter').val();
      let all = await idb.getAll('qurbaniOrders');
      all.sort((a, b) => b.date.localeCompare(a.date));
      if (fStatus) all = all.filter((r) => r.status === fStatus);
      if (fSpecies) all = all.filter((r) => r.species === fSpecies);

      // Summary stats
      const active = all.filter((r) => r.status !== 'cancelled');
      const totalRev = active.reduce((s, r) => s + (r.totalPrice || 0), 0);
      const totalAdv = active.reduce((s, r) => s + (r.advance || 0), 0);
      const balance = totalRev - totalAdv;
      $el.find('.stat-row').html(`
        <div class="col-6 col-md-3"><div class="card card-body p-2 text-center">
          <div class="fs-5 fw-bold">${all.length}</div>
          <div class="small text-body-secondary">${t('totalOrders')}</div>
        </div></div>
        <div class="col-6 col-md-3"><div class="card card-body p-2 text-center">
          <div class="fs-5 fw-bold">${active.filter((r) => r.status === 'booked').length}</div>
          <div class="small text-body-secondary">${t('booked')}</div>
        </div></div>
        <div class="col-6 col-md-3"><div class="card card-body p-2 text-center">
          <div class="fs-6 fw-bold">${money(totalRev)}</div>
          <div class="small text-body-secondary">${t('totalAmount')}</div>
        </div></div>
        <div class="col-6 col-md-3"><div class="card card-body p-2 text-center">
          <div class="fs-6 fw-bold text-warning">${money(balance)}</div>
          <div class="small text-body-secondary">${t('balance')}</div>
        </div></div>`);

      pager($el.find('.qurbani-list'), all, (r) => {
        const animal = r.animalId ? Catalog.animal(r.animalId) : null;
        const bal = (r.totalPrice || 0) - (r.advance || 0);
        return `<div class="list-row qurbani-row" data-id="${esc(r.id)}">
          <div class="thumb"><i class="bi bi-moon-stars-fill text-warning"></i></div>
          <div class="main">
            <div class="title">${esc(r.customerName)}
              <span class="text-body-secondary small ms-1">#${esc(r.number || '')}</span></div>
            <div class="sub">${esc(r.phone || '')} · ${esc(t(r.species))}${animal ? ' · ' + esc(animal.tagNo) : ''}</div>
            <div class="sub">${fmtDate(r.date)}${r.deliveryDate ? ' → ' + fmtDate(r.deliveryDate) : ''}</div>
          </div>
          <div class="end text-end" style="min-width:90px">
            <span class="badge ${STATUS_CLS[r.status] || 'bg-secondary'}">${esc(t(r.status))}</span>
            ${r.totalPrice ? `<div class="small mt-1">${money(r.totalPrice)}</div>` : ''}
            ${bal > 0 ? `<div class="small text-warning">${money(bal)} due</div>` : ''}
          </div>
        </div>`;
      }, 60, UI.emptyState(t('noRecords'), 'moon-stars',
        `<button class="btn btn-success btn-sm mt-3 btn-add">${t('addQurbaniOrder')}</button>`));
    };

    $el.on('change', '.status-filter, .species-filter', draw);
    await draw();

    $el.on('click', '.btn-add', async () => { await addOrderModal(); await draw(); });

    // Click row to edit
    $el.on('click', '.qurbani-row', async function () {
      const id = this.dataset.id;
      if (!id) return;
      const rec = await idb.read(['qurbaniOrders'], (tx) => tx.get('qurbaniOrders', id));
      if (rec) { await addOrderModal(rec); await draw(); }
    });
  },
};
