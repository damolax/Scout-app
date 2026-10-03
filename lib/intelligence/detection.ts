// @ts-nocheck
const technologyRules = [
  ['Shopify', ['cdn.shopify.com', 'shopify.theme', 'myshopify.com', '/cart.js', '_shopify_']],
  ['WordPress', ['/wp-content/', '/wp-includes/', 'wp-json', 'wordpress']],
  ['WooCommerce', ['woocommerce', 'wc-ajax', 'wc_cart_hash']],
  ['Wix', ['wixstatic.com', 'wix-code', 'wix.com']],
  ['Squarespace', ['static1.squarespace.com', 'squarespace.com', 'squarespace-context']],
  ['Webflow', ['webflow.js', 'data-wf-page', 'data-wf-site']],
  ['Framer', ['framerusercontent.com', 'framer.com/m/']],
  ['Google Analytics', ['googletagmanager.com/gtag', 'google-analytics.com', 'gtag(']],
  ['Google Tag Manager', ['googletagmanager.com/gtm.js', 'gtm-']],
  ['Meta Pixel', ['connect.facebook.net', 'fbq(', 'facebook pixel']],
  ['TikTok Pixel', ['analytics.tiktok.com', 'ttq.']],
  ['LinkedIn Insight Tag', ['snap.licdn.com', '_linkedin_partner_id']],
  ['Microsoft Clarity', ['clarity.ms/tag', 'clarity(']],
  ['Hotjar', ['static.hotjar.com', 'hj(']],
  ['Klaviyo', ['klaviyo.com', 'klaviyo.js', '_learnq']],
  ['Mailchimp', ['list-manage.com', 'mailchimp', 'mc_embed_signup']],
  ['Omnisend', ['omnisend.com', 'omnisend']],
  ['HubSpot', ['js.hs-scripts.com', 'js.hsforms.net', 'hubspotutk', 'hubspot']],
  ['Intercom', ['widget.intercom.io', 'intercomsettings']],
  ['Tidio', ['code.tidio.co', 'tidiochat']],
  ['Crisp', ['client.crisp.chat', '$crisp']],
  ['Tawk.to', ['embed.tawk.to', 'tawk_api']],
  ['Zendesk', ['static.zdassets.com', 'zendesk']],
  ['Drift', ['js.driftt.com', 'drift.load']],
  ['Calendly', ['calendly.com', 'assets.calendly.com']],
  ['Acuity Scheduling', ['acuityscheduling.com', 'squarespace scheduling']],
  ['Setmore', ['setmore.com', 'my.setmore.com']],
  ['Booksy', ['booksy.com']],
  ['Mindbody', ['mindbodyonline.com', 'healcode.com']],
  ['Typeform', ['typeform.com', 'embed.typeform.com']],
  ['Jotform', ['jotform.com', 'jsform.com']],
  ['Stripe', ['js.stripe.com', 'stripe.com/v3']],
  ['PayPal', ['paypal.com/sdk/js', 'paypalobjects.com']],
  ['Cloudflare', ['cf-ray', '__cf_bm', 'cloudflare']],
  ['reCAPTCHA', ['google.com/recaptcha', 'g-recaptcha']],
  ['Trustpilot', ['widget.trustpilot.com', 'trustpilot']],
  ['Yotpo', ['staticw2.yotpo.com', 'yotpo']],
  ['Judge.me', ['judge.me', 'judgeme']],
  ['Loox', ['loox.io', 'loox-rating']],
];

