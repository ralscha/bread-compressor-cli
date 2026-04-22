import * as fs from "fs";
import * as path from "path";
import {dirname} from "path";
import * as os from "os";
import {fork} from "child_process";
import {fileURLToPath} from 'url';
import {runZopfliGoCompression} from './zopfli-go-binary.js';

const VERSION = '4.0.0';
const DEFAULT_IGNORES = ['gz', 'br', 'zst', 'zip', 'png', 'jpeg', 'jpg', 'woff', 'woff2'];
const STYLE_CODES = {
    blue: '\u001B[34m',
    bold: '\u001B[1m',
    green: '\u001B[32m',
    red: '\u001B[31m',
    reset: '\u001B[0m'
};
const ANSI_ENABLED = process.stdout.isTTY && process.env.NO_COLOR == null;

let parsedArgsCache;

function printHelp() {
    console.log(`Usage: bread-compressor [options] <paths ...>

Options:
  -V, --version                         Print the current version
  -h, --help                            Show this help message
  -s, --stats                           Show statistics
  -a, --algorithm <items>               Comma separated list of algorithms: brotli,gzip,zstd
  -n, --no-default-ignores              Do not add default glob ignores
  -l, --limit <value>                   Number of concurrent tasks, defaults to CPU cores
    --use-zopfli-go                       Use the zopfli-go gzip binary (downloads and caches a GitHub release binary on first use)
  --zopfli-numiterations <value>        Maximum LZ77 optimization iterations, default 15
  --zopfli-blocksplittinglast <value>   false, true, or both
  --brotli-mode <value>                 0 = generic, 1 = text, 2 = font
  --brotli-quality <value>              0 - 11, default 11
  --brotli-lgwin <value>                Window size, default 22
  --zstd-level <value>                  Zstandard compression level, default 3`);
}

function exitAfterOutput(output, code = 0) {
    console.log(output);
    process.exit(code);
}

function parseIntegerOption(name, value) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        throw new Error(`Invalid value for ${name}: ${value}`);
    }
    return parsed;
}

function takeOptionValue(argv, index, token) {
    if (token.includes('=')) {
        return {nextIndex: index, value: token.slice(token.indexOf('=') + 1)};
    }

    const value = argv[index + 1];
    if (value == null) {
        throw new Error(`Missing value for ${token}`);
    }

    return {nextIndex: index + 1, value};
}

function parseArgs() {
    if (parsedArgsCache) {
        return parsedArgsCache;
    }

    const argv = process.argv.slice(2);
    const options = {
        algorithm: null,
        brotliLgwin: null,
        brotliMode: null,
        brotliQuality: null,
        defaultIgnores: true,
        limit: null,
        stats: false,
        useZopfliGo: false,
        zopfliBlocksplittinglast: undefined,
        zopfliNumiterations: null,
        zstdLevel: null
    };
    const args = [];

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];

        if (token === '--') {
            args.push(...argv.slice(index + 1));
            break;
        }

        if (token === '-h' || token === '--help') {
            printHelp();
            process.exit(0);
        }

        if (token === '-V' || token === '--version') {
            exitAfterOutput(VERSION);
        }

        if (token === '-s' || token === '--stats') {
            options.stats = true;
            continue;
        }

        if (token === '-n' || token === '--no-default-ignores') {
            options.defaultIgnores = false;
            continue;
        }

        if (token === '--use-zopfli-go') {
            options.useZopfliGo = true;
            continue;
        }

        if (token === '-a' || token === '--algorithm' || token.startsWith('--algorithm=')) {
            const optionValue = takeOptionValue(argv, index, token);
            options.algorithm = optionValue.value.split(',').map(item => item.trim()).filter(Boolean);
            index = optionValue.nextIndex;
            continue;
        }

        if (token === '-l' || token === '--limit' || token.startsWith('--limit=')) {
            const optionValue = takeOptionValue(argv, index, token);
            options.limit = parseIntegerOption('--limit', optionValue.value);
            index = optionValue.nextIndex;
            continue;
        }

        if (token === '--zopfli-numiterations' || token.startsWith('--zopfli-numiterations=')) {
            const optionValue = takeOptionValue(argv, index, token);
            options.zopfliNumiterations = parseIntegerOption('--zopfli-numiterations', optionValue.value);
            index = optionValue.nextIndex;
            continue;
        }

        if (token === '--zopfli-blocksplittinglast' || token.startsWith('--zopfli-blocksplittinglast=')) {
            const optionValue = takeOptionValue(argv, index, token);
            options.zopfliBlocksplittinglast = optionValue.value;
            index = optionValue.nextIndex;
            continue;
        }

        if (token === '--brotli-mode' || token.startsWith('--brotli-mode=')) {
            const optionValue = takeOptionValue(argv, index, token);
            options.brotliMode = parseIntegerOption('--brotli-mode', optionValue.value);
            index = optionValue.nextIndex;
            continue;
        }

        if (token === '--brotli-quality' || token.startsWith('--brotli-quality=')) {
            const optionValue = takeOptionValue(argv, index, token);
            options.brotliQuality = parseIntegerOption('--brotli-quality', optionValue.value);
            index = optionValue.nextIndex;
            continue;
        }

        if (token === '--brotli-lgwin' || token.startsWith('--brotli-lgwin=')) {
            const optionValue = takeOptionValue(argv, index, token);
            options.brotliLgwin = parseIntegerOption('--brotli-lgwin', optionValue.value);
            index = optionValue.nextIndex;
            continue;
        }

        if (token === '--zstd-level' || token.startsWith('--zstd-level=')) {
            const optionValue = takeOptionValue(argv, index, token);
            options.zstdLevel = parseIntegerOption('--zstd-level', optionValue.value);
            index = optionValue.nextIndex;
            continue;
        }

        if (token.startsWith('-')) {
            throw new Error(`Unknown option: ${token}`);
        }

        args.push(token);
    }

    parsedArgsCache = {args, options};
    return parsedArgsCache;
}

