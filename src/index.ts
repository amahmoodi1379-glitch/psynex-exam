import { html, page } from "./lib/http";
import { routeAdmin } from "./routes/admin";
import { routeStudent } from "./routes/student";
import { routeManagement } from "./routes/management";
import { routeTaxonomy } from "./routes/taxonomy";

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      const body = `<h1>Psynex Exam</h1><p>اسکلت ماژولار. از منوی بالا وارد شوید.</p>`;
      return html(page("خانه", body));
    }

    return (
      routeAdmin(req, url) ??
      routeStudent(req, url) ??
      (await routeManagement(req, url, env)) ??
      (await routeTaxonomy(req, url, env)) ??
      html(page("یافت نشد", "<h1>404</h1>"), 404)
    );
  }
};
