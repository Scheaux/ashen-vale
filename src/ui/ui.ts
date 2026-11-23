import { CLASSES } from '../content/classes';
import type { ClassDef, ClassId } from '../content/types';
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
}

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
  private readonly xpFill: HTMLElement;
  private readonly levelText: HTMLElement;
  private readonly toastLayer: HTMLElement;

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
    this.xpFill = root.querySelector('[data-xp-fill]') as HTMLElement;
    this.levelText = root.querySelector('[data-hud-level]') as HTMLElement;
    this.toastLayer = root.querySelector('[data-toasts]') as HTMLElement;

    root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => this.onAction(btn.dataset.action ?? ''));
    });

    root.querySelectorAll<HTMLElement>('[data-class]').forEach((card) => {
      const id = card.dataset.class as ClassId;
      this.selectedCard.set(id, card);
      card.addEventListener('click', () => this.select(id));
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

  showHud(def: ClassDef, zoneName: string): void {
    this.hudClass.textContent = def.name;
    this.hudClass.style.color = def.cssColor;
    this.hudZone.textContent = zoneName;
  }

  setPlayerHp(hp: number, maxHp: number): void {
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    this.hpFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.hpText.textContent = `${Math.round(hp)} / ${Math.round(maxHp)}`;
  }

  setPlayerXp(level: number, xp: number, xpToNext: number): void {
    const ratio = Math.max(0, Math.min(1, xp / Math.max(1, xpToNext)));
    this.xpFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.levelText.textContent = `LVL ${level}`;
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

  showDeath(): void {
    this.deathScreen.classList.remove('hidden');
  }

  hideDeath(): void {
    this.deathScreen.classList.add('hidden');
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
          <div class="hud__xp">
            <div class="hud__xp-fill" data-xp-fill></div>
            <span class="hud__lvl" data-hud-level>LVL 1</span>
          </div>
        </div>
        <div class="hud__hints">Left click: move · Click a husk: attack · I: inventory · Esc: pause</div>
        <div class="hud__badge">Loot prototype · v0.4</div>
      </div>

      <div class="toast-layer" data-toasts></div>

      <div class="screen screen--death hidden" data-screen="death">
        <div class="screen__vignette"></div>
        <div class="screen__content">
          <p class="eyebrow">The moor takes its due</p>
          <h2 class="screen-title screen-title--death">You have fallen</h2>
          <button class="btn btn--primary" data-action="respawn">Rise Again</button>
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
