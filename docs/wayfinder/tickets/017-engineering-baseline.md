---
title: آماده‌سازی خط پایه توسعه، تست و CI
status: closed
type: task
label: wayfinder:task
claimed_by:
blocked_by:
  - انتخاب پشته فنی و شکل استقرار نسخه اول
  - تعیین مرز ماژول‌ها و قراردادهای کار موازی
---

## پرسش

چه scaffold حداقلی، فرمان‌های توسعه محلی، کنترل کیفیت، تست، CI، مدیریت محیط و قرارداد mock لازم است تا دو مسیر خریدار و فروشنده بتوانند مستقل و قابل ادغام شروع شوند؟

## خروجی مورد انتظار

مخزن قابل اجرا با یک فرمان مستند، lint/typecheck/test در CI، نمونه قرارداد مشترک، سیاست migration، محیط نمونه بدون secret و راهنمای افزودن ماژول. این کار فقط پس از بسته‌شدن دو تصمیم بالادستی انجام می‌شود.

## نتیجه

خط پایه شامل pnpm workspace برای web، API و worker، PostgreSQL محلی، اجرای یک‌فرمانی، CI برای format/lint/architecture/typecheck/test/build/E2E/audit، قرارداد OpenAPI، آزمون PostgreSQL واقعی، سیاست مالکیت migration، Dockerfile و محیط نمونه بدون secret است. RTL/PWA، قلم محلی و کنترل‌های دسترس‌پذیری نیز در خط پایه پوشش داده شده‌اند.
