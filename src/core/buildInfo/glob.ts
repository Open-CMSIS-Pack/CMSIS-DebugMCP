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
 * A small glob walker for hosts without `vscode.workspace.findFiles` (unit
 * tests, the smoke client). Supports `**`, `*` and `?`; skips dot folders
 * and `node_modules`.
 */

import * as fs from 'fs';
import * as path from 'path';

/** `**\/out/**\/*.log` → a RegExp over a forward-slash relative path. */
export function globToRegExp(glob: string): RegExp {
    let re = '^';
    const g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
    for (let i = 0; i < g.length; i++) {
        const c = g[i];
        if (c === '*') {
            if (g[i + 1] === '*') {
                // `**/` matches zero or more directories; a trailing `**` matches everything.
                if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
            } else {
                re += '[^/]*';
            }
        } else if (c === '?') {
            re += '[^/]';
        } else {
            re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(re + '$');
}

/**
 * `path.resolve` plus the real path, so a symlink cannot point out of a root.
 * A path that does not exist yet is canonicalised through its deepest
 * existing ancestor: otherwise a root under `/var/folders` (macOS resolves it
 * to `/private/var`) or `RUNNER~1` (a Windows short name) never matches a
 * file resolved without `realpath`.
 */
function canonical(p: string): string {
    const resolved = path.resolve(p);
    try {
        return fs.realpathSync.native(resolved);
    } catch {
        const parent = path.dirname(resolved);
        if (parent === resolved) { return resolved; }
        return path.join(canonical(parent), path.basename(resolved));
    }
}

/**
 * True when `file` is one of `roots` or inside one (after resolving
 * symlinks; case-insensitive on Windows). `/ws2/x` is not inside `/ws`.
 */
export function isInsideAny(file: string, roots: readonly string[]): boolean {
    const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
    const target = fold(canonical(file));
    for (const root of roots) {
        const base = fold(canonical(root));
        const rel = path.relative(base, target);
        if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) { return true; }
    }
    return false;
}

export function walkGlob(root: string, glob: string, maxDepth = 8): string[] {
    const re = globToRegExp(glob);
    const found: string[] = [];
    const walk = (dir: string, depth: number) => {
        if (depth > maxDepth) { return; }
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === 'node_modules' || e.name.startsWith('.')) { continue; }
                walk(full, depth + 1);
            } else if (e.isFile()) {
                const rel = path.relative(root, full).split(path.sep).join('/');
                if (re.test(rel)) { found.push(full); }
            }
        }
    };
    walk(root, 0);
    return found.sort();
}
