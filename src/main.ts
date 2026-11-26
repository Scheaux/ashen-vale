import * as THREE from 'three';
import { EventBus } from './core/events';
import { GameLoop } from './core/loop';
import { getClass } from './content/classes';
import { RARITY_COLORS, type ItemSlot } from './content/items';
import { getSkill } from './content/skills';
import { getRune, type RuneId } from './content/runes';
import { LOADOUT_SLOTS, type ClassDef, type ClassId, type LoadoutSlot, type SkillId, type ZoneId, type ZoneLayout } from './content/types';
import type { Rarity } from './content/items';
import { rollItem, type ItemInstance } from './sim/items';
import { generateZoneLayout } from './content/zone';
import { createPlayerView, type PlayerView } from './render/player';
import { CameraRig } from './render/camera';
import { CursorMarker } from './render/cursor';
import { disposeMeshTree } from './render/dispose';
import { createEmbers, type EmberField } from './render/effects';
import { EnemyViews } from './render/enemies';
import { HazardLayer } from './render/hazards';
import { LootViews } from './render/loot';
import { ProjectileViews } from './render/projectiles';
import { SkillVfxLayer } from './render/skillVfx';
import { TelegraphLayer } from './render/telegraphs';
import { createProps, type PropsView } from './render/props';
import { applyZoneAtmosphere, createWorldScene, type WorldScene } from './render/scene';
import { createTerrain } from './render/terrain';
import type { TerrainSurface } from './render/terrainSurface';
import { createGameState, drainEvents, type GameState } from './sim/state';
import { respawnPlayer, stepRun } from './sim/run';
import { createCheckpointSave, serializeSave } from './save/schema';
import { restoreGameState } from './save/restore';
import {
  browserSaveStorage,
  createMemoryStorage,
  deleteSaveSlot,
  firstEmptySlot,
  latestSaveSlot,
  listSaveSlots,
  readSaveSlot,
  writeSaveSlot,
  type SaveStorage,
} from './save/slots';
import { damageEnemy, damagePlayer } from './systems/combat';
import { useFlask, type FlaskKind } from './systems/flasks';
import { equipItem, unequipItem } from './systems/inventory';
import { setMoveTarget } from './systems/movement';
import {
  allocatePassive,
  passivePointsAvailable,
  passivePointsSpent,
  passivePointsTotal,
  passiveRefusalMessage,
  refundPassive,
} from './systems/passives';
import {
  clearSkillSlot,
  effectiveSkillCooldown,
  effectiveSkillDamage,
  equipSkill,
  loadoutRefusalMessage,
  runeFor,
  setRune,
  skillInSlot,
  skillManaCost,
  skillPointsAvailable,
  skillPointsSpent,
  skillPointsTotal,
  skillRank,
  unlockSkill,
  upgradeSkill,
} from './systems/loadout';
import {
  addAffix,
  improveQuality,
  reforgeAffix,
  type CraftAction,
} from './systems/crafting';
import { grantXp } from './systems/progression';
import { salvageItem } from './systems/salvage';
import { evadeChance, getPlayerStats } from './systems/stats';
import { CraftingPanel } from './ui/crafting';
import { FloatingTextLayer } from './ui/floatingText';
import { InventoryPanel } from './ui/inventory';
import { NameplateLayer } from './ui/nameplates';
import { PassiveTreePanel } from './ui/passives';
import { SaveSlotsPanel, type SavePanelMode } from './ui/saveSlots';
import { SkillPanel } from './ui/skills';
import { Ui, type GameMode, type LoadoutEntry } from './ui/ui';

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
      addedAttackDamage: number;
      addedSpellDamage: number;
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
      bossPhase: number;
    }>;
    projectiles: number;
    strikes: number;
    hazards: number;
    camera: { yaw: number; pitch: number; distance: number };
    markers: {
      hover: { x: number; y: number; z: number } | null;
      destination: { x: number; y: number; z: number } | null;
    };
    probes: {
      playerGround: { y: number; height: number; error: number };
      rings: ReturnType<CursorMarker['probe']>;
      telegraph: ReturnType<TelegraphLayer['probe']>;
      bossRoot: ReturnType<EnemyViews['probeBoss']>;
    };
    playerRenderY: number;
    arena: { x: number; z: number; radius: number };
    objectives: { campsCleared: number; campsTotal: number; bossSpawned: boolean; bossDefeated: boolean };
    skills: Array<{
      slot: LoadoutSlot;
      id: SkillId | null;
      name: string | null;
      manaCost: number;
      cooldown: number;
      rank: number;
      rune: string | null;
    }>;
    skillPoints: { total: number; spent: number; available: number };
    cooldowns: Record<string, number>;
    flasks: { health: number; mana: number; max: number };
    run: { kills: number; damageTaken: number; evades: number; lastBlow: string | null; seconds: number };
    passives: { allocated: string[]; spent: number; total: number; available: number };
    level: number;
    xp: number;
    xpToNext: number;
    bagCount: number;
    equippedCount: number;
    drops: number;
    dropPositions: Array<{ x: number; z: number }>;
    currency: { dust: number; rune: number; quality: number };
    items: Array<ItemInstance & { equipped: boolean }>;
    tellOrder: { telegraphs: number; playerDamages: number; damageBeforeTelegraph: boolean };
    render: {
      triangles: number;
      drawCalls: number;
      geometries: number;
      textures: number;
      pixelRatio: number;
      pixelRatioCap: number;
      shadows: boolean;
      detailedEnemies: number;
      healthBars: number;
      occludedProps: number;
      reducedMotion: boolean;
      qualityWindow: number;
      qualityFrames: number;
    };
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
  /** Review fixture: kill every camp enemy to unlock the boss quickly. */
  clearCamps(): void;
  /** Review fixture: damage a specific enemy through the real pipeline. */
  hurtEnemy(id: string, amount: number): void;
  /** Review fixture: move the hero (arena checks, positioning). */
  teleportPlayer(x: number, z: number): void;
  /** Review fixture: terrain height at a world point. */
  terrainHeightAt(x: number, z: number): number;
  /** Debug-only: remount a zone without touching the run or writing a save. */
  remountZone(zoneId: ZoneId): void;
  /** Review fixture: nearest scenery points to the hero (picking checks). */
  sceneryPoints(): Array<{ x: number; z: number }>;
  /** Review fixture: heal to keep multi-step QA flows stable under pack pressure. */
  healPlayer(amount: number): void;
  /** Review fixture: grant XP to reach the level-up edge state. */
  grantXp(amount: number): void;
  /** Review fixture: drain the mana pool to test mana gating. */
  drainMana(amount: number): void;
  /** Review fixture: set flask charges to test empty-flask feedback and refill. */
  setFlaskCharges(kind: FlaskKind, charges: number): void;
  /** Review fixture: toggle shadow casting to isolate the shadow-pass budget. */
  setShadows(enabled: boolean): void;
  /** Review fixture: play the damage vignette without waiting for a hit. */
  flashDamage(kind: 'health' | 'shield', strength: number): void;
  /** Review fixture: unlock/equip skills through the real loadout rules. */
  unlockSkill(id: SkillId): boolean;
  equipSkill(slot: LoadoutSlot, id: SkillId): boolean;
  /** Review fixture: mark an existing enemy Volatile for hazard testing. */
  makeVolatile(id: string): boolean;
  /** Review fixture: live ground hazards (position, radius, detonation state). */
  hazardPoints(): Array<{
    id: string;
    kind: 'volatile' | 'cinder';
    x: number;
    z: number;
    radius: number;
    detonated: boolean;
  }>;
  /** Review fixture: top up crafting currency. */
  grantCurrency(dust: number, rune: number, quality: number): void;
  /** Review fixture: add a rolled item to the bag and return its uid. */
  grantItem(rarity: Rarity): string;
  /** Review fixture: serialize the current save (for save-shape checks). */
  exportSave(): string;
  /** Review fixture: save-slot inventory and the run's bound autosave slot. */
  saves(): {
    activeSlot: number | null;
    persistent: boolean;
    slots: Array<{
      slot: number;
      status: 'empty' | 'ok' | 'corrupt';
      classId: string | null;
      level: number | null;
      campsCleared: number;
      campsTotal: number;
      bossSpawned: boolean;
      bossDefeated: boolean;
      savedAt: number;
      recovered: boolean;
      error: string | null;
    }>;
  };
}

