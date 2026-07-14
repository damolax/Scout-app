#!/usr/bin/env bash
set -e
echo "Writing updated files..."

mkdir -p "app/(app)/dashboard"
cat > "app/(app)/dashboard/page.tsx" << 'CLAUDE_EOF_MARKER'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths } from 'date-fns'
import { computeTeam, isSmOrAbove, ATTENDANCE_RULES, statusRank, STATUS_ORDER } from '@/lib/types'
import { getEffectiveProfile } from '@/lib/view-as'
import DashboardClient from './DashboardClient'

export default async function DashboardPage({ searchParams }: { searchParams: { range?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: realProfile, error: profileError } = await supabase
    .from('profiles')
    .select('*, color_groups!profiles_color_group_id_fkey(*), sponsor:sponsor_id(id, full_name, member_id)')
    .eq('id', user.id)
    .single()

  // PGRST116 = no row found. Any other error is a real query/DB problem,
  // not "not yet approved" — don't mask it as pending-approval.
  if (profileError && profileError.code !== 'PGRST116') {
    console.error('DashboardPage profile query failed:', profileError)
    throw new Error(`Failed to load profile: ${profileError.message}`)
  }

  if (!realProfile) redirect('/pending-approval')
  if (!realProfile.approved && !realProfile.is_admin && !realProfile.is_director && !realProfile.is_co_admin) redirect('/pending-approval')

  // Admin "View As": nav/permissions always reflect the REAL logged-in admin;
  // only the personal stats below reflect whoever they're viewing as.
  const { profile, isViewingAs, viewAsName } = await getEffectiveProfile(supabase, realProfile)

  const range = searchParams.range ?? 'this_month'
  const now = new Date()
  const todayStr = format(now, 'yyyy-MM-dd')
  const thisMonthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const thisMonthEnd = format(endOfMonth(now), 'yyyy-MM-dd')
  const thisMonthStr = format(now, 'yyyy-MM')
  const isAdmin = profile.is_admin || profile.is_director || profile.is_co_admin
  const emAndBelowStatuses = STATUS_ORDER.filter(s => statusRank(s) <= statusRank('executive_manager'))
  const isEMOrBelow = emAndBelowStatuses.includes(profile.status)

  let rangeStart: string, rangeEnd: string
  switch (range) {
    case 'this_week':
      rangeStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
      rangeEnd = format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
      break
    case 'last_month':
      rangeStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
      rangeEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
      break
    case 'last_3_months':
      rangeStart = format(startOfMonth(subMonths(now, 3)), 'yyyy-MM-dd')
      rangeEnd = todayStr; break
    case 'last_6_months':
      rangeStart = format(startOfMonth(subMonths(now, 6)), 'yyyy-MM-dd')
      rangeEnd = todayStr; break
    case 'last_year':
      rangeStart = format(new Date(now.getFullYear() - 1, now.getMonth(), 1), 'yyyy-MM-dd')
      rangeEnd = todayStr; break
    default:
      rangeStart = thisMonthStart
      rangeEnd = thisMonthEnd
  }

  const [
    { data: myAttendance },
    { data: myEarnings },
    { count: myScoutingCount },
    { data: todayAttendance },
    { data: colorGroups },
    { data: allEarningsRaw },
    { count: newMembersCount },
    { data: groupEarningsRaw },
    { data: settings },
    { data: todayScouts },
    { data: groupScouts },
    { data: allProfilesForTeam },
    { data: punctualityRaw },
  ] = await Promise.all([
    supabase.from('attendance').select('date').eq('user_id', profile.id)
      .gte('date', rangeStart).lte('date', rangeEnd).not('sign_in_time', 'is', null),

    supabase.from('weekly_earnings').select('amount_usd').eq('user_id', profile.id)
      .gte('week_start', rangeStart).lte('week_start', rangeEnd),

    supabase.from('scouting_records').select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id).eq('status', 'contacted'),

    supabase.from('attendance')
      .select('user_id, profiles!inner(id, full_name, member_id, status, color_group_id, profile_picture, color_groups!profiles_color_group_id_fkey(name, hex_color))')
      .eq('date', todayStr).not('sign_in_time', 'is', null),

    supabase.from('color_groups').select('*').order('member_count', { ascending: false }),

    // ALL earnings for EM-and-below, all-time — used to compute BOTH Top
    // Earners (range-aware) and Consistent Earners (live monthly ranking),
    // with zero dependency on any manual/batch calculation step.
    supabase.from('weekly_earnings')
      .select('amount_usd, week_start, user_id, profiles!weekly_earnings_user_id_fkey(id, full_name, member_id, status, profile_picture, color_groups!profiles_color_group_id_fkey(name, hex_color))')
      .in('profiles.status', emAndBelowStatuses)
      .then(res => {
        if (res.error) console.error('Dashboard allEarnings query failed:', res.error)
        return res
      }),

    supabase.from('profiles').select('id', { count: 'exact', head: true })
      .eq('is_new_member', true).eq('new_member_month', thisMonthStr),

    // Group earnings this month
    supabase.from('weekly_earnings')
      .select('amount_usd, profiles!weekly_earnings_user_id_fkey(color_group_id, color_groups!profiles_color_group_id_fkey(name, hex_color))')
      .gte('week_start', thisMonthStart).lte('week_start', thisMonthEnd),

    supabase.from('app_settings').select('key, value'),

    // Top scouts today (by contacted count)
    supabase.from('scouting_records')
      .select('user_id, profiles!inner(id, full_name, member_id, profile_picture, color_groups!profiles_color_group_id_fkey(name, hex_color))')
      .eq('status', 'contacted')
      .gte('scouted_at', new Date(todayStr).toISOString())
      .lt('scouted_at', new Date(new Date(todayStr).getTime() + 864e5).toISOString()),

    // Scouting by color group (all time)
    supabase.from('scouting_records')
      .select('user_id, profiles!inner(color_group_id, color_groups!profiles_color_group_id_fkey(name, hex_color))')
      .eq('status', 'contacted'),

    // All approved profiles (for team-starts computation)
    supabase.from('profiles')
      .select('id, sponsor_id, status, is_new_member, new_member_month')
      .eq('approved', true),

    // Sign-in times in range, for Top Punctuality
    supabase.from('attendance')
      .select('user_id, date, sign_in_time, is_night_session, profiles!inner(id, full_name, member_id, profile_picture, color_groups!profiles_color_group_id_fkey(name, hex_color))')
      .gte('date', rangeStart).lte('date', rangeEnd)
      .not('sign_in_time', 'is', null)
      .eq('is_night_session', false),
  ])

  // Top Earners: sum of earnings within the SELECTED range (not hardcoded to this month)
  const earnerMap = new Map<string, any>()
  for (const e of (allEarningsRaw ?? [])) {
    if (e.week_start < rangeStart || e.week_start > rangeEnd) continue
    const p = (e as any).profiles
    if (!p) continue
    const ex = earnerMap.get(p.id) ?? { id: p.id, full_name: p.full_name, member_id: p.member_id, status: p.status, profile_picture: p.profile_picture, total: 0, group_name: p.color_groups?.name ?? '—', group_color: p.color_groups?.hex_color ?? '#999' }
    ex.total += Number(e.amount_usd)
    earnerMap.set(p.id, ex)
  }
  const topEarners = Array.from(earnerMap.values()).sort((a, b) => b.total - a.total).slice(0, 20)
  const myRank = topEarners.findIndex(e => e.id === profile.id) + 1

  // Group earnings
  const groupMap = new Map<string, any>()
  for (const e of (groupEarningsRaw ?? [])) {
    const p = (e as any).profiles
    if (!p?.color_groups) continue
    const ex = groupMap.get(p.color_groups.name) ?? { name: p.color_groups.name, hex_color: p.color_groups.hex_color, total: 0 }
    ex.total += Number(e.amount_usd)
    groupMap.set(p.color_groups.name, ex)
  }
  const groupEarnings = Array.from(groupMap.values()).sort((a, b) => b.total - a.total)

  // Top 3 scouts today
  const scoutMap = new Map<string, any>()
  for (const s of (todayScouts ?? [])) {
    const p = (s as any).profiles
    if (!p) continue
    const ex = scoutMap.get(p.id) ?? { id: p.id, full_name: p.full_name, member_id: p.member_id, profile_picture: p.profile_picture, group_name: p.color_groups?.name ?? '—', group_color: p.color_groups?.hex_color ?? '#999', count: 0 }
    ex.count++
    scoutMap.set(p.id, ex)
  }
  const topScoutsToday = Array.from(scoutMap.values()).sort((a, b) => b.count - a.count).slice(0, 3)

  // Scouting by color group
  const groupScoutMap = new Map<string, any>()
  for (const s of (groupScouts ?? [])) {
    const p = (s as any).profiles
    if (!p?.color_groups) continue
    const ex = groupScoutMap.get(p.color_groups.name) ?? { name: p.color_groups.name, hex_color: p.color_groups.hex_color, count: 0 }
    ex.count++
    groupScoutMap.set(p.color_groups.name, ex)
  }
  const groupScoutLeaderboard = Array.from(groupScoutMap.values()).sort((a, b) => b.count - a.count)

  // Consistent Earner points — computed LIVE from raw earnings, no manual
  // recalculation step needed ever. For each calendar month that has any
  // earnings, rank EM-and-below earners by that month's total and award
  // 1st=10pts, 2nd=9 ... 10th=1, 11th+=0 (same formula as before). Then sum
  // points only for months that fall within the selected date range, so a
  // "Last 3 Months" filter shows exactly the points earned in those months.
  const monthTotals = new Map<string, Map<string, number>>() // month_str -> user_id -> total
  const personById = new Map<string, any>()
  for (const e of (allEarningsRaw ?? [])) {
    const p = (e as any).profiles
    if (!p) continue
    personById.set(p.id, p)
    const monthStr = String(e.week_start).slice(0, 7) // YYYY-MM
    if (!monthTotals.has(monthStr)) monthTotals.set(monthStr, new Map())
    const userTotals = monthTotals.get(monthStr)!
    userTotals.set(p.id, (userTotals.get(p.id) ?? 0) + Number(e.amount_usd))
  }
  const pointsMap = new Map<string, any>()
  for (const [monthStr, userTotals] of monthTotals.entries()) {
    // Only count this month's points if the month falls within the selected range
    const monthDate = monthStr + '-01'
    if (monthDate < rangeStart.slice(0, 7) + '-01' || monthDate > rangeEnd) continue
    const ranked = Array.from(userTotals.entries()).sort((a, b) => b[1] - a[1])
    ranked.forEach(([userId, amount], i) => {
      const points = i < 10 ? 10 - i : 0
      if (points === 0) return
      const p = personById.get(userId)
      if (!p) return
      const ex = pointsMap.get(userId) ?? { id: userId, full_name: p.full_name, member_id: p.member_id, profile_picture: p.profile_picture, group_name: p.color_groups?.name ?? '—', group_color: p.color_groups?.hex_color ?? '#999', totalPoints: 0, months: 0 }
      ex.totalPoints += points
      ex.months++
      pointsMap.set(userId, ex)
    })
  }
  const consistentEarners = Array.from(pointsMap.values()).sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 20)

  // Top Punctuality: average minutes ahead of the sign-in window opening.
  // Higher = earlier/more punctual. Only counts day-session sign-ins.
  const punctualityMap = new Map<string, { id: string; full_name: string; member_id: string; profile_picture: string | null; group_name: string; group_color: string; totalMinutesEarly: number; days: number }>()
  for (const r of (punctualityRaw ?? [])) {
    const p = (r as any).profiles
    if (!p) continue
    const signIn = new Date(r.sign_in_time as string)
    const dayOfWeek = new Date(r.date + 'T00:00:00').getDay() // 0=Sun..5=Fri..6=Sat
    const rule = dayOfWeek === 5 ? ATTENDANCE_RULES.friday : ATTENDANCE_RULES.weekday
    const [openH, openM] = rule.sign_in_open.split(':').map(Number)
    const windowOpen = new Date(signIn)
    windowOpen.setHours(openH, openM, 0, 0)
    const minutesEarly = (windowOpen.getTime() - signIn.getTime()) / 60000
    const ex = punctualityMap.get(p.id) ?? {
      id: p.id, full_name: p.full_name, member_id: p.member_id, profile_picture: p.profile_picture,
      group_name: p.color_groups?.name ?? '—', group_color: p.color_groups?.hex_color ?? '#999',
      totalMinutesEarly: 0, days: 0,
    }
    ex.totalMinutesEarly += minutesEarly
    ex.days += 1
    punctualityMap.set(p.id, ex)
  }
  const topPunctuality = Array.from(punctualityMap.values())
    .map(e => ({ ...e, avgMinutesEarly: Math.round(e.totalMinutesEarly / e.days) }))
    .sort((a, b) => b.avgMinutesEarly - a.avgMinutesEarly)
    .slice(0, 20)

  // Most Consistent Attendance: ranked by number of days present in the
  // selected range, tie-broken by punctuality (earlier average = wins ties) —
  // same underlying dataset as Top Punctuality, just ranked differently.
  const topAttendance = Array.from(punctualityMap.values())
    .map(e => ({ ...e, avgMinutesEarly: Math.round(e.totalMinutesEarly / e.days) }))
    .sort((a, b) => b.days - a.days || b.avgMinutesEarly - a.avgMinutesEarly)
    .slice(0, 20)

  const myTotalPoints = pointsMap.get(profile.id)?.totalPoints ?? 0

  const settingsMap = Object.fromEntries((settings ?? []).map(s => [s.key, s.value]))

  // Members Start This Month: people you directly sponsored who just started this month
  const allTeamProfiles = allProfilesForTeam ?? []
  const memberStartsThisMonth = allTeamProfiles.filter(
    p => p.sponsor_id === profile.id && p.is_new_member && p.new_member_month === thisMonthStr
  ).length

  // Team Starts / SM Team Starts: everyone in your downline up to (not including) the
  // next Senior Manager boundary — same rule for members and Senior Managers alike.
  const isSMOrAbove = isSmOrAbove(profile.status)
  const myTeamIds = computeTeam(profile.id, 'senior_manager' as any, allTeamProfiles as any)
  const teamStartsThisMonth = allTeamProfiles.filter(
    p => myTeamIds.includes(p.id) && p.is_new_member && p.new_member_month === thisMonthStr
  ).length

  return (
    <DashboardClient
      profile={profile}
      range={range}
      myAttendanceDays={(myAttendance ?? []).length}
      myTotalEarnings={(myEarnings ?? []).reduce((s, e) => s + Number(e.amount_usd), 0)}
      myScoutingCount={myScoutingCount ?? 0}
      myRank={myRank}
      myTotalPoints={myTotalPoints}
      todayAttendanceCount={todayAttendance?.length ?? 0}
      todayAttendees={(todayAttendance ?? []).map((a: any) => a.profiles)}
      newMembersCount={newMembersCount ?? 0}
      topEarners={topEarners}
      groupEarnings={groupEarnings}
      colorGroups={colorGroups ?? []}
      isAdmin={isAdmin}
      isEMOrBelow={isEMOrBelow}
      settingsMap={settingsMap}
      topScoutsToday={topScoutsToday}
      groupScoutLeaderboard={groupScoutLeaderboard}
      consistentEarners={consistentEarners}
      topPunctuality={topPunctuality}
      memberStartsThisMonth={memberStartsThisMonth}
      teamStartsThisMonth={teamStartsThisMonth}
      isSMOrAbove={isSMOrAbove}
      isViewingAs={isViewingAs}
      viewAsName={viewAsName}
      topAttendance={topAttendance}
    />
  )
}
CLAUDE_EOF_MARKER

mkdir -p "app/(app)/money"
cat > "app/(app)/money/page.tsx" << 'CLAUDE_EOF_MARKER'
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
CLAUDE_EOF_MARKER

echo "Staging and committing..."
git add .
git commit -m "fix: disambiguate weekly_earnings-to-profiles FK (recorded_by vs user_id) causing silent leaderboard query failure"
git push origin main
echo "Done. Vercel should start redeploying now."
