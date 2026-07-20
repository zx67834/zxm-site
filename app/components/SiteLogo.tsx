import Link from "next/link";

export default function SiteLogo() {
  return <Link className="site-logo" href="/" aria-label="返回 zxm 的小站首页">
    <span className="site-logo-mark" aria-hidden="true">
      <i />
      <b>Z</b>
    </span>
    <span className="site-logo-type">
      <strong>ZXM</strong>
      <small>PERSONAL SITE</small>
    </span>
  </Link>;
}
