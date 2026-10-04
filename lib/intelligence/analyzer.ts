// @ts-nocheck
import { classifyIndustry } from './industryProfiles';
import { detectWebsite } from './detection';
import { evaluateAiOpportunity, opportunitySuitability } from './opportunityPolicy';

const importanceWeights = { critical: 94, high: 80, medium: 65, low: 48 };

export function analyzeCrawl(crawl, input = {}, extras = {}, options = {}) {
  const detection = extras.detection || detectWebsite(crawl);
  const classificationText = crawl.pages.map((page) => `${page.title} ${page.metaDescription} ${page.headings.map((heading) => heading.text).join(' ')} ${page.text.slice(0, 35000)}`).join('\n');
  const classification = classifyIndustry(classificationText, {
    forcedIndustryId: options.forcedIndustryId,
    forcedSubindustryName: options.forcedSubindustryName,
  });
  const profile = classification.profile;
  const business = inferBusiness(crawl, classification, input);

  const expected = profile.expectedFeatures.map(([id, label, importance]) => {
    const present = resolveFeature(id, detection.features);
    const confidence = present ? featureConfidence(id, detection) : absenceConfidence(id, crawl, detection);
    const evidence = featureEvidence(id, crawl, detection, present);
    return {
      id,
      label,
      importance,
      status: present ? 'present' : confidence >= 70 ? 'not_detected' : 'unconfirmed',
      confidence,
      confidenceBand: confidenceBand(confidence),
      evidence: evidence.text,
      sourceUrl: evidence.sourceUrl,
      evidenceType: present ? 'observed' : confidence >= 70 ? 'not_detected_publicly' : 'unconfirmed',
    };
  });

  const strengths = withIds(buildStrengths(crawl, detection, expected, business), 'strength');
  const gaps = expected.filter((item) => item.status !== 'present').map((item) => buildGap(item, profile, business));
  const delightOpportunities = buildDelightOpportunities(profile, detection, business, gaps, crawl);
  const technicalOpportunities = buildTechnicalOpportunities(crawl, detection, business, extras.pageSpeed || null);
  let opportunities = withIds([...gaps, ...delightOpportunities, ...technicalOpportunities]
    .sort((a, b) => b.score - a.score)
    .filter((item, index, array) => array.findIndex((candidate) => candidate.title.toLowerCase() === item.title.toLowerCase()) === index)
    .slice(0, 20), 'opportunity');

  const competitorComparison = buildCompetitorComparison(opportunities, extras.competitors || []);
  opportunities = opportunities.map((item) => {
    const enriched = {
      ...item,
      confidenceBand: confidenceBand(item.confidence),
      competitorEvidence: competitorComparison.byOpportunity[item.id] || null,
    };
    const suitability = opportunitySuitability(enriched, { highRisk: profile.id === 'health-wellness' });
    return {
      ...enriched,
      suitability,
      includeInOwnerReport: item.confidence >= 70 && item.score >= 68 && suitability.score >= 65,
    };
  });

  const serviceRecommendations = buildServiceRecommendations(opportunities);
  const servicePackages = buildServicePackages(opportunities, profile);
  const searchOpportunityDirections = withIds(buildKeywordOpportunities(profile, classification, crawl, input), 'search-direction');
  const customerJourney = buildCustomerJourney(profile, expected, detection);
  const readiness = calculateReadiness(expected, detection);
  const opportunityScore = calculateOpportunityScore(opportunities, readiness);
  const prospectPriority = calculateProspectPriority(crawl, detection, opportunityScore);
  const outreach = buildOutreach(business, strengths, opportunities, classification);
  const discoveryQuestions = buildDiscoveryQuestions(profile, detection, opportunities);

  return {
    version: '1.3.0',
    scanId: options.scanId || crypto.randomUUID(),
    createdAt: options.createdAt || new Date().toISOString(),
    input: {
      website: crawl.finalUrl,
      targetCountry: input.targetCountry || '',
      targetCity: input.targetCity || '',
      prospectName: input.prospectName || '',
      agencyName: input.agencyName || 'Scout Opportunity Intelligence',
      competitorUrls: input.competitorUrls || [],
    },
    business,
    classification: {
      industry: profile.name,
      industryId: profile.id,
      confidence: classification.confidence,
      confidenceBand: confidenceBand(classification.confidence),
      confidenceSource: classification.confidenceSource || 'automatic',
      evidence: classification.evidence,
      subindustry: classification.subindustry,
      alternatives: classification.alternatives,
    },
    summary: {
      opportunityScore,
      customerExperienceReadiness: readiness,
      prospectPriority,
      pagesAnalyzed: crawl.pages.length,
      technologiesDetected: detection.technologies.length,
      strongestOpportunity: opportunities[0]?.title || 'Improve the customer journey',
      confidence: overallConfidence(classification, expected, crawl),
      evidenceDiscipline: 100,
    },
    customerGoals: profile.customerGoals,
    customerJourney,
    strengths,
    expectedCapabilities: expected,
    opportunities,
    serviceRecommendations,
    servicePackages,
    searchOpportunityDirections,
    keywordOpportunities: searchOpportunityDirections,
    technologies: detection.technologies,
    tracking: detection.tracking,
    forms: detection.forms,
    accessibility: detection.accessibility,
    seo: detection.seo,
    performance: detection.performance,
    externalMeasurements: { pageSpeed: extras.pageSpeed || null },
    competitorComparison,
    scanHealth: {
      status: (crawl.failures || []).length ? 'partial' : 'complete',
      failedPages: (crawl.failures || []).length,
      warnings: (crawl.failures || []).map((item) => `${item.url}: ${item.error}`).slice(0, 8),
    },
    crawlCoverage: {
      robotsFound: crawl.robotsFound,
      sitemapUrlCount: crawl.sitemapUrlCount,
      pageTypes: [...new Set(crawl.pages.map((page) => page.pageType).filter(Boolean))],
    },
    pages: crawl.pages.map((page) => ({
      url: page.url,
      pageType: page.pageType,
      title: page.title,
      metaDescription: page.metaDescription,
      h1: page.headings.find((heading) => heading.level === 1)?.text || '',
      responseMs: page.responseMs,
      htmlKb: Math.round(page.htmlBytes / 1024),
      formCount: page.forms.length,
    })),
    outreach,
    discoveryQuestions,
    review: options.review || {
      status: 'needs_review',
      ownerOpportunityIds: opportunities.filter((item) => item.includeInOwnerReport).slice(0, 5).map((item) => item.id),
      notes: '',
      confirmedIndustryId: profile.id,
      confirmedSubindustryName: classification.subindustry?.name || '',
      acknowledgePartial: false,
      reviewedAt: null,
    },
    limitations: [
      'The analysis uses public front-end evidence and cannot see private CRM, Airtable, spreadsheet or server-side workflows.',
      'A technology marked “not detected” may still be used internally or loaded only after login, consent or a specific action.',
      'Keyword opportunities are relevance and intent hypotheses in the free version; they are not verified search-volume or ranking data.',
      'Revenue, traffic, client and project figures are not estimated unless a verified data source is connected.',
      'Competitor prevalence is based only on the competitor URLs supplied for this scan and is not an industry-wide market statistic.',
    ],
  };
}

