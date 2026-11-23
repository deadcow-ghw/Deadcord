"use strict";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_STRIP_CHUNKS = new Set([
    "eXIf", "tEXt", "iTXt", "zTXt", "tIME", "pHYs",
    "oFFs", "sCAL", "pCAL", "dSIG", "sPLT", "hIST"
]);

function stripJpegMetadata(buf) {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
        return { buffer: buf, stripped: false, removedBytes: 0 };
    }

    const parts = [buf.subarray(0, 2)];
    let offset = 2;
    let removedBytes = 0;
    let stripped = false;

    while (offset < buf.length) {
        if (buf[offset] !== 0xff) {
            parts.push(buf.subarray(offset));
            break;
        }

        let markerPos = offset;
        while (markerPos < buf.length && buf[markerPos] === 0xff) {
            markerPos++;
        }
        if (markerPos >= buf.length) {
            parts.push(buf.subarray(offset));
            break;
        }

        const marker = buf[markerPos];

        if (marker === 0xda || marker === 0xd9) {
            parts.push(buf.subarray(offset));
            break;
        }

        if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
            parts.push(buf.subarray(offset, markerPos + 1));
            offset = markerPos + 1;
            continue;
        }

        if (markerPos + 2 >= buf.length) {
            parts.push(buf.subarray(offset));
            break;
        }

        const segLen = buf.readUInt16BE(markerPos + 1);
        const segEnd = markerPos + 1 + segLen;
        if (segLen < 2 || segEnd > buf.length) {
            parts.push(buf.subarray(offset));
            break;
        }

        const isAppMeta = marker >= 0xe1 && marker <= 0xef;
        const isComment = marker === 0xfe;

        if (isAppMeta || isComment) {
            const isIccProfile = marker === 0xe2 &&
                segLen >= 16 &&
                buf.subarray(markerPos + 3, markerPos + 15).toString("ascii") === "ICC_PROFILE\0";

            if (isIccProfile) {
                parts.push(buf.subarray(offset, segEnd));
            } else {
                stripped = true;
                removedBytes += (segEnd - offset);
            }
        } else {
            parts.push(buf.subarray(offset, segEnd));
        }

        offset = segEnd;
    }

    if (!stripped) {
        return { buffer: buf, stripped: false, removedBytes: 0 };
    }
    return { buffer: Buffer.concat(parts), stripped: true, removedBytes };
}

function stripPngMetadata(buf) {
    if (buf.length < 16 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return { buffer: buf, stripped: false, removedBytes: 0 };
    }

    const parts = [PNG_SIGNATURE];
    let offset = 8;
    let removedBytes = 0;
    let stripped = false;

    while (offset + 12 <= buf.length) {
        const chunkLen = buf.readUInt32BE(offset);
        const chunkEnd = offset + 12 + chunkLen;
        if (chunkEnd > buf.length) {
            return { buffer: buf, stripped: false, removedBytes: 0 };
        }

        const chunkType = buf.subarray(offset + 4, offset + 8).toString("ascii");
        if (PNG_STRIP_CHUNKS.has(chunkType)) {
            stripped = true;
            removedBytes += (chunkEnd - offset);
        } else {
            parts.push(buf.subarray(offset, chunkEnd));
        }

        offset = chunkEnd;
        if (chunkType === "IEND") break;
    }

    if (!stripped) {
        return { buffer: buf, stripped: false, removedBytes: 0 };
    }
    return { buffer: Buffer.concat(parts), stripped: true, removedBytes };
}

function stripWebpMetadata(buf) {
    if (
        buf.length < 12 ||
        buf.subarray(0, 4).toString("ascii") !== "RIFF" ||
        buf.subarray(8, 12).toString("ascii") !== "WEBP"
    ) {
        return { buffer: buf, stripped: false, removedBytes: 0 };
    }

    const chunks = [];
    let offset = 12;
    let removedBytes = 0;
    let stripped = false;

    while (offset + 8 <= buf.length) {
        const fourcc = buf.subarray(offset, offset + 4).toString("ascii");
        const chunkSize = buf.readUInt32LE(offset + 4);
        const paddedSize = chunkSize + (chunkSize % 2);
        const chunkEnd = offset + 8 + paddedSize;
        if (chunkEnd > buf.length) {
            return { buffer: buf, stripped: false, removedBytes: 0 };
        }

        if (fourcc === "EXIF" || fourcc === "XMP ") {
            stripped = true;
            removedBytes += (chunkEnd - offset);
        } else {
            const slice = Buffer.from(buf.subarray(offset, chunkEnd));
            if (fourcc === "VP8X" && slice.length >= 12) {
                slice[8] = slice[8] & ~(0x08 | 0x04);
            }
            chunks.push(slice);
        }

        offset = chunkEnd;
    }

    if (!stripped) {
        return { buffer: buf, stripped: false, removedBytes: 0 };
    }

    const body = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(4 + body.length, 4);
    header.write("WEBP", 8, "ascii");

    return { buffer: Buffer.concat([header, body]), stripped: true, removedBytes };
}

