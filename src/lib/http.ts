export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700&display=swap">
  <!-- استایل‌های پایه برای ظاهر مدرن‌تر -->
  <style>
    body {
      font-family: "Vazirmatn", "IRANSans", "IRANYekan", Tahoma, system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
      max-width: 960px;
      margin: 24px auto;
      padding: 0 16px;
      line-height: 1.7;
      background-color: #f9fafb;
      color: #222;
    }
    nav {
      display: flex;
      gap: 12px;
      margin: 16px 0;
      border-bottom: 1px solid #e5e5e5;
      padding-bottom: 8px;
    }
    nav a {
      color: #0b5ed7;
      font-weight: 600;
      text-decoration: none;
      transition: color .15s ease;
    }
    nav a:hover {
      color: #084298;
    }
    .card {
      background: #fff;
      border: 1px solid #e1e1e1;
      border-radius: 16px;
      padding: 20px;
      margin: 16px 0;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
    }
    .muted {
      color: #666;
      font-size: 14px;
    }
    input,
    select {
      padding: 8px 12px;
      border: 1px solid #ccc;
      border-radius: 8px;
      font-family: inherit;
      font-size: 14px;
      min-width: 180px;
    }
    input:focus,
    select:focus {
      outline: 3px solid rgba(11, 94, 215, 0.4);
      border-color: #0b5ed7;
    }
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 8px;
      background-color: #0b5ed7;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      transition: background-color .15s ease, transform .1s ease;
    }
    button:hover {
      background-color: #0948b2;
      transform: translateY(-1px);
    }
    button:active {
      transform: translateY(0);
    }
    button:disabled {
      background-color: #9bbfe2;
      cursor: not-allowed;
    }
    .tabs a {
      margin-right: 8px;
    }
  </style>
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
