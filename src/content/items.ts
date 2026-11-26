export type ItemSlot = 'weapon' | 'helm' | 'chest' | 'gloves' | 'boots' | 'amulet';
export type Rarity = 'normal' | 'magic' | 'rare' | 'unique';

export const ITEM_SLOTS: readonly ItemSlot[] = ['weapon', 'helm', 'chest', 'gloves', 'boots', 'amulet'];

export interface ItemBaseDef {
  id: string;
  name: string;
  slot: ItemSlot;
  /** Innate stat rolled with the base, before affixes and quality. */
  implicit?: { id: string; min: number; max: number; perLevel: number };
}

export interface UniqueDef {
  id: string;
  name: string;
  slot: ItemSlot;
  lore: string;
  /** Fixed affix values for uniques. */
  affixes: Array<{ id: string; value: number }>;
}

export const ITEM_BASES: readonly ItemBaseDef[] = [
  { id: 'rusted-axe', name: 'Rusted Axe', slot: 'weapon', implicit: { id: 'attack-damage', min: 1, max: 2, perLevel: 0.2 } },
  { id: 'hunter-bow', name: 'Hunter Bow', slot: 'weapon', implicit: { id: 'attack-damage', min: 1, max: 2, perLevel: 0.2 } },
  { id: 'ember-staff', name: 'Ember Staff', slot: 'weapon', implicit: { id: 'spell-damage', min: 1, max: 2, perLevel: 0.2 } },
  { id: 'bone-cleaver', name: 'Bone Cleaver', slot: 'weapon', implicit: { id: 'attack-damage', min: 2, max: 3, perLevel: 0.3 } },
  { id: 'iron-glaive', name: 'Iron Glaive', slot: 'weapon', implicit: { id: 'attack-damage', min: 2, max: 4, perLevel: 0.35 } },
  { id: 'runed-staff', name: 'Runed Staff', slot: 'weapon', implicit: { id: 'spell-damage', min: 2, max: 4, perLevel: 0.35 } },
  { id: 'leather-hood', name: 'Leather Hood', slot: 'helm', implicit: { id: 'evasion', min: 5, max: 10, perLevel: 1 } },
  { id: 'iron-helm', name: 'Iron Helm', slot: 'helm', implicit: { id: 'armour', min: 10, max: 18, perLevel: 1.5 } },
  { id: 'shrouded-hood', name: 'Shrouded Hood', slot: 'helm', implicit: { id: 'energy-shield', min: 6, max: 12, perLevel: 1 } },
  { id: 'padded-vest', name: 'Padded Vest', slot: 'chest', implicit: { id: 'armour', min: 12, max: 20, perLevel: 1.5 } },
  { id: 'bone-cuirass', name: 'Bone Cuirass', slot: 'chest', implicit: { id: 'armour', min: 18, max: 28, perLevel: 2 } },
  { id: 'scout-coat', name: 'Scout Coat', slot: 'chest', implicit: { id: 'evasion', min: 12, max: 20, perLevel: 1.5 } },
  { id: 'work-gloves', name: 'Work Gloves', slot: 'gloves', implicit: { id: 'armour', min: 4, max: 8, perLevel: 0.8 } },
  { id: 'grip-wraps', name: 'Grip Wraps', slot: 'gloves', implicit: { id: 'evasion', min: 4, max: 8, perLevel: 0.8 } },
  { id: 'trail-boots', name: 'Trail Boots', slot: 'boots', implicit: { id: 'increased-movement-speed', min: 1, max: 2, perLevel: 0.1 } },
  { id: 'iron-greaves', name: 'Iron Greaves', slot: 'boots', implicit: { id: 'armour', min: 8, max: 14, perLevel: 1 } },
  { id: 'wind-step-boots', name: 'Wind-Step Boots', slot: 'boots', implicit: { id: 'evasion', min: 8, max: 14, perLevel: 1 } },
  { id: 'bone-charm', name: 'Bone Charm', slot: 'amulet', implicit: { id: 'life', min: 5, max: 10, perLevel: 0.8 } },
  { id: 'ember-pendant', name: 'Ember Pendant', slot: 'amulet', implicit: { id: 'mana', min: 5, max: 10, perLevel: 0.8 } },
  { id: 'jade-torc', name: 'Jade Torc', slot: 'amulet', implicit: { id: 'dexterity', min: 2, max: 4, perLevel: 0.3 } },
] as const;

export const UNIQUES: readonly UniqueDef[] = [
  {
    id: 'ashen-visage',
    name: 'Ashen Visage',
    slot: 'helm',
    lore: 'It remembers the fire that made it.',
    affixes: [
      { id: 'life-greater', value: 28 },
      { id: 'armour-greater', value: 60 },
      { id: 'intelligence', value: 6 },
    ],
  },
  {
    id: 'embergrasp',
    name: 'Embergrasp',
    slot: 'gloves',
    lore: 'The grip never cools.',
    affixes: [
      { id: 'increased-attack-damage-greater', value: 12 },
      { id: 'strength', value: 5 },
    ],
  },
  {
    id: 'cinderbrand',
    name: 'Cinderbrand',
    slot: 'weapon',
    lore: 'The blade remembers every fire it started.',
    affixes: [
      { id: 'spell-damage-greater', value: 12 },
      { id: 'increased-spell-damage-greater', value: 18 },
      { id: 'intelligence', value: 8 },
      { id: 'mana', value: 20 },
    ],
  },
  {
    id: 'wardens-bulwark',
    name: "Warden's Bulwark",
    slot: 'chest',
    lore: 'A wall of ash and iron that refused to fall.',
    affixes: [
      { id: 'armour-greater', value: 90 },
      { id: 'increased-armour', value: 20 },
      { id: 'life-greater', value: 40 },
      { id: 'strength', value: 8 },
    ],
  },
  {
    id: 'windstep',
    name: 'Windstep',
    slot: 'boots',
    lore: 'Leave no print where the moor can find you.',
    affixes: [
      { id: 'evasion-greater', value: 80 },
      { id: 'increased-evasion', value: 20 },
      { id: 'dexterity', value: 8 },
      { id: 'increased-movement-speed', value: 6 },
    ],
  },
] as const;

export function getItemBase(id: string): ItemBaseDef {
  const def = ITEM_BASES.find((b) => b.id === id);
  if (!def) throw new Error(`Unknown item base: ${id}`);
  return def;
}

export function getUnique(id: string): UniqueDef {
  const def = UNIQUES.find((u) => u.id === id);
  if (!def) throw new Error(`Unknown unique: ${id}`);
  return def;
}

export const RARITY_COLORS: Record<Rarity, { hex: number; cssColor: string }> = {
  normal: { hex: 0xb8b8b8, cssColor: '#b8b8b8' },
  magic: { hex: 0x6aa0ff, cssColor: '#6aa0ff' },
  rare: { hex: 0xffd24d, cssColor: '#ffd24d' },
  unique: { hex: 0xff8a3c, cssColor: '#ff8a3c' },
};