function inferBusiness(crawl, classification, input) {
  const home = crawl.pages[0];
  const h1 = home.headings.find((heading) => heading.level === 1)?.text || '';
  const titleName = (home.title || '').split(/[|–—-]/)[0].trim();
  const hostname = new URL(crawl.finalUrl).hostname.replace(/^www\./, '');
  const name = input.prospectName || (titleName.length >= 2 && titleName.length <= 60 ? titleName : hostname.split('.')[0].replace(/[-_]/g, ' '));
  const primaryOffer = h1 || home.metaDescription || classification.profile.name;
  return {
    name: titleCase(name),
    hostname,
    primaryOffer: primaryOffer.slice(0, 220),
    businessModel: inferBusinessModel(classification.profile.id, home.text.toLowerCase()),
    targetMarket: [input.targetCity, input.targetCountry].filter(Boolean).join(', ') || 'Not specified',
  };
}

function inferBusinessModel(industryId, text) {
  if (industryId === 'ecommerce' || text.includes('add to cart')) return 'Online sales';
  if (['real-estate', 'professional-services', 'construction-home-services', 'health-wellness', 'beauty-personal-care'].includes(industryId)) return 'Lead generation and appointments';
  if (['weddings-events', 'restaurants-hospitality', 'travel-tourism', 'automotive'].includes(industryId)) return 'Bookings, enquiries and transactions';
  if (industryId === 'education-training') return 'Applications, enrolment and consultations';
  if (industryId === 'saas-technology') return 'Trial, demo or subscription acquisition';
  return 'Lead generation';
}

