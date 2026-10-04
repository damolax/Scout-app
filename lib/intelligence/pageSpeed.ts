// @ts-nocheck
export async function fetchPageSpeed(url) {
  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('strategy', 'mobile');
  ['performance', 'accessibility', 'seo', 'best-practices'].forEach((category) => endpoint.searchParams.append('category', category));
  if (process.env.PAGESPEED_API_KEY) endpoint.searchParams.set('key', process.env.PAGESPEED_API_KEY);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    const categories = data?.lighthouseResult?.categories || {};
    const audits = data?.lighthouseResult?.audits || {};
    const loading = data?.loadingExperience?.metrics || {};
    return {
      source: 'Google PageSpeed Insights',
      fetchedAt: new Date().toISOString(),
      scores: {
        performance: score(categories.performance?.score),
        accessibility: score(categories.accessibility?.score),
        seo: score(categories.seo?.score),
        bestPractices: score(categories['best-practices']?.score),
      },
      lab: {
        lcpMs: numeric(audits['largest-contentful-paint']?.numericValue),
        cls: numeric(audits['cumulative-layout-shift']?.numericValue, 3),
        totalBlockingTimeMs: numeric(audits['total-blocking-time']?.numericValue),
        speedIndexMs: numeric(audits['speed-index']?.numericValue),
      },
      field: {
        lcp: loading.LARGEST_CONTENTFUL_PAINT_MS?.category || null,
        inp: loading.INTERACTION_TO_NEXT_PAINT?.category || null,
        cls: loading.CUMULATIVE_LAYOUT_SHIFT_SCORE?.category || null,
      },
      hasFieldData: Object.keys(loading).length > 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function score(value) {
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

function numeric(value, decimals = 0) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}
