#!/usr/bin/env node

const compressor = require('./index');
const argv = require('minimist')(process.argv.slice(2));

const options = {
    numiterations: argv.numiterations != null ? argv.numiterations : 15,
};
compressor.zopfliCompress(argv._, options);

const options2 = {
    mode: argv.mode != null ? argv.mode : 1, 
    quality: argv.quality != null ? argv.quality : 11, 
    lgwin: argv.lgwin != null ? argv.lgwin : 22
};
compressor.brotliCompress(argv._, options2);