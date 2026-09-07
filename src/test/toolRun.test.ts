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

import * as assert from 'assert';
import { PackDocsLog } from '../core/packDocs/host';
import { runTool, toolTimeoutMs } from '../core/toolRun';

suite('toolRun', () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    let lines: string[];
    const log: PackDocsLog = {
        debug: (m) => lines.push(`D ${m}`), info: (m) => lines.push(`I ${m}`), warn: (m) => lines.push(`W ${m}`),
        error: (m, e) => lines.push(`E ${m} ${e instanceof Error ? e.message : e ?? ''}`),
    };
    const options = { defaultTimeoutMs: 20, timeoutNote: 'NOTE' };
    let unhandled: unknown[];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    setup(() => { lines = []; unhandled = []; process.on('unhandledRejection', onUnhandled); });
    teardown(() => { process.off('unhandledRejection', onUnhandled); });

    test('a body that rejects after the timeout is logged, not left unhandled', async () => {
        const result = await runTool('x', 1, {}, log, options, () => new Promise((_r, reject) => setTimeout(() => reject(new Error('late')), 40)));
        assert.match(result, /^x timed out after 20 ms\. NOTE$/);
        await sleep(80);
        assert.deepStrictEqual(unhandled, []);
        assert.ok(lines.some(l => /^D \[x #1\] finished after the timeout: late$/.test(l)), lines.join('\n'));
    });

    test('a rejection before the timer is the failure text', async () => {
        const result = await runTool('x', 2, {}, log, options, async () => { throw new Error('boom'); });
        assert.strictEqual(result, 'x failed: boom');
        assert.ok(lines.some(l => /^E \[x #2\] failed after \d+ ms boom$/.test(l)), lines.join('\n'));
    });

    test('a result is traced with its size, and the deadline is passed to the body', async () => {
        let deadline = 0;
        const t0 = Date.now();
        const result = await runTool('x', 3, { a: 1 }, log, { ...options, defaultTimeoutMs: 5000 }, async (_log, d) => { deadline = d; return 'ok'; });
        assert.strictEqual(result, 'ok');
        assert.ok(deadline >= t0 + 5000 && deadline <= Date.now() + 5000);
        assert.ok(lines.some(l => l === 'I [x #3] → {"a":1}'), lines.join('\n'));
        assert.ok(lines.some(l => /^I \[x #3\] ← \d+ ms, 2 bytes$/.test(l)), lines.join('\n'));
    });

    test('a per-call timeout is clamped to 100 ms … 10 min', () => {
        assert.strictEqual(toolTimeoutMs({ timeoutMs: 5 }, 999), 100);
        assert.strictEqual(toolTimeoutMs({ timeoutMs: 10_000_000 }, 999), 600_000);
        assert.strictEqual(toolTimeoutMs({ timeoutMs: 250 }, 999), 250);
        assert.strictEqual(toolTimeoutMs({}, 999), 999);
    });
});
