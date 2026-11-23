import * as THREE from 'three';
import { EventBus } from './core/events';
import { GameLoop } from './core/loop';
import { getClass } from './content/classes';
import { RARITY_COLORS, type ItemSlot } from './content/items';
import { skillsFor, type SkillDef } from './content/skills';
import type { ClassDef, ClassId, ZoneLayout } from './content/types';
import { generateZoneLayout } from './content/zone';
import { createPlayerView, type PlayerView } from './render/player';
import { CameraRig } from './render/camera';
import { CursorMarker } from './render/cursor';
import { disposeMeshTree } from './render/dispose';
import { createEmbers, type EmberField } from './render/effects';
import { EnemyViews } from './render/enemies';
import { LootViews } from './render/loot';
import { ProjectileViews } from './render/projectiles';
import { SkillVfxLayer } from './render/skillVfx';
import { TelegraphLayer } from './render/telegraphs';
import { createProps } from './render/props';
import { createWorldScene, type WorldScene } from './render/scene';
import { createTerrain } from './render/terrain';
import { createGameState, drainEvents, type GameState } from './sim/state';
import { respawnPlayer, stepRun } from './sim/run';
import { createSave, serializeSave } from './save/schema';
import { damagePlayer } from './systems/combat';
import { useFlask, type FlaskKind } from './systems/flasks';
import { equipItem, unequipItem } from './systems/inventory';
import { setMoveTarget } from './systems/movement';
import { grantXp } from './systems/progression';
import { evadeChance, getPlayerStats } from './systems/stats';
import { FloatingTextLayer } from './ui/floatingText';
import { InventoryPanel } from './ui/inventory';
import { NameplateLayer } from './ui/nameplates';
import { Ui, type GameMode } from './ui/ui';

type GameEvents = {
  'input:move-target': { x: number; z: number };
};
const QA_DAMAGE_ID = 'qa-fixture';

/** Debug/QA surface: numeric state snapshots + world-to-screen projection. */
export interface AshenDebug {
  snapshot(): {
    mode: GameMode;
    dead: boolean;
    playerHp: number;
    playerMaxHp: number;
    playerMana: number;
    playerMaxMana: number;
    playerEnergyShield: number;
    playerMaxEnergyShield: number;
    stats: {
      strength: number;
      dexterity: number;
      intelligence: number;
      armour: number;
      evasion: number;
      energyShield: number;
      attackDamagePct: number;
      spellDamagePct: number;
      evadeChance: number;
    };
    playerPos: { x: number; z: number };
    attackTargetId: string | null;
    hoverTargetId: string | null;
    enemies: Array<{
      id: string;
      type: string;
      hp: number;
      maxHp: number;
      x: number;
      z: number;
      dead: boolean;
      phase: string;
      elite: string[];
    }>;
    projectiles: number;
    strikes: number;
    skills: Array<{ id: string; slot: string; name: string; manaCost: number; cooldown: number }>;
    cooldowns: Record<string, number>;
    flasks: { health: number; mana: number; max: number };
    run: { kills: number; damageTaken: number; evades: number; lastBlow: string | null; seconds: number };
    level: number;
    xp: number;
    xpToNext: number;
    bagCount: number;
    equippedCount: number;
    drops: number;
    dropPositions: Array<{ x: number; z: number }>;
    tellOrder: { telegraphs: number; playerDamages: number; damageBeforeTelegraph: boolean };
    render: { triangles: number; drawCalls: number; geometries: number; textures: number };
  };
  worldToScreen(x: number, z: number, height?: number): { x: number; y: number };
  /** Review fixture: force damage to reach edge states (death flow, low HP). Spell damage: always lands. */
  hurtPlayer(amount: number): void;
  /** Review fixture: attack-type damage that runs evasion and armour. */
  hurtPlayerAttack(amount: number): void;
  /** Review fixture: override armour/evasion to isolate a defence layer. */
  setDefences(armour: number, evasion: number): void;
  /** Review fixture: clear the zone so timing checks run without interference. */
  clearEnemies(): void;
  /** Review fixture: heal to keep multi-step QA flows stable under pack pressure. */
  healPlayer(amount: number): void;
  /** Review fixture: grant XP to reach the level-up edge state. */
  grantXp(amount: number): void;
  /** Review fixture: drain the mana pool to test mana gating. */
  drainMana(amount: number): void;
  /** Review fixture: set flask charges to test empty-flask feedback and refill. */
  setFlaskCharges(kind: FlaskKind, charges: number): void;
  /** Review fixture: serialize the current save (for save-shape checks). */
  exportSave(): string;
}

