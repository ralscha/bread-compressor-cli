#!/usr/bin/env node

import {compress} from './index.js';

compress('gzip')
    .then(() => compress('brotli'))
    .then(() => compress('zstd'))
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
