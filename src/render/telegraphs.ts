import * as THREE from 'three';
import type { SimEvent } from '../sim/state';
import { disposeMeshTree } from './dispose';
import type { TerrainSurface } from './terrainSurface';

interface TelegraphView {
  /** Dark ground stain: guarantees contrast against every terrain tone. */
  underlay: THREE.Mesh;
  fill: THREE.Mesh;
  /** Bright rim tracing the exact footprint edge. */
  rim: THREE.Mesh;
  underlayMaterial: THREE.MeshBasicMaterial;
  fillMaterial: THREE.MeshBasicMaterial;
  rimMaterial: THREE.MeshBasicMaterial;
  /** Seconds since the tell started, plus its advertised duration. */
  age: number;
  duration: number;
  /** Fade-out timer once the strike has passed. */
  fade: number;
}

const TELEGRAPH_COLOR = 0xff4a33;
const RIM_COLOR = 0xffb070;
const UNDERLAY_COLOR = 0x160405;
const RIM_WIDTH = 0.1;

export function warningFootprints(ev: Extract<SimEvent, { kind: 'telegraph' }>) {
  const sin = Math.sin(ev.facing);
  const cos = Math.cos(ev.facing);
  const point = (x: number, z: number) => ({ x: ev.x + x * cos + z * sin, z: ev.z - x * sin + z * cos });
  if (ev.shape === 'bolt' || ev.shape === 'pounce') {
    const cap = (front: boolean) => Array.from({ length: 17 }, (_, i) => {
      const t = i / 16 * Math.PI;
      return point(Math.cos(t) * ev.radius * (front ? -1 : 1),
        front ? ev.range + Math.sin(t) * ev.radius : -Math.sin(t) * ev.radius);
    });
    return [[...cap(false), ...cap(true)]];
  }

  if (ev.shape === 'slam') {
    // Ground slam: a disc at the locked landing point.
    const disc = Array.from({ length: 25 }, (_, i) => {
      const t = (i / 24) * Math.PI * 2;
      return point(Math.cos(t) * ev.radius, Math.sin(t) * ev.radius);
    });
    return [disc];
  }

  const arc = THREE.MathUtils.degToRad(ev.arcDeg);
  // Keep each sector convex, including any future sweep wider than 180°.
  const parts = Math.max(1, Math.ceil(arc / Math.PI));
  return Array.from({ length: parts }, (_, part) => [
    point(0, 0),
    ...Array.from({ length: 33 }, (_, i) => {
      const angle = -arc / 2 + (part + i / 32) * arc / parts;
      return point(Math.sin(angle) * ev.range, Math.cos(angle) * ev.range);
    }),
  ]);
}

/** Narrow quads centred on every polygon edge, for a bright warning rim. */
function outlineQuads(points: ReadonlyArray<{ x: number; z: number }>, width: number) {
  const quads: Array<Array<{ x: number; z: number }>> = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const nx = (-dz / length) * width * 0.5;
    const nz = (dx / length) * width * 0.5;
    quads.push([
      { x: a.x + nx, z: a.z + nz },
      { x: b.x + nx, z: b.z + nz },
      { x: b.x - nx, z: b.z - nz },
      { x: a.x - nx, z: a.z - nz },
    ]);
  }
  return quads;
}

/**
 * Ground telegraphs drawn from authoritative 'telegraph' sim events. Each tell
 * is three layers: a dark stain for contrast, a rising fill that communicates
 * how close the strike is, and a bright rim tracing the exact locked footprint.
 * The shape comes from the enemy's locked windup facing, so what the player
 * sees is exactly what the strike will hit.
 */
export class TelegraphLayer {
  private readonly group = new THREE.Group();
  private readonly views = new Map<string, TelegraphView>();

  constructor(scene: THREE.Scene, private readonly terrain: TerrainSurface) {
    scene.add(this.group);
  }

  clear(): void {
    for (const view of this.views.values()) this.disposeView(view);
    this.views.clear();
  }

  handleEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.kind !== 'telegraph') continue;
      const existing = this.views.get(ev.enemyId);
      if (existing) this.disposeView(existing);

      const footprints = warningFootprints(ev);
      const underlayMaterial = new THREE.MeshBasicMaterial({
        color: UNDERLAY_COLOR,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: TELEGRAPH_COLOR,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const rimMaterial = new THREE.MeshBasicMaterial({
        color: RIM_COLOR,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const underlay = new THREE.Mesh(this.terrain.drape(footprints, 0.04), underlayMaterial);
      const fill = new THREE.Mesh(this.terrain.drape(footprints, 0.05), fillMaterial);
      const rim = new THREE.Mesh(
        this.terrain.drape(footprints.flatMap((polygon) => outlineQuads(polygon, RIM_WIDTH)), 0.06),
        rimMaterial,
      );
      underlay.renderOrder = 1;
      fill.renderOrder = 2;
      rim.renderOrder = 3;
      this.group.add(underlay, fill, rim);
      this.views.set(ev.enemyId, {
        underlay,
        fill,
        rim,
        underlayMaterial,
        fillMaterial,
        rimMaterial,
        age: 0,
        duration: Math.max(0.15, ev.duration),
        fade: 0,
      });
    }
  }

  sync(state: { enemies: Array<{ id: string; phase: string; dead: boolean }> }, dt: number): void {
    const now = performance.now();
    for (const [id, view] of this.views) {
      const enemy = state.enemies.find((e) => e.id === id);
      if (enemy && !enemy.dead && (enemy.phase === 'windup' || enemy.phase === 'active')) {
        view.fade = 0;
        view.age += dt;
        const progress = Math.min(1, view.age / view.duration);
        // A fast pulse layered over a rising fill: urgency without hiding the shape.
        const pulse = 0.5 + 0.5 * Math.sin(now / 85);
        view.underlayMaterial.opacity = 0.3 + 0.1 * progress;
        view.fillMaterial.opacity = 0.12 + 0.2 * progress + 0.05 * pulse * progress;
        view.rimMaterial.opacity = 0.34 + 0.2 * progress + 0.08 * pulse;
      } else {
        view.fade += dt;
        const k = Math.max(0, 1 - view.fade / 0.25);
        view.underlayMaterial.opacity = 0.4 * k;
        view.fillMaterial.opacity = 0.34 * k;
        view.rimMaterial.opacity = 0.62 * k;
        if (view.fade > 0.25) {
          this.disposeView(view);
          this.views.delete(id);
        }
      }
    }
  }

  private disposeView(view: TelegraphView): void {
    disposeMeshTree(view.underlay);
    disposeMeshTree(view.fill);
    disposeMeshTree(view.rim);
  }
}
