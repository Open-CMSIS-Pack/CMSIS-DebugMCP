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
import { serialController } from '../core/serialController';

/** Inject a fake port into the singleton (it has no port factory to swap). */
function injectPort(close: (cb: (err?: Error | null) => void) => void): void {
    const c = serialController as unknown as { port: unknown; openedAt: Date | null; currentPath: string | null; currentBaud: number | null };
    c.port = { isOpen: true, close };
    c.openedAt = new Date();
    c.currentPath = '/dev/tty.fake';
    c.currentBaud = 115200;
}

suite('serialController close', () => {
    test('a port whose close fails (adapter unplugged) is forgotten, so the next open works', async () => {
        injectPort(cb => cb(new Error('EIO: device gone')));
        assert.ok(serialController.isOpen());
        await assert.rejects(() => serialController.close(), /EIO/);
        assert.strictEqual(serialController.isOpen(), false);
        const status = serialController.status();
        assert.strictEqual(status.open, false);
        assert.strictEqual(status.path, null);
        assert.strictEqual(status.baudRate, null);
        assert.strictEqual(status.openedAt, null);
    });

    test('a port that closes cleanly ends in the same state', async () => {
        injectPort(cb => cb(null));
        await serialController.close();
        assert.strictEqual(serialController.isOpen(), false);
        assert.strictEqual(serialController.status().path, null);
        await serialController.close(); // idempotent
    });
});
