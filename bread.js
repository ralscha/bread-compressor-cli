#!/usr/bin/env node

const compressor = require('./index');
compressor.compress('zopfli').then(() => compressor.compress('brotli')).catch(console.log);
