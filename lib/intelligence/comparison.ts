// @ts-nocheck
export function compareAnalyses(current, previous) {
  if (!previous) return null;
  const currentTech = new Set((current.technologies || []).map((item) => item.name));
  const previousTech = new Set((previous.technologies || []).map((item) => item.name));
  const currentPresent = new Set((current.expectedCapabilities || []).filter((item) => item.status === 'present').map((item) => item.id));
  const previousPresent = new Set((previous.expectedCapabilities || []).filter((item) => item.status === 'present').map((item) => item.id));
  return {
    previousScanId: previous.scanId,
    previousCreatedAt: previous.createdAt,
    readinessDelta: numberDelta(current.summary?.customerExperienceReadiness, previous.summary?.customerExperienceReadiness),
    confidenceDelta: numberDelta(current.summary?.confidence, previous.summary?.confidence),
    opportunityDelta: numberDelta(current.summary?.opportunityScore, previous.summary?.opportunityScore),
    technologiesAdded: [...currentTech].filter((name) => !previousTech.has(name)),
    technologiesRemoved: [...previousTech].filter((name) => !currentTech.has(name)),
    capabilitiesAdded: (current.expectedCapabilities || []).filter((item) => currentPresent.has(item.id) && !previousPresent.has(item.id)).map((item) => item.label),
    capabilitiesNoLongerDetected: (previous.expectedCapabilities || []).filter((item) => previousPresent.has(item.id) && !currentPresent.has(item.id)).map((item) => item.label),
  };
}

function numberDelta(current, previous) {
  const a = Number(current);
  const b = Number(previous);
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
}
