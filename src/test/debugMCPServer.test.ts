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
import { isLoopbackHostHeader, isLoopbackOrigin } from '../debugMCPServer';

/**
 * The DNS-rebinding defence: a web page on attacker.com that resolves the
 * name to 127.0.0.1 reaches the MCP port with Host: attacker.com and an
 * Origin of its own — both must be refused; every local client passes.
 */
suite('DebugMCPServer loopback guards', () => {
    test('isLoopbackHostHeader accepts localhost and the loopback literals, with or without a port', () => {
        for (const host of ['localhost', 'localhost:3001', 'LOCALHOST:3001', '127.0.0.1', '127.0.0.1:3001', '[::1]', '[::1]:3001']) {
            assert.ok(isLoopbackHostHeader(host), host);
        }
    });

    test('isLoopbackHostHeader refuses a missing, empty, foreign or look-alike host', () => {
        for (const host of [undefined, null, '', 42, 'attacker.com', 'attacker.com:3001', '127.0.0.1.attacker.com', 'localhost.attacker.com', '10.0.0.1:3001' ]) {
            assert.ok(!isLoopbackHostHeader(host), String(host));
        }
    });

    test('isLoopbackOrigin accepts loopback origins and refuses everything else', () => {
        for (const origin of ['http://localhost:5173', 'https://127.0.0.1', 'http://[::1]:3001', 'http://localhost']) {
            assert.ok(isLoopbackOrigin(origin), origin);
        }
        for (const origin of ['null', 'http://attacker.com', 'http://localhost.attacker.com', 'http://127.0.0.1.attacker.com', 'not a url', '']) {
            assert.ok(!isLoopbackOrigin(origin), origin);
        }
    });
});
