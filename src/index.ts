export default {
  fetch(_request: Request): Response {
    return new Response("OK - from GitHub deploy 1", {
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
};
