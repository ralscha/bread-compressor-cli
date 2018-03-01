#!/usr/bin/env node

const compressor = require('./index');
const argv = require('minimist')(process.argv.slice(2));

// mode: 0 = generic, 1 = text, 2 = font (WOFF2)
// quality: 0 - 11
// lgwin: window size

const options = {
    mode: argv.mode != null ? argv.mode : 1, 
    quality: argv.quality != null ? argv.quality : 11, 
    lgwin: argv.lgwin != null ? argv.lgwin : 22
};
compressor.brotliCompress(argv._, options);

