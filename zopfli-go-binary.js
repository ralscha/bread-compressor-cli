import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import {spawn} from 'child_process';
import {fileURLToPath} from 'url';

const TAR_BLOCK_SIZE = 512;
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');

let packageConfigCache;

function getPackageConfig() {
    if (packageConfigCache != null) {
        return packageConfigCache;
    }

    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    if (packageJson.zopfliGoBinary == null) {
        throw new Error('Missing zopfliGoBinary configuration in package.json');
    }

    packageConfigCache = packageJson.zopfliGoBinary;
    return packageConfigCache;
}

function getCacheRoot() {
    if (process.env.BREAD_COMPRESSOR_ZOPFLI_GO_CACHE_DIR) {
        return path.resolve(process.env.BREAD_COMPRESSOR_ZOPFLI_GO_CACHE_DIR);
    }

    const homeDirectory = os.homedir();
    if (process.platform === 'win32') {
        return process.env.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local');
    }
    if (process.platform === 'darwin') {
        return path.join(homeDirectory, 'Library', 'Caches');
    }

    return process.env.XDG_CACHE_HOME || path.join(homeDirectory, '.cache');
}

export function resolveTarget(platform = process.platform, architecture = process.arch) {
    const platformMap = {
        darwin: 'darwin',
        linux: 'linux',
        win32: 'windows'
    };
    const architectureMap = {
        arm64: 'arm64',
        x64: 'amd64'
    };

    const targetOs = platformMap[platform];
    if (targetOs == null) {
        throw new Error(`unsupported platform: ${platform}`);
    }

    const targetArch = architectureMap[architecture];
    if (targetArch == null) {
        throw new Error(`unsupported architecture: ${architecture}`);
    }

    return {
        arch: targetArch,
        archiveExtension: platform === 'win32' ? '.zip' : '.tar.gz',
        archiveType: platform === 'win32' ? 'zip' : 'tar.gz',
        extension: platform === 'win32' ? '.exe' : '',
        os: targetOs
    };
}

export function buildDownloadUrl(config, target) {
    const tag = `${config.tagPrefix || ''}${config.version}`;
    const assetName = renderTemplate(config.assetNameTemplate, {
        arch: target.arch,
        archiveExtension: target.archiveExtension,
        binary: config.binaryName,
        extension: target.extension,
        os: target.os,
        version: config.version
    });

    return `https://github.com/${config.owner}/${config.repo}/releases/download/${tag}/${assetName}`;
}

function renderTemplate(template, values) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (!(key in values)) {
            throw new Error(`unknown template key: ${key}`);
        }

        return values[key];
    });
}

function getBinaryDestination() {
    const config = getPackageConfig();
    const target = resolveTarget();
    const cacheDirectory = path.join(getCacheRoot(), 'bread-compressor-cli', 'zopfli-go', config.version, `${target.os}-${target.arch}`);

    return {
        archivePath: path.join(cacheDirectory, `${config.binaryName}${target.extension}${target.archiveExtension}.download`),
        binaryFileName: `${config.binaryName}${target.extension}`,
        binaryPath: path.join(cacheDirectory, `${config.binaryName}${target.extension}`),
        cacheDirectory,
        config,
        target
    };
}

export async function ensureZopfliGoBinary() {
    const overrideBinaryPath = process.env.BREAD_COMPRESSOR_ZOPFLI_GO_BINARY_PATH;
    if (overrideBinaryPath != null && overrideBinaryPath.length > 0) {
        const resolvedBinaryPath = path.resolve(overrideBinaryPath);
        if (!fs.existsSync(resolvedBinaryPath)) {
            throw new Error(`Configured zopfli-go binary does not exist: ${resolvedBinaryPath}`);
        }
        return resolvedBinaryPath;
    }

    const destination = getBinaryDestination();
    if (fs.existsSync(destination.binaryPath)) {
        return destination.binaryPath;
    }

    fs.mkdirSync(destination.cacheDirectory, {recursive: true});

    const downloadUrl = process.env.BREAD_COMPRESSOR_ZOPFLI_GO_DOWNLOAD_URL || buildDownloadUrl(destination.config, destination.target);

    await download(downloadUrl, destination.archivePath);

    try {
        if (destination.target.archiveType === 'zip') {
            extractBinaryFromZip(destination.archivePath, destination.binaryFileName, destination.binaryPath);
        } else {
            extractBinaryFromTarGz(destination.archivePath, destination.binaryFileName, destination.binaryPath);
        }
    } finally {
        fs.rmSync(destination.archivePath, {force: true});
    }

    if (process.platform !== 'win32') {
        fs.chmodSync(destination.binaryPath, 0o755);
    }

    return destination.binaryPath;
}

