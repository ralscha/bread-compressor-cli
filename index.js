const fs = require('fs');
const path = require('path');
const globby = require('globby');
const promiseLimit = require('promise-limit')
const fork = require('child_process').fork;
const os = require('os');
const chalk = require('chalk');

const program = require('commander');

module.exports = {
	compress
}

function parseArgs(algorithm) {
	program
		.version('1.0.0')
		.usage('[options] <globs ...>')
		.option('-s, --stats', 'Show statistics')
		.option('-a, --algorithm <items>', 'Comma separated list of compression algorithms. Supported values are "brotli" and "gzip". Default "brotli,gzip"', items=>items.split(','))
		.option('-n, --no-default-ignores', 'Do not add default glob ignores')
		.option('-l, --limit <value>', 'Number of tasks running concurrently. Default is your total number of cores', parseInt)
		.option('--zopfli-numiterations <value>', 'Maximum amount of times to rerun forward and backward pass to optimize LZ77 compression cost. Good values: 10, 15 for small files, 5 for files over several MB in size or it will be too slow. Default 15', parseInt)
		.option('--zopfli-blocksplittinglast <value>', 'If "true", chooses the optimal block split points only after doing the iterative LZ77 compression. If "false", chooses the block split points first, then does iterative LZ77 on each individual block. If "both", first runs with false, then with true and keeps the smaller file. Default "false"')
		.option('--brotli-mode <value>', '0 = generic, 1 = text (default), 2 = font (WOFF2)', parseInt)
		.option('--brotli-quality <value>', '0 - 11. Default 11', parseInt)
		.option('--brotli-lgwin <value>', 'Window size. Default 22', parseInt)
		.parse(process.argv);
}

function addDefaultIgnores() {
	if (program.defaultIgnores) {
		const globs = program.args.slice();
		for (ignore of ['gz', 'br', 'zip', 'png', 'jpeg', 'jpg', 'woff', 'woff2']) {
			globs.push('!*.' + ignore);
			globs.push('!**/*.' + ignore);
		}
		return globs;
	}
	return program.args;
}

async function compress(algorithm) {
	parseArgs(algorithm);
	if (!program.args || program.args.length === 0) {
		program.help();
	}

	if (program.algorithm != null && program.algorithm.indexOf(algorithm) === -1) {
		return;
	}

	const globs = addDefaultIgnores();

	const paths = globby.sync([...globs], { onlyFiles: true });
	const start = Date.now();

	const limit = promiseLimit(program.limit ? program.limit : os.cpus().length);
	
	let results;
	if (algorithm === 'brotli') {
		const options = {
			mode: program.brotliMode != null ? program.brotliMode : 1,
			quality: program.brotliQuality != null ? program.brotliQuality : 11,
			lgwin: program.brotliLgwin != null ? program.brotliLgwin : 22
		};
		results = await Promise.all(paths.map(name => limit(() => {
			return new Promise(function (resolve) {
				const child = fork(path.resolve(__dirname, 'brotli-compress.js'));

				child.send({ name: name, options: options });

				child.on('message', (message) => {
					child.kill();
					resolve(message);
				});
			});
		})));
	}
	else {
		const options = {
			numiterations: program.zopfliNumiterations != null ? program.zopfliNumiterations : 15,
			zopfliBlocksplittinglast: program.zopfliBlocksplittinglast,
		};
		results = await Promise.all(paths.map(name => limit(() => {
			return new Promise(function (resolve) {
				const child = fork(path.resolve(__dirname, 'gzip-compress.js'));

				child.send({ name: name, options: options });

				child.on('message', (message) => {
					child.kill();
					resolve(message);
				});
			});
		})));
	}

	if (program.stats && results && results.length > 0) {
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
