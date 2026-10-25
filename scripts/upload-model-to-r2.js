/**
 * Upload a local GGUF to Cloudflare R2, then update manifest.json manually
 * (or extend this script to rewrite the manifest).
 *
 * Usage:
 *   CLOUDFLARE_R2_ENDPOINT=... CLOUDFLARE_R2_ACCESS_KEY=... \
 *   CLOUDFLARE_R2_SECRET=... CLOUDFLARE_R2_BUCKET=boxai-models \
 *   node scripts/upload-model-to-r2.js ./path/to/model.gguf
 */
const {S3Client, PutObjectCommand} = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

async function upload() {
  const filePath = process.argv[2];
  if (!filePath || !fs.existsSync(filePath)) {
    console.error('Usage: node scripts/upload-model-to-r2.js <file.gguf>');
    process.exit(1);
  }

  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET || 'boxai-models';

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error('Missing CLOUDFLARE_R2_* env vars');
    process.exit(1);
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {accessKeyId, secretAccessKey},
  });

  const key = path.basename(filePath);
  const body = fs.readFileSync(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/octet-stream',
    }),
  );
  console.log(
    `Uploaded ${key} to ${bucket}. Update manifest.json on the public/tunnel URL.`,
  );
}

upload().catch(err => {
  console.error(err);
  process.exit(1);
});