function resolveFeature(id, features) {
  const map = {
    product_search: features.search && features.filters,
    abandoned_cart: features.cart && features.newsletter,
    order_tracking: features.order_tracking,
    property_search: features.property_search,
    viewing_booking: features.viewing_booking || features.booking,
    availability: features.availability,
    booking: features.booking,
    package_comparison: features.package_comparison,
    menu_catalog: features.menu_catalog,
    location_info: features.location_info,
    dietary_info: features.dietary_info,
    practitioner_profiles: features.practitioner_profiles,
    staff_profiles: features.staff_profiles,
    quote_form: features.quote_form,
    service_area: features.service_area,
    portfolio: features.portfolio,
    project_process: features.project_process,
    team_profiles: features.team_profiles,
    lead_qualification: features.lead_qualification,
    course_catalog: features.course_catalog,
    programme_comparison: features.programme_comparison,
    inventory_search: features.inventory_search,
    product_demo: features.product_demo,
    use_cases: features.use_cases,
    itinerary: features.itinerary,
    practical_info: features.practical_info,
  };
  return id in map ? Boolean(map[id]) : Boolean(features[id]);
}

function featureConfidence(id, detection) {
  if (['reviews', 'booking', 'chat', 'ai_chat', 'shipping_returns', 'privacy'].includes(id)) return 92;
  if (['lead_qualification', 'conversion_tracking', 'abandoned_cart'].includes(id)) return 72;
  return 84;
}

function absenceConfidence(id, crawl, detection) {
  const pageCountFactor = Math.min(crawl.pages.length * 5, 30);
  const base = 38 + pageCountFactor;
  const hardToSee = ['abandoned_cart', 'order_tracking', 'saved_items', 'conversion_tracking', 'recommendations'];
  return Math.min(88, hardToSee.includes(id) ? base - 12 : base + (detection.forms.length ? 5 : 0));
}

function featureEvidence(id, crawl, detection, present) {
  if (present) {
    const page = crawl.pages.find((candidate) => `${candidate.text} ${candidate.buttons.join(' ')}`.toLowerCase().includes(readableNeedle(id)));
    return page
      ? { text: `A public signal was found on the ${page.pageType || 'website'} page.`, sourceUrl: page.url }
      : { text: 'Multiple public website signals were detected.', sourceUrl: crawl.finalUrl };
  }
  return {
    text: `No reliable public signal was found across ${crawl.pages.length} representative page${crawl.pages.length === 1 ? '' : 's'}.`,
    sourceUrl: crawl.finalUrl,
  };
}

function readableNeedle(id) {
  return id.replace(/_/g, ' ').split(' ')[0];
}

function buildStrengths(crawl, detection, expected, business) {
  const strengths = [];
  expected.filter((item) => item.status === 'present').slice(0, 6).forEach((item) => strengths.push({
    title: item.label,
    evidence: item.evidence,
    meaning: `This supports a smoother customer journey for ${business.businessModel.toLowerCase()}.`,
    confidence: item.confidence,
  }));
  if (detection.tracking.analytics) strengths.push({ title: 'Measurement foundation detected', evidence: 'An analytics or behavior-measurement technology was detected.', meaning: 'The business has at least part of the foundation needed to measure improvements.', confidence: 88 });
  if (detection.tracking.advertising) strengths.push({ title: 'Advertising readiness detected', evidence: 'An advertising pixel was detected.', meaning: 'The website can potentially support remarketing and campaign optimization.', confidence: 88 });
  if (detection.forms.length) strengths.push({ title: 'A customer contact path exists', evidence: `${detection.forms.length} form${detection.forms.length === 1 ? '' : 's'} were found.`, meaning: 'Visitors have a way to take action, even if the form may still be improved.', confidence: 90 });
  if (!strengths.length) strengths.push({ title: 'A public website foundation exists', evidence: `${crawl.pages.length} public page${crawl.pages.length === 1 ? '' : 's'} were analyzed.`, meaning: 'The business has a base that can be improved rather than starting from nothing.', confidence: 75 });
  return strengths.slice(0, 8);
}

