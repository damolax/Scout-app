// @ts-nocheck
export const industryProfiles = [
  {
    id: 'ecommerce',
    name: 'Ecommerce',
    keywords: ['shop', 'store', 'product', 'cart', 'checkout', 'buy now', 'add to cart', 'shipping', 'returns', 'collection'],
    subindustries: [
      { name: 'Fashion & Apparel', keywords: ['clothing', 'fashion', 'dress', 'shirt', 'hoodie', 'apparel', 'size guide'] },
      { name: 'Beauty & Cosmetics', keywords: ['skincare', 'cosmetic', 'beauty product', 'serum', 'makeup'] },
      { name: 'Food & Beverage', keywords: ['snack', 'coffee', 'tea', 'food product', 'ingredients'] },
      { name: 'Merchandise & Print', keywords: ['merch', 't-shirt printing', 'custom apparel', 'print on demand'] },
      { name: 'General Online Retail', keywords: ['online store', 'shop online', 'product catalog'] },
    ],
    customerGoals: ['Find the right product quickly', 'Understand price, delivery and returns', 'Feel confident before checkout', 'Track the order after purchase'],
    expectedFeatures: [
      ['product_search', 'Fast product search and filters', 'critical'],
      ['reviews', 'Product reviews and social proof', 'high'],
      ['shipping_returns', 'Visible shipping and returns information', 'critical'],
      ['recommendations', 'Product recommendations or guided discovery', 'high'],
      ['abandoned_cart', 'Cart recovery and follow-up', 'high'],
      ['order_tracking', 'Order tracking or self-service support', 'medium'],
    ],
    delight: [
      ['AI shopping concierge', 'Helps shoppers choose products and answers approved questions instantly', 'AI product discovery and support package'],
      ['Gift or product finder quiz', 'Turns uncertainty into a guided shortlist', 'Interactive recommendation quiz'],
      ['Bundle builder', 'Lets customers create useful combinations instead of browsing item by item', 'Personalized bundle experience'],
      ['Visual customization preview', 'Lets customers see names, colors or designs before buying', 'Product visualizer'],
      ['Smart restock and price alerts', 'Brings interested customers back at the right time', 'Automated alert workflow'],
    ],
    keywordClusters: ['best [product] for [use]', 'buy [product] online', '[product] near me', 'custom [product]', '[product] gift'],
  },
  {
    id: 'real-estate',
    name: 'Real Estate',
    keywords: ['property', 'properties', 'real estate', 'realtor', 'estate agent', 'for sale', 'for rent', 'listing', 'bedroom', 'mortgage'],
    subindustries: [
      { name: 'Residential Agency', keywords: ['homes for sale', 'apartments for rent', 'realtor'] },
      { name: 'Property Developer', keywords: ['new development', 'off plan', 'luxury development'] },
      { name: 'Property Management', keywords: ['tenant', 'landlord', 'property management', 'maintenance request'] },
      { name: 'Commercial Real Estate', keywords: ['office space', 'commercial property', 'warehouse'] },
      { name: 'Short-Term Rentals', keywords: ['vacation rental', 'short stay', 'holiday apartment'] },
    ],
    customerGoals: ['Discover suitable properties', 'Compare options', 'Book a viewing', 'Understand affordability and location'],
    expectedFeatures: [
      ['property_search', 'Property search with useful filters', 'critical'],
      ['viewing_booking', 'Viewing appointment scheduling', 'critical'],
      ['agent_profiles', 'Agent profiles and direct contact', 'high'],
      ['saved_items', 'Saved properties or alerts', 'medium'],
      ['valuation', 'Seller valuation or appraisal journey', 'high'],
      ['location_content', 'Neighbourhood and location guidance', 'high'],
    ],
    delight: [
      ['AI property matcher', 'Matches needs, budget and location to available listings', 'AI property discovery assistant'],
      ['Viewing calendar with reminders', 'Removes back-and-forth and reduces missed appointments', 'Viewing scheduling workflow'],
      ['Property comparison board', 'Lets buyers compare shortlisted homes side by side', 'Interactive comparison tool'],
      ['Commute and neighbourhood explorer', 'Answers practical lifestyle questions before an enquiry', 'Location intelligence experience'],
      ['Instant seller readiness assessment', 'Helps owners understand the next steps before requesting a valuation', 'Seller lead qualification funnel'],
    ],
    keywordClusters: ['property for sale in [location]', 'apartments to rent in [location]', 'estate agent [location]', 'property valuation [location]', 'new homes [location]'],
  },
  {
    id: 'weddings-events',
    name: 'Weddings & Events',
    keywords: ['wedding', 'bride', 'groom', 'venue', 'event planner', 'ceremony', 'reception', 'guest', 'catering', 'photographer'],
    subindustries: [
      { name: 'Wedding Venue', keywords: ['wedding venue', 'venue hire', 'guest capacity'] },
      { name: 'Wedding Planner', keywords: ['wedding planner', 'event coordination'] },
      { name: 'Wedding Photography', keywords: ['wedding photographer', 'engagement shoot'] },
      { name: 'Event Decor & Rentals', keywords: ['event decor', 'chair rental', 'party rental'] },
      { name: 'Wedding Catering', keywords: ['wedding catering', 'menu tasting'] },
    ],
    customerGoals: ['Imagine the experience', 'Check availability and price', 'Compare packages', 'Book a visit or consultation'],
    expectedFeatures: [
      ['availability', 'Date availability or clear availability enquiry', 'critical'],
      ['booking', 'Tour or consultation scheduling', 'critical'],
      ['package_comparison', 'Clear package comparison', 'high'],
      ['gallery', 'Rich, relevant gallery experience', 'high'],
      ['reviews', 'Couple testimonials and proof', 'high'],
      ['pricing_guidance', 'Price range or estimator', 'high'],
    ],
    delight: [
      ['AI wedding concierge', 'Answers package, capacity, catering and availability questions after hours', 'Wedding concierge assistant'],
      ['Wedding budget estimator', 'Shows realistic package ranges before a consultation', 'Interactive budget calculator'],
      ['Theme and venue visualizer', 'Helps couples imagine colors, layouts and guest counts', 'AI event visualizer'],
      ['Shareable couple shortlist', 'Lets partners and family review saved options together', 'Collaborative inspiration board'],
      ['Vendor recommendation journey', 'Reduces planning stress and increases trust', 'Preferred vendor directory and referral workflow'],
    ],
    keywordClusters: ['wedding venue [location]', 'wedding planner [location]', 'wedding package price', 'wedding photographer [location]', 'small wedding venue'],
  },
  {
    id: 'restaurants-hospitality',
    name: 'Restaurants & Hospitality',
    keywords: ['restaurant', 'menu', 'reservation', 'table', 'hotel', 'rooms', 'book a room', 'catering', 'dining', 'check in'],
    subindustries: [
      { name: 'Restaurant', keywords: ['menu', 'table reservation', 'dinner', 'lunch'] },
      { name: 'Hotel', keywords: ['rooms', 'suites', 'check-in', 'hotel'] },
      { name: 'Short-Stay Accommodation', keywords: ['vacation rental', 'guest house', 'apartment stay'] },
      { name: 'Catering', keywords: ['catering', 'event menu', 'corporate catering'] },
      { name: 'Experience Venue', keywords: ['rooftop', 'private dining', 'event space'] },
    ],
    customerGoals: ['See what is available', 'Understand food, rooms or packages', 'Reserve quickly', 'Avoid surprises'],
    expectedFeatures: [
      ['booking', 'Reservation or room booking', 'critical'],
      ['menu_catalog', 'Clear menu, room or package catalog', 'critical'],
      ['availability', 'Live or guided availability', 'high'],
      ['reviews', 'Reviews and guest proof', 'high'],
      ['location_info', 'Directions, parking and practical information', 'high'],
      ['dietary_info', 'Dietary, allergen or accessibility information', 'high'],
    ],
    delight: [
      ['AI menu or stay recommender', 'Suggests suitable options based on preferences and occasion', 'Hospitality concierge assistant'],
      ['Celebration planner', 'Captures birthdays, proposals and special requirements during booking', 'Celebration booking enhancement'],
      ['Group dining or room planner', 'Makes larger bookings easier to coordinate', 'Group booking workflow'],
      ['Waitlist and availability alerts', 'Brings customers back when a preferred slot opens', 'Automated availability alerts'],
      ['Personalized local guide', 'Improves the guest experience beyond the purchase', 'Digital guest concierge'],
    ],
    keywordClusters: ['restaurant [location]', 'best [cuisine] near me', 'hotel in [location]', 'private dining [location]', 'event catering [location]'],
  },
  {
    id: 'health-wellness',
    name: 'Health & Wellness',
    keywords: ['clinic', 'doctor', 'therapy', 'therapist', 'wellness', 'fitness', 'gym', 'treatment', 'appointment', 'patient'],
    subindustries: [
      { name: 'Clinic or Practice', keywords: ['clinic', 'patient', 'doctor', 'consultation'] },
      { name: 'Therapy & Counselling', keywords: ['therapist', 'counselling', 'mental health'] },
      { name: 'Gym & Fitness', keywords: ['gym', 'membership', 'personal training', 'fitness'] },
      { name: 'Wellness Centre', keywords: ['wellness', 'massage', 'holistic'] },
      { name: 'Personal Training', keywords: ['personal trainer', 'training plan', 'fitness coaching'] },
    ],
    customerGoals: ['Find the right service or practitioner', 'Understand suitability and cost', 'Book safely', 'Know what happens next'],
    expectedFeatures: [
      ['booking', 'Appointment or consultation scheduling', 'critical'],
      ['practitioner_profiles', 'Practitioner profiles and credentials', 'critical'],
      ['service_guidance', 'Clear service suitability guidance', 'high'],
      ['accessibility', 'Accessible forms and content', 'high'],
      ['privacy', 'Privacy and data handling information', 'critical'],
      ['preparation', 'Preparation and next-step guidance', 'medium'],
    ],
    delight: [
      ['Service navigator', 'Guides visitors to the right service without diagnosing them', 'Safe service matching assistant'],
      ['Appointment preparation journey', 'Reduces anxiety and missed appointments', 'Automated preparation and reminders'],
      ['Practitioner matching quiz', 'Helps users choose based on needs, language and availability', 'Practitioner matching tool'],
      ['Progress and habit portal', 'Supports continuity between appointments', 'Client progress portal'],
      ['Multilingual accessibility assistant', 'Makes key information easier to understand', 'Accessible multilingual guidance'],
    ],
    keywordClusters: ['[service] near me', '[service] [location]', 'book [service] online', 'best [service] for [need]', '[practitioner] consultation'],
  },
  {
    id: 'beauty-personal-care',
    name: 'Beauty & Personal Care',
    keywords: ['salon', 'barber', 'beauty', 'spa', 'hair', 'nails', 'facial', 'skincare treatment', 'makeup'],
    subindustries: [
      { name: 'Hair Salon', keywords: ['hair salon', 'hairstylist', 'haircut'] },
      { name: 'Barbershop', keywords: ['barber', 'fade', 'grooming'] },
      { name: 'Spa', keywords: ['spa', 'massage', 'facial'] },
      { name: 'Aesthetic Clinic', keywords: ['aesthetic', 'laser', 'injectable'] },
      { name: 'Makeup & Bridal Beauty', keywords: ['makeup artist', 'bridal makeup'] },
    ],
    customerGoals: ['Choose the right service', 'See results', 'Book a suitable professional', 'Know preparation and maintenance'],
    expectedFeatures: [
      ['booking', 'Online booking and rescheduling', 'critical'],
      ['staff_profiles', 'Staff profiles and specialties', 'high'],
      ['gallery', 'Before-and-after or portfolio gallery', 'high'],
      ['pricing_guidance', 'Clear prices or starting ranges', 'high'],
      ['reviews', 'Reviews and client proof', 'high'],
      ['preparation', 'Preparation and aftercare information', 'medium'],
    ],
    delight: [
      ['Treatment recommendation quiz', 'Helps clients choose without guessing', 'Interactive treatment finder'],
      ['Style or color visualizer', 'Lets clients preview possible looks', 'AI beauty visualizer'],
      ['Smart rebooking reminders', 'Makes maintenance easy and increases retention', 'Automated retention workflow'],
      ['Membership and package builder', 'Makes repeat care more convenient', 'Membership experience'],
      ['Gift experience builder', 'Turns services into easy-to-buy gifts', 'Gift card and package configurator'],
    ],
    keywordClusters: ['[service] near me', '[service] prices', 'best [service] [location]', 'book [service] online', '[service] for [need]'],
  },
  {
    id: 'construction-home-services',
    name: 'Construction & Home Services',
    keywords: ['construction', 'builder', 'contractor', 'roofing', 'plumber', 'electrician', 'landscaping', 'renovation', 'cleaning service', 'repair'],
    subindustries: [
      { name: 'General Contractor', keywords: ['general contractor', 'construction company', 'builder'] },
      { name: 'Home Improvement', keywords: ['renovation', 'remodeling', 'kitchen renovation'] },
      { name: 'Trade Service', keywords: ['plumber', 'electrician', 'hvac', 'roofing'] },
      { name: 'Landscaping', keywords: ['landscaping', 'garden design', 'lawn care'] },
      { name: 'Cleaning & Maintenance', keywords: ['cleaning service', 'maintenance', 'janitorial'] },
    ],
    customerGoals: ['Know whether the company serves the need', 'Estimate cost and timing', 'Request a quote easily', 'Trust the provider'],
    expectedFeatures: [
      ['quote_form', 'Structured quote request', 'critical'],
      ['service_area', 'Clear service-area checker', 'high'],
      ['portfolio', 'Relevant project portfolio', 'high'],
      ['reviews', 'Reviews and credentials', 'critical'],
      ['booking', 'Site visit or consultation scheduling', 'high'],
      ['project_process', 'Clear process and timeline', 'high'],
    ],
    delight: [
      ['Project cost estimator', 'Gives homeowners a useful starting range', 'Interactive estimate calculator'],
      ['Photo and plan upload', 'Lets customers explain the project accurately before a call', 'Smart quote intake workflow'],
      ['Service-area checker', 'Prevents wasted enquiries and gives instant clarity', 'Location qualification tool'],
      ['Material or finish visualizer', 'Helps customers imagine the result', 'AI renovation visualizer'],
      ['Project update portal', 'Reduces repeated status calls after work begins', 'Client project portal'],
    ],
    keywordClusters: ['[service] [location]', '[service] near me', '[project] cost', 'best [contractor] [location]', 'emergency [service]'],
  },
  {
    id: 'professional-services',
    name: 'Professional Services',
    keywords: ['consulting', 'consultant', 'accountant', 'law firm', 'lawyer', 'agency', 'advisory', 'strategy', 'book consultation', 'case study'],
    subindustries: [
      { name: 'Consulting', keywords: ['consulting', 'consultant', 'advisory'] },
      { name: 'Accounting & Finance', keywords: ['accounting', 'bookkeeping', 'tax', 'cpa'] },
      { name: 'Legal Services', keywords: ['law firm', 'lawyer', 'attorney', 'legal'] },
      { name: 'Marketing or Creative Agency', keywords: ['marketing agency', 'creative agency', 'branding'] },
      { name: 'Business Support', keywords: ['virtual assistant', 'outsourcing', 'business services'] },
    ],
    customerGoals: ['Understand expertise', 'Know whether the firm handles the problem', 'See evidence', 'Book a qualified conversation'],
    expectedFeatures: [
      ['service_guidance', 'Clear service and problem mapping', 'critical'],
      ['booking', 'Consultation scheduling', 'high'],
      ['case_studies', 'Relevant case studies or proof', 'critical'],
      ['team_profiles', 'Expert profiles and credentials', 'high'],
      ['lead_qualification', 'Structured lead qualification', 'high'],
      ['resource_library', 'Useful resources or guides', 'medium'],
    ],
    delight: [
      ['Service selection assistant', 'Directs visitors to the right service and next step', 'AI service navigator'],
      ['Readiness assessment', 'Gives prospects value before the sales call', 'Interactive business assessment'],
      ['Case-study matcher', 'Shows the most relevant proof for each visitor', 'Personalized proof experience'],
      ['Secure onboarding portal', 'Makes document collection and project start easier', 'Client onboarding portal'],
      ['Proposal and meeting preparation workflow', 'Shortens the time from interest to a useful conversation', 'Automated consultation preparation'],
    ],
    keywordClusters: ['[service] consultant', '[service] firm [location]', '[problem] help', '[service] for small business', 'book [service] consultation'],
  },
  {
    id: 'education-training',
    name: 'Education & Training',
    keywords: ['course', 'school', 'academy', 'training', 'tutor', 'programme', 'program', 'student', 'enrol', 'admission'],
    subindustries: [
      { name: 'School or College', keywords: ['school', 'college', 'admissions', 'student'] },
      { name: 'Online Course Provider', keywords: ['online course', 'e-learning', 'self paced'] },
      { name: 'Training Company', keywords: ['corporate training', 'workshop', 'certification'] },
      { name: 'Tutoring', keywords: ['tutor', 'lessons', 'exam preparation'] },
      { name: 'Coaching Programme', keywords: ['coaching program', 'cohort', 'masterclass'] },
    ],
    customerGoals: ['Find the right programme', 'Understand outcomes and eligibility', 'Compare cost and schedule', 'Apply or enrol'],
    expectedFeatures: [
      ['course_catalog', 'Clear course or programme catalog', 'critical'],
      ['programme_comparison', 'Programme comparison and guidance', 'high'],
      ['booking', 'Advisor call or trial lesson booking', 'high'],
      ['application', 'Simple application or enrolment journey', 'critical'],
      ['outcomes', 'Outcomes, credentials and student proof', 'critical'],
      ['pricing_guidance', 'Tuition and payment guidance', 'high'],
    ],
    delight: [
      ['Course recommendation quiz', 'Guides learners to the right programme', 'AI course navigator'],
      ['Eligibility checker', 'Provides immediate clarity before an application', 'Interactive eligibility tool'],
      ['Tuition and payment calculator', 'Makes affordability easier to understand', 'Education cost calculator'],
      ['Sample lesson experience', 'Lets students experience teaching before enrolling', 'Interactive trial lesson'],
      ['Application progress tracker', 'Reduces anxiety after submission', 'Student application portal'],
    ],
    keywordClusters: ['[course] course online', '[course] training [location]', 'best [course] certification', '[programme] tuition', '[subject] tutor near me'],
  },
  {
    id: 'automotive',
    name: 'Automotive',
    keywords: ['car', 'vehicle', 'auto', 'dealership', 'car repair', 'mechanic', 'rental car', 'detailing', 'mot', 'service centre'],
    subindustries: [
      { name: 'Car Dealership', keywords: ['cars for sale', 'dealership', 'used cars'] },
      { name: 'Repair & Maintenance', keywords: ['mechanic', 'car repair', 'service centre'] },
      { name: 'Car Rental', keywords: ['car rental', 'rent a car'] },
      { name: 'Detailing', keywords: ['car detailing', 'ceramic coating', 'valeting'] },
      { name: 'Parts & Accessories', keywords: ['auto parts', 'car accessories'] },
    ],
    customerGoals: ['Find a suitable vehicle or service', 'Know availability and price', 'Book or reserve', 'Understand trust and warranty'],
    expectedFeatures: [
      ['inventory_search', 'Vehicle or service search and filters', 'critical'],
      ['booking', 'Test drive, rental or service booking', 'critical'],
      ['pricing_guidance', 'Clear price, finance or estimate guidance', 'high'],
      ['reviews', 'Reviews, warranties and credentials', 'high'],
      ['availability', 'Live or clearly updated availability', 'high'],
      ['comparison', 'Vehicle or package comparison', 'medium'],
    ],
    delight: [
      ['Vehicle matching assistant', 'Matches needs and budget to suitable vehicles', 'AI vehicle finder'],
      ['Service cost estimator', 'Sets expectations before a booking', 'Automotive estimate calculator'],
      ['Test-drive and service calendar', 'Makes the next action immediate', 'Automotive booking workflow'],
      ['Ownership cost comparison', 'Helps customers compare total cost, not just price', 'Cost-of-ownership calculator'],
      ['Maintenance reminder portal', 'Builds retention after the first transaction', 'Automated service reminders'],
    ],
    keywordClusters: ['cars for sale [location]', 'car service [location]', 'car rental [location]', '[car model] price', 'car detailing near me'],
  },
  {
    id: 'saas-technology',
    name: 'SaaS & Technology',
    keywords: ['software', 'platform', 'saas', 'dashboard', 'integration', 'api', 'demo', 'free trial', 'automation', 'cloud'],
    subindustries: [
      { name: 'B2B SaaS', keywords: ['book a demo', 'enterprise', 'workflow software'] },
      { name: 'Consumer App', keywords: ['download app', 'mobile app', 'get started free'] },
      { name: 'IT Services', keywords: ['managed it', 'cybersecurity', 'cloud services'] },
      { name: 'Development Agency', keywords: ['web development', 'software development', 'app development'] },
      { name: 'AI Product', keywords: ['artificial intelligence', 'ai platform', 'machine learning'] },
    ],
    customerGoals: ['Understand the product quickly', 'Know whether it fits the use case', 'See proof', 'Start a trial or demo'],
    expectedFeatures: [
      ['product_demo', 'Product demonstration or guided tour', 'critical'],
      ['pricing_guidance', 'Pricing or clear buying path', 'high'],
      ['use_cases', 'Use cases by role or industry', 'critical'],
      ['integrations', 'Integration and compatibility information', 'high'],
      ['case_studies', 'Case studies and measurable proof', 'high'],
      ['onboarding', 'Clear trial or onboarding path', 'critical'],
    ],
    delight: [
      ['Interactive product tour', 'Lets prospects understand value without booking a call', 'Guided product demo'],
      ['AI solution architect', 'Maps business needs to features and integrations', 'AI product qualification assistant'],
      ['ROI calculator', 'Translates features into a business case', 'SaaS ROI calculator'],
      ['Personalized demo environment', 'Shows the product through the visitor’s use case', 'Personalized demo workflow'],
      ['Implementation readiness assessment', 'Helps teams understand migration and setup before buying', 'Interactive readiness assessment'],
    ],
    keywordClusters: ['best [software category]', '[software] for [industry]', '[competitor] alternative', '[software] pricing', '[problem] automation software'],
  },
  {
    id: 'travel-tourism',
    name: 'Travel & Tourism',
    keywords: ['tour', 'travel', 'trip', 'destination', 'excursion', 'itinerary', 'holiday', 'vacation', 'book tour', 'attraction'],
    subindustries: [
      { name: 'Tour Operator', keywords: ['guided tour', 'day trip', 'excursion'] },
      { name: 'Travel Agency', keywords: ['travel agency', 'holiday package', 'flight and hotel'] },
      { name: 'Attraction', keywords: ['tickets', 'attraction', 'museum', 'experience'] },
      { name: 'Transport Service', keywords: ['airport transfer', 'shuttle', 'private driver'] },
      { name: 'Destination Service', keywords: ['destination management', 'local guide'] },
    ],
    customerGoals: ['Find the right experience', 'Understand dates, inclusions and logistics', 'Book confidently', 'Prepare for the trip'],
    expectedFeatures: [
      ['availability', 'Live dates or clear availability', 'critical'],
      ['booking', 'Online booking and confirmation', 'critical'],
      ['itinerary', 'Clear itinerary and inclusions', 'critical'],
      ['reviews', 'Traveler reviews and visual proof', 'high'],
      ['practical_info', 'Meeting points, cancellation and preparation details', 'high'],
      ['multilingual', 'Language and currency support where relevant', 'medium'],
    ],
    delight: [
      ['AI itinerary builder', 'Creates a useful plan around time, interests and budget', 'AI travel planning assistant'],
      ['Availability and weather-aware suggestions', 'Helps travelers choose suitable dates and experiences', 'Smart trip recommendation tool'],
      ['Group trip organizer', 'Makes coordination easier for families and friends', 'Collaborative itinerary board'],
      ['Digital trip companion', 'Provides meeting points, reminders and local guidance after booking', 'Mobile guest journey'],
      ['Transfer and add-on builder', 'Lets customers complete the whole experience in one place', 'Travel bundle configurator'],
    ],
    keywordClusters: ['best tours in [location]', 'things to do in [location]', '[destination] itinerary', 'day trip from [location]', 'airport transfer [location]'],
  },
];

