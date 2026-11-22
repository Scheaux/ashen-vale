import * as THREE from 'three';
import type { SimEvent } from '../sim/state';

type FloatingKind = 'damage' | 'player-damage';

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

  handleEvents(events: readonly SimEvent[], camera: THREE.Camera): void {
    for (const ev of events) {
      if (ev.kind === 'damage') {
        this.spawn(
          camera,
          ev.x,
          ev.y,
          ev.z,
          String(ev.amount),
          ev.targetKind === 'player' ? 'player-damage' : 'damage',
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