function buildGap(item, profile, business) {
  const score = importanceWeights[item.importance] || 65;
  return {
    type: 'industry_gap',
    featureId: item.id,
    title: item.label,
    score,
    confidence: item.confidence,
    customerNeed: customerNeedFor(item.id, profile),
    observed: item.evidence,
    sourceUrl: item.sourceUrl,
    evidenceType: item.evidenceType,
    implication: `Customers may experience unnecessary friction when trying to ${goalVerb(profile.customerGoals)}.`,
    recommendation: recommendationForFeature(item.id, item.label),
    sellableService: serviceForFeature(item.id, item.label),
    businessBenefit: benefitForFeature(item.id),
    novelty: item.importance === 'medium' ? 'Differentiating' : 'Expected in strong industry websites',
    ownerWording: `${item.label} was not reliably detected. Adding or improving it could make the customer journey clearer and easier.`,
  };
}

function buildDelightOpportunities(profile, detection, business, gaps, crawl) {
  const existingTitles = new Set(gaps.map((item) => item.title.toLowerCase()));
  const aiPolicy = evaluateAiOpportunity({ profile, detection, crawl });
  let items = profile.delight.map(([title, customerValue, service], index) => {
    const featureId = delightFeatureId(title);
    const isAi = featureId === 'ai_chat';
    const alreadyPresent = delightAlreadyPresent(title, detection.features);
    if (isAi && !aiPolicy.eligible) return null;
    const base = 84 - index * 3;
    return {
      type: isAi ? 'ai_opportunity' : 'customer_delight',
      featureId,
      title,
      score: alreadyPresent ? 45 : isAi ? Math.min(91, 72 + Math.round(aiPolicy.score * 0.2)) : base,
      confidence: alreadyPresent ? 68 : isAi ? Math.min(88, 66 + Math.round(aiPolicy.score * 0.22)) : 72,
      customerNeed: customerValue,
      observed: alreadyPresent
        ? 'A related capability appears to be present, but the experience may still be expandable.'
        : isAi
          ? `No clearly identifiable AI assistant was detected. Suitability evidence: ${aiPolicy.reason}`
          : 'No clear public evidence of this experience was found.',
      sourceUrl: business.hostname ? `https://${business.hostname}` : '',
      evidenceType: alreadyPresent ? 'inferred_present' : isAi ? 'evidence_based_hypothesis' : 'opportunity_hypothesis',
      implication: `This could give ${business.name} a more memorable and useful customer experience than a standard brochure website.`,
      recommendation: isAi
        ? `${customerValue} Use approved knowledge, clear boundaries and human escalation.${aiPolicy.safeguards.length ? ` Safeguards: ${aiPolicy.safeguards.join('; ')}.` : ''}`
        : customerValue,
      sellableService: service,
      businessBenefit: 'More confident visitors, better-qualified actions and stronger differentiation.',
      novelty: isAi ? 'Conditional AI opportunity' : index < 2 ? 'Underused high-potential feature' : 'Customer delight feature',
      ownerWording: `${title} may be valuable because it offers this customer benefit: ${customerValue}`,
      eligibility: isAi ? aiPolicy : null,
    };
  }).filter(Boolean).filter((item) => !existingTitles.has(item.title.toLowerCase()));

  // Do not insert a generic chatbot when the industry profile has no eligible AI service.
  return items;
}

