import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { getRunVideoFile } from '../../../lib/runner.js';

export async function GET(request, { params }) {
  const { id } = await params;
  const video = getRunVideoFile(id);
  if (!video) {
    return new Response('Not found', { status: 404 });
  }

  const nodeStream = createReadStream(video.path);
  const webStream = Readable.toWeb(nodeStream);

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'video/webm',
      'Content-Length': String(video.size),
    },
  });
}
