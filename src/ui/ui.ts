import { CLASSES } from '../content/classes';
import type { SkillDef } from '../content/skills';
import { LOADOUT_SLOTS, type ClassDef, type ClassId, type LoadoutSlot, type SkillId } from '../content/types';
import type { FlaskKind } from '../systems/flasks';
import './styles.css';

export type GameMode = 'title' | 'class-select' | 'playing' | 'paused';

export interface UiCallbacks {
  onNewGame(): void;
  onBack(): void;
  onStartRun(id: ClassId): void;
  onPause(): void;
  onResume(): void;
  onRestart(): void;
  onQuitToTitle(): void;
  onRespawn(): void;
  onContinue(): void;
  /** Title-screen Continue: load the most recent checkpoint. */
  onContinueRun(): void;
  /** Open the save/load slot screen from the title or pause menu. */
  onOpenSlots(mode: 'load' | 'save'): void;
  /** Clicking a hotbar slot opens the picker for that slot. */
  onOpenSkillPicker(slot: LoadoutSlot): void;
  /** The pause menu's Skills button. */
  onOpenSkills(): void;
  onUseFlask(kind: FlaskKind): void;
}

/** One hotbar entry: empty slots have a null skill and zeroed numbers. */
export interface LoadoutEntry {
  slot: LoadoutSlot;
  skill: SkillDef | null;
  rank: number;
  minDamage: number;
  maxDamage: number;
  cooldown: number;
}

/** Title-screen checkpoint summary (slice 8). */
export interface TitleSaveInfo {
  classId: ClassId;
  level: number;
}

/** Per-frame combat HUD data (slice 5: mana gating + cooldown sweeps). */
export interface CombatHud {
  mana: number;
  maxMana: number;
  cooldowns: Partial<Record<SkillId, number>>;
  flasks: Record<FlaskKind, { charges: number; max: number }>;
}

/** Zone objective readout (slice 7). */
export interface ObjectiveHud {
  campsCleared: number;
  campsTotal: number;
  bossSpawned: boolean;
  bossDefeated: boolean;
}

export interface DeathRecap {
  killer: string;
  damageTaken: number;
  kills: number;
  /** Seconds survived this life. */
  seconds: number;
}

export interface VictoryRecap {
  kills: number;
  damageTaken: number;
  seconds: number;
  level: number;
}

interface SlotView {
  root: HTMLElement;
  sweep: HTMLElement;
  cooldown: number;
  manaCost: number;
  skillId: SkillId | null;
}

const SLOT_KEYS: Record<LoadoutSlot, string> = { rmb: 'RMB', q: 'Q', w: 'W', e: 'E', r: 'R', f: 'F' };
const FLASK_KEYS: Record<FlaskKind, string> = { health: '1', mana: '2' };

/**
 * DOM-overlay interface: title, class select, HUD, pause menu.
 * Kept out of the canvas so it stays accessible and cheap to iterate on.
 */
export class Ui {
  private readonly titleScreen: HTMLElement;
  private readonly classScreen: HTMLElement;
  private readonly pauseScreen: HTMLElement;
  private readonly deathScreen: HTMLElement;
  private readonly victoryScreen: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly selectedCard = new Map<ClassId, HTMLElement>();
  private selected: ClassId = CLASSES[0].id;
  private readonly hudClass: HTMLElement;
  private readonly hudZone: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly esBar: HTMLElement;
  private readonly esFill: HTMLElement;
  private readonly esText: HTMLElement;
  private readonly manaFill: HTMLElement;
  private readonly manaText: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly levelText: HTMLElement;
  private readonly pointsBadge: HTMLElement;
  private readonly toastLayer: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly objectivesEl: HTMLElement;
  private readonly objectiveList: HTMLElement;
  private readonly continueBtn: HTMLElement;
  private readonly continueDetail: HTMLElement;
  private readonly loadBtn: HTMLElement;
  private readonly pauseSave: HTMLElement;
  private readonly saveFlash: HTMLElement;
  private readonly damageVignette: HTMLElement;
  private saveFlashTimer = 0;
  private activeSlot: number | null = null;
  private readonly flaskEls = new Map<FlaskKind, HTMLElement>();
  private readonly slots = new Map<LoadoutSlot, SlotView>();
  private lastFlaskCharges: Record<FlaskKind, number> = { health: -1, mana: -1 };
  private lastManaText = '';