export const generalProfile = {
  id: 'general',
  name: 'General Business',
  customerGoals: ['Understand the offer', 'Trust the business', 'Take the next step'],
  expectedFeatures: [
    ['clear_offer', 'Clear offer and audience', 'critical'],
    ['contact', 'Clear contact or conversion path', 'critical'],
    ['reviews', 'Trust evidence', 'high'],
    ['booking', 'Convenient next-step scheduling where relevant', 'medium'],
    ['chat', 'Immediate assistance where questions block decisions', 'medium'],
  ],
  delight: [
    ['Guided service assistant', 'Helps visitors understand the right next step', 'AI website concierge'],
    ['Interactive estimator', 'Provides useful guidance before contact', 'Business-specific calculator'],
    ['Smart booking and reminders', 'Removes scheduling friction', 'Scheduling automation'],
  ],
  keywordClusters: ['[service] [location]', 'best [service]', '[service] cost'],
};

export function getIndustryProfile(id) {
  if (!id || id === generalProfile.id) return generalProfile;
  return industryProfiles.find((profile) => profile.id === id) || null;
}

export function getIndustryOptions() {
  return [...industryProfiles, generalProfile].map((profile) => ({
    id: profile.id,
    name: profile.name,
    subindustries: (profile.subindustries || []).map((item) => item.name),
  }));
}

