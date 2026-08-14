from pathlib import Path
from math import ceil

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "persian-social-commerce-project-brief.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

W, H = A4
M = 42

FONT_REG = "Tahoma"
FONT_BOLD = "TahomaBold"
pdfmetrics.registerFont(TTFont(FONT_REG, r"C:\Windows\Fonts\tahoma.ttf"))
pdfmetrics.registerFont(TTFont(FONT_BOLD, r"C:\Windows\Fonts\tahomabd.ttf"))

INK = HexColor("#17332F")
INK_2 = HexColor("#34534E")
TEAL = HexColor("#0F766E")
TEAL_DARK = HexColor("#0A504B")
MINT = HexColor("#DCEEE9")
CREAM = HexColor("#F8F5EF")
PAPER = HexColor("#FFFDFC")
CORAL = HexColor("#DF765E")
CORAL_LIGHT = HexColor("#F6DED7")
GOLD = HexColor("#D5A832")
GOLD_LIGHT = HexColor("#F5EBCB")
WHITE = HexColor("#FFFFFF")
GRAY = HexColor("#71807D")
LINE = HexColor("#D8E1DE")


def shaped(text: str) -> str:
    return get_display(arabic_reshaper.reshape(str(text)))


def wrap_rtl(text, width, font=FONT_REG, size=10.5):
    paragraphs = str(text).split("\n")
    lines = []
    for para in paragraphs:
        if not para:
            lines.append("")
            continue
        words = para.split()
        current = ""
        for word in words:
            candidate = word if not current else current + " " + word
            if pdfmetrics.stringWidth(shaped(candidate), font, size) <= width:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
    return lines


def rtl_text(c, text, x_right, y, width, size=10.5, leading=None, font=FONT_REG,
             color=INK, max_lines=None):
    leading = leading or size * 1.65
    lines = wrap_rtl(text, width, font, size)
    if max_lines is not None:
        lines = lines[:max_lines]
    c.setFont(font, size)
    c.setFillColor(color)
    for line in lines:
        if line:
            c.drawRightString(x_right, y, shaped(line))
        y -= leading
    return y


def page_base(c, number, section, dark=False):
    c.setFillColor(INK if dark else CREAM)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    if not dark:
        c.setFillColor(TEAL)
        c.roundRect(W - M - 31, H - 54, 31, 8, 4, fill=1, stroke=0)
        c.setFont(FONT_BOLD, 8)
        c.setFillColor(GRAY)
        c.drawRightString(W - M - 42, H - 55, shaped(section))
        c.setStrokeColor(LINE)
        c.line(M, 34, W - M, 34)
        c.setFont(FONT_REG, 7.5)
        c.setFillColor(GRAY)
        c.drawString(M, 20, "PERSIAN SOCIAL COMMERCE - CONCEPT BRIEF")
        c.drawRightString(W - M, 20, shaped(f"صفحه {number}"))


def section_title(c, title, subtitle=None, y=H - 88):
    y = rtl_text(c, title, W - M, y, W - 2*M, size=22, leading=30,
                 font=FONT_BOLD, color=INK)
    if subtitle:
        y -= 2
        y = rtl_text(c, subtitle, W - M, y, W - 2*M, size=9.5, leading=15,
                     color=GRAY)
    return y - 12


def card(c, x, y_top, w, h, title, body, accent=TEAL, fill=PAPER, title_size=12,
         body_size=9.2):
    c.setFillColor(fill)
    c.setStrokeColor(LINE)
    c.roundRect(x, y_top - h, w, h, 12, fill=1, stroke=1)
    c.setFillColor(accent)
    c.roundRect(x + w - 8, y_top - h + 10, 4, h - 20, 2, fill=1, stroke=0)
    tx = x + w - 18
    y = y_top - 22
    y = rtl_text(c, title, tx, y, w - 34, size=title_size, leading=17,
                 font=FONT_BOLD, color=INK)
    y -= 4
    rtl_text(c, body, tx, y, w - 34, size=body_size, leading=14.5, color=INK_2)