/**
 * Game orchestrator: owns the mode state machine
 * (title -> class-select -> playing <-> paused), the fixed-step sim, and the
 * three.js render pipeline. Simulation stays pure; this layer only bridges.
 */
class Game {
  private readonly world: WorldScene;
  private readonly scene: THREE.Scene;
  private readonly rig: CameraRig;
  private readonly enemyViews: EnemyViews;
  private readonly projectileViews: ProjectileViews;
  private readonly telegraphs: TelegraphLayer;
  private readonly skillVfx: SkillVfxLayer;
  private readonly lootViews: LootViews;
  private readonly embers: EmberField;
  private readonly cursor: CursorMarker;
  private readonly floatingText: FloatingTextLayer;
  private readonly nameplates: NameplateLayer;
  private readonly inventoryPanel: InventoryPanel;
  private readonly ui: Ui;
  private readonly loop: GameLoop;
  private readonly bus = new EventBus<GameEvents>();

  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pointer = new THREE.Vector2(0, 0);
  private readonly tmpVec = new THREE.Vector3();
  private readonly viewport = new THREE.Vector2();
  private pointerInside = false;
  private hoverTargetId: string | null = null;

  private readonly layout: ZoneLayout;
  private state: GameState | null = null;
  private playerView: PlayerView | null = null;
  private classDef: ClassDef = getClass('marauder');
  private mode: GameMode = 'title';
  private rotating = false;
  private destinationActive = false;
  private dead = false;
  /** Event-order recorder, scoped to the attack instance that caused the hit. */
  private readonly advertisedAttacks = new Set<string>();
  private tellTelegraphs = 0;
  private tellPlayerDamages = 0;
  private tellDamageBeforeTelegraph = false;
  /** Refusal-toast throttling so key mashing cannot spam the toast layer. */
  private lastRefusal = { label: '', at: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
  ) {
    this.world = createWorldScene(canvas);
    this.scene = this.world.scene;
    this.layout = generateZoneLayout();

    const terrain = createTerrain();
    this.scene.add(terrain.mesh);
    this.scene.add(createProps(this.layout));
    this.enemyViews = new EnemyViews(this.scene);
    this.projectileViews = new ProjectileViews(this.scene);
    this.telegraphs = new TelegraphLayer(this.scene, terrain.surface);
    this.skillVfx = new SkillVfxLayer(this.scene, terrain.surface);
    this.lootViews = new LootViews(this.scene);
    this.embers = createEmbers(this.layout.bounds);
    this.scene.add(this.embers.points);
    this.cursor = new CursorMarker(this.scene, 0xe8c877);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.rig.snapTo(this.layout.spawn.x, this.layout.spawn.z);

    this.ui = new Ui(uiRoot, {
      onNewGame: () => this.setMode('class-select'),
      onBack: () => this.setMode('title'),
      onStartRun: (id) => this.startRun(id),
      onPause: () => this.pause(),
      onResume: () => this.resume(),
      onRestart: () => this.startRun(this.classDef.id),
      onQuitToTitle: () => this.quitToTitle(),
      onRespawn: () => this.respawn(),
      onCastSlot: (slot) => this.castSlot(slot),
      onUseFlask: (kind) => this.handleUseFlask(kind),
    });
    // Created after Ui: the Ui constructor replaces #ui's innerHTML.
    this.floatingText = new FloatingTextLayer(uiRoot);
    this.nameplates = new NameplateLayer(uiRoot);
    this.inventoryPanel = new InventoryPanel(uiRoot, {
      onEquip: (uid) => this.handleEquip(uid),
      onUnequip: (slot) => this.handleUnequip(slot),
    });
    this.ui.setMode('title');

    this.bus.on('input:move-target', ({ x, z }) => {
      if (!this.state) return;
      this.state.player.attackTargetId = null;
      setMoveTarget(this.state, { x, z });
      this.cursor.setDestination(this.tmpVec.set(x, 0, z));
      this.destinationActive = true;
    });

    this.loop = new GameLoop(
      {
        fixedUpdate: (dt) => this.fixedUpdate(dt),
        render: (dt, alpha, elapsed) => this.renderFrame(dt, alpha, elapsed),
      },
      60,
    );

    this.bindInput();
    this.onResize();
    this.loop.start();
  }

