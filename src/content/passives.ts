import type { AffixStat } from './affixes';

/**
 * Passive skill tree (slice 6): ~30 PoE-flavored nodes in three clusters,
 * laid out as a coordinate graph for the allocation UI. Nodes are data-only;
 * allocation rules and stat application live in systems/passives.ts and
 * systems/stats.ts. One point per level; `prereqs` must all be allocated
 * before a node unlocks, and refunding is blocked when it would orphan an
 * allocated node.
 */

export type PassiveCluster = 'offense' | 'defense' | 'utility';

export interface PassiveEffect {
  stat: AffixStat;
  value: number;
}

export interface PassiveNode {
  id: string;
  name: string;
  cluster: PassiveCluster;
  /** Tree layout coordinates (UI space; +x right, +y down). */
  x: number;
  y: number;
  /** Large end-of-branch node. */
  keystone?: boolean;
  effects: PassiveEffect[];
  /** Node ids that must all be allocated before this one unlocks. */
  prereqs: string[];
}

/** Pre-allocated anchor; the root of every path and never refundable. */
export const PASSIVE_ROOT = 'root';

export const PASSIVE_NODES: readonly PassiveNode[] = [
  { id: 'root', name: "The Exile's Path", cluster: 'utility', x: 0, y: 0, effects: [], prereqs: [] },

  // ---------- Offence (right): attack damage, spell damage, killing stats ----------
  { id: 'o1', name: 'Weapon Training', cluster: 'offense', x: 2.2, y: -0.2, effects: [{ stat: 'attackDamagePct', value: 4 }], prereqs: ['root'] },
  { id: 'o2', name: 'Arcane Focus', cluster: 'offense', x: 2.2, y: 1.8, effects: [{ stat: 'spellDamagePct', value: 4 }], prereqs: ['root'] },
  { id: 'o3', name: 'Precision', cluster: 'offense', x: 2.4, y: -2.4, effects: [{ stat: 'dexterity', value: 4 }], prereqs: ['root'] },
  { id: 'o4', name: 'Brutal Blows', cluster: 'offense', x: 4.8, y: -0.8, effects: [{ stat: 'attackDamagePct', value: 6 }], prereqs: ['o1'] },
  { id: 'o5', name: 'Sorcery', cluster: 'offense', x: 4.8, y: 2.4, effects: [{ stat: 'spellDamagePct', value: 6 }], prereqs: ['o2'] },
  { id: 'o6', name: 'Finesse', cluster: 'offense', x: 4.6, y: -3.0, effects: [{ stat: 'dexterity', value: 5 }], prereqs: ['o3'] },
  { id: 'o7', name: 'Merciless', cluster: 'offense', x: 7.2, y: -1.4, effects: [{ stat: 'attackDamagePct', value: 9 }], prereqs: ['o4'] },
  { id: 'o8', name: 'Executioner', cluster: 'offense', x: 7.2, y: 0.2, effects: [{ stat: 'strength', value: 5 }, { stat: 'attackDamagePct', value: 5 }], prereqs: ['o4', 'o6'] },
  { id: 'o9', name: 'Cataclysm', cluster: 'offense', x: 7.2, y: 3.0, effects: [{ stat: 'spellDamagePct', value: 9 }], prereqs: ['o5'] },
  { id: 'o10', name: 'Annihilation', cluster: 'offense', x: 9.6, y: -0.6, keystone: true, effects: [{ stat: 'attackDamagePct', value: 14 }, { stat: 'strength', value: 4 }], prereqs: ['o7', 'o8'] },
  { id: 'o11', name: 'Archmage', cluster: 'offense', x: 9.6, y: 3.0, keystone: true, effects: [{ stat: 'spellDamagePct', value: 14 }, { stat: 'intelligence', value: 4 }], prereqs: ['o9'] },

  // ---------- Defence (left): armour, life, evasion, energy shield ----------
  { id: 'd1', name: 'Tough Hide', cluster: 'defense', x: -2.2, y: -0.2, effects: [{ stat: 'armour', value: 20 }], prereqs: ['root'] },
  { id: 'd2', name: 'Lifeforce', cluster: 'defense', x: -2.2, y: 1.8, effects: [{ stat: 'maxHp', value: 18 }], prereqs: ['root'] },
  { id: 'd3', name: 'Reflexes', cluster: 'defense', x: -2.4, y: -2.4, effects: [{ stat: 'evasion', value: 20 }], prereqs: ['root'] },
  { id: 'd4', name: 'Fortified', cluster: 'defense', x: -4.8, y: -0.8, effects: [{ stat: 'armour', value: 35 }], prereqs: ['d1'] },
  { id: 'd5', name: 'Vitality', cluster: 'defense', x: -4.8, y: 2.4, effects: [{ stat: 'maxHp', value: 28 }], prereqs: ['d2'] },
  { id: 'd6', name: 'Elusive', cluster: 'defense', x: -4.6, y: -3.0, effects: [{ stat: 'evasion', value: 35 }], prereqs: ['d3'] },
  { id: 'd7', name: 'Warding', cluster: 'defense', x: -4.8, y: 4.2, effects: [{ stat: 'energyShield', value: 14 }], prereqs: ['d2'] },
  { id: 'd8', name: 'Adamant', cluster: 'defense', x: -7.2, y: -1.4, effects: [{ stat: 'strength', value: 5 }, { stat: 'armour', value: 30 }], prereqs: ['d4'] },
  { id: 'd9', name: 'Juggernaut', cluster: 'defense', x: -7.2, y: 0.2, effects: [{ stat: 'maxHp', value: 40 }, { stat: 'strength', value: 3 }], prereqs: ['d4', 'd5'] },
  { id: 'd10', name: 'Ghost Dance', cluster: 'defense', x: -7.2, y: -3.0, effects: [{ stat: 'dexterity', value: 5 }, { stat: 'evasion', value: 35 }], prereqs: ['d6'] },
  { id: 'd11', name: 'Aegis', cluster: 'defense', x: -7.2, y: 4.2, effects: [{ stat: 'intelligence', value: 3 }, { stat: 'energyShield', value: 18 }], prereqs: ['d7'] },
  { id: 'd12', name: 'Unbreakable', cluster: 'defense', x: -9.6, y: -0.6, keystone: true, effects: [{ stat: 'armour', value: 70 }, { stat: 'maxHp', value: 30 }], prereqs: ['d8', 'd9'] },
  { id: 'd13', name: 'Shimmering Veil', cluster: 'defense', x: -9.6, y: 3.6, keystone: true, effects: [{ stat: 'energyShield', value: 30 }, { stat: 'evasion', value: 30 }], prereqs: ['d11'] },

  // ---------- Utility (below): movement, mana, balanced attributes ----------
  { id: 'u1', name: 'Fleet Foot', cluster: 'utility', x: 0, y: 2.2, effects: [{ stat: 'moveSpeedPct', value: 3 }], prereqs: ['root'] },
  { id: 'u2', name: 'Mana Flow', cluster: 'utility', x: 0, y: 4.4, effects: [{ stat: 'maxMana', value: 15 }], prereqs: ['u1'] },
  { id: 'u3', name: 'Grace', cluster: 'utility', x: -2.2, y: 3.6, effects: [{ stat: 'dexterity', value: 5 }], prereqs: ['u1'] },
  { id: 'u4', name: 'Lorekeeper', cluster: 'utility', x: 2.2, y: 3.6, effects: [{ stat: 'intelligence', value: 5 }], prereqs: ['u1'] },
  { id: 'u5', name: 'Nimble Step', cluster: 'utility', x: -2.4, y: 5.8, effects: [{ stat: 'moveSpeedPct', value: 4 }, { stat: 'evasion', value: 20 }], prereqs: ['u2', 'u3'] },
  { id: 'u6', name: 'Deep Reserves', cluster: 'utility', x: 2.4, y: 5.8, effects: [{ stat: 'maxMana', value: 25 }, { stat: 'intelligence', value: 3 }], prereqs: ['u2', 'u4'] },
  { id: 'u7', name: 'Attunement', cluster: 'utility', x: 0, y: 6.6, effects: [{ stat: 'strength', value: 3 }, { stat: 'dexterity', value: 3 }, { stat: 'intelligence', value: 3 }], prereqs: ['u2'] },
  { id: 'u8', name: 'Pathfinder', cluster: 'utility', x: 0, y: 8.8, keystone: true, effects: [
    { stat: 'moveSpeedPct', value: 6 },
    { stat: 'strength', value: 3 },
    { stat: 'dexterity', value: 3 },
    { stat: 'intelligence', value: 3 },
  ], prereqs: ['u5', 'u6', 'u7'] },
] as const;

export function getPassive(id: string): PassiveNode | null {
  return PASSIVE_NODES.find((n) => n.id === id) ?? null;
}

/** Edge list for the tree UI: every node to each of its prerequisites. */
export function passiveEdges(): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const node of PASSIVE_NODES) {
    for (const prereq of node.prereqs) edges.push({ from: node.id, to: prereq });
  }
  return edges;
}