function normalizeSlashes(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function hasGlobToken(pattern) {
    return /[*?]/.test(pattern);
}

function readAllFiles(targetPath) {
    const absolutePath = path.resolve(targetPath);
    if (!fs.existsSync(absolutePath)) {
        return [];
    }

    const stat = fs.statSync(absolutePath);
    if (stat.isFile()) {
        return [absolutePath];
    }

    const files = [];
    const directories = [absolutePath];

    while (directories.length > 0) {
        const currentDirectory = directories.pop();
        for (const entry of fs.readdirSync(currentDirectory, {withFileTypes: true})) {
            const entryPath = path.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
                directories.push(entryPath);
                continue;
            }

            if (entry.isFile()) {
                files.push(entryPath);
            }
        }
    }

    return files;
}

function resolveSearchBase(pattern) {
    const normalizedPattern = normalizeSlashes(pattern.replace(/^!/, ''));
    if (!hasGlobToken(normalizedPattern)) {
        return path.resolve(normalizedPattern);
    }

    const baseSegments = [];
    for (const segment of normalizedPattern.split('/')) {
        if (segment === '**' || hasGlobToken(segment)) {
            break;
        }
        baseSegments.push(segment);
    }

    return path.resolve(baseSegments.length > 0 ? baseSegments.join(path.sep) : '.');
}

