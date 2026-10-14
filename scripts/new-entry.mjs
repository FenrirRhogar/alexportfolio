#!/usr/bin/env node
// Scaffolds a new content entry (design / motion / fineart) from a few
// prompts: generates the slug, writes a correctly-shaped frontmatter file,
// and creates the matching public/media/ folder — so adding a project
// never starts from a blank YAML block or copying an old file by hand.
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const rl = createInterface({ input: process.stdin });
// driving the async iterator directly instead of rl.question() — on this
// Node version, a second rl.question() call on piped/non-TTY stdin never
// resolves (reproducible, isolated separately); iterating lines does not
const lines = rl[Symbol.asyncIterator]();

async function ask(question, { default: def = '', required = false } = {}) {
  const suffix = def ? ` (${def})` : '';
  while (true) {
    process.stdout.write(`${question}${suffix}: `);
    const { value, done } = await lines.next();
    const answer = (value ?? '').trim();
    if (done) return def;
    if (answer) return answer;
    if (def) return def;
    if (!required) return '';
    console.log('  → required, please enter a value.');
  }
}

async function askYesNo(question, { default: def = false } = {}) {
  const hint = def ? 'Y/n' : 'y/N';
  const answer = (await ask(`${question} (${hint})`)).toLowerCase();
  if (!answer) return def;
  return answer === 'y' || answer === 'yes';
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueSlug(base, dir) {
  let slug = base;
  let n = 2;
  while (existsSync(join(dir, `${slug}.md`))) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

function nextOrder(dir) {
  if (!existsSync(dir)) return 1;
  let max = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const match = readFileSync(join(dir, file), 'utf8').match(/^order:\s*(\d+)/m);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function yamlStr(str) {
  return `"${str.replace(/"/g, '\\"')}"`;
}

async function buildDesign(title, slug, order) {
  const client = await ask('Client');
  const year = await ask('Year (e.g. 2026)');
  const category = await ask('Category (e.g. "Brand Identity", "Poster Design")', { required: true });
  const summary = await ask('One-sentence summary', { required: true });
  const tags = await ask('Tags (comma-separated, optional)');
  const featured = await askYesNo('Feature on homepage?');

  const tagList = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const mediaDir = `/media/design/${slug}`;
  const frontmatter = [
    `title: ${yamlStr(title)}`,
    client && `client: ${yamlStr(client)}`,
    year && `year: ${yamlStr(year)}`,
    `category: ${yamlStr(category)}`,
    `summary: ${yamlStr(summary)}`,
    `cover: "${mediaDir}/cover.jpg"`,
    `# gallery:`,
    `#   - "${mediaDir}/gallery-1.jpg"`,
    `tags: [${tagList.map(yamlStr).join(', ')}]`,
    `featured: ${featured}`,
    `order: ${order}`,
  ].filter(Boolean);

  return {
    mediaDirFs: `public${mediaDir}`,
    content: `---\n${frontmatter.join('\n')}\n---\n\n${summary}\n`,
    nextSteps: [`Drop the cover image at public${mediaDir}/cover.jpg`],
  };
}

async function buildMotion(title, slug, order) {
  const role = await ask('Role (e.g. "Editor", "3D Animation")');
  const year = await ask('Year (e.g. 2026)');
  const summary = await ask('One-sentence summary', { required: true });
  const vertical = await askYesNo('Vertical video (9:16)?', { default: true });
  const featured = await askYesNo('Feature on homepage?');

  const mediaDir = `/media/motion/${slug}`;
  const frontmatter = [
    `title: ${yamlStr(title)}`,
    role && `role: ${yamlStr(role)}`,
    year && `year: ${yamlStr(year)}`,
    `summary: ${yamlStr(summary)}`,
    `poster: "${mediaDir}-poster.jpg"`,
    `video: "${mediaDir}.mp4"`,
    `# videoWebm: "${mediaDir}.webm"`,
    `vertical: ${vertical}`,
    `featured: ${featured}`,
    `order: ${order}`,
  ].filter(Boolean);

  return {
    mediaDirFs: `public/media/motion`,
    content: `---\n${frontmatter.join('\n')}\n---\n\n${summary}\n`,
    nextSteps: [
      `Drop the poster image at public${mediaDir}-poster.jpg`,
      `Drop the video at public${mediaDir}.mp4`,
    ],
  };
}

async function buildFineart(title, slug, order) {
  const medium = await ask('Medium (e.g. "Oil on canvas")', { required: true });
  const dimensions = await ask('Dimensions (optional)');
  const year = await ask('Year (optional)');
  const status = await ask('Status (Available / Sold / Private Collection, optional)');
  const summary = await ask('Summary (optional)');
  const featured = await askYesNo('Feature on homepage?');

  const mediaDir = `/media/fineart/${slug}`;
  const frontmatter = [
    `title: ${yamlStr(title)}`,
    `medium: ${yamlStr(medium)}`,
    dimensions && `dimensions: ${yamlStr(dimensions)}`,
    year && `year: ${yamlStr(year)}`,
    status && `status: ${yamlStr(status)}`,
    summary && `summary: ${yamlStr(summary)}`,
    `image: "${mediaDir}.jpg"`,
    `# gallery:`,
    `#   - "${mediaDir}-2.jpg"`,
    `featured: ${featured}`,
    `order: ${order}`,
  ].filter(Boolean);

  return {
    mediaDirFs: `public/media/fineart`,
    content: `---\n${frontmatter.join('\n')}\n---\n\n${summary || ''}\n`,
    nextSteps: [`Drop the image at public${mediaDir}.jpg`],
  };
}

const BUILDERS = { design: buildDesign, motion: buildMotion, fineart: buildFineart };

async function main() {
  const collection = (process.argv[2] || (await ask('Collection (design/motion/fineart)', { required: true }))).toLowerCase();
  const build = BUILDERS[collection];
  if (!build) {
    console.error(`Unknown collection "${collection}" — expected design, motion, or fineart.`);
    process.exit(1);
  }

  const contentDir = join(ROOT, 'src', 'content', collection);
  const order = nextOrder(contentDir);

  const title = await ask('Title', {
    required: collection !== 'fineart',
    default: collection === 'fineart' ? 'Untitled' : '',
  });
  const slug = uniqueSlug(slugify(title) || 'untitled', contentDir);

  console.log(`\nNew ${collection} entry → ${slug}\n`);

  const result = await build(title, slug, order);

  mkdirSync(contentDir, { recursive: true });
  mkdirSync(join(ROOT, result.mediaDirFs), { recursive: true });
  writeFileSync(join(contentDir, `${slug}.md`), result.content);

  console.log(`\n✓ Created src/content/${collection}/${slug}.md`);
  console.log(`✓ Created ${result.mediaDirFs}/`);
  console.log('\nNext steps:');
  for (const step of result.nextSteps) console.log(`  - ${step}`);
  console.log('  - Open the new .md file to fill in anything left as a comment (gallery, etc.)');
  console.log('  - See CONTENT.md for the full field reference (booklets, trifolds, gallery)\n');

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