def bullet_list(c, items, x_right, y, width, size=9.5, leading=16, dot_color=TEAL):
    for item in items:
        lines = wrap_rtl(item, width - 18, FONT_REG, size)
        c.setFillColor(dot_color)
        c.circle(x_right - 3, y + 2, 2.6, fill=1, stroke=0)
        c.setFont(FONT_REG, size)
        c.setFillColor(INK_2)
        for i, line in enumerate(lines):
            c.drawRightString(x_right - 14, y, shaped(line))
            y -= leading
        y -= 3
    return y


def pill(c, x, y, w, text, fill=MINT, color=TEAL_DARK):
    c.setFillColor(fill)
    c.roundRect(x, y, w, 26, 13, fill=1, stroke=0)
    c.setFillColor(color)
    c.setFont(FONT_BOLD, 8.8)
    c.drawCentredString(x + w/2, y + 8, shaped(text))


def metric(c, x, y_top, w, number, label, accent=TEAL):
    c.setFillColor(PAPER)
    c.setStrokeColor(LINE)
    c.roundRect(x, y_top - 70, w, 70, 10, fill=1, stroke=1)
    c.setFillColor(accent)
    number_size = 13 if len(number) > 6 else 19
    c.setFont(FONT_BOLD, number_size)
    c.drawCentredString(x + w/2, y_top - 28, shaped(number))
    c.setFillColor(INK_2)
    c.setFont(FONT_REG, 8.5)
    c.drawCentredString(x + w/2, y_top - 51, shaped(label))


def cover(c):
    page_base(c, 1, "", dark=True)
    c.setFillColor(Color(0.06, 0.46, 0.43, alpha=0.28))
    c.circle(W - 45, H - 90, 150, fill=1, stroke=0)
    c.setFillColor(Color(0.87, 0.46, 0.37, alpha=0.20))
    c.circle(60, 90, 135, fill=1, stroke=0)

    pill(c, W - M - 150, H - 92, 150, "معرفی ایده و محصول", fill=TEAL, color=WHITE)
    y = H - 175
    y = rtl_text(c, "شبکه فروشگاهی اجتماعی فارسی", W - M, y, W - 2*M,
                 size=30, leading=41, font=FONT_BOLD, color=WHITE)
    y -= 10
    y = rtl_text(c, "فروشگاه مستقل، کشف اجتماعی و خرید قابل پیگیری برای فروشندگان اینستاگرامی ایران",
                 W - M, y, W - 2*M, size=14, leading=24, color=MINT)

    y -= 45
    cards = [
        ("فروشگاه", "هویت مستقل و قابل شخصی سازی"),
        ("کشف", "دنبال شده ها و پیشنهادهای هوشمند"),
        ("اعتماد", "پرداخت شفاف و مسیر حل اختلاف"),
    ]
    cw = (W - 2*M - 20) / 3
    for i, (title, body) in enumerate(cards):
        x = M + i * (cw + 10)
        c.setFillColor(Color(1, 1, 1, alpha=0.08))
        c.setStrokeColor(Color(1, 1, 1, alpha=0.18))
        c.roundRect(x, y - 104, cw, 104, 12, fill=1, stroke=1)
        c.setFillColor(GOLD if i == 1 else CORAL if i == 2 else MINT)
        c.circle(x + cw - 23, y - 24, 6, fill=1, stroke=0)
        rtl_text(c, title, x + cw - 18, y - 50, cw - 36, size=12,
                 font=FONT_BOLD, color=WHITE)
        rtl_text(c, body, x + cw - 18, y - 76, cw - 36, size=8.5,
                 leading=14, color=HexColor("#DCE7E4"))

    c.setFont(FONT_REG, 8.5)
    c.setFillColor(HexColor("#B8CAC6"))
    c.drawRightString(W - M, 42, shaped("نسخه معرفی اولیه - مرداد ۱۴۰۵"))
    c.drawString(M, 42, "DISCOVERY BRIEF / V1")
    c.showPage()


