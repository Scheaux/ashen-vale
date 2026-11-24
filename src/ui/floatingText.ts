import * as THREE from 'three';
import type { SimEvent } from '../sim/state';

type FloatingKind = 'damage' | 'player-damage' | 'player-shield' | 'player-miss' | 'heal' | 'mana';

const MAX_LIVE_TEXT = 48;
const HEAVY_DAMAGE = 22;

/**
 * DOM-overlay floating combat text. Damage numbers are spawned from
 * authoritative sim events, projected from world space at spawn time.
 * Big hits get a heavier treatment, shield hits read blue with a diamond
 * marker, and the layer caps live nodes so AoE bursts cannot flood the DOM.
 */
export class FloatingTextLayer {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'floating-text-layer';
    parent.appendChild(this.root);
  }

  clear(): void {
    this.root.replaceChildren();
  }

  handleEvents(events: readonly SimEvent[], camera: THREE.Camera): void {
    for (const ev of events) {
      if (ev.kind === 'damage') {
        const absorbed = ev.absorbed ?? 0;
        const shielded = absorbed > 0;
        const shieldedOnly = absorbed >= ev.amount;
        const marker = shielded ? '◈ ' : '';
        this.spawn(
          camera,
          ev.x,
          ev.y,
          ev.z,
          `${marker}${ev.amount}`,
          ev.targetKind === 'player' ? (shieldedOnly ? 'player-shield' : 'player-damage') : 'damage',
          ev.amount >= HEAVY_DAMAGE,
        );
      } else if (ev.kind === 'evade') {
        this.spawn(camera, ev.x, ev.y, ev.z, 'Evaded', 'player-miss');
      } else if (ev.kind === 'resource') {
        this.spawn(
          camera,
          ev.x,
          ev.y,
          ev.z,
          `+${ev.amount}`,
          ev.resource === 'health' ? 'heal' : 'mana',
        );
      }
    }
  }

  spawn(
    camera: THREE.Camera,
    x: number,
    y: number,
    z: number,
    text: string,
    kind: FloatingKind,
    heavy = false,
  ): void {
    const v = new THREE.Vector3(x, y, z).project(camera);
    if (v.z > 1) return; // behind the camera

    while (this.root.childElementCount >= MAX_LIVE_TEXT) {
      this.root.firstElementChild?.remove();
    }

    const el = document.createElement('div');
    el.className = `floating-text floating-text--${kind}${heavy ? ' floating-text--heavy' : ''}`;
    el.textContent = text;
    // Small deterministic-looking stagger keeps stacked numbers legible.
    const drift = (Math.random() - 0.5) * 28;
    el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth + drift}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    this.root.appendChild(el);
    window.setTimeout(() => el.remove(), 1000);
  }
}
