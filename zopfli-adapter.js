export async function zopfliAdapter() {
    try {
        const zopfli_es_module = await import('node-zopfli-es');
        return zopfli_es_module.default;
    } catch (err) {
        const gfx_zopfli = await import('@gfx/zopfli');
        return gfx_zopfli.default;
    }
}
