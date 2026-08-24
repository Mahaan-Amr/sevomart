"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  PrototypeSwitcher,
  type PrototypeVariant,
  usePrototypeVariant,
} from "./prototype-switcher";
import styles from "./prototype.module.css";

type Feed = "discover" | "following";
type LoginIntent = "follow" | "message";
type Tone = "plum" | "sand" | "olive" | "blue";

type Product = {
  id: string;
  name: string;
  store: string;
  storeInitial: string;
  price: string;
  note: string;
  tone: Tone;
  unavailable?: boolean;
};

const products: [Product, Product, Product] = [
  {
    id: "linen-coat",
    name: "کت کتان آزاد",
    store: "نَخ و نقش",
    storeInitial: "ن",
    price: "۲٬۳۹۰٬۰۰۰ تومان",
    note: "دو رنگ، سه اندازه",
    tone: "sand",
  },
  {
    id: "ceramic-cup",
    name: "فنجان دست‌ساز مهتاب",
    store: "سفال نیم‌روز",
    storeInitial: "س",
    price: "۴۸۰٬۰۰۰ تومان",
    note: "ساخت محدود این هفته",
    tone: "blue",
  },
  {
    id: "woven-bag",
    name: "کیف بافت زیتون",
    store: "چامه",
    storeInitial: "چ",
    price: "۱٬۱۸۰٬۰۰۰ تومان",
    note: "فعلاً قابل سفارش نیست",
    tone: "olive",
    unavailable: true,
  },
];

const linenShirt: Product = {
  id: "linen-shirt",
  name: "پیراهن لینن مه",
  store: "نَخ و نقش",
  storeInitial: "ن",
  price: "۱٬۶۹۰٬۰۰۰ تومان",
  note: "دو رنگ، آماده ارسال",
  tone: "plum",
};

const exploreProducts: Product[] = [
  products[0],
  linenShirt,
  products[1],
  products[2],
  {
    id: "aban-candle",
    name: "شمع استوانه‌ای آبان",
    store: "خانه روشن",
    storeInitial: "خ",
    price: "۳۲۰٬۰۰۰ تومان",
    note: "رایحه چوب و وانیل",
    tone: "sand",
  },
  {
    id: "oak-tote",
    name: "کیف روزمره بلوط",
    store: "کارگاه بلوط",
    storeInitial: "ب",
    price: "۹۸۰٬۰۰۰ تومان",
    note: "پارچه ضخیم، بند قابل تنظیم",
    tone: "olive",
  },
  {
    id: "cloud-scarf",
    name: "روسری ابریشم ابر",
    store: "ماه‌ریز",
    storeInitial: "م",
    price: "۱٬۲۴۰٬۰۰۰ تومان",
    note: "چاپ محدود",
    tone: "plum",
  },
  {
    id: "white-vase",
    name: "گلدان سنگی سپید",
    store: "سفال نیم‌روز",
    storeInitial: "س",
    price: "۶۹۰٬۰۰۰ تومان",
    note: "ساخته‌شده با دست",
    tone: "blue",
  },
  {
    id: "wood-tray",
    name: "سینی چوبی گرد",
    store: "چوبین",
    storeInitial: "چ",
    price: "۷۴۰٬۰۰۰ تومان",
    note: "چوب راش، قطر ۳۰ سانتی‌متر",
    tone: "olive",
  },
];

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function ProductVisual({
  product,
  compact = false,
}: {
  product: Product;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        styles.productVisual,
        styles[product.tone],
        compact && styles.compactVisual,
      )}
      role="img"
      aria-label={"تصویر نمونه " + product.name}
    >
      <span aria-hidden="true" />
    </div>
  );
}

function FeedTabs({
  active,
  onChange,
}: {
  active: Feed;
  onChange: (feed: Feed) => void;
}) {
  return (
    <div className={styles.feedTabs} aria-label="انتخاب فید">
      <button
        type="button"
        className={active === "discover" ? styles.activeTab : ""}
        aria-pressed={active === "discover"}
        onClick={() => onChange("discover")}
      >
        کشف
      </button>
      <button
        type="button"
        className={active === "following" ? styles.activeTab : ""}
        aria-pressed={active === "following"}
        onClick={() => onChange("following")}
      >
        دنبال‌شده‌ها
      </button>
    </div>
  );
}

