const fs = require('fs');
const globby = require('globby');
const zopfli = require('@gfx/zopfli');
const brotli = require('brotli');
const promiseLimit = require('promise-limit')
const util = require('util');
const chalk = require('chalk');

const limit = promiseLimit(2)
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const program = require('commander');

module.exports = {
	compress
}

function parseArgs(algorithm) {
	program
		.version('1.0.0')
		.usage('[options] <globs ...>')
		.option('-s, --stats', 'Show statistics')
		.option('-n, --no-default-ignores', 'Do not add default ignores "!(*.gz|*.br)"')
		.option('--zopfli-numiterations [value]', 'Maximum amount of times to rerun forward and backward pass to optimize LZ77 compression cost. Good values: 10, 15 for small files, 5 for files over several MB in size or it will be too slow. (default: 15)')
		.option('--zopfli-blocksplittinglast [value]', 'If "true", chooses the optimal block split points only after doing the iterative LZ77 compression. If "false", chooses the block split points first, then does iterative LZ77 on each individual block. If "both", first runs with false, then with true and keeps the smaller file. (default: "false")')
		.option('--brotli-mode [value]', '0 = generic, 1 = text (default), 2 = font (WOFF2)')
		.option('--brotli-quality [value]', '0 - 11, (default: 11)')
		.option('--brotli-lgwin [value]', 'window size (default: 22)')
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

	const globs = addDefaultIgnores();

	const paths = globby.sync([...globs], { onlyFiles: true });
	const start = Date.now();

	let results;
	if (algorithm === 'brotli') {
		const options = {
			mode: program.brotliMode != null ? program.brotliMode : 1,
			quality: program.brotliQuality != null ? program.brotliQuality : 11,
			lgwin: program.brotliLgwin != null ? program.brotliLgwin : 22
		};
		results = await Promise.all(paths.map(name => limit(() => brotliCompressFile(name, options))));
	}
	else {
		const options = {
			numiterations: program.zopfliNumiterations != null ? program.zopfliNumiterations : 15,
		};
		results = await Promise.all(paths.map(name => limit(() => zopfliCompressFile(name, options))));
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

async function zopfliCompressFile(file, options) {
	const stat = fs.statSync(file);
	const content = await readFile(file);

	let compressed1 = null;
	let compressed2 = null;

	if (program.zopfliBlocksplittinglast === 'true') {
		compressed2 = await zopfliPromisify(content, { numiterations: options.numiterations, blocksplitting: true, blocksplittinglast: true, blocksplittingmax: 15 });
	}
	else if (program.zopfliBlocksplittinglast === 'both') {
		compressed1 = await zopfliPromisify(content, { numiterations: options.numiterations, blocksplitting: true, blocksplittinglast: false, blocksplittingmax: 15 });
		compressed2 = await zopfliPromisify(content, { numiterations: options.numiterations, blocksplitting: true, blocksplittinglast: true, blocksplittingmax: 15 });
	}
	else {
		compressed1 = await zopfliPromisify(content, { numiterations: options.numiterations, blocksplitting: true, blocksplittinglast: false, blocksplittingmax: 15 });
	}

	if (compressed1 !== null && compressed1.length < stat.size) {
		if (compressed2 !== null && compressed2.length < compressed1.length) {
			await writeFile(file + '.gz', compressed2);
			return compressed2.length;
		}
		else {
			await writeFile(file + '.gz', compressed1);
			return compressed1.length;
		}
	}
	else if (compressed2 !== null && compressed2.length < stat.size) {
		await writeFile(file + '.gz', compressed2);
		return compressed2.length;
	}

	return stat.size;
}

function zopfliPromisify(content, options) {
	return new Promise((resolve, reject) => {
		zopfli.gzip(content, options, (err, compressedContent) => {
			if (!err) {
				resolve(compressedContent);
			}
			else {
				reject(err);
			}
		});
	});
}

async function brotliCompressFile(file, options) {
	const stat = fs.statSync(file);
	const content = await readFile(file);
	const compressedContent = brotli.compress(content, options);
	if (compressedContent !== null && compressedContent.length < stat.size) {
		await writeFile(file + '.br', compressedContent);
		return compressedContent.length;
	}
	return stat.size;
}

