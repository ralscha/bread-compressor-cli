const util = require('util');
const fs = require('fs');
const path = require('path');

const brotliAdapter = require('./brotli-adapter');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const brotli = brotliAdapter();

async function brotliCompressFile(file, options) {
    const stat = fs.statSync(file);
    const content = await readFile(file);
    const {outputDir='', ...brotliOptions} = options;
    const compressedContent = brotli.compress(content, brotliOptions);
    if (compressedContent !== null && compressedContent.length < stat.size) {
        const outputPath = path.join(outputDir, file + '.br');
        await writeFile(outputPath, compressedContent);
        return compressedContent.length;
    }
    return stat.size;
}

process.on('message', async (message) => {
    const file = await brotliCompressFile(message.name, message.options);
    process.send(file);
});
