// Copyright (c) Microsoft Corporation.
// Copyright 2026 Arm Limited and contributors

import * as assert from 'assert';
import { DebugState, formatBreakpointModifiers } from '../debugState';
import { DebuggingHandler, probeSchedule } from '../debuggingHandler';
import { IDebuggingExecutor } from '../debuggingExecutor';
import { IDebugConfigurationManager } from '../utils/debugConfigurationManager';
import { StopWaitResult } from '../utils/sessionStateTracker';

/**
 * Logpoint message translation: VS Code's `{expr}` syntax has to become a GDB
 * printf format string plus an argument list. GDB infers nothing about types,
 * so the specifier rules here are load-bearing — a wrong specifier prints
 * garbage rather than erroring.
 */
suite('Logpoint message translation', () => {

    const translate = (msg: string) => DebuggingHandler.translateLogMessage(msg);

    test('plain text gets a trailing newline and no arguments', () => {
        const { format, args } = translate('reached init');
        assert.strictEqual(format, 'reached init\\n');
        assert.deepStrictEqual(args, []);
    });

    test('bare interpolation defaults to %d', () => {
        const { format, args } = translate('count={count}');
        assert.strictEqual(format, 'count=%d\\n');
        assert.deepStrictEqual(args, ['count']);
    });

    test('explicit specifier overrides the default', () => {
        const { format, args } = translate('name={name:%s} duty={duty:%f}');
        assert.strictEqual(format, 'name=%s duty=%f\\n');
        assert.deepStrictEqual(args, ['name', 'duty']);
    });

    test('length modifiers and flags are accepted in the specifier', () => {
        const { format, args } = translate('t={ticks:%08lx}');
        assert.strictEqual(format, 't=%08lx\\n');
        assert.deepStrictEqual(args, ['ticks']);
    });

    test('a C++ scope-resolution expression is not mistaken for a specifier', () => {
        const { format, args } = translate('v={ns::value}');
        assert.strictEqual(format, 'v=%d\\n');
        assert.deepStrictEqual(args, ['ns::value']);
    });

    test('doubled braces are literal braces', () => {
        const { format, args } = translate('{{literal}} x={x}');
        assert.strictEqual(format, '{literal} x=%d\\n');
        assert.deepStrictEqual(args, ['x']);
    });

    test('a literal percent is escaped for printf', () => {
        const { format, args } = translate('duty 50% at {t}');
        assert.strictEqual(format, 'duty 50%% at %d\\n');
        assert.deepStrictEqual(args, ['t']);
    });

    test('quotes and backslashes are escaped for the GDB command string', () => {
        const { format } = translate('path "C:\\dev"');
        assert.strictEqual(format, 'path \\"C:\\\\dev\\"\\n');
    });

    test('expressions keep their inner structure', () => {
        const { args } = translate('{buf[i]} {p->field} {a + b}');
        assert.deepStrictEqual(args, ['buf[i]', 'p->field', 'a + b']);
    });

    test('unbalanced braces are rejected', () => {
        assert.throws(() => translate('x={unclosed'), /Unbalanced '{'/);
        assert.throws(() => translate('x=}'), /Unbalanced '}'/);
    });

    test('empty interpolation is rejected', () => {
        assert.throws(() => translate('x={}'), /Empty interpolation/);
    });
});

/**
 * Breakpoint rendering — an agent needs to tell a plain breakpoint from a
 * conditional one or a logpoint without issuing a second call.
 */
suite('Breakpoint modifier formatting', () => {

    test('a plain breakpoint renders no suffix', () => {
        assert.strictEqual(formatBreakpointModifiers({ enabled: true }), '');
    });

    test('a condition is surfaced', () => {
        assert.strictEqual(
            formatBreakpointModifiers({ enabled: true, condition: 'i == 100' }),
            ' [when: i == 100]',
        );
    });

    test('a logpoint is surfaced', () => {
        assert.strictEqual(
            formatBreakpointModifiers({ enabled: true, logMessage: 'x={x}' }),
            ' [log: x={x}]',
        );
    });

    test('modifiers combine in a stable order', () => {
        assert.strictEqual(
            formatBreakpointModifiers({
                enabled: false,
                condition: 'n > 0',
                logMessage: 'n={n}',
                hitCondition: '>5',
            }),
            ' [when: n > 0, log: n={n}, hits: >5, disabled]',
        );
    });

    test('an absent enabled flag is not reported as disabled', () => {
        assert.strictEqual(formatBreakpointModifiers({}), '');
    });
});

/**
 * Continue / step / pause wait for the DAP `stopped` event, armed before the
 * request goes out. The executor is a stub that records the order of calls
 * and hands out scripted stop outcomes.
 */