export function classifyIndustry(text, options = {}) {
  const normalized = String(text || "").toLowerCase();
  const forcedProfile = getIndustryProfile(options.forcedIndustryId);
  if (options.forcedIndustryId && forcedProfile) {
    const forcedSubindustry = (forcedProfile.subindustries || []).find((item) => item.name === options.forcedSubindustryName);
    return {
      profile: forcedProfile,
      confidence: 95,
      confidenceSource: "human_confirmed",
      evidence: ["Industry confirmed during review"],
      subindustry: forcedSubindustry ? { name: forcedSubindustry.name, confidence: 95, evidence: ["Subindustry confirmed during review"] } : classifySubindustry(forcedProfile, normalized),
      alternatives: [],
    };
  }
  const scored = industryProfiles.map((profile) => {
    let score = 0;
    const evidence = [];
    for (const keyword of profile.keywords) {
      const occurrences = countOccurrences(normalized, keyword);
      if (occurrences > 0) {
        score += Math.min(occurrences, 6) * (keyword.includes(' ') ? 3 : 1.4);
        evidence.push(keyword);
      }
    }
    return { profile, score, evidence: [...new Set(evidence)].slice(0, 8) };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 4) {
    return { profile: generalProfile, confidence: 35, confidenceSource: 'automatic', evidence: [], alternatives: [] };
  }

  const second = scored[1]?.score || 0;
  const margin = best.score - second;
  const confidence = Math.max(52, Math.min(97, Math.round(58 + best.score * 1.6 + margin * 1.1)));

  const subindustry = classifySubindustry(best.profile, normalized);
  return {
    profile: best.profile,
    confidence,
    confidenceSource: 'automatic',
    evidence: best.evidence,
    subindustry,
    alternatives: scored.slice(1, 4).filter((item) => item.score > 2).map((item) => ({ name: item.profile.name, score: Math.round(item.score) })),
  };
}

function classifySubindustry(profile, text) {
  const scored = (profile.subindustries || []).map((sub) => {
    let score = 0;
    const evidence = [];
    for (const keyword of sub.keywords) {
      const occurrences = countOccurrences(text, keyword);
      if (occurrences > 0) {
        score += Math.min(occurrences, 5) * (keyword.includes(' ') ? 3 : 1.5);
        evidence.push(keyword);
      }
    }
    return { name: sub.name, score, evidence };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? { name: scored[0].name, confidence: Math.min(95, 55 + Math.round(scored[0].score * 4)), evidence: scored[0].evidence } : null;
}

function countOccurrences(text, term) {
  let index = 0;
  let count = 0;
  while ((index = text.indexOf(term, index)) !== -1) {
    count += 1;
    index += term.length;
  }
  return count;
}
