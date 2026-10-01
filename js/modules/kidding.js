// Kidding records: mating date → expected delivery → actual birth → auto-add kids to herd.
import * as UI from '../core/ui.js';
import { esc, fmtDate, today, uuid, nowISO, num, clean } from '../core/utils.js';
import * as idb from '../db/idb.js';
import * as Catalog from '../services/catalog.js';
import { CONFIG } from '../config.js';
import { t } from '../i18n.js';
import { dateFilter, bindDateFilter, rangeFor, pager } from '../core/views.js';

const $ = window.jQuery;

// Calculate expected delivery from mating date using species-specific gestation.
function calcExpectedDelivery(crossingDate, species) {
  if (!crossingDate) return '';
  const days = CONFIG.GESTATION[species] ?? CONFIG.GESTATION.goat;
  const d = new Date(crossingDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Find next available tag: "{damTag}-K{n}", incrementing n until no collision.
async function nextKidTag(tx, damTag, startN) {
  let n = startN;
  let tag;
  do {
    tag = `${damTag}-K${n}`;
    const exists = await tx.getByIndex('animals', 'tagNo', tag);
    if (!exists) break;
    n++;
  } while (true);
  return { tag, nextN: n + 1 };
}

async function addKiddingModal(prefillDamId = null) {
  const females = Catalog.searchAnimals('', { status: 'active', gender: 'female' });
  const femaleOpts = `<option value="">— select dam —</option>` +
    females.map((a) =>
      `<option value="${esc(a.id)}" data-species="${esc(a.species || 'goat')}" ${a.id === prefillDamId ? 'selected' : ''}>
        ${esc(a.tagNo)}${a.name ? ' — ' + esc(a.name) : ''} (${esc(t(a.species || 'goat'))})
       </option>`).join('');

  return UI.formModal({
    title: t('addKiddingRecord'),
    size: 'lg',
    body: `<div class="row g-2">

      <div class="col-12"><hr class="mt-0 mb-1"><div class="small fw-semibold text-body-secondary mb-1">Mating</div></div>
      <div class="col-6">
        <label class="form-label">${t('crossingDate')}</label>
        <input type="date" name="crossingDate" class="form-control crossing-date" max="${today()}">
        <div class="form-text">Date the ewe was mated / crossed</div>
      </div>
      <div class="col-6">
        <label class="form-label">${t('expectedDelivery')}</label>
        <input type="date" name="expectedDelivery" class="form-control expected-delivery" readonly tabindex="-1">
        <div class="form-text">Auto-calculated</div>
      </div>

      <div class="col-12"><hr class="mb-1"><div class="small fw-semibold text-body-secondary mb-1">Birth</div></div>
      <div class="col-6">
        <label class="form-label">${t('date')} * <span class="text-body-secondary small">(delivery)</span></label>
        <input type="date" name="date" class="form-control" value="${today()}" max="${today()}" required>
      </div>
      <div class="col-6">
        <label class="form-label">${t('dam')} *</label>
        <select name="damId" class="form-select dam-select" required>${femaleOpts}</select>
      </div>
      <div class="col-12">
        <label class="form-label">${t('sireDesc')}</label>
        <input name="sireDesc" class="form-control" maxlength="100" placeholder="Buck tag / breed / AI semen">
      </div>

      <div class="col-4">
        <label class="form-label">${t('litterSize')} *</label>
        <input type="number" name="litterSize" class="form-control litter-size" min="1" max="8" step="1" value="1" required>
      </div>
      <div class="col-4">
        <label class="form-label">${t('kidsAlive')}</label>
        <input type="number" name="kidsAlive" class="form-control kids-alive" min="0" step="1" value="1">
      </div>
      <div class="col-4">
        <label class="form-label">${t('kidsDead')}</label>
        <input type="number" name="kidsDead" class="form-control" min="0" step="1" value="0">
      </div>
      <div class="col-6">
        <label class="form-label">${t('maleKids')}</label>
        <input type="number" name="maleKids" class="form-control" min="0" step="1" value="0">
      </div>
      <div class="col-6">
        <label class="form-label">${t('femaleKids')}</label>
        <input type="number" name="femaleKids" class="form-control" min="0" step="1" value="0">
      </div>
      <div class="col-12">
        <label class="form-label">${t('complications')}</label>
        <input name="complications" class="form-control" maxlength="200" placeholder="Dystocia, retained placenta…">
      </div>
      <div class="col-12">
        <label class="form-label">${t('notes')}</label>
        <textarea name="notes" class="form-control" rows="2"></textarea>
      </div>

      <div class="col-12">
        <div class="form-check form-switch mt-1">
          <input class="form-check-input" type="checkbox" name="addToHerd" id="addToHerd" checked>
          <label class="form-check-label" for="addToHerd">${t('addKidsToHerd')}</label>
        </div>
        <div class="form-text add-herd-note">
          Each live kid will be added as a new animal (tag: dam-K1, dam-K2…). You can edit tags later.
        </div>
      </div>
    </div>`,
    submitLabel: t('save'),
    submitClass: 'btn-success',
    onShown: ($m) => {
      // Auto-fill kidsAlive = litterSize
      $m.on('change input', '.litter-size', function () {
        $m.find('.kids-alive').val(num(this.value, 1));
      });

      // Recalculate expected delivery when crossing date or dam changes
      const recalcExpected = () => {
        const crossing = $m.find('.crossing-date').val();
        const $opt = $m.find('.dam-select option:selected');
        const species = $opt.data('species') || 'goat';
        const exp = calcExpectedDelivery(crossing, species);
        $m.find('.expected-delivery').val(exp);
      };
      $m.on('change', '.crossing-date, .dam-select', recalcExpected);

      // Show/hide herd note
      $m.on('change', '[name=addToHerd]', function () {
        $m.find('.add-herd-note').toggle(this.checked);
      });
    },
    onSubmit: async (v) => {
      if (!v.damId) throw new Error('Select the dam (mother animal).');
      const litter = num(v.litterSize);
      if (!litter) throw new Error('Litter size must be at least 1.');

      const alive = num(v.kidsAlive);
      const males = num(v.maleKids);
      const females = num(v.femaleKids);
      if (males + females > alive) throw new Error('Male + female count cannot exceed kids alive.');

      const dam = Catalog.animal(v.damId);
      const deliveryDate = v.date || today();
      const now = nowISO();
      const kidIds = [];

      await idb.write(['kiddingRecords', 'animals'], async (tx) => {
        // 1. Save the kidding record
        await tx.add('kiddingRecords', {
          id: uuid(),
          date: deliveryDate,
          crossingDate: v.crossingDate || '',
          expectedDelivery: v.expectedDelivery || '',
          damId: v.damId,
          sireDesc: clean(v.sireDesc, 100),
          litterSize: litter,
          kidsAlive: alive,
          kidsDead: num(v.kidsDead),
          maleKids: males,
          femaleKids: females,
          complications: clean(v.complications, 200),
          notes: clean(v.notes, 300),
          createdAt: now, updatedAt: now,
        });

        // 2. Auto-add live kids to animals store
        if (v.addToHerd && alive > 0 && dam) {
          const damTag = dam.tagNo || dam.id.slice(0, 6);
          const damSpecies = dam.species || 'goat';
          const damBreed = dam.breed || '';

          // Build gender list: fill males first, then females, then unknown
          const genders = [];
          for (let i = 0; i < males; i++) genders.push('male');
          for (let i = 0; i < females; i++) genders.push('female');
          while (genders.length < alive) genders.push('');

          let nextN = 1;
          for (let i = 0; i < alive; i++) {
            const { tag, nextN: nn } = await nextKidTag(tx, damTag, nextN);
            nextN = nn;
            const kidId = uuid();
            kidIds.push(kidId);
            await tx.add('animals', {
              id: kidId,
              tagNo: tag,
              name: '',
              species: damSpecies,
              breed: damBreed,
              gender: genders[i],
              dob: deliveryDate,
              status: 'active',
              motherId: v.damId,
              fatherDesc: clean(v.sireDesc, 100),
              color: '',
              purchaseDate: '',
              purchasePrice: 0,
              photo: null,
              notes: `Born in litter of ${litter}`,
              nameLc: '',
              createdAt: now, updatedAt: now,
            });
          }
        }
      });

      // 3. Refresh catalog for all new animals
      await Promise.all(kidIds.map((id) => Catalog.refreshAnimal(id)));
      document.dispatchEvent(new CustomEvent('data:changed'));
      if (kidIds.length) UI.toast(`${kidIds.length} kid${kidIds.length > 1 ? 's' : ''} added to animal register.`, 'success');
      return true;
    },
  });
}

// ── List view ──────────────────────────────────────────────────────────────────

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
      const avgLitter = totalLitters
        ? (all.reduce((s, r) => s + (r.litterSize || 0), 0) / totalLitters).toFixed(1)
        : '—';
      $el.find('.summary').text(
        `${totalLitters} litters · ${totalKids} kids alive · avg litter size ${avgLitter}`);

      pager($el.find('.kidding-list'), all, (r) => {
        const dam = Catalog.animal(r.damId);
        const alive = r.kidsAlive || 0;
        const dead = r.kidsDead || 0;
        const sexLine = (r.maleKids || r.femaleKids)
          ? `♂${r.maleKids || 0} ♀${r.femaleKids || 0}`
          : '';
        return `<div class="list-row" data-id="${esc(r.id)}">
          <div class="thumb"><i class="bi bi-hearts text-danger"></i></div>
          <div class="main">
            <div class="title">
              ${dam ? esc(dam.tagNo) + (dam.name ? ' — ' + esc(dam.name) : '') : '(unknown dam)'}
            </div>
            <div class="sub">
              ${r.crossingDate ? '<i class="bi bi-arrow-right-circle me-1 text-body-secondary"></i>Mated ' + fmtDate(r.crossingDate) + ' · ' : ''}
              <i class="bi bi-calendar-heart me-1 text-body-secondary"></i>Delivered ${fmtDate(r.date)}
            </div>
            <div class="sub">
              Litter: <strong>${r.litterSize || 0}</strong>${sexLine ? ' (' + sexLine + ')' : ''}
              ${r.sireDesc ? ' · ' + esc(r.sireDesc.slice(0, 35)) : ''}
            </div>
            ${r.complications
              ? `<div class="sub text-warning small"><i class="bi bi-exclamation-triangle me-1"></i>${esc(r.complications.slice(0, 70))}</div>`
              : ''}
          </div>
          <div class="end text-center" style="min-width:64px">
            <div class="fw-bold text-success" style="font-size:1.3rem">${alive}</div>
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
