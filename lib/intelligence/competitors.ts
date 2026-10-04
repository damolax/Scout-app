// @ts-nocheck
import { crawlWebsite } from './crawler';
import { detectWebsite } from './detection';
import { classifyIndustry } from './industryProfiles';

export async function analyzeCompetitors(urls = []) {
  const max = Math.max(0, Math.min(Number(process.env.ANALYZER_MAX_COMPETITORS || 3), 3));
  const cleaned = [...new Set(urls.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, max);
  const settled = await Promise.allSettled(cleaned.map(async (url) => {
    const crawl = await crawlWebsite(url, { maxPages: 4 });
    const detection = detectWebsite(crawl);
    const text = crawl.pages.map((page) => `${page.title} ${page.metaDescription} ${page.headings.map((heading) => heading.text).join(' ')} ${page.text.slice(0, 20000)}`).join('\n');
    const classification = classifyIndustry(text);
    return {
      url: crawl.finalUrl,
      hostname: new URL(crawl.finalUrl).hostname.replace(/^www\./, ''),
      industry: classification.profile.name,
      subindustry: classification.subindustry?.name || '',
      pagesAnalyzed: crawl.pages.length,
      features: detection.features,
      technologies: detection.technologies.map((item) => item.name),
      tracking: detection.tracking,
    };
  }));
  return settled.map((result, index) => result.status === 'fulfilled' ? result.value : {
    url: cleaned[index], hostname: safeHost(cleaned[index]), error: result.reason?.message || 'Competitor could not be analyzed.', features: {}, technologies: [], tracking: {}, pagesAnalyzed: 0,
  });
}

function safeHost(value) {
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname; } catch { return value; }
}
