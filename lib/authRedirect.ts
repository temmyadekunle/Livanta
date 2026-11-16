/**
 * Where an emailed authentication link must return.
 *
 * Every email flow passes this explicitly. Without it GoTrue falls back to the
 * project's Site URL, which is one dashboard value shared by every environment:
 * a development value there sends a production sign-up to a localhost address
 * the recipient cannot open, and the single-use token is spent on the way.
 *
 * The pathname is included to match the recovery flow. The app is a static
 * export, so the redirect has to land on the page that booted it rather than on
 * a server route that does not exist.
 */
export function authRedirectUrl(origin: string, pathname: string): string {
  return `${origin}${pathname}`;
}
