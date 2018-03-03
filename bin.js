#!/usr/bin/env node

const compressor = require('./index');
compressor.compress('gzip').then(() => compressor.compress('brotli')).catch(console.log);
