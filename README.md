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
The tool ignores by default files with the suffix .gz, .br, .zip, .png, .jpeg, .jpg, .woff and .woff2.
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
bread-compressor dist/**/*.css dist/**/*.js dist/**/*.html
```

Compress files in *dist* folder and subfolder, except *big.txt* and files ending with *.pdf*
```
bread-compressor dist !big.txt !*.pdf
```

See the globby project site for more information about the supported glob patterns:    
https://github.com/sindresorhus/globby


#### Algorithm
The tool compresses the files by default with gzip and brotli. You can set the `-a` option 
if you only want to compress with gzip or brotli.

Compress only with gzip
```
bread-compressor -a gzip dist
```

Compress only with brotli
```
bread-compressor -a brotli dist
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


#### Concurrent tasks
By default two tasks will run concurrently. You can change this number with the `-l` option

Run 4 compression tasks concurrently.
```
bread-compressor -l 4 dist
```


## Internals
This tool depends on [@gfx/zopfli](https://github.com/gfx/universal-zopfli-js) for GZip compression
and [brotli](https://www.npmjs.com/package/brotli) for Brotli compression.

Other dependecies are [commander](https://github.com/tj/commander.js) for command line argument parsing, [chalk](https://github.com/chalk/chalk) for terminal output styling,  [globby](https://github.com/sindresorhus/globby) for glob matching and [promise-limit](https://github.com/featurist/promise-limit) for limiting concurrent tasks. 

