export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700&display=swap">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="app-header">
    <div class="container">
      <div class="row">
        <a class="brand" href="/">پرسینکس</a>
        <nav class="nav">
          <a href="/">خانه</a>
          <a href="/admin">ادمین</a>
          <a href="/student">دانشجو</a>
          <a href="/management">مدیریت</a>
        </nav>
      </div>
    </div>
  </header>
  <main class="container stack-4">
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
