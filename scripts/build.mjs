import { readFile, writeFile, mkdir, rm, cp, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, 'dist');
const origin = 'https://moen-rho.vercel.app';
const source = await readFile(path.join(root, 'index.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const js = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!css || !js) throw new Error('The source page must contain one inline style and app script.');
if (!output.startsWith(root + path.sep) || path.basename(output) !== 'dist') {
  throw new Error('Refusing to remove a build directory outside this project.');
}
try {
  const existing = await lstat(output);
  if (existing.isSymbolicLink()) throw new Error('Refusing to replace a symlinked build directory.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
await writeFile(path.join(output, 'assets', 'site.css'), css.trim() + '\n');
await writeFile(path.join(output, 'assets', 'site.js'), js.trim() + '\n');

function makeDom(locale) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(source, {
    url: `${origin}/${locale}/`,
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.cancelAnimationFrame = () => {};
      window.requestAnimationFrame = () => 0;
    }
  });
  if (errors.length) throw new Error(`Rendering ${locale} failed: ${errors.map(e => e.message).join('; ')}`);
  return dom;
}

function htmlSnapshot(dom) {
  const html = dom.serialize().replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/assets/site.css">')
    .replace(/<script>[\s\S]*?<\/script>/, '<script src="/assets/site.js" defer></script>');
  if (!html.includes('<main id="main"') || !html.includes('rel="canonical"')) {
    throw new Error('A generated page is missing its content or canonical URL.');
  }
  return html;
}

const initial = makeDom('ar');
const slugs = initial.window.eval('courses.map(course => course.slug)');
const categoryIds = initial.window.eval('categories.map(category => category.id)');
initial.window.close();
const sections = ['', 'programs', 'research', 'kids', 'corporate-training', 'careers', 'about', 'contact', 'policies', 'graduates'];
const paths = [
  ...sections.map(section => section ? `/${section}/` : '/'),
  ...categoryIds.map(id => `/programs/category/${id}/`),
  ...slugs.map(slug => `/programs/${slug}/`)
];
const emitted = [];
for (const locale of ['ar', 'en']) {
  const dom = makeDom(locale);
  for (const route of paths) {
    const urlPath = `/${locale}${route}`;
    dom.window.eval('S.q = ""; S.cat = "all"; S.sort = "def"');
    dom.window.history.replaceState({}, '', urlPath);
    dom.window.eval('route()');
    dom.window.document.documentElement.classList.remove('js');
    const page = htmlSnapshot(dom);
    const destination = path.join(output, urlPath.slice(1), 'index.html');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, page);
    emitted.push(urlPath);
  }
  dom.window.close();
}

const xmlEscape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
  + emitted.map(urlPath => {
    const route = urlPath.replace(/^\/(ar|en)/, '') || '/';
    const links = ['ar', 'en'].map(locale => `    <xhtml:link rel="alternate" hreflang="${locale}" href="${xmlEscape(origin + '/' + locale + route)}"/>`).join('\n');
    return `  <url>\n    <loc>${xmlEscape(origin + urlPath)}</loc>\n${links}\n  </url>`;
  }).join('\n') + '\n</urlset>\n';
await writeFile(path.join(output, 'sitemap.xml'), sitemap);
await writeFile(path.join(output, 'robots.txt'), `User-agent: *\nAllow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
await writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="ar"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/ar/"><link rel="canonical" href="https://moen-rho.vercel.app/ar/"><title>مَعين للتعليم والتطوير المهني</title></head><body><a href="/ar/">انتقل إلى موقع مَعين</a></body></html>');
console.log(`Generated ${emitted.length} Arabic and English pages in ${output}`);
