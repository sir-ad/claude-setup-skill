#!/usr/bin/env node
import { parseArgs } from './helpers/args.js';
import { say } from './helpers/output.js';
import { PROMPT } from './helpers/prompt.js';

const opts = parseArgs(process.argv.slice(2));
say(`${PROMPT} ${opts.name}`);
