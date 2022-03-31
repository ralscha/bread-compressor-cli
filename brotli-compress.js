import * as fs from "fs";
import * as util from "util";
import * as zlib from "zlib";

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

async function brotliCompressFile(file, options) {
    const stat = fs.statSync(file);
    const content = await readFile(file);

    let brotliMode;
    if (options.mode === 1) {
        brotliMode = zlib.constants.BROTLI_MODE_TEXT;
    } else if (options.mode === 2) {
        brotliMode = zlib.constants.BROTLI_MODE_FONT;
    } else {
        brotliMode = zlib.constants.BROTLI_MODE_GENERIC;
    }
    options = {
        params: {
            [zlib.constants.BROTLI_PARAM_MODE]: brotliMode,
            [zlib.constants.BROTLI_PARAM_QUALITY]: options.quality,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: stat.size,
            [zlib.constants.BROTLI_PARAM_LGWIN]: options.lgwin
        }
    };

    const compressedContent = zlib.brotliCompressSync(content, options);
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

process.send({ready: true});
