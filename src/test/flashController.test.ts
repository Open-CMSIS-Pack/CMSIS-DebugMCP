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
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { flashWithPyocd, parsePyocdLoadOutput } from '../core/flashController';

/**
 * Test suite for pyOCD flash-output parsing. Strings mirror
 * pyocd/flash/loader.py completion and failure output.
 */
suite('flashController parsePyocdLoadOutput', () => {

    test('sector-erase completion yields bytes and rate', () => {
        const stdout = [
            '0001234 I Erasing sectors [0x00000000-0x00040000] [eraser]',
            '0002345 I Erased 262144 bytes (128 sectors), programmed 196608 bytes (48 pages), identical 0 bytes (0 pages) at 85.31 kB/s [loader]',
        ].join('\n');
        const parsed = parsePyocdLoadOutput(stdout, '');
        assert.strictEqual(parsed.programmedBytes, 196608);
        assert.strictEqual(parsed.kbps, 85.31);
        assert.strictEqual(parsed.errorLines.length, 0);
    });

    test('chip-erase completion yields bytes', () => {
        const stdout = '0001987 I Erased chip, programmed 524288 bytes (128 pages) at 120.05 kB/s [loader]';
        const parsed = parsePyocdLoadOutput(stdout, '');
        assert.strictEqual(parsed.programmedBytes, 524288);
        assert.strictEqual(parsed.kbps, 120.05);
    });

    test('empty output yields nulls, not zeros', () => {
        const parsed = parsePyocdLoadOutput('', '');
        assert.strictEqual(parsed.programmedBytes, null);
        assert.strictEqual(parsed.kbps, null);
        assert.deepStrictEqual(parsed.errorLines, []);
        assert.deepStrictEqual(parsed.tail, []);
    });

    test('traceback on stderr lands in errorLines', () => {
        const stderr = [
            'Traceback (most recent call last):',
            '  File "pyocd/probe/pydapaccess.py", line 100, in open',
            'pyocd.core.exceptions.ProbeError: No probe connected',
        ].join('\n');
        const parsed = parsePyocdLoadOutput('', stderr);
        assert.ok(parsed.errorLines.length >= 2, `expected error lines, got ${JSON.stringify(parsed.errorLines)}`);
        assert.ok(parsed.errorLines.some(l => /Traceback/.test(l)));
        assert.ok(parsed.errorLines.some(l => /No probe connected/i.test(l)));
        assert.strictEqual(parsed.programmedBytes, null);
    });

    test('errorLines keeps only the last 8 matches', () => {
        const stderr = Array.from({ length: 20 }, (_, i) => `error number ${i}`).join('\n');
        const parsed = parsePyocdLoadOutput('', stderr);
        assert.strictEqual(parsed.errorLines.length, 8);
        assert.strictEqual(parsed.errorLines[7], 'error number 19');
    });

    test('tail keeps the last 12 non-empty lines', () => {
        const stdout = Array.from({ length: 30 }, (_, i) => `line ${i}\n\n`).join('\n');
        const parsed = parsePyocdLoadOutput(stdout, '');
        assert.strictEqual(parsed.tail.length, 12);
        assert.strictEqual(parsed.tail[11], 'line 29');
        assert.strictEqual(parsed.tail[0], 'line 18');
    });
});

suite('flashWithPyocd kill escalation', () => {
    /** A child that answers `kill` the way `child_process` does, driven by the test. */
    function fakeChild(onKill: (child: FakeChild, signal: NodeJS.Signals) => void) {
        const child = Object.assign(new EventEmitter(), {
            stdout: new PassThrough(), stderr: new PassThrough(),
            exitCode: null as number | null, signalCode: null as NodeJS.Signals | null, killed: false,
            signals: [] as NodeJS.Signals[],
            kill(signal: NodeJS.Signals) { child.signals.push(signal); child.killed = true; onKill(child, signal); return true; },
        });
        return child;
    }
    type FakeChild = ReturnType<typeof fakeChild>;
    const spawnFake = (child: FakeChild) => ((() => child) as unknown as typeof spawn);
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    test('a child that honours SIGTERM is not SIGKILLed', async () => {
        const child = fakeChild((c, signal) => {
            if (signal === 'SIGTERM') { c.signalCode = 'SIGTERM'; setImmediate(() => c.emit('close', null)); }
        });
        const result = await flashWithPyocd('x.cbuild-run.yml', 20, { spawn: spawnFake(child), killGraceMs: 30 });
        assert.strictEqual(result.timedOut, true);
        await sleep(80);
        assert.deepStrictEqual(child.signals, ['SIGTERM']);
    });

    test('killed=true alone does not stop the escalation: a child still alive after SIGTERM is SIGKILLed', async () => {
        // `killed` is set as soon as the signal is *sent* — the old guard checked exactly that.
        const child = fakeChild((c, signal) => {
            if (signal === 'SIGKILL') { c.signalCode = 'SIGKILL'; setImmediate(() => c.emit('close', null)); }
        });
        const result = await flashWithPyocd('x.cbuild-run.yml', 20, { spawn: spawnFake(child), killGraceMs: 30 });
        assert.strictEqual(result.timedOut, true);
        assert.strictEqual(result.exitCode, null);
        assert.deepStrictEqual(child.signals, ['SIGTERM', 'SIGKILL']);
    });

    test('a real process that ignores SIGTERM is killed after the grace period', async function () {
        if (process.platform === 'win32') { this.skip(); }
        const spawnIgnoring = ((_cmd: string, _args: string[], opts: object) =>
            spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'], opts as never)) as unknown as typeof spawn;
        const t0 = Date.now();
        const result = await flashWithPyocd('x.cbuild-run.yml', 200, { spawn: spawnIgnoring, killGraceMs: 300 });
        const elapsed = Date.now() - t0;
        assert.strictEqual(result.timedOut, true);
        assert.strictEqual(result.exitCode, null, 'died by signal, not by exit');
        assert.ok(elapsed >= 450 && elapsed < 5000, `elapsed ${elapsed} ms`);
    });
});
