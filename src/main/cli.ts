#!/usr/bin/env node
/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { runCommand } from "./command.ts";

process.exitCode = await runCommand();