function stripImageMetadata(inputBuffer, hint = "") {
    if (!inputBuffer || !Buffer.isBuffer(inputBuffer) || inputBuffer.length < 12) {
        return { buffer: inputBuffer, stripped: false, format: "unknown", removedBytes: 0 };
    }

    try {
        if (inputBuffer[0] === 0xff && inputBuffer[1] === 0xd8) {
            const res = stripJpegMetadata(inputBuffer);
            return { ...res, format: "jpeg" };
        }
        if (inputBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
            const res = stripPngMetadata(inputBuffer);
            return { ...res, format: "png" };
        }
        if (
            inputBuffer.subarray(0, 4).toString("ascii") === "RIFF" &&
            inputBuffer.subarray(8, 12).toString("ascii") === "WEBP"
        ) {
            const res = stripWebpMetadata(inputBuffer);
            return { ...res, format: "webp" };
        }
    } catch (_) {}

    return { buffer: inputBuffer, stripped: false, format: String(hint || "unknown"), removedBytes: 0 };
}

function getMainWorldExifStripperScript() {
    return `
(function() {
    if (window.__deadcordExifStripperInstalled) return;
    window.__deadcordExifStripperInstalled = true;

    const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const PNG_STRIP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME", "pHYs", "oFFs", "sCAL", "pCAL", "dSIG", "sPLT", "hIST"]);

    function concatU8(chunks) {
        let total = 0;
        for (let i = 0; i < chunks.length; i++) total += chunks[i].byteLength;
        const out = new Uint8Array(total);
        let pos = 0;
        for (let i = 0; i < chunks.length; i++) {
            out.set(chunks[i], pos);
            pos += chunks[i].byteLength;
        }
        return out;
    }

    function readAscii(u8, start, len) {
        let s = "";
        for (let i = 0; i < len; i++) s += String.fromCharCode(u8[start + i]);
        return s;
    }

    function stripJpegU8(u8) {
        if (u8.length < 4 || u8[0] !== 0xFF || u8[1] !== 0xD8) return null;
        const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        const parts = [u8.subarray(0, 2)];
        let offset = 2;
        let stripped = false;
        while (offset < u8.length) {
            if (u8[offset] !== 0xFF) { parts.push(u8.subarray(offset)); break; }
            let mp = offset;
            while (mp < u8.length && u8[mp] === 0xFF) mp++;
            if (mp >= u8.length) { parts.push(u8.subarray(offset)); break; }
            const marker = u8[mp];
            if (marker === 0xDA || marker === 0xD9) { parts.push(u8.subarray(offset)); break; }
            if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
                parts.push(u8.subarray(offset, mp + 1));
                offset = mp + 1;
                continue;
            }
            if (mp + 2 >= u8.length) { parts.push(u8.subarray(offset)); break; }
            const segLen = view.getUint16(mp + 1, false);
            const segEnd = mp + 1 + segLen;
            if (segLen < 2 || segEnd > u8.length) { parts.push(u8.subarray(offset)); break; }
            const isMeta = (marker >= 0xE1 && marker <= 0xEF) || marker === 0xFE;
            const isIcc = marker === 0xE2 && segLen >= 16 && readAscii(u8, mp + 3, 12) === "ICC_PROFILE\\0";
            if (isMeta && !isIcc) {
                stripped = true;
            } else {
                parts.push(u8.subarray(offset, segEnd));
            }
            offset = segEnd;
        }
        return stripped ? concatU8(parts) : null;
    }

    function stripPngU8(u8) {
        if (u8.length < 16) return null;
        for (let i = 0; i < 8; i++) if (u8[i] !== PNG_SIG[i]) return null;
        const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        const parts = [u8.subarray(0, 8)];
        let offset = 8;
        let stripped = false;
        while (offset + 12 <= u8.length) {
            const len = view.getUint32(offset, false);
            const end = offset + 12 + len;
            if (end > u8.length) return null;
            const type = readAscii(u8, offset + 4, 4);
            if (PNG_STRIP.has(type)) {
                stripped = true;
            } else {
                parts.push(u8.subarray(offset, end));
            }
            offset = end;
            if (type === "IEND") break;
        }
        return stripped ? concatU8(parts) : null;
    }

    function stripWebpU8(u8) {
        if (u8.length < 12 || readAscii(u8, 0, 4) !== "RIFF" || readAscii(u8, 8, 4) !== "WEBP") return null;
        const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        const chunks = [];
        let offset = 12;
        let stripped = false;
        while (offset + 8 <= u8.length) {
            const fourcc = readAscii(u8, offset, 4);
            const size = view.getUint32(offset + 4, true);
            const padded = size + (size % 2);
            const end = offset + 8 + padded;
            if (end > u8.length) return null;
            if (fourcc === "EXIF" || fourcc === "XMP ") {
                stripped = true;
            } else {
                const copy = new Uint8Array(u8.subarray(offset, end));
                if (fourcc === "VP8X" && copy.length >= 12) copy[8] &= ~(0x08 | 0x04);
                chunks.push(copy);
            }
            offset = end;
        }
        if (!stripped) return null;
        const body = concatU8(chunks);
        const hdr = new Uint8Array(12);
        hdr.set([0x52, 0x49, 0x46, 0x46], 0);
        new DataView(hdr.buffer).setUint32(4, 4 + body.byteLength, true);
        hdr.set([0x57, 0x45, 0x42, 0x50], 8);
        return concatU8([hdr, body]);
    }

    async function cleanFile(file) {
        if (!window.__deadcordExifEnabled) return file;
        if (!(file instanceof Blob) || file.size < 12 || file.size > 50 * 1024 * 1024) return file;
        const t = (file.type || "").toLowerCase();
        const name = (file.name || "").toLowerCase();
        if (t === "image/gif" || name.endsWith(".gif")) return file;
        if (!t.startsWith("image/") && !/\\.(jpe?g|png|webp)$/i.test(name)) return file;
        try {
            const ab = await file.arrayBuffer();
            const u8 = new Uint8Array(ab);
            const cleaned = stripJpegU8(u8) || stripPngU8(u8) || stripWebpU8(u8);
            if (!cleaned) return file;
            if (window.DeadcordNative && window.DeadcordNative.reportExifCleaned) {
                window.DeadcordNative.reportExifCleaned();
            }
            if (file instanceof File) {
                return new File([cleaned], file.name, { type: file.type, lastModified: Date.now() });
            }
            return new Blob([cleaned], { type: file.type });
        } catch (_) {
            return file;
        }
    }

    window.__deadcordCleanFile = cleanFile;

    const origFetch = window.fetch;
    if (typeof origFetch === "function") {
        window.fetch = async function(input, init) {
            try {
                if (window.__deadcordExifEnabled && init && init.body instanceof Blob) {
                    const url = typeof input === "string" ? input : (input && input.url) || "";
                    if (url.includes("discord-attachments") || url.includes("discord.com/api/")) {
                        const cleaned = await cleanFile(init.body);
                        if (cleaned !== init.body) {
                            init = Object.assign({}, init, { body: cleaned });
                        }
                    }
                }
            } catch (_) {}
            return origFetch.call(this, input, init);
        };
    }

    const origXhrOpen = XMLHttpRequest.prototype.open;
    const origXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
        this.__deadcordUrl = typeof url === "string" ? url : "";
        return origXhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
        if (
            window.__deadcordExifEnabled &&
            body instanceof Blob &&
            this.__deadcordUrl &&
            (this.__deadcordUrl.includes("discord-attachments") || this.__deadcordUrl.includes("discord.com/api/"))
        ) {
            const xhr = this;
            cleanFile(body).then((cleaned) => {
                origXhrSend.call(xhr, cleaned);
            }).catch(() => {
                origXhrSend.call(xhr, body);
            });
            return;
        }
        return origXhrSend.apply(this, arguments);
    };
})();
`;
}

module.exports = {
    stripImageMetadata,
    getMainWorldExifStripperScript
};
