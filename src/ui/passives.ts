import { PASSIVE_NODES, passiveEdges, type PassiveNode } from '../content/passives';
import type { GameState } from '../sim/state';
import { passivePointsAvailable, passivePointsTotal, canAllocatePassive, canRefundPassive } from '../systems/passives';

export interface PassiveCallbacks {
  onAllocate(id: string): void;
  onRefund(id: string): void;
}

const CLUSTER_COLORS: Record<PassiveNode['cluster'], string> = {
  offense: '#e0563f',
  defense: '#5d8fe0',
  utility: '#c8a24a',
};

const EFFECT_LABELS: Record<string, string> = {
  maxHp: 'Life',
  maxMana: 'Mana',
  attackDamagePct: 'Attack Damage',
  spellDamagePct: 'Spell Damage',
  armour: 'Armour',
  evasion: 'Evasion',
  energyShield: 'Energy Shield',
  moveSpeedPct: 'Movement Speed',
  strength: 'Strength',
  dexterity: 'Dexterity',
  intelligence: 'Intelligence',
};

const PERCENT_STATS = new Set(['attackDamagePct', 'spellDamagePct', 'moveSpeedPct']);

/** Tree layout mapping (content coords -> panel pixels). */
const SCALE = 52;
const CENTER_X = 590;
const CENTER_Y = 168;

function nodePos(node: PassiveNode): { x: number; y: number } {
  return { x: CENTER_X + node.x * SCALE, y: CENTER_Y + node.y * SCALE };
}

/**
 * Passive tree screen (slice 6): a coordinate-graph of nodes over an SVG edge
 * layer. Allocation and refund are pure callbacks — the panel only renders
 * the authoritative allocation state from the sim.
 */
export class PassiveTreePanel {
  private readonly root: HTMLElement;
  private readonly tree: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly points: HTMLElement;
  private readonly nodeEls = new Map<string, HTMLElement>();
  visible = false;

  constructor(parent: HTMLElement, private readonly callbacks: PassiveCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'passive-screen hidden';
    this.root.innerHTML = `
      <div class="passive-panel">
        <div class="passive-header">
          <h3 class="inventory-title">Passive Skill Tree</h3>
          <div class="passive-points" data-passive-points></div>
        </div>
        <div class="passive-tree" data-passive-tree>
          <svg class="passive-edges" width="1180" height="660"></svg>
        </div>
        <p class="inventory-hint">Click a glowing node to allocate · right click to refund · P or Esc to close</p>
      </div>
      <div class="item-tooltip hidden" data-passive-tip></div>`;
    parent.appendChild(this.root);

    this.tree = this.root.querySelector('[data-passive-tree]') as HTMLElement;
    this.tooltip = this.root.querySelector('[data-passive-tip]') as HTMLElement;
    this.points = this.root.querySelector('[data-passive-points]') as HTMLElement;

    const svg = this.root.querySelector('svg') as SVGSVGElement;
    for (const edge of passiveEdges()) {
      const from = PASSIVE_NODES.find((n) => n.id === edge.from);
      const to = PASSIVE_NODES.find((n) => n.id === edge.to);
      if (!from || !to) continue;
      const a = nodePos(from);
      const b = nodePos(to);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      line.setAttribute('data-edge', `${edge.from}:${edge.to}`);
      svg.appendChild(line);
    }

    for (const node of PASSIVE_NODES) {
      const pos = nodePos(node);
      const el = document.createElement('button');
      el.className = `pnode pnode--${node.cluster}${node.keystone ? ' pnode--keystone' : ''}`;
      el.dataset.node = node.id;
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
      el.style.setProperty('--cluster-color', CLUSTER_COLORS[node.cluster]);
      el.innerHTML = `<span class="pnode__label"></span><span class="pnode__name"></span>`;
      (el.querySelector('.pnode__label') as HTMLElement).textContent = node.keystone ? '★' : node.name.slice(0, 2).toUpperCase();
      (el.querySelector('.pnode__name') as HTMLElement).textContent = node.name;
      el.addEventListener('click', () => this.callbacks.onAllocate(node.id));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.callbacks.onRefund(node.id);
      });
      el.addEventListener('mouseenter', (e) => this.showTooltip(node, e));
      el.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
      this.tree.appendChild(el);
      this.nodeEls.set(node.id, el);
    }
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  open(): void {
    this.visible = true;
    this.root.classList.remove('hidden');
  }

  close(): void {
    this.visible = false;
    this.root.classList.add('hidden');
    this.tooltip.classList.add('hidden');
  }

  sync(state: GameState): void {
    if (!this.visible) return;
    const available = passivePointsAvailable(state);
    this.points.textContent = `${passivePointsSpentLabel(state)} · ${available} point${available === 1 ? '' : 's'} to spend`;

    for (const node of PASSIVE_NODES) {
      const el = this.nodeEls.get(node.id);
      if (!el) continue;
      const allocated = state.passives.allocated.includes(node.id);
      const canBuy = canAllocatePassive(state, node.id).ok;
      const canSell = canRefundPassive(state, node.id).ok;
      el.classList.toggle('pnode--allocated', allocated);
      el.classList.toggle('pnode--available', !allocated && canBuy);
      el.classList.toggle('pnode--refundable', allocated && canSell);
    }

    for (const line of this.tree.querySelectorAll('line')) {
      const [from, to] = (line.getAttribute('data-edge') ?? ':').split(':');
      const lit = state.passives.allocated.includes(from) && state.passives.allocated.includes(to);
      line.classList.toggle('passive-edge--lit', lit);
    }
  }

  private showTooltip(node: PassiveNode, event: MouseEvent): void {
    const effects = node.effects.map((e) => {
      const sign = PERCENT_STATS.has(e.stat) ? '%' : '';
      return `<li>+${e.value}${sign} ${EFFECT_LABELS[e.stat] ?? e.stat}</li>`;
    });
    const prereqs = node.prereqs
      .map((id) => PASSIVE_NODES.find((n) => n.id === id)?.name ?? id)
      .join(', ');
    this.tooltip.innerHTML = `
      <div class="tt-name" style="color:${CLUSTER_COLORS[node.cluster]}"></div>
      <div class="tt-meta">${node.keystone ? 'KEYSTONE · ' : ''}COSTS 1 POINT</div>
      <ul class="tt-affixes">${effects.join('') || '<li class="tt-empty">keystone of the path</li>'}</ul>
      <div class="tt-meta">Requires: ${prereqs}</div>`;
    this.tooltip.querySelector('.tt-name')!.textContent = node.name;
    this.tooltip.classList.remove('hidden');
    const x = Math.min(window.innerWidth - 260, event.clientX + 16);
    const y = Math.min(window.innerHeight - 160, event.clientY + 16);
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }
}

function passivePointsSpentLabel(state: GameState): string {
  return `${passivePointsTotal(state) - passivePointsAvailable(state)}/${passivePointsTotal(state)} spent`;
}
