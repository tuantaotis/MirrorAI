#!/usr/bin/env node
/**
 * MirrorAI CLI — Main entry point.
 * Commands: init, ingest, status, mirror
 */

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { ingestCommand } from "./commands/ingest.js";
import { statusCommand } from "./commands/status.js";
import { mirrorCommand } from "./commands/mirror.js";
import { setupCommand } from "./commands/setup.js";
import { doctorCommand } from "./commands/doctor.js";

const program = new Command();

program
  .name("mirrorai")
  .description("MirrorAI — Create an AI clone of yourself from your chat data")
  .version("1.0.0");

program.addCommand(initCommand);
program.addCommand(ingestCommand);
program.addCommand(statusCommand);
program.addCommand(mirrorCommand);
program.addCommand(setupCommand);
program.addCommand(doctorCommand);

program.parse();