export function detectWebsite(crawl) {
  const pages = crawl.pages;
  const combinedHtml = pages.map((page) => `${page.htmlSample}\n${Object.entries(page.headers || {}).map(([k, v]) => `${k}:${v}`).join('\n')}`).join('\n').toLowerCase();
  const combinedText = pages.map((page) => `${page.title} ${page.metaDescription} ${page.text} ${page.headings.map((h) => h.text).join(' ')} ${page.buttons.join(' ')}`).join('\n').toLowerCase();
  const combinedUrls = pages.flatMap((page) => [...page.scripts, ...page.links.map((link) => link.url), ...page.images.map((image) => image.src)]).join('\n').toLowerCase();
  const evidenceHaystack = `${combinedHtml}\n${combinedUrls}`;

  const technologies = technologyRules.map(([name, signals]) => {
    const matched = signals.filter((signal) => evidenceHaystack.includes(signal.toLowerCase()));
    if (!matched.length) return null;
    return {
      name,
      confidence: Math.min(99, 72 + matched.length * 8),
      evidence: matched.slice(0, 5),
    };
  }).filter(Boolean).sort((a, b) => b.confidence - a.confidence);

  const forms = pages.flatMap((page) => page.forms.map((form) => ({ ...form, pageUrl: page.url })));
  const allButtons = pages.flatMap((page) => page.buttons);
  const allLinks = pages.flatMap((page) => page.links);
  const formText = forms.map((form) => `${form.text} ${form.inputs.map((input) => `${input.name} ${input.label || ''} ${input.placeholder} ${input.type}`).join(' ')}`).join(' ').toLowerCase();
  const actionUrls = forms.map((form) => form.action || '').join(' ').toLowerCase();
  const pagePaths = pages.map((page) => page.path).join(' ').toLowerCase();
  const schemas = pages.flatMap((page) => page.jsonLd).join(' ').toLowerCase();
  const buttonText = allButtons.join(' ').toLowerCase();
  const linkText = allLinks.map((link) => `${link.text} ${link.url}`).join(' ').toLowerCase();
  const text = `${combinedText} ${formText} ${actionUrls} ${pagePaths} ${schemas} ${buttonText} ${linkText}`;

  const featureSignals = {
    chat: detectAny(evidenceHaystack, ['intercom', 'tidio', 'crisp.chat', 'tawk.to', 'zendesk', 'drift', 'livechat', 'chatbot', 'chat with us', 'message us']),
    ai_chat: detectAny(text, ['ai assistant', 'ai chatbot', 'virtual assistant', 'ask our ai', 'ai concierge']),
    booking: detectAny(text, ['book now', 'book appointment', 'schedule', 'reservation', 'reserve a table', 'book a call', 'calendly', 'acuity', 'setmore', 'booksy', 'mindbody']),
    availability: detectAny(text, ['availability', 'available dates', 'check dates', 'check availability', 'select date', 'calendar']),
    reviews: detectAny(text, ['testimonial', 'reviews', 'rated ', 'trustpilot', 'yotpo', 'judge.me', 'loox', 'what our clients say', 'customer stories']),
    faq: detectAny(text, ['frequently asked questions', 'faq', 'common questions']),
    newsletter: detectAny(text, ['newsletter', 'subscribe', 'join our list', 'email updates']),
    search: detectAny(text, ['search', 'site search']) || pages.some((page) => page.forms.some((form) => form.inputs.some((input) => input.type === 'search'))),
    filters: detectAny(text, ['filter', 'sort by', 'price range', 'bedrooms', 'property type', 'category filter']),
    cart: detectAny(text, ['add to cart', 'shopping cart', '/cart', 'checkout']),
    shipping_returns: detectAny(text, ['shipping', 'delivery', 'returns', 'refund policy']),
    recommendations: detectAny(text, ['recommended for you', 'you may also like', 'related products', 'similar properties', 'people also viewed']),
    saved_items: detectAny(text, ['save property', 'save item', 'wishlist', 'favorites', 'favourites', 'saved search']),
    order_tracking: detectAny(text, ['track order', 'order status', 'tracking number']),
    property_search: detectAny(text, ['property search', 'search properties', 'find a property', 'listings']) && (detectAny(text, ['bedroom', 'price', 'location', 'property type']) || detectAny(text, ['filter'])),
    viewing_booking: detectAny(text, ['book a viewing', 'schedule a viewing', 'request viewing', 'arrange a viewing']),
    agent_profiles: detectAny(text, ['our agents', 'meet the agent', 'property consultant', 'realtor profile']),
    valuation: detectAny(text, ['property valuation', 'home valuation', 'request a valuation', 'what is my home worth']),
    location_content: detectAny(text, ['neighbourhood guide', 'neighborhood guide', 'area guide', 'local area', 'community guide']),
    package_comparison: detectAny(text, ['compare packages', 'package comparison', 'what is included']) || countOccurrences(text, 'package') >= 4,
    gallery: detectAny(text, ['gallery', 'portfolio', 'our work', 'photos']),
    pricing_guidance: detectAny(text, ['pricing', 'prices', 'starting from', 'from $', 'from £', 'from €', 'request a quote', 'get a quote']),
    menu_catalog: detectAny(text, ['menu', 'rooms', 'suites', 'packages']),
    location_info: detectAny(text, ['directions', 'parking', 'find us', 'location', 'map']),
    dietary_info: detectAny(text, ['allergen', 'dietary', 'vegan', 'vegetarian', 'gluten free', 'halal']),
    practitioner_profiles: detectAny(text, ['our doctors', 'our therapists', 'practitioners', 'meet the team', 'credentials', 'qualifications']),
    service_guidance: detectAny(text, ['which service', 'how we can help', 'services', 'treatments', 'solutions']),
    accessibility: detectAny(text, ['accessibility statement', 'accessible']) || accessibilityScore(pages) >= 70,
    privacy: detectAny(text, ['privacy policy', 'data protection', 'hipaa', 'gdpr']),
    preparation: detectAny(text, ['before your appointment', 'prepare for', 'aftercare', 'what to expect']),
    staff_profiles: detectAny(text, ['meet the team', 'our team', 'our stylists', 'our barbers', 'our staff']),
    quote_form: forms.some((form) => detectAny(form.text.toLowerCase(), ['quote', 'estimate', 'project type', 'budget'])) || detectAny(text, ['request a quote', 'get an estimate']),
    service_area: detectAny(text, ['service area', 'areas we serve', 'postcode', 'zip code', 'locations served']),
    portfolio: detectAny(text, ['portfolio', 'projects', 'our work', 'case study', 'before and after']),
    project_process: detectAny(text, ['our process', 'how it works', 'project timeline', 'what to expect']),
    case_studies: detectAny(text, ['case studies', 'case study', 'client results', 'success stories']),
    team_profiles: detectAny(text, ['meet the team', 'our consultants', 'our lawyers', 'our experts', 'leadership']),
    lead_qualification: forms.some((form) => form.inputs.length >= 5 || detectAny(form.text.toLowerCase(), ['budget', 'timeline', 'company size', 'project type', 'preferred date'])),
    resource_library: detectAny(text, ['resources', 'guides', 'insights', 'blog', 'downloads']),
    course_catalog: detectAny(text, ['courses', 'programmes', 'programs', 'course catalog', 'training courses']),
    programme_comparison: detectAny(text, ['compare programmes', 'compare programs', 'which course', 'programme finder']),
    application: detectAny(text, ['apply now', 'application form', 'enrol now', 'enroll now', 'admissions']),
    outcomes: detectAny(text, ['learning outcomes', 'career outcomes', 'graduate outcomes', 'certification', 'accredited']),
    inventory_search: detectAny(text, ['vehicle search', 'cars for sale', 'inventory', 'search vehicles']) && detectAny(text, ['make', 'model', 'year', 'price']),
    comparison: detectAny(text, ['compare', 'comparison']),
    product_demo: detectAny(text, ['product tour', 'watch demo', 'interactive demo', 'book a demo']),
    use_cases: detectAny(text, ['use cases', 'solutions for', 'by industry', 'by role']),
    integrations: detectAny(text, ['integrations', 'connects with', 'api documentation']),
    onboarding: detectAny(text, ['start free trial', 'get started', 'onboarding', 'sign up free']),
    itinerary: detectAny(text, ['itinerary', 'day 1', 'what is included', 'tour highlights']),
    practical_info: detectAny(text, ['meeting point', 'cancellation', 'what to bring', 'pickup', 'departure time']),
    multilingual: detectAny(text, ['language selector', 'select language']) || pages.some((page) => /^(en|fr|de|es|it|pt|el|nl|ar|zh|ja)(-|$)/i.test(page.lang)),
    clear_offer: pages[0]?.title?.length > 5 && pages[0]?.headings?.some((heading) => heading.level === 1),
    contact: detectAny(text, ['contact us', 'get in touch', 'call us', 'email us']) || forms.length > 0,
  };

  const tracking = {
    analytics: technologies.some((item) => ['Google Analytics', 'Google Tag Manager', 'Microsoft Clarity', 'Hotjar'].includes(item.name)),
    advertising: technologies.some((item) => ['Meta Pixel', 'TikTok Pixel', 'LinkedIn Insight Tag'].includes(item.name)),
    emailMarketing: technologies.some((item) => ['Klaviyo', 'Mailchimp', 'Omnisend', 'HubSpot'].includes(item.name)),
    conversionSignals: forms.some((form) => form.action && !new URLSafe(form.pageUrl).sameOrigin(form.action)) || detectAny(evidenceHaystack, ['gtag("event"', "gtag('event'", 'dataLayer.push', 'fbq("track"', "fbq('track'"]),
  };

  return {
    technologies,
    features: featureSignals,
    tracking,
    forms: summarizeForms(forms),
    accessibility: buildAccessibility(pages),
    seo: buildSeoSummary(pages),
    performance: buildPerformanceSummary(pages),
    evidenceText: text,
  };
}

