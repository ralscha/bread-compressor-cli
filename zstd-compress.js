import * as fs from "fs";
import * as util from "util";
import { init, compress } from "@bokuweb/zstd-wasm";

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

async function zstdCompressFile(file, options) {
    await init();
    const stat = fs.statSync(file);
    const content = await readFile(file);

    const compressedContent = compress(content, options.level);
    if (compressedContent !== null && compressedContent.length < stat.size) {
        await writeFile(file + '.zst', compressedContent);
        return compressedContent.length;
    }
    return stat.size;
}

process.on('message', async (message) => {
    const fileSize = await zstdCompressFile(message.name, message.options);
    process.send(fileSize);
});

process.send({ready: true});
