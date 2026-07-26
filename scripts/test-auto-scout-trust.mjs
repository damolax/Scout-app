import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

let ts;
try {
  ts = (await import('typescript')).default;
} catch {
  const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  ts = (await import(pathToFileURL(path.join(globalRoot, 'typescript/lib/typescript.js')).href)).default;
}

const root = process.cwd();
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();

function loadTs(relativePath) {
  const file = path.resolve(root, relativePath);
  if (cache.has(file)) return cache.get(file).exports;
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: file,
  }).outputText;
  const module = { exports: {} };
  cache.set(file, module);
  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      let target = path.resolve(path.dirname(file), specifier);
      if (!path.extname(target)) target += '.ts';
      return loadTs(path.relative(root, target));
    }
    return nativeRequire(specifier);
  };
  const wrapper = vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename: file });
  wrapper(localRequire, module, module.exports);
  return module.exports;
}

const { validateEmailCandidate, findEmailCandidates } = loadTs('lib/email-candidate-rules.ts');
const { isBlockedAutoScoutHost } = loadTs('lib/auto-scout-target.ts');
const checks = [];
function check(label, ok, detail = '') {
  checks.push({ label, ok: Boolean(ok), detail });
}

const business = {
  name: 'Innovative Living Solutions',
  website: 'https://innovativelivingsolutions.ca',
  domain: 'innovativelivingsolutions.ca',
};
const real = validateEmailCandidate(
  { email: 'contact@innovativelivingsolutions.ca', sourceField: 'contact-page', sourceText: 'Contact us at contact@innovativelivingsolutions.ca' },
  business,
  'https://innovativelivingsolutions.ca/contact',
  false,
);
check('Real same-domain contact email is promoted', real.valid && real.promote && real.quality === 'domain_match', JSON.stringify(real));

const wikipediaFake = validateEmailCandidate(
  { email: 'cre@ivecommons.org', sourceField: 'page-text', sourceText: 'cre@ivecommons.org' },
  { name: 'Wikipedia', website: 'https://wikipedia.org', domain: 'wikipedia.org' },
  'https://wikipedia.org/wiki/example',
  false,
);
check('Wikipedia-style false candidate is not promoted', !wikipediaFake.promote, JSON.stringify(wikipediaFake));

const forbesFake = validateEmailCandidate(
  { email: 'js.d@adome.co', sourceField: 'page-text', sourceText: 'javascript asset js.d@adome.co' },
  { name: 'Forbes', website: 'https://forbes.com', domain: 'forbes.com' },
  'https://forbes.com/example',
  false,
);
check('Forbes/ad-code false candidate is rejected', !forbesFake.valid || !forbesFake.promote, JSON.stringify(forbesFake));

const accidental = findEmailCandidates('Creative Commons text can be split as Cre at iveCommons dot org by HTML tags.');
check('Bare at/dot prose cannot manufacture an email', accidental.length === 0, JSON.stringify(accidental));

const explicit = findEmailCandidates('Email: contact [at] innovativelivingsolutions [dot] ca');
check('Explicit bracket obfuscation is still supported', explicit.some((item) => item.email === 'contact@innovativelivingsolutions.ca'), JSON.stringify(explicit));

const externalEvidence = validateEmailCandidate(
  { email: 'info@unrelated-domain.com', sourceField: 'page-text', sourceText: 'info@unrelated-domain.com' },
  business,
  'https://directory.example/contact',
  false,
);
check('External evidence cannot promote an unrelated domain', !externalEvidence.promote, JSON.stringify(externalEvidence));

for (const host of ['wikipedia.org', 'www.forbes.com', 'shopify.com', 'medium.com']) {
  check(`Publisher/platform target blocked: ${host}`, isBlockedAutoScoutHost(host));
}

const finderSource = fs.readFileSync(path.join(root, 'lib/website-email-finder.ts'), 'utf8');
check('Fetched-page budget ignores failed guessed URLs', finderSource.includes('while (fetchedPages < maxPages && attempts < maxAttempts') && finderSource.includes('fetchedPages += 1'));
check('Discovered contact links outrank guessed paths', finderSource.includes('65 + keywordScore + shortPathScore') && finderSource.includes('queue.get(candidate) || 0, 18'));

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
console.log(`\n${checks.length - failures.length}/${checks.length} Auto Scout trust checks passed.`);
if (failures.length) process.exit(1);
