// Public story links are retired until a separately verified service exists.
// Do not derive a replacement public origin from request headers.
export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(410).send('Public story sharing is unavailable. Save the image locally instead.');
}
