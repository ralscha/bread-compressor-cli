Command line tool for compressing static resources with brotli and gzip. 


## Installation
```
npm install bread-compressor-cli -D
```


## Usage
Call the tool with npx
```
npx bread-compressor dist
```

or insert a script in package.json
```
 "scripts": {
	"compress": "bread-compressor dist"
  },
```
and run it with npm
```
npm run compress
```


#### Ignores
The tool ignores by default files with the suffix .gz, .br, .zst, .zip, .png, .jpeg, .jpg, .woff and .woff2.
You can disable this with the `-n` option and all files will be compressed.
```
bread-compressor -n dist
```


#### Glob
You can specify multiple paths in one call, the tool processes all files that match the globs.

Compress files in *dist* and *www* folder and subfolders.
``` 
bread-compressor dist www
```
These globs are shortcuts for dist/\*\*/* and www/\*\*/*


Only compress *.css*, *.js* and *.html* files in the *dist* folder and subfolders.
``` 
bread-compressor "dist/**/*.css" "dist/**/*.js" "dist/**/*.html"
```

Compress files in *dist* folder and subfolder, except *big.txt* and files ending with *.pdf*
```
bread-compressor dist "!big.txt" "!*.pdf"
```

See the globby project site for more information about the supported glob patterns:    
https://github.com/sindresorhus/globby


#### Algorithm
The tool compresses the files by default with gzip and brotli. You can set the `-a` option 
to specify which algorithm to use. The -a options expects a comma separated list of algorithms.

Compress with gzip only
```
bread-compressor -a gzip dist
```

Compress with brotli and zstandard
```
bread-compressor -a brotli,zstd dist
```


#### Statistics
The tool prints out a summary with the `-s` option. 

```
bread-compressor -s dist
```

```                                    
gzip                                                              
Number of Files  : 7                                              
Uncompressed     : 53,467 Bytes                                   
Compressed       : 11,799 Bytes                                   
Compression Ratio: 22.07%                                         
Compression Time : 4.341 s                                        
                                                                  
brotli                                                            
Number of Files  : 7                                              
Uncompressed     : 53,467 Bytes                                   
Compressed       : 9,830 Bytes                                    
Compression Ratio: 18.39%                                         
Compression Time : 0.562 s                                        
```


#### Zopfli options
You can pass options to the underlying zopfli library. 

```
bread-compressor --zopfli-numiterations=15 --zopfli-blocksplittinglast=true dist
```

See the project site of [@gfx/zopfli](https://github.com/gfx/universal-zopfli-js) for more information.


#### Brotli options
You can pass options to the underlying brotli library. 

```
bread-compressor --brotli-mode=0 --brotli-quality=10 --brotli-lgwin=21 dist
```

See the project site of [brotli](https://www.npmjs.com/package/brotli) for more information.

#### Zstandard options
You can pass options to the underlying zstd-wasm library. 

```
bread-compressor --zstd-level=10 -a zstd dist
```

See the project site of [zstd-wasm](https://github.com/bokuweb/zstd-wasm)

#### Concurrent tasks
By default, two tasks will run concurrently. You can change this number with the `-l` option

Run 4 compression tasks concurrently.
```
bread-compressor -l 4 dist
```


## Internals
This tool depends on [@gfx/zopfli](https://github.com/gfx/universal-zopfli-js) and [node-zopfli-es](https://github.com/jaeh/node-zopfli-es) for GZip compression, 
[brotli](https://www.npmjs.com/package/brotli) for Brotli compression and [zstd-wasm](https://github.com/bokuweb/zstd-wasm) 
for Zstandard compression.

Other dependecies are [commander](https://github.com/tj/commander.js) for command line argument parsing, [chalk](https://github.com/chalk/chalk) for terminal output styling,  [globby](https://github.com/sindresorhus/globby) for glob matching and [promise-limit](https://github.com/featurist/promise-limit) for limiting concurrent tasks. 



## Browser Support for Brotli

Current versions of the major browsers send `br` in the `Accept-Encoding` header when the request is sent over TLS

Support introduced in version ...

  * Edge 15
  * Firefox 44
  * Chrome 50
  * Safari 11


## Browser Support for Zstandard

  * Chrome 123

https://caniuse.com/zstd


## Server support

To take advantage of precompressed resources you need a server that is able to understand the `Accept-Encoding` header and serve files ending with `.gz` and `.br` accordingly.

#### Nginx 
Nginx supports Gzip compressed files out of the box with the `gzip_static` directive. 

Add this to a `http`, `server` or `location` section and Nginx will automatically search for files ending with .gz when the request contains an `Accept-Encoding` header with the value `gzip`. 
```
gzip_static  on;  
```
See the [documentation](http://nginx.org/en/docs/http/ngx_http_gzip_static_module.html) for more information.

To enable Brotli support you either 
  * build the [ngx_brotli](https://github.com/google/ngx_brotli) from source:          
    https://www.majlovesreg.one/adding-brotli-to-a-built-nginx-instance
  * or install a pre-built Nginx from ppa with the brotli module included:  
    https://gablaxian.com/blog/brotli-compression
  * or use the approach described in this blog post that works without the brotli module:    
    https://siipo.la/blog/poor-mans-brotli-serving-brotli-files-without-nginx-brotli-module


#### Apache HTTP
https://css-tricks.com/brotli-static-compression/     
https://blog.desgrange.net/post/2017/04/10/pre-compression-with-gzip-and-brotli-in-apache.html


#### LightSpeed
Support for Brotli introduced in version [5.2](https://www.litespeedtech.com/products/litespeed-web-server/release-log)