function download(url, destination) {
    return new Promise((resolve, reject) => {
        const urlObject = new URL(url);
        const client = urlObject.protocol === 'https:' ? https : urlObject.protocol === 'http:' ? http : null;
        if (client == null) {
            reject(new Error(`unsupported protocol: ${urlObject.protocol}`));
            return;
        }

        const file = fs.createWriteStream(destination);

        const fail = error => {
            file.destroy();
            fs.rmSync(destination, {force: true});
            reject(error);
        };

        const request = client.get(urlObject, response => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                file.close(() => {
                    fs.rmSync(destination, {force: true});
                    download(new URL(response.headers.location, urlObject).toString(), destination).then(resolve, reject);
                });
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                fail(new Error(`download failed: ${response.statusCode} ${response.statusMessage || ''} (${url})`));
                return;
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close(closeError => {
                    if (closeError) {
                        fail(closeError);
                        return;
                    }

                    resolve();
                });
            });
        });

        request.on('error', fail);
        file.on('error', fail);
    });
}

function extractBinaryFromZip(zipPath, binaryFileName, destination) {
    const archive = fs.readFileSync(zipPath);
    const entry = findZipEntry(archive, binaryFileName);

    if (entry == null) {
        throw new Error(`binary ${binaryFileName} not found in archive ${zipPath}`);
    }

    const dataOffset = entry.localHeaderOffset + 30 + entry.localFileNameLength + entry.localExtraLength;
    const compressedData = archive.subarray(dataOffset, dataOffset + entry.compressedSize);

    let data;
    switch (entry.compressionMethod) {
        case 0:
            data = compressedData;
            break;
        case 8:
            data = zlib.inflateRawSync(compressedData, {
                maxOutputLength: entry.uncompressedSize
            });
            break;
        default:
            throw new Error(`unsupported zip compression method: ${entry.compressionMethod}`);
    }

    if (data.length !== entry.uncompressedSize) {
        throw new Error(`zip entry size mismatch for ${binaryFileName}`);
    }

    fs.writeFileSync(destination, data);
}

function extractBinaryFromTarGz(tarGzPath, binaryFileName, destination) {
    const archive = zlib.gunzipSync(fs.readFileSync(tarGzPath));
    const entry = findTarEntry(archive, binaryFileName);

    if (entry == null) {
        throw new Error(`binary ${binaryFileName} not found in archive ${tarGzPath}`);
    }

    fs.writeFileSync(destination, entry.data);
}

function findTarEntry(archive, binaryFileName) {
    for (let offset = 0; offset + TAR_BLOCK_SIZE <= archive.length;) {
        const header = archive.subarray(offset, offset + TAR_BLOCK_SIZE);
        if (isZeroBlock(header)) {
            return null;
        }

        const name = readTarString(header, 0, 100);
        const prefix = readTarString(header, 345, 155);
        const size = readTarOctal(header, 124, 12);
        const typeFlag = readTarString(header, 156, 1) || '0';
        const fullName = prefix ? `${prefix}/${name}` : name;
        const fileName = fullName.split('/').pop();
        const dataOffset = offset + TAR_BLOCK_SIZE;
        const dataEnd = dataOffset + size;

        if (dataEnd > archive.length) {
            throw new Error('invalid tar archive: entry exceeds archive size');
        }

        if ((typeFlag === '0' || typeFlag === '') && fileName === binaryFileName) {
            return {
                data: archive.subarray(dataOffset, dataEnd)
            };
        }

        offset = dataOffset + alignTarSize(size);
    }

    throw new Error('invalid tar archive: missing end-of-archive marker');
}

function alignTarSize(size) {
    return Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
}

function isZeroBlock(block) {
    for (const byte of block) {
        if (byte !== 0) {
            return false;
        }
    }

    return true;
}

function readTarString(buffer, offset, length) {
    const value = buffer.subarray(offset, offset + length).toString('utf8');
    const terminatorIndex = value.indexOf('\0');
    return (terminatorIndex === -1 ? value : value.slice(0, terminatorIndex)).trim();
}

function readTarOctal(buffer, offset, length) {
    const rawValue = readTarString(buffer, offset, length).trim();
    if (rawValue.length === 0) {
        return 0;
    }

    if (!/^[0-7]+$/.test(rawValue)) {
        throw new Error(`invalid tar size field: ${rawValue}`);
    }

    return Number.parseInt(rawValue, 8);
}

