import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chmod, mkdtemp, readFile, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';

const execFileAsync = promisify(execFile);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, '..');
const binPath = resolve(repositoryRoot, 'bin.js');
const packageJsonPath = resolve(repositoryRoot, 'package.json');

async function runCli(args, options = {}) {
    return execFileAsync(process.execPath, [binPath, ...args], {
        cwd: repositoryRoot,
        ...options
    });
}

async function createCompressibleFixture() {
    const tempDirectory = await mkdtemp(resolve(tmpdir(), 'bread-compressor-cli-'));
    const filePath = resolve(tempDirectory, 'fixture.txt');
    const source = 'repeat-this-line\n'.repeat(2000);

    await writeFile(filePath, source, 'utf8');

    return {filePath, tempDirectory};
}

async function createFakeZopfliGoBinary() {
    const tempDirectory = await mkdtemp(resolve(tmpdir(), 'bread-compressor-cli-zopfli-go-'));
    const scriptPath = resolve(tempDirectory, 'fake-zopfli-go.js');

    await writeFile(scriptPath, `'use strict';
const fs = require('node:fs');
const zlib = require('node:zlib');

let allowGzipInputs = false;
const paths = [];

for (const argument of process.argv.slice(2)) {
    if (argument === '--allow-gzip-inputs') {
        allowGzipInputs = true;
        continue;
    }

    if (argument.startsWith('-')) {
        continue;
    }

    paths.push(argument);
}

let written = 0;
let skippedBigger = 0;
let skippedFiltered = 0;

const results = paths.map((filePath) => {
    if (!allowGzipInputs && filePath.toLowerCase().endsWith('.gz')) {
        skippedFiltered += 1;
        return {
            sourcePath: filePath,
            outputPath: filePath,
            status: 'skipped-filtered',
            originalSize: fs.statSync(filePath).size,
            compressedSize: 0,
        };
    }

    const source = fs.readFileSync(filePath);
    const compressed = zlib.gzipSync(source);

    if (compressed.length < source.length) {
        fs.writeFileSync(filePath + '.gz', compressed);
        written += 1;
        return {
            sourcePath: filePath,
            outputPath: filePath + '.gz',
            status: 'written',
            originalSize: source.length,
            compressedSize: compressed.length,
        };
    }

    skippedBigger += 1;
    return {
        sourcePath: filePath,
        outputPath: filePath + '.gz',
        status: 'skipped-bigger',
        originalSize: source.length,
        compressedSize: compressed.length,
    };
});

process.stdout.write(JSON.stringify({
    summary: {
        written,
        skippedBigger,
        skippedFiltered,
        errors: 0,
    },
    results,
}));
`, 'utf8');

    if (process.platform === 'win32') {
        const wrapperPath = resolve(tempDirectory, 'zopfli-go.cmd');
        await writeFile(wrapperPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8');
        return {binaryPath: wrapperPath, tempDirectory};
    }

    const wrapperPath = resolve(tempDirectory, 'zopfli-go');
    await writeFile(wrapperPath, `#!/bin/sh\n"${process.execPath}" "${scriptPath}" "$@"\n`, 'utf8');
    await chmod(wrapperPath, 0o755);
    return {binaryPath: wrapperPath, tempDirectory};
}

async function assertCompressedOutputIsSmaller(filePath, suffix) {
    const originalStat = await stat(filePath);
    const compressedStat = await stat(`${filePath}${suffix}`);

    assert.ok(compressedStat.isFile());
    assert.ok(compressedStat.size < originalStat.size);
}

test('prints the package version', async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    const {stdout, stderr} = await runCli(['--version']);

    assert.equal(stderr, '');
    assert.equal(stdout.trim(), packageJson.version);
});

test('prints help text', async () => {
    const {stdout, stderr} = await runCli(['--help']);

    assert.equal(stderr, '');
    assert.match(stdout, /Usage: bread-compressor \[options\] <paths \.\.\.>/);
    assert.match(stdout, /--algorithm <items>/);
    assert.match(stdout, /--use-zopfli-go/);
});

test('compresses a file with gzip only', async () => {
    const {filePath} = await createCompressibleFixture();

    const {stdout, stderr} = await runCli(['-a', 'gzip', filePath]);

    assert.equal(stdout, '');
    assert.equal(stderr, '');

    await assertCompressedOutputIsSmaller(filePath, '.gz');

    await assert.rejects(stat(`${filePath}.br`));
    await assert.rejects(stat(`${filePath}.zst`));
});

test('compresses a file with gzip only through zopfli-go binary', async () => {
    const {binaryPath} = await createFakeZopfliGoBinary();
    const {filePath} = await createCompressibleFixture();

    const {stdout, stderr} = await runCli(['--use-zopfli-go', '-a', 'gzip', filePath], {
        env: {
            ...process.env,
            BREAD_COMPRESSOR_ZOPFLI_GO_BINARY_PATH: binaryPath,
        },
    });

    assert.equal(stdout, '');
    assert.equal(stderr, '');

    await assertCompressedOutputIsSmaller(filePath, '.gz');
    await assert.rejects(stat(`${filePath}.br`));
    await assert.rejects(stat(`${filePath}.zst`));
});

test('passes no-default-ignores through to zopfli-go binary', async () => {
    const {binaryPath} = await createFakeZopfliGoBinary();
    const tempDirectory = await mkdtemp(resolve(tmpdir(), 'bread-compressor-cli-'));
    const filePath = resolve(tempDirectory, 'fixture.gz');
    await writeFile(filePath, 'repeat-this-line\n'.repeat(2000), 'utf8');

    const {stdout, stderr} = await runCli(['--use-zopfli-go', '-n', '-a', 'gzip', filePath], {
        env: {
            ...process.env,
            BREAD_COMPRESSOR_ZOPFLI_GO_BINARY_PATH: binaryPath,
        },
    });

    assert.equal(stdout, '');
    assert.equal(stderr, '');

    await assertCompressedOutputIsSmaller(filePath, '.gz');
});

test('compresses a file with brotli only', async () => {
    const {filePath} = await createCompressibleFixture();

    const {stdout, stderr} = await runCli(['-a', 'brotli', filePath]);

    assert.equal(stdout, '');
    assert.equal(stderr, '');

    await assertCompressedOutputIsSmaller(filePath, '.br');

    await assert.rejects(stat(`${filePath}.gz`));
    await assert.rejects(stat(`${filePath}.zst`));
});

test('compresses a file with zstd only', async () => {
    const {filePath} = await createCompressibleFixture();

    const {stdout, stderr} = await runCli(['-a', 'zstd', filePath]);

    assert.equal(stdout, '');
    assert.equal(stderr, '');

    await assertCompressedOutputIsSmaller(filePath, '.zst');

    await assert.rejects(stat(`${filePath}.gz`));
    await assert.rejects(stat(`${filePath}.br`));
});