function buildTechnicalOpportunities(crawl, detection, business, pageSpeed) {
  const items = [];
  if (!detection.tracking.analytics) items.push(opportunity('Measurement and behavior tracking foundation', 88, 'No standard analytics or behavior-measurement system was publicly detected.', 'Visitors and marketing activity cannot be improved confidently without measurement.', 'Analytics, event tracking and reporting setup', 'Reliable evidence for future decisions.'));
  if (!detection.tracking.advertising) items.push(opportunity('Remarketing and campaign measurement readiness', 73, 'No common advertising pixel was publicly detected.', 'Paid campaigns may have limited feedback and returning visitors may not be nurtured.', 'Advertising pixel and conversion-event setup', 'Better campaign learning and remarketing capability.'));
  if (!detection.tracking.conversionSignals && detection.forms.length) items.push(opportunity('Form and conversion-event tracking', 86, 'Forms were found, but reliable conversion-event signals were not confirmed.', 'The business may know that traffic exists without knowing which actions produce leads.', 'Conversion tracking implementation and dashboard', 'Clear attribution for enquiries and bookings.'));
  if (detection.accessibility.score < 75) items.push(opportunity('Accessibility and form usability improvements', 76, `Automated front-end checks produced an accessibility readiness score of ${detection.accessibility.score}/100.`, 'Some visitors may have difficulty perceiving content or completing actions.', 'Accessibility and usability improvement sprint', 'A more inclusive and less frustrating experience.'));
  if (detection.seo.missingDescriptions > 0 || detection.seo.missingH1 > 0) items.push(opportunity('Search presentation and page-structure cleanup', 67, `${detection.seo.missingDescriptions} page(s) lacked a meta description and ${detection.seo.missingH1} page(s) lacked a clear H1 in the analyzed sample.`, 'Pages may communicate their purpose less clearly to search engines and first-time visitors.', 'On-page structure and search-intent optimization', 'Clearer page meaning and stronger search readiness.'));
  if (detection.performance.averageResponseMs > 2200) items.push(opportunity('Server response and page-delivery improvement', 72, `Average server response across the sample was approximately ${detection.performance.averageResponseMs} ms.`, 'Slow initial responses can reduce patience before the page is usable.', 'Performance diagnosis and optimization', 'Faster access and reduced abandonment.'));
  if (pageSpeed?.scores?.performance != null && pageSpeed.scores.performance < 70) items.push(opportunity('Mobile performance improvement', 82, `Google PageSpeed Insights returned a mobile performance score of ${pageSpeed.scores.performance}/100.`, 'A slow or unstable mobile experience can reduce completed enquiries and purchases.', 'Mobile performance optimization sprint', 'A faster and more dependable first visit.'));
  if (pageSpeed?.scores?.accessibility != null && pageSpeed.scores.accessibility < 85) items.push(opportunity('Measured accessibility improvements', 78, `Google PageSpeed Insights returned an accessibility score of ${pageSpeed.scores.accessibility}/100.`, 'Some visitors may face avoidable barriers when reading content or completing actions.', 'Accessibility remediation and QA', 'A more inclusive and less frustrating customer journey.'));
  return items;
}

function opportunity(title, score, observed, implication, service, benefit) {
  return {
    type: 'technical_opportunity', featureId: slug(title), title, score, confidence: 78,
    sourceUrl: '', evidenceType: 'measured_or_observed',
    customerNeed: benefit,
    observed, implication,
    recommendation: service,
    sellableService: service,
    businessBenefit: benefit,
    novelty: 'Foundation improvement',
    ownerWording: `${title} is a practical opportunity supported by the public website evidence.`,
  };
}

function buildServiceRecommendations(opportunities) {
  return opportunities.slice(0, 10).map((item, index) => ({
    rank: index + 1,
    service: item.sellableService,
    basedOn: item.title,
    score: item.score,
    confidence: item.confidence,
    packageType: item.score >= 85 ? 'Priority project' : item.score >= 72 ? 'Growth project' : 'Optional enhancement',
    pitchAngle: `${item.customerNeed} The recommended service is ${item.sellableService.toLowerCase()}.`,
  }));
}

function buildServicePackages(opportunities, profile) {
  const eligible = opportunities.filter((item) => item.suitability?.score >= 65).slice(0, 8);
  const groups = [
    {
      id: 'conversion-foundation',
      name: `${profile.name} Conversion Foundation`,
      match: (item) => /booking|availability|lead|form|pricing|search|tracking|measurement/i.test(`${item.title} ${item.sellableService}`),
    },
    {
      id: 'customer-delight',
      name: `${profile.name} Customer Delight Experience`,
      match: (item) => item.type === 'customer_delight' || /visual|quiz|finder|comparison|calculator|portal|alert/i.test(`${item.title} ${item.sellableService}`),
    },
    {
      id: 'ai-assistance',
      name: `${profile.name} Guided Assistance`,
      match: (item) => item.type === 'ai_opportunity',
    },
  ];
  return groups.map((group) => {
    const matches = eligible.filter(group.match).slice(0, 4);
    if (!matches.length) return null;
    const complexity = matches.some((item) => /portal|visualizer|platform/i.test(item.sellableService)) ? 'High' : matches.length >= 3 ? 'Medium' : 'Low to medium';
    return {
      id: group.id,
      name: group.name,
      opportunityIds: matches.map((item) => item.id),
      deliverables: matches.map((item) => item.sellableService),
      customerOutcome: matches.map((item) => item.customerNeed).slice(0, 2).join(' '),
      complexity,
      discoveryFirst: 'Confirm the current internal workflow and existing tools before recommending implementation technology.',
    };
  }).filter(Boolean);
}