function summarizeForms(forms) {
  return forms.map((form) => ({
    pageUrl: form.pageUrl,
    action: form.action,
    method: form.method,
    fieldCount: form.inputs.length,
    fields: form.inputs.map((input) => input.name || input.placeholder || input.type).filter(Boolean).slice(0, 20),
    purpose: inferFormPurpose(form.text.toLowerCase()),
  })).slice(0, 30);
}

function inferFormPurpose(text) {
  if (detectAny(text, ['viewing', 'property'])) return 'Property enquiry';
  if (detectAny(text, ['appointment', 'booking', 'schedule'])) return 'Booking';
  if (detectAny(text, ['quote', 'estimate'])) return 'Quote request';
  if (detectAny(text, ['newsletter', 'subscribe'])) return 'Newsletter';
  if (detectAny(text, ['apply', 'application', 'enrol', 'enroll'])) return 'Application';
  if (detectAny(text, ['contact', 'message'])) return 'Contact';
  return 'General form';
}

function buildAccessibility(pages) {
  const images = pages.flatMap((page) => page.images);
  const missingAlt = images.filter((image) => !image.alt).length;
  const forms = pages.flatMap((page) => page.forms);
  const unlabeledFields = forms.flatMap((form) => form.inputs).filter((input) => !input.label && !input.name && !input.placeholder).length;
  const hasLang = pages.some((page) => Boolean(page.lang));
  const totalImages = images.length;
  const score = Math.max(20, Math.min(100, 100 - (totalImages ? Math.round((missingAlt / totalImages) * 45) : 0) - Math.min(unlabeledFields * 4, 25) - (hasLang ? 0 : 10)));
  return { score, totalImages, missingAlt, unlabeledFields, hasLang };
}