  // ---------- Mode state machine ----------

  private startRun(id: ClassId): void {
    this.clearRun();
    this.classDef = getClass(id);
    this.state = createGameState(this.classDef, this.layout);

    this.playerView = createPlayerView(this.classDef);
    this.scene.add(this.playerView.group);

    this.rig.snapTo(this.layout.spawn.x, this.layout.spawn.z);
    this.ui.setPlayerHp(this.state.player.hp, this.state.player.maxHp);
    this.ui.showHud(this.classDef, this.layout.name, skillsFor(id));
    this.setMode('playing');
  }

  private pause(): void {
    if (this.mode !== 'playing' || this.dead) return;
    this.setMode('paused');
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    this.setMode('playing');
  }

  private quitToTitle(): void {
    this.clearRun();
    this.setMode('title');
  }

  private clearRun(): void {
    this.state = null;
    if (this.playerView) {
      disposeMeshTree(this.playerView.group);
      this.playerView = null;
    }
    this.enemyViews.clear();
    this.setHoverTarget(null);
    this.cursor.setHover(null);
    this.clearCombatViews();
    this.lootViews.clear();
    this.nameplates.clear();
    this.inventoryPanel.close();
    this.dead = false;
    this.tellTelegraphs = 0;
    this.tellPlayerDamages = 0;
    this.tellDamageBeforeTelegraph = false;
    this.ui.hideDeath();
    this.ui.clearToasts();
  }

  private clearCombatViews(): void {
    this.projectileViews.clear();
    this.telegraphs.clear();
    this.skillVfx.clear();
    this.floatingText.clear();
    this.advertisedAttacks.clear();
    this.cursor.setDestination(null);
    this.destinationActive = false;
  }

  private respawn(): void {
    const state = this.state;
    if (!state || !this.dead) return;
    respawnPlayer(state, this.layout.spawn);
    this.clearCombatViews();
    this.dead = false;
    this.ui.hideDeath();
    const p = state.player;
    this.ui.setPlayerHp(p.hp, p.maxHp);
    this.rig.snapTo(p.position.x, p.position.z);
    this.loop.setRunning(true);
  }

  private onPlayerDeath(): void {
    this.dead = true;
    this.inventoryPanel.close();
    this.loop.setRunning(false);
    const stats = this.state?.runStats;
    this.ui.showDeath({
      killer: stats?.lastBlow?.sourceName ?? 'the Ashen Moor',
      damageTaken: stats?.damageTaken ?? 0,
      kills: stats?.kills ?? 0,
      seconds: stats?.seconds ?? 0,
    });
  }

  private setMode(mode: GameMode): void {
    this.mode = mode;
    this.loop.setRunning(mode === 'playing' && !this.dead);
    this.ui.setMode(mode);
  }

  // ---------- Simulation & render ----------

