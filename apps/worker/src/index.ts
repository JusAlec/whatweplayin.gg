export interface Env {
  KV: KVNamespace;
}

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response('GameNight OS worker', { status: 200 });
  },
} satisfies ExportedHandler<Env>;
