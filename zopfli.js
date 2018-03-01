#!/usr/bin/env node

const compressor = require('./index');
const argv = require('minimist')(process.argv.slice(2));

const options = {
    numiterations: argv.numiterations != null ? argv.numiterations : 15,
};
compressor.zopfliCompress(argv._, options);