def page_idea(c):
    page_base(c, 2, "ایده در یک نگاه")
    y = section_title(c, "ایده دقیقاً چیست؟", "یک پل میان مخاطب اینستاگرام، فروشگاه مستقل و بازار کشف اجتماعی")
    gap = 14
    cw = (W - 2*M - gap) / 2
    card(c, M, y, cw, 190, "مسئله امروز",
         "فروشندگان فعال اینستاگرامی سفارش، موجودی، پرداخت، ارسال و پیام ها را پراکنده و دستی مدیریت می کنند. خریدار نیز برای اعتماد، پرداخت و پیگیری مشکل مسیر یکپارچه ای ندارد.",
         accent=CORAL, fill=CORAL_LIGHT)
    card(c, M + cw + gap, y, cw, 190, "پاسخ محصول",
         "هر فروشنده یک فروشگاه فارسی با لینک اختصاصی می سازد. خریدار از بیو وارد می شود، کالا می بیند، گفت وگو می کند، داخل پلتفرم می خرد و سفارش یا اختلاف را پیگیری می کند.",
         accent=TEAL, fill=MINT)

    y2 = y - 220
    c.setFillColor(INK)
    c.roundRect(M, y2 - 105, W - 2*M, 105, 14, fill=1, stroke=0)
    rtl_text(c, "وعده اصلی", W - M - 20, y2 - 28, W - 2*M - 40,
             size=10, font=FONT_BOLD, color=GOLD)
    rtl_text(c, "فروشنده کسب وکارش را ساده تر اداره می کند؛ خریدار با اعتماد بیشتری کشف، خرید و پیگیری می کند.",
             W - M - 20, y2 - 57, W - 2*M - 40, size=13, leading=22,
             font=FONT_BOLD, color=WHITE)

    y3 = y2 - 140
    rtl_text(c, "مخاطب آغازین", W - M, y3, W - 2*M, size=14,
             font=FONT_BOLD, color=INK)
    bullet_list(c, [
        "فروشگاه اینستاگرامی کوچک تا متوسط که همین حالا فروش واقعی دارد.",
        "فروشنده ای که سفارش، پیام و موجودی را عمدتاً دستی مدیریت می کند.",
        "خریدار ایرانی که از لینک بیو وارد می شود و به اعتماد و پیگیری نیاز دارد.",
    ], W - M, y3 - 30, W - 2*M)
    c.showPage()


def page_buyer(c):
    page_base(c, 3, "تجربه خریدار")
    y = section_title(c, "سفر خریدار: از بیو تا پیگیری", "بدون ثبت نام اجباری در ابتدای مسیر")
    steps = [
        ("۱", "ورود", "کلیک روی لینک بیوی فروشنده و ورود مستقیم به فروشگاه او"),
        ("۲", "دیدن", "مشاهده کالا، محتوای فروش، قیمت، موجودی و تجربه های خرید"),
        ("۳", "کشف", "گردش میان دنبال شده ها و پیشنهادهای مرتبط از فروشگاه های دیگر"),
        ("۴", "گفت وگو", "پرسش خصوصی درون پلتفرم، متصل به کالا یا سفارش"),
        ("۵", "خرید", "سبد همان فروشگاه، نشانی، روش ارسال و پرداخت شفاف"),
        ("۶", "پیگیری", "وضعیت ارسال، کد رهگیری و در صورت نیاز پرونده اختلاف"),
    ]
    gap = 12
    cw = (W - 2*M - gap) / 2
    ch = 117
    for i, (num, title, body) in enumerate(steps):
        col = 1 - (i % 2)
        row = i // 2
        x = M + col * (cw + gap)
        yt = y - row * (ch + 12)
        card(c, x, yt, cw, ch, f"{num}  {title}", body,
             accent=TEAL if i < 4 else CORAL, body_size=8.7)

    y2 = y - 3*(ch + 12) - 10
    c.setFillColor(GOLD_LIGHT)
    c.roundRect(M, y2 - 82, W - 2*M, 82, 12, fill=1, stroke=0)
    rtl_text(c, "ورود تدریجی", W - M - 18, y2 - 24, W - 2*M - 36,
             size=11, font=FONT_BOLD, color=INK)
    rtl_text(c, "دیدن فروشگاه، فید و سبد بدون حساب ممکن است. ورود فقط برای دنبال کردن، گفت وگو، سفارش یا ثبت تجربه خرید لازم است. ورود گوگل اختیاری است و شماره موبایل پیش از اقدام حساس تایید می شود.",
             W - M - 18, y2 - 48, W - 2*M - 36, size=8.4, leading=13.5, color=INK_2)
    c.showPage()


