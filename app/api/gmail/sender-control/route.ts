export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireWorkspaceAccess } from '@/lib/require-workspace-access';
import { createAppNotification } from '@/lib/notifications';
import { issuePolicy, recordSenderHealthEvent } from '@/lib/sender-health';

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function hardRestrictionActive(account: Record<string, any>) {
  if (!account.hard_restriction_active) return false;
  if (!account.hard_restricted_until) return true;
  return new Date(account.hard_restricted_until).getTime() > Date.now();
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json().catch(() => ({}));
    const workspaceId = String(input.workspace_id || input.workspaceId || '').trim();
    const accountId = String(input.gmail_account_id || input.accountId || '').trim();
    const action = String(input.action || '').trim().toLowerCase();
    if (!workspaceId || !accountId) throw new Error('workspace_id and gmail_account_id are required.');
    if (!['pause', 'resume', 'temporary_resume', 'set_override', 'clear_override'].includes(action)) throw new Error('Unknown sender control action.');
    await requireWorkspaceAccess(workspaceId);

    const supabase = createAdminClient();
    const { data: account, error } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', accountId)
      .single();
    if (error || !account) throw new Error(error?.message || 'Gmail account not found.');

    const automaticPause = Boolean(account.pause_kind && String(account.pause_kind) !== 'manual');
    const warning = String(account.paused_reason || account.health_reason || account.last_error || 'Scout paused this Gmail account for safety.');

    if (action === 'set_override') {
      if (hardRestrictionActive(account) || account.owner_override_locked || String(account.health_stage || '') === 'strict_disabled') {
        return NextResponse.json({ success: false, code: 'override_locked', error: 'This sender is strictly disabled. Owner overrides are locked until Scout automatically passes the recovery check.' }, { status: 423 });
      }
      const deploymentCap = Math.max(1, Math.min(250, Number(account.deployment_cap || 250)));
      const recommended = Math.max(0, Math.min(deploymentCap, Number(account.health_recommended_limit ?? account.health_cap ?? 250)));
      const requested = Math.max(1, Math.min(deploymentCap, Math.floor(Number(input.override_limit || input.limit || 0))));
      if (!Number.isFinite(requested) || requested <= recommended) {
        throw new Error(`Override must be above Scout's current ${recommended}/day recommendation and no higher than ${deploymentCap}/day.`);
      }
      const now = new Date();
      const until = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const reason = String(input.reason || `Owner accepted the risk and raised the temporary ceiling from ${recommended} to ${requested}/day.`);
      const { error: overrideError } = await supabase.from('gmail_accounts').update({
        owner_override_limit: requested,
        owner_override_active: true,
        owner_override_until: until,
        safety_override_active: true,
        safety_override_until: until,
        safety_override_warning: reason,
        safety_override_acknowledged_at: now.toISOString(),
        updated_at: now.toISOString(),
      }).eq('workspace_id', workspaceId).eq('id', accountId);
      if (overrideError) throw overrideError;
      await supabase.from('sender_limit_audit').insert({
        workspace_id: workspaceId,
        gmail_account_id: accountId,
        previous_stage: account.health_stage,
        new_stage: account.health_stage,
        previous_recommended_limit: recommended,
        new_recommended_limit: recommended,
        owner_daily_limit: Number(input.owner_daily_limit || account.daily_limit || requested),
        owner_override_limit: requested,
        action: 'owner_risk_override_started',
        reason,
        metrics: account.last_health_metrics || {},
        created_by: null,
        created_at: now.toISOString(),
      });
      await createAppNotification(supabase as any, {
        workspaceId,
        type: 'sender_owner_override',
        title: `Risk override active: ${account.email}`,
        message: `Scout recommends ${recommended}/day. The owner temporarily allowed up to ${requested}/day for 24 hours. Three harmful active sending days will strictly disable this sender.`,
        entityType: 'gmail_account',
        entityId: accountId,
        raw: { recommended, requested, expires_at: until },
      });
      return NextResponse.json({ success: true, overrideActive: true, recommended, overrideLimit: requested, expiresAt: until });
    }

    if (action === 'clear_override') {
      const now = new Date().toISOString();
      const { error: clearError } = await supabase.from('gmail_accounts').update({
        owner_override_limit: null,
        owner_override_active: false,
        owner_override_until: null,
        safety_override_active: false,
        safety_override_until: null,
        safety_override_warning: null,
        updated_at: now,
      }).eq('workspace_id', workspaceId).eq('id', accountId);
      if (clearError) throw clearError;
      await supabase.from('sender_limit_audit').insert({
        workspace_id: workspaceId,
        gmail_account_id: accountId,
        previous_stage: account.health_stage,
        new_stage: account.health_stage,
        previous_recommended_limit: Number(account.health_recommended_limit ?? account.health_cap ?? 250),
        new_recommended_limit: Number(account.health_recommended_limit ?? account.health_cap ?? 250),
        owner_daily_limit: Number(account.daily_limit || 250),
        owner_override_limit: null,
        action: 'owner_risk_override_cleared',
        reason: 'Owner ended the temporary risk override.',
        metrics: account.last_health_metrics || {},
        created_at: now,
      });
      return NextResponse.json({ success: true, overrideActive: false });
    }

    if (action === 'pause') {
      if (automaticPause && account.safety_override_active) {
        const now = new Date().toISOString();
        const { error: restoreError } = await supabase
          .from('gmail_accounts')
          .update({
            is_paused: true,
            status: account.pause_kind === 'provider_limit' ? 'limit_hit' : 'paused',
            health_stage: 'restricted',
            health_cap: 0,
            paused_reason: warning,
            health_reason: warning,
            safety_override_active: false,
            safety_override_until: null,
            safety_override_warning: null,
            updated_at: now,
          })
          .eq('workspace_id', workspaceId)
          .eq('id', accountId);
        if (restoreError) throw restoreError;
        await supabase.from('sender_health_events').insert({
          workspace_id: workspaceId,
          gmail_account_id: accountId,
          event_type: 'manual_pause',
          reason: `User ended the warned resume and restored the original safety pause: ${warning}`,
          raw: { restored_pause_kind: account.pause_kind, restored_paused_until: account.paused_until },
          created_at: now,
        });
        return NextResponse.json({ success: true, status: 'paused', restoredSafetyPause: true, warning });
      }

      await recordSenderHealthEvent(supabase as any, {
        workspaceId,
        gmailAccountId: accountId,
        eventType: 'manual_pause',
        reason: 'Paused manually by the user.',
      });
      return NextResponse.json({ success: true, status: 'paused' });
    }

    if (hardRestrictionActive(account)) {
      const until = account.hard_restricted_until || null;
      return NextResponse.json({
        success: false,
        code: 'hard_restriction_active',
        error: account.hard_restriction_reason || warning,
        hardRestrictedUntil: until,
        issueCount: Number(account.pause_issue_count || 3),
      }, { status: 423 });
    }

    if (action === 'resume') {
      if (automaticPause) {
        return NextResponse.json({
          success: false,
          code: 'warning_resume_required',
          error: warning,
          pauseKind: account.pause_kind,
          issueCount: Number(account.pause_issue_count || 1),
        }, { status: 409 });
      }
      await recordSenderHealthEvent(supabase as any, {
        workspaceId,
        gmailAccountId: accountId,
        eventType: 'manual_resume',
        reason: 'Manual pause ended by the user.',
      });
      return NextResponse.json({ success: true, status: 'connected' });
    }

    if (!automaticPause) {
      await recordSenderHealthEvent(supabase as any, {
        workspaceId,
        gmailAccountId: accountId,
        eventType: 'manual_resume',
        reason: 'Sender resumed.',
      });
      return NextResponse.json({ success: true, status: 'connected' });
    }

    await recordSenderHealthEvent(supabase as any, {
      workspaceId,
      gmailAccountId: accountId,
      eventType: 'temporary_resume',
      reason: warning,
      raw: {
        pause_kind: account.pause_kind,
        issue_count: Number(account.pause_issue_count || 1),
        original_paused_until: account.paused_until,
      },
    });

    const policy = issuePolicy(String(account.pause_kind || ''));
    const issueCount = Number(account.pause_issue_count || 1);
    const nextConsequence = issueCount >= 2
      ? `If the same issue happens again, Scout will hard-restrict this Gmail ${policy?.hardRestrictionMs === null ? 'until the recipient list is cleaned' : 'for the required safety period'}.`
      : 'If the same issue happens again, Scout will pause this Gmail and increase its issue count.';

    await createAppNotification(supabase as any, {
      workspaceId,
      type: 'sender_resume_warning',
      title: `Resumed with warning: ${account.email}`,
      message: `${warning} Scout resumed this Gmail at the Recovering limit of 50/day. ${nextConsequence}`,
      entityType: 'gmail_account',
      entityId: accountId,
      raw: {
        gmail_account_id: accountId,
        gmail_email: account.email,
        pause_kind: account.pause_kind,
        original_reason: warning,
        issue_count: issueCount,
      },
    });

    return NextResponse.json({
      success: true,
      status: 'connected',
      resumedWithWarning: true,
      warning,
      issueCount,
      currentCap: 50,
      nextConsequence,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: formatError(error) }, { status: 400 });
  }
}