/**
 * Game orchestrator: owns the mode state machine
 * (title -> class-select -> playing <-> paused), the fixed-step sim, and the
 * three.js render pipeline. Simulation stays pure; this layer only bridges.
 */
class Game {
  private readonly world: WorldScene;
  private readonly scene: THREE.Scene;
  private propsView: PropsView;
  private readonly rig: CameraRig;
  private readonly enemyViews: EnemyViews;
  private readonly projectileViews: ProjectileViews;
  private readonly telegraphs: TelegraphLayer;
  private readonly skillVfx: SkillVfxLayer;
  private readonly hazardLayer: HazardLayer;
  private readonly lootViews: LootViews;
  private embers: EmberField;
  private readonly cursor: CursorMarker;
  private readonly floatingText: FloatingTextLayer;
  private readonly nameplates: NameplateLayer;
  private readonly inventoryPanel: InventoryPanel;
  private readonly passivePanel: PassiveTreePanel;
  private readonly skillPanel: SkillPanel;
  private readonly craftingPanel: CraftingPanel;
  private readonly savePanel: SaveSlotsPanel;
  private readonly ui: Ui;
  private readonly loop: GameLoop;
  private readonly bus = new EventBus<GameEvents>();
  private readonly storage: SaveStorage;
  private readonly persistentSaves: boolean;

  private readonly raycaster = new THREE.Raycaster();
  private terrainSurface: TerrainSurface;
  private terrainMesh: THREE.Mesh;
  private readonly pointer = new THREE.Vector2(0, 0);
  private readonly tmpVec = new THREE.Vector3();
  private readonly viewport = new THREE.Vector2();
  private pointerInside = false;
  private hoverTargetId: string | null = null;

  private layout: ZoneLayout;
  private state: GameState | null = null;
  private playerView: PlayerView | null = null;
  private classDef: ClassDef = getClass('marauder');
  private mode: GameMode = 'title';
  /** Slot autosaves write to for the current run; null when all slots are full. */
  private activeSlot: number | null = null;
  private destinationActive = false;
  private dead = false;
  /** Adaptive resolution: step the pixel ratio between 1 and the device cap. */
  private qualityCap = 2;
  private qualityRatio = 1;
  private qualityTime = 0;
  private qualityFrames = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    this.qualityCap = Math.min(window.devicePixelRatio, 2);
    this.qualityRatio = this.qualityCap;
    this.world.renderer.setPixelRatio(this.qualityRatio);
    this.layout = generateZoneLayout();
    const browserStorage = browserSaveStorage();
    this.persistentSaves = browserStorage !== null;
    this.storage = browserStorage ?? createMemoryStorage();

    const terrain = createTerrain('ashen-moor');
    this.terrainMesh = terrain.mesh;
    this.terrainSurface = terrain.surface;
    this.scene.add(terrain.mesh);
    this.propsView = createProps(this.layout, terrain.surface);
    this.scene.add(this.propsView.group);
    this.enemyViews = new EnemyViews(this.scene, terrain.surface);
    this.projectileViews = new ProjectileViews(this.scene, terrain.surface);
    this.telegraphs = new TelegraphLayer(this.scene, terrain.surface);
    this.skillVfx = new SkillVfxLayer(this.scene, terrain.surface);
    this.hazardLayer = new HazardLayer(this.scene, terrain.surface);
    this.lootViews = new LootViews(this.scene, terrain.surface);
    this.embers = createEmbers(this.layout.bounds);
    this.scene.add(this.embers.points);
    this.cursor = new CursorMarker(this.scene, 0xe8c877, terrain.surface);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.rig.setReducedMotion(this.reducedMotion);
    this.rig.setGroundSampler(terrain.surface);
    this.rig.snapTo(
      this.layout.spawn.x,
      this.layout.spawn.z,
      terrain.surface.heightAt(this.layout.spawn.x, this.layout.spawn.z),
    );

