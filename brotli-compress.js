const util = require('util');
const fs = require('fs');
const brotli = require('brotli');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

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

process.on('message', async (message) => {
    const file = await brotliCompressFile(message.name, message.options);
    process.send(file);
});
