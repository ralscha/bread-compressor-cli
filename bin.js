#!/usr/bin/env node

import {compress} from './index.js';

compress('gzip').then(() => compress('brotli')).catch(console.log);
