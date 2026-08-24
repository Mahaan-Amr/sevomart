export function formatIrrAsToman(amount: number) {
  return `${new Intl.NumberFormat("fa-IR").format(amount / 10)} تومان`;
}
