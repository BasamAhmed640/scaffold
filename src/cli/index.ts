#!/usr/bin/env node
import { runCli } from './run.js';

const code = await runCli(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s + '\n'),
  stderr: (s) => process.stderr.write(s + '\n'),
  env: process.env,
});
process.exitCode = code;
