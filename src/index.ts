export default {
  fetch(_request: Request): Response {
    return new Response("OK - from GitHub repo skeleton", {
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
};