function buildCustomerJourney(profile, expected, detection) {
  const stages = [
    { id: 'discover', label: 'Discover', related: ['product_search', 'property_search', 'inventory_search', 'course_catalog', 'menu_catalog', 'location_content', 'use_cases'] },
    { id: 'understand', label: 'Understand', related: ['pricing_guidance', 'service_guidance', 'itinerary', 'practical_info', 'shipping_returns', 'project_process'] },
    { id: 'compare', label: 'Compare & trust', related: ['reviews', 'case_studies', 'package_comparison', 'comparison', 'team_profiles', 'agent_profiles', 'practitioner_profiles'] },
    { id: 'act', label: 'Take action', related: ['booking', 'viewing_booking', 'availability', 'application', 'lead_qualification', 'quote_form'] },
    { id: 'follow_up', label: 'Follow up', related: ['order_tracking', 'saved_items', 'abandoned_cart', 'onboarding', 'preparation'] },
  ];
  return stages.map((stage) => {
    const relevant = expected.filter((item) => stage.related.includes(item.id));
    const present = relevant.filter((item) => item.status === 'present').length;
    const ratio = relevant.length ? present / relevant.length : 0;
    const status = !relevant.length ? 'not_applicable' : ratio >= 0.75 ? 'strong' : ratio >= 0.35 ? 'partial' : 'weak';
    return {
      ...stage,
      status,
      present,
      total: relevant.length,
      summary: status === 'strong'
        ? 'The visible website supports this stage well.'
        : status === 'partial'
          ? 'Some support is visible, but customers may still meet friction.'
          : status === 'weak'
            ? `Important ${profile.name.toLowerCase()} capabilities were not reliably detected at this stage.`
            : 'No specialized capability was required for this stage.',
    };
  });
}

function buildKeywordOpportunities(profile, classification, crawl, input) {
  const text = crawl.pages.map((page) => `${page.title} ${page.headings.map((h) => h.text).join(' ')}`).join(' ').toLowerCase();
  const topic = chooseTopic(text, classification);
  const location = input.targetCity || input.targetCountry || 'target location';
  return profile.keywordClusters.slice(0, 8).map((template, index) => {
    const keyword = template
      .replace(/\[product\]|\[service\]|\[course\]|\[programme\]|\[project\]|\[contractor\]|\[practitioner\]|\[car model\]|\[software category\]|\[software\]|\[problem\]|\[cuisine\]|\[destination\]|\[industry\]|\[need\]|\[use\]/gi, topic)
      .replace(/\[location\]/gi, location);
    return {
      keyword,
      cluster: keyword.replace(/\b(best|buy|online|near me|price|cost)\b/gi, '').replace(/\s+/g, ' ').trim(),
      intent: /buy|book|price|cost|for sale|rent|near me|consultation/i.test(keyword) ? 'Commercial' : 'Research',
      relevance: index < 2 ? 'High' : 'Moderate',
      demandStatus: 'Not volume-verified in free mode',
      reason: `This follows a common ${profile.name.toLowerCase()} search pattern and is related to content found on the website.`,
    };
  });
}

function chooseTopic(text, classification) {
  const candidates = [
    'merch', 'wedding venue', 'property', 'real estate', 'restaurant', 'hotel', 'therapy', 'fitness', 'salon', 'construction', 'roofing', 'consulting', 'accounting', 'training', 'course', 'car service', 'software', 'tour',
  ];
  const found = candidates.find((candidate) => text.includes(candidate));
  if (found) return found;
  return classification.subindustry?.name?.toLowerCase() || classification.profile.name.toLowerCase();
}

function calculateReadiness(expected, detection) {
  const weights = { critical: 3, high: 2, medium: 1, low: 0.5 };
  let achieved = 0;
  let total = 0;
  expected.forEach((item) => {
    const weight = weights[item.importance] || 1;
    total += weight;
    if (item.status === 'present') achieved += weight;
    else if (item.status === 'unconfirmed') achieved += weight * 0.25;
  });
  let score = total ? Math.round((achieved / total) * 100) : 50;
  if (detection.tracking.analytics) score += 5;
  if (detection.tracking.conversionSignals) score += 4;
  return Math.max(10, Math.min(96, score));
}

function calculateOpportunityScore(opportunities, readiness) {
  const top = opportunities.slice(0, 7);
  const avg = top.length ? top.reduce((sum, item) => sum + item.score, 0) / top.length : 50;
  return Math.max(20, Math.min(98, Math.round(avg * 0.75 + (100 - readiness) * 0.25)));
}

