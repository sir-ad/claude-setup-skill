import fs from 'node:fs';
import React from 'react';
import { Button } from '@acme/ui';
import { slug } from '@/lib/util';
import { handle } from './api';
export * from './types.js';

const lazy = () => import('./lazy');
const legacy = require('./lib/legacy');

export function main() {
  return [fs, React, Button, slug, handle, lazy, legacy];
}
export default main;
