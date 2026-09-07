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
import { isInsideAny } from '../core/buildInfo/glob';

suite('buildInfo isInsideAny', () => {
    let dir: string;
    setup(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inside-')); });
    teardown(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    test('a file inside a root, the root itself, and a prefix-sharing sibling', () => {
        const ws = path.join(dir, 'ws');
        fs.mkdirSync(path.join(ws, 'out'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'ws2'));
        assert.ok(isInsideAny(path.join(ws, 'out', 'build.log'), [ws]));
        assert.ok(isInsideAny(ws, [ws]));
        assert.ok(!isInsideAny(path.join(dir, 'ws2', 'x.log'), [ws]), 'ws2 is not inside ws');
        assert.ok(!isInsideAny(path.join(ws, '..', 'other.log'), [ws]));
        assert.ok(isInsideAny(path.join(dir, 'ws2', 'x.log'), [ws, path.join(dir, 'ws2')]), 'any root will do');
        assert.ok(!isInsideAny(path.join(ws, 'x.log'), []));
    });

    test('a symlink pointing out of the root is outside', function () {
        if (process.platform === 'win32') { this.skip(); }
        const ws = path.join(dir, 'ws');
        fs.mkdirSync(ws);
        fs.writeFileSync(path.join(dir, 'secret.log'), 'error: x\n');
        fs.symlinkSync(path.join(dir, 'secret.log'), path.join(ws, 'link.log'));
        assert.ok(!isInsideAny(path.join(ws, 'link.log'), [ws]));
    });
});