def page_seller(c):
    page_base(c, 4, "فضای کار فروشنده")
    y = section_title(c, "فروشگاه و فضای کار، در یک جا", "ابزارهای ضروری امروز، قابلیت های پیشرفته در آینده")
    cards = [
        ("کالا و موجودی", "قالب وابسته به دسته، رنگ و اندازه، قیمت و موجودی مستقل، هشدار کاهش موجودی"),
        ("سفارش و ارسال", "وضعیت سفارش، روش ارسال، هزینه، بسته بندی، کد رهگیری و مرجوعی"),
        ("خریدار و گفت وگو", "سابقه خرید، پیام مرتبط با کالا یا سفارش و یادداشت های کاربردی"),
        ("رشد و گزارش", "فروش، کالای پرفروش، سبد رهاشده، نرخ تبدیل و رشد دنبال کنندگان"),
    ]
    gap = 12
    cw = (W - 2*M - gap) / 2
    for i, data in enumerate(cards):
        x = M + (i % 2) * (cw + gap)
        yt = y - (i // 2) * 145
        card(c, x, yt, cw, 132, data[0], data[1], accent=TEAL if i % 2 == 0 else GOLD)

    y2 = y - 310
    rtl_text(c, "ساخت کالای انسانی و هوشمند", W - M, y2, W - 2*M,
             size=14, font=FONT_BOLD)
    y2 -= 30
    bullet_list(c, [
        "اطلاعات پایه مشترک: نام، تصویر، قیمت، موجودی و ارسال.",
        "ویژگی های متناسب با دسته: مانند سایز و جنس پوشاک یا حجم و نوع پوست در آرایشی.",
        "گونه قابل فروش: هر ترکیب رنگ و اندازه، قیمت و موجودی مستقل دارد.",
        "ویژگی اختصاصی محدود: آزادی کافی بدون نابود کردن جست وجو و فیلتر.",
    ], W - M, y2, W - 2*M, size=9.1, leading=15)

    c.setFillColor(CORAL_LIGHT)
    c.roundRect(M, 70, W - 2*M, 62, 11, fill=1, stroke=0)
    rtl_text(c, "اصل رابط: هر صفحه یک کار اصلی دارد و فقط ابزارهای مرتبط با همان کار را نشان می دهد.",
             W - M - 16, 106, W - 2*M - 32, size=10, font=FONT_BOLD, color=INK)
    c.showPage()


def page_social(c):
    page_base(c, 5, "کشف اجتماعی")
    y = section_title(c, "حس گردش اجتماعی، با محور خرید", "تجربه شبیه اینستاگرام است؛ هدف، کپی کردن اینستاگرام نیست")
    gap = 14
    cw = (W - 2*M - gap) / 2
    card(c, M, y, cw, 180, "دنبال شده ها",
         "تازه ترین محتوای فروش و کالاهای فروشگاه هایی که خریدار دنبال کرده است؛ با ترتیب عمدتاً زمانی و قابل پیش بینی.",
         accent=TEAL, fill=MINT)
    card(c, M + cw + gap, y, cw, 180, "کشف",
         "پیشنهادهای شخصی بر پایه مشاهده، ذخیره، دنبال کردن و خرید؛ همراه با کالاهای تازه، فروشگاه های رو به رشد و تنوع کافی.",
         accent=CORAL, fill=CORAL_LIGHT)

    y2 = y - 215
    rtl_text(c, "چه کسی محتوا می سازد؟", W - M, y2, W - 2*M,
             size=14, font=FONT_BOLD)
    y2 -= 29
    bullet_list(c, [
        "فروشنده تصویر یا ویدیو منتشر می کند و آن را به یک یا چند کالا متصل می کند.",
        "خریدار محتوای عمومی ندارد؛ فقط پس از خرید تاییدشده تجربه خرید همان کالا را ثبت می کند.",
        "آمار عمومی فروشگاه: دنبال کنندگان، کالاهای فعال، خریدهای تاییدشده و امتیاز معتبر.",
        "بازدید، ذخیره، تبدیل و فروش آمار خصوصی فروشنده هستند؛ تعداد پسند کالا عمومی نیست.",
    ], W - M, y2, W - 2*M, size=9.1, leading=15)

    c.setFillColor(INK)
    c.roundRect(M, 74, W - 2*M, 85, 12, fill=1, stroke=0)
    rtl_text(c, "شروع سریع", W - M - 18, 132, W - 2*M - 36,
             size=10.5, font=FONT_BOLD, color=GOLD)
    rtl_text(c, "انتخاب علایق اختیاری، تصویری و کمتر از یک دقیقه است. تبلیغات نیز همیشه از پیشنهاد طبیعی جدا و با برچسب روشن نمایش داده می شوند.",
             W - M - 18, 106, W - 2*M - 36, size=8.8, leading=14, color=WHITE)
    c.showPage()


def page_trust(c):
    page_base(c, 6, "اعتماد و پرداخت")
    y = section_title(c, "اعتماد، دلیل اصلی وجود پلتفرم", "روش پرداخت، مسئولیت ها و مسیر مشکل باید پیش از خرید روشن باشند")
    gap = 14
    cw = (W - 2*M - gap) / 2
    card(c, M, y, cw, 220, "تسویه مستقیم",
         "روش پیش فرض. مبلغ بدون نگهداری توسط پلتفرم برای فروشنده تسویه می شود. سیاست مرجوعی فروشنده نمایش داده می شود؛ پلتفرم شکایت را ثبت و تخلف را پیگیری می کند، اما بازپرداخت را تضمین نمی کند.",
         accent=GOLD, fill=GOLD_LIGHT, body_size=8.7)
    card(c, M + cw + gap, y, cw, 220, "پرداخت محافظت شده",
         "فقط برای فروشنده احرازشده و تاییدشده. هنگام اختلاف، مبلغ آزاد نمی شود؛ دو طرف مدرک می فرستند و پلتفرم طبق قواعد یکسان درباره آزادسازی یا بازپرداخت تصمیم می گیرد.",
         accent=TEAL, fill=MINT, body_size=8.7)

    y2 = y - 250
    rtl_text(c, "مسیر اختلاف", W - M, y2, W - 2*M, size=14, font=FONT_BOLD)
    labels = ["ثبت مشکل", "جمع آوری مدرک", "پاسخ دو طرف", "تصمیم و پیگیری"]
    total_w = W - 2*M
    bw = (total_w - 30) / 4
    for i, label in enumerate(labels):
        x = M + (3 - i) * (bw + 10)
        c.setFillColor(PAPER)
        c.setStrokeColor(LINE)
        c.roundRect(x, y2 - 83, bw, 58, 10, fill=1, stroke=1)
        c.setFillColor(TEAL if i < 3 else CORAL)
        c.circle(x + bw/2, y2 - 41, 12, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont(FONT_BOLD, 8)
        c.drawCentredString(x + bw/2, y2 - 44, str(i + 1))
        c.setFillColor(INK_2)
        c.setFont(FONT_REG, 7.6)
        c.drawCentredString(x + bw/2, y2 - 72, shaped(label))

    c.setFillColor(CORAL_LIGHT)
    c.roundRect(M, 80, W - 2*M, 100, 12, fill=1, stroke=0)
    rtl_text(c, "محدودیت قطعی", W - M - 18, 153, W - 2*M - 36,
             size=10.5, font=FONT_BOLD, color=CORAL)
    rtl_text(c, "پرداخت محافظت شده تا دریافت تایید کتبی از وکیل متخصص و ارائه دهنده مجاز پرداخت، قابلیت قطعی نسخه اول نیست و نباید با واژه هایی مانند ضمانت قطعی معرفی شود.",
             W - M - 18, 126, W - 2*M - 36, size=8.8, leading=14, color=INK)
    c.showPage()


def page_business(c):
    page_base(c, 7, "مدل درآمد")
    y = section_title(c, "رایگان برای فروش واقعی؛ حرفه ای برای رشد", "بدون کمیسیون فروش در فرضیه آغازین")
    gap = 14
    cw = (W - 2*M - gap) / 2
    card(c, M, y, cw, 290, "طرح رایگان",
         "فروشگاه روی دامنه پلتفرم، حدود ۳۰ کالای فعال، یک مدیر، گونه کالا، موجودی پایه، سفارش، پرداخت، ارسال، گفت وگو، محتوای فروش، حضور در فید، تجربه خرید، شخصی سازی پایه و گزارش ساده.",
         accent=TEAL, fill=MINT, body_size=8.8)
    card(c, M + cw + gap, y, cw, 290, "طرح حرفه ای",
         "ظرفیت بیشتر کالا و محتوا، دامنه اختصاصی، شخصی سازی گسترده اما کنترل شده، ویرایش گروهی، هشدار موجودی، چند همکار، برچسب خریدار، تخفیف، گزارش کامل تر و خروجی داده.",
         accent=CORAL, fill=CORAL_LIGHT, body_size=8.8)

    y2 = y - 320
    rtl_text(c, "دو قاعده غیرقابل مذاکره", W - M, y2, W - 2*M,
             size=14, font=FONT_BOLD)
    y2 -= 30
    bullet_list(c, [
        "نشان پلتفرم در همه فروشگاه ها باقی می ماند و حذف آن مزیت پولی نیست.",
        "کیفیت و سرعت پشتیبانی به مبلغ اشتراک وابسته نیست.",
        "حضور طبیعی در فید پولی نیست؛ تبلیغ پولی جدا و شفاف است.",
    ], W - M, y2, W - 2*M, size=9.3, leading=15.5)

    c.setFillColor(GOLD_LIGHT)
    c.roundRect(M, 76, W - 2*M, 70, 11, fill=1, stroke=0)
    rtl_text(c, "قیمت و سقف دقیق طرح ها هنوز تصمیم نهایی نیست و باید با مصاحبه و آزمون تمایل به پرداخت تعیین شود.",
             W - M - 16, 117, W - 2*M - 32, size=9.2, font=FONT_BOLD, color=INK)
    c.showPage()


def page_pilot(c):
    page_base(c, 8, "بازار و آزمایش")
    y = section_title(c, "شروع کوچک، اما زنده", "آزمایش دعوتی پیش از عرضه عمومی")
    metrics = [
        ("۲۰ تا ۳۰", "فروشنده منتخب"),
        ("۸ هفته", "دوره آزمایش"),
        ("زیر ۱ ساعت", "ساخت فروشگاه و ۱۰ کالا"),
        ("۷۰٪", "ماندگاری هدف فروشنده"),
    ]
    gap = 10
    mw = (W - 2*M - 3*gap) / 4
    for i, data in enumerate(metrics):
        metric(c, M + (3 - i)*(mw + gap), y, mw, data[0], data[1], accent=TEAL if i < 2 else CORAL)

    y2 = y - 105
    rtl_text(c, "نامزدهای خوشه آغازین", W - M, y2, W - 2*M, size=14, font=FONT_BOLD)
    y2 -= 28
    bullet_list(c, [
        "پوشاک: بسیار تصویری و مناسب محتوا؛ اما دارای پیچیدگی سایز، گونه و مرجوعی.",
        "اکسسوری غیرگران بها: نمایش ساده تر و مناسب کشف؛ طلا و نقره باید جدا بررسی شوند.",
        "آرایشی و بهداشتی مجاز: خرید تکراری جذاب؛ همراه با ریسک اصالت، انقضا و الزامات سلامت.",
    ], W - M, y2, W - 2*M, size=8.9, leading=14.5)

    y3 = y2 - 150
    rtl_text(c, "معیارهای واقعی موفقیت", W - M, y3, W - 2*M, size=14, font=FONT_BOLD)
    y3 -= 29
    bullet_list(c, [
        "حداقل ۶۰٪ فروشندگان فعال یک سفارش واقعی بگیرند و ۹۰٪ سفارش ها سالم تکمیل شوند.",
        "بیشتر اختلاف ها ظرف ۷۲ ساعت تعیین تکلیف شوند.",
        "خریدار بدون لینک اینستاگرام برای کشف یا خرید دوباره برگردد.",
        "حداقل ۴۰٪ فروشندگان برای طرح حرفه ای تمایل واقعی به پرداخت نشان دهند.",
    ], W - M, y3, W - 2*M, size=8.9, leading=14.5)

    c.setFillColor(INK)
    c.roundRect(M, 65, W - 2*M, 67, 11, fill=1, stroke=0)
    rtl_text(c, "یافته بازار: داده عمومی برای انتخاب قطعی خوشه کافی نیست؛ مصاحبه مقایسه ای با ۲۰ فروشنده، قدم بعدی است.",
             W - M - 16, 105, W - 2*M - 32, size=9.2, font=FONT_BOLD, color=WHITE)
    c.showPage()


def page_principles(c):
    page_base(c, 9, "شکل و منطق محصول")
    y = section_title(c, "مینیمالیسم، روش فکر کردن محصول است", "سادگی در تصمیم، مرحله و معنا؛ نه فقط فضای سفید")
    principles = [
        ("زبان انسانی", "فارسی، گرم، روشن و بدون اصطلاح فنی یا اداری تحمیل شده به کاربر."),
        ("یک کار اصلی", "هر صفحه یک مسئولیت روشن دارد و فقط کارهای فرعی مرتبط را نشان می دهد."),
        ("آشکارسازی تدریجی", "قابلیت پیشرفته زمانی دیده می شود که کاربر واقعاً به آن نیاز دارد."),
        ("هویت منعطف", "لوگو، رنگ، قلم، جلد و ترتیب بخش های محتوایی قابل شخصی سازی اند."),
        ("خرید ثابت", "قیمت، موجودی، سبد، پرداخت، مرجوعی و اختلاف در همه فروشگاه ها الگوی آشنا دارند."),
        ("اعتماد واقعی", "هیچ متن یا نشانی نباید سطح حفاظت را بیشتر از واقعیت نشان دهد."),
    ]
    gap = 10
    cw = (W - 2*M - gap) / 2
    ch = 105
    for i, data in enumerate(principles):
        x = M + (i % 2)*(cw + gap)
        yt = y - (i//2)*(ch + 10)
        card(c, x, yt, cw, ch, data[0], data[1], accent=TEAL if i % 3 else GOLD,
             title_size=10.5, body_size=8.3)

    y2 = y - 3*(ch + 10) - 2
    rtl_text(c, "مسیر توسعه", W - M, y2, W - 2*M, size=14, font=FONT_BOLD)
    y2 -= 30
    roadmap = [
        ("اکنون", "کالای فیزیکی، عملیات ضروری، گزارش پایه و آزمایش دعوتی"),
        ("بعد", "CRM، کمپین، وفادارسازی، BI و پیشنهادهای رشد"),
        ("آینده", "خدمات و رزرو، محصولات دیجیتال و اتصال های عمیق تر"),
    ]
    rw = (W - 2*M - 20)/3
    for i, (phase, body) in enumerate(roadmap):
        x = M + (2 - i)*(rw + 10)
        card(c, x, y2, rw, 100, phase, body, accent=[TEAL, GOLD, CORAL][i], body_size=7.7, title_size=10)
    c.showPage()


def page_names(c):
    page_base(c, 10, "نام های پیشنهادی")
    y = section_title(c, "۲۰ نام برای شروع گفت وگوی برند", "پیش از انتخاب نهایی، دامنه، شبکه های اجتماعی و علامت تجاری باید بررسی شوند")
    names = [
        ("۱. راسته", "بازار، مسیر و شبکه فروشگاه ها"),
        ("۲. هم راسته", "فروشگاه های مستقل در یک مسیر مشترک"),
        ("۳. چارسوق", "نقطه اتصال و گردش در بازار ایرانی"),
        ("۴. تیمچه", "بازار کوچک، صمیمی و ریشه دار"),
        ("۵. سراچه", "خانه ای برای فروشگاه های مستقل"),
        ("۶. بازارک", "بازار ساده و در دسترس"),
        ("۷. ویترینو", "ویترین فارسی با حس امروزی"),
        ("۸. هم ویترین", "کشف چند فروشگاه کنار یکدیگر"),
        ("۹. چیدا", "چیدن فروشگاه و کشف انتخاب های تازه"),
        ("۱۰. گشتا", "گردش و کشف اجتماعی کالا"),
        ("۱۱. پیدانه", "جایی برای پیدا کردن فروشگاه و کالا"),
        ("۱۲. پسندار", "کشف بر اساس سلیقه و پسند"),
        ("۱۳. خریدانه", "جای خرید با لحن فارسی"),
        ("۱۴. فروشانه", "خانه ابزار و فروش فروشنده"),
        ("۱۵. دکانو", "فروشگاه مستقل با لحن دوستانه"),
        ("۱۶. رونق", "وعده رشد برای کسب وکار"),
        ("۱۷. همرونق", "رشد فروشنده و شبکه با هم"),
        ("۱۸. تازه چین", "انتخاب و کشف تازه ها"),
        ("۱۹. بازارین", "بازار مدرن و برندپذیر"),
        ("۲۰. هم پسند", "فروشگاه ها و آدم های هم سلیقه"),
    ]
    gap = 16
    cw = (W - 2*M - gap)/2
    row_h = 49
    for i, (name, desc) in enumerate(names):
        col = 1 if i < 10 else 0
        row = i if i < 10 else i - 10
        x = M + col*(cw + gap)
        yt = y - row*row_h
        c.setFillColor(PAPER)
        c.setStrokeColor(LINE)
        c.roundRect(x, yt - 42, cw, 39, 8, fill=1, stroke=1)
        rtl_text(c, name, x + cw - 10, yt - 17, cw - 20, size=9.2,
                 font=FONT_BOLD, color=TEAL_DARK)
        rtl_text(c, desc, x + cw - 10, yt - 32, cw - 20, size=6.8,
                 leading=10, color=GRAY, max_lines=1)

    c.setFillColor(INK)
    c.roundRect(M, 62, W - 2*M, 62, 11, fill=1, stroke=0)
    rtl_text(c, "پیشنهاد اولیه برای بررسی عمیق تر: راسته، هم راسته، چیدا، گشتا و سراچه",
             W - M - 16, 100, W - 2*M - 32, size=10, font=FONT_BOLD, color=WHITE)
    c.showPage()


def build():
    c = canvas.Canvas(str(OUT), pagesize=A4, pageCompression=1)
    c.setTitle("شبکه فروشگاهی اجتماعی فارسی - معرفی ایده و محصول")
    c.setAuthor("Project Discovery Team")
    cover(c)
    page_idea(c)
    page_buyer(c)
    page_seller(c)
    page_social(c)
    page_trust(c)
    page_business(c)
    page_pilot(c)
    page_principles(c)
    page_names(c)
    c.save()
    print(OUT)


if __name__ == "__main__":
    build()