function findZipEntry(archive, binaryFileName) {
    const endOfCentralDirectory = findEndOfCentralDirectory(archive);
    let offset = endOfCentralDirectory.centralDirectoryOffset;
    const limit = offset + endOfCentralDirectory.centralDirectorySize;

    while (offset < limit) {
        if (archive.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error('invalid zip central directory header');
        }

        const compressionMethod = archive.readUInt16LE(offset + 10);
        const compressedSize = archive.readUInt32LE(offset + 20);
        const uncompressedSize = archive.readUInt32LE(offset + 24);
        const fileNameLength = archive.readUInt16LE(offset + 28);
        const extraLength = archive.readUInt16LE(offset + 30);
        const commentLength = archive.readUInt16LE(offset + 32);
        const localHeaderOffset = archive.readUInt32LE(offset + 42);
        const entryName = archive.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
        const fileName = entryName.split(/[\\/]/).pop();

        if (fileName === binaryFileName) {
            if (archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
                throw new Error('invalid zip local file header');
            }

            return {
                compressionMethod,
                compressedSize,
                localExtraLength: archive.readUInt16LE(localHeaderOffset + 28),
                localFileNameLength: archive.readUInt16LE(localHeaderOffset + 26),
                localHeaderOffset,
                uncompressedSize
            };
        }

        offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return null;
}

function findEndOfCentralDirectory(archive) {
    const minimumOffset = Math.max(0, archive.length - 0xffff - 22);

    for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
        if (archive.readUInt32LE(offset) !== 0x06054b50) {
            continue;
        }

        return {
            centralDirectoryOffset: archive.readUInt32LE(offset + 16),
            centralDirectorySize: archive.readUInt32LE(offset + 12)
        };
    }

    throw new Error('invalid zip end of central directory');
}

function buildArguments(paths, options) {
    const argumentsList = [
        '--json',
        `--jobs=${options.limit != null ? options.limit : os.cpus().length}`,
        `--iterations=${options.zopfliNumiterations != null ? options.zopfliNumiterations : 15}`,
        `--block-splitting-last=${options.zopfliBlocksplittinglast != null ? options.zopfliBlocksplittinglast : 'false'}`
    ];

    if (!options.defaultIgnores) {
        argumentsList.push('--allow-gzip-inputs');
    }

    argumentsList.push(...paths);
    return argumentsList;
}

function runBinary(binaryPath, args) {
    return new Promise((resolve, reject) => {
        const child = createChildProcess(binaryPath, args);

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            stdout += chunk;
        });
        child.stderr.on('data', chunk => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', code => {
            if (code !== 0) {
                reject(new Error(normalizeOutput(stderr) || `zopfli-go exited with code ${code}`));
                return;
            }

            resolve(normalizeOutput(stdout));
        });
    });
}

function createChildProcess(binaryPath, args) {
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(binaryPath)) {
        return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', binaryPath, ...args], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
    }

    return spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function normalizeOutput(output) {
    if (!output) {
        return '';
    }

    return String(output).trim();
}

function resultSize(result) {
    switch (result.status) {
        case 'written':
            return result.compressedSize;
        case 'skipped-bigger':
        case 'skipped-filtered':
            return result.originalSize;
        case 'error':
            throw new Error(result.error || `zopfli-go failed for ${result.sourcePath}`);
        default:
            throw new Error(`Unexpected zopfli-go result status: ${result.status}`);
    }
}

export async function runZopfliGoCompression(paths, options) {
    if (paths.length === 0) {
        return [];
    }

    const binaryPath = await ensureZopfliGoBinary();
    const output = await runBinary(binaryPath, buildArguments(paths, options));
    if (output.length === 0) {
        throw new Error('zopfli-go did not produce JSON output');
    }

    const report = JSON.parse(output);
    if (report.summary != null && report.summary.errors > 0) {
        const reportedErrors = report.results
            .filter(result => result.status === 'error')
            .map(result => `${result.sourcePath}: ${result.error}`);
        throw new Error(reportedErrors.length > 0 ? reportedErrors.join('\n') : `zopfli-go reported ${report.summary.errors} error(s)`);
    }

    const resultsByPath = new Map(report.results.map(result => [result.sourcePath, resultSize(result)]));
    return paths.map(filePath => {
        if (!resultsByPath.has(filePath)) {
            throw new Error(`zopfli-go did not report a result for ${filePath}`);
        }

        return resultsByPath.get(filePath);
    });
}
