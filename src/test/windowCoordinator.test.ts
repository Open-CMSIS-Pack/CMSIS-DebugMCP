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
import { WindowCoordinator } from '../windowCoordinator';
import { WorkspaceRegistry } from '../utils/workspaceRegistry';

suite('WindowCoordinator serial teardown', () => {
    let dir: string;
    setup(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmsis-coordinator-')); });
    teardown(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    test('dispose releases the serial backends of this window, whether or not it was the router', async () => {
        let calls = 0;
        const coordinator = new WindowCoordinator({
            port: 0, timeoutInSeconds: 1, hardwareTimeouts: {},
            registry: new WorkspaceRegistry(process.pid, dir),
            serialTeardown: async () => { calls++; },
        });
        assert.ok(!coordinator.isRouter(), 'never started: a worker');
        await coordinator.dispose();
        assert.strictEqual(calls, 1);
    });

    test('a teardown that never settles cannot hold deactivate', async () => {
        const coordinator = new WindowCoordinator({
            port: 0, timeoutInSeconds: 1, hardwareTimeouts: {},
            registry: new WorkspaceRegistry(process.pid, dir),
            serialTeardown: () => new Promise<void>(() => { /* wedged tty */ }),
        });
        const t0 = Date.now();
        await coordinator.dispose();
        const elapsed = Date.now() - t0;
        assert.ok(elapsed >= 1_900 && elapsed < 2_600, `dispose took ${elapsed} ms`);
    });

    test('a failing teardown is logged, not thrown', async () => {
        const coordinator = new WindowCoordinator({
            port: 0, timeoutInSeconds: 1, hardwareTimeouts: {},
            registry: new WorkspaceRegistry(process.pid, dir),
            serialTeardown: async () => { throw new Error('EIO'); },
        });
        await coordinator.dispose();
    });
});
