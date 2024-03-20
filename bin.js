#!/usr/bin/env node

import {compress} from './index.js';

compress('gzip').then(() => compress('brotli')).then(() => compress("zstd")).catch(console.log);
