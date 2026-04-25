// // Generates src-tauri/icons/icon.ico (required by tauri-build on Windows)
// // Run once: node scripts/gen-icons.mjs
// import { writeFileSync, mkdirSync } from "fs";
// import { join, dirname } from "path";
// import { fileURLToPath } from "url";
//
// const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// const iconsDir = join(root, "src-tauri", "icons");
// mkdirSync(iconsDir, { recursive: true });
//
// function solidIco(sizes) {
//   const images = sizes.map((sz) => {
//     // 32-bit BGRA pixel data (solid indigo #6366f1)
//     const pixels = Buffer.alloc(sz * sz * 4);
//     for (let i = 0; i < sz * sz; i++) {
//       pixels[i * 4 + 0] = 241; // B
//       pixels[i * 4 + 1] = 102; // G
//       pixels[i * 4 + 2] = 99;  // R
//       pixels[i * 4 + 3] = 255; // A
//     }
//
//     // BITMAPINFOHEADER (40 bytes) — height doubled for ICO AND mask convention
//     const bih = Buffer.alloc(40);
//     bih.writeUInt32LE(40, 0);
//     bih.writeInt32LE(sz, 4);
//     bih.writeInt32LE(sz * 2, 8);
//     bih.writeUInt16LE(1, 12);
//     bih.writeUInt16LE(32, 14);
//     // rest zero = BI_RGB, no compression
//
//     // AND mask — all zeros means fully opaque, padded to 4-byte rows
//     const maskRowBytes = Math.ceil(sz / 32) * 4;
//     const andMask = Buffer.alloc(maskRowBytes * sz, 0);
//
//     return Buffer.concat([bih, pixels, andMask]);
//   });
//
//   const count = sizes.length;
//   const headerSize = 6;
//   const dirSize = 16 * count;
//
//   const header = Buffer.alloc(headerSize);
//   header.writeUInt16LE(0, 0); // reserved
//   header.writeUInt16LE(1, 2); // type = ICO
//   header.writeUInt16LE(count, 4);
//
//   const dirs = Buffer.alloc(dirSize);
//   let imgOffset = headerSize + dirSize;
//   images.forEach((img, i) => {
//     const sz = sizes[i];
//     const w = sz >= 256 ? 0 : sz; // 0 means 256 in ICO spec
//     const o = i * 16;
//     dirs.writeUInt8(w, o + 0);
//     dirs.writeUInt8(w, o + 1);
//     dirs.writeUInt8(0, o + 2);
//     dirs.writeUInt8(0, o + 3);
//     dirs.writeUInt16LE(1, o + 4);
//     dirs.writeUInt16LE(32, o + 6);
//     dirs.writeUInt32LE(img.length, o + 8);
//     dirs.writeUInt32LE(imgOffset, o + 12);
//     imgOffset += img.length;
//   });
//
//   return Buffer.concat([header, dirs, ...images]);
// }
//
// writeFileSync(join(iconsDir, "icon.ico"), solidIco([16, 32, 48, 256]));
// console.log("✓ src-tauri/icons/icon.ico created");
// console.log("  Now run: npm run tauri dev");
