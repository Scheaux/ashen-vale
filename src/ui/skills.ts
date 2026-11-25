import { activeSkillsFor, getSkill } from '../content/skills';
import { RUNES, type RuneId } from '../content/runes';
import { LOADOUT_SLOTS, type LoadoutSlot, type SkillId } from '../content/types';
import type { GameState } from '../sim/state';
import {
  MAX_SKILL_RANK,
  canSetRune,
  canUnlockSkill,
  canUpgradeSkill,
  effectiveSkillCooldown,
  effectiveSkillDamage,
  runeFor,
  skillInSlot,
  skillManaCost,
  skillPointsAvailable,
  skillPointsSpent,
  skillPointsTotal,
  skillRank,
} from '../systems/loadout';

export interface SkillPanelCallbacks {
  onAssign(slot: LoadoutSlot, skillId: SkillId | null): void;
  onUnlock(skillId: SkillId): void;
  onUpgrade(skillId: SkillId): void;
  onRune(skillId: SkillId, runeId: RuneId | null): void;
  onClose(): void;
}

const SLOT_LABELS: Record<LoadoutSlot, string> = {
  rmb: 'RMB',
  q: 'Q',
  w: 'W',
  e: 'E',
  r: 'R',
  f: 'F',
};

/**
 * Skill library and loadout picker. Clicking a hotbar slot opens this panel
 * with that slot selected; the player can unlock/upgrade with skill points and
 * assign an unlocked active skill to any of the six slots.
 */
export class SkillPanel {
  private readonly root: HTMLElement;
  private readonly pointsEl: HTMLElement;
  private readonly targetEl: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;
  private selectedSlot: LoadoutSlot = 'q';
  visible = false;

  constructor(parent: HTMLElement, private readonly callbacks: SkillPanelCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'skill-screen hidden';
    this.root.innerHTML = `
      <div class="skill-panel">
        <div class="skill-header">
          <div>
            <h3 class="inventory-title">Skills</h3>
            <div class="skill-target" data-skill-target-label></div>
          </div>
          <div class="skill-header__right">
            <div class="skill-points" data-skill-points></div>
            <button class="save-close" data-skill-close aria-label="Close">✕</button>
          </div>
        </div>
        <div class="skill-tabs" data-skill-tabs></div>
        <div class="skill-list" data-skill-list></div>
        <div class="skill-footer">
          <button class="skill-btn skill-btn--quiet" data-skill-clear>Clear this slot</button>
          <span class="inventory-hint">Unlock and upgrade with skill points · click a slot to choose its skill · K or Esc to close</span>
        </div>
      </div>`;
    parent.appendChild(this.root);

    this.pointsEl = this.root.querySelector('[data-skill-points]') as HTMLElement;
    this.targetEl = this.root.querySelector('[data-skill-target-label]') as HTMLElement;
    this.tabsEl = this.root.querySelector('[data-skill-tabs]') as HTMLElement;
    this.listEl = this.root.querySelector('[data-skill-list]') as HTMLElement;
    this.clearBtn = this.root.querySelector('[data-skill-clear]') as HTMLButtonElement;
    (this.root.querySelector('[data-skill-close]') as HTMLElement).addEventListener('click', () => this.callbacks.onClose());
    this.clearBtn.addEventListener('click', () => this.callbacks.onAssign(this.selectedSlot, null));
  }

  open(slot: LoadoutSlot, state: GameState): void {
    this.selectedSlot = slot;
    this.visible = true;
    this.root.classList.remove('hidden');
    this.sync(state);
  }

  close(): void {
    this.visible = false;
    this.root.classList.add('hidden');
  }

  toggle(slot: LoadoutSlot, state: GameState): void {
    if (this.visible) this.close();
    else this.open(slot, state);
  }

  selectSlot(slot: LoadoutSlot, state: GameState): void {
    this.selectedSlot = slot;
    this.sync(state);
  }

  sync(state: GameState): void {
    if (!this.visible) return;
    const available = skillPointsAvailable(state);
    const spent = skillPointsSpent(state);
    const total = skillPointsTotal(state);
    this.pointsEl.textContent = `${available} available · ${spent}/${total} spent`;
    this.targetEl.textContent = `Assigning to ${SLOT_LABELS[this.selectedSlot]}`;

    this.tabsEl.innerHTML = '';
    for (const slot of LOADOUT_SLOTS) {
      const id = skillInSlot(state, slot);
      const button = document.createElement('button');
      button.className = `skill-tab${slot === this.selectedSlot ? ' skill-tab--active' : ''}`;
      button.dataset.skillTarget = slot;
      button.innerHTML = `<span class="skill-tab__key">${SLOT_LABELS[slot]}</span><span class="skill-tab__name"></span>`;
      (button.querySelector('.skill-tab__name') as HTMLElement).textContent = id ? getSkill(id).name : 'Empty';
      button.addEventListener('click', () => this.selectSlot(slot, state));
      this.tabsEl.appendChild(button);
    }

    const selectedId = skillInSlot(state, this.selectedSlot);
    this.clearBtn.disabled = selectedId === null;
    this.clearBtn.classList.toggle('hidden', selectedId === null);

    this.listEl.innerHTML = '';
    for (const skill of activeSkillsFor(state.player.classId)) {
      this.listEl.appendChild(this.makeCard(state, skill.id));
    }
  }

