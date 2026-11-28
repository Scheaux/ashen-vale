import type { EnemyId, ZoneId } from './types';

/**
 * Authored zone identity and progression shape. `campCount` is the number of
 * save slots a zone always stores; `activeCamps` is how many camps the 5.0
 * build actually plays in that zone.
 */
export type BossTrigger = 'camps' | 'arena';

export interface ZoneDef {
  id: ZoneId;
  name: string;
  chapter: string;
  seed: number;
  /** Camp slots persisted for this zone (always 3 in 5.0). */
  campCount: number;
  /** Camps active in the current chapter; later chapters add more. */
  activeCamps: number;
  bossId: EnemyId | null;
  bossTrigger: BossTrigger;
  final: boolean;
}

export const ZONE_DEFS: Record<ZoneId, ZoneDef> = {
  'ashen-moor': {
    id: 'ashen-moor',
    name: 'The Ashen Moor',
    chapter: 'I',
    seed: 20261122,
    campCount: 3,
    activeCamps: 3,
    bossId: 'ashen-warden',
    bossTrigger: 'camps',
    final: false,
  },
  'drowned-ossuary': {
    id: 'drowned-ossuary',
    name: 'The Drowned Ossuary',
    chapter: 'II',
    seed: 20261123,
    campCount: 3,
    activeCamps: 1,
    bossId: null,
    bossTrigger: 'arena',
    final: true,
  },
};

export const ZONE_IDS: readonly ZoneId[] = ['ashen-moor', 'drowned-ossuary'];

export function getZoneDef(id: ZoneId): ZoneDef {
  return ZONE_DEFS[id];
}

export function campCountForZone(id: ZoneId): number {
  return ZONE_DEFS[id].campCount;
}

export function activeCampsForZone(id: ZoneId): number {
  return ZONE_DEFS[id].activeCamps;
}
