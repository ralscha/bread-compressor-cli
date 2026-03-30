import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, readFile, stat, writeFile} from 'node:fs/promises';
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