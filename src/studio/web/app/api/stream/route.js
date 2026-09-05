import { subscribe, unsubscribe } from '../../../lib/runner.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();
  let callback;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'));

      callback = (event, data) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller may already be closed if the client disconnected.
        }
      };
      subscribe(callback);
    },
    cancel() {
      if (callback) unsubscribe(callback);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
