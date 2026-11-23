import * as THREE from 'three';
import { EventBus } from './core/events';
import { GameLoop } from './core/loop';
import { getClass } from './content/classes';
import { RARITY_COLORS, type ItemSlot } from './content/items';
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
import { TelegraphLayer } from './render/telegraphs';
import { createProps } from './render/props';
import { createWorldScene, type WorldScene } from './render/scene';
import { createTerrain } from './render/terrain';
import { createGameState, drainEvents, type GameState } from './sim/state';
import { respawnPlayer, stepRun } from './sim/run';
import { createSave, serializeSave } from './save/schema';
import { damagePlayer } from './systems/combat';
import { equipItem, unequipItem } from './systems/inventory';
import { setMoveTarget } from './systems/movement';
import { grantXp } from './systems/progression';
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
  /** Review fixture: force damage to reach edge states (death flow, low HP). */
  hurtPlayer(amount: number): void;
  /** Review fixture: heal to keep multi-step QA flows stable under pack pressure. */
  healPlayer(amount: number): void;
  /** Review fixture: grant XP to reach the level-up edge state. */
  grantXp(amount: number): void;
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
    this.ui.showHud(this.classDef, this.layout.name);
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
    this.ui.showDeath();
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
      this.lootViews.sync(state, elapsed);
      this.nameplates.sync(state, this.rig.camera);
      this.ui.setPlayerHp(state.player.hp, state.player.maxHp);
      this.ui.setPlayerXp(state.level, state.xp, state.xpToNext);
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
    damagePlayer(this.state, amount, this.state.events, QA_DAMAGE_ID);
  }

  healPlayer(amount: number): void {
    if (!this.state) return;
    this.state.player.hp = Math.min(this.state.player.maxHp, this.state.player.hp + amount);
  }

  grantXp(amount: number): void {
    if (!this.state) return;
    grantXp(this.state, amount, this.state.events);
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
  healPlayer: (amount) => game.healPlayer(amount),
  grantXp: (amount) => game.grantXp(amount),
  exportSave: () => game.exportSave(),
};