function accessibilityScore(pages) {
  return buildAccessibility(pages).score;
}

function buildSeoSummary(pages) {
  const missingTitles = pages.filter((page) => !page.title).length;
  const missingDescriptions = pages.filter((page) => !page.metaDescription).length;
  const missingH1 = pages.filter((page) => !page.headings.some((heading) => heading.level === 1)).length;
  const duplicateTitles = duplicateValues(pages.map((page) => page.title).filter(Boolean));
  return { missingTitles, missingDescriptions, missingH1, duplicateTitles };
}

function buildPerformanceSummary(pages) {
  const averageResponseMs = pages.length ? Math.round(pages.reduce((sum, page) => sum + page.responseMs, 0) / pages.length) : 0;
  const averageHtmlKb = pages.length ? Math.round(pages.reduce((sum, page) => sum + page.htmlBytes, 0) / pages.length / 1024) : 0;
  return { averageResponseMs, averageHtmlKb, slowPages: pages.filter((page) => page.responseMs > 2500).map((page) => page.url) };
}

function duplicateValues(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function detectAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

function countOccurrences(text, term) {
  return text.split(term).length - 1;
}

class URLSafe {
  constructor(value) {
    try { this.url = new URL(value); } catch { this.url = null; }
  }
  sameOrigin(other) {
    try { return this.url && new URL(other).origin === this.url.origin; } catch { return true; }
  }
}
