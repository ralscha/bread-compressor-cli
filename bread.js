#!/usr/bin/env node

const compressor = require('./index');
const argv = require('minimist')(process.argv.slice(2));

const options = {
    numiterations: argv.numiterations != null ? argv.numiterations : 15,
};

const options2 = {
    mode: argv.mode != null ? argv.mode : 1, 
    quality: argv.quality != null ? argv.quality : 11, 
    lgwin: argv.lgwin != null ? argv.lgwin : 22
};
if (argv.silent) {
    options.silent = true;
    options2.silent = true;
}
compressor.compress(argv._, options, 'zopfli').then(()=>compressor.compress(argv._, options2, 'brotli'));