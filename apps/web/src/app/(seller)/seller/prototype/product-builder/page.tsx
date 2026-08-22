import { ProductBuilderPrototype } from "./product-builder-prototype";

type PageProps = {
  searchParams: Promise<{ variant?: string }>;
};

export default async function ProductBuilderPrototypePage({ searchParams }: PageProps) {
  const { variant } = await searchParams;
  return <ProductBuilderPrototype initialVariant={variant} />;
}
