// A tiny frontmatter reader/writer, in place of gray-matter — gray-matter
// pulls in an old js-yaml via a vulnerable argparse/sprintf-js chain
// (GHSA-hp3w-g68c-fv3c) that hasn't been updated upstream. The actively
// maintained `yaml` package plus ~15 lines of splitting does the same job.
import { parse, stringify } from 'yaml';

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function readFrontmatter(raw) {
  const match = raw.match(FENCE);
  if (!match) return { data: {}, content: raw.trim() };
  const data = parse(match[1]) || {};
  return { data, content: match[2].trim() };
}

export function writeFrontmatter(data, content) {
  const yaml = stringify(data, { lineWidth: 0 });
  return `---\n${yaml}---\n\n${content || ''}\n`;
}
