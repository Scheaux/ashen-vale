export type ItemSlot = 'weapon' | 'helm' | 'chest' | 'gloves' | 'boots' | 'amulet';
export type Rarity = 'normal' | 'magic' | 'rare' | 'unique';

export const ITEM_SLOTS: readonly ItemSlot[] = ['weapon', 'helm', 'chest', 'gloves', 'boots', 'amulet'];

export interface ItemBaseDef {
  id: string;
  name: string;
  slot: ItemSlot;
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
  { id: 'rusted-axe', name: 'Rusted Axe', slot: 'weapon' },
  { id: 'hunter-bow', name: 'Hunter Bow', slot: 'weapon' },
  { id: 'ember-staff', name: 'Ember Staff', slot: 'weapon' },
  { id: 'bone-cleaver', name: 'Bone Cleaver', slot: 'weapon' },
  { id: 'leather-hood', name: 'Leather Hood', slot: 'helm' },
  { id: 'iron-helm', name: 'Iron Helm', slot: 'helm' },
  { id: 'padded-vest', name: 'Padded Vest', slot: 'chest' },
  { id: 'bone-cuirass', name: 'Bone Cuirass', slot: 'chest' },
  { id: 'work-gloves', name: 'Work Gloves', slot: 'gloves' },
  { id: 'grip-wraps', name: 'Grip Wraps', slot: 'gloves' },
  { id: 'trail-boots', name: 'Trail Boots', slot: 'boots' },
  { id: 'iron-greaves', name: 'Iron Greaves', slot: 'boots' },
  { id: 'bone-charm', name: 'Bone Charm', slot: 'amulet' },
  { id: 'ember-pendant', name: 'Ember Pendant', slot: 'amulet' },
] as const;

export const UNIQUES: readonly UniqueDef[] = [
  {
    id: 'ashen-visage',
    name: 'Ashen Visage',
    slot: 'helm',
    lore: 'It remembers the fire that made it.',
    affixes: [
      { id: 'bulwark', value: 28 },
      { id: 'fortress', value: 6 },
      { id: 'insight', value: 4 },
    ],
  },
  {
    id: 'embergrasp',
    name: 'Embergrasp',
    slot: 'gloves',
    lore: 'The grip never cools.',
    affixes: [
      { id: 'warlord', value: 12 },
      { id: 'might', value: 5 },
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
