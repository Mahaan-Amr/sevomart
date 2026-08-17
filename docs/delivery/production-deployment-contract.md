# قرارداد تحویل production

این سند قرارداد provider-neutral تحویل سوو است؛ adapter اجرایی پس از انتخاب host، registry و secret
manager افزوده می‌شود.

## ورودی و artifact

- فقط commit تأییدشدهٔ `main` یا release وارد خط تحویل می‌شود.
- همان Dockerfileهای محلی با lockfile frozen ساخته می‌شوند.
- imageها با SHA کامل commit و یک release tag خوانا برچسب می‌خورند؛ `latest` مرجع استقرار نیست.
- imageها پیش از push تست، audit و scan می‌شوند و credential به build argument یا layer نمی‌رود.

## هویت و secret

- CI در صورت پشتیبانی provider از OIDC کوتاه‌عمر استفاده می‌کند.
- secretهای ازپیش‌تأمین‌شده فقط هنگام deploy تزریق می‌شوند.
- `SEVO_RUNTIME_ENV=production` مقدار محلی شناخته‌شده، OTP توسعه، secret خالی و object storage
  ناپایدار را رد می‌کند.
- object storage تولید باید endpoint خارجی، TLS، bucket غیراستاندارد محلی و credential صریح داشته باشد.
- log، health و error هیچ credential یا connection string را نمایش نمی‌دهند.

## ترتیب استقرار و بازیابی

1. artifact تغییرناپذیر انتخاب می‌شود.
2. migration یک‌باره و forward-only اجرا می‌شود؛ شکست آن rollout برنامه را متوقف می‌کند.
3. API و worker و سپس web با readiness واقعی rollout می‌شوند.
4. smoke test مسیر سلامت و interfaceهای اصلی اجرا می‌شود.
5. rollback برنامه به image قبلی مجاز است؛ migration مخرب خودکار rollback نمی‌شود و schema با
   forward-fix سازگار اصلاح می‌شود.

Docker Secrets یا Kubernetes Secrets تا انتخاب هدف استقرار تصمیم‌گیری نمی‌شوند؛ Compose محلی ادعای
حل secret management تولید را ندارد.
