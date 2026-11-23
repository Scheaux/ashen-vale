import { CLASSES } from '../content/classes';
import type { SkillDef } from '../content/skills';
import type { ClassDef, ClassId, SkillId } from '../content/types';
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
  onCastSlot(slot: SkillDef['slot']): void;
  onUseFlask(kind: FlaskKind): void;
}

/** Per-frame combat HUD data (slice 5: mana gating + cooldown sweeps). */
export interface CombatHud {
  mana: number;
  maxMana: number;
  cooldowns: Partial<Record<SkillId, number>>;
  flasks: Record<FlaskKind, { charges: number; max: number }>;
}

export interface DeathRecap {
  killer: string;
  damageTaken: number;
  kills: number;
  /** Seconds survived this life. */
  seconds: number;
}

interface SlotView {
  root: HTMLElement;
  sweep: HTMLElement;
  cooldown: number;
  manaCost: number;
}

const SLOT_KEYS: Record<SkillDef['slot'], string> = { q: 'Q', w: 'W', e: 'E', r: 'R' };
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
  private readonly toastLayer: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly flaskEls = new Map<FlaskKind, HTMLElement>();
  private readonly slots = new Map<SkillId, SlotView>();
  private lastFlaskCharges: Record<FlaskKind, number> = { health: -1, mana: -1 };
  private lastManaText = '';

  constructor(root: HTMLElement, private readonly callbacks: UiCallbacks) {
    root.innerHTML = this.template();

    this.titleScreen = root.querySelector('[data-screen="title"]') as HTMLElement;
    this.classScreen = root.querySelector('[data-screen="class-select"]') as HTMLElement;
    this.pauseScreen = root.querySelector('[data-screen="paused"]') as HTMLElement;
    this.deathScreen = root.querySelector('[data-screen="death"]') as HTMLElement;
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
    this.toastLayer = root.querySelector('[data-toasts]') as HTMLElement;
    this.hotbar = root.querySelector('[data-hotbar]') as HTMLElement;

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
  }

  showHud(def: ClassDef, zoneName: string, skills: SkillDef[]): void {
    this.hudClass.textContent = def.name;
    this.hudClass.style.color = def.cssColor;
    this.hudZone.textContent = zoneName;
    this.buildHotbar(skills);
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

  /** Per-frame resource readout: mana bar, cooldown sweeps, flask charges. */
  syncCombat(data: CombatHud): void {
    const manaText = `${Math.round(data.mana)} / ${Math.round(data.maxMana)}`;
    if (manaText !== this.lastManaText) {
      this.lastManaText = manaText;
      this.manaFill.style.width = `${(Math.max(0, Math.min(1, data.mana / Math.max(1, data.maxMana))) * 100).toFixed(1)}%`;
      this.manaText.textContent = manaText;
    }

    for (const [id, slot] of this.slots) {
      const remaining = data.cooldowns[id] ?? 0;
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

  private buildHotbar(skills: SkillDef[]): void {
    this.slots.clear();
    this.hotbar.innerHTML = skills.map((skill) => `
      <button class="slot" data-skill-slot="${skill.slot}" data-skill-id="${skill.id}"
        style="--skill-color: ${skill.cssColor}">
        <span class="slot__art"><span class="slot__glyph">${skill.glyph}</span></span>
        <span class="slot__key">${SLOT_KEYS[skill.slot]}</span>
        ${skill.manaCost > 0 ? `<span class="slot__cost">${skill.manaCost}</span>` : '<span class="slot__cost slot__cost--free">free</span>'}
        <span class="slot__sweep" data-sweep></span>
        <span class="slot__tip">
          <span class="slot__tip-name">${skill.name}</span>
          <span class="slot__tip-line">${skill.damage.min}-${skill.damage.max} damage · ${skill.manaCost > 0 ? `${skill.manaCost} mana` : 'free'} · ${skill.cooldown}s cooldown</span>
          <span class="slot__tip-desc">${skill.description}</span>
        </span>
      </button>`).join('');

    this.hotbar.querySelectorAll<HTMLElement>('[data-skill-slot]').forEach((el) => {
      const skill = skills.find((s) => s.slot === el.dataset.skillSlot);
      if (!skill) return;
      this.slots.set(skill.id, {
        root: el,
        sweep: el.querySelector('[data-sweep]') as HTMLElement,
        cooldown: skill.cooldown,
        manaCost: skill.manaCost,
      });
      el.addEventListener('click', () => this.callbacks.onCastSlot(skill.slot));
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
      <div class="screen" data-screen="title">
        <div class="screen__vignette"></div>
        <div class="screen__content">
          <p class="eyebrow">A dark fantasy action RPG</p>
          <h1 class="game-title">Ashen Vale</h1>
          <p class="tagline">The moor is burning. Walk into it.</p>
          <button class="btn btn--primary" data-action="new-game">New Game</button>
          <p class="hint">Left click to move · Right drag to rotate · Scroll to zoom</p>
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
        <div class="hud__hints">Left click: move · Click a husk: attack · Q W E R: skills · 1 2: flasks · I: inventory · Esc: pause</div>
        <div class="hud__badge">Skills &amp; flasks · v0.5</div>
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

      <div class="screen hidden" data-screen="paused">
        <div class="screen__vignette"></div>
        <div class="screen__content">
          <p class="eyebrow">The moor waits</p>
          <h2 class="screen-title">Paused</h2>
          <div class="pause-actions">
            <button class="btn btn--primary" data-action="resume">Resume</button>
            <button class="btn" data-action="restart">Restart Run</button>
            <button class="btn" data-action="quit">Quit to Title</button>
          </div>
        </div>
      </div>`;
  }
}
