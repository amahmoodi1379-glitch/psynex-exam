import globalStyles from "./global.css?raw";

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
${globalStyles}
  </style>
</head>
<body>
  <nav class="app-nav">
    <a href="/">خانه</a>
    <a href="/admin">ادمین</a>
    <a href="/student">دانشجو</a>
    <a href="/management">مدیریت</a>
  </nav>
  <main class="page-content">
    ${body}
  </main>
</body>
</html>`;
}

export function html(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}
