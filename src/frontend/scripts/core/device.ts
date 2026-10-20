/** iPhone, iPod and iPad, including iPads that identify as desktop Safari; only these follow `itms-services`. */
export function isAppleMobileDevice(
  navigatorLike: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator,
): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigatorLike.userAgent) ||
    (/Macintosh/.test(navigatorLike.userAgent) && navigatorLike.maxTouchPoints > 1)
  );
}