function FollowButton({
  following,
  onClick,
  quiet = false,
}: {
  following: boolean;
  onClick: () => void;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx(
        styles.followButton,
        following && styles.following,
        quiet && styles.quietButton,
      )}
      aria-pressed={following}
      onClick={onClick}
    >
      {following ? "دنبال می‌کنید" : "دنبال کردن"}
    </button>
  );
}

function StoreIdentity({
  product,
  onOpenStore,
}: {
  product: Product;
  onOpenStore?: () => void;
}) {
  const content = (
    <>
      <span aria-hidden="true">{product.storeInitial}</span>
      <div>
        <strong>{product.store}</strong>
        <small>فروشگاه در سوو</small>
      </div>
    </>
  );

  if (onOpenStore) {
    return (
      <button
        type="button"
        className={cx(styles.storeIdentity, styles.clickableStoreIdentity)}
        onClick={onOpenStore}
        aria-label={`رفتن به صفحه فروشگاه ${product.store}`}
      >
        {content}
      </button>
    );
  }

  return <div className={styles.storeIdentity}>{content}</div>;
}

function EmptyFollowing({
  loggedIn,
  onLogin,
  onDiscover,
}: {
  loggedIn: boolean;
  onLogin: () => void;
  onDiscover: () => void;
}) {
  return (
    <section className={styles.emptyFollowing} aria-labelledby="following-empty-title">
      <span aria-hidden="true">✦</span>
      <h2 id="following-empty-title">
        {loggedIn
          ? "هنوز فروشگاهی را دنبال نکرده‌اید"
          : "دنبال‌شده‌ها برای شما خالی است"}
      </h2>
      <p>
        {loggedIn
          ? "از کشف، فروشگاه‌هایی را که می‌خواهید دوباره ببینید دنبال کنید."
          : "برای نگه‌داشتن فروشگاه‌های دلخواه وارد شوید؛ دیدن کالاها بدون ورود ادامه دارد."}
      </p>
      <button type="button" onClick={loggedIn ? onDiscover : onLogin}>
        {loggedIn ? "رفتن به کشف" : "ورود برای دنبال کردن"}
      </button>
    </section>
  );
}

