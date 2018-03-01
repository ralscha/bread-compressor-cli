const fs = require('fs');
const globby = require('globby');
const zopfli = require('@gfx/zopfli');
const brotli = require('brotli');
const promiseLimit = require('promise-limit')
const util = require('util');

const limit = promiseLimit(2)
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

module.exports = {
	zopfliCompress,
	brotliCompress
}

function zopfliCompress(globs, options) {
	const paths = globby.sync([...globs, '!(*.gz|*.br)'], { onlyFiles: true });
	Promise.all(paths.map(name => limit(() => zopfliCompressFile(name, options))));
}

async function zopfliCompressFile(file, options) {
	const stat = fs.statSync(file);
	const content = await readFile(file);

	const compressed1 = await zopfliPromisify(content, { numiterations: options.numiterations, blocksplitting: true, blocksplittinglast: false, blocksplittingmax: 15 });
	const compressed2 = await zopfliPromisify(content, { numiterations: options.numiterations, blocksplitting: true, blocksplittinglast: true, blocksplittingmax: 15 });

	if (compressed1 !== null && compressed1.length < stat.size) {
		if (compressed2 !== null && compressed2.length < compressed1.length) {
			await writeFile(file + '.gz', compressed2);
		}
		else {
			await writeFile(file + '.gz', compressed1);
		}
	}
	else if (compressed2 !== null && compressed2.length < stat.size) {
		await writeFile(file + '.gz', compressed2);
	}
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

function brotliCompress(globs, options) {
	const paths = globby.sync([...globs, '!(*.gz|*.br)'], { onlyFiles: true });
	Promise.all(paths.map(name => limit(() => brotliCompressFile(name, options))));
}

async function brotliCompressFile(file, options) {
	const stat = fs.statSync(file);
	const content = await readFile(file);
	const compressedContent = brotli.compress(content, options);
	if (compressedContent !== null && compressedContent.length < stat.size) {
		await writeFile(file + '.br', compressedContent);
	}
}

