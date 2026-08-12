// The project's default Vercel Blob store (BLOB_READ_WRITE_TOKEN) is
// configured as a public-access store, which Vercel Blob rejects private
// writes to entirely ("Cannot use private access on a public store"). Album
// and owner-history JSON need private access (they contain password hashes /
// are keyed by a supposed-to-be-secret owner id), so those go to a second,
// private-access store instead — photos themselves stay on the original
// public store via the default token.
export const PRIVATE_BLOB_TOKEN = process.env.PRIVATE_READ_WRITE_TOKEN;
