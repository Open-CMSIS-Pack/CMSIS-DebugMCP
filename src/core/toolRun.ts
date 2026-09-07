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

/**
 * The timeout fence and trace shared by the documentation and build-artefact
 * handlers: one tool call logs its arguments, its duration and the size of
 * its result, and a timeout becomes a message instead of a hung call. The
 * call keeps running after the timer wins — the next call picks its result
 * up from the cache — and stays observed, so a late failure is logged rather
 * than surfacing as an unhandled rejection in the extension host.
 */

import { PackDocsLog, prefixedLog } from './packDocs/host';

export interface ToolRunOptions {
    /** Applies when the call names no `timeoutMs`. */
    defaultTimeoutMs: number;
    /** Appended to the timeout message: what the caller should do next. */
    timeoutNote: string;
}

/** Per-call `timeoutMs` clamped to 100 ms … 10 min, else the default. */
export function toolTimeoutMs(args: object, defaultTimeoutMs: number): number {
    const requested = (args as { timeoutMs?: number }).timeoutMs;
    return requested ? Math.min(Math.max(requested, 100), 600_000) : defaultTimeoutMs;
}

export async function runTool(
    tool: string,
    call: number,
    args: object,
    log: PackDocsLog,
    options: ToolRunOptions,
    body: (log: PackDocsLog, deadline: number) => Promise<string>,
): Promise<string> {
    const scoped = prefixedLog(log, `[${tool} #${call}]`);
    const timeoutMs = toolTimeoutMs(args, options.defaultTimeoutMs);
    const started = Date.now();
    scoped.info(`→ ${JSON.stringify(args)}`);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<string>(resolve => {
        timer = setTimeout(() => resolve(`${tool} timed out after ${timeoutMs} ms. ${options.timeoutNote}`), timeoutMs);
    });
    const work = body(scoped, started + timeoutMs);
    // A second observer: when the timer wins the race below no longer
    // handles `work`, and its later rejection would be unhandled.
    work.catch(e => scoped.debug(`finished after the timeout: ${e instanceof Error ? e.message : String(e)}`));
    try {
        const result = await Promise.race([work, timeout]);
        const ms = Date.now() - started;
        scoped.info(`← ${ms} ms, ${Buffer.byteLength(result)} bytes`);
        scoped.debug(`result:\n${result.split('\n').slice(0, 30).map(l => '    ' + l).join('\n')}${result.split('\n').length > 30 ? '\n    …' : ''}`);
        return result;
    } catch (e) {
        scoped.error(`failed after ${Date.now() - started} ms`, e);
        return `${tool} failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
        if (timer) { clearTimeout(timer); }
    }
}
