import { slug } from '@/lib/util';
import type { Config } from '../types';

export async function handle(c: Config) {
  return slug(c.name);
}
