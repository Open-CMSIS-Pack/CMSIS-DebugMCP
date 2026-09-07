/**
 * Copyright 2026 Arm Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from 'fs';
import { writeFileAtomic } from './atomicFile';

export type JsonRewriteOutcome = 'written' | 'unchanged' | 'unparseable';

/**
 * Read-modify-write of a JSON file that another process may be writing too
 * (`~/.claude.json` is rewritten by Claude Code all the time). `mutate` gets a
 * fresh parse and returns whether it changed anything; the file is re-read
 * immediately before the write and, if it changed underneath, the whole
 * step is retried on the new content — up to `attempts` times. Unrelated
 * keys are preserved because the parsed object is written back whole; an
 * unparseable file is never overwritten.
 */
export async function rewriteJsonFile(
    file: string,
    mutate: (config: Record<string, unknown>) => boolean | Promise<boolean>,
    options: { attempts?: number } = {},
): Promise<JsonRewriteOutcome> {
    const attempts = options.attempts ?? 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
        const before = await fs.promises.readFile(file, 'utf8');
        let config: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(before);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return 'unparseable'; }
            config = parsed as Record<string, unknown>;
        } catch {
            return 'unparseable';
        }
        if (!(await mutate(config))) { return 'unchanged'; }
        const now = await fs.promises.readFile(file, 'utf8').catch(() => before);
        if (now !== before) { continue; } // someone wrote in between — redo on their content
        await writeFileAtomic(file, JSON.stringify(config, null, 2));
        return 'written';
    }
    throw new Error(`${file} changed underneath the write ${attempts} times; not written`);
}
