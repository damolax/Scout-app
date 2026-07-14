import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MoneyClient from './MoneyClient'
import { getEffectiveProfile } from '@/lib/view-as'
import { statusRank, STATUS_ORDER } from '@/lib/types'

export default async function MoneyPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: realProfile } = await supabase
    .from('profiles').select('*, color_groups!profiles_color_group_id_fkey(*)').eq('id', user.id).single()
  if (!realProfile) redirect('/login')

  const { profile } = await getEffectiveProfile(supabase, realProfile)

  const isAdmin = profile.is_admin || profile.is_director || profile.is_co_admin
  const emAndBelowStatuses = STATUS_ORDER.filter(s => statusRank(s) <= statusRank('executive_manager'))
  const isEmOrBelow = emAndBelowStatuses.includes(profile.status)

  const [
    { data: myWeeklyEarnings },
    { data: allEarnings },
    { data: colorGroups },
    { data: allProfiles },
  ] = await Promise.all([
    supabase.from('weekly_earnings')
      .select('*')
      .eq('user_id', profile.id)
      .order('week_start', { ascending: false }),

    isAdmin
      ? supabase.from('weekly_earnings')
          .select('*, profiles!weekly_earnings_user_id_fkey(id, full_name, member_id, status, color_group_id, color_groups!profiles_color_group_id_fkey(name, hex_color, code))')
          .order('week_start', { ascending: false })
      : { data: [] },

    supabase.from('color_groups').select('*').order('name'),

    // Everyone approved can have earnings recorded against them — not just EM and below.
    // (The "Executive Manager and below" restriction only applies to the public
    // Top Earners / Consistent Earners leaderboards on the dashboard.)
    isAdmin
      ? supabase.from('profiles')
          .select('id, full_name, member_id, status, color_groups!profiles_color_group_id_fkey(name)')
          .eq('approved', true)
          .order('full_name')
      : { data: [] },
  ])

  return (
    <MoneyClient
      profile={profile}
      isAdmin={isAdmin}
      isEmOrBelow={isEmOrBelow}
      myWeeklyEarnings={myWeeklyEarnings ?? []}
      allEarnings={(allEarnings ?? []) as any[]}
      colorGroups={colorGroups ?? []}
      allProfiles={(allProfiles ?? []) as any[]}
    />
  )
}
