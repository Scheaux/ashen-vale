import * as THREE from 'three';
import type { SimEvent } from '../sim/state';

type FloatingKind = 'damage' | 'player-damage' | 'player-shield' | 'player-miss' | 'heal' | 'mana';

/**
 * DOM-overlay floating combat text. Damage numbers are spawned from
 * authoritative sim events, projected from world space at spawn time.
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
        const shielded = ev.absorbed !== undefined && ev.absorbed >= ev.amount;
        this.spawn(
          camera,
          ev.x,
          ev.y,
          ev.z,
          String(ev.amount),
          ev.targetKind === 'player' ? (shielded ? 'player-shield' : 'player-damage') : 'damage',
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
  ): void {
    const v = new THREE.Vector3(x, y, z).project(camera);
    if (v.z > 1) return; // behind the camera

    const el = document.createElement('div');
    el.className = `floating-text floating-text--${kind}`;
    el.textContent = text;
    el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    this.root.appendChild(el);
    window.setTimeout(() => el.remove(), 1000);
  }
}
