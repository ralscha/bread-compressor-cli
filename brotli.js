#!/usr/bin/env node

require('./index').compress('brotli').catch(console.log);