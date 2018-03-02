#!/usr/bin/env node

const compressor = require('./index');
const argv = require('minimist')(process.argv.slice(2));

const options = {
    numiterations: argv.numiterations != null ? argv.numiterations : 15,
};
if (argv.silent) {
    options.silent = true;
}
compressor.compress(argv._, options, 'zopfli');