import { RARITY_COLORS, type ItemSlot } from '../content/items';
import type { GameState } from '../sim/state';
import { affixLine, effectiveItemValue } from '../sim/items';
import {
  CRAFT_COSTS,
  canCraft,
  findOwnedItem,
  ownedItems,
  type CraftAction,
  type OwnedItem,
} from '../systems/crafting';
import { salvageValue } from '../systems/salvage';

export interface CraftingCallbacks {
  onCraft(action: CraftAction, uid: string): void;
  onSalvage(uid: string): void;
  onClose(): void;
}

const SLOT_LABELS: Record<ItemSlot, string> = {
  weapon: 'Weapon',
  helm: 'Helm',
  chest: 'Chest',
  gloves: 'Gloves',
  boots: 'Boots',
  amulet: 'Amulet',
};

const ACTIONS: Array<{ action: CraftAction; label: string }> = [
  { action: 'reforge', label: 'Reforge affix' },
  { action: 'add', label: 'Add affix' },
  { action: 'quality', label: 'Quality +5%' },
];

/**
 * Crafting bench: select any owned item and spend Ember Dust / Ashen Runes /
 * Quality Embers on reforging, adding affixes or quality. Every action is a
 * validated transaction in systems/crafting.ts.
 */
export class CraftingPanel {
  private readonly root: HTMLElement;
  private readonly currencyEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly closeBtn: HTMLElement;
  private selectedUid: string | null = null;
  private pendingSalvageUid: string | null = null;
  private lastSignature = '';
  visible = false;

  constructor(parent: HTMLElement, private readonly callbacks: CraftingCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'craft-screen hidden';
    this.root.innerHTML = `
      <div class="craft-panel">
        <div class="craft-header">
          <div>
            <h3 class="inventory-title">Crafting Bench</h3>
            <div class="craft-currency" data-craft-currency></div>
          </div>
          <button class="save-close" data-craft-close aria-label="Close">✕</button>
        </div>
        <div class="craft-body">
          <div class="craft-items">
            <h4 class="inventory-sub">Owned items</h4>
            <div class="craft-list" data-craft-list></div>
          </div>
          <div class="craft-detail" data-craft-detail></div>
        </div>
        <p class="inventory-hint">Crafting spends materials earned from kills · C or Esc to close</p>
      </div>`;
    parent.appendChild(this.root);

    this.currencyEl = this.root.querySelector('[data-craft-currency]') as HTMLElement;
    this.listEl = this.root.querySelector('[data-craft-list]') as HTMLElement;
    this.detailEl = this.root.querySelector('[data-craft-detail]') as HTMLElement;
    this.closeBtn = this.root.querySelector('[data-craft-close]') as HTMLElement;
    this.closeBtn.addEventListener('click', () => this.callbacks.onClose());
  }

  open(state: GameState): void {
    this.visible = true;
    this.root.classList.remove('hidden');
    this.lastSignature = '';
    this.sync(state);
  }

  close(): void {
    this.visible = false;
    this.pendingSalvageUid = null;
    this.root.classList.add('hidden');
  }

  toggle(state: GameState): void {
    if (this.visible) this.close();
    else this.open(state);
  }

  sync(state: GameState): void {
    if (!this.visible) return;
    const owned = ownedItems(state);
    if (this.selectedUid && !findOwnedItem(state, this.selectedUid)) this.selectedUid = null;
    if (!this.selectedUid) this.selectedUid = owned[0]?.item.uid ?? null;
    if (this.pendingSalvageUid) {
      const pending = findOwnedItem(state, this.pendingSalvageUid);
      if (!pending || pending.equipped || this.pendingSalvageUid !== this.selectedUid) {
        this.pendingSalvageUid = null;
      }
    }

    const signature = [
      state.currency.dust,
      state.currency.rune,
      state.currency.quality,
      this.selectedUid ?? '-',
      this.pendingSalvageUid ?? '-',
      ...owned.map(({ item, equipped }) =>
        `${item.uid}:${equipped ? 1 : 0}:${item.rarity}:${item.quality}:${item.implicit?.value ?? '-'}:${item.affixes.map((a) => `${a.id}:${a.value}`).join(',')}`),
    ].join('|');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.currencyEl.textContent =
      `Ember Dust ${state.currency.dust} · Ashen Runes ${state.currency.rune} · Quality Embers ${state.currency.quality}`;
    this.listEl.innerHTML = '';
    for (const { item, equipped } of owned) {
      const button = document.createElement('button');
      button.className = `craft-item${item.uid === this.selectedUid ? ' craft-item--active' : ''}`;
      button.dataset.craftItem = item.uid;
      button.style.borderColor = RARITY_COLORS[item.rarity].cssColor;
      button.innerHTML = `<span class="craft-item__name"></span><span class="craft-item__meta"></span>`;
      (button.querySelector('.craft-item__name') as HTMLElement).textContent = item.name;
      (button.querySelector('.craft-item__meta') as HTMLElement).textContent =
        `${item.rarity}${item.quality > 0 ? ` · ${item.quality}%` : ''}${equipped ? ' · equipped' : ''}`;
      button.addEventListener('click', () => {
        if (this.selectedUid !== item.uid) this.pendingSalvageUid = null;
        this.selectedUid = item.uid;
        this.lastSignature = '';
        this.sync(state);
      });
      this.listEl.appendChild(button);
    }

    this.renderDetail(state, owned.find(({ item }) => item.uid === this.selectedUid) ?? null);
  }