    this.ui = new Ui(uiRoot, {
      onNewGame: () => this.setMode('class-select'),
      onBack: () => this.setMode('title'),
      onStartRun: (id) => this.startRun(id),
      onPause: () => this.pause(),
      onResume: () => this.resume(),
      onRestart: () => this.restartRun(),
      onQuitToTitle: () => this.quitToTitle(),
      onRespawn: () => this.respawn(),
      onContinue: () => this.continueAfterVictory(),
      onContinueRun: () => this.continueRun(),
      onOpenSlots: (mode) => this.openSlots(mode),
      onOpenSkillPicker: (slot) => this.openSkillPicker(slot),
      onOpenSkills: () => this.openSkills(),
      onOpenCrafting: () => this.openCrafting(),
      onUseFlask: (kind) => this.handleUseFlask(kind),
    });
    // Created after Ui: the Ui constructor replaces #ui's innerHTML.
    this.floatingText = new FloatingTextLayer(uiRoot, terrain.surface);
    this.nameplates = new NameplateLayer(uiRoot, terrain.surface);
    this.inventoryPanel = new InventoryPanel(uiRoot, {
      onEquip: (uid) => this.handleEquip(uid),
      onUnequip: (slot) => this.handleUnequip(slot),
    });
    this.passivePanel = new PassiveTreePanel(uiRoot, {
      onAllocate: (id) => this.handlePassiveAllocate(id),
      onRefund: (id) => this.handlePassiveRefund(id),
    });
    this.skillPanel = new SkillPanel(uiRoot, {
      onAssign: (slot, id) => this.handleAssignSkill(slot, id),
      onUnlock: (id) => this.handleUnlockSkill(id),
      onUpgrade: (id) => this.handleUpgradeSkill(id),
      onRune: (id, rune) => this.handleSetRune(id, rune),
      onClose: () => this.skillPanel.close(),
    });
    this.craftingPanel = new CraftingPanel(uiRoot, {
      onCraft: (action, uid) => this.handleCraft(action, uid),
      onSalvage: (uid) => this.handleSalvage(uid),
      onClose: () => this.craftingPanel.close(),
    });
    this.savePanel = new SaveSlotsPanel(uiRoot, {
      onChoose: (slot) => this.chooseSlot(slot),
      onDelete: (slot) => this.deleteSlot(slot),
      onClose: () => this.savePanel.close(),
    });
    this.ui.setActiveSlot(null);
    this.refreshTitleSaves();
    this.ui.setMode('title');
    if (!this.persistentSaves) {
      this.ui.showToast('Browser storage is unavailable — checkpoints last for this session only', '#ff8577');
    }

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
    this.freshRun(id, null);
  }

  /** Restart keeps the run's slot, replacing the checkpoint it had reached. */
  private restartRun(): void {
    if (this.mode !== 'paused' && this.mode !== 'playing') return;
    this.freshRun(this.classDef.id, this.activeSlot);
  }

  private freshRun(id: ClassId, preferredSlot: number | null): void {
    this.clearRun();
    this.classDef = getClass(id);
    this.state = createGameState(this.classDef, this.layout);
    this.activeSlot = preferredSlot ?? firstEmptySlot(listSaveSlots(this.storage));
    this.ui.setActiveSlot(this.activeSlot);
    this.beginRun();
    if (this.activeSlot !== null) {
      this.saveCheckpoint();
      this.ui.showToast(`Checkpoint · Slot ${this.activeSlot + 1}`, '#8f887a');
    } else {
      this.ui.showToast('All save slots are full — save manually from the pause menu', '#ff8577');
    }
  }

  /** Attach the live state to the render world and enter play. */
  private beginRun(): void {
    const state = this.state;
    if (!state) return;
    this.classDef = getClass(state.player.classId);
    this.playerView = createPlayerView(this.classDef, this.terrainSurface);
    this.scene.add(this.playerView.group);
    this.rig.snapTo(
      state.player.position.x,
      state.player.position.z,
      this.terrainSurface.heightAt(state.player.position.x, state.player.position.z),
    );
    this.ui.setPlayerHp(state.player.hp, state.player.maxHp);
    this.ui.setPlayerEs(state.player.energyShield, state.player.maxEnergyShield);
    this.ui.setPlayerXp(state.level, state.xp, state.xpToNext);
    this.ui.showHud(this.classDef, this.layout.name, this.loadoutEntries(state));
    this.ui.setPoints(passivePointsAvailable(state), skillPointsAvailable(state));
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
    if (this.state) this.saveCheckpoint();
    this.clearRun();
    this.setMode('title');
    this.refreshTitleSaves();
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
    this.passivePanel.close();
    this.skillPanel.close();
    this.craftingPanel.close();
    this.savePanel.close();
    this.dead = false;
    this.tellTelegraphs = 0;
    this.tellPlayerDamages = 0;
    this.tellDamageBeforeTelegraph = false;
    this.ui.hideDeath();
    this.ui.hideVictory();
    this.ui.clearToasts();
  }

  private clearCombatViews(): void {
    this.projectileViews.clear();
    this.telegraphs.clear();
    this.skillVfx.clear();
    this.hazardLayer.clear();
    this.floatingText.clear();
    this.advertisedAttacks.clear();
    this.cursor.setDestination(null);
    this.destinationActive = false;
  }

  /**
   * Rebuild the surface-bound scenery. The TerrainSurface instance is reused so
   * every view layer keeps a live sampler; the old terrain mesh, props and
   * embers are disposed first so geometry/material/texture counts stay flat.
   */
  private mountZone(layout: ZoneLayout, zoneId: ZoneId = 'ashen-moor'): void {
    this.layout = layout;

    // Terrain owns its geometry, material, ground map and normal-map clone.
    disposeMeshTree(this.terrainMesh);
    const previousSurface = this.terrainSurface;
    const terrain = createTerrain(zoneId, previousSurface);
    if (terrain.surface !== previousSurface) {
      throw new Error('createTerrain reuse returned a different TerrainSurface');
    }
    this.terrainMesh = terrain.mesh;
    // View layers keep the original sampler, so the owner must agree with it.
    this.terrainSurface = terrain.surface;
    this.scene.add(terrain.mesh);

    // Props own merged geometries plus cloned normal/roughness textures.
    this.propsView.dispose();
    this.propsView = createProps(layout, this.terrainSurface);
    this.scene.add(this.propsView.group);

    // Embers own one geometry and one points material.
    this.embers.dispose();
    this.embers = createEmbers(layout.bounds);
    this.scene.add(this.embers.points);

    applyZoneAtmosphere(this.world, zoneId);
  }

  /**
   * Debug-only remount: keep the live run (state, position, HP, inventory,
   * objectives, RNG) and rebuild only render-side scenery. Views that baked the
   * old heightfield into geometry or DOM are cleared before the swap. Never saves.
   */
  remountZone(zoneId: ZoneId): void {
    this.clearCombatViews();
    this.lootViews.clear();
    this.nameplates.clear();
    this.setHoverTarget(null);
    this.cursor.setHover(null);

    // Debug remount is a transient input reset: movement, attack and cast intent
    // from the old surface/marker must not survive the swap.
    if (this.state) {
      this.state.player.moveTarget = null;
      this.state.player.attackTargetId = null;
      this.state.player.castRequest = null;
    }

    // Keep the live layout seed even though mountZone replaces this.layout.
    const seed = this.layout.seed;
    const layout = generateZoneLayout(seed);
    this.mountZone(layout, zoneId);

    const state = this.state;
    const x = state ? state.player.position.x : layout.spawn.x;
    const z = state ? state.player.position.z : layout.spawn.z;
    this.rig.setGroundSampler(this.terrainSurface);
    this.rig.snapTo(x, z, this.terrainSurface.heightAt(x, z));
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
    this.rig.snapTo(p.position.x, p.position.z, this.terrainSurface.heightAt(p.position.x, p.position.z));
    this.loop.setRunning(true);
  }

  private onPlayerDeath(): void {
    this.dead = true;
    this.inventoryPanel.close();
    this.passivePanel.close();
    this.skillPanel.close();
    this.craftingPanel.close();
    this.loop.setRunning(false);
    const stats = this.state?.runStats;
    this.ui.showDeath({
      killer: stats?.lastBlow?.sourceName ?? 'the Ashen Moor',
      damageTaken: stats?.damageTaken ?? 0,
      kills: stats?.kills ?? 0,
      seconds: stats?.seconds ?? 0,
    });
  }

  // ---------- Zone objectives & boss (slice 7) ----------

  private onVictory(): void {
    const state = this.state;
    if (!state) return;
    this.loop.setRunning(false);
    this.ui.showVictory({
      kills: state.runStats.kills,
      damageTaken: state.runStats.damageTaken,
      seconds: state.runStats.seconds,
      level: state.level,
      currency: { ...state.currency },
    });
  }

  private continueAfterVictory(): void {
    if (!this.state) return;
    this.ui.hideVictory();
    if (this.mode === 'playing' && !this.dead) this.loop.setRunning(true);
  }

  // ---------- Save slots (slice 8) ----------

  private refreshTitleSaves(): void {
    const slots = listSaveSlots(this.storage);
    const latest = latestSaveSlot(slots);
    this.ui.setSaveInfo(
      latest?.save ? { classId: latest.save.classId, level: latest.save.level } : null,
      slots.some((info) => info.status !== 'empty'),
    );
  }

  private openSlots(mode: SavePanelMode): void {
    this.savePanel.open(mode, listSaveSlots(this.storage), this.activeSlot);
  }

  private chooseSlot(slot: number): void {
    if (this.savePanel.currentMode === 'save') this.saveToSlot(slot);
    else this.loadSlot(slot);
  }

  /** Autosave into the run's bound slot (milestones, build changes, death, quit). */
  private saveCheckpoint(): void {
    const state = this.state;
    if (!state || this.activeSlot === null) return;
    const result = writeSaveSlot(
      this.storage,
      this.activeSlot,
      createCheckpointSave(state, this.layout.spawn, Date.now()),
    );
    if (result.ok) this.ui.flashSave(`Checkpoint · Slot ${this.activeSlot + 1}`);
    else this.ui.showToast(result.error, '#ff8577');
    this.refreshTitleSaves();
  }

  private saveToSlot(slot: number): void {
    const state = this.state;
    if (!state) return;
    const result = writeSaveSlot(
      this.storage,
      slot,
      createCheckpointSave(state, this.layout.spawn, Date.now()),
    );
    if (!result.ok) {
      this.ui.showToast(result.error, '#ff8577');
      return;
    }
    this.activeSlot = slot;
    this.ui.setActiveSlot(slot);
    this.savePanel.close();
    this.ui.showToast(`Saved · Slot ${slot + 1}`, '#e8c877');
    this.refreshTitleSaves();
  }

  private loadSlot(slot: number): void {
    const read = readSaveSlot(this.storage, slot);
    if (!read.ok) {
      this.ui.showToast(`Cannot load Slot ${slot + 1}: ${read.error}`, '#ff8577');
      this.savePanel.sync(listSaveSlots(this.storage), this.activeSlot);
      this.refreshTitleSaves();
      return;
    }
    if (read.save.zoneSeed !== this.layout.seed) {
      this.ui.showToast('That save belongs to a different realm', '#ff8577');
      return;
    }
    let restored: GameState;
    try {
      restored = restoreGameState(read.save, this.layout);
    } catch (err) {
      this.ui.showToast(err instanceof Error ? err.message : String(err), '#ff8577');
      return;
    }
    // A slot read from its backup is healed on load, so the next read is direct.
    if (read.recovered) writeSaveSlot(this.storage, slot, read.save);

    this.clearRun();
    this.state = restored;
    this.activeSlot = slot;
    this.ui.setActiveSlot(slot);
    this.savePanel.close();
    this.beginRun();
    this.ui.showToast(
      read.recovered
        ? `Recovered Slot ${slot + 1} from backup`
        : `Loaded Slot ${slot + 1} · ${this.classDef.name} Lv ${restored.level}`,
      '#e8c877',
    );
    this.refreshTitleSaves();
  }

  private continueRun(): void {
    const latest = latestSaveSlot(listSaveSlots(this.storage));
    if (!latest) {
      this.refreshTitleSaves();
      this.ui.showToast('No saved exile to continue', '#ff8577');
      return;
    }
    this.loadSlot(latest.slot);
  }

  private deleteSlot(slot: number): void {
    const result = deleteSaveSlot(this.storage, slot);
    if (!result.ok) {
      this.ui.showToast(result.error, '#ff8577');
      return;
    }
    if (this.activeSlot === slot) {
      this.activeSlot = null;
      this.ui.setActiveSlot(null);
    }
    this.savePanel.sync(listSaveSlots(this.storage), this.activeSlot);
    this.refreshTitleSaves();
    this.ui.showToast(`Slot ${slot + 1} cleared`, '#8f887a');
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
          } else if (ev.kind === 'hazard') {
            this.advertisedAttacks.add(ev.id);
            this.tellTelegraphs++;
          } else if (ev.kind === 'damage' && ev.targetKind === 'player' && ev.attackId !== QA_DAMAGE_ID) {
            this.tellPlayerDamages++;
            if (!ev.attackId || !this.advertisedAttacks.delete(ev.attackId)) this.tellDamageBeforeTelegraph = true;
          }
        }
        for (const ev of events) {
          if (ev.kind === 'death' && ev.targetKind === 'player') {
            this.onPlayerDeath();
            this.rig.shake(0.4, 0.5);
            this.saveCheckpoint();
          } else if (ev.kind === 'damage' && ev.targetKind === 'player' && ev.attackId !== QA_DAMAGE_ID) {
            const absorbed = ev.absorbed ?? 0;
            const shieldOnly = absorbed >= ev.amount;
            const fraction = ev.amount / Math.max(1, state.player.maxHp);
            this.ui.flashDamage(shieldOnly ? 'shield' : 'health', 0.3 + Math.min(0.7, fraction * 4));
            this.rig.shake(shieldOnly ? 0.06 : Math.min(0.32, 0.1 + fraction), shieldOnly ? 0.14 : 0.24);
          } else if (ev.kind === 'levelup') {
            this.ui.showToast(`Level ${ev.level}! · 1 skill point`, '#e8c877');
            if (this.skillPanel.visible) this.skillPanel.sync(state);
            this.saveCheckpoint();
          } else if (ev.kind === 'refuse') this.reportRefusal(ev.reason, ev.label);
          else if (ev.kind === 'objective') {
            this.ui.showToast(ev.text, '#e8c877');
            this.saveCheckpoint();
          } else if (ev.kind === 'boss-phase') {
            this.ui.showToast(ev.label, '#ff8577');
            this.rig.shake(0.22, 0.5);
          } else if (ev.kind === 'victory') {
            this.onVictory();
            this.saveCheckpoint();
          } else if (ev.kind === 'pickup') {
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
      this.hazardLayer.sync(state);
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
      if (this.passivePanel.visible) this.passivePanel.sync(state);
      if (this.craftingPanel.visible) this.craftingPanel.sync(state);
      this.ui.setPoints(passivePointsAvailable(state), skillPointsAvailable(state));
      this.ui.setObjectives({
        campsCleared: state.objectives.campCleared.filter(Boolean).length,
        campsTotal: state.objectives.campsTotal,
        bossSpawned: state.objectives.bossSpawned,
        bossDefeated: state.objectives.bossDefeated,
      });
      this.rig.follow(
        state.player.position.x,
        state.player.position.z,
        dt,
      );
      this.propsView.update(this.rig.camera, state.player.position.x, state.player.position.z, dt);
    }
    this.updateHover();
    this.embers.update(dt);
    this.cursor.update(elapsed, dt);
    this.updateQuality(dt);
    this.world.renderer.render(this.scene, this.rig.camera);
  }

  /**
   * Dynamic resolution: a slow frame budget steps the pixel ratio down in
   * quarter increments; headroom steps it back toward the device cap. The
   * gameplay simulation and render interpolation never change.
   */
  private updateQuality(dt: number): void {
    if (this.mode !== 'playing' || dt <= 0) return;
    this.qualityTime += dt;
    this.qualityFrames++;
    if (this.qualityTime < 1.5) return;
    const average = this.qualityTime / this.qualityFrames;
    this.qualityTime = 0;
    this.qualityFrames = 0;
    let next = this.qualityRatio;
    if (average > 0.022 && next > 1) next = Math.max(1, next - 0.25);
    else if (average < 0.0175 && next < this.qualityCap) next = Math.min(this.qualityCap, next + 0.25);
    if (next === this.qualityRatio) return;
    this.qualityRatio = next;
    this.world.renderer.setPixelRatio(next);
  }

  // ---------- Picking ----------

  /**
   * Intersect the pointer ray with the heightfield. Four plane-refinement
   * passes are enough for the gentle moor and keep hover picking O(1).
   */
  private groundPoint(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.rig.camera);
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-5) return null;
    let height = 0;
    for (let i = 0; i < 4; i++) {
      const t = (height - ray.origin.y) / ray.direction.y;
      if (t < 0) return null;
      this.tmpVec.copy(ray.origin).addScaledVector(ray.direction, t);
      const sampled = this.terrainSurface.heightAt(this.tmpVec.x, this.tmpVec.z);
      if (Math.abs(sampled - this.tmpVec.y) < 0.005) {
        height = sampled;
        break;
      }
      height = sampled;
    }
    this.tmpVec.y = this.terrainSurface.heightAt(this.tmpVec.x, this.tmpVec.z);
    return this.tmpVec;
  }

  private pickEnemy() {
    if (!this.state || !this.pointerInside) return null;
    const { x: width, y: height } = this.viewport;
    return this.enemyViews.pick(this.state, this.rig.camera, width, height,
      (this.pointer.x + 1) * width * 0.5, (1 - this.pointer.y) * height * 0.5);
  }

  private updateHover(): void {
    if (this.mode !== 'playing' || this.dead || !this.pointerInside) {
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
    });

    this.canvas.addEventListener('pointerenter', (e) => this.setPointer(e));
    this.canvas.addEventListener('pointerleave', () => { this.pointerInside = false; });
    this.canvas.addEventListener('pointercancel', () => { this.pointerInside = false; });

    this.canvas.addEventListener('pointerdown', (e) => {
      this.setPointer(e);
      if (e.button === 2) {
        // Right click is a skill slot (the picker keeps slots editable).
        if (this.mode === 'playing' && !this.dead) this.castSlot('rmb');
        return;
      }
      if (e.button !== 0 || this.mode !== 'playing' || this.dead || !this.state) return;

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
      const slot = ({ q: 'q', w: 'w', e: 'e', r: 'r', f: 'f' } as const)[key as 'q' | 'w' | 'e' | 'r' | 'f'];
      if (slot) {
        if (this.mode === 'playing' && !this.dead && !e.repeat) this.castSlot(slot);
        return;
      }
      if (e.key === 'i' || e.key === 'I' || e.key === 'Tab') {
        if (this.mode !== 'playing' || this.dead || e.repeat) return;
        e.preventDefault();
        this.skillPanel.close();
        this.craftingPanel.close();
        this.inventoryPanel.toggle();
        if (this.inventoryPanel.visible && this.state) this.inventoryPanel.sync(this.state);
        return;
      }
      if (key === 'p' || key === 'P') {
        if (this.mode !== 'playing' || this.dead || e.repeat) return;
        e.preventDefault();
        this.skillPanel.close();
        this.craftingPanel.close();
        this.passivePanel.toggle();
        if (this.passivePanel.visible && this.state) this.passivePanel.sync(this.state);
        return;
      }
      if (key === 'c' || key === 'C') {
        if (this.mode !== 'playing' || this.dead || e.repeat || !this.state) return;
        e.preventDefault();
        this.skillPanel.close();
        this.inventoryPanel.close();
        this.passivePanel.close();
        if (this.craftingPanel.visible) this.craftingPanel.close();
        else this.craftingPanel.open(this.state);
        return;
      }
      if (key === 'k' || key === 'K') {
        if (this.mode !== 'playing' || this.dead || e.repeat || !this.state) return;
        e.preventDefault();
        if (this.skillPanel.visible) this.skillPanel.close();
        else this.openSkills();
        return;
      }
      if (e.key !== 'Escape') return;
      if (this.savePanel.visible) {
        this.savePanel.close();
        return;
      }
      if (this.craftingPanel.visible) {
        this.craftingPanel.close();
        return;
      }
      if (this.skillPanel.visible) {
        this.skillPanel.close();
        return;
      }
      if (this.passivePanel.visible) {
        this.passivePanel.close();
        return;
      }
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
    this.qualityCap = Math.min(window.devicePixelRatio, 2);
    this.qualityRatio = Math.min(this.qualityRatio, this.qualityCap);
    this.world.renderer.setPixelRatio(this.qualityRatio);
    this.world.renderer.setSize(w, h);
    this.rig.setAspect(w / h);
    this.viewport.set(w, h);
  }

  // ---------- Skills, loadout & flasks ----------

  private loadoutEntries(state: GameState): LoadoutEntry[] {
    return LOADOUT_SLOTS.map((slot) => {
      const id = skillInSlot(state, slot);
      if (!id) {
        return {
          slot,
          skill: null,
          rank: 0,
          minDamage: 0,
          maxDamage: 0,
          cooldown: 0,
          manaCost: 0,
          rune: null,
        };
      }
      const skill = getSkill(id);
      const damage = effectiveSkillDamage(state, id);
      return {
        slot,
        skill,
        rank: skillRank(state, id),
        minDamage: damage.min,
        maxDamage: damage.max,
        cooldown: effectiveSkillCooldown(state, id),
        manaCost: skillManaCost(state, id),
        rune: runeFor(state, id),
      };
    });
  }

  private refreshSkillUi(): void {
    const state = this.state;
    if (!state) return;
    this.ui.setLoadout(this.loadoutEntries(state));
    this.ui.setPoints(passivePointsAvailable(state), skillPointsAvailable(state));
    if (this.skillPanel.visible) this.skillPanel.sync(state);
  }

  private castSlot(slot: LoadoutSlot): void {
    const state = this.state;
    if (!state || this.mode !== 'playing' || this.dead) return;
    const id = skillInSlot(state, slot);
    if (!id) {
      this.ui.showToast(`${slot === 'rmb' ? 'RMB' : slot.toUpperCase()}: no skill assigned — click the slot`, '#8f887a');
      return;
    }
    if (skillRank(state, id) <= 0) {
      this.ui.showToast(`${getSkill(id).name} is locked — press K to unlock it`, '#ff8577');
      return;
    }
    const aim = this.castAimPoint(state);
    state.player.castRequest = { skillId: id, x: aim.x, z: aim.z };
  }

  private openSkillPicker(slot: LoadoutSlot): void {
    const state = this.state;
    if (!state || this.dead) return;
    this.inventoryPanel.close();
    this.passivePanel.close();
    this.craftingPanel.close();
    this.skillPanel.open(slot, state);
  }

  private openSkills(): void {
    const state = this.state;
    if (!state) return;
    const empty = LOADOUT_SLOTS.find((slot) => skillInSlot(state, slot) === null);
    this.inventoryPanel.close();
    this.passivePanel.close();
    this.craftingPanel.close();
    this.skillPanel.open(empty ?? 'q', state);
  }

  private openCrafting(): void {
    const state = this.state;
    if (!state) return;
    this.inventoryPanel.close();
    this.passivePanel.close();
    this.skillPanel.close();
    this.craftingPanel.open(state);
  }

  private handleCraft(action: CraftAction, uid: string): void {
    const state = this.state;
    if (!state) return;
    const result = action === 'reforge'
      ? reforgeAffix(state, uid)
      : action === 'add'
        ? addAffix(state, uid)
        : improveQuality(state, uid);
    if (!result.ok) {
      this.ui.showToast(result.reason ?? 'Crafting failed', '#ff8577');
    } else {
      this.ui.showToast(result.detail ?? 'Crafted', '#e8c877');
      this.saveCheckpoint();
    }
    if (this.inventoryPanel.visible) this.inventoryPanel.sync(state);
    this.craftingPanel.sync(state);
    this.ui.setPlayerHp(state.player.hp, state.player.maxHp);
    this.ui.setPlayerEs(state.player.energyShield, state.player.maxEnergyShield);
  }

  private handleSalvage(uid: string): void {
    const state = this.state;
    if (!state) return;
    const result = salvageItem(state, uid);
    if (!result.ok) {
      this.ui.showToast(result.reason, '#ff8577');
    } else {
      this.ui.showToast(`Salvaged for ${result.value} Ember Dust`, '#e8c877');
      this.saveCheckpoint();
    }
    if (this.inventoryPanel.visible) this.inventoryPanel.sync(state);
    this.craftingPanel.sync(state);
    this.ui.setPlayerHp(state.player.hp, state.player.maxHp);
    this.ui.setPlayerEs(state.player.energyShield, state.player.maxEnergyShield);
  }

  private handleAssignSkill(slot: LoadoutSlot, id: SkillId | null): void {
    const state = this.state;
    if (!state) return;
    if (id === null) {
      clearSkillSlot(state, slot);
    } else {
      const result = equipSkill(state, slot, id);
      if (!result.ok) {
        this.ui.showToast(loadoutRefusalMessage(result), '#ff8577');
        this.skillPanel.sync(state);
        return;
      }
    }
    this.refreshSkillUi();
    this.saveCheckpoint();
  }

  private handleUnlockSkill(id: SkillId): void {
    const state = this.state;
    if (!state) return;
    const result = unlockSkill(state, id);
    if (!result.ok) {
      this.ui.showToast(loadoutRefusalMessage(result), '#ff8577');
    } else {
      this.ui.showToast(`${getSkill(id).name} unlocked — equip it from the picker`, '#e8c877');
      this.saveCheckpoint();
    }
    this.refreshSkillUi();
  }

  private handleUpgradeSkill(id: SkillId): void {
    const state = this.state;
    if (!state) return;
    const result = upgradeSkill(state, id);
    if (!result.ok) {
      this.ui.showToast(loadoutRefusalMessage(result), '#ff8577');
    } else {
      this.ui.showToast(`${getSkill(id).name} reached rank ${skillRank(state, id)}`, '#e8c877');
      this.saveCheckpoint();
    }
    this.refreshSkillUi();
  }

  private handleSetRune(id: SkillId, runeId: RuneId | null): void {
    const state = this.state;
    if (!state) return;
    const result = setRune(state, id, runeId);
    if (!result.ok) {
      this.ui.showToast(loadoutRefusalMessage(result), '#ff8577');
    } else {
      this.ui.showToast(
        runeId ? `${getSkill(id).name} · ${getRune(runeId)?.name ?? 'rune'}` : `${getSkill(id).name} rune removed`,
        '#8f887a',
      );
      this.saveCheckpoint();
    }
    this.refreshSkillUi();
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

  private reportRefusal(reason: 'mana' | 'cooldown' | 'flask-empty' | 'locked', label: string): void {
    const now = performance.now();
    if (this.lastRefusal.label === label && now - this.lastRefusal.at < 900) return;
    this.lastRefusal = { label, at: now };
    const message =
      reason === 'mana' ? `${label}: not enough mana`
        : reason === 'cooldown' ? `${label}: recharging`
          : reason === 'locked' ? `${label}: not equipped`
            : `${label}: no charges — slay enemies to refill`;
    this.ui.showToast(message, reason === 'cooldown' ? '#8f887a' : '#ff8577');
  }

  private handleEquip(uid: string): void {
    if (!this.state) return;
    const result = equipItem(this.state, uid);
    if (result.ok) {
      this.inventoryPanel.sync(this.state);
      this.ui.setPlayerHp(this.state.player.hp, this.state.player.maxHp);
      this.saveCheckpoint();
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
      this.saveCheckpoint();
    } else {
      this.ui.showToast(`Cannot unequip: ${result.reason}`, '#ff8577');
    }
  }

  // ---------- Passive tree (slice 6) ----------

  private handlePassiveAllocate(id: string): void {
    const state = this.state;
    if (!state || this.mode !== 'playing' || this.dead) return;
    const result = allocatePassive(state, id);
    if (!result.ok) this.ui.showToast(passiveRefusalMessage(result), '#ff8577');
    else this.saveCheckpoint();
    this.passivePanel.sync(state);
    if (this.inventoryPanel.visible) this.inventoryPanel.sync(state);
  }

  private handlePassiveRefund(id: string): void {
    const state = this.state;
    if (!state || this.mode !== 'playing' || this.dead) return;
    const result = refundPassive(state, id);
    if (!result.ok) this.ui.showToast(passiveRefusalMessage(result), '#ff8577');
    else this.saveCheckpoint();
    this.passivePanel.sync(state);
    if (this.inventoryPanel.visible) this.inventoryPanel.sync(state);
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
          addedAttackDamage: Math.round((state?.player.addedAttackDamage ?? 0) * 10) / 10,
          addedSpellDamage: Math.round((state?.player.addedSpellDamage ?? 0) * 10) / 10,
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
          bossPhase: e.bossPhase,
        })) ?? [],
      arena: state
        ? { x: state.arena.center.x, z: state.arena.center.z, radius: state.arena.radius }
        : { x: 0, z: 0, radius: 0 },
      objectives: state
        ? {
          campsCleared: state.objectives.campCleared.filter(Boolean).length,
          campsTotal: state.objectives.campsTotal,
          bossSpawned: state.objectives.bossSpawned,
          bossDefeated: state.objectives.bossDefeated,
        }
        : { campsCleared: 0, campsTotal: 0, bossSpawned: false, bossDefeated: false },
      projectiles: state?.projectiles.length ?? 0,
      strikes: state?.strikes.length ?? 0,
      hazards: state?.hazards.length ?? 0,
      camera: { yaw: this.rig.yaw, pitch: this.rig.pitch, distance: this.rig.distance },
      markers: this.cursor.probe(),
      probes: {
        playerGround: (() => {
          const view = this.playerView;
          if (!view) return { y: 0, height: 0, error: 0 };
          const { x, y, z } = view.group.position;
          const height = this.terrainSurface.heightAt(x, z);
          return { y, height, error: Math.abs(y - height) };
        })(),
        rings: this.cursor.probe(),
        telegraph: this.telegraphs.probe(),
        bossRoot: this.enemyViews.probeBoss(),
      },
      playerRenderY: this.playerView?.group.position.y ?? 0,
      skills: state
        ? this.loadoutEntries(state).map((entry) => ({
          slot: entry.slot,
          id: entry.skill?.id ?? null,
          name: entry.skill?.name ?? null,
          manaCost: entry.manaCost,
          cooldown: entry.cooldown,
          rank: entry.rank,
          rune: entry.rune?.id ?? null,
        }))
        : [],
      skillPoints: state
        ? { total: skillPointsTotal(state), spent: skillPointsSpent(state), available: skillPointsAvailable(state) }
        : { total: 0, spent: 0, available: 0 },
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
      passives: {
        allocated: state ? [...state.passives.allocated] : [],
        spent: state ? passivePointsSpent(state) : 0,
        total: state ? passivePointsTotal(state) : 0,
        available: state ? passivePointsAvailable(state) : 0,
      },
      level: state?.level ?? 0,
      xp: state?.xp ?? 0,
      xpToNext: state?.xpToNext ?? 0,
      bagCount: state?.inventory.bags.length ?? 0,
      equippedCount: state ? Object.values(state.inventory.equipment).filter(Boolean).length : 0,
      drops: state?.loot.length ?? 0,
      dropPositions: state?.loot.map((d) => ({ x: d.x, z: d.z })) ?? [],
      currency: state ? { ...state.currency } : { dust: 0, rune: 0, quality: 0 },
      items: state
        ? [
          ...state.inventory.bags.map((item) => ({ ...item, equipped: false })),
          ...(Object.values(state.inventory.equipment)
            .filter((item): item is ItemInstance => item !== null)
            .map((item) => ({ ...item, equipped: true }))),
        ]
        : [],
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
        pixelRatio: this.world.renderer.getPixelRatio(),
        pixelRatioCap: this.qualityCap,
        shadows: this.world.renderer.shadowMap.enabled,
        detailedEnemies: this.enemyViews.detailedCount,
        healthBars: this.enemyViews.visibleBars,
        occludedProps: this.propsView.occludedCount,
        reducedMotion: this.reducedMotion,
        qualityWindow: Math.round(this.qualityTime * 1000) / 1000,
        qualityFrames: this.qualityFrames,
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
    this.state.hazards.length = 0;
    // A quiet moor must not read as "camps cleared" and wake the Warden.
    this.state.objectives.campsTotal = 0;
    this.state.objectives.campCleared = [];
  }

  clearCamps(): void {
    const state = this.state;
    if (!state) return;
    for (const enemy of state.enemies) {
      if (enemy.camp >= 0 && !enemy.dead) {
        enemy.hp = 0;
        enemy.dead = true;
        enemy.deadTime = 0;
      }
    }
  }

  hurtEnemy(id: string, amount: number): void {
    const state = this.state;
    if (!state) return;
    const enemy = state.enemies.find((e) => e.id === id && !e.dead);
    if (enemy) damageEnemy(state, enemy, amount, state.events);
  }

  teleportPlayer(x: number, z: number): void {
    const state = this.state;
    if (!state) return;
    state.player.position.x = x;
    state.player.position.z = z;
    state.player.previousPosition.x = x;
    state.player.previousPosition.z = z;
    // Fixture teleports stop pursuit: a stale chase would walk the hero off the
    // spot the check is establishing.
    state.player.moveTarget = null;
    state.player.attackTargetId = null;
  }

  terrainHeightAt(x: number, z: number): number {
    return this.terrainSurface.heightAt(x, z);
  }

  sceneryPoints(): Array<{ x: number; z: number }> {
    const state = this.state;
    if (!state) return [];
    const p = state.player.position;
    return [...this.layout.props]
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
      .slice(0, 8)
      .map((prop) => ({ x: prop.x, z: prop.z }));
  }

  hazardPoints(): ReturnType<AshenDebug['hazardPoints']> {
    const state = this.state;
    if (!state) return [];
    return state.hazards.map((hazard) => ({
      id: hazard.id,
      kind: hazard.kind,
      x: hazard.x,
      z: hazard.z,
      radius: hazard.radius,
      detonated: hazard.detonated,
    }));
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

  setShadows(enabled: boolean): void {
    this.world.renderer.shadowMap.enabled = enabled;
  }

  flashDamage(kind: 'health' | 'shield', strength: number): void {
    this.ui.flashDamage(kind, strength);
  }

  unlockSkill(id: SkillId): boolean {
    if (!this.state) return false;
    const result = unlockSkill(this.state, id);
    if (result.ok) this.refreshSkillUi();
    return result.ok;
  }

  equipSkill(slot: LoadoutSlot, id: SkillId): boolean {
    if (!this.state) return false;
    const result = equipSkill(this.state, slot, id);
    if (result.ok) this.refreshSkillUi();
    return result.ok;
  }

  makeVolatile(id: string): boolean {
    const enemy = this.state?.enemies.find((candidate) => candidate.id === id && !candidate.dead);
    if (!enemy) return false;
    if (!enemy.elite.includes('volatile')) enemy.elite.push('volatile');
    return true;
  }

  grantCurrency(dust: number, rune: number, quality: number): void {
    if (!this.state) return;
    this.state.currency.dust += Math.max(0, Math.floor(dust));
    this.state.currency.rune += Math.max(0, Math.floor(rune));
    this.state.currency.quality += Math.max(0, Math.floor(quality));
  }

  grantItem(rarity: Rarity): string {
    if (!this.state) throw new Error('no active state');
    const item = rollItem(this.state.rng, this.state.level, rarity);
    this.state.inventory.bags.push(item);
    if (this.inventoryPanel.visible) this.inventoryPanel.sync(this.state);
    if (this.craftingPanel.visible) this.craftingPanel.sync(this.state);
    return item.uid;
  }

  exportSave(): string {
    if (!this.state) throw new Error('no active state');
    return serializeSave(createCheckpointSave(this.state, this.layout.spawn));
  }

  saves(): ReturnType<AshenDebug['saves']> {
    return {
      activeSlot: this.activeSlot,
      persistent: this.persistentSaves,
      slots: listSaveSlots(this.storage).map((info) => ({
        slot: info.slot,
        status: info.status,
        classId: info.save?.classId ?? null,
        level: info.save?.level ?? null,
        campsCleared: info.save ? info.save.objectives.campsCleared.filter(Boolean).length : 0,
        campsTotal: info.save ? info.save.objectives.campsCleared.length : 0,
        bossSpawned: info.save?.objectives.bossSpawned ?? false,
        bossDefeated: info.save?.objectives.bossDefeated ?? false,
        savedAt: info.save?.savedAt ?? 0,
        recovered: info.recovered,
        error: info.error ?? null,
      })),
    };
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
  setShadows: (enabled) => game.setShadows(enabled),
  flashDamage: (kind, strength) => game.flashDamage(kind, strength),
  unlockSkill: (id) => game.unlockSkill(id),
  equipSkill: (slot, id) => game.equipSkill(slot, id),
  makeVolatile: (id) => game.makeVolatile(id),
  hazardPoints: () => game.hazardPoints(),
  grantCurrency: (dust, rune, quality) => game.grantCurrency(dust, rune, quality),
  grantItem: (rarity) => game.grantItem(rarity),
  setDefences: (armour, evasion) => game.setDefences(armour, evasion),
  clearEnemies: () => game.clearEnemies(),
  clearCamps: () => game.clearCamps(),
  hurtEnemy: (id, amount) => game.hurtEnemy(id, amount),
  teleportPlayer: (x, z) => game.teleportPlayer(x, z),
  terrainHeightAt: (x, z) => game.terrainHeightAt(x, z),
  remountZone: (zoneId) => game.remountZone(zoneId),
  sceneryPoints: () => game.sceneryPoints(),
  exportSave: () => game.exportSave(),
  saves: () => game.saves(),
};
