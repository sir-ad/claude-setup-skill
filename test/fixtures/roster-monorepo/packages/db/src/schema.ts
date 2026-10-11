import { pgTable, text } from 'drizzle-orm/pg-core';
export const t = pgTable('t', { id: text('id') });