  private renderDetail(state: GameState, entry: OwnedItem | null): void {
    if (!entry) {
      this.detailEl.innerHTML = '<p class="craft-empty">No gear to craft. Find or equip an item first.</p>';
      return;
    }
    const { item, equipped } = entry;
    const color = RARITY_COLORS[item.rarity].cssColor;
    const implicit = item.implicit
      ? `<li class="tt-implicit">${affixLine({ id: item.implicit.id, value: Math.round(effectiveItemValue(item, item.implicit.value)) })} <em>implicit</em></li>`
      : '';
    const affixes = item.affixes
      .map((affix) => `<li>${affixLine({ id: affix.id, value: Math.round(effectiveItemValue(item, affix.value)) })}</li>`)
      .join('');
    this.detailEl.innerHTML = `
      <h4 class="craft-name" style="color:${color}"></h4>
      <div class="craft-meta"></div>
      <ul class="tt-affixes craft-affixes">${implicit}${affixes || (implicit ? '' : '<li class="tt-empty">no properties</li>')}</ul>
      <div class="craft-actions" data-craft-actions></div>`;
    (this.detailEl.querySelector('.craft-name') as HTMLElement).textContent = item.name;
    (this.detailEl.querySelector('.craft-meta') as HTMLElement).textContent =
      `${item.rarity.toUpperCase()} ${SLOT_LABELS[item.slot]} · ilvl ${item.itemLevel} · quality ${item.quality}%`;
    const actions = this.detailEl.querySelector('[data-craft-actions]') as HTMLElement;
    for (const { action, label } of ACTIONS) {
      const cost = CRAFT_COSTS[action];
      const allowed = canCraft(state, item.uid, action);
      const button = document.createElement('button');
      button.className = `skill-btn${action === 'quality' ? '' : ' skill-btn--primary'}`;
      button.dataset.craftAction = action;
      button.disabled = !allowed.ok;
      button.title = allowed.ok ? cost.label : allowed.reason ?? '';
      button.textContent = `${label} · ${cost.amount} ${cost.currency === 'dust' ? 'Dust' : cost.currency === 'rune' ? 'Rune' : 'Ember'}`;
      button.addEventListener('click', () => this.callbacks.onCraft(action, item.uid));
      actions.appendChild(button);
    }

    const salvage = document.createElement('div');
    salvage.className = 'craft-salvage';
    if (equipped) {
      const hint = document.createElement('p');
      hint.className = 'craft-salvage-hint';
      hint.textContent = 'Unequip to salvage';
      salvage.appendChild(hint);
    } else {
      const value = salvageValue(item);
      if (this.pendingSalvageUid === item.uid) {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'skill-btn';
        confirmBtn.dataset.craftSalvageConfirm = '';
        confirmBtn.textContent = `Confirm salvage · ${value} Dust`;
        confirmBtn.addEventListener('click', (event) => {
          if (event.detail > 1) return;
          this.pendingSalvageUid = null;
          this.lastSignature = '';
          this.sync(state);
          this.callbacks.onSalvage(item.uid);
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'skill-btn skill-btn--quiet';
        cancelBtn.dataset.craftSalvageCancel = '';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => {
          this.pendingSalvageUid = null;
          this.lastSignature = '';
          this.sync(state);
        });
        salvage.append(confirmBtn, cancelBtn);
      } else {
        const button = document.createElement('button');
        button.className = 'skill-btn';
        button.dataset.craftSalvage = '';
        button.textContent = `Salvage · ${value} Dust`;
        button.addEventListener('click', () => {
          this.pendingSalvageUid = item.uid;
          this.lastSignature = '';
          this.sync(state);
        });
        salvage.appendChild(button);
      }
    }
    this.detailEl.appendChild(salvage);
  }
}