function calculateProspectPriority(crawl, detection, score) {
  let maturity = 0;
  maturity += Math.min(crawl.pages.length * 5, 30);
  maturity += detection.technologies.length >= 3 ? 18 : detection.technologies.length * 5;
  maturity += detection.forms.length ? 14 : 0;
  maturity += detection.tracking.advertising ? 14 : 0;
  maturity += detection.features.reviews ? 10 : 0;
  const combined = Math.round(score * 0.65 + maturity * 0.35);
  if (combined >= 78) return { grade: 'A', label: 'Contact first', score: combined };
  if (combined >= 62) return { grade: 'B', label: 'Good prospect', score: combined };
  if (combined >= 46) return { grade: 'C', label: 'Review before contact', score: combined };
  return { grade: 'D', label: 'Low priority', score: combined };
}

function buildOutreach(business, strengths, opportunities, classification) {
  const strength = strengths[0]?.title || 'a useful website foundation';
  const first = opportunities[0];
  const second = opportunities[1];
  return {
    subject: `${business.name}: a customer-experience opportunity I found`,
    opening: `I reviewed ${business.name} from the perspective of a first-time customer. ${strength} is already in place, but I found a practical opportunity around ${first?.title?.toLowerCase() || 'the customer journey'}.`,
    message: `I reviewed ${business.name} from the perspective of a first-time customer in the ${classification.profile.name.toLowerCase()} market. The website already has ${strength.toLowerCase()}, but ${first?.observed?.toLowerCase() || 'one important customer capability was not clearly available'} ${second ? `I also found an opportunity around ${second.title.toLowerCase()}.` : ''} I prepared a short report showing what is working, what customers may still need, and the improvements I would prioritize. Would you like me to send it?`,
    callAngle: `Focus the conversation on ${first?.customerNeed || 'reducing customer friction'}, then ask how the current process is handled internally before recommending a tool.`,
  };
}

function buildDiscoveryQuestions(profile, detection, opportunities) {
  const questions = [
    `What usually prevents a website visitor from becoming a ${profile.id === 'ecommerce' ? 'customer' : 'qualified enquiry'}?`,
    detection.forms.length ? 'Where do website enquiries go after a visitor submits a form?' : 'How do interested visitors currently contact the business?',
    'Which customer questions take the most staff time to answer repeatedly?',
    'Which part of the customer journey currently requires the most manual follow-up?',
    'How do you measure whether the website produces useful enquiries or sales?',
  ];
  if (opportunities.some((item) => item.type === 'ai_opportunity')) questions.push('Which approved questions could an automated assistant answer, and which must always go to a person?');
  return questions.slice(0, 7);
}

function overallConfidence(classification, expected, crawl) {
  const avg = expected.length ? expected.reduce((sum, item) => sum + item.confidence, 0) / expected.length : 50;
  return Math.round(Math.min(94, classification.confidence * 0.45 + avg * 0.4 + Math.min(crawl.pages.length * 3, 15)));
}

function delightAlreadyPresent(title, features) {
  const lower = title.toLowerCase();
  if (lower.includes('calendar') || lower.includes('booking')) return features.booking;
  if (lower.includes('assistant') || lower.includes('concierge')) return features.ai_chat;
  if (lower.includes('comparison')) return features.comparison || features.package_comparison;
  if (lower.includes('alert')) return features.saved_items || features.newsletter;
  if (lower.includes('portal') || lower.includes('tracker')) return features.order_tracking;
  return false;
}

function customerNeedFor(id, profile) {
  const specific = {
    booking: 'Take the next step without waiting for email back-and-forth.',
    availability: 'Know whether a suitable date or slot is available.',
    reviews: 'See proof from people with a similar need.',
    pricing_guidance: 'Understand likely cost before investing time in an enquiry.',
    lead_qualification: 'Explain the need once and receive a more relevant response.',
    product_search: 'Find the right option quickly without browsing every page.',
    viewing_booking: 'Arrange a viewing at a convenient time.',
    shipping_returns: 'Understand delivery and risk before checkout.',
    case_studies: 'See credible evidence that the business can solve the problem.',
  };
  return specific[id] || profile.customerGoals[0] || 'Complete the intended task with less friction.';
}