  private makeCard(state: GameState, id: SkillId): HTMLElement {
    const skill = getSkill(id);
    const rank = skillRank(state, id);
    const unlocked = rank > 0;
    const equippedSlot = LOADOUT_SLOTS.find((slot) => skillInSlot(state, slot) === id) ?? null;
    const damage = effectiveSkillDamage(state, id);
    const cooldown = effectiveSkillCooldown(state, id);
    const card = document.createElement('article');
    card.className = `skill-card${unlocked ? '' : ' skill-card--locked'}`;
    card.dataset.skillId = id;

    const head = document.createElement('div');
    head.className = 'skill-card__head';
    head.innerHTML = `
      <span class="skill-card__glyph" style="color:${skill.cssColor}">${skill.glyph}</span>
      <span class="skill-card__title">
        <span class="skill-card__name"></span>
        <span class="skill-card__meta"></span>
      </span>
      <span class="skill-card__rank"></span>`;
    (head.querySelector('.skill-card__name') as HTMLElement).textContent = skill.name;
    (head.querySelector('.skill-card__meta') as HTMLElement).textContent =
      `${damage.min}-${damage.max} damage · ${skillManaCost(state, id)} mana · ${cooldown}s cooldown`;
    (head.querySelector('.skill-card__rank') as HTMLElement).textContent =
      unlocked ? `Rank ${rank}/${MAX_SKILL_RANK}` : `Level ${skill.unlockLevel}`;
    card.appendChild(head);

    const description = document.createElement('p');
    description.className = 'skill-card__desc';
    description.textContent = skill.description;
    card.appendChild(description);

    if (unlocked) {
      const runes = document.createElement('div');
      runes.className = 'skill-card__runes';
      const label = document.createElement('span');
      label.className = 'skill-card__rune-label';
      label.textContent = 'Rune';
      runes.appendChild(label);
      const current = runeFor(state, id)?.id ?? null;
      const none = document.createElement('button');
      none.className = `rune-btn${current === null ? ' rune-btn--active' : ''}`;
      none.dataset.skillRuneNone = id;
      none.textContent = 'None';
      none.addEventListener('click', () => this.callbacks.onRune(id, null));
      runes.appendChild(none);
      for (const rune of RUNES) {
        const button = document.createElement('button');
        const allowed = canSetRune(state, id, rune.id).ok;
        button.className = `rune-btn${current === rune.id ? ' rune-btn--active' : ''}`;
        button.dataset.skillRune = rune.id;
        button.dataset.skillRuneFor = id;
        button.style.color = rune.cssColor;
        button.disabled = !allowed && current !== rune.id;
        button.title = allowed ? rune.description : `${rune.description} Unlocks at level ${rune.unlockLevel}.`;
        button.textContent = `${rune.glyph} ${rune.name.replace(' Rune', '')}`;
        button.addEventListener('click', () => this.callbacks.onRune(id, rune.id));
        runes.appendChild(button);
      }
      card.appendChild(runes);
    }

    const actions = document.createElement('div');
    actions.className = 'skill-card__actions';

    if (!unlocked) {
      const unlock = document.createElement('button');
      unlock.className = 'skill-btn skill-btn--primary';
      unlock.dataset.skillUnlock = id;
      const result = canUnlockSkill(state, id);
      unlock.disabled = !result.ok;
      unlock.textContent = state.level < skill.unlockLevel
        ? `Unlocks at level ${skill.unlockLevel}`
        : `Unlock · 1 SP`;
      unlock.addEventListener('click', () => this.callbacks.onUnlock(id));
      actions.appendChild(unlock);
    } else {
      const equip = document.createElement('button');
      equip.className = 'skill-btn skill-btn--primary';
      equip.dataset.skillEquip = id;
      equip.textContent = equippedSlot === this.selectedSlot
        ? `Equipped in ${SLOT_LABELS[this.selectedSlot]}`
        : equippedSlot
          ? `Move from ${SLOT_LABELS[equippedSlot]}`
          : `Equip to ${SLOT_LABELS[this.selectedSlot]}`;
      equip.disabled = equippedSlot === this.selectedSlot;
      equip.addEventListener('click', () => this.callbacks.onAssign(this.selectedSlot, id));
      actions.appendChild(equip);

      const upgrade = document.createElement('button');
      upgrade.className = 'skill-btn';
      upgrade.dataset.skillUpgrade = id;
      const result = canUpgradeSkill(state, id);
      upgrade.disabled = !result.ok;
      upgrade.textContent = rank >= MAX_SKILL_RANK ? 'Max rank' : 'Upgrade · 1 SP';
      upgrade.addEventListener('click', () => this.callbacks.onUpgrade(id));
      actions.appendChild(upgrade);
    }
    card.appendChild(actions);
    return card;
  }
}
