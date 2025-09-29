import { html, page } from "./lib/http";
import { routeAdmin } from "./routes/admin";
import { routeStudent } from "./routes/student";
import { routeManagement } from "./routes/management";
import { routeTaxonomy } from "./routes/taxonomy";


export default {
  fetch(req): Response | Promise<Response> {
    const url = new URL(req.url);

    // صفحه اصلی
    if (url.pathname === "/") {
      const body = `
        <h1>Psynex Exam</h1>
        <p>این یک اسکلت ماژولار ساده است. از لینک‌های بالا وارد صفحات شوید.</p>
      `;
      return html(page("خانه", body));
    }

    // تلاش برای روت‌های ماژولار
    return (
      routeAdmin(req, url) ??
      routeStudent(req, url) ??
      routeManagement(req, url) ??
      routeTaxonomy(req, url) ??
      html(page("یافت نشد", "<h1>404</h1>"), 404)
    );
  }
};
