import {globbySync} from 'globby';
import {program} from "commander";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import {dirname} from "path";
import * as os from "os";
import promiseLimit from "promise-limit";
import {fork} from "child_process";
import {fileURLToPath} from 'url';

function parseArgs() {
    let intParseFunc = (n) => parseInt(n);
    if (Object.keys(program.opts()).length === 0) {
        program
            .version('3.1.2')
            .allowExcessArguments()
            .usage('[options] <paths ...>')
            .option('-s, --stats', 'Show statistics')
            .option('-a, --algorithm <items>', 'Comma separated list of compression algorithms. Supported values are "brotli", "gzip" and "zstd". Default "brotli,gzip"', items => items.split(','))
            .option('-n, --no-default-ignores', 'Do not add default glob ignores')
            .option('-l, --limit <value>', 'Number of tasks running concurrently. Default is your total number of cores', intParseFunc)
            .option('--zopfli-numiterations <value>', 'Maximum amount of times to rerun forward and backward pass to optimize LZ77 compression cost. Good values: 10, 15 for small files, 5 for files over several MB in size or it will be too slow. Default 15', intParseFunc)
            .option('--zopfli-blocksplittinglast <value>', 'If "true", chooses the optimal block split points only after doing the iterative LZ77 compression. If "false", chooses the block split points first, then does iterative LZ77 on each individual block. If "both", first runs with false, then with true and keeps the smaller file. Default "false"')
            .option('--brotli-mode <value>', '0 = generic, 1 = text (default), 2 = font (WOFF2)', intParseFunc)
            .option('--brotli-quality <value>', '0 - 11. Default 11', intParseFunc)
            .option('--brotli-lgwin <value>', 'Window size. Default 22', intParseFunc)
            .option('--zstd-level <value>', 'Zstandard compression level. Default 3', intParseFunc)
    }
    program.parse();
}

function addDefaultIgnores() {
    if (program.opts().defaultIgnores) {
        const globs = program.args.slice();
        for (const ignore of ['gz', 'br', 'zst', 'zip', 'png', 'jpeg', 'jpg', 'woff', 'woff2']) {
            globs.push('!*.' + ignore);
            globs.push('!**/*.' + ignore);
        }
        return globs;
    }
    return program.args;
}

export async function compress(algorithm) {
    parseArgs();
    if (!program.args || program.args.length === 0) {
        program.help();
    }

    const options = program.opts();
    if (options.algorithm == null) {
        options.algorithm = ['brotli', 'gzip'];
    }

    if (options.algorithm.indexOf(algorithm) === -1) {
        return;
    }

    const globs = addDefaultIgnores();

    const paths = globbySync([...globs]);
    const start = Date.now();
    const limit = promiseLimit(options.limit ? options.limit : os.cpus().length);

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

    if (options.stats && results && results.length > 0) {
        const elapsedTime = (Date.now() - start) / 1000;
        const uncompressedSize = paths
            .map(fs.statSync)
            .map(stat => stat.size)
            .reduce((prev, current) => prev + current);
        const compressedSize = results.reduce((prev, current) => prev + current);
        const ratio = (compressedSize * 100 / uncompressedSize).toFixed(2);

        console.log(chalk.bold.blue(algorithm));
        console.log(chalk`Number of Files  : {bold ${paths.length}}`);
        console.log(chalk`Uncompressed     : {red.bold ${uncompressedSize.toLocaleString()}} Bytes`);
        console.log(chalk`Compressed       : {green.bold ${compressedSize.toLocaleString()}} Bytes`);
        console.log(chalk`Compression Ratio: {green.bold ${ratio}%}`);
        console.log(chalk`Compression Time : {bold ${elapsedTime}} s`);
        console.log();
    }

    return results;
}