suite('Execution commands wait for the DAP stopped event', () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    let calls: string[];
    let waiters: Promise<StopWaitResult>[];
    const stopped = (reason: string): Promise<StopWaitResult> => Promise.resolve({ kind: 'stopped', reason, threadId: 1 });
    const never = (): Promise<StopWaitResult> => new Promise(() => { /* pending forever */ });

    function makeHandler(): DebuggingHandler {
        const state = new DebugState();
        state.sessionActive = true;
        state.fileName = 'main.c';
        state.fileFullPath = '/w/main.c';
        state.currentLine = 42;
        state.frameName = 'main';
        const record = (name: string) => async () => { calls.push(name); };
        const fake = {
            hasDebugSession: () => true,
            hasActiveSession: async () => true,
            getSessionStatus: async () => ({ state: 'running' as const }),
            continue: record('continue'),
            stepOver: record('stepOver'),
            stepInto: record('stepInto'),
            stepOut: record('stepOut'),
            pause: record('pause'),
            armStopWaiter: () => {
                calls.push('arm');
                const next = waiters.shift();
                if (!next) { throw new Error('test scripted no waiter'); }
                return next;
            },
            getCurrentDebugState: async () => state,
            readCoreRegisters: async () => ({ pc: '0x08000100', lr: '0x08000200' }),
        };
        return new DebuggingHandler(fake as unknown as IDebuggingExecutor, {} as IDebugConfigurationManager, 5);
    }

    setup(() => { calls = []; waiters = []; });

    test('the waiter is armed before continue is sent, and the stop reason is reported', async () => {
        waiters = [stopped('breakpoint')];
        const result = await makeHandler().handleContinue();
        assert.deepStrictEqual(calls, ['arm', 'continue']);
        assert.match(result, /^Target stopped \(reason: breakpoint\)\./);
        assert.match(result, /main\.c/);
        assert.match(result, /42/);
    });

    for (const [method, op] of [['handleStepOver', 'stepOver'], ['handleStepInto', 'stepInto'], ['handleStepOut', 'stepOut']] as const) {
        test(`${method} arms the waiter before the request`, async () => {
            waiters = [stopped('step')];
            const result = await makeHandler()[method]();
            assert.deepStrictEqual(calls, ['arm', op]);
            assert.match(result, /reason: step/);
        });
    }

    test('a cleared stack item cannot settle the wait — only a stop event does', async () => {
        // The old implementation settled on vscode.debug.onDidChangeActiveStackItem, which also
        // fires when the item is cleared on resume. With no stop event the call must keep waiting.
        waiters = [never()];
        const outcome = await Promise.race([makeHandler().handleContinue().then(() => 'settled'), sleep(100).then(() => 'still waiting')]);
        assert.strictEqual(outcome, 'still waiting');
    });

    test('no stop within the timeout is reported as a timeout, then recovery arms again before pausing', async () => {
        waiters = [Promise.resolve({ kind: 'timeout' }), stopped('pause')];
        const result = await makeHandler().handleContinue();
        assert.deepStrictEqual(calls, ['arm', 'continue', 'arm', 'pause'], 'arm precedes each request');
        assert.match(result, /'continue_execution' did not complete within 5s/);
        assert.match(result, /Recovery attempt/);
        assert.match(result, /Paused successfully\. PC = 0x08000100, LR = 0x08000200 in main at main\.c:42\./);
    });

    test('a session that ends during continue is reported as such', async () => {
        waiters = [Promise.resolve({ kind: 'ended' })];
        const result = await makeHandler().handleContinue();
        assert.match(result, /Debug session ended during 'continue_execution'/);
    });

    test('pause_execution arms the waiter before the pause request', async () => {
        waiters = [stopped('pause')];
        const result = await makeHandler().handlePause();
        assert.deepStrictEqual(calls, ['arm', 'pause']);
        assert.match(result, /^Target paused\./);
    });
});

suite('cmsis_action session-survival probe schedule', () => {
    test('delays and probes fit the budget, probes cap at 5 s', () => {
        for (const budget of [1_000, 4_000, 8_000, 16_000, 60_000]) {
            const p = probeSchedule(budget);
            assert.ok(p.firstDelayMs + p.probeMs + p.secondDelayMs + p.probeMs <= budget, `budget ${budget}: ${JSON.stringify(p)}`);
            assert.ok(p.probeMs <= 5_000 && p.probeMs >= 250, JSON.stringify(p));
            assert.ok(p.firstDelayMs > 0 && p.secondDelayMs >= 0);
        }
        assert.deepStrictEqual(probeSchedule(8_000), { firstDelayMs: 2800, secondDelayMs: 1200, probeMs: 2000 });
        assert.deepStrictEqual(probeSchedule(0), probeSchedule(1_000), 'a degenerate budget is raised to a second');
    });
});
