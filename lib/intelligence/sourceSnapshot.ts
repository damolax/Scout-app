// @ts-nocheck
export function createSourceSnapshot(crawl, extras = {}) {
  return {
    crawl: {
      requestedUrl: crawl.requestedUrl,
      finalUrl: crawl.finalUrl,
      origin: crawl.origin,
      robotsFound: crawl.robotsFound,
      sitemapUrlCount: crawl.sitemapUrlCount,
      crawledAt: crawl.crawledAt,
      failures: crawl.failures || [],
      pages: (crawl.pages || []).map((page) => ({
        url: page.url,
        path: page.path,
        pageType: page.pageType,
        title: page.title,
        metaDescription: page.metaDescription,
        lang: page.lang,
        text: String(page.text || '').slice(0, 50_000),
        headings: (page.headings || []).slice(0, 100),
        buttons: (page.buttons || []).slice(0, 200),
        forms: (page.forms || []).slice(0, 30),
        images: (page.images || []).slice(0, 100),
        links: (page.links || []).slice(0, 300),
        scripts: [],
        jsonLd: [],
        htmlSample: '',
        headers: page.headers || {},
        responseMs: page.responseMs,
        htmlBytes: page.htmlBytes,
      })),
    },
    detection: extras.detection || null,
    competitors: extras.competitors || [],
    pageSpeed: extras.pageSpeed || null,
  };
}
