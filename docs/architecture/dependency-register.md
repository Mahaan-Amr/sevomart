# دفتر وابستگی‌های خط پایه

این ثبت در تاریخ ۱۴۰۵-۰۵-۲۴ برای Issue
[آماده‌سازی خط پایه توسعه، تست و CI](https://github.com/Mahaan-Amr/sevomart/issues/18)
انجام شده است. همهٔ نسخه‌ها دقیق و lockfile تحت کنترل supply-chain policy است؛
`pnpm audit --prod` در خط تحویل اجرا می‌شود و advisory با شدت بالا پیش از ادغام رفع می‌شود.

| گروه | دلیل ورود | نگهداری و مجوز | اثر امنیتی و کنترل |
|---|---|---|---|
| Next.js، React و typeهای React | PWA واکنش‌گرا طبق ADR-001 | پروژه‌های فعال؛ MIT | سطح HTTP مرورگر؛ نسخه دقیق، CSP و patch هفتگی در ادامه |
| NestJS، Fastify، Swagger، RxJS و reflect-metadata | API modular monolith و OpenAPI طبق ADR-001 | پروژه‌های فعال؛ MIT یا Apache-2.0 | ورودی شبکه؛ validation، نسخه دقیق و audit الزامی |
| Zod | قرارداد runtime مشترک و محیط type-safe | فعال؛ MIT | پردازش دادهٔ ورودی؛ schemaهای محدود و نسخه دقیق |
| Prisma | schema و migration قابل‌مرور PostgreSQL | فعال؛ Apache-2.0 | دسترسی داده و code generation؛ SQL review، مالکیت جدول/migration و نسخه دقیق |
| OpenTelemetry Node | trace قابل‌انتقال بدون قفل‌شدن به provider | فعال؛ Apache-2.0 | exporter فقط با endpoint صریح فعال و payload حساس ممنوع |
| TypeScript، ESLint، Prettier و type packages | strict typecheck و کنترل قالب/قواعد CI | فعال؛ MIT یا Apache-2.0 | فقط build-time؛ lockfile و اجرای CI روی PR |
| Vitest، Playwright و Postgres.js | unit/contract، E2E و integration واقعی PostgreSQL | فعال؛ MIT، Apache-2.0 و Unlicense | فقط test-time؛ credential محلی غیرحساس و مرورگر ایزوله CI |
| tsx | اجرای watch در توسعه | فعال؛ MIT | فقط development؛ در image تولید نصب نمی‌شود |
| `js-yaml` override | بستن advisory زنجیره Swagger | فعال؛ MIT | نسخه patch‌شده `5.2.2` در کل workspace تحمیل شده است |

وابستگی‌های `@sevo/*` داخلی و private هستند و مجوز خارجی ندارند. افزودن گروه یا package
جدید باید دلیل، وضعیت نگهداری، مجوز، سطح حمله و کنترل آن را پیش از merge به همین سند بیفزاید.
