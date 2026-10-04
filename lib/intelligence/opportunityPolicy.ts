// @ts-nocheck
const HIGH_RISK_INDUSTRIES = new Set(['health-wellness']);

export function evaluateAiOpportunity({ profile, detection, crawl }) {
  if (detection?.features?.ai_chat) {
    return { eligible: false, score: 0, reason: 'A public AI assistant signal is already present.', safeguards: [] };
  }

  const pages = crawl?.pages || [];
  const pageTypes = new Set(pages.map((page) => page.pageType));
  const combinedText = pages.map((page) => `${page.title || ''} ${page.metaDescription || ''} ${page.text || ''}`).join(' ').toLowerCase();
  const hasKnowledge = pageTypes.has('faq') || pageTypes.has('pricing') || pageTypes.has('service') || /faq|frequently asked|packages?|pricing|services?|how it works|what to expect/.test(combinedText);
  const hasAction = Boolean(detection?.forms?.length || detection?.features?.booking || detection?.features?.cart || detection?.features?.contact);
  const choiceComplexity = (profile?.expectedFeatures?.length || 0) >= 5 || /packages?|plans?|listings?|products?|courses?|treatments?|services?/.test(combinedText);
  const repeatedQuestionPotential = /availability|price|pricing|cost|delivery|shipping|returns?|booking|appointment|capacity|eligib|requirements?|included|compare/.test(combinedText);
  const enoughEvidence = pages.length >= 3;

  let score = 0;
  if (hasKnowledge) score += 28;
  if (hasAction) score += 24;
  if (choiceComplexity) score += 20;
  if (repeatedQuestionPotential) score += 18;
  if (enoughEvidence) score += 10;

  const highRisk = HIGH_RISK_INDUSTRIES.has(profile?.id);
  const eligible = highRisk
    ? score >= 82 && Boolean(detection?.features?.booking) && hasKnowledge && repeatedQuestionPotential
    : score >= 62;
  const safeguards = highRisk
    ? ['Approved informational content only', 'No diagnosis or professional decision-making', 'Visible human escalation', 'Privacy-safe data capture']
    : ['Approved knowledge only', 'Human escalation for uncertain requests', 'Conversation and conversion measurement'];

  return {
    eligible,
    score,
    reason: eligible
      ? `The website shows ${[hasKnowledge && 'answerable information', hasAction && 'a useful next action', choiceComplexity && 'meaningful customer choice', repeatedQuestionPotential && 'repeated-question potential'].filter(Boolean).join(', ')}.`
      : 'The public evidence does not yet show enough customer complexity, approved knowledge, or useful actions to justify an AI assistant.',
    safeguards,
    signals: { hasKnowledge, hasAction, choiceComplexity, repeatedQuestionPotential, enoughEvidence, highRisk },
  };
}

export function opportunitySuitability(item, context = {}) {
  const evidence = item.confidence >= 85 ? 25 : item.confidence >= 65 ? 18 : 8;
  const impact = item.score >= 85 ? 25 : item.score >= 72 ? 19 : 12;
  const relevance = item.type === 'industry_gap' ? 24 : item.type === 'ai_opportunity' ? 18 : 20;
  const feasibility = /visualizer|portal|platform/i.test(item.sellableService || '') ? 13 : 18;
  const competitor = item.competitorEvidence?.total
    ? item.competitorEvidence.present === 0 ? 8 : item.competitorEvidence.present < item.competitorEvidence.total ? 5 : 2
    : 4;
  const riskPenalty = context.highRisk && item.type === 'ai_opportunity' ? 8 : 0;
  const score = Math.max(0, Math.min(100, evidence + impact + relevance + feasibility + competitor - riskPenalty));
  return {
    score,
    band: score >= 80 ? 'Strong fit' : score >= 65 ? 'Good fit' : score >= 50 ? 'Review carefully' : 'Do not prioritize',
  };
}
