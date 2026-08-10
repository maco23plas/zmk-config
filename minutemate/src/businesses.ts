import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

const BusinessSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  keywords: z.array(z.string()).default([]),
  emails: z.array(z.string()).default([]),
  slack_webhook: z.string().default(''),
  weekly_report: z.boolean().default(true),
});
const FileSchema = z.object({ businesses: z.array(BusinessSchema).default([]) });

export type Business = z.infer<typeof BusinessSchema>;

const FILE = path.resolve('businesses.yaml');
let cache: { mtime: number; list: Business[] } | null = null;

export function getBusinesses(): Business[] {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (!cache || cache.mtime !== mtime) {
      const parsed = FileSchema.parse(YAML.parse(fs.readFileSync(FILE, 'utf8')));
      cache = { mtime, list: parsed.businesses };
    }
    return cache.list;
  } catch {
    return [];
  }
}

export function findBusiness(name: string | null | undefined): Business | undefined {
  if (!name) return undefined;
  return getBusinesses().find((b) => b.name === name);
}
