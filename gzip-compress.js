const util = require('util');
const fs = require('fs');
const zopfli = require('@gfx/zopfli');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

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

process.on('message', async (message) => {
    const file = await zopfliCompressFile(message.name, message.options);
    process.send(file);
});
