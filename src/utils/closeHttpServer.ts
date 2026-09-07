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

import type * as http from 'http';

/**
 * Close an HTTP server within a bound. `server.close()` alone waits for every
 * open connection — an in-flight forwarded op, an MCP notification stream, an
 * idle keep-alive socket — and `deactivate` awaits this. Idle sockets go at
 * once; the rest are destroyed after `graceMs`.
 */
export function closeHttpServer(server: http.Server, graceMs = 2_000): Promise<void> {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(() => server.closeAllConnections(), graceMs);
        timer.unref();
        server.close(() => {
            clearTimeout(timer);
            resolve();
        });
        server.closeIdleConnections();
    });
}