  constructor(root: HTMLElement, private readonly callbacks: UiCallbacks) {
    root.innerHTML = this.template();

    this.titleScreen = root.querySelector('[data-screen="title"]') as HTMLElement;
    this.classScreen = root.querySelector('[data-screen="class-select"]') as HTMLElement;
    this.pauseScreen = root.querySelector('[data-screen="paused"]') as HTMLElement;
    this.deathScreen = root.querySelector('[data-screen="death"]') as HTMLElement;
    this.victoryScreen = root.querySelector('[data-screen="victory"]') as HTMLElement;
    this.hud = root.querySelector('[data-hud]') as HTMLElement;
    this.hudClass = root.querySelector('[data-hud-class]') as HTMLElement;
    this.hudZone = root.querySelector('[data-hud-zone]') as HTMLElement;
    this.hpFill = root.querySelector('[data-hp-fill]') as HTMLElement;
    this.hpText = root.querySelector('[data-hp-text]') as HTMLElement;
    this.esBar = root.querySelector('[data-es-bar]') as HTMLElement;
    this.esFill = root.querySelector('[data-es-fill]') as HTMLElement;
    this.esText = root.querySelector('[data-es-text]') as HTMLElement;
    this.manaFill = root.querySelector('[data-mana-fill]') as HTMLElement;
    this.manaText = root.querySelector('[data-mana-text]') as HTMLElement;
    this.xpFill = root.querySelector('[data-xp-fill]') as HTMLElement;
    this.levelText = root.querySelector('[data-hud-level]') as HTMLElement;
    this.pointsBadge = root.querySelector('[data-hud-points]') as HTMLElement;
    this.toastLayer = root.querySelector('[data-toasts]') as HTMLElement;
    this.hotbar = root.querySelector('[data-hotbar]') as HTMLElement;
    this.objectivesEl = root.querySelector('[data-objectives]') as HTMLElement;
    this.objectiveList = root.querySelector('[data-objective-list]') as HTMLElement;
    this.continueBtn = root.querySelector('[data-title-continue]') as HTMLElement;
    this.continueDetail = root.querySelector('[data-title-continue-detail]') as HTMLElement;
    this.loadBtn = root.querySelector('[data-title-load]') as HTMLElement;
    this.pauseSave = root.querySelector('[data-pause-save]') as HTMLElement;
    this.saveFlash = root.querySelector('[data-save-flash]') as HTMLElement;
    this.damageVignette = root.querySelector('[data-damage-vignette]') as HTMLElement;

    root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => this.onAction(btn.dataset.action ?? ''));
    });

    root.querySelectorAll<HTMLElement>('[data-class]').forEach((card) => {
      const id = card.dataset.class as ClassId;
      this.selectedCard.set(id, card);
      card.addEventListener('click', () => this.select(id));
    });

    root.querySelectorAll<HTMLElement>('[data-flask]').forEach((el) => {
      const kind = el.dataset.flask as FlaskKind;
      this.flaskEls.set(kind, el);
      el.addEventListener('click', () => this.callbacks.onUseFlask(kind));
    });

    this.select(this.selected);
  }

  setMode(mode: GameMode): void {
    this.titleScreen.classList.toggle('hidden', mode !== 'title');
    this.classScreen.classList.toggle('hidden', mode !== 'class-select');
    this.pauseScreen.classList.toggle('hidden', mode !== 'paused');
    this.hud.classList.toggle('hidden', mode !== 'playing' && mode !== 'paused');
    if (mode === 'class-select') this.select(this.selected);
    if (mode === 'paused') this.updatePauseSave();
  }

  showHud(def: ClassDef, zoneName: string, loadout: LoadoutEntry[]): void {
    this.hudClass.textContent = def.name;
    this.hudClass.style.color = def.cssColor;
    this.hudZone.textContent = zoneName;
    this.setLoadout(loadout);
    this.lastFlaskCharges = { health: -1, mana: -1 };
    this.lastManaText = '';
  }

  setPlayerHp(hp: number, maxHp: number): void {
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    this.hpFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.hpText.textContent = `${Math.round(hp)} / ${Math.round(maxHp)}`;
  }

  /** Energy shield readout; hidden for builds with no shield. */
  setPlayerEs(es: number, maxEs: number): void {
    this.esBar.classList.toggle('hidden', maxEs <= 0);
    if (maxEs <= 0) return;
    const ratio = Math.max(0, Math.min(1, es / maxEs));
    this.esFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.esText.textContent = `${Math.round(es)} / ${Math.round(maxEs)}`;
  }

  setPlayerXp(level: number, xp: number, xpToNext: number): void {
    const ratio = Math.max(0, Math.min(1, xp / Math.max(1, xpToNext)));
    this.xpFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.levelText.textContent = `LVL ${level}`;
  }

  /** Title-screen Continue availability and summary (slice 8). */
  setSaveInfo(latest: TitleSaveInfo | null, hasSaves: boolean): void {
    this.continueBtn.classList.toggle('hidden', latest === null);
    this.loadBtn.classList.toggle('hidden', !hasSaves);
    if (!latest) return;
    const def = CLASSES.find((c) => c.id === latest.classId);
    this.continueDetail.textContent = `${def?.name ?? 'Exile'} · Level ${latest.level}`;
  }

  /** Which slot autosaves write to; null means the run is unbound. */
  setActiveSlot(slot: number | null): void {
    this.activeSlot = slot;
    this.updatePauseSave();
  }

  private updatePauseSave(): void {
    this.pauseSave.textContent = this.activeSlot === null
      ? 'Ashen Vale v1.2 · autosave off — save manually'
      : `Ashen Vale v1.2 · autosave slot ${this.activeSlot + 1}`;
  }

  /** Red/blue edge pulse for health or shield damage (readability, not motion). */
  flashDamage(kind: 'health' | 'shield', strength: number): void {
    const el = this.damageVignette;
    el.style.setProperty('--damage-strength', String(Math.max(0.2, Math.min(1, strength))));
    el.classList.remove('damage-vignette--health', 'damage-vignette--shield');
    void el.offsetWidth;
    el.classList.add(kind === 'health' ? 'damage-vignette--health' : 'damage-vignette--shield');
  }

  /** Small transient confirmation near the HUD badge. */
  flashSave(text: string): void {
    this.saveFlash.textContent = text;
    this.saveFlash.classList.remove('hidden', 'save-flash--pulse');
    void this.saveFlash.offsetWidth;
    this.saveFlash.classList.add('save-flash--pulse');
    window.clearTimeout(this.saveFlashTimer);
    this.saveFlashTimer = window.setTimeout(() => this.saveFlash.classList.add('hidden'), 1600);
  }

  /** Unspent passive/skill points nag; one compact line. */
  setPoints(passiveAvailable: number, skillAvailable: number): void {
    const parts: string[] = [];
    if (passiveAvailable > 0) {
      parts.push(`${passiveAvailable} passive point${passiveAvailable === 1 ? '' : 's'} — P`);
    }
    if (skillAvailable > 0) {
      parts.push(`${skillAvailable} skill point${skillAvailable === 1 ? '' : 's'} — K`);
    }
    this.pointsBadge.classList.toggle('hidden', parts.length === 0);
    this.pointsBadge.textContent = parts.join(' · ');
  }

  /** Per-frame resource readout: mana bar, cooldown sweeps, flask charges. */
  syncCombat(data: CombatHud): void {
    const manaText = `${Math.round(data.mana)} / ${Math.round(data.maxMana)}`;
    if (manaText !== this.lastManaText) {
      this.lastManaText = manaText;
      this.manaFill.style.width = `${(Math.max(0, Math.min(1, data.mana / Math.max(1, data.maxMana))) * 100).toFixed(1)}%`;
      this.manaText.textContent = manaText;
    }

    for (const slot of this.slots.values()) {
      if (slot.skillId === null) {
        slot.sweep.style.setProperty('--sweep', '0deg');
        slot.root.classList.remove('slot--cooling', 'slot--unaffordable');
        continue;
      }
      const remaining = data.cooldowns[slot.skillId] ?? 0;
      const frac = slot.cooldown > 0 ? Math.max(0, Math.min(1, remaining / slot.cooldown)) : 0;
      slot.sweep.style.setProperty('--sweep', `${(frac * 360).toFixed(1)}deg`);
      slot.root.classList.toggle('slot--cooling', frac > 0.001);
      slot.root.classList.toggle('slot--unaffordable', slot.manaCost > 0 && data.mana < slot.manaCost);
    }

    for (const kind of ['health', 'mana'] as const) {
      const flask = data.flasks[kind];
      if (flask.charges === this.lastFlaskCharges[kind]) continue;
      this.lastFlaskCharges[kind] = flask.charges;
      const el = this.flaskEls.get(kind);
      if (!el) continue;
      el.classList.toggle('flask--empty', flask.charges <= 0);
      const pips = el.querySelector('[data-pips]') as HTMLElement;
      pips.innerHTML = Array.from({ length: flask.max }, (_, i) =>
        `<i class="${i < flask.charges ? 'pip pip--full' : 'pip'}"></i>`).join('');
    }
  }

  showToast(text: string, cssColor?: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    if (cssColor) el.style.color = cssColor;
    this.toastLayer.appendChild(el);
    window.setTimeout(() => el.remove(), 2800);
  }

  clearToasts(): void {
    this.toastLayer.replaceChildren();
  }

  showDeath(recap: DeathRecap): void {
    this.clearToasts();
    const minutes = Math.floor(recap.seconds / 60);
    const seconds = Math.round(recap.seconds % 60);
    (this.deathScreen.querySelector('[data-recap-killer]') as HTMLElement).textContent = recap.killer;
    (this.deathScreen.querySelector('[data-recap-damage]') as HTMLElement).textContent = String(recap.damageTaken);
    (this.deathScreen.querySelector('[data-recap-kills]') as HTMLElement).textContent = String(recap.kills);
    (this.deathScreen.querySelector('[data-recap-time]') as HTMLElement).textContent =
      `${minutes}:${String(seconds).padStart(2, '0')}`;
    this.deathScreen.classList.remove('hidden');
  }

  hideDeath(): void {
    this.deathScreen.classList.add('hidden');
  }

  /** Zone objective tracker (slice 7). */
  setObjectives(o: ObjectiveHud): void {
    this.objectivesEl.classList.toggle('hidden', o.campsTotal <= 0);
    const campDone = o.campsTotal > 0 && o.campsCleared >= o.campsTotal;
    const lines = [
      { done: campDone, text: `Clear the camps (${o.campsCleared}/${o.campsTotal})` },
      {
        done: o.bossDefeated,
        text: o.bossSpawned || o.bossDefeated ? 'Slay the Ashen Warden' : 'Slay the Ashen Warden (awaits behind the camps)',
      },
    ];
    this.objectiveList.innerHTML = lines
      .map((l) => `<div class="objectives__item${l.done ? ' objectives__item--done' : ''}"></div>`)
      .join('');
    this.objectiveList.querySelectorAll('.objectives__item').forEach((el, i) => {
      el.textContent = `${lines[i].done ? '✓' : '·'} ${lines[i].text}`;
    });
  }

  showVictory(recap: VictoryRecap): void {
    this.clearToasts();
    const minutes = Math.floor(recap.seconds / 60);
    const seconds = Math.round(recap.seconds % 60);
    (this.victoryScreen.querySelector('[data-victory-kills]') as HTMLElement).textContent = String(recap.kills);
    (this.victoryScreen.querySelector('[data-victory-damage]') as HTMLElement).textContent = String(recap.damageTaken);
    (this.victoryScreen.querySelector('[data-victory-time]') as HTMLElement).textContent =
      `${minutes}:${String(seconds).padStart(2, '0')}`;
    (this.victoryScreen.querySelector('[data-victory-level]') as HTMLElement).textContent = String(recap.level);
    this.victoryScreen.classList.remove('hidden');
  }

  hideVictory(): void {
    this.victoryScreen.classList.add('hidden');
  }

  /** Rebuild the six loadout slots (RMB, Q, W, E, R, F). */
  setLoadout(entries: LoadoutEntry[]): void {
    this.slots.clear();
    const bySlot = new Map(entries.map((entry) => [entry.slot, entry]));
    this.hotbar.innerHTML = LOADOUT_SLOTS.map((slot) => {
      const entry = bySlot.get(slot);
      const skill = entry?.skill ?? null;
      if (!skill || !entry) {
        return `
          <button class="slot slot--empty" data-skill-slot="${slot}">
            <span class="slot__art slot__art--empty">+</span>
            <span class="slot__key">${SLOT_KEYS[slot]}</span>
            <span class="slot__assign">assign</span>
            <span class="slot__sweep" data-sweep></span>
            <span class="slot__tip">
              <span class="slot__tip-name">Empty ${SLOT_KEYS[slot]}</span>
              <span class="slot__tip-line">Click to choose a skill</span>
            </span>
          </button>`;
      }
      return `
        <button class="slot" data-skill-slot="${slot}" data-skill-id="${skill.id}"
          style="--skill-color: ${skill.cssColor}">
          <span class="slot__art"><span class="slot__glyph">${skill.glyph}</span></span>
          <span class="slot__key">${SLOT_KEYS[slot]}</span>
          ${entry.rank > 1 ? `<span class="slot__rank">R${entry.rank}</span>` : ''}
          <span class="slot__cost">${skill.manaCost}</span>
          <span class="slot__sweep" data-sweep></span>
          <span class="slot__tip">
            <span class="slot__tip-name">${skill.name}${entry.rank > 1 ? ` · Rank ${entry.rank}` : ''}</span>
            <span class="slot__tip-line">${entry.minDamage}-${entry.maxDamage} damage · ${skill.manaCost > 0 ? `${skill.manaCost} mana` : 'free'} · ${entry.cooldown}s cooldown</span>
            <span class="slot__tip-desc">${skill.description}</span>
          </span>
        </button>`;
    }).join('');

    this.hotbar.querySelectorAll<HTMLElement>('[data-skill-slot]').forEach((el) => {
      const slot = el.dataset.skillSlot as LoadoutSlot;
      const entry = bySlot.get(slot);
      if (!entry) return;
      this.slots.set(slot, {
        root: el,
        sweep: el.querySelector('[data-sweep]') as HTMLElement,
        cooldown: entry.cooldown,
        manaCost: entry.skill?.manaCost ?? 0,
        skillId: entry.skill?.id ?? null,
      });
      el.addEventListener('click', () => this.callbacks.onOpenSkillPicker(slot));
    });
  }

  private select(id: ClassId): void {
    this.selected = id;
    for (const [cardId, card] of this.selectedCard) {
      card.classList.toggle('class-card--selected', cardId === id);
    }
  }

  private onAction(action: string): void {
    switch (action) {
      case 'new-game':
        this.callbacks.onNewGame();
        break;
      case 'continue-run':
        this.callbacks.onContinueRun();
        break;
      case 'load-game':
        this.callbacks.onOpenSlots('load');
        break;
      case 'save-slots':
        this.callbacks.onOpenSlots('save');
        break;
      case 'load-slots':
        this.callbacks.onOpenSlots('load');
        break;
      case 'skills':
        this.callbacks.onOpenSkills();
        break;
      case 'back':
        this.callbacks.onBack();
        break;
      case 'begin':
        this.callbacks.onStartRun(this.selected);
        break;
      case 'pause':
        this.callbacks.onPause();
        break;
      case 'resume':
        this.callbacks.onResume();
        break;
      case 'restart':
        this.callbacks.onRestart();
        break;
      case 'quit':
        this.callbacks.onQuitToTitle();
        break;
      case 'respawn':
        this.callbacks.onRespawn();
        break;
      case 'continue':
        this.callbacks.onContinue();
        break;
    }
  }

  private template(): string {
    const cards = CLASSES.map(
      (c) => `
      <button class="class-card" data-class="${c.id}" style="--class-color: ${c.cssColor}">
        <span class="class-card__glyph"></span>
        <span class="class-card__name">${c.name}</span>
        <span class="class-card__epithet">${c.epithet}</span>
        <span class="class-card__desc">${c.description}</span>
        <span class="class-card__stats">STR ${c.stats.strength} · DEX ${c.stats.dexterity} · INT ${c.stats.intelligence}</span>
      </button>`,
    ).join('');

    return `
      <div class="damage-vignette" data-damage-vignette></div>

      <div class="screen" data-screen="title">
        <div class="screen__vignette"></div>
        <div class="screen__content">
          <p class="eyebrow">A dark fantasy action RPG</p>
          <h1 class="game-title">Ashen Vale</h1>
          <p class="tagline">The moor is burning. Walk into it.</p>
          <button class="btn btn--primary title-continue hidden" data-action="continue-run" data-title-continue>
            <span>Continue</span>
            <span class="title-continue__detail" data-title-continue-detail></span>
          </button>
          <button class="btn btn--primary" data-action="new-game">New Game</button>
          <button class="btn hidden" data-action="load-game" data-title-load>Load Game</button>
          <p class="hint">Left click to move and attack · Scroll to zoom · Esc pauses</p>
        </div>
      </div>

      <div class="screen hidden" data-screen="class-select">
        <div class="screen__vignette"></div>
        <div class="screen__content screen__content--wide">
          <p class="eyebrow">Choose your exile</p>
          <h2 class="screen-title">Who walks into the Ashen Vale?</h2>
          <div class="class-cards">${cards}</div>
          <div class="class-actions">
            <button class="btn" data-action="back">Back</button>
            <button class="btn btn--primary" data-action="begin">Begin the Descent</button>
          </div>
        </div>
      </div>

      <div class="hud hidden" data-hud>
        <div class="hud__plate">
          <div class="hud__class" data-hud-class>—</div>
          <div class="hud__zone" data-hud-zone>—</div>
          <div class="hud__hp">
            <div class="hud__hp-fill" data-hp-fill></div>
            <span class="hud__hp-text" data-hp-text>120 / 120</span>
          </div>
          <div class="hud__es hidden" data-es-bar>
            <div class="hud__es-fill" data-es-fill></div>
            <span class="hud__es-text" data-es-text>0 / 0</span>
          </div>
          <div class="hud__mana">
            <div class="hud__mana-fill" data-mana-fill></div>
            <span class="hud__mana-text" data-mana-text>— / —</span>
          </div>
          <div class="hud__xp">
            <div class="hud__xp-fill" data-xp-fill></div>
            <span class="hud__lvl" data-hud-level>LVL 1</span>
          </div>
          <div class="hud__pts hidden" data-hud-points></div>
        </div>
        <div class="hotbar-row">
          <div class="hotbar" data-hotbar></div>
          <div class="flasks">
            <button class="flask flask--health" data-flask="health">
              <span class="flask__key">${FLASK_KEYS.health}</span>
              <span class="flask__glyph">✚</span>
              <span class="flask__pips" data-pips></span>
            </button>
            <button class="flask flask--mana" data-flask="mana">
              <span class="flask__key">${FLASK_KEYS.mana}</span>
              <span class="flask__glyph">✦</span>
              <span class="flask__pips" data-pips></span>
            </button>
          </div>
        </div>
        <div class="objectives hidden" data-objectives>
          <div class="objectives__title">Objectives</div>
          <div class="objectives__list" data-objective-list></div>
        </div>
        <div class="save-flash hidden" data-save-flash></div>
      </div>

      <div class="toast-layer" data-toasts></div>

      <div class="screen screen--death hidden" data-screen="death">
        <div class="screen__vignette"></div>
        <div class="screen__content">
          <p class="eyebrow">The moor takes its due</p>
          <h2 class="screen-title screen-title--death">You have fallen</h2>
          <div class="recap">
            <div class="recap__row"><span class="recap__label">Slain by</span><span class="recap__value" data-recap-killer>—</span></div>
            <div class="recap__row"><span class="recap__label">Damage taken</span><span class="recap__value" data-recap-damage>0</span></div>
            <div class="recap__row"><span class="recap__label">Enemies slain</span><span class="recap__value" data-recap-kills>0</span></div>
            <div class="recap__row"><span class="recap__label">Time survived</span><span class="recap__value" data-recap-time>0:00</span></div>
          </div>
          <p class="hint">Rising again keeps your level and loot and refills your flasks.</p>
          <div class="pause-actions">
            <button class="btn btn--primary" data-action="respawn">Rise Again at the Checkpoint</button>
            <button class="btn" data-action="quit">Abandon to Title</button>
          </div>
        </div>
      </div>

      <div class="screen screen--victory hidden" data-screen="victory">
        <div class="screen__vignette"></div>
        <div class="screen__content">
          <p class="eyebrow">The moor falls silent</p>
          <h2 class="screen-title screen-title--victory">The Ashen Warden has fallen</h2>
          <div class="recap">
            <div class="recap__row"><span class="recap__label">Enemies slain</span><span class="recap__value" data-victory-kills>0</span></div>
            <div class="recap__row"><span class="recap__label">Damage taken</span><span class="recap__value" data-victory-damage>0</span></div>
            <div class="recap__row"><span class="recap__label">Time survived</span><span class="recap__value" data-victory-time>0:00</span></div>
            <div class="recap__row"><span class="recap__label">Level reached</span><span class="recap__value" data-victory-level>1</span></div>
          </div>
          <div class="pause-actions">
            <button class="btn btn--primary" data-action="continue">Continue</button>
            <button class="btn" data-action="quit">Return to Title</button>
          </div>
        </div>
      </div>

      <div class="screen hidden" data-screen="paused">
        <div class="screen__vignette"></div>
        <div class="screen__content">
          <p class="eyebrow">The moor waits</p>
          <h2 class="screen-title">Paused</h2>
          <p class="pause-save" data-pause-save>Autosave · Slot 1</p>
          <div class="pause-actions">
            <button class="btn btn--primary" data-action="resume">Resume</button>
            <button class="btn" data-action="skills">Skills</button>
            <button class="btn" data-action="save-slots">Save Game</button>
            <button class="btn" data-action="load-slots">Load Game</button>
            <button class="btn" data-action="restart">Restart Run</button>
            <button class="btn" data-action="quit">Quit to Title</button>
          </div>
          <div class="controls">
            <div class="controls__title">Controls</div>
            <div class="controls__grid">
              <span><kbd>Left click</kbd> move / attack</span>
              <span><kbd>Right click</kbd> RMB skill</span>
              <span><kbd>Q W E R F</kbd> skills</span>
              <span><kbd>1 / 2</kbd> flasks</span>
              <span><kbd>P</kbd> passives</span>
              <span><kbd>K</kbd> skills</span>
              <span><kbd>I</kbd> inventory</span>
              <span><kbd>Scroll</kbd> zoom</span>
              <span><kbd>Esc</kbd> pause / close</span>
            </div>
          </div>
        </div>
      </div>`;
  }
}
