'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const arkanalyzerRoot = path.join(repoRoot, 'arkanalyzer');

const requiredOutputs = [
    path.join(arkanalyzerRoot, 'out', 'src', 'Scene.js'),
    path.join(arkanalyzerRoot, 'out', 'src', 'Scene.d.ts'),
    path.join(arkanalyzerRoot, 'out', 'src', 'Config.js'),
    path.join(arkanalyzerRoot, 'out', 'src', 'core', 'model', 'ArkMethod.js'),
    path.join(arkanalyzerRoot, 'out', 'src', 'callgraph', 'pointerAnalysis', 'Pag.js')
];

const requiredDependencies = [
    path.join(arkanalyzerRoot, 'node_modules', 'ohos-typescript'),
    path.join(arkanalyzerRoot, 'node_modules', 'typescript')
];

function exists(target) {
    try {
        return fs.existsSync(target);
    } catch {
        return false;
    }
}

function allPresent(targets) {
    return targets.every(exists);
}

function npmCommand(args) {
    const npmExecPath = process.env.npm_execpath;
    if (npmExecPath && exists(npmExecPath)) {
        return {
            command: process.execPath,
            args: [npmExecPath, ...args],
            shell: false
        };
    }

    return {
        command: 'npm',
        args,
        shell: process.platform === 'win32'
    };
}

function runNpm(args) {
    const invocation = npmCommand(args);
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: invocation.shell
    });

    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
    }
}

function main() {
    if (!exists(arkanalyzerRoot)) {
        throw new Error(`Missing arkanalyzer directory: ${arkanalyzerRoot}`);
    }

    if (!allPresent(requiredDependencies)) {
        runNpm(['install', '--prefix', 'arkanalyzer', '--ignore-scripts']);
    }

    if (!allPresent(requiredOutputs)) {
        runNpm(['--prefix', 'arkanalyzer', 'run', 'build']);
    }

    if (!allPresent(requiredOutputs)) {
        const missing = requiredOutputs.filter(output => !exists(output));
        throw new Error(`Arkanalyzer build did not produce required outputs:\n${missing.join('\n')}`);
    }
}

try {
    main();
} catch (error) {
    console.error(`[prepare-arkanalyzer] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
