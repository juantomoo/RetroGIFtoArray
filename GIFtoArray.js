const fs = require('fs');
const readline = require('readline');
const gifFrames = require('gif-frames');
const { PNG } = require('pngjs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

const INPUT_GIF = 'ejemplo.gif';
const OUTPUT_BIN = 'pixels.bin';

async function analyzeGIF(input) {
    console.log("📊 Analizando el GIF...");
    const frames = await gifFrames({ url: input, frames: 'all', outputType: 'png' });

    if (!frames || frames.length === 0) {
        console.error("❌ Error: No se encontraron frames en el GIF.");
        process.exit(1);
    }

    const totalFrames = frames.length;
    const frameDuration = frames[0].frameInfo.delay * 10 || 100;
    const width = frames[0].frameInfo.width;
    const height = frames[0].frameInfo.height;
    const totalDuration = totalFrames * frameDuration;

    console.log(`📏 Resolución: ${width}x${height}`);
    console.log(`🎞️ Total de frames: ${totalFrames}`);
    console.log(`⏳ Duración de cada frame: ${frameDuration}ms`);
    console.log(`⏱️ Duración total del GIF: ${totalDuration}ms`);

    return { totalFrames, frameDuration, width, height, totalDuration };
}

(async () => {
    const gifInfo = await analyzeGIF(INPUT_GIF);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('🛠️ Ingrese el porcentaje de frames a conservar (1-100): ', async (percentage) => {
        const framePercentage = Math.max(1, Math.min(100, parseInt(percentage)));
        await processGIF(INPUT_GIF, OUTPUT_BIN, framePercentage, gifInfo);
        rl.close();
    });
})();

async function processGIF(input, outputBin, framePercentage, gifInfo) {
    const startTime = Date.now();
    const frames = await gifFrames({ url: input, frames: 'all', outputType: 'png' });

    const totalFrames = gifInfo.totalFrames;
    const frameSkip = Math.max(1, Math.round(100 / framePercentage));
    const newFrameDuration = Math.round(gifInfo.totalDuration / Math.ceil(totalFrames / frameSkip));

    console.log(`📉 Frames seleccionados: ${Math.ceil(totalFrames / frameSkip)}`);
    console.log(`⏳ Nueva duración de cada frame: ${newFrameDuration}ms`);

    const binStream = fs.createWriteStream(outputBin);
    
    // 🛠 CORRECCIÓN: Guardar ancho y alto en 2 bytes cada uno (16 bits)
    const header = Buffer.alloc(6);
    header.writeUInt16LE(gifInfo.width, 0);
    header.writeUInt16LE(gifInfo.height, 2);
    header.writeUInt16LE(newFrameDuration, 4);
    binStream.write(header);

    let processedFrames = 0;
    let firstFrameBuffer = null;

    for (let i = 0; i < totalFrames; i += frameSkip) {
        const progress = ((processedFrames / (totalFrames / frameSkip)) * 100).toFixed(2);
        const elapsedTime = (Date.now() - startTime) / 1000;
        const estimatedTotalTime = (elapsedTime / (processedFrames + 1)) * (totalFrames / frameSkip);
        const remainingTime = (estimatedTotalTime - elapsedTime).toFixed(2);
        console.log(`🚀 Progreso: ${progress}% - Procesando frame ${i + 1}/${totalFrames} - ⏱️ Tiempo restante: ${remainingTime}s`);

        try {
            const frame = frames[i];
            if (!frame) continue;
            const stream = frame.getImage();
            await streamPipeline(stream, fs.createWriteStream(`frame_${i}.png`));

            const pngBuffer = fs.readFileSync(`frame_${i}.png`);
            const png = PNG.sync.read(pngBuffer);
            const pixels = png.data;

            const frameBuffer = Buffer.alloc(gifInfo.width * gifInfo.height * 3);
            let index = 0;
            for (let j = 0; j < pixels.length; j += 4) {
                frameBuffer[index++] = pixels[j];     // R
                frameBuffer[index++] = pixels[j + 1]; // G
                frameBuffer[index++] = pixels[j + 2]; // B
            }

            if (processedFrames === 0) {
                firstFrameBuffer = frameBuffer;
            }

            binStream.write(frameBuffer);
            fs.unlinkSync(`frame_${i}.png`);
            processedFrames++;
        } catch (error) {
            console.error(`❌ Error procesando frame ${i + 1}:`, error);
        }
    }

    binStream.end();
    console.log(`✅ Archivo BIN generado: ${outputBin}`);
    console.log(`📏 Resolución: ${gifInfo.width}x${gifInfo.height}`);
    console.log(`🎞️ Frames en BIN: ${processedFrames}`);
    console.log(`⏳ Proceso completado en ${(Date.now() - startTime) / 1000}s`);

    // 📌 Verificar la calidad de la conversión
    verifyConversion(outputBin, gifInfo, firstFrameBuffer);
}

function verifyConversion(binFile, gifInfo, firstFrameBuffer) {
    fs.readFile(binFile, (err, data) => {
        if (err) {
            console.error("❌ Error leyendo el archivo BIN:", err);
            return;
        }

        console.log(`📂 Archivo BIN cargado (${data.length} bytes)`);

        // 🛠 CORRECCIÓN: Leer ancho y alto en 2 bytes (16 bits)
        const width = data.readUInt16LE(0);
        const height = data.readUInt16LE(2);
        const duration = data.readUInt16LE(4);

        console.log(`📏 Ancho: ${width}, Alto: ${height}, Duración de frame: ${duration}ms`);

        if (width !== gifInfo.width || height !== gifInfo.height) {
            console.error("❌ Error: Las dimensiones en el BIN no coinciden con el GIF original.");
            return;
        }

        if (data.length < gifInfo.width * gifInfo.height * 3 * 0.5) {
            console.error("⚠️ El archivo BIN parece más pequeño de lo esperado. Puede haber un error en la conversión.");
            return;
        }

        // Verificar los primeros píxeles del primer frame
        console.log("🔍 Comparando primeros píxeles del BIN con el primer frame convertido...");
        let match = true;
        for (let i = 6; i < 36; i++) {
            if (data[i] !== firstFrameBuffer[i - 6]) {
                match = false;
                break;
            }
        }

        if (match) {
            console.log("✅ Conversión exitosa. Los primeros píxeles coinciden correctamente.");
        } else {
            console.error("❌ Error en la conversión. Los primeros píxeles no coinciden con el frame original.");
        }
    });
}
