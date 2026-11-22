import type { ItemSlot } from '../content/items';
import { RARITY_COLORS } from '../content/items';
import type { GameState } from '../sim/state';
import type { ItemInstance } from '../sim/items';
import { affixLine } from '../sim/items';
import { getPlayerStats } from '../systems/stats';
import { BAG_CAP } from '../systems/inventory';

export interface InventoryCallbacks {
  onEquip(uid: string): void;
  onUnequip(slot: ItemSlot): void;
}

const SLOT_LABELS: Record<ItemSlot, string> = {
  weapon: 'Weapon',
  helm: 'Helm',
  chest: 'Chest',
  gloves: 'Gloves',
  boots: 'Boots',
  amulet: 'Amulet',
};

/**
 * Inventory screen: equipment slots + bag grid with tooltips. Interactions are
 * click-based (keyboard-accessible buttons, no drag required).
 */
export class InventoryPanel {
  private readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly equipment: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly statsLine: HTMLElement;
  private readonly bagCount: HTMLElement;
  private lastSignature = '';
  visible = false;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: InventoryCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'inventory-screen hidden';
    this.root.innerHTML = `
      <div class="inventory-panel">
        <div class="inventory-header">
          <h3 class="inventory-title">Inventory</h3>
          <div class="inventory-stats" data-inv-stats></div>
        </div>
        <div class="inventory-body">
          <div class="inventory-equipment">
            <h4 class="inventory-sub">Equipped</h4>
            <div data-eq-slots></div>
          </div>
          <div class="inventory-bag">
            <h4 class="inventory-sub">Bag <span data-bag-count></span></h4>
            <div class="inventory-grid" data-bag-grid></div>
          </div>
        </div>
        <p class="inventory-hint">Click gear to equip · click equipped gear to remove · I to close</p>
      </div>
      <div class="item-tooltip hidden" data-tooltip></div>`;
    parent.appendChild(this.root);

    this.grid = this.root.querySelector('[data-bag-grid]') as HTMLElement;
    this.equipment = this.root.querySelector('[data-eq-slots]') as HTMLElement;
    this.tooltip = this.root.querySelector('[data-tooltip]') as HTMLElement;
    this.statsLine = this.root.querySelector('[data-inv-stats]') as HTMLElement;
    this.bagCount = this.root.querySelector('[data-bag-count]') as HTMLElement;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
    if (!this.visible) this.tooltip.classList.add('hidden');
  }

  close(): void {
    this.visible = false;
    this.root.classList.add('hidden');
    this.tooltip.classList.add('hidden');
  }

  sync(state: GameState): void {
    if (!this.visible) return;
    const stats = getPlayerStats(state);
    this.statsLine.textContent =
      `LVL ${state.level} · XP ${state.xp}/${state.xpToNext} · HP ${Math.round(stats.maxHp)} · ` +
      `DMG +${stats.damagePct.toFixed(0)}% · SPD +${stats.moveSpeedPct.toFixed(0)}% · ARM ${stats.damageReductionPct.toFixed(0)}%`;

    // Re-render item lists only when inventory contents change — rebuilding
    // them every frame would destroy hovered elements and flicker tooltips.
    const signature = `${state.inventory.bags.map((i) => i.uid).join(',')}|${Object.values(state.inventory.equipment)
      .map((i) => i?.uid ?? '-')
      .join(',')}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.bagCount.textContent = `${state.inventory.bags.length}/${BAG_CAP}`;

    // Equipment slots (click to unequip).
    this.equipment.innerHTML = '';
    for (const slot of Object.keys(state.inventory.equipment) as ItemSlot[]) {
      const item = state.inventory.equipment[slot];
      const row = document.createElement('button');
      row.className = 'eq-row';
      if (item) {
        row.style.borderColor = RARITY_COLORS[item.rarity].cssColor;
        row.innerHTML = `<span class="eq-slot">${SLOT_LABELS[slot]}</span><span class="eq-item" style="color:${RARITY_COLORS[item.rarity].cssColor}">${item.name}</span>`;
        row.addEventListener('click', () => this.callbacks.onUnequip(slot));
        row.addEventListener('mouseenter', (e) => this.showTooltip(item, e));
        row.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
      } else {
        row.innerHTML = `<span class="eq-slot">${SLOT_LABELS[slot]}</span><span class="eq-empty">— empty —</span>`;
      }
      this.equipment.appendChild(row);
    }

    // Bag grid (click to equip).
    this.grid.innerHTML = '';
    for (const item of state.inventory.bags) {
      const cell = document.createElement('button');
      cell.className = 'item-cell';
      cell.style.borderColor = RARITY_COLORS[item.rarity].cssColor;
      cell.textContent = item.name;
      cell.addEventListener('click', () => this.callbacks.onEquip(item.uid));
      cell.addEventListener('mouseenter', (e) => this.showTooltip(item, e));
      cell.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
      this.grid.appendChild(cell);
    }
  }

  private showTooltip(item: ItemInstance, event: MouseEvent): void {
    const color = RARITY_COLORS[item.rarity].cssColor;
    const lines = item.affixes.map((a) => `<li>${affixLine(a)}</li>`).join('');
    this.tooltip.innerHTML = `
      <div class="tt-name" style="color:${color}">${item.name}</div>
      <div class="tt-meta">${item.rarity.toUpperCase()} ${SLOT_LABELS[item.slot]} · ilvl ${item.itemLevel}</div>
      <ul class="tt-affixes">${lines || '<li class="tt-empty">no properties</li>'}</ul>`;
    this.tooltip.classList.remove('hidden');
    const x = Math.min(window.innerWidth - 260, event.clientX + 16);
    const y = Math.min(window.innerHeight - 160, event.clientY + 16);
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }
}