function segmentMatches(patternSegment, pathSegment) {
    const escaped = patternSegment.replace(/[|\\{}()[\]^$+.:]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
    return regex.test(pathSegment);
}

function matchSegments(patternSegments, pathSegments) {
    if (patternSegments.length === 0) {
        return pathSegments.length === 0;
    }

    const [currentPattern, ...remainingPatterns] = patternSegments;
    if (currentPattern === '**') {
        if (remainingPatterns.length === 0) {
            return true;
        }

        for (let index = 0; index <= pathSegments.length; index += 1) {
            if (matchSegments(remainingPatterns, pathSegments.slice(index))) {
                return true;
            }
        }

        return false;
    }

    if (pathSegments.length === 0 || !segmentMatches(currentPattern, pathSegments[0])) {
        return false;
    }

    return matchSegments(remainingPatterns, pathSegments.slice(1));
}

function matchesPattern(pattern, candidate) {
    const rawPattern = pattern.replace(/^!/, '');
    const normalizedPattern = normalizeSlashes(rawPattern);
    const normalizedCandidate = normalizeSlashes(path.isAbsolute(rawPattern)
        ? path.resolve(candidate)
        : path.relative(process.cwd(), candidate));

    if (!normalizedPattern.includes('/')) {
        return segmentMatches(normalizedPattern, path.posix.basename(normalizedCandidate));
    }

    return matchSegments(normalizedPattern.split('/'), normalizedCandidate.split('/'));
}

function expandPattern(pattern) {
    const normalizedPattern = normalizeSlashes(pattern.replace(/^!/, ''));
    if (!hasGlobToken(normalizedPattern)) {
        return readAllFiles(normalizedPattern);
    }

    const basePath = resolveSearchBase(normalizedPattern);
    return readAllFiles(basePath).filter(candidate => matchesPattern(normalizedPattern, candidate));
}

function addDefaultIgnores(args, options) {
    if (!options.defaultIgnores) {
        return args;
    }

    const globs = args.slice();
    for (const ignore of DEFAULT_IGNORES) {
        globs.push(`!*.${ignore}`);
        globs.push(`!**/*.${ignore}`);
    }
    return globs;
}

function expandPaths(globs) {
    const selectedPaths = new Set();

    for (const glob of globs) {
        if (glob.startsWith('!')) {
            for (const filePath of Array.from(selectedPaths)) {
                if (matchesPattern(glob, filePath)) {
                    selectedPaths.delete(filePath);
                }
            }
            continue;
        }

        for (const filePath of expandPattern(glob)) {
            selectedPaths.add(filePath);
        }
    }

    return Array.from(selectedPaths).sort();
}

function createLimiter(maxConcurrency) {
    const concurrency = Math.max(1, maxConcurrency);
    const queue = [];
    let activeCount = 0;

    function runNext() {
        if (activeCount >= concurrency || queue.length === 0) {
            return;
        }

        activeCount += 1;
        const {task, resolve, reject} = queue.shift();

        Promise.resolve()
            .then(task)
            .then(result => {
                activeCount -= 1;
                resolve(result);
                runNext();
            })
            .catch(error => {
                activeCount -= 1;
                reject(error);
                runNext();
            });
    }

    return task => new Promise((resolve, reject) => {
        queue.push({task, resolve, reject});
        runNext();
    });
}

function styleText(text, ...styles) {
    const stringValue = String(text);
    if (!ANSI_ENABLED || styles.length === 0) {
        return stringValue;
    }

    return `${styles.map(style => STYLE_CODES[style]).join('')}${stringValue}${STYLE_CODES.reset}`;
}

export async function compress(algorithm) {
    const {args, options} = parseArgs();
    if (args.length === 0) {
        printHelp();
        process.exit(0);
    }

    if (options.algorithm == null) {
        options.algorithm = ['brotli', 'gzip'];
    }

    if (options.algorithm.indexOf(algorithm) === -1) {
        return;
    }

    const globs = addDefaultIgnores(args, options);

    const paths = expandPaths(globs);
    const start = Date.now();
    const limit = createLimiter(options.limit ? options.limit : os.cpus().length);

    let results;
    if (algorithm === 'brotli') {
        const brotliOptions = {
            mode: options.brotliMode != null ? options.brotliMode : 1,
            quality: options.brotliQuality != null ? options.brotliQuality : 11,
            lgwin: options.brotliLgwin != null ? options.brotliLgwin : 22
        };
        results = await Promise.all(paths.map(name => limit(() => {
            return new Promise(function (resolve) {
                const __dirname = dirname(fileURLToPath(import.meta.url));
                const child = fork(path.resolve(__dirname, 'brotli-compress.js'));

                child.on('message', msg => {
                    if (msg.ready) {
                        child.send({name: name, options: brotliOptions});

                        child.on('message', (message) => {
                            child.kill();
                            resolve(message);
                        });
                    }
                });
            });
        })));
    } else if (algorithm === 'zstd') {
        const zstdOptions = {
            level: options.zstdLevel != null ? options.zstdLevel : 3
        };
        results = await Promise.all(paths.map(name => limit(() => {
            return new Promise(function (resolve) {
                const __dirname = dirname(fileURLToPath(import.meta.url));
                const child = fork(path.resolve(__dirname, 'zstd-compress.js'));
                child.on('message', msg => {
                    if (msg.ready) {
                        child.send({name: name, options: zstdOptions});

                        child.on('message', (message) => {
                            child.kill();
                            resolve(message);
                        });
                    }
                });
            });
        })));
    } else {
        if (options.useZopfliGo) {
            results = await runZopfliGoCompression(paths, options);
        } else {
            const gzOptions = {
                numiterations: options.zopfliNumiterations != null ? options.zopfliNumiterations : 15,
                zopfliBlocksplittinglast: options.zopfliBlocksplittinglast,
            };
            results = await Promise.all(paths.map(name => limit(() => {
                return new Promise(function (resolve) {
                    const __dirname = dirname(fileURLToPath(import.meta.url));
                    const child = fork(path.resolve(__dirname, 'gzip-compress.js'));
                    child.on('message', msg => {
                        if (msg.ready) {
                            child.send({name: name, options: gzOptions});

                            child.on('message', (message) => {
                                child.kill();
                                resolve(message);
                            });
                        }
                    });
                });
            })));
        }
    }

    if (options.stats && results && results.length > 0) {
        const elapsedTime = (Date.now() - start) / 1000;
        const uncompressedSize = paths
            .map(fs.statSync)
            .map(stat => stat.size)
            .reduce((prev, current) => prev + current);
        const compressedSize = results.reduce((prev, current) => prev + current);
        const ratio = (compressedSize * 100 / uncompressedSize).toFixed(2);

        console.log(styleText(algorithm, 'bold', 'blue'));
        console.log(`Number of Files  : ${styleText(paths.length, 'bold')}`);
        console.log(`Uncompressed     : ${styleText(uncompressedSize.toLocaleString(), 'red', 'bold')} Bytes`);
        console.log(`Compressed       : ${styleText(compressedSize.toLocaleString(), 'green', 'bold')} Bytes`);
        console.log(`Compression Ratio: ${styleText(`${ratio}%`, 'green', 'bold')}`);
        console.log(`Compression Time : ${styleText(elapsedTime, 'bold')} s`);
        console.log();
    }

    return results;
}
