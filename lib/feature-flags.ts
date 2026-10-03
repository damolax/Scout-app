function enabled(name: string, fallback: boolean) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value);
}

export const featureFlags = {
  gmailSend: enabled('GMAIL_SEND_ENABLED', true),
  gmailReplySync: enabled('GMAIL_REPLY_SYNC_ENABLED', false),
  gmailNativeSignatureSync: enabled('GMAIL_NATIVE_SIGNATURE_SYNC_ENABLED', false),
  placementTests: enabled('PLACEMENT_TESTS_ENABLED', false),
  accountDeletion: enabled('ACCOUNT_DELETION_ENABLED', true),
};

export function publicFeatureFlags() {
  return {
    gmailSend: featureFlags.gmailSend,
    gmailReplySync: featureFlags.gmailReplySync,
    gmailNativeSignatureSync: featureFlags.gmailNativeSignatureSync,
    placementTests: featureFlags.placementTests,
  };
}
