import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const design = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/design' }),
  schema: z.object({
    title: z.string(),
    client: z.string().optional(),
    year: z.string().optional(),
    category: z.string(),
    summary: z.string(),
    cover: z.string(),
    gallery: z.array(z.string()).default([]),
    booklets: z
      .array(
        z.object({
          title: z.string(),
          pdf: z.string().optional(),
          width: z.number(),
          height: z.number(),
          pages: z.array(z.string()),
        }),
      )
      .default([]),
    // a trifold is one sheet printed on both sides and folded into three —
    // not a sequence of pages, so it gets its own "two flat sides" display
    // rather than the page-flip treatment `booklets` gives real booklets
    trifolds: z
      .array(
        z.object({
          title: z.string(),
          outside: z.string(),
          inside: z.string(),
        }),
      )
      .default([]),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

const motion = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/motion' }),
  schema: z.object({
    title: z.string(),
    role: z.string().optional(),
    year: z.string().optional(),
    summary: z.string(),
    poster: z.string(),
    video: z.string(),
    videoWebm: z.string().optional(),
    vertical: z.boolean().default(true),
    featured: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

const fineart = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/fineart' }),
  schema: z.object({
    title: z.string(),
    medium: z.string(),
    dimensions: z.string().optional(),
    year: z.string().optional(),
    status: z.string().optional(),
    summary: z.string().optional(),
    image: z.string(),
    gallery: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

export const collections = { design, motion, fineart };
