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

module.exports = {
	compress
}

async function compress(globs, options, algorithm) {
	const paths = globby.sync([...globs, '!(*.gz|*.br)'], { onlyFiles: true });
	const start = Date.now();

	let results;
	if (algorithm === 'brotli') {
		results = await Promise.all(paths.map(name => limit(() => brotliCompressFile(name, options))));
	}
	else {
		results = await Promise.all(paths.map(name => limit(() => zopfliCompressFile(name, options))));
	}

	if (!options.silent) {
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
}

async function zopfliCompressFile(file, options) {
	const stat = fs.statSync(file);
	const content = await readFile(file);

	const compressed1 = await zopfliPromisify(content, { numiterations: options.numiterations, blocksplitting: true, blocksplittinglast: false, blocksplittingmax: 15 });
	const compressed2 = await zopfliPromisify(content, { numiterations: options.numiterations, blocksplitting: true, blocksplittinglast: true, blocksplittingmax: 15 });

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

