import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import zlib from 'node:zlib';

import {ensureZopfliGoBinary, resolveTarget} from '../zopfli-go-binary.js';

test('ensureZopfliGoBinary downloads once and reuses the cached binary', async () => {
    const tempDirectory = await mkdtemp(resolve(tmpdir(), 'bread-compressor-cli-cache-'));
    const target = resolveTarget();
    const binaryFileName = `zopfli-go${target.extension}`;
    const archive = target.archiveType === 'zip'
        ? createZipArchive([{name: binaryFileName, data: Buffer.from('binary-data')}])
        : createTarGzArchive([{name: binaryFileName, data: Buffer.from('binary-data')}]);

    let requestCount = 0;
    const server = createServer((_, response) => {
        requestCount += 1;
        response.writeHead(200, {
            'Content-Length': archive.length,
            'Content-Type': 'application/octet-stream'
        });
        response.end(archive);
    });

    await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
    const address = server.address();

    process.env.BREAD_COMPRESSOR_ZOPFLI_GO_CACHE_DIR = tempDirectory;
    process.env.BREAD_COMPRESSOR_ZOPFLI_GO_DOWNLOAD_URL = `http://127.0.0.1:${address.port}/zopfli-go${target.archiveExtension}`;

    try {
        const firstBinaryPath = await ensureZopfliGoBinary();
        const secondBinaryPath = await ensureZopfliGoBinary();

        assert.equal(secondBinaryPath, firstBinaryPath);
        assert.equal(requestCount, 1);
        assert.equal(await readFile(firstBinaryPath, 'utf8'), 'binary-data');
    } finally {
        delete process.env.BREAD_COMPRESSOR_ZOPFLI_GO_CACHE_DIR;
        delete process.env.BREAD_COMPRESSOR_ZOPFLI_GO_DOWNLOAD_URL;
        await new Promise((resolvePromise, rejectPromise) => {
            server.close(error => {
                if (error) {
                    rejectPromise(error);
                    return;
                }

                resolvePromise();
            });
        });
    }
});

function createZipArchive(entries) {
    const localRecords = [];
    const centralRecords = [];
    let localOffset = 0;

    for (const entry of entries) {
        const fileName = Buffer.from(entry.name, 'utf8');
        const compressedData = zlib.deflateRawSync(entry.data);
        const crc32 = zlib.crc32(entry.data);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt32LE(0, 10);
        localHeader.writeUInt32LE(crc32, 14);
        localHeader.writeUInt32LE(compressedData.length, 18);
        localHeader.writeUInt32LE(entry.data.length, 22);
        localHeader.writeUInt16LE(fileName.length, 26);
        localHeader.writeUInt16LE(0, 28);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt32LE(0, 12);
        centralHeader.writeUInt32LE(crc32, 16);
        centralHeader.writeUInt32LE(compressedData.length, 20);
        centralHeader.writeUInt32LE(entry.data.length, 24);
        centralHeader.writeUInt16LE(fileName.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(localOffset, 42);

        localRecords.push(localHeader, fileName, compressedData);
        centralRecords.push(centralHeader, fileName);
        localOffset += localHeader.length + fileName.length + compressedData.length;
    }

    const centralDirectory = Buffer.concat(centralRecords);
    const endOfCentralDirectory = Buffer.alloc(22);
    endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
    endOfCentralDirectory.writeUInt16LE(0, 4);
    endOfCentralDirectory.writeUInt16LE(0, 6);
    endOfCentralDirectory.writeUInt16LE(entries.length, 8);
    endOfCentralDirectory.writeUInt16LE(entries.length, 10);
    endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
    endOfCentralDirectory.writeUInt32LE(localOffset, 16);
    endOfCentralDirectory.writeUInt16LE(0, 20);

    return Buffer.concat([...localRecords, centralDirectory, endOfCentralDirectory]);
}

function createTarGzArchive(entries) {
    return zlib.gzipSync(createTarArchive(entries));
}

function createTarArchive(entries) {
    const records = [];

    for (const entry of entries) {
        const header = Buffer.alloc(512, 0);
        const name = Buffer.from(entry.name, 'utf8');
        if (name.length > 100) {
            throw new Error(`tar test entry name too long: ${entry.name}`);
        }

        name.copy(header, 0);
        writeTarOctal(header, 100, 8, 0o755);
        writeTarOctal(header, 108, 8, 0);
        writeTarOctal(header, 116, 8, 0);
        writeTarOctal(header, 124, 12, entry.data.length);
        writeTarOctal(header, 136, 12, 0);
        header.fill(0x20, 148, 156);
        header.write('0', 156, 'ascii');
        Buffer.from('ustar\0', 'ascii').copy(header, 257);
        Buffer.from('00', 'ascii').copy(header, 263);

        const checksum = calculateTarChecksum(header);
        writeTarOctal(header, 148, 8, checksum);

        records.push(header, entry.data, Buffer.alloc(padTarSize(entry.data.length), 0));
    }

    records.push(Buffer.alloc(1024, 0));
    return Buffer.concat(records);
}

function writeTarOctal(buffer, offset, length, value) {
    const encoded = value.toString(8).padStart(length - 2, '0');
    buffer.write(`${encoded}\0 `, offset, length, 'ascii');
}

function calculateTarChecksum(header) {
    let checksum = 0;
    for (const byte of header) {
        checksum += byte;
    }
    return checksum;
}

function padTarSize(size) {
    const remainder = size % 512;
    return remainder === 0 ? 0 : 512 - remainder;
}