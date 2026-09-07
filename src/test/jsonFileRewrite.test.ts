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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { rewriteJsonFile } from '../utils/jsonFileRewrite';
import { writeFileAtomic, writeFileAtomicSync } from '../utils/atomicFile';

suite('jsonFileRewrite', () => {
    let dir: string;
    let file: string;
    setup(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-rewrite-'));
        file = path.join(dir, 'config.json');
        fs.writeFileSync(file, JSON.stringify({ history: [1, 2, 3], mcpServers: { other: { url: 'x' } } }, null, 2));
    });
    teardown(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    test('a rewrite preserves unrelated keys and leaves no temp file', async () => {
        const outcome = await rewriteJsonFile(file, (config) => {
            (config.mcpServers as Record<string, unknown>).mine = { url: 'y' };
            return true;
        });
        assert.strictEqual(outcome, 'written');
        const back = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepStrictEqual(back, { history: [1, 2, 3], mcpServers: { other: { url: 'x' }, mine: { url: 'y' } } });
        assert.deepStrictEqual(fs.readdirSync(dir), ['config.json']);
    });

    test('an unchanged file is not rewritten at all', async () => {
        const before = fs.statSync(file).mtimeMs;
        await new Promise(r => setTimeout(r, 20));
        assert.strictEqual(await rewriteJsonFile(file, () => false), 'unchanged');
        assert.strictEqual(fs.statSync(file).mtimeMs, before);
    });

    test('a concurrent writer between read and write is noticed, and the update lands on their content', async () => {
        let calls = 0;
        const outcome = await rewriteJsonFile(file, async (config) => {
            calls++;
            if (calls === 1) {
                // Someone else (Claude Code) rewrites the file while we are mutating our copy.
                const theirs = JSON.parse(fs.readFileSync(file, 'utf8'));
                theirs.history.push(4);
                writeFileAtomicSync(file, JSON.stringify(theirs));
            }
            (config.mcpServers as Record<string, unknown>).mine = { url: 'y' };
            return true;
        });
        assert.strictEqual(outcome, 'written');
        assert.strictEqual(calls, 2, 'retried on the new content');
        const back = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepStrictEqual(back.history, [1, 2, 3, 4], 'their change survives');
        assert.deepStrictEqual(back.mcpServers.mine, { url: 'y' }, 'and so does ours');
    });

    test('an unparseable or non-object file is never overwritten', async () => {
        fs.writeFileSync(file, '{"history": [1,');
        assert.strictEqual(await rewriteJsonFile(file, () => true), 'unparseable');
        assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"history": [1,');
        fs.writeFileSync(file, '[1, 2]');
        assert.strictEqual(await rewriteJsonFile(file, () => true), 'unparseable');
    });

    test('a file that keeps changing underneath is given up on', async () => {
        await assert.rejects(rewriteJsonFile(file, async () => {
            await writeFileAtomic(file, JSON.stringify({ history: [Math.random()] }));
            return true;
        }, { attempts: 3 }), /changed underneath the write 3 times/);
    });
});
