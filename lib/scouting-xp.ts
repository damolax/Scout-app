import type { SupabaseClient } from '@supabase/supabase-js';

export async function awardScoutingXp(
  supabase: SupabaseClient<any, any, any>,
  input: {
    workspaceId: string;
    eventType: string;
    points: number;
    uniqueEventKey: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { data, error } = await supabase.rpc('award_scouting_xp_v1042', {
    target_workspace: input.workspaceId,
    target_event_type: input.eventType,
    target_points: Math.max(0, Math.floor(input.points || 0)),
    target_unique_event_key: input.uniqueEventKey,
    target_entity_type: input.entityType || null,
    target_entity_id: input.entityId || null,
    target_metadata: input.metadata || {},
  });
  if (error) throw error;
  return Number(data || 0);
}
