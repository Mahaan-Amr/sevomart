---
title: آماده‌سازی خط پایه توسعه، تست و CI
status: resolved
type: task
label: wayfinder:task
claimed_by: Mahaan-Amr
blocked_by:
  - انتخاب پشته فنی و شکل استقرار نسخه اول
  - تعیین مرز ماژول‌ها و قراردادهای کار موازی
---

## پرسش

چه scaffold حداقلی، فرمان‌های توسعه محلی، کنترل کیفیت، تست، CI، مدیریت محیط و قرارداد mock لازم است تا دو مسیر خریدار و فروشنده بتوانند مستقل و قابل ادغام شروع شوند؟

## خروجی مورد انتظار

مخزن قابل اجرا با یک فرمان مستند، lint/typecheck/test در CI، نمونه قرارداد مشترک، سیاست migration، محیط نمونه بدون secret و راهنمای افزودن ماژول. این کار فقط پس از بسته‌شدن دو تصمیم بالادستی انجام می‌شود.

## تصمیم

pnpm workspace سبک با سه برنامه web، API و worker و بسته‌های مشترک محدود ساخته شد. `pnpm dev`
محیط محلی را با PostgreSQL بالا می‌آورد؛ CI قالب، lint و مرز معماری، typecheck، unit، contract،
integration، build و E2E موبایل/RTL را کنترل می‌کند. قرارداد REST نسخه‌دار/OpenAPI، مالکیت
migration و contract fake آداپتر خارجی در [ADR-003](../../architecture/decisions/003-engineering-baseline.md)
و [راهنمای توسعه](../../delivery/development-baseline.md) ثبت شده‌اند.
