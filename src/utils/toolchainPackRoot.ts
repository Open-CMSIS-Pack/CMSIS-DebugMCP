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
 * The pack root the CMSIS Solution extension resolves
 * (`cmsis-csolution.getPackRootPath`: `$CMSIS_PACK_ROOT` or its OS default),
 * shared by the documentation tools and the SVD lookup so both look where
 * the panel installs packs.
 *
 * The answer is asked for once per window and memoised: every target
 * resolution and every SVD lookup consults it, and without the memo each
 * one paid an `executeCommand` round trip (an unregistered command rejects
 * at once; a registered one that never settles — the extension still
 * activating — costs the 3 s fence). A path answer is kept until an
 * extension or settings change invalidates it; "no answer" is retried after
 * a minute so a csolution extension that activates later is picked up.
 */

import * as vscode from 'vscode';
import { defaultPackRoot } from '../core/packDocs/cbuildRun';
import { withTimeout } from './timeout';
import { logger } from './logger';

const COMMAND = 'cmsis-csolution.getPackRootPath';
const ASK_TIMEOUT_MS = 3_000;
/** How long "the extension did not answer" is believed before asking again. */
export const NEGATIVE_TTL_MS = 60_000;

let cached: { promise: Promise<string | undefined>; at: number; answer?: string | undefined; settled: boolean } | undefined;
let outcomeLogged = false;

/** One ask; undefined when the extension is absent, slow, or answers with something other than a path. Never throws. */
async function ask(): Promise<string | undefined> {
    try {
        const answer = await withTimeout(`cmsis ${COMMAND}`, ASK_TIMEOUT_MS,
            Promise.resolve(vscode.commands.executeCommand(COMMAND)));
        return typeof answer === 'string' && answer.trim() ? answer.trim() : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The CMSIS Solution extension's pack root, memoised; undefined when it is
 * not active or did not answer (retried after {@link NEGATIVE_TTL_MS}).
 */
export function toolchainPackRoot(): Promise<string | undefined> {
    const now = Date.now();
    if (cached && (!cached.settled || cached.answer !== undefined || now - cached.at < NEGATIVE_TTL_MS)) {
        return cached.promise;
    }
    const entry: NonNullable<typeof cached> = { promise: ask(), at: now, settled: false };
    cached = entry;
    entry.promise = entry.promise.then((answer) => {
        entry.answer = answer;
        entry.settled = true;
        entry.at = Date.now();
        if (!outcomeLogged) {
            outcomeLogged = true;
            logger.info(answer
                ? `Pack root ${answer} (${COMMAND})`
                : `Pack root ${defaultPackRoot()} (${process.env.CMSIS_PACK_ROOT ? 'CMSIS_PACK_ROOT' : 'platform default'}; ` +
                    'the CMSIS Solution extension is not active or did not answer)');
        }
        return answer;
    });
    return entry.promise;
}

/** The toolchain's pack root when it answers, else `$CMSIS_PACK_ROOT` / the platform default. Never throws. */
export async function effectiveToolchainPackRoot(): Promise<string> {
    return (await toolchainPackRoot()) ?? defaultPackRoot();
}

/** Forget the memoised answer (and log the next outcome again). */
export function invalidateToolchainPackRoot(): void {
    cached = undefined;
    outcomeLogged = false;
}

/** Re-ask after the set of extensions or the relevant settings change. */
export function registerToolchainPackRootInvalidation(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.extensions.onDidChange(() => invalidateToolchainPackRoot()),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('cmsis-csolution') || e.affectsConfiguration('cmsis-developer-assistant.packDocs')) {
                invalidateToolchainPackRoot();
            }
        }),
    );
}