  private fixedUpdate(dt: number): void {
    const state = this.state;
    if (!state) return;

    stepRun(state, dt);
    if (state.player.hp <= 0) this.loop.setRunning(false);

    if (this.destinationActive && !state.player.moveTarget && !state.player.attackTargetId) {
      this.cursor.setDestination(null);
      this.destinationActive = false;
    }
  }

  private renderFrame(dt: number, alpha: number, elapsed: number): void {
    const state = this.state;
    if (state && this.playerView) {
      const events = drainEvents(state);
      if (events.length > 0) {
        this.enemyViews.handleEvents(events);
        this.telegraphs.handleEvents(events);
        this.skillVfx.handleEvents(events);
        this.playerView.handleEvents(events);
        this.floatingText.handleEvents(events, this.rig.camera);
        for (const ev of events) {
          if (ev.kind === 'telegraph') {
            this.advertisedAttacks.add(ev.attackId);
            this.tellTelegraphs++;
          } else if (ev.kind === 'damage' && ev.targetKind === 'player' && ev.attackId !== QA_DAMAGE_ID) {
            this.tellPlayerDamages++;
            if (!ev.attackId || !this.advertisedAttacks.delete(ev.attackId)) this.tellDamageBeforeTelegraph = true;
          }
        }
        for (const ev of events) {
          if (ev.kind === 'death' && ev.targetKind === 'player') this.onPlayerDeath();
          else if (ev.kind === 'levelup') this.ui.showToast(`Level ${ev.level}!`, '#e8c877');
          else if (ev.kind === 'refuse') this.reportRefusal(ev.reason, ev.label);
          else if (ev.kind === 'pickup') {
            const rarity = ev.rarity as keyof typeof RARITY_COLORS;
            this.ui.showToast(`Picked up ${ev.name}`, RARITY_COLORS[rarity]?.cssColor);
          }
        }
      }

      this.playerView.update(state, dt, alpha, elapsed);
      this.enemyViews.sync(state, dt, alpha, this.rig.camera);
      this.projectileViews.sync(state);
      this.telegraphs.sync(state, dt);
      this.skillVfx.sync(state, dt);
      this.lootViews.sync(state, elapsed);
      this.nameplates.sync(state, this.rig.camera);
      this.ui.setPlayerHp(state.player.hp, state.player.maxHp);
      this.ui.setPlayerEs(state.player.energyShield, state.player.maxEnergyShield);
      this.ui.setPlayerXp(state.level, state.xp, state.xpToNext);
      this.ui.syncCombat({
        mana: state.player.mana,
        maxMana: state.player.maxMana,
        cooldowns: state.player.cooldowns,
        flasks: state.flasks,
      });
      if (this.inventoryPanel.visible) this.inventoryPanel.sync(state);
      this.rig.follow(state.player.position.x, state.player.position.z, dt);
    }
    this.updateHover();
    this.embers.update(dt);
    this.cursor.update(elapsed, dt);
    this.world.renderer.render(this.scene, this.rig.camera);
  }

  // ---------- Picking ----------