function ProductDetail({
  product,
  selectedColor,
  selectedSize,
  onColor,
  onSize,
  onBack,
}: {
  product: Product;
  selectedColor: string | null;
  selectedSize: string | null;
  onColor: (color: string) => void;
  onSize: (size: string) => void;
  onBack: () => void;
}) {
  const unavailableCombination = selectedColor === "مشکی" && selectedSize === "متوسط";
  const canAdd = Boolean(
    selectedColor && selectedSize && !unavailableCombination && !product.unavailable,
  );

  return (
    <section className={styles.productDetail} aria-labelledby="product-detail-title">
      <button type="button" className={styles.backButton} onClick={onBack}>
        بازگشت به کشف
      </button>
      <div className={styles.detailVisualColumn}>
        <ProductVisual product={product} />
        <div className={styles.thumbnailRow} aria-label="تصاویر کالا">
          <span className={styles.selectedThumbnail} />
          <span />
          <span />
        </div>
      </div>
      <div className={styles.detailCopy}>
        <StoreIdentity product={product} />
        <h1 id="product-detail-title">{product.name}</h1>
        <p className={styles.detailPrice}>{product.price}</p>
        <p className={styles.detailDescription}>
          برش آزاد و سبک برای استفاده روزمره؛ قیمت و موجودی با انتخاب گونه به‌روز
          می‌شود.
        </p>

        <fieldset className={styles.variantGroup} disabled={product.unavailable}>
          <legend>رنگ</legend>
          <div>
            {["کرم", "مشکی"].map((color) => (
              <button
                type="button"
                key={color}
                className={selectedColor === color ? styles.selectedChoice : ""}
                aria-pressed={selectedColor === color}
                onClick={() => onColor(color)}
              >
                {color}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.variantGroup} disabled={product.unavailable}>
          <legend>اندازه</legend>
          <div>
            {["کوچک", "متوسط", "بزرگ"].map((size) => {
              const unavailable = selectedColor === "مشکی" && size === "متوسط";
              return (
                <button
                  type="button"
                  key={size}
                  className={selectedSize === size ? styles.selectedChoice : ""}
                  aria-pressed={selectedSize === size}
                  aria-label={unavailable ? size + "، ناموجود" : size}
                  onClick={() => onSize(size)}
                >
                  {size}
                  {unavailable ? <small>ناموجود</small> : null}
                </button>
              );
            })}
          </div>
        </fieldset>

        {product.unavailable ? (
          <p className={styles.stockMessage} role="status">
            این کالا فعلاً ناموجود و قابل افزودن به سبد نیست.
          </p>
        ) : unavailableCombination ? (
          <p className={styles.stockMessage} role="status">
            رنگ مشکی در اندازه متوسط ناموجود است؛ اندازه دیگری را انتخاب کنید.
          </p>
        ) : selectedColor && selectedSize ? (
          <p className={styles.inStockMessage} role="status">
            این گونه موجود و آماده افزودن به سبد است.
          </p>
        ) : (
          <p className={styles.selectionMessage}>
            برای دیدن موجودی، رنگ و اندازه را انتخاب کنید.
          </p>
        )}

        <button type="button" className={styles.addButton} disabled={!canAdd}>
          {product.unavailable
            ? "فعلاً قابل سفارش نیست"
            : canAdd
              ? "افزودن به سبد · " + product.price
              : "ابتدا گونه را انتخاب کنید"}
        </button>

        <dl className={styles.trustSummary}>
          <div>
            <dt>ارسال</dt>
            <dd>پست پیشتاز، ۲ تا ۴ روز کاری</dd>
          </div>
          <div>
            <dt>مرجوعی</dt>
            <dd>تا ۳ روز پس از تحویل طبق شرایط فروشگاه</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

type VariantProps = {
  feed: Feed;
  loggedIn: boolean;
  following: boolean;
  selectedProduct: Product | null;
  selectedStore: Product | null;
  selectedChat: Product | null;
  selectedColor: string | null;
  selectedSize: string | null;
  setFeed: (feed: Feed) => void;
  openProduct: (product: Product) => void;
  closeProduct: () => void;
  openStore: (product: Product) => void;
  closeStore: () => void;
  requestFollow: () => void;
  requestMessage: (product: Product) => void;
  closeChat: () => void;
  requestLogin: () => void;
  setSelectedColor: (value: string) => void;
  setSelectedSize: (value: string) => void;
};

function DetailOrFollowing({ props }: { props: VariantProps }) {
  if (props.selectedProduct) {
    return (
      <ProductDetail
        product={props.selectedProduct}
        selectedColor={props.selectedColor}
        selectedSize={props.selectedSize}
        onColor={props.setSelectedColor}
        onSize={props.setSelectedSize}
        onBack={props.closeProduct}
      />
    );
  }

  if (props.feed === "following") {
    return (
      <EmptyFollowing
        loggedIn={props.loggedIn}
        onLogin={props.requestLogin}
        onDiscover={() => props.setFeed("discover")}
      />
    );
  }

  return null;
}

function VariantA(props: VariantProps) {
  if (props.selectedProduct || props.feed === "following") {
    return (
      <div className={cx(styles.variant, styles.variantA)}>
        <header className={styles.topbarA}>
          <strong className={styles.wordmark}>سوو</strong>
          <FeedTabs active={props.feed} onChange={props.setFeed} />
          <span />
        </header>
        <DetailOrFollowing props={props} />
      </div>
    );
  }

  const [featured, ...rest] = products;
  return (
    <div className={cx(styles.variant, styles.variantA)}>
      <header className={styles.topbarA}>
        <strong className={styles.wordmark}>سوو</strong>
        <FeedTabs active={props.feed} onChange={props.setFeed} />
        <button type="button" className={styles.iconButton} aria-label="سبد خرید">
          سبد
        </button>
      </header>

      <main className={styles.storyFeed}>
        <section className={styles.feedIntro}>
          <p>تازه و متنوع، بدون رتبه‌بندی محبوبیت</p>
          <h1>برای امروز کشف کنید</h1>
        </section>

        <article className={styles.heroProduct}>
          <button type="button" onClick={() => props.openProduct(featured)}>
            <ProductVisual product={featured} />
          </button>
          <div className={styles.heroCopy}>
            <div className={styles.heroStoreRow}>
              <StoreIdentity product={featured} />
              <FollowButton
                following={props.following}
                onClick={props.requestFollow}
                quiet
              />
            </div>
            <button type="button" onClick={() => props.openProduct(featured)}>
              <h2>{featured.name}</h2>
              <p>{featured.note}</p>
              <strong>{featured.price}</strong>
            </button>
          </div>
        </article>

        <section className={styles.linearProducts} aria-label="کالاهای بعدی">
          {rest.map((product) => (
            <article key={product.id}>
              <button type="button" onClick={() => props.openProduct(product)}>
                <ProductVisual product={product} compact />
                <span>
                  <small>{product.store}</small>
                  <strong>{product.name}</strong>
                  <em>{product.unavailable ? "ناموجود" : product.price}</em>
                </span>
              </button>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}

function VariantB(props: VariantProps) {
  const activeProduct = props.selectedProduct ?? products[0];

  if (props.feed === "following" && !props.selectedProduct) {
    return (
      <div className={cx(styles.variant, styles.variantB)}>
        <header className={styles.topbarB}>
          <strong className={styles.wordmark}>سوو</strong>
          <FeedTabs active={props.feed} onChange={props.setFeed} />
          <span>مهمان</span>
        </header>
        <EmptyFollowing
          loggedIn={props.loggedIn}
          onLogin={props.requestLogin}
          onDiscover={() => props.setFeed("discover")}
        />
      </div>
    );
  }

  return (
    <div className={cx(styles.variant, styles.variantB)}>
      <header className={styles.topbarB}>
        <strong className={styles.wordmark}>سوو</strong>
        <FeedTabs active={props.feed} onChange={props.setFeed} />
        <span>{props.loggedIn ? "خریدار" : "مهمان"}</span>
      </header>

      <main className={styles.focusLayout}>
        <aside className={styles.discoveryRail}>
          <div>
            <small>کشف روشن و ساده</small>
            <h1>کالاهای تازه</h1>
          </div>
          {products.map((product) => (
            <button
              type="button"
              key={product.id}
              className={
                activeProduct.id === product.id ? styles.activeRailProduct : ""
              }
              onClick={() => props.openProduct(product)}
            >
              <ProductVisual product={product} compact />
              <span>
                <strong>{product.name}</strong>
                <small>{product.unavailable ? "ناموجود" : product.store}</small>
              </span>
            </button>
          ))}
        </aside>

        <section className={styles.focusProduct}>
          {activeProduct.id === "linen-coat" ? (
            <ProductDetail
              product={activeProduct}
              selectedColor={props.selectedColor}
              selectedSize={props.selectedSize}
              onColor={props.setSelectedColor}
              onSize={props.setSelectedSize}
              onBack={props.closeProduct}
            />
          ) : (
            <div className={styles.simpleFocus}>
              <ProductVisual product={activeProduct} />
              <StoreIdentity product={activeProduct} />
              <h2>{activeProduct.name}</h2>
              <p>{activeProduct.note}</p>
              <strong>
                {activeProduct.unavailable ? "ناموجود" : activeProduct.price}
              </strong>
              <button type="button" disabled={activeProduct.unavailable}>
                {activeProduct.unavailable ? "فعلاً قابل سفارش نیست" : "دیدن گونه‌ها"}
              </button>
            </div>
          )}
        </section>

        <aside className={styles.storeAside}>
          <StoreIdentity product={activeProduct} />
          <p>کالاهای فیزیکی با روش ارسال و مرجوعی روشن.</p>
          <FollowButton following={props.following} onClick={props.requestFollow} />
        </aside>
      </main>
    </div>
  );
}

function ExplorePostDetail({
  props,
  product,
}: {
  props: VariantProps;
  product: Product;
}) {
  const unavailableCombination =
    props.selectedColor === "مشکی" && props.selectedSize === "متوسط";
  const canAdd = Boolean(
    props.selectedColor &&
    props.selectedSize &&
    !unavailableCombination &&
    !product.unavailable,
  );

  return (
    <article className={styles.explorePost} aria-labelledby="explore-post-title">
      <header className={styles.explorePostHeader}>
        <button
          type="button"
          className={styles.postBackButton}
          onClick={props.closeProduct}
          aria-label="بازگشت به کشف"
        >
          →
        </button>
        <StoreIdentity product={product} onOpenStore={() => props.openStore(product)} />
        <FollowButton following={props.following} onClick={props.requestFollow} quiet />
      </header>

      <div className={styles.explorePostBody}>
        <div className={styles.explorePostMedia}>
          <ProductVisual product={product} />
          <div className={styles.postMediaDots} aria-label="تصویر ۱ از ۳">
            <span className={styles.activeDot} />
            <span />
            <span />
          </div>
        </div>

        <div className={styles.explorePostDescription}>
          <p className={styles.postCaption}>
            <strong>{product.store}</strong>
            {product.name}؛ {product.note}. جزئیات قیمت، موجودی و انتخاب گونه پیش از
            افزودن به سبد روشن است.
          </p>
          <h1 id="explore-post-title">{product.name}</h1>
          <dl className={styles.productFacts}>
            <div>
              <dt>قیمت</dt>
              <dd>{product.price}</dd>
            </div>
            <div>
              <dt>موجودی</dt>
              <dd>{product.unavailable ? "فعلاً ناموجود" : "موجود"}</dd>
            </div>
            <div>
              <dt>فروشگاه</dt>
              <dd>{product.store}</dd>
            </div>
          </dl>

          <fieldset className={styles.variantGroup} disabled={product.unavailable}>
            <legend>رنگ</legend>
            <div>
              {["کرم", "مشکی"].map((color) => (
                <button
                  type="button"
                  key={color}
                  className={props.selectedColor === color ? styles.selectedChoice : ""}
                  aria-pressed={props.selectedColor === color}
                  onClick={() => props.setSelectedColor(color)}
                >
                  {color}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.variantGroup} disabled={product.unavailable}>
            <legend>اندازه</legend>
            <div>
              {["کوچک", "متوسط", "بزرگ"].map((size) => {
                const unavailable = props.selectedColor === "مشکی" && size === "متوسط";
                return (
                  <button
                    type="button"
                    key={size}
                    className={props.selectedSize === size ? styles.selectedChoice : ""}
                    aria-pressed={props.selectedSize === size}
                    aria-label={unavailable ? size + "، ناموجود" : size}
                    onClick={() => props.setSelectedSize(size)}
                  >
                    {size}
                    {unavailable ? <small>ناموجود</small> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {product.unavailable ? (
            <p className={styles.stockMessage} role="status">
              این کالا فعلاً ناموجود و قابل افزودن به سبد نیست.
            </p>
          ) : unavailableCombination ? (
            <p className={styles.stockMessage} role="status">
              رنگ مشکی در اندازه متوسط ناموجود است؛ اندازه دیگری را انتخاب کنید.
            </p>
          ) : props.selectedColor && props.selectedSize ? (
            <p className={styles.inStockMessage} role="status">
              این گونه موجود و آماده افزودن به سبد است.
            </p>
          ) : (
            <p className={styles.selectionMessage}>
              برای دیدن موجودی، رنگ و اندازه را انتخاب کنید.
            </p>
          )}

          <button type="button" className={styles.addButton} disabled={!canAdd}>
            {product.unavailable
              ? "فعلاً قابل سفارش نیست"
              : canAdd
                ? "افزودن به سبد · " + product.price
                : "ابتدا گونه را انتخاب کنید"}
          </button>

          <dl className={styles.trustSummary}>
            <div>
              <dt>ارسال</dt>
              <dd>پست پیشتاز، ۲ تا ۴ روز کاری</dd>
            </div>
            <div>
              <dt>مرجوعی</dt>
              <dd>تا ۳ روز پس از تحویل طبق شرایط فروشگاه</dd>
            </div>
          </dl>
        </div>
      </div>
    </article>
  );
}

function StoreHome({ props, store }: { props: VariantProps; store: Product }) {
  const [contactOpen, setContactOpen] = useState(false);
  const contactDetailsRef = useRef<HTMLDetailsElement>(null);
  const storeProducts = exploreProducts.filter(
    (product) => product.store === store.store,
  );
  const profileProducts = Array.from(
    { length: 9 },
    (_, index) => storeProducts[index % storeProducts.length] ?? store,
  );

  useEffect(() => {
    if (!contactOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !contactDetailsRef.current?.contains(event.target)
      ) {
        setContactOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [contactOpen]);

  return (
    <main className={styles.storeHome} aria-labelledby="store-home-title">
      <header className={styles.storeHomeNav}>
        <button
          type="button"
          className={styles.storeHomeBack}
          onClick={props.closeStore}
          aria-label="بازگشت به کشف"
        >
          →
        </button>
        <h1 id="store-home-title">{store.store}</h1>
        <span />
      </header>

      <section className={styles.storeProfile} aria-label="معرفی فروشگاه">
        <div className={styles.storeProfileSummary}>
          <span className={styles.storeProfileAvatar} aria-hidden="true">
            {store.storeInitial}
          </span>
          <dl className={styles.storeProfileStats}>
            <div>
              <dt>کالا</dt>
              <dd>۹</dd>
            </div>
            <div>
              <dt>دنبال‌کننده</dt>
              <dd>۳۲</dd>
            </div>
            <div>
              <dt>خرید تأییدشده</dt>
              <dd>۱۴</dd>
            </div>
          </dl>
        </div>
        <div className={styles.storeProfileBio}>
          <strong>{store.store}</strong>
          <p>کالاهای دست‌ساز با موجودی، ارسال و شرایط مرجوعی روشن.</p>
        </div>
        <div className={styles.storeProfileActions}>
          <FollowButton
            following={props.following}
            onClick={props.requestFollow}
            quiet
          />
          <button
            type="button"
            className={styles.storeActionButton}
            onClick={() => props.requestMessage(store)}
          >
            پیام مستقیم
          </button>
          <details
            ref={contactDetailsRef}
            className={styles.contactDetails}
            open={contactOpen}
          >
            <summary
              onClick={(event) => {
                event.preventDefault();
                setContactOpen((open) => !open);
              }}
            >
              اطلاعات تماس
            </summary>
            <div>
              <small>اطلاعات نمونه</small>
              <dl>
                <div>
                  <dt>شماره تماس</dt>
                  <dd>
                    <a href="tel:+982188772140" dir="ltr">
                      ۰۲۱ ۸۸۷۷ ۲۱۴۰
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>نشانی</dt>
                  <dd>
                    <address>تهران، خیابان ولیعصر، کوچه سرو، پلاک ۱۲</address>
                  </dd>
                </div>
              </dl>
            </div>
          </details>
        </div>
      </section>

      <div className={styles.storeProfileTab}>کالاها</div>
      <section className={styles.storeHomeProducts} aria-label="کالاهای فروشگاه">
        {profileProducts.map((product, index) => (
          <button
            type="button"
            key={`${product.id}-${index}`}
            aria-label={`دیدن ${product.name}`}
            onClick={() => props.openProduct(product)}
          >
            <ProductVisual product={product} />
            <span className={styles.storeProfileProductBadge}>
              <strong>{product.name}</strong>
              <small>{product.unavailable ? "ناموجود" : product.price}</small>
            </span>
          </button>
        ))}
      </section>
    </main>
  );
}

function ChatPage({ props, store }: { props: VariantProps; store: Product }) {
  return (
    <main className={styles.chatPage} aria-label={`گفت‌وگو با ${store.store}`}>
      <header className={styles.chatHeader}>
        <button type="button" onClick={props.closeChat} aria-label="بازگشت به فروشگاه">
          →
        </button>
        <StoreIdentity product={store} />
        <span />
      </header>
      <section className={styles.chatConversation} aria-label="گفت‌وگو با فروشگاه">
        <div className={styles.chatDay}>امروز</div>
        <p className={styles.storeMessage}>
          سلام! درباره کالا، موجودی یا ارسال چه پرسشی دارید؟
        </p>
      </section>
      <form
        className={styles.chatComposer}
        onSubmit={(event) => event.preventDefault()}
      >
        <div className={styles.chatInputShell}>
          <button type="button" aria-label="شکلک">
            <svg className={styles.emojiGlyph} viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <circle cx="9" cy="10" r="0.8" fill="currentColor" stroke="none" />
              <circle cx="15" cy="10" r="0.8" fill="currentColor" stroke="none" />
              <path d="M8 14c1 2 2.4 3 4 3s3-1 4-3" />
            </svg>
          </button>
          <textarea
            rows={1}
            aria-label={`پیام به ${store.store}`}
            placeholder="پیام…"
          />
          <button type="button" aria-label="افزودن پیوست">
            <svg className={styles.plusGlyph} viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 4v12M4 10h12" />
            </svg>
          </button>
        </div>
        <button type="submit" className={styles.chatSendButton} aria-label="ارسال پیام">
          <svg className={styles.sendGlyph} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.5 3.3 21 12 3.5 20.7l2.1-7.1L15 12l-9.4-1.6-2.1-7.1Z" />
          </svg>
        </button>
      </form>
    </main>
  );
}

function VariantC(props: VariantProps) {
  if (props.feed === "following") {
    return (
      <div className={cx(styles.variant, styles.variantC)}>
        <header className={styles.topbarC}>
          <strong className={styles.wordmark}>سوو</strong>
          <FeedTabs active={props.feed} onChange={props.setFeed} />
          <span />
        </header>
        <EmptyFollowing
          loggedIn={props.loggedIn}
          onLogin={props.requestLogin}
          onDiscover={() => props.setFeed("discover")}
        />
      </div>
    );
  }

  if (props.selectedChat) {
    return (
      <div className={cx(styles.variant, styles.variantC)}>
        <header className={styles.topbarC}>
          <strong className={styles.wordmark}>سوو</strong>
          <FeedTabs active={props.feed} onChange={props.setFeed} />
          <span />
        </header>
        <ChatPage props={props} store={props.selectedChat} />
      </div>
    );
  }

  if (props.selectedStore) {
    return (
      <div className={cx(styles.variant, styles.variantC)}>
        <header className={styles.topbarC}>
          <strong className={styles.wordmark}>سوو</strong>
          <FeedTabs active={props.feed} onChange={props.setFeed} />
          <span />
        </header>
        <StoreHome props={props} store={props.selectedStore} />
      </div>
    );
  }

  if (props.selectedProduct) {
    return (
      <div className={cx(styles.variant, styles.variantC)}>
        <header className={styles.topbarC}>
          <strong className={styles.wordmark}>سوو</strong>
          <FeedTabs active={props.feed} onChange={props.setFeed} />
          <span />
        </header>
        <ExplorePostDetail props={props} product={props.selectedProduct} />
      </div>
    );
  }

  return (
    <div className={cx(styles.variant, styles.variantC)}>
      <header className={styles.topbarC}>
        <strong className={styles.wordmark}>سوو</strong>
        <FeedTabs active={props.feed} onChange={props.setFeed} />
        <button type="button" className={styles.iconButton} aria-label="سبد خرید">
          سبد
        </button>
      </header>

      <main className={styles.exploreFeed}>
        <section className={styles.exploreIntro} aria-labelledby="explore-title">
          <h1 id="explore-title">کشف کالاها</h1>
          <p>کالاهای تازه از فروشگاه‌های مختلف؛ بدون تبلیغ یا رتبه‌بندی محبوبیت.</p>
        </section>

        <section className={styles.exploreGrid} aria-label="کالاهای قابل کشف">
          {exploreProducts.map((product) => (
            <button
              type="button"
              key={product.id}
              className={styles.exploreTile}
              aria-label={`دیدن ${product.name} از فروشگاه ${product.store}`}
              onClick={() => props.openProduct(product)}
            >
              <ProductVisual product={product} />
              <span className={styles.exploreStoreBadge}>
                <b aria-hidden="true">{product.storeInitial}</b>
                {product.store}
              </span>
              <span className={styles.exploreProductBadge}>
                <strong>{product.name}</strong>
                <small>{product.unavailable ? "ناموجود" : product.price}</small>
              </span>
            </button>
          ))}
        </section>
      </main>
    </div>
  );
}

function LoginPrompt({
  product,
  intent,
  onClose,
  onContinue,
}: {
  product: Product;
  intent: LoginIntent;
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.loginDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.dialogClose}
          onClick={onClose}
          aria-label="بستن"
        >
          ×
        </button>
        <span aria-hidden="true">{product.storeInitial}</span>
        <h2 id="login-title">
          {intent === "follow"
            ? `«${product.store}» را دنبال کنید`
            : `با «${product.store}» گفت‌وگو کنید`}
        </h2>
        <p>
          {intent === "follow"
            ? "برای نگه‌داشتن فروشگاه‌ها وارد شوید. پس از ورود به همین‌جا برمی‌گردید."
            : "برای ارسال پیام وارد شوید. پس از ورود به همین فروشگاه برمی‌گردید."}
        </p>
        <button type="button" className={styles.loginAction} onClick={onContinue}>
          {intent === "follow"
            ? "ورود آزمایشی و دنبال کردن"
            : "ورود آزمایشی و شروع گفت‌وگو"}
        </button>
        <button type="button" className={styles.continueBrowsing} onClick={onClose}>
          فعلاً ادامهٔ دیدن کالاها
        </button>
      </section>
    </div>
  );
}

function StateReadout({
  variant,
  feed,
  loggedIn,
  following,
  selectedProduct,
  selectedColor,
  selectedSize,
}: {
  variant: PrototypeVariant;
  feed: Feed;
  loggedIn: boolean;
  following: boolean;
  selectedProduct: Product | null;
  selectedColor: string | null;
  selectedSize: string | null;
}) {
  let productState = "نمای فید";
  if (selectedProduct) {
    productState = selectedProduct.name;
    if (selectedColor) productState += "، " + selectedColor;
    if (selectedSize) productState += "، " + selectedSize;
  }

  return (
    <output className={styles.stateReadout} aria-live="polite">
      نمونه {variant} · {loggedIn ? "خریدار" : "مهمان"} ·{" "}
      {feed === "discover" ? "کشف" : "دنبال‌شده‌ها"} ·{" "}
      {following ? "فروشگاه دنبال شده" : "بدون دنبال‌کردن"} · {productState}
    </output>
  );
}

export function BuyerDiscoveryPrototype() {
  const variant = usePrototypeVariant();
  const [feed, setFeed] = useState<Feed>("discover");
  const [loggedIn, setLoggedIn] = useState(false);
  const [following, setFollowing] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginIntent, setLoginIntent] = useState<LoginIntent>("follow");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedStore, setSelectedStore] = useState<Product | null>(null);
  const [selectedChat, setSelectedChat] = useState<Product | null>(null);
  const [pendingChat, setPendingChat] = useState<Product | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);

  const props = useMemo<VariantProps>(
    () => ({
      feed,
      loggedIn,
      following,
      selectedProduct,
      selectedStore,
      selectedChat,
      selectedColor,
      selectedSize,
      setFeed(nextFeed) {
        setFeed(nextFeed);
      },
      openProduct(product) {
        setSelectedProduct(product);
        setSelectedStore(null);
        setSelectedColor(null);
        setSelectedSize(null);
      },
      closeProduct() {
        setSelectedProduct(null);
        setSelectedColor(null);
        setSelectedSize(null);
      },
      openStore(product) {
        setSelectedStore(product);
        setSelectedProduct(null);
        setSelectedColor(null);
        setSelectedSize(null);
      },
      closeStore() {
        setSelectedStore(null);
      },
      requestFollow() {
        if (!loggedIn) {
          setLoginIntent("follow");
          setShowLogin(true);
          return;
        }
        setFollowing((value) => !value);
      },
      requestMessage(product) {
        if (!loggedIn) {
          setPendingChat(product);
          setLoginIntent("message");
          setShowLogin(true);
          return;
        }
        setSelectedChat(product);
      },
      closeChat() {
        setSelectedChat(null);
      },
      requestLogin() {
        setLoginIntent("follow");
        setShowLogin(true);
      },
      setSelectedColor,
      setSelectedSize,
    }),
    [
      feed,
      following,
      loggedIn,
      selectedColor,
      selectedProduct,
      selectedSize,
      selectedStore,
      selectedChat,
    ],
  );

  return (
    <div className={styles.prototypePage} dir="rtl">
      <a className={styles.skipLink} href="#prototype-content">
        رفتن به نمونه
      </a>
      <div id="prototype-content">
        {variant === "A" ? <VariantA {...props} /> : null}
        {variant === "B" ? <VariantB {...props} /> : null}
        {variant === "C" ? <VariantC {...props} /> : null}
      </div>

      <StateReadout
        variant={variant}
        feed={feed}
        loggedIn={loggedIn}
        following={following}
        selectedProduct={selectedProduct}
        selectedColor={selectedColor}
        selectedSize={selectedSize}
      />
      <PrototypeSwitcher current={variant} />

      {showLogin ? (
        <LoginPrompt
          product={selectedProduct ?? selectedStore ?? products[0]}
          intent={loginIntent}
          onClose={() => setShowLogin(false)}
          onContinue={() => {
            setLoggedIn(true);
            if (loginIntent === "follow") setFollowing(true);
            if (loginIntent === "message" && pendingChat) {
              setSelectedChat(pendingChat);
              setPendingChat(null);
            }
            setShowLogin(false);
          }}
        />
      ) : null}
    </div>
  );
}