function goalVerb(goals) {
  const goal = goals?.[0] || 'understand the offer and take action';
  return goal.charAt(0).toLowerCase() + goal.slice(1);
}

function recommendationForFeature(id, label) {
  const custom = {
    booking: 'Add an embedded scheduling journey with availability, reminders and easy rescheduling.',
    availability: 'Provide live availability or a guided availability request with a clear response promise.',
    lead_qualification: 'Replace the general form with a short, industry-specific intake that captures the information staff need.',
    reviews: 'Place relevant proof close to important decisions, not only on a separate testimonials page.',
    pricing_guidance: 'Provide a clear starting range, package guide or estimator rather than forcing every visitor to ask.',
    product_search: 'Add useful search, filters and guided recommendations based on how customers choose.',
    accessibility: 'Improve form labels, image alternatives, keyboard use and content clarity.',
  };
  return custom[id] || `Add or improve ${label.toLowerCase()} using the simplest workflow that fits the current business process.`;
}

function serviceForFeature(id, label) {
  const custom = {
    booking: 'Scheduling, reminders and calendar integration',
    viewing_booking: 'Property viewing scheduling workflow',
    availability: 'Availability calendar and enquiry automation',
    lead_qualification: 'Smart lead intake and routing workflow',
    reviews: 'Trust and social-proof conversion system',
    pricing_guidance: 'Interactive pricing guide or estimator',
    product_search: 'Product discovery, filters and recommendation experience',
    accessibility: 'Website accessibility and usability improvement',
    property_search: 'Property discovery and filter experience',
    case_studies: 'Case-study and proof architecture',
    application: 'Application and enrolment workflow',
  };
  return custom[id] || `${label} implementation and optimization`;
}

function benefitForFeature(id) {
  const custom = {
    booking: 'More completed bookings with less staff coordination.',
    availability: 'Fewer abandoned visits and less repetitive availability messaging.',
    lead_qualification: 'More useful enquiries and faster follow-up.',
    reviews: 'Higher trust at the point of decision.',
    pricing_guidance: 'Fewer price-only enquiries and more informed prospects.',
    product_search: 'Faster product discovery and a clearer path to purchase.',
  };
  return custom[id] || 'A clearer customer journey and a more measurable next step.';
}

function buildCompetitorComparison(opportunities, competitors) {
  const valid = competitors.filter((item) => !item.error);
  const byOpportunity = {};
  for (const opportunity of opportunities) {
    if (!valid.length || !opportunity.featureId) continue;
    const present = valid.filter((item) => competitorHasFeature(item.features || {}, opportunity.featureId)).length;
    byOpportunity[opportunity.id] = {
      present,
      total: valid.length,
      label: present === 0 ? `Not detected on any of ${valid.length} supplied competitor${valid.length === 1 ? '' : 's'}` : `Detected on ${present} of ${valid.length} supplied competitors`,
    };
  }
  return { competitors, successful: valid.length, byOpportunity };
}

function competitorHasFeature(features, id) {
  if (id === 'ai_chat') return Boolean(features.ai_chat);
  if (id === 'booking' || id === 'viewing_booking') return Boolean(features.booking || features.viewing_booking);
  if (id === 'availability') return Boolean(features.availability);
  if (id === 'product_search') return Boolean(features.search && features.filters);
  if (id === 'lead_qualification') return Boolean(features.lead_qualification);
  return Boolean(features[id]);
}

function delightFeatureId(title) {
  const lower = title.toLowerCase();
  if (/assistant|concierge|navigator/.test(lower)) return 'ai_chat';
  if (/calendar|booking|schedule|appointment/.test(lower)) return 'booking';
  if (/availability/.test(lower)) return 'availability';
  if (/comparison|compare/.test(lower)) return 'comparison';
  if (/portal|tracker/.test(lower)) return 'portal';
  if (/calculator|estimator|budget|affordability/.test(lower)) return 'calculator';
  if (/visualizer|preview/.test(lower)) return 'visualizer';
  if (/quiz|finder|matching|selector/.test(lower)) return 'guided_selection';
  return slug(title);
}

function withIds(items, prefix) {
  const used = new Set();
  return items.map((item, index) => {
    let id = `${prefix}-${slug(item.title || String(index + 1))}`;
    while (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    return { id, ...item };
  });
}

function confidenceBand(value) {
  if (value >= 85) return 'High';
  if (value >= 65) return 'Moderate';
  return 'Low';
}

function slug(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'item';
}

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
