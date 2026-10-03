/* Canvas render pipeline: clear only near-white pixels connected to the image
   border. Interior whites (eyes, teeth, text, clothes) are kept. Embedded
   original sources let this work under file:// as well as an HTTP server. */
const SPRITES = [];
const spritesReady = Promise.all(STICKER_SOURCES.map((src, index) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
        try {
            const canvas = document.createElement('canvas');
            const w = canvas.width = image.naturalWidth;
            const h = canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d', {willReadFrequently: true});
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, w, h);
            const rgba = pixels.data;
            const visited = new Uint8Array(w * h);
            const queue = new Int32Array(w * h);
            let head = 0, tail = 0;
            function visit(p) {
                if (visited[p]) return;
                visited[p] = 1;
                const k = p * 4;
                const low = Math.min(rgba[k], rgba[k + 1], rgba[k + 2]);
                const high = Math.max(rgba[k], rgba[k + 1], rgba[k + 2]);
                if (low > 240 && high - low < 18) {
                    queue[tail++] = p;
                    rgba[k + 3] = 0;
                }
            }
            for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
            for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
            while (head < tail) {
                const p = queue[head++], x = p % w;
                if (x > 0) visit(p - 1);
                if (x < w - 1) visit(p + 1);
                if (p >= w) visit(p - w);
                if (p < w * (h - 1)) visit(p + w);
            }
            context.putImageData(pixels, 0, 0);
            const [x0, y0, x1, y1] = COLLISION_DATA[index].box;
            const sprite = document.createElement('canvas');
            sprite.width = x1 - x0; sprite.height = y1 - y0;
            sprite.getContext('2d').drawImage(canvas, x0, y0, sprite.width, sprite.height,
                0, 0, sprite.width, sprite.height);
            SPRITES[index] = sprite;
            resolve(sprite);
        } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error(`第 ${index + 1} 张人物图片加载失败`));
    image.src = src;
})));
