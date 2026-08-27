# معماری

پشته فنی و مرز ماژول‌های نسخه اول پذیرفته شده‌اند. تصمیم‌ها به‌صورت ADR در `decisions/` ثبت می‌شوند و به Issue تصمیم مربوط لینک دارند.

- [ADR-001: پشته فنی و شکل استقرار نسخه اول](decisions/001-v1-technical-stack-and-deployment.md)
- [ADR-002: مرز ماژول‌ها و قراردادهای کار موازی](decisions/002-module-boundaries-and-parallel-contracts.md)
- [ADR-003: خط پایه توسعه، تست و CI](decisions/003-engineering-baseline.md)

ترتیب مورد انتظار:

1. انتخاب پشته و شکل استقرار — انجام‌شده؛
2. تعیین مرز ماژول‌ها و مالکیت قراردادها — انجام‌شده؛
3. آماده‌سازی خط پایه توسعه، تست و CI — انجام‌شده؛
4. مدل داده و state machineهای حساس هر قابلیت پس از بسته‌شدن مشخصات همان قابلیت؛
5. سپس پیاده‌سازی مسیرها روی قراردادهای مصوب.

وضعیت اجرایی و مهاجرت مصرف‌کنندگان هر subpath نسخه‌دار در
`contract-lifecycle.json` ثبت می‌شود. وجود entrypoint به‌تنهایی به معنی قرارداد
قابل اجرا نیست؛ evidence همان فایل باید به schema، operation یا event واقعی اشاره کند.

توپولوژی نسخه اول modular monolith باقی می‌ماند. مرزهای service-grade مجوز ساخت microservice، database یا deployment مستقل بدون شواهد بازنگری ADR-002 نیستند.