  private groundPoint(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.rig.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, this.tmpVec) ? this.tmpVec : null;
  }

  private pickEnemy() {
    if (!this.state || !this.pointerInside) return null;
    const { x: width, y: height } = this.viewport;
    return this.enemyViews.pick(this.state, this.rig.camera, width, height,
      (this.pointer.x + 1) * width * 0.5, (1 - this.pointer.y) * height * 0.5);
  }

  private updateHover(): void {
    if (this.mode !== 'playing' || this.dead || !this.pointerInside || this.rotating) {
      this.cursor.setHover(null);
      this.setHoverTarget(null);
      return;
    }
    const enemyHit = this.pickEnemy();
    this.setHoverTarget(enemyHit?.id ?? null);
    if (enemyHit) {
      this.cursor.setHover(enemyHit.point, enemyHit.radius);
      return;
    }
    this.cursor.setHover(this.groundPoint());
  }

  private setHoverTarget(id: string | null): void {
    if (this.hoverTargetId === id) return;
    this.hoverTargetId = id;
    this.canvas.toggleAttribute('data-enemy-hover', id !== null);
    this.enemyViews.setHighlight(id);
  }

  // ---------- Input ----------

  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.viewport.set(rect.width, rect.height);
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((e.clientY - rect.top) / rect.height) * 2,
    );
    this.pointerInside = true;
  }

  private bindInput(): void {
    window.addEventListener('resize', () => this.onResize());

    this.canvas.addEventListener('pointermove', (e) => {
      this.setPointer(e);
      if (this.rotating) this.rig.rotate(e.movementX);
    });

    this.canvas.addEventListener('pointerenter', (e) => this.setPointer(e));
    this.canvas.addEventListener('pointerleave', () => { this.pointerInside = false; });
    this.canvas.addEventListener('pointercancel', () => { this.pointerInside = this.rotating = false; });

    this.canvas.addEventListener('pointerdown', (e) => {
      this.setPointer(e);
      if (e.button === 2) {
        this.rotating = true;
        return;
      }
      if (e.button !== 0 || this.mode !== 'playing' || this.dead || this.rotating || !this.state) return;

      // Click an enemy to attack it; click the ground to move.
      const enemyHit = this.pickEnemy();
      if (enemyHit) {
        this.state.player.attackTargetId = enemyHit.id;
        this.cursor.setDestination(null);
        this.destinationActive = false;
        return;
      }
      const point = this.groundPoint();
      if (point) this.bus.emit('input:move-target', { x: point.x, z: point.z });
    });

    window.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.rotating = false;
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.rig.zoom(e.deltaY);
      },
      { passive: false },
    );

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (key === '1' || key === '2') {
        if (this.mode === 'playing' && !this.dead && !e.repeat) this.handleUseFlask(key === '1' ? 'health' : 'mana');
        return;
      }
      const slot = ({ q: 'q', w: 'w', e: 'e', r: 'r' } as const)[key as 'q' | 'w' | 'e' | 'r'];
      if (slot) {
        if (this.mode === 'playing' && !this.dead && !e.repeat) this.castSlot(slot);
        return;
      }
      if (e.key === 'i' || e.key === 'I' || e.key === 'Tab') {
        if (this.mode !== 'playing' || this.dead || e.repeat) return;
        e.preventDefault();
        this.inventoryPanel.toggle();
        if (this.inventoryPanel.visible && this.state) this.inventoryPanel.sync(this.state);
        return;
      }
      if (e.key !== 'Escape') return;
      if (this.inventoryPanel.visible) {
        this.inventoryPanel.close();
        return;
      }
      if (this.mode === 'playing') this.pause();
      else if (this.mode === 'paused') this.resume();
      else if (this.mode === 'class-select') this.setMode('title');
    });
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.world.renderer.setSize(w, h);
    this.world.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.rig.setAspect(w / h);
    this.viewport.set(w, h);
  }

  // ---------- Skills & flasks (slice 5) ----------

  private castSlot(slot: SkillDef['slot']): void {
    const state = this.state;
    if (!state || this.mode !== 'playing' || this.dead) return;
    const skill = skillsFor(this.classDef.id).find((s) => s.slot === slot);
    if (!skill) return;
    const aim = this.castAimPoint(state);
    state.player.castRequest = { skillId: skill.id, x: aim.x, z: aim.z };
  }

  /** Aim at the pursued or hovered enemy, else the cursor point, else ahead. */
  private castAimPoint(state: GameState): { x: number; z: number } {
    const targetId = state.player.attackTargetId ?? this.hoverTargetId;
    const target = state.enemies.find((e) => e.id === targetId && !e.dead);
    if (target) return { x: target.position.x, z: target.position.z };
    const point = this.groundPoint();
    if (point) return { x: point.x, z: point.z };
    const p = state.player;
    return { x: p.position.x + Math.sin(p.facing) * 6, z: p.position.z + Math.cos(p.facing) * 6 };
  }

  private handleUseFlask(kind: FlaskKind): void {
    const state = this.state;
    if (!state || this.mode !== 'playing' || this.dead) return;
    useFlask(state, kind, state.events);
  }

  private reportRefusal(reason: 'mana' | 'cooldown' | 'flask-empty', label: string): void {
    const now = performance.now();
    if (this.lastRefusal.label === label && now - this.lastRefusal.at < 900) return;
    this.lastRefusal = { label, at: now };
    const message =
      reason === 'mana' ? `${label}: not enough mana`
        : reason === 'cooldown' ? `${label}: recharging`
          : `${label}: no charges — slay enemies to refill`;
    this.ui.showToast(message, reason === 'cooldown' ? '#8f887a' : '#ff8577');
  }

  private handleEquip(uid: string): void {
    if (!this.state) return;
    const result = equipItem(this.state, uid);
    if (result.ok) {
      this.inventoryPanel.sync(this.state);
      this.ui.setPlayerHp(this.state.player.hp, this.state.player.maxHp);
    } else {
      this.ui.showToast(`Cannot equip: ${result.reason}`, '#ff8577');
    }
  }

  private handleUnequip(slot: ItemSlot): void {
    if (!this.state) return;
    const result = unequipItem(this.state, slot);
    if (result.ok) {
      this.inventoryPanel.sync(this.state);
      this.ui.setPlayerHp(this.state.player.hp, this.state.player.maxHp);
    } else {
      this.ui.showToast(`Cannot unequip: ${result.reason}`, '#ff8577');
    }
  }

  // ---------- Debug / QA ----------

  snapshot(): ReturnType<AshenDebug['snapshot']> {
    const state = this.state;
    return {
      mode: this.mode,
      dead: this.dead,
      playerHp: state?.player.hp ?? 0,
      playerMaxHp: state?.player.maxHp ?? 0,
      playerMana: state?.player.mana ?? 0,
      playerMaxMana: state?.player.maxMana ?? 0,
      playerEnergyShield: state?.player.energyShield ?? 0,
      playerMaxEnergyShield: state?.player.maxEnergyShield ?? 0,
      stats: (() => {
        const derived = state ? getPlayerStats(state) : null;
        return {
          strength: Math.round(derived?.strength ?? 0),
          dexterity: Math.round(derived?.dexterity ?? 0),
          intelligence: Math.round(derived?.intelligence ?? 0),
          armour: Math.round(state?.player.armour ?? 0),
          evasion: Math.round(state?.player.evasion ?? 0),
          energyShield: state?.player.maxEnergyShield ?? 0,
          attackDamagePct: Math.round((state?.player.attackDamagePct ?? 0) * 10) / 10,
          spellDamagePct: Math.round((state?.player.spellDamagePct ?? 0) * 10) / 10,
          evadeChance: Math.round(evadeChance(state?.player.evasion ?? 0) * 1000) / 1000,
        };
      })(),
      playerPos: state ? { x: state.player.position.x, z: state.player.position.z } : { x: 0, z: 0 },
      attackTargetId: state?.player.attackTargetId ?? null,
      hoverTargetId: this.hoverTargetId,
      enemies:
        state?.enemies.map((e) => ({
          id: e.id,
          type: e.defId,
          hp: e.hp,
          maxHp: e.maxHp,
          x: e.position.x,
          z: e.position.z,
          dead: e.dead,
          phase: e.phase,
          elite: [...e.elite],
        })) ?? [],
      projectiles: state?.projectiles.length ?? 0,
      strikes: state?.strikes.length ?? 0,
      skills: skillsFor(this.classDef.id).map((s) => ({
        id: s.id,
        slot: s.slot,
        name: s.name,
        manaCost: s.manaCost,
        cooldown: s.cooldown,
      })),
      cooldowns: state
        ? Object.fromEntries(
          Object.entries(state.player.cooldowns).map(([id, remaining]) => [id, Math.round((remaining ?? 0) * 1000) / 1000]),
        )
        : {},
      flasks: state
        ? { health: state.flasks.health.charges, mana: state.flasks.mana.charges, max: state.flasks.health.max }
        : { health: 0, mana: 0, max: 0 },
      run: {
        kills: state?.runStats.kills ?? 0,
        damageTaken: state?.runStats.damageTaken ?? 0,
        evades: state?.runStats.evades ?? 0,
        lastBlow: state?.runStats.lastBlow?.sourceName ?? null,
        seconds: Math.round((state?.runStats.seconds ?? 0) * 10) / 10,
      },
      level: state?.level ?? 0,
      xp: state?.xp ?? 0,
      xpToNext: state?.xpToNext ?? 0,
      bagCount: state?.inventory.bags.length ?? 0,
      equippedCount: state ? Object.values(state.inventory.equipment).filter(Boolean).length : 0,
      drops: state?.loot.length ?? 0,
      dropPositions: state?.loot.map((d) => ({ x: d.x, z: d.z })) ?? [],
      tellOrder: {
        telegraphs: this.tellTelegraphs,
        playerDamages: this.tellPlayerDamages,
        damageBeforeTelegraph: this.tellDamageBeforeTelegraph,
      },
      render: {
        triangles: this.world.renderer.info.render.triangles,
        drawCalls: this.world.renderer.info.render.calls,
        geometries: this.world.renderer.info.memory.geometries,
        textures: this.world.renderer.info.memory.textures,
      },
    };
  }

  worldToScreen(x: number, z: number, height = 1.2): { x: number; y: number } {
    const v = this.tmpVec.set(x, height, z).project(this.rig.camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  hurtPlayer(amount: number): void {
    if (!this.state) return;
    damagePlayer(this.state, amount, this.state.events, { attackId: QA_DAMAGE_ID, damageClass: 'spell' });
  }

  hurtPlayerAttack(amount: number): void {
    if (!this.state) return;
    damagePlayer(this.state, amount, this.state.events, { attackId: QA_DAMAGE_ID, damageClass: 'attack' });
  }

  setDefences(armour: number, evasion: number): void {
    if (!this.state) return;
    this.state.player.armour = armour;
    this.state.player.evasion = evasion;
  }

  clearEnemies(): void {
    if (!this.state) return;
    this.state.enemies.length = 0;
  }

  healPlayer(amount: number): void {
    if (!this.state) return;
    this.state.player.hp = Math.min(this.state.player.maxHp, this.state.player.hp + amount);
    this.state.player.energyShield = this.state.player.maxEnergyShield;
  }

  grantXp(amount: number): void {
    if (!this.state) return;
    grantXp(this.state, amount, this.state.events);
  }

  drainMana(amount: number): void {
    if (!this.state) return;
    this.state.player.mana = Math.max(0, this.state.player.mana - amount);
  }

  setFlaskCharges(kind: FlaskKind, charges: number): void {
    if (!this.state) return;
    const flask = this.state.flasks[kind];
    flask.charges = Math.max(0, Math.min(flask.max, charges));
  }

  exportSave(): string {
    if (!this.state) throw new Error('no active state');
    return serializeSave(createSave(this.state));
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const game = new Game(canvas, uiRoot);
(window as unknown as { __ashen: AshenDebug }).__ashen = {
  snapshot: () => game.snapshot(),
  worldToScreen: (x, z, height) => game.worldToScreen(x, z, height),
  hurtPlayer: (amount) => game.hurtPlayer(amount),
  hurtPlayerAttack: (amount) => game.hurtPlayerAttack(amount),
  healPlayer: (amount) => game.healPlayer(amount),
  grantXp: (amount) => game.grantXp(amount),
  drainMana: (amount) => game.drainMana(amount),
  setFlaskCharges: (kind, charges) => game.setFlaskCharges(kind, charges),
  setDefences: (armour, evasion) => game.setDefences(armour, evasion),
  clearEnemies: () => game.clearEnemies(),
  exportSave: () => game.exportSave(),
};
