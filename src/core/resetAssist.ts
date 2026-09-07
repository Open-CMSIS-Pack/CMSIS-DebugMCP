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
 * Pure helpers for the `reset` tool: which GDB monitor commands to send for a
 * given server + reset method, and how to tell which GDB server is behind the
 * session. Kept free of vscode/DAP imports so the mapping is unit-testable.
 */

export type ResetMethod = 'system' | 'core' | 'hardware';
export type GdbServerKind = 'pyocd' | 'jlink' | 'unknown';

/**
 * Build the GDB monitor command(s) for a target reset.
 *
 * pyOCD accepts OpenOCD-style `monitor reset [run|halt|init] [system|core|hardware]`
 * (system = SYSRESETREQ, core = VECTRESET, hardware = nSRST). J-Link accepts
 * `monitor reset [N]` where 0 = normal (uses nSRST when wired, i.e. the
 * hardware path) and 1 = core only; halt is a separate monitor command.
 * Unknown servers get the pyOCD form — pyOCD is the common case for CMSIS
 * gdbtarget sessions, and an unrecognized reply is handled by the caller.
 */
export function buildResetCommands(server: GdbServerKind, method: ResetMethod, halt: boolean): string[] {
    if (server === 'jlink') {
        const type = method === 'core' ? 1 : 0;
        return halt ? ['monitor halt', `monitor reset ${type}`] : [`monitor reset ${type}`];
    }
    return [`monitor reset ${halt ? 'halt' : 'run'} ${method}`];
}

/**
 * Identify the GDB server behind a debug session from configuration/name
 * text (e.g. `configuration.target.server`, `configuration.debugger.name`,
 * session name). Callers concatenate whatever fields they have.
 */
export function detectGdbServerKind(haystack: string): GdbServerKind {
    const s = haystack.toLowerCase();
    if (s.includes('pyocd')) { return 'pyocd'; }
    if (s.includes('jlink') || s.includes('j-link')) { return 'jlink'; }
    return 'unknown';
}

/**
 * True when a monitor-command reply reads like "this server does not know
 * that command" — the signal to escalate to the next reset method rather
 * than trusting the reset happened.
 */
export function replyLooksUnsupported(reply: string): boolean {
    return /unknown (monitor )?command|unrecognized|invalid (command|argument|usage)|not supported|syntax error/i.test(reply);
}

/**
 * The verification detail for a reset command the adapter did not know:
 * says whether another method follows, so the last (or only) method never
 * promises a "next" that is not coming.
 */
export function unsupportedResetDetail(method: ResetMethod, remaining: number): string {
    return remaining > 0
        ? `adapter did not recognize the ${method} reset command — trying the next method`
        : `adapter did not recognize the ${method} reset command; no further method to try`;
}

/** What `resetTarget` found out, rendered by `renderResetOutcome`. */
export interface ResetOutcomeView {
    serverKind: GdbServerKind;
    methodsTried: ResetMethod[];
    commandsIssued: string[];
    replies: string[];
    verified: boolean;
    verificationDetail: string;
    /** True when the target was running and the tool halted it to issue the reset. */
    haltedByUs: boolean;
    /** True when the tool resumed the target afterwards (`halt: false` on a verified reset). */
    resumed: boolean;
}

/**
 * The `reset` tool's result text. Tells the truth about the end state: an
 * unverified reset leaves the target halted — and says so, including that
 * `halt: false` was not applied and whether the target was running before.
 */
export function renderResetOutcome(outcome: ResetOutcomeView, halt: boolean | undefined): string {
    const commandsLine = outcome.commandsIssued.length > 0
        ? ` Commands: ${outcome.commandsIssued.map(c => `'${c}'`).join(', ')} (server: ${outcome.serverKind}).`
        : '';
    if (outcome.verified) {
        const next = outcome.resumed
            ? ' Target resumed (halt=false).'
            : ' Target is halted at the reset vector — use continue_execution to run.';
        return `Target reset verified. ${outcome.verificationDetail}. ` +
            `Method(s) tried: ${outcome.methodsTried.join(', ')}.${commandsLine}${next}`;
    }
    const before = outcome.haltedByUs ? ' (it was running before the reset)' : '';
    const notApplied = halt === false ? '; halt=false was not applied because the reset could not be verified' : '';
    return `⚠️ Reset was issued but the target does NOT appear to have reset. ${outcome.verificationDetail}. ` +
        `Method(s) tried: ${outcome.methodsTried.join(', ')}.${commandsLine} ` +
        `The target is halted${before}${notApplied} — use continue_execution to run. ` +
        `'hardware' requires nSRST wired from probe to target — if it is not connected, no software reset can ` +
        `recover this; power-cycle the board or reconnect the probe. ` +
        `Adapter replies: ${outcome.replies.join(' | ') || '<none>'}`;
}
