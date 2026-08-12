// Camera RAW extensions the browser/OS usually can't map to a MIME type on
// its own (unlike .jpg/.png/.heic, which either get a correct type or get
// patched by react-dropzone's own extension table) — file.type stays blank
// for these. Blank type fails both the dropzone accept check (fixed by
// listing the extensions below) and the actual upload's Content-Type
// (fixed by inferContentType, since the server only allows "image/*").
const RAW_EXTENSION_MIME: Record<string, string> = {
  dng: "image/x-adobe-dng",
  cr2: "image/x-canon-cr2",
  cr3: "image/x-canon-cr3",
  crw: "image/x-canon-crw",
  nef: "image/x-nikon-nef",
  nrw: "image/x-nikon-nrw",
  arw: "image/x-sony-arw",
  srf: "image/x-sony-srf",
  sr2: "image/x-sony-sr2",
  raf: "image/x-fuji-raf",
  orf: "image/x-olympus-orf",
  rw2: "image/x-panasonic-rw2",
  pef: "image/x-pentax-pef",
  srw: "image/x-samsung-srw",
  x3f: "image/x-sigma-x3f",
  "3fr": "image/x-hasselblad-3fr",
  iiq: "image/x-phaseone-iiq",
  rwl: "image/x-leica-rwl",
};

export const RAW_EXTENSIONS = Object.keys(RAW_EXTENSION_MIME).map((ext) => `.${ext}`);

export function inferRawContentType(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext ? (RAW_EXTENSION_MIME[ext] ?? null) : null;
}
