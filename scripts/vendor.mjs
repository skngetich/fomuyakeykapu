// Copies the browser files the app ships from node_modules into the repo, so
// the unbuilt source tree runs as-is. Run after updating these packages; CI
// fails if the committed copies drift from the installed versions.
//
//   app/vendor/  jsPDF and svg2pdf.js, loaded only when a PDF is made
//   fonts/       Figtree TTFs for embedding in the PDF (jsPDF needs TrueType;
//                the page itself uses the WOFF2 files beside them)
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NM = join(ROOT, 'node_modules');

const FILES = [
  ['jspdf/dist/jspdf.umd.min.js', 'app/vendor/jspdf.umd.min.js'],
  ['jspdf/LICENSE', 'app/vendor/jspdf.LICENSE'],
  ['svg2pdf.js/dist/svg2pdf.umd.min.js', 'app/vendor/svg2pdf.umd.min.js'],
  ['svg2pdf.js/LICENSE', 'app/vendor/svg2pdf.LICENSE'],
  ['@expo-google-fonts/figtree/400Regular/Figtree_400Regular.ttf', 'fonts/Figtree-Regular.ttf'],
  ['@expo-google-fonts/figtree/600SemiBold/Figtree_600SemiBold.ttf', 'fonts/Figtree-SemiBold.ttf'],
];

for (const [from, to] of FILES) {
  await mkdir(dirname(join(ROOT, to)), { recursive: true });
  await copyFile(join(NM, from), join(ROOT, to));
}
console.log(`Vendored ${FILES.length} files`);
