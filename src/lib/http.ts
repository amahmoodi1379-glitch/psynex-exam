type PageOptions = { headExtra?: string };

export function page(title: string, body: string, options: PageOptions = {}): string {
  const { headExtra = "" } = options;
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700&display=swap">
  <link rel="stylesheet" href="/styles.css">
  ${headExtra}
</head>
<body>
  <nav>
    <a href="/">خانه</a>
    <a href="/admin">ادمین</a>
    <a href="/student">دانشجو</a>
    <a href="/management">مدیریت</a>
  </nav>
  ${body}
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
