const brotliAdapter = () => {
	try {
		const iltorb = require('iltorb')
		return { compress: iltorb.compressSync }
	} catch (err) {
		const brotli = require('brotli')
		return brotli
	}
}

module.exports = brotliAdapter
