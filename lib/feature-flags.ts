function enabled(name: string, fallback: boolean) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value);
}

/**
 * Keep advanced Gmail capabilities in the codebase without requesting their
 * restricted OAuth scopes during the first Google verification submission.
 */
export const featureFlags = {
  gmailSend: enabled('GMAIL_SEND_ENABLED', true),
  gmailReplySync: enabled('GMAIL_REPLY_SYNC_ENABLED', false),
  gmailNativeSignatureSync: enabled('GMAIL_NATIVE_SIGNATURE_SYNC_ENABLED', false),
  deliverabilityCenter: enabled('DELIVERABILITY_CENTER_ENABLED', true),
  senderHealthEnforcement: enabled('SENDER_HEALTH_ENFORCEMENT_ENABLED', true),
  placementTests: enabled('PLACEMENT_TESTS_ENABLED', true),
  teamPagination: enabled('TEAM_PAGINATION_ENABLED', true),
  accountDeletion: enabled('ACCOUNT_DELETION_ENABLED', true),
};

export function publicFeatureFlags() {
  return {
    gmailSend: featureFlags.gmailSend,
    gmailReplySync: featureFlags.gmailReplySync,
    gmailNativeSignatureSync: featureFlags.gmailNativeSignatureSync,
    deliverabilityCenter: featureFlags.deliverabilityCenter,
    placementTests: featureFlags.placementTests,
  };
}
