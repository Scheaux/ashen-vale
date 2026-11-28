import { getClass } from '../content/classes';
import { activeCampsForZone, getZoneDef } from '../content/zones';
import type { SaveSlotInfo } from '../save/slots';

export type SavePanelMode = 'load' | 'save';

export interface SaveSlotsCallbacks {
  onChoose(slot: number): void;
  onDelete(slot: number): void;
  onClose(): void;
}

/**
 * Save/load slot screen (slice 8): three checkpoint cards showing class,
 * level, life, camp progress and boss state. Corrupt slots stay visible and
 * deletable so a player can always reclaim a broken slot.
 */
export class SaveSlotsPanel {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly hint: HTMLElement;
  private mode: SavePanelMode = 'load';
  private activeSlot: number | null = null;
  visible = false;

  constructor(parent: HTMLElement, private readonly callbacks: SaveSlotsCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'save-screen hidden';
    this.root.innerHTML = `
      <div class="save-panel">
        <div class="save-header">
          <h3 class="inventory-title" data-save-title>Load Game</h3>
          <button class="save-close" data-save-close aria-label="Close">✕</button>
        </div>
        <div class="save-slots" data-save-slots></div>
        <p class="inventory-hint" data-save-hint></p>
      </div>`;
    parent.appendChild(this.root);

    this.title = this.root.querySelector('[data-save-title]') as HTMLElement;
    this.cards = this.root.querySelector('[data-save-slots]') as HTMLElement;
    this.hint = this.root.querySelector('[data-save-hint]') as HTMLElement;
    (this.root.querySelector('[data-save-close]') as HTMLElement).addEventListener('click', () => this.callbacks.onClose());
  }

  get currentMode(): SavePanelMode {
    return this.mode;
  }

  open(mode: SavePanelMode, slots: SaveSlotInfo[], activeSlot: number | null): void {
    this.mode = mode;
    this.visible = true;
    this.root.classList.remove('hidden');
    this.sync(slots, activeSlot);
  }

  close(): void {
    this.visible = false;
    this.root.classList.add('hidden');
  }

  sync(slots: SaveSlotInfo[], activeSlot: number | null): void {
    this.activeSlot = activeSlot;
    if (!this.visible) return;

    const saving = this.mode === 'save';
    this.title.textContent = saving ? 'Save Game' : 'Load Game';
    this.hint.textContent = saving
      ? 'Choose a slot to store this checkpoint · milestone checkpoints autosave to the active slot · Esc to close'
      : 'Loading replaces this run with the chosen checkpoint · Esc to close';

    this.cards.innerHTML = '';
    for (const info of slots) this.cards.appendChild(this.makeCard(info));
  }

  private makeCard(info: SaveSlotInfo): HTMLElement {
    const saving = this.mode === 'save';
    const filled = info.status === 'ok' && info.save !== null;
    const corrupt = info.status === 'corrupt';
    const active = info.slot === this.activeSlot && (filled || corrupt);
    const card = document.createElement('article');
    card.className = 'save-slot';
    card.dataset.slot = String(info.slot);
    if (active) card.classList.add('save-slot--active');
    if (corrupt) card.classList.add('save-slot--corrupt');

    const body = document.createElement('button');
    body.className = 'save-slot__body';
    body.disabled = !saving && !filled;
    body.addEventListener('click', () => this.callbacks.onChoose(info.slot));

    const tag = active ? '<span class="save-slot__tag save-slot__tag--active">Current run</span>'
      : info.recovered ? '<span class="save-slot__tag save-slot__tag--warn">Recovered</span>'
        : corrupt ? '<span class="save-slot__tag save-slot__tag--warn">Corrupted</span>'
          : !filled ? '<span class="save-slot__tag">Empty</span>'
            : '<span class="save-slot__tag">Checkpoint</span>';

    let details: string[];
    if (filled && info.save) {
      const save = info.save;
      const def = getClass(save.classId);
      const zone = getZoneDef(save.zoneId);
      const progress = save.progress[save.zoneId];
      // The save always stores the authored slot count; the card reports the
      // camps this build actually plays.
      const campsTotal = activeCampsForZone(save.zoneId);
      const campsCleared = progress.campsCleared.slice(0, campsTotal).filter(Boolean).length;
      const bossLine = zone.bossId === null
        ? 'No warden'
        : progress.bossDefeated
          ? 'Warden slain'
          : progress.bossSpawned
            ? 'Warden awake'
            : 'Warden sleeping';
      details = [
        `${def.name} · Level ${save.level}`,
        `${Math.round(save.hp)} / ${Math.round(save.maxHp)} life · ${zone.name}`,
        `Camps ${campsCleared}/${campsTotal} · ${bossLine}`,
      ];
    } else if (corrupt) {
      details = ['The save data is unreadable.', info.error ?? 'Unknown save error.'];
    } else {
      details = ['No exile rests in this slot.', 'Begin a new run or save here.'];
    }

    const action = saving
      ? (filled ? 'Overwrite this slot' : 'Save in this slot')
      : (filled ? 'Load this exile' : 'Nothing to load');

    body.innerHTML = `
      <div class="save-slot__head">
        <span class="save-slot__index">Slot ${info.slot + 1}</span>
        ${tag}
      </div>
      <div class="save-slot__class"></div>
      <div class="save-slot__details"></div>
      <div class="save-slot__action"></div>`;
    (body.querySelector('.save-slot__class') as HTMLElement).textContent = filled && info.save
      ? getClass(info.save.classId).name
      : corrupt ? 'Unknown exile' : 'Empty slot';
    const detailEl = body.querySelector('.save-slot__details') as HTMLElement;
    for (const line of details) {
      const row = document.createElement('div');
      row.className = 'save-slot__line';
      row.textContent = line;
      detailEl.appendChild(row);
    }
    const stamp = document.createElement('div');
    stamp.className = 'save-slot__stamp';
    stamp.textContent = filled && info.save && info.save.savedAt > 0
      ? new Date(info.save.savedAt).toLocaleString()
      : '';
    detailEl.appendChild(stamp);
    (body.querySelector('.save-slot__action') as HTMLElement).textContent = action;
    card.appendChild(body);

    if (info.status !== 'empty') {
      const remove = document.createElement('button');
      remove.className = 'save-slot__delete';
      remove.dataset.delete = String(info.slot);
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => this.callbacks.onDelete(info.slot));
      card.appendChild(remove);
    }
    return card;
  }
}
