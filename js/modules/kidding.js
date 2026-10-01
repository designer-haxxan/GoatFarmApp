// Kidding records: track litter births for does/ewes — litter size, kids alive/dead, male/female split.
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtNum, today, uuid, nowISO, num, clean } from '../core/utils.js';
import * as idb from '../db/idb.js';
import * as Catalog from '../services/catalog.js';
import { t } from '../i18n.js';
import { dateFilter, bindDateFilter, rangeFor, pager } from '../core/views.js';

const $ = window.jQuery;

async function addKiddingModal(prefillDamId = null) {
  const females = Catalog.searchAnimals('', { status: 'active', gender: 'female' });
  const femaleOpts = `<option value="">— select dam —</option>` +
    females.map((a) => `<option value="${esc(a.id)}" ${a.id === prefillDamId ? 'selected' : ''}>${esc(a.tagNo)}${a.name ? ' — ' + esc(a.name) : ''}</option>`).join('');

  return UI.formModal({
    title: t('addKiddingRecord'),
    size: 'lg',
    body: `<div class="row g-2">
      <div class="col-6"><label class="form-label">${t('date')} *</label>
        <input type="date" name="date" class="form-control" value="${today()}" max="${today()}" required></div>
      <div class="col-6"><label class="form-label">${t('dam')} *</label>
        <select name="damId" class="form-select" required>${femaleOpts}</select></div>
      <div class="col-12"><label class="form-label">${t('sireDesc')}</label>
        <input name="sireDesc" class="form-control" maxlength="100"
          placeholder="Buck tag / breed / AI semen used"></div>
      <div class="col-4"><label class="form-label">${t('litterSize')} *</label>
        <input type="number" name="litterSize" class="form-control litter-size"
          min="1" max="6" step="1" value="1" required></div>
      <div class="col-4"><label class="form-label">${t('kidsAlive')}</label>
        <input type="number" name="kidsAlive" class="form-control" min="0" step="1" value="1"></div>
      <div class="col-4"><label class="form-label">${t('kidsDead')}</label>
        <input type="number" name="kidsDead" class="form-control" min="0" step="1" value="0"></div>
      <div class="col-6"><label class="form-label">${t('maleKids')}</label>
        <input type="number" name="maleKids" class="form-control" min="0" step="1" value="0"></div>
      <div class="col-6"><label class="form-label">${t('femaleKids')}</label>
        <input type="number" name="femaleKids" class="form-control" min="0" step="1" value="0"></div>
      <div class="col-12"><label class="form-label">${t('complications')}</label>
        <input name="complications" class="form-control" maxlength="200"
          placeholder="Dystocia, retained placenta, etc."></div>
      <div class="col-12"><label class="form-label">${t('notes')}</label>
        <textarea name="notes" class="form-control" rows="2"></textarea></div>
    </div>`,
    submitLabel: t('save'),
    submitClass: 'btn-success',
    onShown: ($m) => {
      // Auto-fill kidsAlive = litterSize when user changes it
      $m.on('change', '.litter-size', function () {
        const n = num(this.value, 1);
        $m.find('[name=kidsAlive]').val(n);
      });
    },
    onSubmit: async (v) => {
      if (!v.damId) throw new Error('Select the dam (mother animal).');
      if (!num(v.litterSize)) throw new Error('Litter size must be at least 1.');
      const now = nowISO();
      await idb.write(['kiddingRecords'], async (tx) => {
        await tx.add('kiddingRecords', {
          id: uuid(),
          date: v.date || today(),
          damId: v.damId,
          sireDesc: clean(v.sireDesc, 100),
          litterSize: num(v.litterSize, 1),
          kidsAlive: num(v.kidsAlive),
          kidsDead: num(v.kidsDead),
          maleKids: num(v.maleKids),
          femaleKids: num(v.femaleKids),
          complications: clean(v.complications, 200),
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
  async render(el, { params } = {}) {
    const $el = $(el);
    const prefillDam = params?.[0] ? decodeURIComponent(params[0].replace(/^\?dam=/, '')) : null;
    const [from, to] = rangeFor('month');

    $el.html(UI.pageHeader(t('kidding'),
      `<button class="btn btn-success btn-sm btn-add"><i class="bi bi-plus-lg"></i> ${t('addKiddingRecord')}</button>`) +
      dateFilter(from, to) +
      `<div class="small text-body-secondary mb-2 summary"></div>
       <div class="list-card kidding-list"></div>`);

    const draw = async (f = from, t2 = to) => {
      const all = await idb.read(['kiddingRecords'], (tx) =>
        tx.getAllByIndex('kiddingRecords', 'date', IDBKeyRange.bound(f, t2 + '￿')));
      all.sort((a, b) => b.date.localeCompare(a.date));

      const totalKids = all.reduce((s, r) => s + (r.kidsAlive || 0), 0);
      const totalLitters = all.length;
      const avgLitter = totalLitters ? (all.reduce((s, r) => s + (r.litterSize || 0), 0) / totalLitters).toFixed(1) : 0;
      $el.find('.summary').text(`${totalLitters} litters · ${totalKids} kids alive · avg litter ${avgLitter}`);

      pager($el.find('.kidding-list'), all, (r) => {
        const dam = Catalog.animal(r.damId);
        const alive = r.kidsAlive || 0;
        const dead = r.kidsDead || 0;
        const sexLine = (r.maleKids || r.femaleKids)
          ? `♂ ${r.maleKids || 0}  ♀ ${r.femaleKids || 0}`
          : '';
        return `<div class="list-row" data-id="${esc(r.id)}">
          <div class="thumb"><i class="bi bi-hearts text-danger"></i></div>
          <div class="main">
            <div class="title">${dam ? esc(dam.tagNo) + (dam.name ? ' — ' + esc(dam.name) : '') : '(unknown dam)'}</div>
            <div class="sub">${fmtDate(r.date)} · Litter: ${r.litterSize || 0}${sexLine ? ' (' + sexLine + ')' : ''}${r.sireDesc ? ' · ' + esc(r.sireDesc.slice(0, 30)) : ''}</div>
            ${r.complications ? `<div class="sub text-warning small"><i class="bi bi-exclamation-triangle me-1"></i>${esc(r.complications.slice(0, 70))}</div>` : ''}
          </div>
          <div class="end text-center" style="min-width:60px">
            <div class="fw-semibold text-success fs-6">${alive}</div>
            <div class="small text-body-secondary">alive</div>
            ${dead ? `<div class="small text-danger">${dead} dead</div>` : ''}
          </div>
        </div>`;
      }, 60, UI.emptyState(t('noRecords'), 'hearts',
        `<button class="btn btn-success btn-sm mt-3 btn-add">${t('addKiddingRecord')}</button>`));
    };

    bindDateFilter($el, draw);
    await draw();

    $el.on('click', '.btn-add', async () => {
      await addKiddingModal(prefillDam);
      await draw();
    });
  },
};
